import type { IAssetSource } from "../types.js";
import { SecurityValidator } from "../Security.js";
import { safeUnzip } from "../safeUnzip.js";
import { globToRegExp } from "../globPattern.js";

export interface ZipAssetSourceOptions {
  id?: string;
  name?: string;
  security?: SecurityValidator;
}

/**
 * In-Memory ZIP asset source. Decompresses ZIP packages via fflate, applies Zip-Slip
 * validation, and serves files directly or via virtual fetch responses.
 */
export class ZipAssetSource implements IAssetSource {
  public readonly id: string;
  public readonly name: string;
  private readonly _files = new Map<string, Uint8Array>();
  private readonly _security: SecurityValidator;

  constructor(options: ZipAssetSourceOptions = {}) {
    this.id = options.id ?? `zip-${Math.random().toString(36).substring(2, 9)}`;
    this.name = options.name ?? "ZIP Archive";
    this._security = options.security ?? new SecurityValidator();
  }

  /**
   * Creates a ZipAssetSource from raw bytes (Uint8Array, ArrayBuffer, or Blob).
   */
  public static async fromBuffer(
    buffer: Uint8Array | ArrayBuffer | Blob,
    options: ZipAssetSourceOptions = {},
  ): Promise<ZipAssetSource> {
    const source = new ZipAssetSource(options);
    let bytes: Uint8Array;

    if (buffer instanceof Blob) {
      const arr = await buffer.arrayBuffer();
      bytes = new Uint8Array(arr);
    } else if (buffer instanceof ArrayBuffer) {
      bytes = new Uint8Array(buffer);
    } else {
      bytes = buffer;
    }

    await source._loadZipData(bytes);
    return source;
  }

  public static async fromBytes(
    bytes: Uint8Array | ArrayBuffer | Blob,
    options: ZipAssetSourceOptions = {},
  ): Promise<ZipAssetSource> {
    return ZipAssetSource.fromBuffer(bytes, options);
  }

  /** Builds a source from entries that were already unpacked and validated (see ArchiveDecompressor). */
  public static fromEntries(
    entries: Iterable<{ path: string; data: Uint8Array }>,
    options: ZipAssetSourceOptions = {},
  ): ZipAssetSource {
    const source = new ZipAssetSource(options);
    for (const entry of entries) {
      source._files.set(entry.path, entry.data);
    }
    return source;
  }

  private async _loadZipData(bytes: Uint8Array): Promise<void> {
    this._processUnzipped(await safeUnzip(bytes, this._security));
  }

  private _processUnzipped(unzipped: Record<string, Uint8Array>): void {
    let totalBytes = 0;

    for (const [rawPath, data] of Object.entries(unzipped)) {
      if (rawPath.endsWith("/")) {
        // Skip directory entry markers
        continue;
      }

      const pathValidation = this._security.validatePath(rawPath);
      if (!pathValidation.valid) {
        console.warn(
          `[ZipAssetSource] Skipping unsafe zip entry '${rawPath}': ${pathValidation.reason}`,
        );
        continue;
      }

      const cleanPath = this._security.sanitizePath(rawPath);
      if (!cleanPath) continue;

      this._security.validateSize(data.byteLength, totalBytes);
      totalBytes += data.byteLength;

      this._files.set(cleanPath, data);
    }
  }

  public async list(pattern?: string): Promise<string[]> {
    const all = Array.from(this._files.keys());
    if (!pattern) return all;
    const regex = globToRegExp(pattern);
    return all.filter((p) => regex.test(p));
  }

  public async has(path: string): Promise<boolean> {
    const cleanPath = this._security.sanitizePath(path);
    return this._files.has(cleanPath);
  }

  public async read(path: string): Promise<Uint8Array> {
    const cleanPath = this._security.sanitizePath(path);
    const data = this._files.get(cleanPath);
    if (!data) {
      throw new Error(`[ZipAssetSource] File not found in archive: ${cleanPath}`);
    }
    return data;
  }

  public async readText(path: string): Promise<string> {
    const bytes = await this.read(path);
    return new TextDecoder("utf-8").decode(bytes);
  }

  public async readJson<T = unknown>(path: string): Promise<T> {
    const text = await this.readText(path);
    return JSON.parse(text) as T;
  }

  public toFetch(mountPrefix?: string): (url: string, init?: RequestInit) => Promise<Response> {
    const prefix = mountPrefix ?? `sw-asset://${this.id}/`;
    return async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.startsWith(prefix)) {
        const relPath = url.substring(prefix.length);
        const cleanPath = this._security.sanitizePath(relPath);
        const data = this._files.get(cleanPath);

        if (!data) {
          return new Response(`[ZipAssetSource] Asset '${cleanPath}' not found in ZIP mount`, {
            status: 404,
            statusText: "Not Found",
          });
        }

        const mimeType = SecurityValidator.getMimeType(cleanPath);
        return new Response(data.slice(), {
          status: 200,
          statusText: "OK",
          headers: {
            "Content-Type": mimeType,
            "Content-Length": String(data.byteLength),
          },
        });
      }

      return fetch(url, init);
    };
  }

  public dispose(): void {
    this._files.clear();
  }
}
