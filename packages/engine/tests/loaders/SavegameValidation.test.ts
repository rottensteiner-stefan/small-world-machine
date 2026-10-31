import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import {
  FileSavegameStore,
  IndexedDbSavegameStore,
  OpfsSavegameStore,
  SAVEGAME_MIGRATIONS,
  SAVEGAME_SCHEMA_VERSION,
  assertNoRetiredIdReuse,
  assertSavegameIdReferences,
  assertUniqueLevelEntityIds,
  backupSavegameDescriptor,
  createSavegameStore,
  migrateSavegameDescriptor,
  parseSavegameFromFile,
  serializeSavegameToFile,
  type AppManifest,
  type LevelDescriptor,
  type SavegameDescriptor,
  type SavegameLevelState,
  type SavegamePatchAction,
} from "../../src/loaders/kit/KitRegistry.js";

function findRepoRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    if (
      fs.existsSync(path.join(current, "pnpm-workspace.yaml")) ||
      fs.existsSync(path.join(current, "package.json"))
    ) {
      if (fs.existsSync(path.join(current, "public", "schemas", "savegame.schema.json"))) {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(
        "Could not find repository root containing public/schemas/savegame.schema.json",
      );
    }
    current = parent;
  }
}

/** A valid v1 fixture. No real savegame file exists yet — the format is designed before any save feature. */
function validFixture(): SavegameDescriptor {
  return {
    id: "the-whisper:slot-01",
    app: "the-whisper",
    schemaVersion: 1,
    storage: "indexeddb",
    createdAt: "2026-10-28T12:00:00.000Z",
    updatedAt: "2026-10-28T12:05:00.000Z",
    settings: { language: "de" },
    levels: [
      {
        id: "koje_42",
        flags: { completed: true, bestScore: 1200 },
        patches: [
          { op: "set", target: "koje_42", path: "door.blasted", value: true },
          { op: "add", target: "flakturm/bunker_blast_door", path: "state", value: "opened" },
        ],
      },
    ],
  };
}

/** First level entry of a fixture (the fixture always defines exactly one). */
function firstLevel(savegame: SavegameDescriptor): SavegameLevelState {
  const level = savegame.levels[0];
  if (level === undefined) {
    throw new Error("Fixture has no levels[0]");
  }
  return level;
}

