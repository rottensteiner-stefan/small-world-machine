/**
 * K02 test oracles: minimal, independent reference decoders for the block
 * formats the mirror operates on. Decoded texels are 16 x [r, g, b, a] in scan
 * order (y*4+x). Every decoder is ported from the authoritative wire layout of
 * the vendored Basis transcoder (`decoder_etc_block`, `dxt_block`,
 * `dxt5a_block`, `eac_block`) and the standard BC1/BC3/BC7 specifications --
 * deliberately NOT shared with the mirror implementation, so a bit-addressing
 * bug in the mirror cannot be masked by a symmetric bug here.
 *
 * `decodeEtc2` additionally returns the raw 3-bit EAC alpha index per texel as
 * an opaque 4th-channel-like tag list: the mirror permutes those 1:1, so the
 * flip contract must hold on the raw index values without interpreting the EAC
 * base/table bytes (which the mirror never touches).
 */

export type Texel = number[]; // 4 entries: [r, g, b, a]

export interface Etc2DecodeResult {
  texels: Texel[];
  /** Raw 3-bit EAC A8 index per texel (0..7), col-major like `eac_block::get_selector`. */
  eacIndex: number[];
}

/** Vertical flip of a 16-texel scan-order list (texel (x, y) <-> (x, 3-y)). */
export function flipPixels(pixels: Texel[]): Texel[] {
  const out: Texel[] = new Array(16);
  for (let t = 0; t < 16; t++) out[flipTexel52(t)] = pixels[t]!;
  return out;
}

/** Flip of a 4x4 scan-order texel slot (y*4+x) under a vertical mirror. */
export function flipTexel52(t: number): number {
  return (3 - (t >> 2)) * 4 + (t & 3);
}

/** LSB-first bit read over a byte array (standard for BC1/BC3/BC7). */
function getBits(bytes: Uint8Array, bitOffset: number, count: number): number {
  let value = 0;
  let shift = 0;
  let pos = bitOffset;
  let remaining = count;
  while (remaining > 0) {
    const take = Math.min(remaining, 8 - (pos & 7));
    const byte = bytes[pos >> 3]!;
    const chunk = (byte >> (pos & 7)) & ((1 << take) - 1);
    value |= chunk << shift;
    shift += take;
    pos += take;
    remaining -= take;
  }
  return value >>> 0;
}

/**
 * ETC2 big-endian wire read: `subBlock` is the byte base of the 8-byte ETC
 * sub-block; `specBit` counts from the sub-block's LSB (byte base+7 bit 0).
 * Mirrors `decoder_etc_block` byte indexing (byte 0 holds spec bits 63..56).
 */
function etcB(subBlock: Uint8Array, specBit: number, count: number): number {
  let value = 0;
  for (let i = 0; i < count; i++) {
    const bp = specBit + i;
    const byte = subBlock[7 - (bp >> 3)]!;
    if ((byte >> (bp & 7)) & 1) value |= 1 << i;
  }
  return value >>> 0;
}

// ---------------------------------------------------------------------------
// BC1 (DXT1)
// ---------------------------------------------------------------------------

function expand565(v: number): Texel {
  const r5 = (v >> 11) & 31;
  const g6 = (v >> 5) & 63;
  const b5 = v & 31;
  return [(r5 << 3) | (r5 >> 2), (g6 << 2) | (g6 >> 4), (b5 << 3) | (b5 >> 2), 255];
}

/** Decodes a BC1 block (8 bytes) to 16 RGBA texels. */
export function decodeBc1(block: Uint8Array, off = 0): Texel[] {
  const c0 = block[off]! | (block[off + 1]! << 8);
  const c1 = block[off + 2]! | (block[off + 3]! << 8);
  const e0 = expand565(c0);
  const e1 = expand565(c1);
  const palette: Texel[] =
    c0 > c1
      ? [
          e0,
          e1,
          [(2 * e0[0]! + e1[0]!) / 3, (2 * e0[1]! + e1[1]!) / 3, (2 * e0[2]! + e1[2]!) / 3, 255],
          [(e0[0]! + 2 * e1[0]!) / 3, (e0[1]! + 2 * e1[1]!) / 3, (e0[2]! + 2 * e1[2]!) / 3, 255],
        ]
      : [
          e0,
          e1,
          [(e0[0]! + e1[0]!) / 2, (e0[1]! + e1[1]!) / 2, (e0[2]! + e1[2]!) / 2, 255],
          [0, 0, 0, 0],
        ];
  const texels: Texel[] = new Array(16);
  for (let y = 0; y < 4; y++) {
    const row = block[off + 4 + y]!;
    for (let x = 0; x < 4; x++) {
      texels[y * 4 + x] = palette[(row >> (2 * x)) & 3]!;
    }
  }
  return texels;
}

