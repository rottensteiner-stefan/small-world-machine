import { Object3D, WorldWriter, GltfLoader, GltfData } from "@small-world-machine/engine";

const AUTOSAVE_DEBOUNCE_MS = 500;
const SCENE_FILE_NAME = "scene.gltf";
/** Editor helpers (gizmos, highlights, zone previews, grid) that `scene.gltf` files written before
 * the editor-only exclusion still contain at the top level. */
const LEGACY_EDITOR_NODE =
  /^(MakerGizmo|MakerLightGizmos|MakerStageZoneGizmos|EditorGrid|MakerTrash|Helper_|Range_|Cone_|ZoneOutline_|ZoneFill_|ZoneHandle_)/;
const PREFABS_DIR_NAME = "prefabs";
const PREFAB_EXT = ".gltf";
/** Sidecar file holding `{ dataUrl }` next to a prefab's `.gltf` -- a small JSON wrapper rather
 * than a raw `.png`, since `FileSystemWritableFileStreamLike.write()` (this class's own
 * abstraction, kept narrow for testability) only supports string content, and a `data:` URL
 * already IS a string. */
const PREFAB_THUMB_EXT = ".thumb.json";

/** The narrow slice of the real (browser-only) `FileSystemDirectoryHandle`/`FileSystemFileHandle`/
 * `FileSystemWritableFileStream` this class actually calls -- kept as our own interfaces so
 * tests can inject a plain in-memory fake instead of needing a real browser environment. */
export interface FileSystemDirectoryHandleLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandleLike>;
  /** Optional: only needed for the prefabs subfolder -- omitted by fakes that don't test that
   * path (e.g. the plain scene-autosave tests). */
  getDirectoryHandle?(
    name: string,
    options?: { create?: boolean },
  ): Promise<FileSystemDirectoryHandleLike>;
  /** Optional: mirrors the real API's async directory listing, used only to enumerate prefabs. */
  entries?(): AsyncIterable<[string, unknown]>;
}
export interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
  getFile(): Promise<{ text(): Promise<string> }>;
}
export interface FileSystemWritableFileStreamLike {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Binds Maker to a real project folder on disk via the File System Access API and keeps it
 * autosaved -- see docs/adr/0010-maker-editor-architecture.md's "no explicit Save button" UX
 * decision: every edit calls `scheduleAutosave()`, which debounces so a burst of edits (a
 * slider drag, several undo steps) becomes a single write, not one per change.
 */
export class ProjectBinding {
  private _directory: FileSystemDirectoryHandleLike | undefined;
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private _dirtyListener: ((dirty: boolean) => void) | undefined;
  /** Top-level scene children that are editor-only (e.g. the decal stamp ghost) and must not end up in `scene.gltf`. */
  public excludeFromSave: (obj: Object3D) => boolean = () => false;

  public get isBound(): boolean {
    return undefined !== this._directory;
  }

  public onDirtyChange(cb: (dirty: boolean) => void): void {
    this._dirtyListener = cb;
  }

  /** Directly injects an already-obtained directory handle -- the real entry point for tests;
   * `bind()` is the real entry point for the browser's native picker. */
  public bindTo(directory: FileSystemDirectoryHandleLike): void {
    this._directory = directory;
  }

  /** Prompts the user to pick a project folder via the browser's native directory picker.
   * @returns false if the browser doesn't support the API, or the user cancelled the picker. */
  public async bind(): Promise<boolean> {
    const picker = (
      globalThis as unknown as {
        showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>;
      }
    ).showDirectoryPicker;
    if (!picker) return false;
    try {
      this._directory = await picker();
      return true;
    } catch {
      return false; // User cancelled the picker -- not an error worth surfacing.
    }
  }

  /** Loads `scene.gltf` from the bound project folder, if present.
   * @returns undefined if unbound, or the file doesn't exist yet (a brand-new project). */
  public async load(): Promise<Object3D | undefined> {
    if (!this._directory) return undefined;
    let fileHandle: FileSystemFileHandleLike;
    try {
      fileHandle = await this._directory.getFileHandle(SCENE_FILE_NAME);
    } catch {
      return undefined;
    }
    const file = await fileHandle.getFile();
    const json = JSON.parse(await file.text()) as GltfData["json"];
    const loader = new GltfLoader();
    const root = await loader.parse({ json, buffers: ProjectBinding._decodeBuffers(json) }, "");
    root.children = root.children.filter((child) => !LEGACY_EDITOR_NODE.test(child.name));
    return root;
  }

  /** `WorldWriter` embeds every buffer as a `data:` URI (see its own doc comment on why) -- a
   * `.gltf` document `parse()`s from a real file also needs those decoded into `ArrayBuffer`s
   * first, exactly like `GltfLoader.load()` itself does internally for a plain file fetch. Was
   * previously always called with `buffers: []`, silently dropping every mesh on reload -- only
   * surfaced once Phase 2's prefab instantiate actually rendered a round-tripped mesh. */
  private static _decodeBuffers(json: unknown): ArrayBuffer[] {
    const buffers = (json as { buffers?: { uri?: string }[] }).buffers ?? [];
    return buffers.map((buf) => (buf.uri ? GltfLoader.decodeDataUri(buf.uri) : new ArrayBuffer(0)));
  }