describe("Savegame Schema & Format Validation (ADR 0041 Stufe 5)", () => {
  const repoRoot = findRepoRoot(__dirname);
  const schemaPath = path.join(repoRoot, "public", "schemas", "savegame.schema.json");

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const schemaJson = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as Record<string, unknown>;
  const validateSavegame: ValidateFunction = ajv.compile(schemaJson);

  function expectSchemaValid(data: SavegameDescriptor): void {
    const valid = validateSavegame(data);
    if (!valid) {
      const errors = (validateSavegame.errors ?? [])
        .map((e) => `  ${e.instancePath || "/"} ${e.message}`)
        .join("\n");
      expect.fail(`Schema validation errors:\n${errors}`);
    }
  }

  it("compiles the schema and accepts a valid v1 fixture", () => {
    const fixture = validFixture();
    expectSchemaValid(fixture);
    expect(fixture.schemaVersion).toBe(SAVEGAME_SCHEMA_VERSION);
  });

  it("rejects a missing schemaVersion (required by savegame.schema.json)", () => {
    const incomplete: Record<string, unknown> = { ...validFixture() };
    delete incomplete["schemaVersion"];
    expect(validateSavegame(incomplete)).toBe(false);
  });

  it("rejects a storage value outside the format-level set (never localStorage, ADR 0041 §1)", () => {
    expect(validateSavegame({ ...validFixture(), storage: "localstorage" })).toBe(false);
  });

  it("rejects invalid patch actions (missing target) and non-primitive flag values", () => {
    const badAction = validFixture();
    // `target` is required by the schema and the type; the cast models a malformed on-disk payload.
    firstLevel(badAction).patches?.push({ op: "set" } as SavegamePatchAction);
    expect(validateSavegame(badAction)).toBe(false);

    const badFlag = validFixture();
    firstLevel(badFlag).flags = { nested: { object: true } } as unknown as NonNullable<
      SavegameLevelState["flags"]
    >;
    expect(validateSavegame(badFlag)).toBe(false);
  });

  describe("schemaVersion policy & migration chain (ADR 0041 §4 / §7 Stufe 5)", () => {
    it("keeps v1 at v1 through the (empty) migration chain", () => {
      expect(SAVEGAME_MIGRATIONS.size).toBe(0);
      const migrated = migrateSavegameDescriptor(validFixture());
      expect(migrated.savegame.schemaVersion).toBe(SAVEGAME_SCHEMA_VERSION);
      expect(migrated.savegame.levels).toHaveLength(1);
    });

    it("defaults unversioned in-memory descriptors to version 1", () => {
      const legacy = validFixture();
      delete (legacy as Partial<SavegameDescriptor>).schemaVersion;
      expect(migrateSavegameDescriptor(legacy).savegame.schemaVersion).toBe(1);
    });

    it.each([0, -1, 2, 99, 1.5, Number.NaN])(
      "fails fast in migrateSavegameDescriptor for schemaVersion=%s",
      (badVersion) => {
        const bad: SavegameDescriptor = { ...validFixture(), schemaVersion: badVersion };
        expect(() => migrateSavegameDescriptor(bad)).toThrow(/Unsupported savegame schemaVersion/);
      },
    );

    it("rejects unsupported schemaVersion in the schema itself", () => {
      expect(validateSavegame({ ...validFixture(), schemaVersion: 0 })).toBe(false);
      expect(validateSavegame({ ...validFixture(), schemaVersion: 2 })).toBe(false);
    });
  });

  describe("forward tolerance (ADR 0041 §4)", () => {
    it("accepts unknown fields inside patch actions and preserves them through migration", () => {
      const fixture = validFixture();
      firstLevel(fixture).patches?.push({
        op: "set",
        target: "koje_42",
        path: "door",
        value: true,
        // A field a newer engine writes; older engines must ignore and preserve it.
        futureField: { nested: true },
      });
      expectSchemaValid(fixture);
      const migrated = migrateSavegameDescriptor(fixture).savegame;
      const patch = migrated.levels[0]?.patches?.find((p) => p["futureField"] !== undefined);
      expect(patch?.["futureField"]).toEqual({ nested: true });
    });

    it("accepts unknown settings entries (settings are user data, tolerant by design)", () => {
      const fixture = validFixture();
      fixture.settings["musicVolume"] = 0.7;
      expectSchemaValid(fixture);
    });

    it("rejects unknown top-level envelope fields (the envelope is strict, ADR 0041 §4)", () => {
      expect(validateSavegame({ ...validFixture(), extraTopLevel: true })).toBe(false);
    });
  });

  describe("backup-before-migration & ID-reference rule (ADR 0041 §15.5 / §1)", () => {
    it("creates an untouched JSON-compatible backup before migration and never mutates the original", () => {
      const original = validFixture();
      const before = JSON.stringify(original);
      const result = migrateSavegameDescriptor(original);
      expect(result.backup).toBeDefined();
      expect(result.backup).not.toBe(original);
      expect(JSON.stringify(result.backup)).toBe(before);
      expect(JSON.stringify(original)).toBe(before);
    });

    it("can disable the default backup explicitly (backup: false)", () => {
      const result = migrateSavegameDescriptor(validFixture(), { backup: false });
      expect(result.backup).toBeUndefined();
      expect(result.savegame.schemaVersion).toBe(SAVEGAME_SCHEMA_VERSION);
    });

    it("backupSavegameDescriptor returns a JSON-compatible deep copy decoupled from the input", () => {
      const original = validFixture();
      const backup = backupSavegameDescriptor(original);
      expect(backup).toEqual(original);
      expect(backup).not.toBe(original);
      original.settings.language = "en";
      expect(backup.settings.language).toBe("de");
    });

    it("accepts patch targets that reference declared level/instance ids", () => {
      expect(() => assertSavegameIdReferences(validFixture())).not.toThrow();
    });

    it("accepts patch targets in stable namespace:path id form", () => {
      const fixture = validFixture();
      firstLevel(fixture).patches?.push({
        op: "set",
        target: "the-whisper:koje_42",
        path: "x",
        value: 1,
      });
      expect(() => assertSavegameIdReferences(fixture)).not.toThrow();
    });

    it.each(["", "some weird string", "1234", "!target", "KOJE_42", "UPPER/foo"])(
      "rejects patch targets that are neither declared nor namespace:path (%s)",
      (target) => {
        const fixture = validFixture();
        firstLevel(fixture).patches?.push({ op: "set", target, path: "x", value: true });
        expect(() => assertSavegameIdReferences(fixture)).toThrow(
          /is neither a declared level\/instance id/,
        );
      },
    );
  });

  describe("ID tombstone & uniqueness validation ('IDs werden nie wiederverwendet', ADR 0041 §2)", () => {
    function baseManifest(): AppManifest {
      return {
        id: "the-whisper",
        name: "The Whisper",
        version: "0.1.0",
        schemaVersion: 1,
        entry: "index.html",
        levels: ["koje_42", "kaeltekammer"],
        characters: ["novotny"],
        kits: [],
      };
    }

    it("passes when retiredIds has no overlap with active levels, characters, props, or texts", () => {
      const manifest: AppManifest = {
        ...baseManifest(),
        retiredIds: {
          levels: ["old_bunker_alpha"],
          characters: ["old_guard_01"],
          props: ["prop_removed_crate_99"],
          texts: ["dialogue.legacy.intro"],
        },
      };
      expect(() =>
        assertNoRetiredIdReuse(manifest, {
          levels: ["koje_42", "kaeltekammer"],
          characters: ["novotny"],
          props: ["prop_bed_01", "hotspot_desk"],
          texts: ["terminal.header.title"],
        }),
      ).not.toThrow();
    });

    it("fails fast if a retired level ID reappears in manifest.levels or discovered levels", () => {
      const manifest: AppManifest = {
        ...baseManifest(),
        retiredIds: { levels: ["koje_42"] },
      };
      expect(() => assertNoRetiredIdReuse(manifest)).toThrow(
        /retired levels ID 'koje_42' must never be reused/,
      );
    });

    it("fails fast if a retired character, prop, or text ID is reused", () => {
      const charManifest: AppManifest = {
        ...baseManifest(),
        retiredIds: { characters: ["novotny"] },
      };
      expect(() => assertNoRetiredIdReuse(charManifest)).toThrow(
        /retired characters ID 'novotny' must never be reused/,
      );

      const propManifest: AppManifest = {
        ...baseManifest(),
        retiredIds: { props: ["prop_bunker_door"] },
      };
      expect(() =>
        assertNoRetiredIdReuse(propManifest, { props: ["prop_bed_01", "prop_bunker_door"] }),
      ).toThrow(/retired props ID 'prop_bunker_door' must never be reused/);

      const textManifest: AppManifest = {
        ...baseManifest(),
        retiredIds: { texts: ["hotspot.koje42.cot.prompt"] },
      };
      expect(() =>
        assertNoRetiredIdReuse(textManifest, { texts: ["hotspot.koje42.cot.prompt"] }),
      ).toThrow(/retired texts ID 'hotspot.koje42.cot.prompt' must never be reused/);
    });

    it("rejects duplicate entries inside retiredIds", () => {
      const manifest: AppManifest = {
        ...baseManifest(),
        retiredIds: { props: ["old_prop", "old_prop"] },
      };
      expect(() => assertNoRetiredIdReuse(manifest)).toThrow(/duplicate retired ID 'old_prop'/);
    });

    it("assertUniqueLevelEntityIds enforces unique IDs across props, decals, lights, and hotspots", () => {
      const validLevel: LevelDescriptor = {
        id: "koje_42",
        name: "Koje 42",
        version: "1.0.0",
        schemaVersion: 1,
        props: [{ id: "prop_cot", kitProp: "bunker/cot" }],
        lights: [{ name: "light_ceiling", type: "point", color: "#ffffff", intensity: 1 }],
        hotspots: [
          {
            id: "hotspot_cot",
            name: "Cot",
            position: [0, 0, 0],
            promptText: "hotspot.cot.prompt",
          },
        ],
      };
      expect(() => assertUniqueLevelEntityIds(validLevel)).not.toThrow();

      const collidingLevel: LevelDescriptor = {
        ...validLevel,
        hotspots: [
          {
            id: "prop_cot",
            name: "Colliding ID",
            position: [0, 0, 0],
            promptText: "hotspot.cot.prompt",
          },
        ],
      };
      expect(() => assertUniqueLevelEntityIds(collidingLevel)).toThrow(
        /duplicate entity ID 'prop_cot' shared by prop and hotspot/,
      );
    });
  });

  describe("SavegameStore Drivers: OPFS, IndexedDB & File (ADR 0041 §1 / §7 Stufe 5)", () => {
    /** Minimal in-memory OPFS double matching FileSystemDirectoryHandle / FileSystemFileHandle. */
    function createFakeOpfsRoot(): () => Promise<FileSystemDirectoryHandle> {
      const dirs = new Map<string, Map<string, Uint8Array>>();

      const makeDirHandle = (dirName: string): FileSystemDirectoryHandle => {
        let files = dirs.get(dirName);
        if (!files) {
          files = new Map<string, Uint8Array>();
          dirs.set(dirName, files);
        }
        return {
          kind: "directory",
          name: dirName,
          async getDirectoryHandle(
            subName: string,
            options?: { create?: boolean },
          ): Promise<FileSystemDirectoryHandle> {
            const key = `${dirName}/${subName}`;
            if (!dirs.has(key) && !options?.create) {
              const err = new Error("Directory not found");
              err.name = "NotFoundError";
              throw err;
            }
            return makeDirHandle(key);
          },
          async getFileHandle(
            fileName: string,
            options?: { create?: boolean },
          ): Promise<FileSystemFileHandle> {
            if (!files.has(fileName) && !options?.create) {
              const err = new Error(`File not found: ${fileName}`);
              err.name = "NotFoundError";
              throw err;
            }
            if (!files.has(fileName)) {
              files.set(fileName, new Uint8Array(0));
            }
            return {
              kind: "file",
              name: fileName,
              async getFile(): Promise<File> {
                const bytes = files.get(fileName) ?? new Uint8Array(0);
                return {
                  async text(): Promise<string> {
                    return new TextDecoder().decode(bytes);
                  },
                } as unknown as File;
              },
              async createWritable(): Promise<FileSystemWritableFileStream> {
                let staged = new Uint8Array(0);
                return {
                  async write(data: BufferSource): Promise<void> {
                    if (data instanceof ArrayBuffer) {
                      staged = new Uint8Array(data.slice(0));
                    } else if (ArrayBuffer.isView(data)) {
                      staged = new Uint8Array(
                        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
                      );
                    }
                  },
                  async close(): Promise<void> {
                    files.set(fileName, staged);
                  },
                } as unknown as FileSystemWritableFileStream;
              },
            } as unknown as FileSystemFileHandle;
          },
          async removeEntry(fileName: string): Promise<void> {
            if (!files.has(fileName)) {
              const err = new Error(`File not found: ${fileName}`);
              err.name = "NotFoundError";
              throw err;
            }
            files.delete(fileName);
          },
          async *keys(): AsyncIterableIterator<string> {
            for (const k of files.keys()) {
              yield k;
            }
          },
        } as unknown as FileSystemDirectoryHandle;
      };

      const root = makeDirHandle("root");
      return async () => root;
    }

    /** Minimal in-memory IndexedDB double supporting open, objectStore, put, get, delete, getAllKeys. */
    function createFakeIdbFactory(): IDBFactory {
      const databases = new Map<string, Map<string, Map<IDBValidKey, unknown>>>();

      interface FakeReq {
        result: unknown;
        error: DOMException | null;
        onupgradeneeded: (() => void) | null;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
      }

      interface FakeTx {
        error: DOMException | null;
        oncomplete: (() => void) | null;
        onabort: (() => void) | null;
        onerror: (() => void) | null;
        objectStore: (storeName: string) => IDBObjectStore;
      }

      return {
        open(dbName: string): IDBOpenDBRequest {
          const req: FakeReq = {
            result: null,
            error: null,
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
          };

          queueMicrotask(() => {
            let isNew = false;
            let stores = databases.get(dbName);
            if (!stores) {
              isNew = true;
              stores = new Map();
              databases.set(dbName, stores);
            }

            const db = {
              objectStoreNames: {
                contains: (name: string): boolean => stores.has(name),
              },
              createObjectStore: (name: string): IDBObjectStore => {
                if (!stores.has(name)) stores.set(name, new Map());
                return {} as IDBObjectStore;
              },
              transaction: (_storeNames: string[]): IDBTransaction => {
                const tx: FakeTx = {
                  error: null,
                  oncomplete: null,
                  onabort: null,
                  onerror: null,
                  objectStore: (storeName: string): IDBObjectStore => {
                    const map = stores.get(storeName) ?? new Map<IDBValidKey, unknown>();
                    return {
                      put(val: unknown, key: IDBValidKey): IDBRequest {
                        map.set(key, val);
                        return {} as IDBRequest;
                      },
                      get(key: IDBValidKey): IDBRequest {
                        const r: FakeReq = {
                          result: map.get(key),
                          error: null,
                          onupgradeneeded: null,
                          onsuccess: null,
                          onerror: null,
                        };
                        queueMicrotask(() => {
                          if (r.onsuccess) r.onsuccess();
                        });
                        return r as unknown as IDBRequest;
                      },
                      delete(key: IDBValidKey): IDBRequest {
                        map.delete(key);
                        return {} as IDBRequest;
                      },
                      getAllKeys(): IDBRequest {
                        const r: FakeReq = {
                          result: Array.from(map.keys()),
                          error: null,
                          onupgradeneeded: null,
                          onsuccess: null,
                          onerror: null,
                        };
                        queueMicrotask(() => {
                          if (r.onsuccess) r.onsuccess();
                        });
                        return r as unknown as IDBRequest;
                      },
                    } as unknown as IDBObjectStore;
                  },
                };
                queueMicrotask(() => {
                  if (tx.oncomplete) tx.oncomplete();
                });
                return tx as unknown as IDBTransaction;
              },
              close(): void {},
            };

            req.result = db;
            if (isNew && req.onupgradeneeded) {
              req.onupgradeneeded();
            }
            if (req.onsuccess) {
              req.onsuccess();
            }
          });

          return req as unknown as IDBOpenDBRequest;
        },
      } as unknown as IDBFactory;
    }

    it("serializes and parses savegame files with Backup-vor-Migration", () => {
      const fixture = validFixture();
      const json = serializeSavegameToFile(fixture);
      expect(json.endsWith("\n")).toBe(true);
      const parsed = parseSavegameFromFile(json);
      expect(parsed.savegame.id).toBe("the-whisper:slot-01");
      expect(parsed.backup).toEqual(fixture);
    });

    it("OpfsSavegameStore: round-trips save, load, list, delete, and flush/close", async () => {
      const store = new OpfsSavegameStore(createFakeOpfsRoot());
      expect(store.backend).toBe("opfs");

      expect(await store.load("the-whisper:slot-01")).toBeNull();

      await store.save(validFixture());
      await store.save({ ...validFixture(), id: "the-whisper:slot-02" });
      await store.flush();

      expect(await store.list()).toEqual(["the-whisper:slot-01", "the-whisper:slot-02"]);

      const loaded = await store.load("the-whisper:slot-01");
      expect(loaded).not.toBeNull();
      expect(loaded!.savegame.storage).toBe("opfs");
      expect(loaded!.savegame.levels[0]?.flags?.["completed"]).toBe(true);
      expect(loaded!.backup).toBeDefined();

      await store.delete("the-whisper:slot-01");
      expect(await store.load("the-whisper:slot-01")).toBeNull();
      expect(await store.list()).toEqual(["the-whisper:slot-02"]);
      await store.close();
    });

    it("IndexedDbSavegameStore: round-trips save, load, list, delete, and close", async () => {
      const store = new IndexedDbSavegameStore(createFakeIdbFactory(), "test-savegames");
      expect(store.backend).toBe("indexeddb");

      expect(await store.load("the-whisper:slot-01")).toBeNull();

      await store.save(validFixture());
      expect(await store.list()).toEqual(["the-whisper:slot-01"]);

      const loaded = await store.load("the-whisper:slot-01");
      expect(loaded).not.toBeNull();
      expect(loaded!.savegame.storage).toBe("indexeddb");
      expect(loaded!.savegame.settings.language).toBe("de");

      await store.delete("the-whisper:slot-01");
      expect(await store.load("the-whisper:slot-01")).toBeNull();
      await store.close();
    });

    it("FileSavegameStore & createSavegameStore fallback: exports/imports JSON and selects available driver", async () => {
      const store = createSavegameStore({ prefer: ["opfs", "indexeddb", "file"] });
      expect(store.backend).toBe("file");
      expect(store).toBeInstanceOf(FileSavegameStore);

      await store.save(validFixture());
      expect(await store.list()).toEqual(["the-whisper:slot-01"]);

      const fileStore = store as FileSavegameStore;
      const exported = fileStore.exportSlotToJson("the-whisper:slot-01");
      expect(exported).toContain('"the-whisper:slot-01"');

      const loaded = await store.load("the-whisper:slot-01");
      expect(loaded?.savegame.storage).toBe("file");
    });
  });
});