// ---------------------------------------------------------------------------
// BC3 (DXT5): DXT5 alpha (bytes 0..7) + DXT1 color (bytes 8..15)
// ---------------------------------------------------------------------------

function dxt5AlphaPalette(a0: number, a1: number): number[] {
  const pal = new Array<number>(8);
  pal[0] = a0;
  pal[1] = a1;
  if (a0 > a1) {
    for (let i = 2; i < 8; i++) pal[i] = Math.min(255, ((8 - i) * a0 + (i - 1) * a1) / 7);
  } else {
    for (let i = 2; i < 6; i++) pal[i] = Math.min(255, ((6 - i) * a0 + (i - 1) * a1) / 5);
    pal[6] = 0;
    pal[7] = 255;
  }
  return pal;
}

/** Decodes a BC3 block (16 bytes) to 16 RGBA texels. */
export function decodeBc3(block: Uint8Array, off = 0): Texel[] {
  const color = decodeBc1(block, off + 8);
  const a0 = block[off]!;
  const a1 = block[off + 1]!;
  const pal = dxt5AlphaPalette(a0, a1);
  const texels: Texel[] = new Array(16);
  for (let t = 0; t < 16; t++) {
    const idx = getBits(block, off * 8 + 16 + 3 * t, 3);
    const c = color[t]!;
    texels[t] = [c[0]!, c[1]!, c[2]!, pal[idx]!];
  }
  return texels;
}

// ---------------------------------------------------------------------------
// ETC2 RGBA8: EAC alpha (bytes 0..7) + ETC1 RGB (bytes 8..15)
// ---------------------------------------------------------------------------

/** Basis `g_etc1_inten_tables` (N=1) -- selector-value intensity offsets. */
const INTEN_TABLES: readonly (readonly number[])[] = [
  [-8, -2, 2, 8],
  [-17, -5, 5, 17],
  [-29, -9, 9, 29],
  [-42, -13, 13, 42],
  [-60, -18, 18, 60],
  [-80, -24, 24, 80],
  [-106, -33, 33, 106],
  [-183, -47, 47, 183],
];

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function clamp5(v: number): number {
  return v < 0 ? 0 : v > 31 ? 31 : v;
}

function expand5(v: number): number {
  return (v << 3) | (v >> 2);
}

/**
 * Decodes the ETC1 RGB sub-block (basis `get_block_colors`, byte layout of
 * `decoder_etc_block`). Sub-block field positions (verified against
 * `transcode_uastc_to_etc1` + cETC1*BitOffset): flip=32, diff=33, inten1=34..36,
 * inten0=37..39, deltas dB=40..42/dG=48..50/dR=56..58, bases bB=43..47,
 * bG=51..55, bR=59..63; individual colors are interleaved nibbles (color0 in the
 * high nibble of bytes 1..3, color1 in the low nibble).
 */
