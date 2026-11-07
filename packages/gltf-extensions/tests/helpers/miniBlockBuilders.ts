/**
 * K02 test oracles: independent synthetic block writers. Every writer packs a
 * structurally valid block in the exact wire layout of the vendored Basis
 * transcoder output -- deliberately NOT shared with the mirror implementation.
 * Field positions match the decoders in `miniBlockCodecs.ts`.
 *
 * ASTC blocks are written with grid 4x4 (block mode row 0, the only rows basis
 * emits): W=4, H=4 (H-extra=2), weight ranges 0 (1-bit) or 2 (2-bit), optional
 * dual plane, optional partition seed. The mirror only reads the block mode,
 * weight precision, and partition/seed fields -- colors (CEM) are set to a
 * plausible LDR value but never interpreted by any K02 test.
 */

export interface Etc2BlockOpts {
  diff?: boolean;
  flip?: boolean;
  inten0?: number;
  inten1?: number;
  /** when true and diff, base/delta are picked so delta never equals -4. */
  avoidDeltaNeg4?: boolean;
  /** random diff base range (inclusive), keeps base+delta in range for clamp-free blocks. */
  diffBaseMin?: number;
  diffBaseMax?: number;
  /** explicit [baseR, baseG, baseB] / [deltaR, deltaG, deltaB] overrides. */
  diffBase?: number[];
  diffDelta?: number[];
}

export interface Bc7BlockOpts {
  partition: number;
}

export interface AstcBlockOpts {
  numParts: number;
  seed: number;
  dualPlane: boolean;
  weightRange: number;
  /** raw weight values in wire order (length 16 or 32 for dual plane). */
  weights?: number[];
}

/** Deterministic PRNG (mulberry32) so failing tests are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** LSB-first bit write (standard, matches `getBits` in miniBlockCodecs). */
function setBits(bytes: Uint8Array, bitOffset: number, count: number, value: number): void {
  let pos = bitOffset;
  let remaining = count;
  let v = value >>> 0;
  while (remaining > 0) {
    const take = Math.min(remaining, 8 - (pos & 7));
    const mask = (1 << take) - 1;
    const idx = pos >> 3;
    bytes[idx] = (bytes[idx]! & ~(mask << (pos & 7))) | (((v & mask) << (pos & 7)) & 0xff);
    v >>>= take;
    pos += take;
    remaining -= take;
  }
}

/** ETC2 big-endian wire write: `base` is the 8-byte sub-block base; `specBit` counts from its LSB. */
function etcPut(sub: Uint8Array, specBit: number, count: number, value: number): void {
  for (let i = 0; i < count; i++) {
    const bp = specBit + i;
    const idx = 7 - (bp >> 3);
    const mask = 1 << (bp & 7);
    if ((value >> i) & 1) sub[idx] = sub[idx]! | mask;
    else sub[idx] = sub[idx]! & ~mask;
  }
}

/** Random BC1 block (8 bytes): ordered color words half of the time, random selectors. */
export function buildBc1(rng: () => number): Uint8Array {
  const b = new Uint8Array(8);
  const c0 = (rng() * 65536) | 0;
  const c1 = (rng() * 65536) | 0;
  const ordered = rng() > 0.5 ? [c0, c1] : [c0 > c1 ? c1 : c0, c0, c1].slice(0, 2);
  b[0] = ordered[0]! & 0xff;
  b[1] = (ordered[0]! >> 8) & 0xff;
  b[2] = ordered[1]! & 0xff;
  b[3] = (ordered[1]! >> 8) & 0xff;
  for (let y = 0; y < 4; y++) {
    let row = 0;
    for (let x = 0; x < 4; x++) row |= ((rng() * 4) | 0) << (2 * x);
    b[4 + y] = row;
  }
  return b;
}

