import { zip, zipSync } from "fflate";
import type { IAssetSink } from "../types.js";
import { SecurityValidator } from "../Security.js";

export interface ZipAssetSinkOptions {
  id?: string;
  security?: SecurityValidator;
  /** Compression level from 0 (uncompressed) to 9 (max compression). Default: 6 */
  level?: number;
}

/**
 * Output sink that collects files in memory and compiles them into a downloadable ZIP Blob.
 */
export class ZipAssetSink implements IAssetSink {
  public readonly id: string;
  private readonly _files: Record<string, Uint8Array> = {};
  private readonly _security: SecurityValidator;
  private readonly _level: number;

  constructor(options: ZipAssetSinkOptions = {}) {
    this.id = options.id ?? `zipsink-${Math.random().toString(36).substring(2, 9)}`;
    this._security = options.security ?? new SecurityValidator();
    this._level = options.level ?? 6;
  }

  public async write(path: string, data: Uint8Array | string): Promise<void> {
    const val = this._security.validatePath(path);
    if (!val.valid) {
      throw new Error(`[ZipAssetSink] Invalid path "${path}": ${val.reason}`);
    }
    const cleanPath = this._security.sanitizePath(path);
    if (!cleanPath) return;

    if (typeof data === "string") {
      this._files[cleanPath] = new TextEncoder().encode(data);
    } else {
      this._files[cleanPath] = data;
    }
  }

  public async build(): Promise<Uint8Array> {
    const blob = await this.finalize();
    return new Uint8Array(await blob.arrayBuffer());
  }

  public async finalize(): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      zip(
        this._files,
        { level: this._level as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 },
        (err, zipped) => {
          if (err) {
            try {
              const syncResult = zipSync(this._files, {
                level: this._level as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
              });
              const copy = syncResult.buffer.slice(
                syncResult.byteOffset,
                syncResult.byteOffset + syncResult.byteLength,
              );
              resolve(new Blob([copy], { type: "application/zip" }));
            } catch {
              reject(new Error(`[ZipAssetSink] Failed to generate zip archive: ${err.message}`));
            }
            return;
          }

          const copy = zipped.buffer.slice(
            zipped.byteOffset,
            zipped.byteOffset + zipped.byteLength,
          );
          resolve(new Blob([copy], { type: "application/zip" }));
        },
      );
    });
  }

  public dispose(): void {
    for (const key of Object.keys(this._files)) {
      delete this._files[key];
    }
  }
}
