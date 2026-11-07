/**
 * K02: vertical mirror of BC7 (BPTC) blocks as emitted by the Basis Universal
 * WASM transcoder (`transcode_uastc_to_bc7` / `convert_etc1s_to_bc7`, both
 * serialized through `encode_bc7_block`). The parser/writer here is a faithful
 * TypeScript port of that writer (encoder/basisu_bc7e_scalar.cpp + BPTC spec
 * Table 111): same field order, same anchor MSB-drop rule, same decode-neutral
 * anchor normalization (invert subset selectors + swap subset endpoints/P-bits
 * when the anchor slot would carry a high MSB).
 *
 * Partition handling: the mirror flips the block's partition pattern. When the
 * flipped pattern is representable in the canonical 64-pattern table the flip is
 * bit-exact; non-representable patterns (roughly half of the reachable set) fall
 * back to the nearest flip-closed partition (minimum Hamming distance over
 * texel subset assignments). Endpoints and index values move with the texels, so
 * a fallback only affects the texels whose subset label the approximation had to
 * change; the anchor normalization keeps every produced block valid.
 */
import {
  BC7_ALPHA_INDEX_BITCOUNT,
  BC7_ALPHA_PRECISION,
  BC7_ANCHOR_SECOND_SUBSET,
  BC7_ANCHOR_THIRD_SUBSET_1,
  BC7_ANCHOR_THIRD_SUBSET_2,
  BC7_COLOR_INDEX_BITCOUNT,
  BC7_COLOR_PRECISION,
  BC7_HAS_P_BITS,
  BC7_HAS_SHARED_P_BITS,
  BC7_NUM_SUBSETS,
  BC7_PARTITION_2_SUBSET,
  BC7_PARTITION_3_SUBSET,
  BC7_PARTITION_BITS,
  BC7_SEPARATE_ALPHA_SELECTORS,
} from "./compressedTables.js";
import { flipTexel, getBits, putBits } from "./compressedBits.js";

const BC7_BLOCK_BYTES = 16;

/** Decoded BC7 block state (endpoint precision already unquantized by reading, selectors are true values). */
interface Bc7Block {
  mode: number;
  rotation: number;
  indexSelector: number;
  partition: number;
  subsets: number;
  low: number[][];
  high: number[][];
  pbits: number[][];
  colorSelectors: number[];
  alphaSelectors: number[];
}

function subsetAnchor(partition: number, subsets: number, subset: number): number {
  if (subset === 0) return 0;
  if (subsets === 3) {
    return subset === 1
      ? BC7_ANCHOR_THIRD_SUBSET_1[partition]!
      : BC7_ANCHOR_THIRD_SUBSET_2[partition]!;
  }
  return BC7_ANCHOR_SECOND_SUBSET[partition]!;
}

function partitionTable(subsets: number): readonly number[] {
  return subsets === 3 ? BC7_PARTITION_3_SUBSET : BC7_PARTITION_2_SUBSET;
}

function texelSubset(subsets: number, partition: number, t: number): number {
  if (subsets === 1) return 0;
  return partitionTable(subsets)[partition * 16 + t]!;
}

