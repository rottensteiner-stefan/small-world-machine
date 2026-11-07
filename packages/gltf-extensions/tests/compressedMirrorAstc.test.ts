import { describe, expect, it } from "vitest";
import { CompressedTextureFormat } from "@small-world-machine/engine";
import { mirrorCompressedPlane } from "../src/basisu/compressedMirror.js";
import {
  ASTC_BLOCK_BYTES,
  computeTexelPartition,
  flipPartitionSeed,
  parseAstcConfig,
  readAstcWeights,
} from "../src/basisu/compressedAstcMirror.js";
import { ASTC_BISE_RANGE_TABLE } from "../src/basisu/compressedTables.js";
import { buildAstc } from "./helpers/miniBlockBuilders.js";

/**
 * K02 ASTC contract. The mirror is a surgical patch: on a 4-aligned block it
 * permutes the weight (index) stream by the texel flip and replaces the
 * multi-partition seed with the seed whose procedural pattern is the flip
 * (exact when representable, else the nearest flip-closed seed); every other
 * byte (endpoints, CEM, CCS, void-extent) is bit-identical.
 *
 * There is no full-color ASTC decoder in the oracles, so the tests verify
 * structure instead of pixels:
 * - `computeTexelPartition` is frozen against 18 ARM-cross-validated golden
 *   tuples (generated from a reference ASTC partition implementation), which
 *   anchors every pattern-derived assertion.
 * - The weight permutation is checked on the raw wire bits (no reversal tables):
 *   the bits at output slot (g, p) equal the bits at input slot (flip(g), p).
 * - The seed flip is checked against an independent exact search over all 1024
 *   seeds; fallback targets must be flip-closed.
 * - Double-mirror byte-involution holds for single-partition blocks (no seed
 *   rewrite) and void-extent blocks (identity).
 */

const ASTC = CompressedTextureFormat.ASTC_4x4_RGBA;

/** Flip of a 4x4 scan-order texel slot under a vertical mirror (rows reversed). */
function flipTexel(t: number): number {
  return (3 - (t >> 2)) * 4 + (t & 3);
}

/** LSB-first bit read (same addressing as the transcoder's wire format). */
function getBits(bytes: Uint8Array, bitOffset: number, count: number): number {
  let value = 0;
  let shift = 0;
  let pos = bitOffset;
  let remaining = count;
  while (remaining > 0) {
    const take = Math.min(remaining, 8 - (pos & 7));
    value |= ((bytes[pos >> 3]! >> (pos & 7)) & ((1 << take) - 1)) << shift;
    shift += take;
    pos += take;
    remaining -= take;
  }
  return value >>> 0;
}

const FLIP = [12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3];

interface GoldenTuple {
  seed: number;
  numParts: number;
  pattern: number[];
}

