import { describe, it, expect } from "vitest";
import {
  FileSavegameStore,
  IndexedDbSavegameStore,
  OpfsSavegameStore,
  assertAppManifest,
  assertSavegameDescriptor,
  assertSavegameIdReferences,
  type SavegameDescriptor,
} from "../../src/loaders/kit/KitRegistry.js";

function fixture(id = "app:slot-01"): SavegameDescriptor {
  return {
    id,
    app: "app",
    schemaVersion: 1,
    storage: "indexeddb",
    settings: { language: "de" },
    levels: [{ id: "lvl", flags: { done: true } }],
  };
}

// ── Fake OPFS directory with raw seeding ──────────────────────────────────────────────────────
function createOpfs(): {
  getDirectory: () => Promise<FileSystemDirectoryHandle>;
  files: Map<string, string>;
} {
  const files = new Map<string, string>();
  const notFound = (n: string): Error => Object.assign(new Error(n), { name: "NotFoundError" });
  const dir = {
    async getDirectoryHandle(): Promise<FileSystemDirectoryHandle> {
      return dir as unknown as FileSystemDirectoryHandle;
    },
    async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileSystemFileHandle> {
      if (!files.has(name)) {
        if (!opts?.create) throw notFound(name);
        files.set(name, "");
      }
      return {
        async getFile() {
          return { text: async (): Promise<string> => files.get(name) ?? "" };
        },
        async createWritable() {
          let staged = "";
          return {
            async write(d: ArrayBuffer): Promise<void> {
              staged = new TextDecoder().decode(d);
            },
            async close(): Promise<void> {
              files.set(name, staged);
            },
          };
        },
      } as unknown as FileSystemFileHandle;
    },
    async removeEntry(name: string): Promise<void> {
      if (!files.has(name)) throw notFound(name);
      files.delete(name);
    },
    async *keys(): AsyncIterableIterator<string> {
      yield* files.keys();
    },
  };
  return { getDirectory: async () => dir as unknown as FileSystemDirectoryHandle, files };
}

