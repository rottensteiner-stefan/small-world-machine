/**
 * Savegame descriptor types, schema-version policy and migration chain (ADR 0041 Stufe 5).
 *
 * A savegame is an extension of the level-descriptor context (ADR 0020): it stores runtime state
 * that REFERENCES concrete levels/instances by stable ids — patch actions and minimal state flags,
 * never copies of content objects (props/lights are not serialized).
 */

export const SAVEGAME_SCHEMA_VERSION = 1;

export type SavegameMigrationStep = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Sequential migration chain `(fromVersion -> step returning fromVersion + 1)` for
 * `SavegameDescriptor` (ADR 0041 §4 / §7 Stufe 5). Empty at `schemaVersion = 1`.
 */
export const SAVEGAME_MIGRATIONS: ReadonlyMap<number, SavegameMigrationStep> = new Map();

/** Storage hint carried by the format (ADR 0041 §1): IndexedDB/OPFS are standard, file export optional. */
export type SavegameStorage = "indexeddb" | "opfs" | "file";

/** Patch action verbs applied at the instance branch (ADR 0041 §6 — no whole-object replacements). */
export type SavegamePatchOp = "set" | "add" | "remove" | "toggle";

/**
 * One instance-branch override (Roblox-/Content-Patcher pattern, ADR 0041 §6). `target` is either a
 * declared level/instance id from `SavegameDescriptor.levels[]` or a stable `namespace:path` id
 * (ADR 0041 §2). Unknown fields written by newer engines are preserved on load (ADR 0041 §4).
 */
export interface SavegamePatchAction {
  op: SavegamePatchOp;
  target: string;
  path?: string;
  value?: unknown;
  /** Forward tolerance (ADR 0041 §4): fields newer engines add must never break older loaders. */
  [key: string]: unknown;
}

/**
 * Minimal per-level/instance state: primitive flags plus patch actions — never content (ADR 0041 §1).
 */
export interface SavegameLevelState {
  id: string;
  flags?: Record<string, boolean | number | string | null>;
  patches?: SavegamePatchAction[];
}

/**
 * User settings. `language` is format-defined; unknown keys are tolerated so newer engines may add
 * preferences without breaking older loaders (forward tolerance, ADR 0041 §4). Language is a
 * setting, not content (ADR 0041 §1/§3).
 */
export interface SavegameSettings {
  language?: string;
  [key: string]: unknown;
}

export interface SavegameDescriptor {
  $schema?: string;
  /** Stable savegame id in namespace:path form, e.g. `the-whisper:slot-01`. */
  id: string;
  /** App namespace this savegame belongs to (the app's stable id from app.json, ADR 0041 §2). */
  app: string;
  /** Format version of the savegame descriptor (`public/schemas/savegame.schema.json`, ADR 0041). */
  schemaVersion?: number;
  storage: SavegameStorage;
  createdAt?: string;
  updatedAt?: string;
  settings: SavegameSettings;
  /** Runtime state per referenced level/instance (stable ids, flags, patches). */
  levels: SavegameLevelState[];
}

/**
 * Backup-vor-Migration (ADR 0041 §15.5, Pflicht). Returns an untouched, JSON-compatible deep copy
 * of the savegame exactly as persisted, before any migration runs — the original bytes stay
 * restorable even if a migration step is wrong. No driver: purely in-memory.
 */
export function backupSavegameDescriptor(savegame: SavegameDescriptor): SavegameDescriptor {
  return JSON.parse(JSON.stringify(savegame)) as SavegameDescriptor;
}

export interface MigrateSavegameOptions {
  /** Context used as the `[Context]` prefix in fail-fast error messages (mirrors `migrateLevelDescriptor`). */
  context?: string;
  /**
   * Backup-vor-Migration is the DEFAULT (ADR 0041 §15.5). Set `false` only when the caller manages
   * its own backup or migrates a transient in-memory descriptor that was never persisted.
   */
  backup?: boolean;
}

export interface MigrateSavegameResult {
  /** Descriptor migrated to `SAVEGAME_SCHEMA_VERSION`. */
  savegame: SavegameDescriptor;
  /** Untouched JSON-compatible copy taken before migration; present unless `backup: false`. */
  backup?: SavegameDescriptor;
}

/**
 * Validates and migrates a `SavegameDescriptor` to `SAVEGAME_SCHEMA_VERSION` along
 * `SAVEGAME_MIGRATIONS`. Unversioned descriptors in memory (`schemaVersion === undefined`) default
 * to version 1; unknown or future `schemaVersion` values fail fast (ADR 0041 §4). Backup-vor-
 * Migration is the default (§15.5). The input object is never mutated.
 */
export function migrateSavegameDescriptor(
  savegame: SavegameDescriptor,
  options: MigrateSavegameOptions = {},
): MigrateSavegameResult {
  const context = options.context ?? "SavegameMigration";
  const backup = options.backup !== false ? backupSavegameDescriptor(savegame) : undefined;
  const rawVersion = savegame.schemaVersion ?? SAVEGAME_SCHEMA_VERSION;
  if (
    typeof rawVersion !== "number" ||
    !Number.isInteger(rawVersion) ||
    rawVersion < 1 ||
    rawVersion > SAVEGAME_SCHEMA_VERSION
  ) {
    throw new Error(
      `[${context}] Unsupported savegame schemaVersion '${String(savegame.schemaVersion)}' in savegame '${savegame.id || "<unknown>"}' (supported: 1..${SAVEGAME_SCHEMA_VERSION}).`,
    );
  }
  let currentVersion = rawVersion;
  let current: Record<string, unknown> = { ...savegame, schemaVersion: currentVersion };
  while (currentVersion < SAVEGAME_SCHEMA_VERSION) {
    const step = SAVEGAME_MIGRATIONS.get(currentVersion);
    if (!step) {
      throw new Error(
        `[${context}] Missing savegame migration step from schemaVersion ${currentVersion} in savegame '${savegame.id || "<unknown>"}'.`,
      );
    }
    current = step(current);
    currentVersion += 1;
    current["schemaVersion"] = currentVersion;
  }
  const migrated = current as unknown as SavegameDescriptor;
  const result: MigrateSavegameResult = { savegame: migrated };
  if (backup !== undefined) {
    result.backup = backup;
  }
  return result;
}

/** A stable content id: `namespace/path` (repo kit ids, e.g. `flakturm/bunker_blast_door`) or `namespace:path` (ADR 0041 §2 notation). */
const STABLE_NAMESPACED_ID_PATTERN = /^[a-z][a-z0-9_-]*[/:][a-zA-Z0-9._/-]+$/u;

/**
 * Harte Regel (ADR 0041 §1 / §15.5, Pflicht): every patch action target must resolve to a declared
 * level/instance id from its `levels[]` entry or to a stable `namespace:path` id. Loaders MUST call
 * this after migration — a target that traces to neither breaks "IDs werden nie wiederverwendet".
 */
export function assertSavegameIdReferences(
  savegame: SavegameDescriptor,
  context: string = "SavegameMigration",
): void {
  const declared = new Set(savegame.levels.map((level) => level.id));
  for (const level of savegame.levels) {
    for (const patch of level.patches ?? []) {
      if (declared.has(patch.target) || STABLE_NAMESPACED_ID_PATTERN.test(patch.target)) {
        continue;
      }
      const declaredList = [...declared].join(", ");
      throw new Error(
        `[${context}] Savegame '${savegame.id}': patch action target '${patch.target}' is neither a declared level/instance id (${declaredList || "none"}) nor a stable namespace:path id.`,
      );
    }
  }
}