  /** Marks the document dirty and (re-)schedules a debounced write; call after any edit.
   * A no-op while unbound (nothing to write to yet). */
  public scheduleAutosave(getRoot: () => Object3D): void {
    if (!this._directory) return;
    this._dirtyListener?.(true);
    if (undefined !== this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      void this._save(getRoot());
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  /** Serializes `root` with the excluded direct children temporarily taken out of its child list
   * (synchronously, so nothing can observe the gap). */
  private _writeWithout(root: Object3D): ReturnType<WorldWriter["write"]> {
    const kept = root.children.filter((child) => !this.excludeFromSave(child));
    if (kept.length === root.children.length) return new WorldWriter().write(root);
    const all = root.children;
    root.children = kept;
    try {
      return new WorldWriter().write(root);
    } finally {
      root.children = all;
    }
  }

  private async _save(root: Object3D): Promise<void> {
    if (!this._directory) return;
    const doc = this._writeWithout(root);
    const fileHandle = await this._directory.getFileHandle(SCENE_FILE_NAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(doc, null, 2));
    await writable.close();
    this._dirtyListener?.(false);
  }

  /** Writes `root` (typically a single selected object, possibly with children) as a standalone
   * prefab asset under `prefabs/<name>.gltf` in the bound project folder -- see ADR 0010's Phase 2
   * "stamped copies" decision: this is just an independent glTF file, not a live-linked
   * definition. @returns false if unbound or the browser handle doesn't support subfolders. */
  public async savePrefab(name: string, root: Object3D): Promise<boolean> {
    if (!this._directory?.getDirectoryHandle) return false;
    const prefabsDir = await this._directory.getDirectoryHandle(PREFABS_DIR_NAME, {
      create: true,
    });
    const doc = new WorldWriter().writeSingle(root);
    const fileHandle = await prefabsDir.getFileHandle(`${name}${PREFAB_EXT}`, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(doc, null, 2));
    await writable.close();
    return true;
  }

  /** Loads a prefab previously written by `savePrefab()`, as a fresh, independent `Object3D`
   * subtree -- calling this again for the same name yields another independent copy, which is
   * exactly the "stamped copy" instancing model. @returns undefined if unbound, unsupported, or
   * the named prefab doesn't exist. */
  public async loadPrefab(name: string): Promise<Object3D | undefined> {
    if (!this._directory?.getDirectoryHandle) return undefined;
    let prefabsDir: FileSystemDirectoryHandleLike;
    try {
      prefabsDir = await this._directory.getDirectoryHandle(PREFABS_DIR_NAME);
    } catch {
      return undefined;
    }
    let fileHandle: FileSystemFileHandleLike;
    try {
      fileHandle = await prefabsDir.getFileHandle(`${name}${PREFAB_EXT}`);
    } catch {
      return undefined;
    }
    const file = await fileHandle.getFile();
    const json = JSON.parse(await file.text()) as GltfData["json"];
    const loader = new GltfLoader();
    // `writeSingle()` wrote the original selected object as the document's one top-level node,
    // so the synthetic "glTF_Root" wrapper `parse()` returns has exactly that one child --
    // tagging *it* (not the throwaway wrapper) is what actually reaches the scene once
    // `MakerApp` adds this child in.
    const wrapper = await loader.parse({ json, buffers: ProjectBinding._decodeBuffers(json) }, "");
    const instance = wrapper.children[0];
    if (instance) instance.prefabSource = name;
    return instance;
  }

  /** Saves a PNG thumbnail (as a `data:image/png;base64,...` URL, e.g. from
   * `HTMLCanvasElement.toDataURL()`) alongside a prefab -- overwrites any previous thumbnail for
   * the same name. Silently does nothing if unbound or subfolders are unsupported, same as
   * `savePrefab()`; a missing thumbnail is a cosmetic gap, not an error worth surfacing. */
  public async savePrefabThumbnail(name: string, dataUrl: string): Promise<void> {
    if (!this._directory?.getDirectoryHandle) return;
    const prefabsDir = await this._directory.getDirectoryHandle(PREFABS_DIR_NAME, {
      create: true,
    });
    const fileHandle = await prefabsDir.getFileHandle(`${name}${PREFAB_THUMB_EXT}`, {
      create: true,
    });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify({ dataUrl }));
    await writable.close();
  }

  /** Loads a prefab's thumbnail data URL, if one was ever saved. @returns undefined if unbound,
   * unsupported, or no thumbnail exists for this name -- callers should render a plain
   * text-only entry in that case, not treat it as an error. */
  public async loadPrefabThumbnail(name: string): Promise<string | undefined> {
    if (!this._directory?.getDirectoryHandle) return undefined;
    let prefabsDir: FileSystemDirectoryHandleLike;
    try {
      prefabsDir = await this._directory.getDirectoryHandle(PREFABS_DIR_NAME);
    } catch {
      return undefined;
    }
    let fileHandle: FileSystemFileHandleLike;
    try {
      fileHandle = await prefabsDir.getFileHandle(`${name}${PREFAB_THUMB_EXT}`);
    } catch {
      return undefined;
    }
    const file = await fileHandle.getFile();
    const json = JSON.parse(await file.text()) as { dataUrl?: string };
    return json.dataUrl;
  }

  /** Lists the names (without extension) of every prefab in `prefabs/`, or `[]` if unbound,
   * unsupported, or the folder doesn't exist yet. */
  public async listPrefabs(): Promise<string[]> {
    if (!this._directory?.getDirectoryHandle) return [];
    let prefabsDir: FileSystemDirectoryHandleLike;
    try {
      prefabsDir = await this._directory.getDirectoryHandle(PREFABS_DIR_NAME);
    } catch {
      return [];
    }
    if (!prefabsDir.entries) return [];
    const names: string[] = [];
    for await (const [entryName] of prefabsDir.entries()) {
      if (entryName.endsWith(PREFAB_EXT)) names.push(entryName.slice(0, -PREFAB_EXT.length));
    }
    return names;
  }
}