export function decodeEtcRgb(sub: Uint8Array): number[] {
  // 16 RGB texels as flat [r,g,b,...]
  const rgb = new Array<number>(16 * 3);
  const flip = etcB(sub, 32, 1);
  const diff = etcB(sub, 33, 1);
  const inten0 = etcB(sub, 37, 3);
  const inten1 = etcB(sub, 34, 3);

  let base0: number[]; // per-channel 8-bit "unscaled" color of region 0
  let base1: number[];
  if (diff) {
    const b0r = etcB(sub, 59, 5);
    const b0g = etcB(sub, 51, 5);
    const b0b = etcB(sub, 43, 5);
    const dr = sign3(etcB(sub, 56, 3));
    const dg = sign3(etcB(sub, 48, 3));
    const db = sign3(etcB(sub, 40, 3));
    base0 = [expand5(b0r), expand5(b0g), expand5(b0b)];
    let r = b0r + dr;
    let g = b0g + dg;
    let b = b0b + db;
    // Out-of-range detection both directions (basis `unpack_color5` uses
    // `(r|g|b) & ~31`; a JS `> 31` alone misses underflow because the bitwise OR
    // of a negative component is negative). Clamp at 5 bits then expand = Khronos
    // ETC1 GPU semantics (a `clamp255(x << 3)` would give 255 on overflow, which
    // no GPU implements -- the mirror targets the GPU wire format).
    if (((r | g | b) & ~31) !== 0) {
      r = clamp5(r);
      g = clamp5(g);
      b = clamp5(b);
    }
    base1 = [expand5(r), expand5(g), expand5(b)];
  } else {
    const c0 = [etcB(sub, 60, 4), etcB(sub, 52, 4), etcB(sub, 44, 4)];
    const c1 = [etcB(sub, 56, 4), etcB(sub, 48, 4), etcB(sub, 40, 4)];
    base0 = c0.map((v) => (v << 4) | v);
    base1 = c1.map((v) => (v << 4) | v);
  }

  const subblockOf = (x: number, y: number): number =>
    flip === 0 ? (y < 2 ? 0 : 1) : x < 2 ? 0 : 1;
  const intenOf = (x: number, y: number): number => (subblockOf(x, y) === 0 ? inten0 : inten1);
  const baseOf = (x: number, y: number): number[] => (subblockOf(x, y) === 0 ? base0 : base1);

  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const sel = rawEtcSelector(sub, x, y);
      const inten = INTEN_TABLES[intenOf(x, y)]!;
      const base = baseOf(x, y);
      const o = (y * 4 + x) * 3;
      rgb[o] = clamp255(base[0]! + inten[sel]!);
      rgb[o + 1] = clamp255(base[1]! + inten[sel]!);
      rgb[o + 2] = clamp255(base[2]! + inten[sel]!);
    }
  }
  return rgb;
}

function sign3(v: number): number {
  return v >= 4 ? v - 8 : v;
}

/** Raw 2-bit ETC selector value (basis `get_raw_selector` -- LSB plane + 16-bit-offset MSB plane). */
export function rawEtcSelector(sub: Uint8Array, x: number, y: number): number {
  const bi = x * 4 + y;
  return (etcB(sub, bi, 1) | (etcB(sub, bi + 16, 1) << 1)) & 3;
}

/** Raw 3-bit EAC A8 index of texel (x, y) (col-major, MSB-first in bytes 2..7). */
export function rawEacIndex(block: Uint8Array, off: number, x: number, y: number): number {
  const t = x * 4 + y;
  return etcB(block.subarray(off, off + 8), 45 - 3 * t, 3);
}

/** Full ETC2 RGBA8 decode: RGB via ETC1 rules + raw EAC index tag per texel. */
export function decodeEtc2(block: Uint8Array, off = 0): Etc2DecodeResult {
  const rgb = decodeEtcRgb(block.subarray(off + 8, off + 16));
  const eacIndex: number[] = new Array(16);
  const texels: Texel[] = new Array(16);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const t = y * 4 + x;
      texels[t] = [rgb[t * 3]!, rgb[t * 3 + 1]!, rgb[t * 3 + 2]!, 255];
      eacIndex[t] = rawEacIndex(block, off, x, y);
    }
  }
  return { texels, eacIndex };
}

// ---------------------------------------------------------------------------
// BC7 (BPTC) -- ported from basis_universal master `unpack_bc7*`
// ---------------------------------------------------------------------------

import {
  BC7_ANCHOR_SECOND_SUBSET,
  BC7_ANCHOR_THIRD_SUBSET_1,
  BC7_ANCHOR_THIRD_SUBSET_2,
  BC7_PARTITION_2_SUBSET,
  BC7_PARTITION_3_SUBSET,
} from "../../src/basisu/compressedTables.js";

const BC7_WEIGHTS2 = [0, 21, 43, 64];
const BC7_WEIGHTS3 = [0, 9, 18, 27, 37, 46, 55, 64];
const BC7_WEIGHTS4 = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64];

function bc7Dequant(val: number, pbit: number, valBits: number): number {
  const totalBits = valBits + 1;
  let v = ((val << 1) | pbit) << (8 - totalBits);
  v |= v >> totalBits;
  return v;
}

function bc7DequantNoPbit(val: number, valBits: number): number {
  let v = val << (8 - valBits);
  v |= v >> valBits;
  return v;
}

function bc7Interp(l: number, h: number, w: number, bits: number): number {
  const table = bits === 2 ? BC7_WEIGHTS2 : bits === 3 ? BC7_WEIGHTS3 : BC7_WEIGHTS4;
  return (l * (64 - table[w]!) + h * table[w]! + 32) >> 6;
}