// ── Fake IndexedDB with failure injection and raw seeding ─────────────────────────────────────
interface FakeIdb {
  factory: IDBFactory;
  stores: Map<string, Map<IDBValidKey, unknown>>;
  opens: { count: number; failNext: boolean };
  lastDb: { onversionchange: (() => void) | null; closed: boolean } | null;
}
function createIdb(): FakeIdb {
  const stores = new Map<string, Map<IDBValidKey, unknown>>();
  const state: FakeIdb = {
    stores,
    opens: { count: 0, failNext: false },
    lastDb: null,
    factory: undefined as unknown as IDBFactory,
  };
  state.factory = {
    open(): IDBOpenDBRequest {
      state.opens.count++;
      const req: Record<string, unknown> = { result: null, error: null };
      queueMicrotask(() => {
        if (state.opens.failNext) {
          state.opens.failNext = false;
          req["error"] = new Error("boom");
          (req["onerror"] as (() => void) | undefined)?.();
          return;
        }
        const db = {
          onversionchange: null as (() => void) | null,
          closed: false,
          objectStoreNames: { contains: (n: string): boolean => stores.has(n) },
          createObjectStore(n: string): void {
            stores.set(n, new Map());
          },
          close(): void {
            db.closed = true;
          },
          transaction(): IDBTransaction {
            const tx: Record<string, unknown> = {
              error: null,
              objectStore(n: string): IDBObjectStore {
                const m = stores.get(n)!;
                return {
                  put: (v: unknown, k: IDBValidKey): void => void m.set(k, v),
                  delete: (k: IDBValidKey): void => void m.delete(k),
                  get(k: IDBValidKey): IDBRequest {
                    const r: Record<string, unknown> = { result: m.get(k) };
                    queueMicrotask(() => (r["onsuccess"] as () => void)());
                    return r as unknown as IDBRequest;
                  },
                  getAllKeys(): IDBRequest {
                    const r: Record<string, unknown> = { result: [...m.keys()] };
                    queueMicrotask(() => (r["onsuccess"] as () => void)());
                    return r as unknown as IDBRequest;
                  },
                } as unknown as IDBObjectStore;
              },
            };
            queueMicrotask(() => (tx["oncomplete"] as (() => void) | undefined)?.());
            return tx as unknown as IDBTransaction;
          },
        };
        state.lastDb = db;
        req["result"] = db;
        if (stores.size === 0) (req["onupgradeneeded"] as () => void)();
        (req["onsuccess"] as () => void)();
      });
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
  return state;
}

describe("IndexedDbSavegameStore robustness", () => {
  it("retries opening after a failed open instead of caching the rejection forever", async () => {
    const idb = createIdb();
    idb.opens.failNext = true;
    const store = new IndexedDbSavegameStore(idb.factory, "t");
    await expect(store.save(fixture())).rejects.toThrow("boom");
    await expect(store.save(fixture())).resolves.toBeUndefined();
    expect(idb.opens.count).toBe(2);
    expect(await store.list()).toEqual(["app:slot-01"]);
  });

  it("closes its connection on versionchange and reopens lazily afterwards", async () => {
    const idb = createIdb();
    const store = new IndexedDbSavegameStore(idb.factory, "t");
    await store.save(fixture());
    const db = idb.lastDb!;
    expect(typeof db.onversionchange).toBe("function");
    db.onversionchange!();
    expect(db.closed).toBe(true);
    await store.list();
    expect(idb.opens.count).toBe(2);
  });

  it("rejects a stored record with a broken envelope with a contextual error", async () => {
    const idb = createIdb();
    const store = new IndexedDbSavegameStore(idb.factory, "t");
    await store.save(fixture());
    idb.stores.get("savegames")!.set("bad", { id: "bad", app: "app", settings: {} });
    await expect(store.load("bad")).rejects.toThrow(
      /\[IndexedDbSavegameStore\] Invalid savegame envelope/,
    );
  });

  it("delete removes the slot's backups so a recreated slot exposes no foreign data", async () => {
    const idb = createIdb();
    const store = new IndexedDbSavegameStore(idb.factory, "t");
    await store.save(fixture());
    idb.stores.get("savegame-backups")!.set("app:slot-01@v1", fixture());
    expect(await store.loadBackup("app:slot-01", 1)).not.toBeNull();
    await store.delete("app:slot-01");
    await store.save(fixture());
    expect(await store.loadBackup("app:slot-01", 1)).toBeNull();
  });
});

describe("OpfsSavegameStore / FileSavegameStore delete removes backups", () => {
  it("OPFS", async () => {
    const opfs = createOpfs();
    const store = new OpfsSavegameStore(opfs.getDirectory);
    await store.save(fixture());
    opfs.files.set("app%3Aslot-01.backup.v1.json", JSON.stringify(fixture()));
    expect(await store.loadBackup("app:slot-01", 1)).not.toBeNull();
    await store.delete("app:slot-01");
    expect(await store.loadBackup("app:slot-01", 1)).toBeNull();
    expect(opfs.files.size).toBe(0);
  });

  it("File", async () => {
    const store = new FileSavegameStore();
    await store.save(fixture());
    (store as unknown as { _backups: Map<string, string> })._backups.set(
      "app:slot-01@v1",
      JSON.stringify(fixture()),
    );
    expect(await store.loadBackup("app:slot-01", 1)).not.toBeNull();
    await store.delete("app:slot-01");
    expect(await store.loadBackup("app:slot-01", 1)).toBeNull();
  });
});

describe("assertSavegameDescriptor / id references / manifest elements", () => {
  it("throws a contextual error instead of a TypeError for missing levels", () => {
    const broken = { id: "a:b", app: "a", settings: {} } as unknown as SavegameDescriptor;
    expect(() => assertSavegameIdReferences(broken, "Ctx")).toThrow(
      /\[Ctx\] Invalid savegame envelope/,
    );
    expect(() => assertSavegameDescriptor(null, "Ctx")).toThrow(/\[Ctx\]/);
    expect(() =>
      assertSavegameDescriptor({ ...fixture(), levels: [{ flags: {} }] }, "Ctx"),
    ).toThrow(/levels\[0\] must be an object with a string id/);
    expect(() =>
      assertSavegameDescriptor(
        { ...fixture(), levels: [{ id: "l", patches: [{ op: "set" }] }] },
        "Ctx",
      ),
    ).toThrow(/patches\[0\] must be an object with a string target/);
  });

  it("rejects traversal and empty segments in stable ids but keeps valid ones", () => {
    const withTarget = (target: string): SavegameDescriptor => ({
      ...fixture(),
      levels: [{ id: "lvl", patches: [{ op: "set", target }] }],
    });
    for (const bad of ["a/../x", "a:../x", "a/./x", "a//x", "a/x/"]) {
      expect(() => assertSavegameIdReferences(withTarget(bad))).toThrow(/neither a declared/);
    }
    for (const good of ["bunker/blast_door", "game-app:door.01", "a/b/c-d"]) {
      expect(() => assertSavegameIdReferences(withTarget(good))).not.toThrow();
    }
  });

  it("assertAppManifest validates elements of levels, characters and kits", () => {
    const base = {
      id: "a",
      name: "A",
      version: "1",
      entry: "e",
      schemaVersion: 1,
      levels: ["l"],
      characters: ["c"],
      kits: [{ id: "k", version: "1" }],
    };
    expect(() => assertAppManifest(base)).not.toThrow();
    expect(() => assertAppManifest({ ...base, levels: [1] })).toThrow(/levels\[0\]/);
    expect(() => assertAppManifest({ ...base, characters: [""] })).toThrow(/characters\[0\]/);
    expect(() => assertAppManifest({ ...base, kits: ["k"] })).toThrow(/kits\[0\]/);
    expect(() => assertAppManifest({ ...base, kits: [{ id: "k" }] })).toThrow(/kits\[0\]/);
  });
});