/** Reads the index/endpoint fields of one BC7 block. Throws on reserved/invalid mode patterns. */
function parseBlock(bytes: Uint8Array, off: number): Bc7Block {
  // Mode field: exactly `mode+1` bits (mode leading zeros + a 1), e.g. mode 3 is
  // 0001. Scan consumes the leading zeros; the next field starts right after the
  // 1, i.e. at bit `mode + 1` (never `2*mode+1` -- each extra skip would shift
  // every later field and overflow the 128-bit block).
  let mode = -1;
  let bit = 0;
  for (let m = 0; m < 8; m++) {
    if (getBits(bytes, off * 8 + bit, 1) === 1) {
      mode = m;
      break;
    }
    bit++;
  }
  if (mode < 0) throw new Error(`[compressedMirror] Reserved BC7 block (mode field all zeros)`);
  bit = mode + 1;

  const rotation = mode === 4 || mode === 5 ? getBits(bytes, off * 8 + bit, 2) : 0;
  if (mode === 4 || mode === 5) bit += 2;
  const indexSelector = mode === 4 ? getBits(bytes, off * 8 + bit, 1) : 0;
  if (mode === 4) bit += 1;

  const subsets = BC7_NUM_SUBSETS[mode]!;
  const partition = subsets > 1 ? getBits(bytes, off * 8 + bit, BC7_PARTITION_BITS[mode]!) : 0;
  if (subsets > 1) bit += BC7_PARTITION_BITS[mode]!;

  const low: number[][] = [];
  const high: number[][] = [];
  for (let s = 0; s < subsets; s++) {
    low[s] = [0, 0, 0, 0];
    high[s] = [0, 0, 0, 0];
  }

  const totalComps = mode >= 4 ? 4 : 3;
  for (let comp = 0; comp < totalComps; comp++) {
    const precision = comp === 3 ? BC7_ALPHA_PRECISION[mode]! : BC7_COLOR_PRECISION[mode]!;
    for (let subset = 0; subset < subsets; subset++) {
      low[subset]![comp] = getBits(bytes, off * 8 + bit, precision);
      bit += precision;
      high[subset]![comp] = getBits(bytes, off * 8 + bit, precision);
      bit += precision;
    }
  }

  const pbits: number[][] = [];
  for (let s = 0; s < subsets; s++) pbits[s] = [0, 0];
  if (BC7_HAS_P_BITS[mode] !== 0) {
    for (let subset = 0; subset < subsets; subset++) {
      pbits[subset]![0] = getBits(bytes, off * 8 + bit, 1);
      bit += 1;
      if (BC7_HAS_SHARED_P_BITS[mode] === 0) {
        pbits[subset]![1] = getBits(bytes, off * 8 + bit, 1);
        bit += 1;
      }
    }
  }

  const colorIndexBits = BC7_COLOR_INDEX_BITCOUNT[mode]! + indexSelector;
  const alphaIndexBits = BC7_ALPHA_INDEX_BITCOUNT[mode]! - indexSelector;
  const anchors: number[] = [];
  for (let s = 0; s < subsets; s++) anchors[s] = subsetAnchor(partition, subsets, s);

  const colorSelectors = new Array<number>(16).fill(0);
  const alphaSelectors = new Array<number>(16).fill(0);

  for (let t = 0; t < 16; t++) {
    let n = indexSelector !== 0 ? alphaIndexBits : colorIndexBits;
    if (anchors.includes(t)) n -= 1;
    const value = getBits(bytes, off * 8 + bit, n);
    bit += n;
    if (indexSelector !== 0) alphaSelectors[t] = value;
    else colorSelectors[t] = value;
  }
  if (BC7_SEPARATE_ALPHA_SELECTORS[mode]!) {
    for (let t = 0; t < 16; t++) {
      let n = indexSelector !== 0 ? colorIndexBits : alphaIndexBits;
      if (anchors.includes(t)) n -= 1;
      const value = getBits(bytes, off * 8 + bit, n);
      bit += n;
      if (indexSelector !== 0) colorSelectors[t] = value;
      else alphaSelectors[t] = value;
    }
  }

  if (bit !== 128) throw new Error(`[compressedMirror] BC7 block field overrun`);
  return {
    mode,
    rotation,
    indexSelector,
    partition,
    subsets,
    low,
    high,
    pbits,
    colorSelectors,
    alphaSelectors,
  };
}