/** Random BC3 block (16 bytes): DXT5 alpha + BC1 color. */
export function buildBc3(rng: () => number): Uint8Array {
  const b = new Uint8Array(16);
  b[0] = (rng() * 256) | 0;
  b[1] = (rng() * 256) | 0;
  for (let t = 0; t < 16; t++) setBits(b, 16 + 3 * t, 3, (rng() * 8) | 0);
  const color = buildBc1(rng);
  b.set(color, 8);
  return b;
}

/** Random ETC2 RGBA8 block (16 bytes): EAC alpha + ETC1 RGB. */
export function buildEtc2(rng: () => number, opts: Etc2BlockOpts = {}): Uint8Array {
  const b = new Uint8Array(16);
  // EAC alpha sub-block (bytes 0..7): random base/table/multiplier + col-major selectors.
  const eac = b.subarray(0, 8);
  eac[0] = (rng() * 256) | 0;
  eac[1] = (rng() * 256) | 0;
  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      const t = x * 4 + y;
      etcPut(eac, 45 - 3 * t, 3, (rng() * 8) | 0);
    }
  }

  const rgb = b.subarray(8, 16);
  const diff = opts.diff ?? rng() > 0.5;
  etPutBit(rgb, 32, opts.flip ?? rng() > 0.5);
  etPutBit(rgb, 33, diff);
  etcPut(rgb, 37, 3, opts.inten0 ?? (rng() * 8) | 0);
  etcPut(rgb, 34, 3, opts.inten1 ?? (rng() * 8) | 0);
  if (diff) {
    let dr = (rng() * 8) | 0;
    dr = dr >= 4 ? dr - 8 : dr;
    let dg = (rng() * 8) | 0;
    dg = dg >= 4 ? dg - 8 : dg;
    let db = (rng() * 8) | 0;
    db = db >= 4 ? db - 8 : db;
    if (opts.avoidDeltaNeg4) {
      if (dr === -4) dr = -3;
      if (dg === -4) dg = -3;
      if (db === -4) db = -3;
    }
    const lo = opts.diffBaseMin ?? 0;
    const hi = opts.diffBaseMax ?? 31;
    const base = opts.diffBase ?? [
      lo + ((rng() * (hi - lo + 1)) | 0),
      lo + ((rng() * (hi - lo + 1)) | 0),
      lo + ((rng() * (hi - lo + 1)) | 0),
    ];
    const delta = opts.diffDelta ?? [dr, dg, db];
    const raw = [0, 0, 0];
    for (let c = 0; c < 3; c++) raw[c] = delta[c]! < 0 ? delta[c]! + 8 : delta[c]!;
    etcPut(rgb, 59, 5, base[0]!);
    etcPut(rgb, 51, 5, base[1]!);
    etcPut(rgb, 43, 5, base[2]!);
    etcPut(rgb, 56, 3, raw[0]!);
    etcPut(rgb, 48, 3, raw[1]!);
    etcPut(rgb, 40, 3, raw[2]!);
  } else {
    const c0 = [(rng() * 16) | 0, (rng() * 16) | 0, (rng() * 16) | 0];
    const c1 = [(rng() * 16) | 0, (rng() * 16) | 0, (rng() * 16) | 0];
    etcPut(rgb, 60, 4, c0[0]!);
    etcPut(rgb, 52, 4, c0[1]!);
    etcPut(rgb, 44, 4, c0[2]!);
    etcPut(rgb, 56, 4, c1[0]!);
    etcPut(rgb, 48, 4, c1[1]!);
    etcPut(rgb, 40, 4, c1[2]!);
  }
  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      const bi = x * 4 + y;
      const sel = (rng() * 4) | 0;
      etcPut(rgb, bi, 1, sel & 1);
      etcPut(rgb, bi + 16, 1, (sel >> 1) & 1);
    }
  }
  return b;
}

function etPutBit(sub: Uint8Array, specBit: number, v: boolean): void {
  etcPut(sub, specBit, 1, v ? 1 : 0);
}

import {
  BC7_ANCHOR_SECOND_SUBSET,
  BC7_ANCHOR_THIRD_SUBSET_1,
  BC7_ANCHOR_THIRD_SUBSET_2,
} from "../../src/basisu/compressedTables.js";

