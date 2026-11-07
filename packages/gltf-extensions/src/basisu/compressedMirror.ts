/**
 * K02: vertical mirror (Y-flip) of block-compressed texture planes in the
 * exact wire formats the vendored Basis Universal WASM transcoder emits, so the
 * compressed path shares the decode orientation of `Texture.fromUrl` (decode
 * flip) and the RGBA8 KTX2 fallback -- one consistent asset orientation across
 * every texture pipeline (see `docs/research/shader-math-audit-2026-11.md` K02).
 *
 * Formats:
 * - BC1 (8 bytes/block): color words untouched; 2-bit selector rows flip/rotate.
 *   Row y holds the 2-bit selectors of texels (0..3, y) packed LSB-first per
 *   pixel (`m_bytes[4 + y]` in the transcoder's dxt_block), so the flip is a
 *   per-row byte move.
 * - BC3 (16 bytes/block): DXT5 alpha in bytes 0..7 (2 endpoint bytes + a 48-bit
 *   stream where texel t = y*4+x has its 3-bit index LSB-first at bit 16+3t --
 *   transcoder `dxt5a_block::get_selector`) plus a BC1 color block in bytes
 *   8..15. Both streams are permuted by the texel flip.
 * - ETC2 RGBA8 (16 bytes/block): EAC alpha in bytes 0..7 (base/table bytes
 *   0..1, per-texel 3-bit codes in bytes 2..7, texel (x,y) at block bits
 *   45-3*(x*4+y) -- transcoder `eac_block::get_selector`, col-major, MSB-first)
 *   and an ETC1-compatible RGB block in bytes 8..15 (big-endian wire: byte 8
 *   holds block bits 63..56). The transcoder only ever emits the ETC1-compatible
 *   mode (never T/H/P/Planar). Vertical flip swaps the horizontal regions when
 *   `flip`==0: individual mode swaps the two color words and the intensity
 *   tables; diff mode negates the delta (new base = old region-1 color, and the
 *   single unrepresentable case old delta == -4 degrades by at most one unit on
 *   the new lower region). `flip`==1 (left/right regions) leaves the codewords
 *   alone. Selectors are permuted per texel in every mode via the transcoder's
 *   raw two-plane layout (LSB plane & MSB plane 16 wire bits apart).
 *
 * Boundary behavior (levels whose height is not a multiple of 4): output rows
 * are sourced from their true input rows across at most two blocks; codewords
 * come from the dominant block and selectors row-wise from each source. Like
 * every block format this cannot carry content across block boundaries, so it is
 * inherently approximate and confined to non-4-aligned levels. 4-aligned levels
 * are decoded perfectly (modulo the BC7/ASTC partition-fallback approximation).
 */
import { CompressedTextureFormat } from "@small-world-machine/engine";
import type { BasisDecodedImage } from "./basisTypes.js";
import { mirrorBc7Plane } from "./compressedBc7Mirror.js";
import { mirrorAstcPlane } from "./compressedAstcMirror.js";
import { etcGetBits, etcPutBits, getBits, putBits } from "./compressedBits.js";

const BLOCK4 = 16;

/** Per-block row map: output rows map to source rows across the block grid. */
interface RowMap {
  srcBys: number[];
  srcJs: number[];
  allMapped: boolean;
  /** Source block index of output row 0 (the dominant content block). */
  dominant: number;
}

function rowMapFor(by: number, height: number): RowMap {
  const srcBys = [-1, -1, -1, -1];
  const srcJs = [-1, -1, -1, -1];
  let allMapped = true;
  for (let r = 0; r < 4; r++) {
    const outRow = by * 4 + r;
    if (outRow < height) {
      const inRow = height - 1 - outRow;
      srcBys[r] = inRow >> 2;
      srcJs[r] = inRow & 3;
    } else {
      allMapped = false;
    }
  }
  return { srcBys, srcJs, allMapped, dominant: srcBys[0]! };
}

/** Block index in the plane buffer for column `bx` / block row `by`. */
function blockIndexOf(bx: number, by: number, blocksX: number): number {
  return bx + by * blocksX;
}