/** Writes one BC7 block, applying the decode-neutral anchor normalization per subset. */
function writeBlock(bytes: Uint8Array, off: number, blk: Bc7Block): void {
  const { mode } = blk;
  const colorIndexBits = BC7_COLOR_INDEX_BITCOUNT[mode]! + blk.indexSelector;
  const alphaIndexBits = BC7_ALPHA_INDEX_BITCOUNT[mode]! - blk.indexSelector;
  const anchors: number[] = [];
  for (let s = 0; s < blk.subsets; s++) anchors[s] = subsetAnchor(blk.partition, blk.subsets, s);

  const colorSelectors = blk.colorSelectors.slice();
  const alphaSelectors = blk.alphaSelectors.slice();
  const low = blk.low.map((row) => row.slice());
  const high = blk.high.map((row) => row.slice());
  const pbits = blk.pbits.map((row) => row.slice());

  for (let k = 0; k < blk.subsets; k++) {
    const anchor = anchors[k]!;
    if ((colorSelectors[anchor]! & (1 << (colorIndexBits - 1))) !== 0) {
      for (let t = 0; t < 16; t++) {
        if (texelSubset(blk.subsets, blk.partition, t) === k) {
          colorSelectors[t] = (1 << colorIndexBits) - 1 - colorSelectors[t]!;
        }
      }
      if (BC7_SEPARATE_ALPHA_SELECTORS[mode]!) {
        for (let c = 0; c < 3; c++) {
          const tmp = low[k]![c]!;
          low[k]![c] = high[k]![c]!;
          high[k]![c] = tmp;
        }
      } else {
        const tmpRow = low[k]!;
        low[k] = high[k]!;
        high[k] = tmpRow;
      }
      if (BC7_HAS_SHARED_P_BITS[mode] === 0) {
        const tmp = pbits[k]![0]!;
        pbits[k]![0] = pbits[k]![1]!;
        pbits[k]![1] = tmp;
      }
    }
    if (
      BC7_SEPARATE_ALPHA_SELECTORS[mode]! &&
      (alphaSelectors[anchor]! & (1 << (alphaIndexBits - 1))) !== 0
    ) {
      for (let t = 0; t < 16; t++) {
        if (texelSubset(blk.subsets, blk.partition, t) === k) {
          alphaSelectors[t] = (1 << alphaIndexBits) - 1 - alphaSelectors[t]!;
        }
      }
      const tmp = low[k]![3]!;
      low[k]![3] = high[k]![3]!;
      high[k]![3] = tmp;
    }
  }

  let bit = 0;
  putBits(bytes, off * 8 + bit, mode + 1, 1 << mode);
  bit += mode + 1;
  if (mode === 4 || mode === 5) {
    putBits(bytes, off * 8 + bit, 2, blk.rotation);
    bit += 2;
  }
  if (mode === 4) {
    putBits(bytes, off * 8 + bit, 1, blk.indexSelector);
    bit += 1;
  }
  if (blk.subsets > 1) {
    putBits(bytes, off * 8 + bit, BC7_PARTITION_BITS[mode]!, blk.partition);
    bit += BC7_PARTITION_BITS[mode]!;
  }

  const totalComps = mode >= 4 ? 4 : 3;
  for (let comp = 0; comp < totalComps; comp++) {
    const precision = comp === 3 ? BC7_ALPHA_PRECISION[mode]! : BC7_COLOR_PRECISION[mode]!;
    for (let subset = 0; subset < blk.subsets; subset++) {
      putBits(bytes, off * 8 + bit, precision, low[subset]![comp]!);
      bit += precision;
      putBits(bytes, off * 8 + bit, precision, high[subset]![comp]!);
      bit += precision;
    }
  }
  if (BC7_HAS_P_BITS[mode] !== 0) {
    for (let subset = 0; subset < blk.subsets; subset++) {
      putBits(bytes, off * 8 + bit, 1, pbits[subset]![0]!);
      bit += 1;
      if (BC7_HAS_SHARED_P_BITS[mode] === 0) {
        putBits(bytes, off * 8 + bit, 1, pbits[subset]![1]!);
        bit += 1;
      }
    }
  }

  for (let t = 0; t < 16; t++) {
    let n = blk.indexSelector !== 0 ? alphaIndexBits : colorIndexBits;
    if (anchors.includes(t)) n -= 1;
    putBits(
      bytes,
      off * 8 + bit,
      n,
      blk.indexSelector !== 0 ? alphaSelectors[t]! : colorSelectors[t]!,
    );
    bit += n;
  }
  if (BC7_SEPARATE_ALPHA_SELECTORS[mode]!) {
    for (let t = 0; t < 16; t++) {
      let n = blk.indexSelector !== 0 ? colorIndexBits : alphaIndexBits;
      if (anchors.includes(t)) n -= 1;
      putBits(
        bytes,
        off * 8 + bit,
        n,
        blk.indexSelector !== 0 ? colorSelectors[t]! : alphaSelectors[t]!,
      );
      bit += n;
    }
  }
}