/**
 * Builds a valid BC7 block for the given mode and partition. Mode 6 is the only
 * single-subset modes without a partition field; modes 4/5 have no partition
 * either (single subset) and carry rotation + separate alpha indices.
 */
export function buildBc7(mode: number, partition: number, rng: () => number): Uint8Array {
  const b = new Uint8Array(16);
  const pos = { o: 0 };
  const w = (count: number, value: number): void => {
    setBits(b, pos.o, count, value);
    pos.o += count;
  };
  w(mode + 1, 1 << mode);
  if (mode === 0) {
    w(4, partition);
    for (let c = 0; c < 3; c++) for (let e = 0; e < 6; e++) w(4, (rng() * 16) | 0);
    for (let p = 0; p < 6; p++) w(1, (rng() * 2) | 0);
    for (let i = 0; i < 16; i++) {
      const anchor =
        i === 0 ||
        i === BC7_ANCHOR_THIRD_SUBSET_1[partition] ||
        i === BC7_ANCHOR_THIRD_SUBSET_2[partition];
      w(anchor ? 2 : 3, (rng() * (anchor ? 4 : 8)) | 0);
    }
  } else if (mode === 1) {
    w(6, partition);
    for (let c = 0; c < 3; c++) for (let e = 0; e < 4; e++) w(6, (rng() * 64) | 0);
    for (let p = 0; p < 2; p++) w(1, (rng() * 2) | 0);
    for (let i = 0; i < 16; i++) {
      const anchor = i === 0 || i === BC7_ANCHOR_SECOND_SUBSET[partition];
      w(anchor ? 2 : 3, (rng() * (anchor ? 4 : 8)) | 0);
    }
  } else if (mode === 2) {
    w(6, partition);
    for (let c = 0; c < 3; c++) for (let e = 0; e < 6; e++) w(5, (rng() * 32) | 0);
    for (let i = 0; i < 16; i++) {
      const anchor =
        i === 0 ||
        i === BC7_ANCHOR_THIRD_SUBSET_1[partition] ||
        i === BC7_ANCHOR_THIRD_SUBSET_2[partition];
      w(anchor ? 1 : 2, (rng() * (anchor ? 2 : 4)) | 0);
    }
  } else if (mode === 3) {
    w(6, partition);
    for (let c = 0; c < 3; c++) for (let e = 0; e < 4; e++) w(7, (rng() * 128) | 0);
    for (let p = 0; p < 4; p++) w(1, (rng() * 2) | 0);
    for (let i = 0; i < 16; i++) {
      const anchor = i === 0 || i === BC7_ANCHOR_SECOND_SUBSET[partition];
      w(anchor ? 1 : 2, (rng() * (anchor ? 2 : 4)) | 0);
    }
  } else if (mode === 4) {
    w(2, (rng() * 4) | 0); // rotation
    const indexMode = (rng() * 2) | 0;
    w(1, indexMode);
    // Endpoint precisions are fixed for the mode (5-bit RGB / 6-bit alpha);
    // indexMode only swaps which index plane is 2-bit vs 3-bit.
    for (let c = 0; c < 3; c++) for (let e = 0; e < 2; e++) w(5, (rng() * 32) | 0);
    for (let e = 0; e < 2; e++) w(6, (rng() * 64) | 0);
    for (let i = 0; i < 16; i++) w((indexMode ? 3 : 2) - (i === 0 ? 1 : 0), 0);
    for (let i = 0; i < 16; i++) w((indexMode ? 2 : 3) - (i === 0 ? 1 : 0), 0);
  } else if (mode === 5) {
    w(2, (rng() * 4) | 0); // rotation
    for (let c = 0; c < 3; c++) for (let e = 0; e < 2; e++) w(7, (rng() * 128) | 0);
    for (let e = 0; e < 2; e++) w(8, (rng() * 256) | 0);
    for (let i = 0; i < 16; i++) w(2 - (i === 0 ? 1 : 0), (rng() * (i === 0 ? 2 : 4)) | 0);
    for (let i = 0; i < 16; i++) w(2 - (i === 0 ? 1 : 0), (rng() * (i === 0 ? 2 : 4)) | 0);
  } else if (mode === 6) {
    for (let i = 0; i < 8; i++) w(7, (rng() * 128) | 0);
    w(1, (rng() * 2) | 0);
    w(1, (rng() * 2) | 0);
    // Wire layout: texel 0 is the anchor and carries 3 of its 4 index bits
    // (basis `bc7_mode_6::m_s00 : 3`); the other 15 texels carry full 4-bit indices.
    for (let i = 0; i < 16; i++) w(i === 0 ? 3 : 4, i === 0 ? (rng() * 8) | 0 : (rng() * 16) | 0);
  } else if (mode === 7) {
    w(6, partition);
    for (let c = 0; c < 4; c++) for (let e = 0; e < 4; e++) w(5, (rng() * 32) | 0);
    for (let p = 0; p < 4; p++) w(1, (rng() * 2) | 0);
    for (let i = 0; i < 16; i++) {
      const anchor = i === 0 || i === BC7_ANCHOR_SECOND_SUBSET[partition];
      w(anchor ? 1 : 2, (rng() * (anchor ? 2 : 4)) | 0);
    }
  } else {
    throw new Error(`unknown bc7 mode ${mode}`);
  }
  return b;
}

