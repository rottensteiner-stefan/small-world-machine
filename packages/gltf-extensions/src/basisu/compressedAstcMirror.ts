/**
 * K02: vertical mirror of ASTC 4x4 blocks as emitted by the Basis Universal WASM
 * transcoder (ETC1S->ASTC and UASTC->ASTC, both serialized through the revised
 * spec layout: 2-bit PART field at bit 11, 10-bit partition seed at bit 13,
 * 6-bit CEM at bit 23 -- verified byte-for-byte against the vendored transcoder
 * output and the ARM astcenc reference writer).
 *
 * The mirror is a surgical patch, not a full parse/repack:
 * - The partition SEED (bits 13..22 of multi-partition blocks) is replaced by the
 *   seed whose procedural pattern is the vertical flip of the original
 *   (exact when representable, otherwise the nearest flip-closed seed -- see
 *   below), so every output texel keeps its own subset label (and therefore its
 *   own endpoint pair). Endpoints, CEM and CCS stay byte-identical; only the
 *   weight (index) values move with their texels.
 * - The weight stream (BISE, always uniform-bit for basis output) is permuted by
 *   the texel flip. Each value is stored MSB-serialized top-down from the block
 *   end (bit 127), with a per-value bit reversal applied by the transcoder's
 *   writer (`s_reverse_bits2..5`); because the reversal is per-value and
 *   position-invariant, re-encoding a permuted value list reproduces that exact
 *   wire form. Dual-plane blocks interleave (`gridIdx << 1) | plane` per spec;
 *   each plane is permuted independently, which is decode-neutral.
 * - Void-extent blocks are solid color: mirror = identity.
 *
 * Boundary rows (levels whose height is not a multiple of 4) map each output row
 * to its true source row across at most two source blocks; rows whose source
 * block has an incompatible weight layout (or is void) fall back to the dominant
 * block's mirrored values. Like every block format, ASTC cannot carry content
 * across block boundaries -- this is inherently approximate and confined to
 * non-4-aligned levels.
 *
 * Partition fallback: the procedurally generated ASTC partition space is not
 * flip-closed (only 552/456/130 of 1024 seeds for 2/3/4 partitions have an exact
 * vertical flip). Non-representable flips fall back to the nearest flip-closed
 * seed (minimum Hamming distance over texel subset labels) so a second mirror
 * lands back on the same encoding.
 */
import { ASTC_10_LEVELS, ASTC_BISE_RANGE_TABLE, ASTC_DEC_ROWS } from "./compressedTables.js";
import { getBits, putBits } from "./compressedBits.js";

const ASTC_BLOCK_BYTES = 16;
/** bits 0..8 of a void-extent block mode field. */
const VOID_EXTENT_MODE_9 = 0b111111100;

/** Flip of a 4x4 scan-order texel index (rows reversed). */
const FLIP_TEXEL: readonly number[] = [12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3];

/** Per-value bit-reversal tables of the transcoder's weight writer (`s_reverse_bits*`). */
const REVERSE_VALUE: ReadonlyArray<readonly number[]> = [
  [],
  [0, 1],
  [0, 2, 1, 3],
  [0, 4, 2, 6, 1, 5, 3, 7],
  [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15],
  [
    0, 16, 8, 24, 4, 20, 12, 28, 2, 18, 10, 26, 6, 22, 14, 30, 1, 17, 9, 25, 5, 21, 13, 29, 3, 19,
    11, 27, 7, 23, 15, 31,
  ],
];

interface AstcConfig {
  voidExtent: boolean;
  gridWidth: number;
  gridHeight: number;
  dualPlane: boolean;
  weightRange: number;
  numPartitions: number;
  partitionSeed: number;
}