/** True when every mapped output row of this block comes from one source block (exact flip). */
function isSingleSource(map: RowMap): boolean {
  if (!map.allMapped) return false;
  for (let r = 1; r < 4; r++) {
    if (map.srcBys[r] !== map.dominant) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// BC1 (DXT1), 8 bytes per block.
// ---------------------------------------------------------------------------

const BC1_BLOCK_BYTES = 8;

function mirrorBc1Plane(data: Uint8Array, width: number, height: number): Uint8Array {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const out = new Uint8Array(data.length);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const map = rowMapFor(by, height);
      const dst = blockIndexOf(bx, by, blocksX) * BC1_BLOCK_BYTES;
      const src = blockIndexOf(bx, map.dominant, blocksX) * BC1_BLOCK_BYTES;
      // Color words always come from the dominant block.
      out[dst] = data[src]!;
      out[dst + 1] = data[src + 1]!;
      out[dst + 2] = data[src + 2]!;
      out[dst + 3] = data[src + 3]!;
      for (let r = 0; r < 4; r++) {
        const sbY = map.srcBys[r]!;
        if (sbY === -1) continue;
        const rowByte = isSingleSource(map)
          ? data[src + 4 + (3 - r)]!
          : data[blockIndexOf(bx, sbY, blocksX) * BC1_BLOCK_BYTES + 4 + map.srcJs[r]!]!;
        out[dst + 4 + r] = rowByte;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// BC3 (DXT5), 16 bytes per block: DXT5 alpha + BC1 color.
// ---------------------------------------------------------------------------

/** 3-bit DXT5 alpha selector of texel (x, y), packed LSB-first at bit 16 + 3t. */
function readDxt5Alpha(data: Uint8Array, off: number, x: number, y: number): number {
  return getBits(data, off * 8 + 16 + 3 * (y * 4 + x), 3);
}

function writeDxt5Alpha(data: Uint8Array, off: number, x: number, y: number, value: number): void {
  putBits(data, off * 8 + 16 + 3 * (y * 4 + x), 3, value);
}

function mirrorBc3Plane(data: Uint8Array, width: number, height: number): Uint8Array {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const out = new Uint8Array(data.length);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const map = rowMapFor(by, height);
      const dst = blockIndexOf(bx, by, blocksX) * BLOCK4;
      const src = blockIndexOf(bx, map.dominant, blocksX) * BLOCK4;
      // Alpha endpoints + color words from the dominant block.
      out[dst] = data[src]!;
      out[dst + 1] = data[src + 1]!;
      out[dst + 8] = data[src + 8]!;
      out[dst + 9] = data[src + 9]!;
      out[dst + 10] = data[src + 10]!;
      out[dst + 11] = data[src + 11]!;
      for (let r = 0; r < 4; r++) {
        const sbY = map.srcBys[r]!;
        if (sbY === -1) continue;
        const sbOff = blockIndexOf(bx, sbY, blocksX) * BLOCK4;
        const colorRow = data[sbOff + 12 + map.srcJs[r]!]!;
        out[dst + 12 + r] = colorRow;
        for (let x = 0; x < 4; x++) {
          const j = isSingleSource(map) ? 3 - r : map.srcJs[r]!;
          // Non-aligned rows may pull alpha selectors from another block.
          const alphaFrom = isSingleSource(map) ? sbOff : blockIndexOf(bx, sbY, blocksX) * BLOCK4;
          writeDxt5Alpha(out, dst, x, r, readDxt5Alpha(data, alphaFrom, x, j));
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// ETC2 RGBA8, 16 bytes per block: EAC alpha (bytes 0..7) + ETC RGB (bytes 8..15).
// ---------------------------------------------------------------------------

const EAC_ALPHA = 0; // block bytes 0..7
const ETC_RGB = 8; // block bytes 8..15
const ET2 = BLOCK4;

/**
 * Wire bits of the ETC RGB sub-block (byte 8 of the RGBA block == wire bit
 * 63..56). Field positions are the transcoder's `decoder_etc_block` layout
 * (verified against `transcode_uastc_to_etc1` + cETC1*BitOffset): base color
 * fields span spec bits 43..63, deltas 40..58 -- the `etcGetBits` specBit is
 * the field's LSB.
 */
const ETC_FLIP_BIT = 32;
const ETC_DIFF_BIT = 33;
const ETC_INTEN0_BITS = 37; // 3 bits, sub-block 0
const ETC_INTEN1_BITS = 34; // 3 bits, sub-block 1
const ETC_R1_BITS = 59; // 5-bit base R0 (spec bits 59..63)
const ETC_G1_BITS = 51;
const ETC_B1_BITS = 43;
const ETC_DR_BITS = 56; // 3-bit signed delta R (spec bits 56..58)
const ETC_DG_BITS = 48;
const ETC_DB_BITS = 40; // 3-bit signed delta B (spec bits 40..42)

/** 5-bit clamp used by the ETC decoder when reconstructing region 1 colors. */
function clamp5(v: number): number {
  return v < 0 ? 0 : v > 31 ? 31 : v;
}

/**
 * Mirrors the ETC RGB sub-block of an aligned block (bytes 8..15 already copied
 * to `dstOff`). Region swap for `flip`==0: horizontal (top/bottom) regions change
 * places, requiring inten swap and (in diff mode) a delta negation; `flip`==1
 * (left/right) keeps the codewords.
 */
function mirrorEtcRgbBlockFull(
  out: Uint8Array,
  dstOff: number,
  data: Uint8Array,
  srcOff: number,
): void {
  const flip = etcGetBits(data, srcOff, ETC_FLIP_BIT, 1);
  const diff = etcGetBits(data, srcOff, ETC_DIFF_BIT, 1);
  if (flip === 1) return; // vertical flip leaves left/right regions in place
  const i0 = etcGetBits(data, srcOff, ETC_INTEN0_BITS, 3);
  const i1 = etcGetBits(data, srcOff, ETC_INTEN1_BITS, 3);
  etcPutBits(out, dstOff, ETC_INTEN0_BITS, 3, i1);
  etcPutBits(out, dstOff, ETC_INTEN1_BITS, 3, i0);
  if (diff === 1) {
    // Region 1 is region 0 + delta. After the flip the old region 1 becomes the
    // new base; the new region 1 delta is the negation of the old one. The single
    // unrepresentable negation (old delta == -4 -> +4) clamps to +3 and costs at
    // most 1 unit on the new lower region.
    for (const [baseBits, deltaBits] of [
      [ETC_R1_BITS, ETC_DR_BITS],
      [ETC_G1_BITS, ETC_DG_BITS],
      [ETC_B1_BITS, ETC_DB_BITS],
    ] as const) {
      const base = etcGetBits(data, srcOff, baseBits, 5);
      const deltaRaw = etcGetBits(data, srcOff, deltaBits, 3);
      const delta = deltaRaw >= 4 ? deltaRaw - 8 : deltaRaw;
      const newBase = clamp5(base + delta);
      let newDelta = base - newBase;
      if (newDelta > 3) newDelta = 3;
      etcPutBits(out, dstOff, baseBits, 5, newBase);
      etcPutBits(out, dstOff, deltaBits, 3, (newDelta + 8) & 7);
    }
  } else {
    // Individual mode: color0 occupies the high nibbles of bytes 0..2 of the
    // sub-block, color1 the low nibbles (`transcode_uastc_to_etc1` packs
    // `m_bytes[i] = color1.ch | color0.ch << 4`). Swapping the regions is a
    // per-byte nibble swap, not a byte swap.
    for (let i = 0; i < 3; i++) {
      const v = data[srcOff + i]!;
      out[dstOff + i] = ((v & 0x0f) << 4) | (v >> 4);
    }
  }
}

/** Raw 2-bit ETC selector of texel (x, y): LSB plane at wire bit x*4+y, MSB 16 bits up. */
function readEtcSelector(data: Uint8Array, off: number, x: number, y: number): number {
  const bi = x * 4 + y;
  return (etcGetBits(data, off, bi, 1) | (etcGetBits(data, off, bi + 16, 1) << 1)) & 3;
}

function writeEtcSelector(
  data: Uint8Array,
  off: number,
  x: number,
  y: number,
  value: number,
): void {
  const bi = x * 4 + y;
  etcPutBits(data, off, bi, 1, value & 1);
  etcPutBits(data, off, bi + 16, 1, (value >> 1) & 1);
}

/** 3-bit EAC alpha selector of texel (x, y), col-major, MSB-first in bytes 2..7. */
function readEacAlpha(data: Uint8Array, x: number, y: number): number {
  const t = x * 4 + y;
  return etcGetBits(data, EAC_ALPHA, 45 - 3 * t, 3);
}

function writeEacAlpha(data: Uint8Array, x: number, y: number, value: number): void {
  const t = x * 4 + y;
  etcPutBits(data, EAC_ALPHA, 45 - 3 * t, 3, value);
}

function mirrorEtc2Plane(data: Uint8Array, width: number, height: number): Uint8Array {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const out = new Uint8Array(data.length);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const map = rowMapFor(by, height);
      const dst = blockIndexOf(bx, by, blocksX) * ET2;
      const src = blockIndexOf(bx, map.dominant, blocksX) * ET2;
      // EAC alpha base/table come from the dominant block.
      out[dst] = data[src]!;
      out[dst + 1] = data[src + 1]!;
      const single = isSingleSource(map);

      // RGB sub-block codewords + selectors start as a copy of the dominant block.
      for (let i = 8; i < 16; i++) out[dst + i] = data[src + i]!;
      if (single) {
        // Aligned block: adjust the codeword region for the region swap (diff/individual).
        // The mirror operates on the RGB sub-block's own addressing (bytes 8..15).
        mirrorEtcRgbBlockFull(out, dst + ETC_RGB, data, src + ETC_RGB);
      }

      for (let r = 0; r < 4; r++) {
        const sbY = map.srcBys[r]!;
        if (sbY === -1) continue;
        const j = single ? 3 - r : map.srcJs[r]!;
        const sbOff = blockIndexOf(bx, sbY, blocksX) * ET2;
        for (let x = 0; x < 4; x++) {
          writeEacAlpha(out, x, r, readEacAlpha(data, x, j));
          writeEtcSelector(out, dst + ETC_RGB, x, r, readEtcSelector(data, sbOff + ETC_RGB, x, j));
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dispatcher + mip-chain API.
// ---------------------------------------------------------------------------

export const COMPRESSED_FORMATS: readonly CompressedTextureFormat[] = [
  CompressedTextureFormat.BC1_RGB,
  CompressedTextureFormat.BC3_RGBA,
  CompressedTextureFormat.BC7_RGBA,
  CompressedTextureFormat.ASTC_4x4_RGBA,
  CompressedTextureFormat.ETC2_RGBA8,
];

export function isMirrorableFormat(format: CompressedTextureFormat): boolean {
  return COMPRESSED_FORMATS.includes(format);
}

/**
 * Returns the vertically flipped plane bytes for the given block format, keeping
 * the format (no RGBA fallback). The result is a fresh buffer; the input is not
 * modified.
 */
export function mirrorCompressedPlane(
  data: Uint8Array,
  width: number,
  height: number,
  format: CompressedTextureFormat,
): Uint8Array {
  switch (format) {
    case CompressedTextureFormat.BC1_RGB:
      return mirrorBc1Plane(data, width, height);
    case CompressedTextureFormat.BC3_RGBA:
      return mirrorBc3Plane(data, width, height);
    case CompressedTextureFormat.BC7_RGBA:
      return mirrorBc7Plane(data, width, height);
    case CompressedTextureFormat.ASTC_4x4_RGBA:
      return mirrorAstcPlane(data, width, height);
    case CompressedTextureFormat.ETC2_RGBA8:
      return mirrorEtc2Plane(data, width, height);
    default: {
      const exhaustive: never = format;
      throw new Error(`[compressedMirror] Unsupported block format ${exhaustive}`);
    }
  }
}

/**
 * Builds the GPU mip chain for a decoded (block-compressed) KTX2 payload with the
 * K02 decode flip applied to every level. Mirrors each level with its own
 * dimensions in place (the transcoder emits all levels as full block grids whose
 * level dimensions are the authoritative texel size). Levels with a height that
 * is a multiple of 4 are mirrored bit-exactly where the codec allows it; the
 * residual approximation cases are confined to non-4-aligned levels and the
 * BC7/ASTC partition fallback.
 */
export function flippedCompressedMipChain(
  images: BasisDecodedImage[],
  format: CompressedTextureFormat,
): Uint8Array[] {
  const base = images.filter((image) => image.mipLevel === 0);
  if (base.length !== 1) {
    throw new Error(
      `[BasisTranscoder] Only single-image (2D) KTX2 payloads map to a compressed texture chain (found ${base.length} base images)`,
    );
  }
  const levelCount = Math.max(...images.map((image) => image.mipLevel)) + 1;
  const mipData: Uint8Array[] = [];
  for (let level = 0; level < levelCount; level++) {
    const plane = images.find((image) => image.mipLevel === level);
    if (!plane) {
      throw new Error(`[BasisTranscoder] Compressed mip chain is missing level ${level}`);
    }
    mipData.push(mirrorCompressedPlane(plane.data, plane.width, plane.height, format));
  }
  return mipData;
}
