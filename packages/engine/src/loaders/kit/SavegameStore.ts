/**
 * Savegame storage drivers (OPFS, IndexedDB, File/Memory) implementing ADR 0041 §1 / §7 Stufe 5.
 *
 * Key invariants enforced across all drivers:
 * 1. Format validation & migration on every load/save (`migrateSavegameDescriptor` + `assertSavegameIdReferences`).
 * 2. Backup-vor-Migration (ADR 0041 §15.5): when loading a persisted descriptor whose `schemaVersion`
 *    is older than `SAVEGAME_SCHEMA_VERSION`, the untouched pre-migration copy is persisted to the
 *    backup slot BEFORE the migrated descriptor is returned or saved.
 * 3. No global singletons (`GEMINI.md` §2): all browser storage surfaces (`navigator.storage.getDirectory`,
 *    `indexedDB`) are constructor-injectable for deterministic multi-instance and headless Node testing.
 */
import {
  SAVEGAME_SCHEMA_VERSION,
  assertSavegameIdReferences,
  backupSavegameDescriptor,
  migrateSavegameDescriptor,
  type MigrateSavegameResult,
  type SavegameDescriptor,
  type SavegameStorage,
} from "./SavegameTypes.js";

export interface SavegameStore {
  /** Active storage backend identifier (`"opfs" | "indexeddb" | "file"`). */
  readonly backend: SavegameStorage;
  /**
   * Validates and persists a `SavegameDescriptor`. Stamps `updatedAt` (and `createdAt` if absent)
   * and sets `storage` to match `this.backend`.
   */
  save(savegame: SavegameDescriptor): Promise<void>;
  /**
   * Loads, migrates, and validates the savegame for `id`, or returns `null` if not found.
   * If `raw.schemaVersion < SAVEGAME_SCHEMA_VERSION`, automatically persists the untouched
   * pre-migration backup before returning `MigrateSavegameResult`.
   */
  load(id: string): Promise<MigrateSavegameResult | null>;
  /**
   * Loads the untouched pre-migration backup for `(id, fromSchemaVersion)` if a migration occurred.
   */
  loadBackup(id: string, fromSchemaVersion: number): Promise<SavegameDescriptor | null>;
  /** Deletes a savegame slot by `id` (no-op if absent). */
  delete(id: string): Promise<void>;
  /** Lists all stored savegame IDs in lexicographical order. */
  list(): Promise<string[]>;
  /** Durability barrier awaiting all in-flight writes. */
  flush(): Promise<void>;
  /** Awaits pending writes and releases cached handles/connections. */
  close(): Promise<void>;
}

/**
 * Deterministic pretty-printed JSON serialization for savegame files (ADR 0041 §2: clean diffs).
 */
export function serializeSavegameToFile(savegame: SavegameDescriptor): string {
  const { savegame: validated } = migrateSavegameDescriptor(savegame, {
    context: "SavegameFileExport",
    backup: false,
  });
  assertSavegameIdReferences(validated, "SavegameFileExport");
  return JSON.stringify(validated, null, 2) + "\n";
}

/**
 * Parses, migrates (with Backup-vor-Migration), and validates a JSON savegame string.
 */