/**
 * Cached vertical-flip partition remap per (variant, representable width).
 * Variant 0 = 2-subset table (modes 1/3/7), 1 = 3-subset table (modes 0/2).
 * `width` is the mode's partition field size (`1 << BC7_PARTITION_BITS[mode]`,
 * i.e. 16 for mode 0, 64 otherwise) -- a flipped pattern must land inside the
 * representable range or `putBits` would silently truncate the field.
 */
const flipCache: Array<Map<number, Int16Array> | null> = [null, null];

function flipPattern(pat: readonly number[]): number[] {
  const out = new Array<number>(16);
  for (let t = 0; t < 16; t++) out[flipTexel(t)] = pat[t]!;
  return out;
}

function patternOf(table: readonly number[], partition: number): number[] {
  return table.slice(partition * 16, partition * 16 + 16);
}

function flipRemapFor(variant: number, width: number): Int16Array {
  const table = variant === 1 ? BC7_PARTITION_3_SUBSET : BC7_PARTITION_2_SUBSET;
  let byWidth = flipCache[variant];
  if (byWidth === undefined || byWidth === null) {
    byWidth = new Map<number, Int16Array>();
    flipCache[variant] = byWidth;
  }
  const cached = byWidth.get(width);
  if (cached !== undefined) return cached;

  // Exact flip targets constrained to the representable range.
  const exact = new Int16Array(width).fill(-1);
  for (let p = 0; p < width; p++) {
    const fl = flipPattern(patternOf(table, p));
    for (let q = 0; q < width; q++) {
      let same = true;
      for (let t = 0; t < 16; t++) {
        if (table[q * 16 + t] !== fl[t]) {
          same = false;
          break;
        }
      }
      if (same) {
        exact[p] = q;
        break;
      }
    }
  }
  // Nearest flip-closed fallback for non-representable patterns. Candidates are
  // restricted to exacly-representable patterns so a second flip stays valid.
  const results = new Int16Array(width).fill(-1);
  for (let p = 0; p < width; p++) {
    if (exact[p]! >= 0) {
      results[p] = exact[p]!;
      continue;
    }
    const fl = flipPattern(patternOf(table, p));
    let best = -1;
    let bestDistance = Number.MAX_SAFE_INTEGER;
    for (let c = 0; c < width; c++) {
      if (exact[c]! < 0) continue;
      let distance = 0;
      for (let t = 0; t < 16; t++) {
        if (table[c * 16 + t] !== fl[t]) distance++;
      }
      if (distance < bestDistance) {
        bestDistance = distance;
        best = c;
      }
    }
    results[p] = best >= 0 ? best : p;
  }
  byWidth.set(width, results);
  return results;
}

/** Returns the partition whose 16-texel pattern is the vertical flip of `partition`'s. */
export function flipPartition(subsets: number, partition: number, width: number): number {
  if (subsets === 1) return 0;
  const variant = subsets === 3 ? 1 : 0;
  return flipRemapFor(variant, width)[partition]!;
}