/** Ported basisu_astc_helpers.h decode_config() + post-config field reads. */
function parseConfig(data: Uint8Array, off: number): AstcConfig {
  const b0 = off * 8;
  if (getBits(data, b0, 4) === 0) {
    throw new Error("[compressedMirror] Reserved ASTC block mode (all-zero prefix)");
  }
  if (getBits(data, b0, 2) === 0 && getBits(data, b0 + 6, 3) === 0b111) {
    if (getBits(data, b0 + 2, 4) !== 0b1111) {
      throw new Error("[compressedMirror] Reserved ASTC block mode pattern");
    }
  }
  if (getBits(data, b0, 9) === VOID_EXTENT_MODE_9) {
    return {
      voidExtent: true,
      gridWidth: 0,
      gridHeight: 0,
      dualPlane: false,
      weightRange: 0,
      numPartitions: 1,
      partitionSeed: 0,
    };
  }

  const x0 = getBits(data, b0, 2);
  const x2 = getBits(data, b0 + 2, 2);
  const x5 = getBits(data, b0 + 5, 4);
  const x7 = getBits(data, b0 + 7, 2);
  const x8 = getBits(data, b0 + 8, 1);
  let row = -1;
  if (x0 === 0) {
    if (x7 === 0b00) row = 5;
    else if (x7 === 0b01) row = 6;
    else if (x5 === 0b1100) row = 7;
    else if (x5 === 0b1101) row = 8;
    else if (x7 === 0b10) row = 9;
  } else if (x2 === 0b00) row = 0;
  else if (x2 === 0b01) row = 1;
  else if (x2 === 0b10) row = 2;
  else if (x2 === 0b11 && x8 === 0) row = 3;
  else if (x2 === 0b11 && x8 === 1) row = 4;
  if (row < 0) throw new Error("[compressedMirror] Unmatched ASTC block mode row");

  const r = ASTC_DEC_ROWS[row]!;
  const P = r[1]! < 0 ? false : getBits(data, b0 + r[1]!, 1) === 1;
  const Dp = r[0]! < 0 ? false : getBits(data, b0 + r[0]!, 1) === 1;
  let gridW = r[6]!;
  let gridH = r[7]!;
  if (r[3]! > 0) gridW += getBits(data, b0 + r[2]!, r[3]!);
  if (r[5]! > 0) gridH += getBits(data, b0 + r[4]!, r[5]!);
  const p0 = getBits(data, b0 + r[8]!, 1);
  const p1 = getBits(data, b0 + r[9]!, 1);
  const p2 = getBits(data, b0 + r[10]!, 1);
  const p = p0 | (p1 << 1) | (p2 << 2);
  if (p < 2) throw new Error("[compressedMirror] Reserved ASTC weight precision pattern");

  const numPartitions = getBits(data, b0 + 11, 2) + 1;
  const partitionSeed = numPartitions > 1 ? getBits(data, b0 + 13, 10) : 0;
  return {
    voidExtent: false,
    gridWidth: gridW,
    gridHeight: gridH,
    dualPlane: Dp,
    weightRange: p - 2 + (P ? ASTC_10_LEVELS : 0),
    numPartitions,
    partitionSeed,
  };
}

/** Uniform-bit weight ranges only (basis emits trits/quints == 0 for weights). */
function bitsPerWeight(weightRange: number): number {
  const row = ASTC_BISE_RANGE_TABLE[weightRange];
  if (row === undefined || row[1] !== 0 || row[2] !== 0) {
    throw new Error(
      "[compressedMirror] ASTC weight ISE range must be uniform-bit (basis output contract)",
    );
  }
  return row[0]!;
}

/**
 * Number of weight values in the bitstream: dual-plane blocks store two planes
 * per grid texel, interleaved as `(gridIdx << 1) | plane`.
 */
function totalWeightValues(config: AstcConfig): number {
  return (config.dualPlane ? 2 : 1) * config.gridWidth * config.gridHeight;
}

