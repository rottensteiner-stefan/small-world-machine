import type { IAssetSource } from "../types.js";
import {
  FileAssetSource,
  stripSharedRoot,
  type FileAssetSourceOptions,
  type FileEntry,
} from "./FileAssetSource.js";

interface DirectoryPickerWindow {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<FileSystemDirectoryHandle>;
}

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
};

/**
 * Picks a local folder: File System Access API where available (Chromium), otherwise a hidden
 * `<input webkitdirectory>` (Safari, Firefox).
 */
export class DirectoryAssetSource {
  public static get hasNativePicker(): boolean {
    return typeof (globalThis as DirectoryPickerWindow).showDirectoryPicker === "function";
  }

  /** Resolves to `undefined` when the user cancels. */
  public static async pick(
    options: FileAssetSourceOptions = {},
  ): Promise<IAssetSource | undefined> {
    const picker = (globalThis as DirectoryPickerWindow).showDirectoryPicker;
    if (picker) {
      try {
        const handle = await picker.call(globalThis, { mode: "read" });
        return DirectoryAssetSource.fromHandle(handle, options);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return undefined;
        throw error;
      }
    }
    return DirectoryAssetSource._pickViaInput(options);
  }

  public static fromFileList(files: FileList, options: FileAssetSourceOptions = {}): IAssetSource {
    const entries: FileEntry[] = Array.from(files).map((file) => ({
      path: file.webkitRelativePath || file.name,
      file,
    }));
    return new FileAssetSource(stripSharedRoot(entries), options);
  }

  public static async fromHandle(
    handle: FileSystemDirectoryHandle,
    options: FileAssetSourceOptions = {},
  ): Promise<IAssetSource> {
    const entries: FileEntry[] = [];
    await DirectoryAssetSource._collect(handle as IterableDirectoryHandle, "", entries);
    return new FileAssetSource(entries, { name: handle.name, ...options });
  }

  private static async _collect(
    dir: IterableDirectoryHandle,
    prefix: string,
    out: FileEntry[],
  ): Promise<void> {
    for await (const child of dir.values()) {
      const path = `${prefix}${child.name}`;
      if (child.kind === "file") {
        out.push({ path, file: await (child as FileSystemFileHandle).getFile() });
      } else {
        await DirectoryAssetSource._collect(child as IterableDirectoryHandle, `${path}/`, out);
      }
    }
  }

  private static _pickViaInput(options: FileAssetSourceOptions): Promise<IAssetSource | undefined> {
    return new Promise((resolve) => {
      const input: HTMLInputElement = document.createElement("input");
      input.type = "file";
      input.setAttribute("webkitdirectory", "");
      input.addEventListener("change", () => {
        const files = input.files;
        resolve(
          files && files.length > 0 ? DirectoryAssetSource.fromFileList(files, options) : undefined,
        );
      });
      input.addEventListener("cancel", () => resolve(undefined));
      input.click();
    });
  }
}
