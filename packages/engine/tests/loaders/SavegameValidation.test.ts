import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import {
  SAVEGAME_MIGRATIONS,
  SAVEGAME_SCHEMA_VERSION,
  assertSavegameIdReferences,
  backupSavegameDescriptor,
  migrateSavegameDescriptor,
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
});