/** Decodes the raw (ISE-coded) weight values in wire order (top-down, per-value reversed). */
function readWeights(data: Uint8Array, off: number, config: AstcConfig, total: number): number[] {
  const bits = bitsPerWeight(config.weightRange);
  const reverse = REVERSE_VALUE[bits]!;
  const values = new Array<number>(total);
  for (let i = 0; i < total; i++) {
    const bitPos = 128 - (i + 1) * bits;
    values[i] = reverse[getBits(data, off * 8 + bitPos, bits)]!;
  }
  return values;
}

/** Rewrites the weight region with the given raw values (same layout contract). */
function writeWeights(data: Uint8Array, off: number, config: AstcConfig, values: number[]): void {
  const bits = bitsPerWeight(config.weightRange);
  const reverse = REVERSE_VALUE[bits]!;
  for (let i = 0; i < values.length; i++) {
    const bitPos = 128 - (i + 1) * bits;
    putBits(data, off * 8 + bitPos, bits, reverse[values[i]!]!);
  }
}

/**
 * Precomputed partition-seed flip maps (one Int32Array per partition count).
 * Map[s] = seed whose pattern is the vertical flip of seed s's pattern (exact),
 * or the nearest flip-closed seed (Hamming distance over texel subset labels).
 */
const flipSeedCache: Array<Int32Array | null> = [null, null, null, null, null];

/** decodes the subset assignment (0..3) of texel (x, y) for the given seed/partition count. */
function computeTexelPartition(seedIn: number, xIn: number, yIn: number, numParts: number): number {
  // 4x4 blocks are small blocks (16 texels < 31): coordinates are doubled; the
  // seed9..seed12*z terms of the reference vanish for z == 0 and are omitted.
  const x = xIn << 1;
  const y = yIn << 1;
  const seed = (seedIn + 1024 * (numParts - 1)) >>> 0;
  const rnum = hash52(seed);
  let s1 = rnum & 0xf;
  let s2 = (rnum >> 4) & 0xf;
  let s3 = (rnum >> 8) & 0xf;
  let s4 = (rnum >> 12) & 0xf;
  let s5 = (rnum >> 16) & 0xf;
  let s6 = (rnum >> 20) & 0xf;
  let s7 = (rnum >> 24) & 0xf;
  let s8 = (rnum >> 28) & 0xf;
  s1 = (s1 * s1) & 0xff;
  s2 = (s2 * s2) & 0xff;
  s3 = (s3 * s3) & 0xff;
  s4 = (s4 * s4) & 0xff;
  s5 = (s5 * s5) & 0xff;
  s6 = (s6 * s6) & 0xff;
  s7 = (s7 * s7) & 0xff;
  s8 = (s8 * s8) & 0xff;
  const shA = (seed & 2) !== 0 ? 4 : 5;
  const shB = numParts === 3 ? 6 : 5;
  const sh1 = (seed & 1) !== 0 ? shA : shB;
  const sh2 = (seed & 1) !== 0 ? shB : shA;
  const a = 0x3f & ((s1 >> sh1) * x + (s2 >> sh2) * y + (rnum >> 14));
  const b = 0x3f & ((s3 >> sh1) * x + (s4 >> sh2) * y + (rnum >> 10));
  const c = numParts >= 3 ? 0x3f & ((s5 >> sh1) * x + (s6 >> sh2) * y + (rnum >> 6)) : 0;
  const d = numParts >= 4 ? 0x3f & ((s7 >> sh1) * x + (s8 >> sh2) * y + (rnum >> 2)) : 0;
  if (a >= b && a >= c && a >= d) return 0;
  if (b >= c && b >= d) return 1;
  if (c >= d) return 2;
  return 3;
}

/** Ported basisu_astc_helpers.h hash52 (uint32 wraps explicit). */
function hash52(v: number): number {
  let p = v >>> 0;
  p = (p ^ (p >>> 15)) >>> 0;
  p = (p - ((p << 17) & 0xffffffff)) >>> 0;
  p = (p + ((p << 7) & 0xffffffff)) >>> 0;
  p = (p + ((p << 4) & 0xffffffff)) >>> 0;
  p = (p ^ (p >>> 5)) >>> 0;
  p = (p + ((p << 16) & 0xffffffff)) >>> 0;
  p = (p ^ (p >>> 7)) >>> 0;
  p = (p ^ (p >>> 3)) >>> 0;
  p = (p ^ ((p << 6) & 0xffffffff)) >>> 0;
  p = (p ^ (p >>> 17)) >>> 0;
  return p >>> 0;
}

