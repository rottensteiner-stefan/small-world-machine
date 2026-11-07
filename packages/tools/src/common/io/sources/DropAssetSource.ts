import type { IAssetSource } from "../types.js";
import { SecurityValidator } from "../Security.js";
import {
  FileAssetSource,
  stripSharedRoot,
  type FileAssetSourceOptions,
  type FileEntry,
} from "./FileAssetSource.js";
import { ZipAssetSource } from "./ZipAssetSource.js";

/** Turns a drag-and-drop payload (files, folders or a single ZIP) into an `IAssetSource`. */
export class DropAssetSource {
  public static hasFiles(dataTransfer: DataTransfer): boolean {
    return Array.from(dataTransfer.types).includes("Files");
  }

  /** Resolves to `undefined` when the drop carries no files. */
  public static async fromDataTransfer(
    dataTransfer: DataTransfer,
    options: FileAssetSourceOptions = {},
  ): Promise<IAssetSource | undefined> {
    // Entries must be taken synchronously: the DataTransfer is cleared after the event handler returns.
    const items = Array.from(dataTransfer.items).filter((item) => item.kind === "file");
    const entries = items.map((item) => item.webkitGetAsEntry());
    const looseFiles = items.map((item) => item.getAsFile());

    const collected: FileEntry[] = [];
    for (const [index, entry] of entries.entries()) {
      if (entry) {
        await DropAssetSource._collect(entry, "", collected);
        continue;
      }
      const file = looseFiles[index];
      if (file) collected.push({ path: file.name, file });
    }
    if (collected.length === 0) return undefined;

    const single = collected.length === 1 ? collected[0] : undefined;
    if (single && single.path.toLowerCase().endsWith(".zip")) {
      const security = options.security ?? new SecurityValidator();
      security.validateSize(single.file.size);
      return ZipAssetSource.fromBuffer(single.file, { name: single.file.name, ...options });
    }
    return new FileAssetSource(stripSharedRoot(collected), options);
  }

  private static async _collect(
    entry: FileSystemEntry,
    prefix: string,
    out: FileEntry[],
  ): Promise<void> {
    const path = `${prefix}${entry.name}`;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      });
      out.push({ path, file });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns at most ~100 entries per call; loop until it returns an empty batch.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      if (batch.length === 0) return;
      for (const child of batch) {
        await DropAssetSource._collect(child, `${path}/`, out);
      }
    }
  }
}