function ctz(b: number): number {
  if (b === 0) return -1;
  let n = 0;
  while (!(b & 1)) {
    b >>= 1;
    n++;
  }
  return n;
}

function decodeBc7Mode0_2(block: Uint8Array, off: number, mode: number): Texel[] {
  const endpoints = 6;
  const weightBits = mode === 0 ? 3 : 2;
  const endpointBits = mode === 0 ? 4 : 5;
  const pBits = mode === 0 ? 6 : 0;
  const weightVals = 1 << weightBits;
  let bitOffset = 0;
  if (getBits(block, off * 8 + bitOffset, mode + 1) !== 1 << mode) return [];
  bitOffset += mode + 1;
  const part = getBits(block, off * 8 + bitOffset, mode === 0 ? 4 : 6);
  bitOffset += mode === 0 ? 4 : 6;
  const endpointsRaw: number[][] = [];
  for (let c = 0; c < 3; c++) {
    for (let e = 0; e < endpoints; e++) {
      endpointsRaw[e] ??= [];
      endpointsRaw[e]![c] = getBits(block, off * 8 + bitOffset, endpointBits);
      bitOffset += endpointBits;
    }
  }
  const pbits: number[] = [];
  for (let p = 0; p < pBits; p++) {
    pbits[p] = getBits(block, off * 8 + bitOffset, 1);
    bitOffset += 1;
  }
  const weights: number[] = new Array(16);
  for (let i = 0; i < 16; i++) {
    const anchor =
      i === 0 || i === BC7_ANCHOR_THIRD_SUBSET_1[part]! || i === BC7_ANCHOR_THIRD_SUBSET_2[part]!;
    weights[i] = getBits(block, off * 8 + bitOffset, anchor ? weightBits - 1 : weightBits);
    bitOffset += anchor ? weightBits - 1 : weightBits;
  }
  const endpointsDeQ: number[][] = [];
  for (let e = 0; e < endpoints; e++) {
    endpointsDeQ[e] = [];
    for (let c = 0; c < 4; c++) {
      endpointsDeQ[e]![c] =
        c === 3
          ? 255
          : pBits
            ? bc7Dequant(endpointsRaw[e]![c]!, pbits[e]!, endpointBits)
            : bc7DequantNoPbit(endpointsRaw[e]![c]!, endpointBits);
    }
  }
  const blockColors: number[][][] = [];
  for (let s = 0; s < 3; s++) {
    blockColors[s] = [];
    for (let i = 0; i < weightVals; i++) {
      const row: Texel = new Array(4);
      for (let c = 0; c < 3; c++)
        row[c] = bc7Interp(endpointsDeQ[s * 2]![c]!, endpointsDeQ[s * 2 + 1]![c]!, i, weightBits);
      row[3] = 255;
      blockColors[s]![i] = row;
    }
  }
  const texels: Texel[] = new Array(16);
  for (let i = 0; i < 16; i++) {
    texels[i] = blockColors[BC7_PARTITION_3_SUBSET[part * 16 + i]!]![weights[i]!]!;
  }
  return texels;
}