/** Number of texel positions (of 16) whose 2-bit subset groups differ between two packed patterns. */
const DIST_BYTE = ((): Uint8Array => {
  const table = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    let c = 0;
    for (let g = 0; g < 4; g++) if (((v >> (2 * g)) & 3) !== 0) c++;
    table[v] = c;
  }
  return table;
})();

function packedDistance(a: number, b: number): number {
  const d = (a ^ b) >>> 0;
  return (
    DIST_BYTE[d & 0xff]! +
    DIST_BYTE[(d >>> 8) & 0xff]! +
    DIST_BYTE[(d >>> 16) & 0xff]! +
    DIST_BYTE[(d >>> 24) & 0xff]!
  );
}

/** Packs a partition pattern into a uint32 (2 bits per texel, scan order). */
function packPattern(numParts: number, seed: number): number {
  let p = 0;
  for (let t = 0; t < 16; t++) {
    p |= computeTexelPartition(seed, t & 3, t >> 2, numParts) << (2 * t);
  }
  return p >>> 0;
}

function flipPacked(packed: number): number {
  let f = 0;
  for (let t = 0; t < 16; t++) {
    const srcT = FLIP_TEXEL[t]!;
    f |= ((packed >>> (2 * srcT)) & 3) << (2 * t);
  }
  return f >>> 0;
}

function flipSeedMapFor(numParts: number): Int32Array {
  const cached = flipSeedCache[numParts];
  if (cached !== null && cached !== undefined) return cached;
  const packeds = new Uint32Array(1024);
  for (let s = 0; s < 1024; s++) packeds[s] = packPattern(numParts, s);

  const exact = new Int32Array(1024).fill(-1);
  for (let s = 0; s < 1024; s++) {
    const f = flipPacked(packeds[s]!);
    for (let q = 0; q < 1024; q++) {
      if (packeds[q] === f) {
        exact[s] = q;
        break;
      }
    }
  }
  const results = new Int32Array(1024).fill(-1);
  for (let s = 0; s < 1024; s++) {
    if (exact[s]! >= 0) {
      results[s] = exact[s]!;
      continue;
    }
    const f = flipPacked(packeds[s]!);
    let best = -1;
    let bestDistance = Number.MAX_SAFE_INTEGER;
    for (let c = 0; c < 1024; c++) {
      if (exact[c]! < 0) continue; // flip-closed candidates only (stable under a second flip)
      const distance = packedDistance(packeds[c]!, f);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = c;
      }
    }
    results[s] = best >= 0 ? best : s;
  }
  flipSeedCache[numParts] = results;
  return results;
}

function flipPartitionSeed(seed: number, numParts: number): number {
  if (numParts <= 1) return 0;
  return flipSeedMapFor(numParts)[seed]!;
}

/**
 * Mirrors a whole ASTC plane. `width`/`height` are the logical texel dimensions;
 * the block grid is `ceil(w/4) x ceil(h/4)`. Grids are required to be 4x4 (the
 * basis transcoder contract for 4x4 blocks). Height-aligned levels are mirrored
 * bit-exactly (modulo the partition-fallback approximation for non-flip-closed
 * multi-partition patterns); non-4-aligned levels use the row-sourced boundary
 * approximation documented above.
 */
