import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { BasisWasmTranscoder } from "../src/basisu/BasisWasmTranscoder.js";
import { BasisTranscoderFormat } from "../src/basisu/basisTypes.js";

const vendorDir = fileURLToPath(new URL("../vendor/basis/", import.meta.url));
const fixtureDir = fileURLToPath(new URL("./fixtures/ktx2/", import.meta.url));

function asArrayBuffer(source: Uint8Array<ArrayBufferLike>): ArrayBuffer {
  return source.buffer.slice(
    source.byteOffset,
    source.byteOffset + source.byteLength,
  ) as ArrayBuffer;
}

function loadFixtureExplicitWasm(name: string): { ktx2: Uint8Array; wasmBinary: ArrayBuffer } {
  const buffer = readFileSync(fixtureDir + name);
  const wasmBinary = asArrayBuffer(readFileSync(vendorDir + "basis_transcoder.wasm"));
  return { ktx2: new Uint8Array(buffer), wasmBinary };
}

/** Bytes for level 0 of a 40x40 texture in the given block format. */
function expectedLevel0Bytes(format: number): number {
  const blocks = Math.ceil(40 / 4) * Math.ceil(40 / 4); // 10 x 10 blocks
  switch (format) {
    case BasisTranscoderFormat.ETC1:
      return blocks * 8;
    case BasisTranscoderFormat.ETC2:
    case BasisTranscoderFormat.BC3:
    case BasisTranscoderFormat.BC7:
    case BasisTranscoderFormat.ASTC_4x4:
      return blocks * 16;
    default:
      throw new Error(`no expectation for format ${format}`);
  }
}

describe("BasisWasmTranscoder", () => {
  it("transcodes a real ETC1S KTX2 payload to RGBA8 planes", async () => {
    const { ktx2, wasmBinary } = loadFixtureExplicitWasm("2d_etc1s.ktx2");

    const result = await BasisWasmTranscoder.transcode(ktx2, { wasmBinary });

    expect(result.width).toBe(40);
    expect(result.height).toBe(40);
    expect(result.hadAlpha).toBe(false);
    // 6 mip levels, single layer/face for a plain 2D texture.
    expect(result.images).toHaveLength(6);
    expect(result.images[0]!.width).toBe(40);
    expect(result.images[0]!.height).toBe(40);
    expect(result.images[0]!.format).toBe(BasisTranscoderFormat.RGBA32);

    // Every plane has non-zero pixel data (4 bytes per texel).
    for (const plane of result.images) {
      expect(plane.data.length).toBe(plane.width * plane.height * 4);
      let sum = 0;
      for (let i = 0; i < plane.data.length; i++) sum += plane.data[i]!;
      expect(sum).toBeGreaterThan(0);
    }
  });

  it("rejects a buffer that is not a valid KTX2 file", async () => {
    const wasmBinary = asArrayBuffer(readFileSync(vendorDir + "basis_transcoder.wasm"));
    const garbage = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);

    await expect(BasisWasmTranscoder.transcode(garbage, { wasmBinary })).rejects.toThrow(
      "Invalid or unsupported .ktx2",
    );
  });

  it.each(
    Object.entries({
      ETC2: BasisTranscoderFormat.ETC2,
      BC3: BasisTranscoderFormat.BC3,
      BC7: BasisTranscoderFormat.BC7,
      ASTC_4x4: BasisTranscoderFormat.ASTC_4x4,
    }),
  )("transcodes the ETC1S fixture to %s block-compressed planes", async (_name, format) => {
    const { ktx2, wasmBinary } = loadFixtureExplicitWasm("2d_etc1s.ktx2");

    const result = await BasisWasmTranscoder.transcode(ktx2, { wasmBinary, format });
    const level0 = result.images[0]!;

    expect(level0.format).toBe(format);
    // Block formats are GPU hardware formats -- level 0 must be exactly the
    // number of 4x4 blocks times the per-block byte size (no texel padding).
    expect(level0.data.length).toBe(expectedLevel0Bytes(format));
    expect(level0.data.length).toBeLessThan(40 * 40 * 4);

    // Every plane is nonzero (the fixture has real content).
    for (const plane of result.images) {
      let sum = 0;
      for (let i = 0; i < plane.data.length; i++) sum += plane.data[i]!;
      expect(sum).toBeGreaterThan(0);
    }
  });

  it("rejects BC1 output for ETC1S sources (BC1 is UASTC-only)", async () => {
    const { ktx2, wasmBinary } = loadFixtureExplicitWasm("2d_etc1s.ktx2");
    await expect(
      BasisWasmTranscoder.transcode(ktx2, { wasmBinary, format: BasisTranscoderFormat.BC1 }),
    ).rejects.toThrow("BC1 output is only supported for UASTC sources");
  });
  it("shares one module per binary reference and keeps distinct binaries apart", async () => {
    const a = loadFixtureExplicitWasm("2d_etc1s.ktx2").wasmBinary;
    const b = loadFixtureExplicitWasm("2d_etc1s.ktx2").wasmBinary;
    const first = await BasisWasmTranscoder.getModule({ wasmBinary: a });
    expect(await BasisWasmTranscoder.getModule({ wasmBinary: a })).toBe(first);
    expect(await BasisWasmTranscoder.getModule({ wasmBinary: b })).not.toBe(first);
  });
});
