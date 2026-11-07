import type { IAssetSink } from "../types.js";
import { SecurityValidator } from "../Security.js";

interface DirectoryPickerWindow {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<FileSystemDirectoryHandle>;
}

export interface DirectoryAssetSinkOptions {
  id?: string;
  security?: SecurityValidator;
}

/**
 * Writes files straight into a user-chosen folder (File System Access API). Where the API is
 * missing (Safari, Firefox), callers fall back to `ZipAssetSink` + `downloadBlob`.
 */
export class DirectoryAssetSink implements IAssetSink {
  public readonly id: string;
  private readonly _root: FileSystemDirectoryHandle;
  private readonly _security: SecurityValidator;

  constructor(root: FileSystemDirectoryHandle, options: DirectoryAssetSinkOptions = {}) {
    this.id = options.id ?? `dirsink-${Math.random().toString(36).substring(2, 9)}`;
    this._root = root;
    this._security = options.security ?? new SecurityValidator();
  }

  public static get isSupported(): boolean {
    return typeof (globalThis as DirectoryPickerWindow).showDirectoryPicker === "function";
  }

  /** Resolves to `undefined` when the user cancels. */
  public static async pick(
    options: DirectoryAssetSinkOptions = {},
  ): Promise<DirectoryAssetSink | undefined> {
    const picker = (globalThis as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      throw new Error(
        "[DirectoryAssetSink] File System Access API is not available in this browser.",
      );
    }
    try {
      return new DirectoryAssetSink(await picker.call(globalThis, { mode: "readwrite" }), options);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return undefined;
      throw error;
    }
  }

  public async write(path: string, data: Uint8Array | string): Promise<void> {
    const cleanPath = this._security.sanitizePath(path);
    if (!cleanPath) return;

    const segments = cleanPath.split("/");
    const filename = segments.pop() as string;
    let dir = this._root;
    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment, { create: true });
    }

    const fileHandle = await dir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(typeof data === "string" ? data : (data.slice().buffer as ArrayBuffer));
    } finally {
      await writable.close();
    }
  }

  public async finalize(): Promise<void> {
    // Every write is already flushed on close(); nothing is buffered.
  }
}