export function mirrorAstcPlane(data: Uint8Array, width: number, height: number): Uint8Array {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const out = new Uint8Array(data.length);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      // Map each output row to its true source row (block index + sub-row).
      const srcBys = [-1, -1, -1, -1];
      const srcJs = [-1, -1, -1, -1];
      for (let r = 0; r < 4; r++) {
        const outRow = by * 4 + r;
        if (outRow < height) {
          const inRow = height - 1 - outRow;
          srcBys[r] = inRow >> 2;
          srcJs[r] = inRow & 3;
        }
      }

      const dstOff = (bx + by * blocksX) * ASTC_BLOCK_BYTES;
      const dominant = srcBys[0]!;
      const domOff = (bx + dominant * blocksX) * ASTC_BLOCK_BYTES;
      // Start from the dominant block (codewords, endpoints, CEM, CCS, seed all
      // inherit from it), then patch the weight region.
      for (let i = 0; i < ASTC_BLOCK_BYTES; i++) out[dstOff + i] = data[domOff + i]!;
      const domCfg = parseConfig(out, dstOff);
      if (domCfg.voidExtent) continue;

      // Basis emits 4x4 weight grids only; anything else would need grid-to-texel
      // upsample handling the mirror deliberately does not implement.
      if (domCfg.gridWidth !== 4 || domCfg.gridHeight !== 4) {
        throw new Error("[compressedMirror] ASTC weight grid must be 4x4 (basis output contract)");
      }

      const total = totalWeightValues(domCfg);
      const table = new Map<number, { config: AstcConfig; values: number[] }>();
      const sourceWeights = (r: number): { config: AstcConfig; values: number[] } | null => {
        const sbY = srcBys[r]!;
        if (sbY === -1) return null;
        const idx = bx + sbY * blocksX;
        let entry = table.get(idx);
        if (entry === undefined) {
          const config = parseConfig(data, idx * ASTC_BLOCK_BYTES);
          entry = { config, values: [] };
          if (!config.voidExtent) {
            entry.values = readWeights(
              data,
              idx * ASTC_BLOCK_BYTES,
              config,
              totalWeightValues(config),
            );
          }
          table.set(idx, entry);
        }
        return entry;
      };

      const domEntry = sourceWeights(0)!;
      const domValues = domEntry.values;
      const outValues = new Array<number>(total).fill(0);

      // Row-sourced construction: every output texel takes the values of its true
      // source texel. Rows whose source block is incompatible (different weight
      // layout, or void/absent) fall back to the dominant block's own value at the
      // texel above it (`FLIP_TEXEL`), which is exact for aligned blocks.
      const layoutCompatible = (cfg: AstcConfig): boolean =>
        cfg.dualPlane === domCfg.dualPlane &&
        cfg.gridWidth === domCfg.gridWidth &&
        cfg.gridHeight === domCfg.gridHeight &&
        bitsPerWeight(cfg.weightRange) === bitsPerWeight(domCfg.weightRange);

      for (let r = 0; r < 4; r++) {
        const entry = sourceWeights(r);
        for (let x = 0; x < 4; x++) {
          const slot = x + r * 4;
          let values: number[];
          let srcT: number;
          if (entry !== null && entry.values.length > 0 && layoutCompatible(entry.config)) {
            values = entry.values;
            srcT = x + srcJs[r]! * 4;
          } else {
            values = domValues;
            srcT = FLIP_TEXEL[slot]!;
          }
          if (domCfg.dualPlane) {
            outValues[2 * slot] = values[2 * srcT]!;
            outValues[2 * slot + 1] = values[2 * srcT + 1]!;
          } else {
            outValues[slot] = values[srcT]!;
          }
        }
      }

      writeWeights(out, dstOff, domCfg, outValues);
      if (domCfg.numPartitions > 1) {
        putBits(
          out,
          dstOff * 8 + 13,
          10,
          flipPartitionSeed(domCfg.partitionSeed, domCfg.numPartitions),
        );
      }
    }
  }
  return out;
}

export {
  ASTC_BLOCK_BYTES,
  computeTexelPartition,
  flipPartitionSeed,
  parseConfig as parseAstcConfig,
  readWeights as readAstcWeights,
};
export type { AstcConfig };
