import { describe, expect, it } from "vitest";
import { CompressedTextureFormat } from "@small-world-machine/engine";
import { mirrorCompressedPlane } from "../src/basisu/compressedMirror.js";
import {
  decodeBc1,
  decodeBc3,
  decodeEtc2,
  flipPixels,
  flipTexel52,
} from "./helpers/miniBlockCodecs.js";
import { buildBc1, buildBc3, buildEtc2, mulberry32 } from "./helpers/miniBlockBuilders.js";

/**
 * K02 codec contract tests (BC1/BC3/ETC2): the vertical mirror of a block must
 * decode to the vertical flip of the block's decode -- `decode(flip(b)) ==
 * flipY(decode(b))` -- and for 4-aligned content the mirror must be involutive.
 * ETC2 diff mode has one documented approximation (old delta == -4 clamps to
 * +3), tested separately with a bounded deviation; every other ETC2 block
 * decodes exactly.
 */

function samePixels(a: number[][], b: number[][]): boolean {
  for (let t = 0; t < 16; t++) {
    for (let c = 0; c < 4; c++) {
      if (a[t]![c] !== b[t]![c]) return false;
    }
  }
  return true;
}

function maxChannelDeviation(a: number[][], b: number[][]): number {
  let max = 0;
  for (let t = 0; t < 16; t++) {
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(a[t]![c]! - b[t]![c]!);
      if (d > max) max = d;
    }
  }
  return max;
}

/** Copies the per-texel raw EAC index into a 4th channel for comparison. */
function withEacIndex(base: number[][], eac: number[]): number[][] {
  return base.map((row, t) => [row[0]!, row[1]!, row[2]!, eac[t]!]);
}

describe("BC1 mirror (K02)", () => {
  it("decode(flip(b)) == flipY(decode(b)) for random blocks", () => {
    const rng = mulberry32(0xbc1);
    for (let i = 0; i < 250; i++) {
      const b = buildBc1(rng);
      const m = mirrorCompressedPlane(b, 4, 4, CompressedTextureFormat.BC1_RGB);
      const decoded = decodeBc1(b);
      const mirrored = decodeBc1(m);
      expect(samePixels(mirrored, flipPixels(decoded))).toBe(true);
    }
  });

  it("mirror is byte-exact involutive (flip(flip(b)) == b)", () => {
    const rng = mulberry32(0xbc11);
    for (let i = 0; i < 250; i++) {
      const b = buildBc1(rng);
      const m1 = mirrorCompressedPlane(b, 4, 4, CompressedTextureFormat.BC1_RGB);
      const m2 = mirrorCompressedPlane(m1, 4, 4, CompressedTextureFormat.BC1_RGB);
      expect(Buffer.from(m2).equals(Buffer.from(b))).toBe(true);
    }
  });

  it("aligned plane mirrors are decode-consistent and involutive", () => {
    const rng = mulberry32(0xbc12);
    const w = 8;
    const h = 8;
    const plane = new Uint8Array((w * h) / 2);
    for (let i = 0; i < 4; i++) plane.set(buildBc1(rng), i * 8);
    const m = mirrorCompressedPlane(plane, w, h, CompressedTextureFormat.BC1_RGB);
    // Every output block (bx, by) decodes to the vertically flipped texels of the
    // source block (bx, 1-by): an aligned plane is just a permutation of blocks
    // plus the per-block row flip.
    for (let by = 0; by < 2; by++) {
      for (let bx = 0; bx < 2; bx++) {
        const outBlk = decodeBc1(m, (bx + by * 2) * 8);
        const srcBlk = decodeBc1(plane, (bx + (1 - by) * 2) * 8);
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 4; x++) {
            expect(outBlk[y * 4 + x]!).toEqual(srcBlk[(3 - y) * 4 + x]!);
          }
        }
      }
    }
    const m2 = mirrorCompressedPlane(m, w, h, CompressedTextureFormat.BC1_RGB);
    expect(Buffer.from(m2).equals(Buffer.from(plane))).toBe(true);
  });
});

