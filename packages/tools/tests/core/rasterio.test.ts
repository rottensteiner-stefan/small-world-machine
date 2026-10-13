import { describe, it, expect } from "vitest";
import { NodePngRasterIO, type RgbaImage } from "../../src/core/RasterIO.js";

function gradientFixture(width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 37) % 256;
      data[i + 1] = (y * 71) % 256;
      data[i + 2] = ((x + y) * 23) % 256;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

describe("core/RasterIO NodePngRasterIO", () => {
  it("round-trips an RGBA fixture through PNG encode + decode", async () => {
    const io = new NodePngRasterIO();
    const src = gradientFixture(16, 12);

    const pngBytes = await io.encodePng(src);
    const decoded = await io.decode(pngBytes);

    expect(decoded.width).toBe(16);
    expect(decoded.height).toBe(12);
    expect(Array.from(decoded.data)).toEqual(Array.from(src.data));
  });

  it("encodes deterministically: same input yields identical PNG bytes", async () => {
    const io = new NodePngRasterIO();
    const src = gradientFixture(8, 8);
    const a = await io.encodePng(src);
    const b = await io.encodePng(src);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("emits a valid PNG signature", async () => {
    const io = new NodePngRasterIO();
    const bytes = await io.encodePng(gradientFixture(4, 4));
    // PNG magic
    expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it("rejects invalid PNG bytes", async () => {
    const io = new NodePngRasterIO();
    await expect(io.decode(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });
});
