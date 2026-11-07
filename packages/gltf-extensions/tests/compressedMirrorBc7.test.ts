import { describe, expect, it } from "vitest";
import { CompressedTextureFormat } from "@small-world-machine/engine";
import { mirrorCompressedPlane } from "../src/basisu/compressedMirror.js";
import { flipPartition, BC7_BLOCK_BYTES } from "../src/basisu/compressedBc7Mirror.js";
import {
  BC7_NUM_SUBSETS,
  BC7_PARTITION_2_SUBSET,
  BC7_PARTITION_3_SUBSET,
} from "../src/basisu/compressedTables.js";
import { decodeBc7, flipPixels } from "./helpers/miniBlockCodecs.js";
import { buildBc7, mulberry32 } from "./helpers/miniBlockBuilders.js";

/**
 * K02 BC7 contract: the mirror must decode to the vertical flip of the decode.
 *
 * Anchor MSB-dropping (spec Table 111) and the decode-neutral anchor
 * normalization in the mirror's writer make byte-level involution fragile (a
 * normalized block need not re-normalize to itself), so the assertions are
 * decode-level:
 * - single-subset modes (4/5/6): decode(mirror(b)) == flipY(decode(b)) exactly
 *   for all 16 texels, and decode(mirror(mirror(b))) == decode(b).
 * - multi-subset modes (0/1/2/3/7): the partition is replaced by its flipped
 *   pattern (exact when representable, else the nearest flip-closed fallback).
 *   Texels whose subset label is preserved by that replacement must decode
 *   exactly; texels whose label changed are a documented approximation (their
 *   endpoints come from the neighbouring subset) and are not asserted.
 *
 * Decoder and builder are independent oracles ported from
 * basis_universal master `unpack_bc7*` (incl. the mode-6 3-bit anchor slot).
 */

const BC7 = CompressedTextureFormat.BC7_RGBA;

/** Flip of a 4x4 scan-order texel slot under a vertical mirror. */
function flipTexel(t: number): number {
  return (3 - (t >> 2)) * 4 + (t & 3);
}

function samePixels(a: number[][], b: number[][]): boolean {
  for (let t = 0; t < 16; t++) {
    for (let c = 0; c < 4; c++) {
      if (a[t]![c] !== b[t]![c]) return false;
    }
  }
  return true;
}

/** The pattern of partition `p` under a vertical texel flip (independent). */
function flippedPattern(table: readonly number[], p: number): number[] {
  const out = new Array<number>(16);
  for (let t = 0; t < 16; t++) out[flipTexel(t)] = table[p * 16 + t]!;
  return out;
}

function patternMatches(table: readonly number[], q: number, wanted: number[]): boolean {
  for (let t = 0; t < 16; t++) {
    if (table[q * 16 + t] !== wanted[t]) return false;
  }
  return true;
}

describe("BC7 single-subset mirror (K02)", () => {
  for (const mode of [4, 5, 6]) {
    it(`mode ${mode}: decode(mirror(b)) == flipY(decode(b)) exactly`, () => {
      const rng = mulberry32(0xbc70 + mode);
      for (let i = 0; i < 200; i++) {
        const b = buildBc7(mode, 0, rng);
        const m = mirrorCompressedPlane(b, 4, 4, BC7);
        const dm = decodeBc7(m);
        expect(dm.length).toBe(16);
        expect(samePixels(dm, flipPixels(decodeBc7(b)))).toBe(true);
      }
    });

    it(`mode ${mode}: mirror is decode-involutive (mirror twice == original decode)`, () => {
      const rng = mulberry32(0xbc7d + mode);
      for (let i = 0; i < 120; i++) {
        const b = buildBc7(mode, 0, rng);
        const m1 = mirrorCompressedPlane(b, 4, 4, BC7);
        const m2 = mirrorCompressedPlane(m1, 4, 4, BC7);
        expect(samePixels(decodeBc7(m2), decodeBc7(b))).toBe(true);
      }
    });
  }
});

describe("BC7 multi-subset mirror (K02)", () => {
  for (const mode of [0, 1, 2, 3, 7]) {
    const width = 1 << (mode === 0 ? 4 : 6);
    const subsets = BC7_NUM_SUBSETS[mode]!;
    const table = subsets === 3 ? BC7_PARTITION_3_SUBSET : BC7_PARTITION_2_SUBSET;

    it(`mode ${mode}: partition flip is exact whenever the flipped pattern is representable`, () => {
      for (let p = 0; p < width; p++) {
        const fl = flippedPattern(table, p);
        let match = -1;
        for (let q = 0; q < width; q++) {
          if (patternMatches(table, q, fl)) {
            match = q;
            break;
          }
        }
        if (match >= 0) expect(flipPartition(subsets, p, width)).toBe(match);
      }
    });

    it(`mode ${mode}: decode-consistency on texels whose subset the flip preserves`, () => {
      const rng = mulberry32(0xbc7a + mode);
      for (let p = 0; p < width; p++) {
        for (let trial = 0; trial < 3; trial++) {
          const b = buildBc7(mode, p, rng);
          const m = mirrorCompressedPlane(b, 4, 4, BC7);
          const dm = decodeBc7(m);
          expect(dm.length).toBe(16);
          const q = flipPartition(subsets, p, width);
          const P = Array.from({ length: 16 }, (_, t) => table[p * 16 + t]);
          const Q = Array.from({ length: 16 }, (_, t) => table[q * 16 + t]);
          const expected = flipPixels(decodeBc7(b));
          for (let o = 0; o < 16; o++) {
            const src = flipTexel(o);
            if (Q[o] === P[src]) {
              // Output texel o keeps the subset of its source texel src, so it
              // must decode to exactly the source texel's color.
              expect(dm[o]!).toEqual(expected[o]!);
            }
            // Fallback-affected texels (subset label changed) are the documented
            // approximation; no assertion.
          }
        }
      }
    });
  }
});

describe("BC7 boundary levels (height not a multiple of 4)", () => {
  it("mirrors partial-height planes without throwing and preserves length", () => {
    const rng = mulberry32(0xbc7b);
    for (const h of [1, 2, 3, 5, 6, 10]) {
      const w = 8;
      const blocksY = Math.ceil(h / 4);
      const plane = new Uint8Array(2 * blocksY * BC7_BLOCK_BYTES);
      for (let i = 0; i < blocksY; i++) {
        for (let bx = 0; bx < 2; bx++) {
          plane.set(buildBc7(6, 0, rng), (bx + i * 2) * BC7_BLOCK_BYTES);
        }
      }
      const m = mirrorCompressedPlane(plane, w, h, BC7);
      expect(m.length).toBe(plane.length);
      const m2 = mirrorCompressedPlane(m, w, h, BC7);
      expect(m2.length).toBe(plane.length);
    }
  });
});
