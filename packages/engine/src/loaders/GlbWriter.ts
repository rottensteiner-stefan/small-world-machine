import { GltfBinaryParser } from "./gltf/GltfBinaryParser.js";
import type { GltfJson } from "./gltf/types.js";
import type { GltfDocument } from "./gltf/writerTypes.js";

const GLB_MAGIC = 0x46546c67; // "glTF" little-endian
const GLB_VERSION = 2;
const GLB_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;
const GLB_CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON"
const GLB_CHUNK_TYPE_BIN = 0x004e4942; // "BIN\0"
const JSON_PAD_BYTE = 0x20; // ASCII space per glTF 2.0 §4.4

/** Resolves an external glTF URI (relative `.bin` or image file) to raw bytes. */
export type GlbUriResolver = (uri: string) => Promise<Uint8Array | ArrayBuffer>;

export interface GlbPackOptions {
  /** Optional resolver for non-`data:` external `.bin` and image URIs. */
  resolveUri?: GlbUriResolver;
}

function align4(byteLength: number): number {
  return (byteLength + 3) & ~3;
}

function inferImageMimeType(uri: string): string {
  if (uri.startsWith("data:")) {
    const semi = uri.indexOf(";");
    const comma = uri.indexOf(",");
    const end = semi >= 0 && (comma < 0 || semi < comma) ? semi : comma;
    if (end > 5) return uri.slice(5, end);
  }
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".ktx2")) return "image/ktx2";
  return "application/octet-stream";
}

async function resolveBufferUri(uri: string, resolver?: GlbUriResolver): Promise<Uint8Array> {
  if (uri.startsWith("data:")) {
    return new Uint8Array(GltfBinaryParser.decodeBase64(uri));
  }
  if (!resolver) {
    throw new Error(`[GlbWriter] External URI "${uri}" requires a resolveUri handler.`);
  }
  const resolved = await resolver(uri);
  return resolved instanceof Uint8Array ? resolved : new Uint8Array(resolved);
}

/**
 * Spec-compliant glTF 2.0 binary container (`.glb`) packer.
 *
 * Produces a 12-byte header, a 4-byte-aligned `JSON` chunk (trailing bytes padded with `0x20`
 * spaces per glTF 2.0 §4.4), and an optional 4-byte-aligned `BIN` chunk (`0x00` padded).
 */
export class GlbWriter {
  /**
   * Serializes a glTF JSON payload and optional combined BIN buffer into a `.glb` `Uint8Array`.
   */
  public static pack(json: unknown, bin?: Uint8Array): Uint8Array {
    const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const jsonPaddedLen = align4(jsonBytes.byteLength);
    const hasBin = bin !== undefined && bin.byteLength > 0;
    const binPaddedLen = hasBin ? align4(bin.byteLength) : 0;

    const totalLength =
      GLB_HEADER_BYTES +
      GLB_CHUNK_HEADER_BYTES +
      jsonPaddedLen +
      (hasBin ? GLB_CHUNK_HEADER_BYTES + binPaddedLen : 0);

    const out = new Uint8Array(totalLength);
    const view = new DataView(out.buffer);
    view.setUint32(0, GLB_MAGIC, true);
    view.setUint32(4, GLB_VERSION, true);
    view.setUint32(8, totalLength, true);

    view.setUint32(12, jsonPaddedLen, true);
    view.setUint32(16, GLB_CHUNK_TYPE_JSON, true);
    out.set(jsonBytes, 20);
    out.fill(JSON_PAD_BYTE, 20 + jsonBytes.byteLength, 20 + jsonPaddedLen);

    if (hasBin) {
      const binHeaderOffset = 20 + jsonPaddedLen;
      view.setUint32(binHeaderOffset, binPaddedLen, true);
      view.setUint32(binHeaderOffset + 4, GLB_CHUNK_TYPE_BIN, true);
      out.set(bin, binHeaderOffset + GLB_CHUNK_HEADER_BYTES);
    }

    return out;
  }

  /**
   * Converts an existing `GltfDocument` or `GltfJson` (supporting `data:` URIs and optional external
   * `.bin` / image URIs) into a self-contained single-BIN-chunk `.glb` container.
   */
  public static async packGltf(
    doc: GltfDocument | GltfJson,
    options: GlbPackOptions = {},
  ): Promise<Uint8Array> {
    const cloned = structuredClone(doc) as GltfJson & {
      buffers?: { uri?: string; byteLength: number }[];
      bufferViews?: {
        buffer?: number;
        byteOffset?: number;
        byteLength: number;
        byteStride?: number;
        target?: number;
      }[];
      images?: { uri?: string; mimeType?: string; bufferView?: number }[];
    };

    const binChunks: Uint8Array[] = [];
    let currentOffset = 0;

    const appendChunk = (bytes: Uint8Array): { byteOffset: number; byteLength: number } => {
      const paddedLen = align4(bytes.byteLength);
      const chunk = new Uint8Array(paddedLen);
      chunk.set(bytes);
      const byteOffset = currentOffset;
      binChunks.push(chunk);
      currentOffset += paddedLen;
      return { byteOffset, byteLength: bytes.byteLength };
    };

    // 1. Pack all declared buffers sequentially at 4-byte aligned offsets and remap bufferViews.
    const origBuffers = cloned.buffers ?? [];
    const bufferBaseOffsets: number[] = [];
    for (let i = 0; i < origBuffers.length; i++) {
      const buf = origBuffers[i]!;
      if (buf.uri !== undefined) {
        const bytes = await resolveBufferUri(buf.uri, options.resolveUri);
        const span = appendChunk(bytes);
        bufferBaseOffsets.push(span.byteOffset);
      } else {
        bufferBaseOffsets.push(currentOffset);
      }
    }

    if (cloned.bufferViews) {
      for (const bv of cloned.bufferViews) {
        const srcBuf = bv.buffer ?? 0;
        const baseOffset = bufferBaseOffsets[srcBuf] ?? 0;
        bv.buffer = 0;
        bv.byteOffset = baseOffset + (bv.byteOffset ?? 0);
      }
    }

    // 2. Pack URI-referenced images into the same BIN chunk so the .glb is self-contained.
    if (cloned.images) {
      cloned.bufferViews ??= [];
      for (const img of cloned.images) {
        if (img.uri === undefined || img.bufferView !== undefined) continue;
        const bytes = await resolveBufferUri(img.uri, options.resolveUri);
        const span = appendChunk(bytes);
        const bvIndex = cloned.bufferViews.length;
        cloned.bufferViews.push({
          buffer: 0,
          byteOffset: span.byteOffset,
          byteLength: span.byteLength,
        });
        img.bufferView = bvIndex;
        img.mimeType ??= inferImageMimeType(img.uri);
        delete img.uri;
      }
    }

    if (currentOffset > 0) {
      cloned.buffers = [{ byteLength: currentOffset }];
    } else {
      delete cloned.buffers;
    }

    const combined = new Uint8Array(currentOffset);
    let writePos = 0;
    for (const chunk of binChunks) {
      combined.set(chunk, writePos);
      writePos += chunk.byteLength;
    }

    return GlbWriter.pack(cloned, combined);
  }
}