function flipBlockExact(src: Uint8Array, srcOff: number, dst: Uint8Array, dstOff: number): void {
  const blk = parseBlock(src, srcOff);
  const newColor = new Array<number>(16).fill(0);
  const newAlpha = new Array<number>(16).fill(0);
  for (let t = 0; t < 16; t++) {
    const f = flipTexel(t);
    newColor[f] = blk.colorSelectors[t]!;
    newAlpha[f] = blk.alphaSelectors[t]!;
  }
  blk.colorSelectors = newColor;
  blk.alphaSelectors = newAlpha;
  // Preserve mode 4/5 dual-plane channel semantics: rotation is a per-texel
  // channel remap and is invariant under a spatial flip, so it is kept as-is.
  if (blk.subsets > 1) {
    const width = 1 << BC7_PARTITION_BITS[blk.mode]!;
    blk.partition = flipPartition(blk.subsets, blk.partition, width);
  }
  for (let i = 0; i < BC7_BLOCK_BYTES; i++) dst[dstOff + i] = 0;
  writeBlock(dst, dstOff, blk);
}

/**
 * Mirrors a whole BC7 plane. `width`/`height` are the logical texel dimensions;
 * the block grid is `ceil(w/4) x ceil(h/4)`. Levels whose height is not a
 * multiple of 4 produce one boundary block row sourced from two input blocks
 * (dominant codewords + row-sourced selectors, anchor-normalized -- the only
 * inherently approximate case, confined to non-4-aligned levels).
 */
export function mirrorBc7Plane(data: Uint8Array, width: number, height: number): Uint8Array {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const out = new Uint8Array(data.length);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      // Rows of real content for this output block: each maps to one input row.
      const srcBys: number[] = [-1, -1, -1, -1];
      const srcJs: number[] = [-1, -1, -1, -1];
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
      const srcOff = (bx + srcBys[0]! * blocksX) * BC7_BLOCK_BYTES;
      const dstOff = (bx + by * blocksX) * BC7_BLOCK_BYTES;
      const dominant = srcBys[0]!;
      let single = true;
      for (let r = 1; r < 4; r++) {
        if (srcBys[r] !== -1 && srcBys[r] !== dominant) {
          single = false;
          break;
        }
        if (!allMapped && srcBys[r] === -1) {
          single = false;
          break;
        }
      }
      if (single && allMapped) {
        // Every real row of this output block comes from one input block -> exact in-block flip.
        flipBlockExact(data, srcOff, out, dstOff);
        continue;
      }

      // Boundary block: dominant input block codewords + row-sourced selectors.
      // Each distinct source block is parsed exactly once (cached by index).
      const blkByIndex = new Map<number, Bc7Block>();
      const sourceOfRow = (r: number): Bc7Block | null => {
        const sbY = srcBys[r]!;
        if (sbY === -1) return null;
        const sb = bx + sbY * blocksX;
        let parsed = blkByIndex.get(sb);
        if (parsed === undefined) {
          parsed = parseBlock(data, sb * BC7_BLOCK_BYTES);
          blkByIndex.set(sb, parsed);
        }
        return parsed;
      };
      const blk = sourceOfRow(0)!;
      const newColor = new Array<number>(16).fill(0);
      const newAlpha = new Array<number>(16).fill(0);
      for (let r = 0; r < 4; r++) {
        const sd = sourceOfRow(r);
        if (sd === null) continue;
        for (let x = 0; x < 4; x++) {
          const srcIndex = x + srcJs[r]! * 4;
          newColor[x + r * 4] = sd.colorSelectors[srcIndex]!;
          newAlpha[x + r * 4] = sd.alphaSelectors[srcIndex]!;
        }
      }
      blk.colorSelectors = newColor;
      blk.alphaSelectors = newAlpha;
      for (let i = 0; i < BC7_BLOCK_BYTES; i++) out[dstOff + i] = 0;
      writeBlock(out, dstOff, blk);
    }
  }
  return out;
}

export { BC7_BLOCK_BYTES };
