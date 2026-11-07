import type { IAssetSource } from "../types.js";
import { SecurityValidator } from "../Security.js";
import { globToRegExp } from "../globPattern.js";

export interface FileAssetSourceOptions {
  id?: string;
  name?: string;
  security?: SecurityValidator;
}

export interface FileEntry {
  path: string;
  file: File;
}

/**
 * Lazy read-only view onto browser `File` objects (dropped or picked folders). Contents are only
 * read on demand, so opening a large folder does not copy it into memory up front. The size limit
 * therefore applies per file at read time: a folder may hold work files (e.g. FBX sources) that
 * exceed it as long as nothing actually reads them.
 */
export class FileAssetSource implements IAssetSource {
  public readonly id: string;
  public readonly name: string;
  private readonly _files = new Map<string, File>();
  private readonly _security: SecurityValidator;

  constructor(entries: Iterable<FileEntry>, options: FileAssetSourceOptions = {}) {
    this.id = options.id ?? `files-${Math.random().toString(36).substring(2, 9)}`;
    this.name = options.name ?? "Local Files";
    this._security = options.security ?? new SecurityValidator();

    for (const { path, file } of entries) {
      if (!this._security.validatePath(path).valid) {
        console.warn(`[FileAssetSource] Skipping unsafe path '${path}'`);
        continue;
      }
      const cleanPath = this._security.sanitizePath(path);
      if (!cleanPath) continue;
      this._files.set(cleanPath, file);
    }
  }

  public async list(pattern?: string): Promise<string[]> {
    const all = Array.from(this._files.keys());
    if (!pattern) return all;
    const regex = globToRegExp(pattern);
    return all.filter((p) => regex.test(p));
  }

  public async has(path: string): Promise<boolean> {
    return this._files.has(this._security.sanitizePath(path));
  }

  public async read(path: string): Promise<Uint8Array> {
    const cleanPath = this._security.sanitizePath(path);
    const file = this._files.get(cleanPath);
    if (!file) {
      throw new Error(`[FileAssetSource] File not found: ${cleanPath}`);
    }
    this._assertReadable(cleanPath, file);
    return new Uint8Array(await file.arrayBuffer());
  }

  public async readText(path: string): Promise<string> {
    return new TextDecoder("utf-8").decode(await this.read(path));
  }

  public async readJson<T = unknown>(path: string): Promise<T> {
    return JSON.parse(await this.readText(path)) as T;
  }

  public toFetch(mountPrefix?: string): (url: string, init?: RequestInit) => Promise<Response> {
    const prefix = mountPrefix ?? `sw-asset://${this.id}/`;
    return async (url: string, init?: RequestInit): Promise<Response> => {
      if (!url.startsWith(prefix)) {
        return fetch(url, init);
      }
      const cleanPath = this._security.sanitizePath(url.substring(prefix.length));
      const file = this._files.get(cleanPath);
      if (!file) {
        return new Response(`[FileAssetSource] Asset '${cleanPath}' not found`, {
          status: 404,
          statusText: "Not Found",
        });
      }
      if (file.size > this._security.maxFileBytes) {
        return new Response(`[FileAssetSource] Asset '${cleanPath}' exceeds the file size limit`, {
          status: 413,
          statusText: "Payload Too Large",
        });
      }
      return new Response(file, {
        status: 200,
        statusText: "OK",
        headers: {
          "Content-Type": SecurityValidator.getMimeType(cleanPath),
          "Content-Length": String(file.size),
        },
      });
    };
  }

  private _assertReadable(path: string, file: File): void {
    try {
      this._security.validateSize(file.size);
    } catch (error) {
      throw new Error(`${(error as Error).message} ('${path}')`, { cause: error });
    }
  }

  public dispose(): void {
    this._files.clear();
  }
}

/**
 * Strips a single shared top-level folder (`bunker/kit.json` -> `kit.json`), so that opening or
 * dropping a folder behaves like opening its contents.
 */
export function stripSharedRoot(entries: FileEntry[]): FileEntry[] {
  const first = entries[0];
  if (!first) return entries;
  const root = first.path.split("/")[0];
  const hasSharedRoot = entries.every((e) => e.path.includes("/") && e.path.split("/")[0] === root);
  if (!hasSharedRoot) return entries;
  return entries.map((e) => ({ path: e.path.substring((root?.length ?? 0) + 1), file: e.file }));
}
