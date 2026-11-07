import type { IAssetSink } from "../types.js";
import { SecurityValidator } from "../Security.js";

/** Starts a browser download for `blob` without navigating away from the tool. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url: string = URL.createObjectURL(blob);
  const link: HTMLAnchorElement = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Single-file export: `finalize()` downloads the one written file under `filename`. */
export class DownloadAssetSink implements IAssetSink {
  public readonly id: string;
  private readonly _filename: string;
  private _blob: Blob | undefined;

  constructor(filename: string, id?: string) {
    this.id = id ?? `download-${Math.random().toString(36).substring(2, 9)}`;
    this._filename = filename;
  }

  public async write(path: string, data: Uint8Array | string): Promise<void> {
    if (this._blob) {
      throw new Error(
        `[DownloadAssetSink] Only one file can be written; got a second one ('${path}').`,
      );
    }
    const part: BlobPart = typeof data === "string" ? data : (data.slice().buffer as ArrayBuffer);
    this._blob = new Blob([part], { type: SecurityValidator.getMimeType(path) });
  }

  public async finalize(): Promise<Blob> {
    if (!this._blob) {
      throw new Error("[DownloadAssetSink] Nothing was written.");
    }
    downloadBlob(this._blob, this._filename);
    return this._blob;
  }

  public dispose(): void {
    this._blob = undefined;
  }
}