/** Per-value bit-reversal tables of the basis ASTC weight writer (`s_reverse_bits*`). */
const ASTC_REVERSE: ReadonlyArray<readonly number[]> = [
  [],
  [0, 1],
  [0, 2, 1, 3],
  [0, 4, 2, 6, 1, 5, 3, 7],
  [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15],
];

/**
 * Builds a valid basis-style ASTC 4x4 block (grid 4x4, block mode row 0) with
 * the given partition count/seed, dual-plane flag, uniform weight range and raw
 * weight values (length 16, or 32 interleaved `(2*grid+plane)` for dual plane).
 */
export function buildAstc(opts: AstcBlockOpts): Uint8Array {
  const b = new Uint8Array(16);
  const { numParts, seed, dualPlane, weightRange } = opts;
  const p = weightRange + 2;
  // Weight precision p-bits (positions verified against real transcoder output):
  // p0 at bit 4, p1 at bit 0, p2 at bit 1.
  setBits(b, 4, 1, p & 1);
  setBits(b, 0, 1, (p >> 1) & 1);
  setBits(b, 1, 1, (p >> 2) & 1);
  // Grid: W = 4 + Wextra (bits 7..8), H = 2 + Hextra (bits 5..6) -> 4x4.
  setBits(b, 7, 2, 0);
  setBits(b, 5, 2, 2);
  // Precision mode P (bit 9) = 0; dual plane (bit 10).
  setBits(b, 9, 1, 0);
  setBits(b, 10, 1, dualPlane ? 1 : 0);
  // Partitions (bits 11..12) + seed (bits 13..22).
  setBits(b, 11, 2, numParts - 1);
  setBits(b, 13, 10, seed);
  // CEM (bits 23..28): LDR RGB direct -- never interpreted by the mirror or K02 tests.
  setBits(b, 23, 6, 10);

  const perValue = weightRange === 0 ? 1 : 2;
  const total = (dualPlane ? 2 : 1) * 16;
  const rev = ASTC_REVERSE[perValue]!;
  for (let i = 0; i < total; i++) {
    const value = (opts.weights?.[i] ?? 0) & ((1 << perValue) - 1);
    const bitPos = 128 - (i + 1) * perValue;
    setBits(b, bitPos, perValue, rev[value]!);
  }
  // CCS (2 bits just below the weight region) -- irrelevant to the mirror.
  setBits(b, 128 - perValue * total - 2, 2, 0);
  return b;
}