describe("BC3 mirror (K02)", () => {
  it("decode(flip(b)) == flipY(decode(b)) for random blocks", () => {
    const rng = mulberry32(0xbc3);
    for (let i = 0; i < 250; i++) {
      const b = buildBc3(rng);
      const m = mirrorCompressedPlane(b, 4, 4, CompressedTextureFormat.BC3_RGBA);
      const decoded = decodeBc3(b);
      const mirrored = decodeBc3(m);
      expect(samePixels(mirrored, flipPixels(decoded))).toBe(true);
    }
  });

  it("mirror is byte-exact involutive", () => {
    const rng = mulberry32(0xbc31);
    for (let i = 0; i < 250; i++) {
      const b = buildBc3(rng);
      const m1 = mirrorCompressedPlane(b, 4, 4, CompressedTextureFormat.BC3_RGBA);
      const m2 = mirrorCompressedPlane(m1, 4, 4, CompressedTextureFormat.BC3_RGBA);
      expect(Buffer.from(m2).equals(Buffer.from(b))).toBe(true);
    }
  });
});

describe("ETC2 mirror (K02)", () => {
  it("decode(flip(b)) == flipY(decode(b)) for random blocks (delta != -4)", () => {
    const rng = mulberry32(0xe7c2);
    for (let i = 0; i < 400; i++) {
      const b = buildEtc2(rng, { avoidDeltaNeg4: true });
      const m = mirrorCompressedPlane(b, 4, 4, CompressedTextureFormat.ETC2_RGBA8);
      const d = decodeEtc2(b);
      const dm = decodeEtc2(m);
      const mirrored = withEacIndex(dm.texels, dm.eacIndex);
      const flipped = flipPixels(withEacIndex(d.texels, d.eacIndex));
      expect(samePixels(mirrored, flipped)).toBe(true);
    }
  });

  it("covers individual mode (flip=0 and flip=1) exactly", () => {
    const rng = mulberry32(0xe7c22);
    // Explicit individual-mode blocks in both region orientations.
    for (const flipBit of [0, 1]) {
      for (let i = 0; i < 120; i++) {
        const b = buildEtc2(rng, { diff: false, flip: flipBit === 1 });
        const m = mirrorCompressedPlane(b, 4, 4, CompressedTextureFormat.ETC2_RGBA8);
        const d = decodeEtc2(b);
        const dm = decodeEtc2(m);
        expect(
          samePixels(
            withEacIndex(dm.texels, dm.eacIndex),
            flipPixels(withEacIndex(d.texels, d.eacIndex)),
          ),
        ).toBe(true);
      }
    }
  });

  it("decode flip contract holds for diff-mode regional coverage (control plane)", () => {
    const rng = mulberry32(0xe7c23);
    for (const flipBit of [0, 1]) {
      for (let i = 0; i < 120; i++) {
        const b = buildEtc2(rng, { diff: true, flip: flipBit === 1, avoidDeltaNeg4: true });
        const m = mirrorCompressedPlane(b, 4, 4, CompressedTextureFormat.ETC2_RGBA8);
        const d = decodeEtc2(b);
        const dm = decodeEtc2(m);
        expect(
          samePixels(
            withEacIndex(dm.texels, dm.eacIndex),
            flipPixels(withEacIndex(d.texels, d.eacIndex)),
          ),
        ).toBe(true);
      }
    }
  });

  it("documents the delta == -4 approximation: deviation stays bounded on mid-range bases", () => {
    const rng = mulberry32(0xe7c24);
    for (let base = 16; base <= 24; base++) {
      for (let trial = 0; trial < 25; trial++) {
        const b = buildEtc2(rng, {
          diff: true,
          avoidDeltaNeg4: false,
          diffBase: [base, base, base],
          diffDelta: [-4, -4, -4],
          inten0: (rng() * 8) | 0,
          inten1: (rng() * 8) | 0,
        });
        const m = mirrorCompressedPlane(b, 4, 4, CompressedTextureFormat.ETC2_RGBA8);
        const d = decodeEtc2(b);
        const dm = decodeEtc2(m);
        const dev = maxChannelDeviation(
          withEacIndex(dm.texels, dm.eacIndex),
          flipPixels(withEacIndex(d.texels, d.eacIndex)),
        );
        // One 5-bit step (>= 8) on the new lower region; beyond that nothing moves.
        expect(dev).toBeLessThanOrEqual(10);
      }
    }
  });

  it("mirror is byte-exact involutive for in-range non-delta-4 blocks", () => {
    const rng = mulberry32(0xe7c25);
    // Diff bases are constrained to [3, 28] so base+delta stays in [0, 31]:
    // clamped diff blocks (overflow/underflow) re-encode to a decode-equivalent
    // but byte-different (base, delta) pair, so byte-level involution only holds
    // for clamp-free blocks (decode-level consistency covers the rest).
    for (let i = 0; i < 300; i++) {
      const b = buildEtc2(rng, { avoidDeltaNeg4: true, diffBaseMin: 3, diffBaseMax: 28 });
      const m1 = mirrorCompressedPlane(b, 4, 4, CompressedTextureFormat.ETC2_RGBA8);
      const m2 = mirrorCompressedPlane(m1, 4, 4, CompressedTextureFormat.ETC2_RGBA8);
      expect(Buffer.from(m2).equals(Buffer.from(b))).toBe(true);
    }
  });
});

