import { Gunzip } from "fflate";
import { safeUnzip } from "./safeUnzip.js";
import { SecurityValidator } from "./Security.js";
import type { IngestFileItem } from "./UniversalIngestTypes.js";

const GZIP_INPUT_CHUNK_BYTES = 64 * 1024;

export class ArchiveDecompressor {
  private readonly _security: SecurityValidator;

  constructor(security?: SecurityValidator) {
    this._security = security ?? new SecurityValidator();
  }

  /**
   * Decompresses a GZ or TGZ blob/buffer.
   */
  public async decompressGzip(
    buffer: Uint8Array | ArrayBuffer | Blob,
    filename: string,
  ): Promise<IngestFileItem> {
    let bytes: Uint8Array;
    if (buffer instanceof Blob) {
      bytes = new Uint8Array(await buffer.arrayBuffer());
    } else if (buffer instanceof ArrayBuffer) {
      bytes = new Uint8Array(buffer);
    } else {
      bytes = buffer;
    }

    const decompressed = this._gunzipLimited(bytes);

    const uncompressedName = filename.replace(/\.gz$/i, "") || "uncompressed_file";
    const mimeType = SecurityValidator.getMimeType(uncompressedName);

    return {
      name: uncompressedName,
      path: uncompressedName,
      size: decompressed.byteLength,
      mimeType,
      data: decompressed,
      blob: new Blob([decompressed as BlobPart], { type: mimeType }),
    };
  }

  /**
   * Unpacks a ZIP archive into a list of sanitized IngestFileItem entries.
   */
  public async unpackZip(buffer: Uint8Array | ArrayBuffer | Blob): Promise<IngestFileItem[]> {
    let bytes: Uint8Array;
    if (buffer instanceof Blob) {
      bytes = new Uint8Array(await buffer.arrayBuffer());
    } else if (buffer instanceof ArrayBuffer) {
      bytes = new Uint8Array(buffer);
    } else {
      bytes = buffer;
    }

    const unzipped = await safeUnzip(bytes, this._security, { enforceExtensions: true });

    const items: IngestFileItem[] = [];

    for (const [rawPath, data] of Object.entries(unzipped)) {
      const cleanPath = this._security.sanitizePath(rawPath);
      if (!cleanPath) continue;

      const filename = cleanPath.split("/").pop() || cleanPath;
      const mimeType = SecurityValidator.getMimeType(filename);

      items.push({
        name: filename,
        path: cleanPath,
        size: data.byteLength,
        mimeType,
        data,
        blob: new Blob([data as BlobPart], { type: mimeType }),
      });
    }

    return items;
  }

  /** Inflates in small input chunks so a gzip bomb is aborted as soon as the byte limit is exceeded. */
  private _gunzipLimited(bytes: Uint8Array): Uint8Array {
    const parts: Uint8Array[] = [];
    let total = 0;
    const gunzip = new Gunzip((chunk) => {
      total += chunk.byteLength;
      this._security.assertSize(total);
      parts.push(chunk);
    });
    for (let offset = 0; offset < bytes.byteLength; offset += GZIP_INPUT_CHUNK_BYTES) {
      const end = Math.min(offset + GZIP_INPUT_CHUNK_BYTES, bytes.byteLength);
      gunzip.push(bytes.subarray(offset, end), end === bytes.byteLength);
    }
    const result = new Uint8Array(total);
    let position = 0;
    for (const part of parts) {
      result.set(part, position);
      position += part.byteLength;
    }
    return result;
  }
}