function decodeBc7Mode1_3_7(block: Uint8Array, off: number, mode: number): Texel[] {
  const endpoints = 4;
  const comps = mode === 7 ? 4 : 3;
  const weightBits = mode === 1 ? 3 : 2;
  const endpointBits = mode === 7 ? 5 : mode === 1 ? 6 : 7;
  const pBits = mode === 1 ? 2 : 4;
  const sharedPbits = mode === 1;
  const weightVals = 1 << weightBits;
  let bitOffset = 0;
  if (getBits(block, off * 8 + bitOffset, mode + 1) !== 1 << mode) return [];
  bitOffset += mode + 1;
  const part = getBits(block, off * 8 + bitOffset, 6);
  bitOffset += 6;
  const endpointsRaw: number[][] = [];
  for (let c = 0; c < comps; c++) {
    for (let e = 0; e < endpoints; e++) {
      endpointsRaw[e] ??= [];
      endpointsRaw[e]![c] = getBits(block, off * 8 + bitOffset, endpointBits);
      bitOffset += endpointBits;
    }
  }
  const pbits: number[] = [];
  for (let p = 0; p < pBits; p++) {
    pbits[p] = getBits(block, off * 8 + bitOffset, 1);
    bitOffset += 1;
  }
  const weights: number[] = new Array(16);
  for (let i = 0; i < 16; i++) {
    const anchor = i === 0 || i === BC7_ANCHOR_SECOND_SUBSET[part]!;
    weights[i] = getBits(block, off * 8 + bitOffset, anchor ? weightBits - 1 : weightBits);
    bitOffset += anchor ? weightBits - 1 : weightBits;
  }
  const endpointsDeQ: number[][] = [];
  for (let e = 0; e < endpoints; e++) {
    endpointsDeQ[e] = [];
    for (let c = 0; c < 4; c++) {
      endpointsDeQ[e]![c] =
        c === (mode === 7 ? 4 : 3)
          ? 255
          : bc7Dequant(endpointsRaw[e]![c]!, pbits[sharedPbits ? e >> 1 : e]!, endpointBits);
    }
  }
  const blockColors: number[][][] = [];
  for (let s = 0; s < 2; s++) {
    blockColors[s] = [];
    for (let i = 0; i < weightVals; i++) {
      const row: Texel = new Array(4);
      for (let c = 0; c < comps; c++)
        row[c] = bc7Interp(endpointsDeQ[s * 2]![c]!, endpointsDeQ[s * 2 + 1]![c]!, i, weightBits);
      row[3] = comps === 3 ? 255 : row[3]!;
      blockColors[s]![i] = row;
    }
  }
  const texels: Texel[] = new Array(16);
  for (let i = 0; i < 16; i++) {
    texels[i] = blockColors[BC7_PARTITION_2_SUBSET[part * 16 + i]!]![weights[i]!]!;
  }
  return texels;
}

function decodeBc7Mode4_5(block: Uint8Array, off: number, mode: number): Texel[] {
  const endpoints = 2;
  const comps = 4;
  const weightBits = 2;
  const aWeightBits = mode === 4 ? 3 : 2;
  const endpointBits = mode === 4 ? 5 : 7;
  const aEndpointBits = mode === 4 ? 6 : 8;
  let bitOffset = 0;
  if (getBits(block, off * 8 + bitOffset, mode + 1) !== 1 << mode) return [];
  bitOffset += mode + 1;
  const compRot = getBits(block, off * 8 + bitOffset, 2);
  bitOffset += 2;
  const indexMode = mode === 4 ? getBits(block, off * 8 + bitOffset, 1) : 0;
  if (mode === 4) bitOffset += 1;
  const endpointsRaw: number[][] = [];
  for (let c = 0; c < comps; c++) {
    for (let e = 0; e < endpoints; e++) {
      endpointsRaw[e] ??= [];
      endpointsRaw[e]![c] = getBits(
        block,
        off * 8 + bitOffset,
        c === 3 ? aEndpointBits : endpointBits,
      );
      bitOffset += c === 3 ? aEndpointBits : endpointBits;
    }
  }
  const weightBitsPlan = [
    indexMode ? aWeightBits : weightBits,
    indexMode ? weightBits : aWeightBits,
  ];
  const weights: number[] = new Array(16);
  const aWeights: number[] = new Array(16);
  for (let i = 0; i < 16; i++) {
    const arr = indexMode ? aWeights : weights;
    arr[i] = getBits(block, off * 8 + bitOffset, weightBitsPlan[indexMode]! - (i === 0 ? 1 : 0));
    bitOffset += weightBitsPlan[indexMode]! - (i === 0 ? 1 : 0);
  }
  for (let i = 0; i < 16; i++) {
    const arr = indexMode ? weights : aWeights;
    arr[i] = getBits(
      block,
      off * 8 + bitOffset,
      weightBitsPlan[1 - indexMode]! - (i === 0 ? 1 : 0),
    );
    bitOffset += weightBitsPlan[1 - indexMode]! - (i === 0 ? 1 : 0);
  }
  const endpointsDeQ: number[][] = [];
  for (let e = 0; e < endpoints; e++) {
    endpointsDeQ[e] = [];
    for (let c = 0; c < 4; c++) {
      endpointsDeQ[e]![c] = bc7DequantNoPbit(
        endpointsRaw[e]![c]!,
        c === 3 ? aEndpointBits : endpointBits,
      );
    }
  }
  const colorCount = 1 << weightBitsPlan[0]!;
  const alphaCount = 1 << weightBitsPlan[1]!;
  const blockColors: Texel[] = new Array(Math.max(colorCount, alphaCount));
  for (let i = 0; i < colorCount; i++) {
    const row: Texel = new Array(4);
    for (let c = 0; c < 3; c++)
      row[c] = bc7Interp(endpointsDeQ[0]![c]!, endpointsDeQ[1]![c]!, i, weightBitsPlan[0]!);
    row[3] = 0;
    blockColors[i] = row;
  }
  for (let i = 0; i < alphaCount; i++) {
    const ac = bc7Interp(endpointsDeQ[0]![3]!, endpointsDeQ[1]![3]!, i, weightBitsPlan[1]!);
    const row = blockColors[i] ?? (blockColors[i] = new Array<number>(4));
    row[3] = ac;
  }
  const texels: Texel[] = new Array(16);
  for (let i = 0; i < 16; i++) {
    const c: Texel = blockColors[weights[i]!]!.slice() as Texel;
    c[3] = blockColors[aWeights[i]!]![3]!;
    if (compRot >= 1) {
      const tmp = c[3]!;
      c[3] = c[compRot - 1]!;
      c[compRot - 1] = tmp;
    }
    texels[i] = c;
  }
  return texels;
}