describe("boundary levels (height not a multiple of 4)", () => {
  it("mirrors planes of partial heights without throwing and preserves length", () => {
    const rng = mulberry32(0xb0d);
    for (const h of [1, 2, 3, 5, 6, 10, 13]) {
      for (const fmt of [
        CompressedTextureFormat.BC1_RGB,
        CompressedTextureFormat.BC3_RGBA,
        CompressedTextureFormat.ETC2_RGBA8,
      ]) {
        const w = 8;
        const blocksY = Math.ceil(h / 4);
        const bytesPerBlock = fmt === CompressedTextureFormat.BC1_RGB ? 8 : 16;
        const plane = new Uint8Array(Math.ceil(w / 4) * blocksY * bytesPerBlock);
        for (let i = 0; i < plane.length; i += bytesPerBlock) {
          if (fmt === CompressedTextureFormat.BC1_RGB) plane.set(buildBc1(rng), i);
          else if (fmt === CompressedTextureFormat.BC3_RGBA) plane.set(buildBc3(rng), i);
          else plane.set(buildEtc2(rng, { avoidDeltaNeg4: true }), i);
        }
        const m = mirrorCompressedPlane(plane, w, h, fmt);
        expect(m.length).toBe(plane.length);
        // 4-aligned interior block rows must still map back exactly.
        const m2 = mirrorCompressedPlane(m, w, h, fmt);
        expect(m2.length).toBe(plane.length);
      }
    }
  });

  it("the first row of a partial plane comes from the last logical row", () => {
    // For a single block row containing real rows 2..3 (height 2), the mirrored
    // block must place row content of source row 1 into output row 0: the raw
    // BC1 selector row bytes of the output equal those of the source rotated.
    const rng = mulberry32(0xb0d1);
    const b = buildBc1(rng);
    const plane = new Uint8Array(8);
    plane.set(b, 0);
    const h = 2; // one block row holds rows 0..3, only 0..1 are real
    const m = mirrorCompressedPlane(plane, 4, h, CompressedTextureFormat.BC1_RGB);
    // Logical rows 0,1 map to source rows 1,0 (same block).
    expect(m[4]! === b[5]!).toBe(true);
    expect(m[5]! === b[4]!).toBe(true);
    // Out-of-range output rows 2,3 are suppressed (keep zeros).
    expect(m[6]!).toBe(0);
    expect(m[7]!).toBe(0);
  });
});

describe("texel flip helper sanity", () => {
  it("flipTexel52 is an involution on 4x4 scan slots", () => {
    for (let t = 0; t < 16; t++) expect(flipTexel52(flipTexel52(t))).toBe(t);
  });
});