export function parseSavegameFromFile(
  jsonText: string,
  context: string = "SavegameFileImport",
): MigrateSavegameResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `[${context}] Invalid savegame JSON: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`[${context}] Invalid savegame payload: expected a JSON object.`);
  }
  const obj = raw as Partial<SavegameDescriptor>;
  if (
    typeof obj.id !== "string" ||
    obj.id.length === 0 ||
    typeof obj.app !== "string" ||
    obj.app.length === 0 ||
    typeof obj.settings !== "object" ||
    obj.settings === null ||
    !Array.isArray(obj.levels)
  ) {
    throw new Error(
      `[${context}] Invalid savegame envelope: expected id, app, settings, and levels[].`,
    );
  }
  const result = migrateSavegameDescriptor(obj as SavegameDescriptor, {
    context,
    backup: true,
  });
  assertSavegameIdReferences(result.savegame, context);
  return result;
}

function prepareDescriptorForSave(
  savegame: SavegameDescriptor,
  backend: SavegameStorage,
  context: string,
): SavegameDescriptor {
  const { savegame: migrated } = migrateSavegameDescriptor(savegame, {
    context,
    backup: false,
  });
  assertSavegameIdReferences(migrated, context);
  const nowIso = new Date().toISOString();
  return {
    ...migrated,
    schemaVersion: SAVEGAME_SCHEMA_VERSION,
    storage: backend,
    createdAt: migrated.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
}

// ── 1. OPFS Driver (`OpfsSavegameStore`) ─────────────────────────────────────────────────────

const OPFS_DIR = "savegames";
const SAVE_EXT = ".save.json";
const BACKUP_INFIX = ".backup.v";
const BACKUP_EXT = ".json";

const OPFS_UNAVAILABLE_MSG =
  "[OpfsSavegameStore] OPFS unavailable: navigator.storage.getDirectory is missing; " +
  "pass an injected getDirectory factory to bypass the environment check";

function encodeSlotFileName(id: string): string {
  return `${encodeURIComponent(id)}${SAVE_EXT}`;
}

function decodeSlotFileName(fileName: string): string | null {
  if (!fileName.endsWith(SAVE_EXT)) return null;
  const encoded = fileName.slice(0, -SAVE_EXT.length);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

function encodeBackupFileName(id: string, fromVersion: number): string {
  return `${encodeURIComponent(id)}${BACKUP_INFIX}${fromVersion}${BACKUP_EXT}`;
}

function isNotFoundError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "name" in e &&
    (e as { name: unknown }).name === "NotFoundError"
  );
}

function isOpfsSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function";
}

function defaultGetDirectory(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

export class OpfsSavegameStore implements SavegameStore {
  public readonly backend: SavegameStorage = "opfs";
  private readonly _getDirectory: () => Promise<FileSystemDirectoryHandle>;
  private _rootPromise: Promise<FileSystemDirectoryHandle> | null = null;
  private _saveDirPromise: Promise<FileSystemDirectoryHandle> | null = null;
  private readonly _pendingWrites: Set<Promise<void>> = new Set();

  constructor(getDirectory?: () => Promise<FileSystemDirectoryHandle>) {
    this._getDirectory = getDirectory ?? defaultGetDirectory;
    if (getDirectory === undefined && !isOpfsSupported()) {
      throw new Error(OPFS_UNAVAILABLE_MSG);
    }
  }

  private _root(): Promise<FileSystemDirectoryHandle> {
    this._rootPromise ??= Promise.resolve().then(() => this._getDirectory());
    return this._rootPromise;
  }

  private _saveDir(): Promise<FileSystemDirectoryHandle> {
    this._saveDirPromise ??= this._root().then((root) =>
      root.getDirectoryHandle(OPFS_DIR, { create: true }),
    );
    return this._saveDirPromise;
  }

  private _trackWrite(write: Promise<void>): Promise<void> {
    this._pendingWrites.add(write);
    void write.then(
      () => {
        this._pendingWrites.delete(write);
      },
      () => {
        this._pendingWrites.delete(write);
      },
    );
    return write;
  }

  private async _writeText(handle: FileSystemFileHandle, text: string): Promise<void> {
    const writable = await handle.createWritable();
    const bytes = new TextEncoder().encode(text);
    await writable.write(bytes.slice().buffer as ArrayBuffer);
    await writable.close();
  }

  public save(savegame: SavegameDescriptor): Promise<void> {
    const prepared = prepareDescriptorForSave(savegame, "opfs", "OpfsSavegameStore");
    const json = serializeSavegameToFile(prepared);
    const fileName = encodeSlotFileName(prepared.id);
    const op = this._saveDir().then(async (dir) => {
      const handle = await dir.getFileHandle(fileName, { create: true });
      await this._writeText(handle, json);
    });
    return this._trackWrite(op);
  }

  public async load(id: string): Promise<MigrateSavegameResult | null> {
    const dir = await this._saveDir();
    const fileName = encodeSlotFileName(id);
    let text: string;
    try {
      const handle = await dir.getFileHandle(fileName, { create: false });
      const file = await handle.getFile();
      text = await file.text();
    } catch (e: unknown) {
      if (isNotFoundError(e)) return null;
      throw e;
    }

    const rawObj = JSON.parse(text) as SavegameDescriptor;
    const rawVersion = rawObj.schemaVersion ?? SAVEGAME_SCHEMA_VERSION;
    const result = parseSavegameFromFile(text, "OpfsSavegameStore");

    if (rawVersion < SAVEGAME_SCHEMA_VERSION && result.backup) {
      const backupName = encodeBackupFileName(id, rawVersion);
      const backupText = JSON.stringify(result.backup, null, 2) + "\n";
      await this._trackWrite(
        (async (): Promise<void> => {
          const backupHandle = await dir.getFileHandle(backupName, { create: true });
          await this._writeText(backupHandle, backupText);
        })(),
      );
    }

    return result;
  }

  public async loadBackup(
    id: string,
    fromSchemaVersion: number,
  ): Promise<SavegameDescriptor | null> {
    const dir = await this._saveDir();
    const backupName = encodeBackupFileName(id, fromSchemaVersion);
    try {
      const handle = await dir.getFileHandle(backupName, { create: false });
      const file = await handle.getFile();
      const text = await file.text();
      return JSON.parse(text) as SavegameDescriptor;
    } catch (e: unknown) {
      if (isNotFoundError(e)) return null;
      throw e;
    }
  }

  public delete(id: string): Promise<void> {
    const fileName = encodeSlotFileName(id);
    const op = this._saveDir().then(async (dir) => {
      try {
        await dir.removeEntry(fileName);
      } catch (e: unknown) {
        if (isNotFoundError(e)) return;
        throw e;
      }
    });
    return this._trackWrite(op);
  }

  public async list(): Promise<string[]> {
    const dir = await this._saveDir();
    const ids: string[] = [];
    const iterable = dir as unknown as {
      entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
      keys?: () => AsyncIterableIterator<string>;
    };
    if (typeof iterable.keys === "function") {
      for await (const name of iterable.keys()) {
        const decoded = decodeSlotFileName(name);
        if (decoded !== null) ids.push(decoded);
      }
    } else if (typeof iterable.entries === "function") {
      for await (const [name] of iterable.entries()) {
        const decoded = decodeSlotFileName(name);
        if (decoded !== null) ids.push(decoded);
      }
    }
    return ids.sort();
  }

  public async flush(): Promise<void> {
    while (this._pendingWrites.size > 0) {
      const snapshot = Array.from(this._pendingWrites);
      await Promise.all(snapshot);
    }
  }

  public async close(): Promise<void> {
    const rootPromise = this._rootPromise;
    try {
      await this.flush();
      if (rootPromise !== null) {
        await rootPromise;
      }
    } finally {
      this._saveDirPromise = null;
      this._rootPromise = null;
    }
  }
}

// ── 2. IndexedDB Driver (`IndexedDbSavegameStore`) ───────────────────────────────────────────

const DEFAULT_IDB_NAME = "small-world-machine-savegames";
const IDB_VERSION = 1;
const STORE_SAVES = "savegames";
const STORE_BACKUPS = "savegame-backups";

function backupKeyOf(id: string, fromVersion: number): string {
  return `${id}@v${fromVersion}`;
}

export class IndexedDbSavegameStore implements SavegameStore {
  public readonly backend: SavegameStorage = "indexeddb";
  private _dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly _idbFactory: IDBFactory = globalThis.indexedDB,
    private readonly _dbName: string = DEFAULT_IDB_NAME,
  ) {
    if (!this._idbFactory) {
      throw new Error("[IndexedDbSavegameStore] indexedDB is not available in this context");
    }
  }

  private _open(): Promise<IDBDatabase> {
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this._idbFactory.open(this._dbName, IDB_VERSION);
      request.onupgradeneeded = (): void => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_SAVES)) db.createObjectStore(STORE_SAVES);
        if (!db.objectStoreNames.contains(STORE_BACKUPS)) db.createObjectStore(STORE_BACKUPS);
      };
      request.onsuccess = (): void => resolve(request.result);
      request.onerror = (): void => reject(request.error ?? new Error("open failed"));
    });
    return this._dbPromise;
  }

  private _transaction(
    mode: IDBTransactionMode,
    stores: readonly string[],
    body: (tx: IDBTransaction) => void,
  ): Promise<void> {
    return this._open().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(stores as string[], mode);
          body(tx);
          tx.oncomplete = (): void => resolve();
          tx.onabort = (): void => reject(tx.error ?? new Error("transaction aborted"));
          tx.onerror = (): void => reject(tx.error ?? new Error("transaction error"));
        }),
    );
  }

  private _read(storeName: string, key: IDBValidKey): Promise<unknown> {
    return this._open().then(
      (db) =>
        new Promise<unknown>((resolve, reject) => {
          const tx = db.transaction([storeName], "readonly");
          const request = tx.objectStore(storeName).get(key);
          request.onsuccess = (): void => resolve(request.result);
          request.onerror = (): void => reject(request.error ?? new Error("read failed"));
        }),
    );
  }

  public async save(savegame: SavegameDescriptor): Promise<void> {
    const prepared = prepareDescriptorForSave(savegame, "indexeddb", "IndexedDbSavegameStore");
    const cloned = backupSavegameDescriptor(prepared);
    await this._transaction("readwrite", [STORE_SAVES], (tx) => {
      tx.objectStore(STORE_SAVES).put(cloned, prepared.id);
    });
  }

  public async load(id: string): Promise<MigrateSavegameResult | null> {
    const value = await this._read(STORE_SAVES, id);
    if (value === undefined || value === null) return null;
    const raw = value as SavegameDescriptor;
    const rawVersion = raw.schemaVersion ?? SAVEGAME_SCHEMA_VERSION;
    const result = migrateSavegameDescriptor(raw, {
      context: "IndexedDbSavegameStore",
      backup: true,
    });
    assertSavegameIdReferences(result.savegame, "IndexedDbSavegameStore");

    if (rawVersion < SAVEGAME_SCHEMA_VERSION && result.backup) {
      const backupCopy = backupSavegameDescriptor(result.backup);
      await this._transaction("readwrite", [STORE_BACKUPS], (tx) => {
        tx.objectStore(STORE_BACKUPS).put(backupCopy, backupKeyOf(id, rawVersion));
      });
    }

    return result;
  }

  public async loadBackup(
    id: string,
    fromSchemaVersion: number,
  ): Promise<SavegameDescriptor | null> {
    const value = await this._read(STORE_BACKUPS, backupKeyOf(id, fromSchemaVersion));
    if (value === undefined || value === null) return null;
    return backupSavegameDescriptor(value as SavegameDescriptor);
  }

  public async delete(id: string): Promise<void> {
    await this._transaction("readwrite", [STORE_SAVES], (tx) => {
      tx.objectStore(STORE_SAVES).delete(id);
    });
  }

  public async list(): Promise<string[]> {
    const db = await this._open();
    return new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction([STORE_SAVES], "readonly");
      const store = tx.objectStore(STORE_SAVES);
      const req = store.getAllKeys();
      req.onsuccess = (): void => {
        const keys = (req.result ?? []).map((k) => String(k)).sort();
        resolve(keys);
      };
      req.onerror = (): void => reject(req.error ?? new Error("getAllKeys failed"));
    });
  }

  public async flush(): Promise<void> {
    void this._dbPromise;
  }

  public async close(): Promise<void> {
    const pending = this._dbPromise;
    this._dbPromise = null;
    if (!pending) return;
    try {
      const db = await pending;
      db.close();
    } catch {
      // Opening failed; nothing to close.
    }
  }
}

// ── 3. File / In-Memory Driver (`FileSavegameStore`) ─────────────────────────────────────────

export class FileSavegameStore implements SavegameStore {
  public readonly backend: SavegameStorage = "file";
  private readonly _slots = new Map<string, string>();
  private readonly _backups = new Map<string, string>();

  public async save(savegame: SavegameDescriptor): Promise<void> {
    const prepared = prepareDescriptorForSave(savegame, "file", "FileSavegameStore");
    this._slots.set(prepared.id, serializeSavegameToFile(prepared));
  }

  /**
   * Seeds raw JSON directly (useful when importing a legacy v1 file before migration runs on `load`).
   */
  public importRawJson(id: string, jsonText: string): void {
    this._slots.set(id, jsonText);
  }

  /**
   * Exports a stored slot as deterministic pretty-printed JSON text, or `null` if not found.
   */
  public exportSlotToJson(id: string): string | null {
    return this._slots.get(id) ?? null;
  }

  public async load(id: string): Promise<MigrateSavegameResult | null> {
    const jsonText = this._slots.get(id);
    if (jsonText === undefined) return null;
    const rawObj = JSON.parse(jsonText) as SavegameDescriptor;
    const rawVersion = rawObj.schemaVersion ?? SAVEGAME_SCHEMA_VERSION;
    const result = parseSavegameFromFile(jsonText, "FileSavegameStore");
    if (rawVersion < SAVEGAME_SCHEMA_VERSION && result.backup) {
      this._backups.set(backupKeyOf(id, rawVersion), JSON.stringify(result.backup, null, 2) + "\n");
    }
    return result;
  }

  public async loadBackup(
    id: string,
    fromSchemaVersion: number,
  ): Promise<SavegameDescriptor | null> {
    const text = this._backups.get(backupKeyOf(id, fromSchemaVersion));
    if (text === undefined) return null;
    return JSON.parse(text) as SavegameDescriptor;
  }

  public async delete(id: string): Promise<void> {
    this._slots.delete(id);
  }

  public async list(): Promise<string[]> {
    return Array.from(this._slots.keys()).sort();
  }

  public async flush(): Promise<void> {}

  public async close(): Promise<void> {}
}

// ── 4. Auto-Selection Factory (`createSavegameStore`) ────────────────────────────────────────

export interface CreateSavegameStoreOptions {
  /** Preferred backend order; defaults to `["opfs", "indexeddb", "file"]` (ADR 0041 §1). */
  prefer?: readonly SavegameStorage[];
  /** Optional injected OPFS directory factory (for testing or custom sandboxes). */
  getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  /** Optional injected IndexedDB factory. */
  idbFactory?: IDBFactory;
  /** Optional IndexedDB database name override. */
  dbName?: string;
}

/**
 * Selects the highest-priority available `SavegameStore` driver (`OPFS -> IndexedDB -> File`).
 */
export function createSavegameStore(options: CreateSavegameStoreOptions = {}): SavegameStore {
  const order = options.prefer ?? ["opfs", "indexeddb", "file"];
  for (const candidate of order) {
    if (candidate === "opfs") {
      try {
        return new OpfsSavegameStore(options.getDirectory);
      } catch {
        continue;
      }
    }
    if (candidate === "indexeddb") {
      try {
        return new IndexedDbSavegameStore(options.idbFactory, options.dbName);
      } catch {
        continue;
      }
    }
    if (candidate === "file") {
      return new FileSavegameStore();
    }
  }
  return new FileSavegameStore();
}