function decodeBc7Mode6(block: Uint8Array, off: number): Texel[] {
  let bitOffset = 0;
  if (getBits(block, off * 8 + bitOffset, 7) !== 1 << 6) return [];
  bitOffset += 7;
  // Wire order is component-major (basis `bc7_mode_6::m_lo`): r0, r1, g0, g1,
  // b0, b1, a0, a1 -- NOT endpoint-major.
  const r0 = getBits(block, off * 8 + bitOffset, 7);
  bitOffset += 7;
  const r1 = getBits(block, off * 8 + bitOffset, 7);
  bitOffset += 7;
  const g0 = getBits(block, off * 8 + bitOffset, 7);
  bitOffset += 7;
  const g1 = getBits(block, off * 8 + bitOffset, 7);
  bitOffset += 7;
  const b0 = getBits(block, off * 8 + bitOffset, 7);
  bitOffset += 7;
  const b1 = getBits(block, off * 8 + bitOffset, 7);
  bitOffset += 7;
  const a0 = getBits(block, off * 8 + bitOffset, 7);
  bitOffset += 7;
  const a1 = getBits(block, off * 8 + bitOffset, 7);
  bitOffset += 7;
  const p0 = getBits(block, off * 8 + bitOffset, 1);
  bitOffset += 1;
  const p1 = getBits(block, off * 8 + bitOffset, 1);
  bitOffset += 1;
  const er0 = (r0 << 1) | p0;
  const eg0 = (g0 << 1) | p0;
  const eb0 = (b0 << 1) | p0;
  const ea0 = (a0 << 1) | p0;
  const er1 = (r1 << 1) | p1;
  const eg1 = (g1 << 1) | p1;
  const eb1 = (b1 << 1) | p1;
  const ea1 = (a1 << 1) | p1;
  const vals: Texel[] = new Array(16);
  for (let i = 0; i < 16; i++) {
    const w = BC7_WEIGHTS4[i]!;
    const iw = 64 - w;
    vals[i] = [
      (er0 * iw + er1 * w + 32) >> 6,
      (eg0 * iw + eg1 * w + 32) >> 6,
      (eb0 * iw + eb1 * w + 32) >> 6,
      (ea0 * iw + ea1 * w + 32) >> 6,
    ];
  }
  const texels: Texel[] = new Array(16);
  for (let i = 0; i < 16; i++) {
    // Anchor: texel 0 carries 3 of the 4 index bits (basis `bc7_mode_6::m_s00`
    // is 3 bits); every other texel reads a full 4-bit index.
    const w = getBits(block, off * 8 + bitOffset, i === 0 ? 3 : 4);
    texels[i] = vals[w]!;
    bitOffset += i === 0 ? 3 : 4;
  }
  return texels;
}

/** Decodes a BC7 block (16 bytes) to 16 RGBA texels; [] for an invalid mode field. */
export function decodeBc7(block: Uint8Array, off = 0): Texel[] {
  const mode = ctz(block[off]!);
  switch (mode) {
    case 0:
    case 2:
      return decodeBc7Mode0_2(block, off, mode);
    case 1:
    case 3:
    case 7:
      return decodeBc7Mode1_3_7(block, off, mode);
    case 4:
    case 5:
      return decodeBc7Mode4_5(block, off, mode);
    case 6:
      return decodeBc7Mode6(block, off);
    default:
      return [];
  }
}