const GOLDEN: GoldenTuple[] = [
  { seed: 1, numParts: 2, pattern: [0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 0] },
  { seed: 5, numParts: 2, pattern: [1, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] },
  { seed: 17, numParts: 2, pattern: [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0] },
  { seed: 100, numParts: 2, pattern: [1, 1, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1] },
  { seed: 400, numParts: 2, pattern: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1] },
  { seed: 900, numParts: 2, pattern: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { seed: 0, numParts: 3, pattern: [2, 0, 0, 0, 2, 0, 0, 0, 2, 1, 1, 1, 2, 1, 1, 1] },
  { seed: 3, numParts: 3, pattern: [1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 0, 2, 1, 0, 0, 2] },
  { seed: 60, numParts: 3, pattern: [0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 2] },
  { seed: 250, numParts: 3, pattern: [0, 0, 0, 0, 1, 1, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0] },
  { seed: 512, numParts: 3, pattern: [1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0, 2, 2, 1, 1] },
  { seed: 1000, numParts: 3, pattern: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { seed: 2, numParts: 4, pattern: [0, 0, 0, 0, 2, 3, 1, 1, 2, 3, 3, 1, 3, 3, 3, 3] },
  { seed: 9, numParts: 4, pattern: [1, 2, 0, 2, 0, 0, 0, 3, 0, 0, 3, 3, 0, 0, 3, 3] },
  { seed: 150, numParts: 4, pattern: [2, 2, 3, 2, 1, 1, 3, 1, 1, 1, 1, 1, 2, 2, 1, 2] },
  { seed: 333, numParts: 4, pattern: [1, 1, 1, 1, 0, 0, 0, 3, 0, 0, 0, 3, 0, 0, 3, 3] },
  { seed: 800, numParts: 4, pattern: [3, 3, 3, 0, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 0] },
  { seed: 1023, numParts: 4, pattern: [3, 3, 3, 1, 3, 3, 3, 3, 2, 2, 2, 2, 2, 3, 3, 3] },
];

describe("ASTC partition function (K02 golden anchor)", () => {
  it("computeTexelPartition matches the ARM-cross-validated golden tuples", () => {
    for (const { seed, numParts, pattern } of GOLDEN) {
      const got: number[] = [];
      for (let t = 0; t < 16; t++) got.push(computeTexelPartition(seed, t & 3, t >> 2, numParts));
      expect(got, `seed=${seed} parts=${numParts}`).toEqual(pattern);
    }
  });
});

describe("ASTC partition-seed flip (K02)", () => {
  const seedOf = (numParts: number): Map<number, number> => {
    const map = new Map<number, number>();
    for (let s = 0; s < 1024; s++) {
      let packed = 0;
      for (let t = 0; t < 16; t++) {
        packed |= computeTexelPartition(s, t & 3, t >> 2, numParts) << (2 * t);
      }
      if (!map.has(packed)) map.set(packed, s);
    }
    return map;
  };

  for (const numParts of [2, 3, 4]) {
    const seeds: number[] = [];
    for (let s = 0; s < 1024; s += 7) seeds.push(s);
    seeds.push(1, 5, 17, 42, 100, 400, 900, 1023);

    it(`flipPartitionSeed returns the exact flip seed when representable (${numParts} parts)`, () => {
      const map = seedOf(numParts);
      for (const s of seeds) {
        const pattern: number[] = [];
        for (let t = 0; t < 16; t++)
          pattern.push(computeTexelPartition(s, t & 3, t >> 2, numParts));
        const flipped = new Array<number>(16);
        for (let t = 0; t < 16; t++) flipped[flipTexel(t)] = pattern[t]!;
        let packedFlipped = 0;
        for (let t = 0; t < 16; t++) packedFlipped |= flipped[t]! << (2 * t);
        const exact = map.get(packedFlipped);
        if (exact !== undefined) {
          expect(flipPartitionSeed(s, numParts)).toBe(exact);
        }
      }
    });

    it(`fallback targets are flip-closed (${numParts} parts)`, () => {
      const map = seedOf(numParts);
      for (const s of seeds) {
        const pattern: number[] = [];
        for (let t = 0; t < 16; t++)
          pattern.push(computeTexelPartition(s, t & 3, t >> 2, numParts));
        const flipped = new Array<number>(16);
        for (let t = 0; t < 16; t++) flipped[flipTexel(t)] = pattern[t]!;
        let packedFlipped = 0;
        for (let t = 0; t < 16; t++) packedFlipped |= flipped[t]! << (2 * t);
        if (map.has(packedFlipped)) continue; // exact case covered above
        // Fallback: the chosen seed's own pattern must be exactly flippable
        // (flip-closed), so a second mirror of the chosen encoding is exact.
        const chosen = flipPartitionSeed(s, numParts);
        const chosenPattern: number[] = [];
        for (let t = 0; t < 16; t++) {
          chosenPattern.push(computeTexelPartition(chosen, t & 3, t >> 2, numParts));
        }
        const chosenFlipped = new Array<number>(16);
        for (let t = 0; t < 16; t++) chosenFlipped[flipTexel(t)] = chosenPattern[t]!;
        let packedChosenFlip = 0;
        for (let t = 0; t < 16; t++) packedChosenFlip |= chosenFlipped[t]! << (2 * t);
        expect(map.has(packedChosenFlip)).toBe(true);
      }
    });
  }
});

describe("ASTC weight-stream permutation (K02, raw wire oracle)", () => {
  const rawWeight = (block: Uint8Array, idx: number, bits: number): number =>
    getBits(block, 128 - (idx + 1) * bits, bits);

  it("single-plane blocks: output slot g carries the raw bits of input slot flip(g)", () => {
    const seeds = [0, 1, 17, 42, 300, 999, 1023];
    for (const numParts of [1, 2, 3, 4]) {
      for (const seed of seeds) {
        for (const weightRange of [0, 2]) {
          const b = buildAstc({ numParts, seed, dualPlane: false, weightRange });
          const m = mirrorCompressedPlane(b, 4, 4, ASTC);
          const bits = ASTC_BISE_RANGE_TABLE[weightRange]![0]!;
          for (let g = 0; g < 16; g++) {
            expect(rawWeight(m, g, bits)).toBe(rawWeight(b, FLIP[g]!, bits));
          }
        }
      }
    }
  });

  it("dual-plane blocks: both planes follow flip(g) independently", () => {
    for (const numParts of [1, 2, 3]) {
      for (const seed of [0, 7, 555]) {
        const b = buildAstc({ numParts, seed, dualPlane: true, weightRange: 2 });
        const m = mirrorCompressedPlane(b, 4, 4, ASTC);
        for (let g = 0; g < 16; g++) {
          for (let plane = 0; plane < 2; plane++) {
            // Stream index interleaves as (gridIdx << 1) | plane.
            expect(rawWeight(m, 2 * g + plane, 2)).toBe(rawWeight(b, 2 * FLIP[g]! + plane, 2));
          }
        }
      }
    }
  });

  it("the module value reader agrees with the raw wire (end-to-end consistency)", () => {
    for (const dualPlane of [false, true]) {
      for (const weightRange of [0, 2]) {
        const weights: number[] = [];
        const perValue = weightRange === 0 ? 1 : 2;
        for (let i = 0; i < (dualPlane ? 32 : 16); i++) weights.push(i % (1 << perValue));
        const b = buildAstc({ numParts: 1, seed: 0, dualPlane, weightRange, weights });
        const cfg = parseAstcConfig(b, 0);
        const read = readAstcWeights(b, 0, cfg, cfg.dualPlane ? 32 : 16);
        expect(read).toEqual(weights);
      }
    }
  });
});

describe("ASTC surgical-patch structure (K02)", () => {
  it("single-partition blocks change only the weight region; mirror is byte-involutive", () => {
    for (const dualPlane of [false, true]) {
      for (const weightRange of [0, 2]) {
        const b = buildAstc({ numParts: 1, seed: 0, dualPlane, weightRange });
        const m = mirrorCompressedPlane(b, 4, 4, ASTC);
        const cfg = parseAstcConfig(b, 0);
        const bits = ASTC_BISE_RANGE_TABLE[weightRange]![0]!;
        const total = (dualPlane ? 2 : 1) * 16;
        const weightStartBit = 128 - total * bits;
        for (let bit = 0; bit < 128; bit++) {
          const insideWeight = bit >= weightStartBit;
          if (getBits(m, bit, 1) !== getBits(b, bit, 1)) {
            expect(insideWeight, `bit ${bit} outside the weight region must be unchanged`).toBe(
              true,
            );
          }
        }
        void cfg;
        const m2 = mirrorCompressedPlane(m, 4, 4, ASTC);
        expect(Buffer.from(m2).equals(Buffer.from(b))).toBe(true);
      }
    }
  });

  it("multi-partition blocks change only weight bits and the 10-bit seed field", () => {
    for (const numParts of [2, 3, 4]) {
      for (const seed of [0, 7, 42, 300, 999]) {
        const b = buildAstc({ numParts, seed, dualPlane: false, weightRange: 2 });
        const m = mirrorCompressedPlane(b, 4, 4, ASTC);
        const bits = 2;
        const weightStartBit = 128 - 16 * bits;
        for (let bit = 0; bit < 128; bit++) {
          const insideWeight = bit >= weightStartBit;
          const insideSeed = bit >= 13 && bit <= 22;
          if (getBits(m, bit, 1) !== getBits(b, bit, 1)) {
            expect(insideWeight || insideSeed, `bit ${bit} changed (seed=${seed})`).toBe(true);
          }
        }
      }
    }
  });

  it("mirror output parses with the same config as the input", () => {
    for (const numParts of [1, 2, 3, 4]) {
      for (const seed of [0, 42, 555]) {
        const b = buildAstc({ numParts, seed, dualPlane: false, weightRange: 2 });
        const m = mirrorCompressedPlane(b, 4, 4, ASTC);
        const cb = parseAstcConfig(b, 0);
        const cm = parseAstcConfig(m, 0);
        expect(cm.gridWidth).toBe(cb.gridWidth);
        expect(cm.gridHeight).toBe(cb.gridHeight);
        expect(cm.dualPlane).toBe(cb.dualPlane);
        expect(cm.weightRange).toBe(cb.weightRange);
        expect(cm.numPartitions).toBe(cb.numPartitions);
        expect(cm.voidExtent).toBe(false);
      }
    }
  });

  it("void-extent blocks are mirrored as identity", () => {
    // void-extent block mode = 0b111111100 (9 bits, LSB-first): bit 8 is the
    // LSB of byte 1, so the mode spans bytes 0..1.
    const b = new Uint8Array(ASTC_BLOCK_BYTES);
    b[0] = 0xfc; // bits 0..7 = 00111111 -> LSB-first value 0b11111100
    b[1] = 0x01; // bit 8 = 1 -> full 9-bit mode 0b111111100
    const cfg = parseAstcConfig(b, 0);
    expect(cfg.voidExtent).toBe(true);
    const m = mirrorCompressedPlane(b, 4, 4, ASTC);
    expect(Buffer.from(m).equals(Buffer.from(b))).toBe(true);
  });
});
