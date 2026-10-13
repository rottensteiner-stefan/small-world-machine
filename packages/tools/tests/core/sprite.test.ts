import { describe, it, expect } from "vitest";
import {
  autocropRgba,
  cropRgba,
  detectSpriteBoundsRgba,
  flipRgba,
  padToPowerOfTwoRgba,
} from "../../src/core/sprite.js";
import {
  autocropImage,
  cropImage,
  detectSpriteBounds,
  flipImage,
  makeImageData,
  padToPowerOfTwo,
} from "../../src/common/image/index.js";
import type { RgbaImage } from "../../src/core/RasterIO.js";

function fixture(
  width: number,
  height: number,
  fill: [number, number, number, number] = [0, 0, 0, 0],
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3];
  }
  return { width, height, data };
}

function setRgba(
  img: RgbaImage,
  x: number,
  y: number,
  fill: [number, number, number, number],
): void {
  const i = (y * img.width + x) * 4;
  img.data[i] = fill[0];
  img.data[i + 1] = fill[1];
  img.data[i + 2] = fill[2];
  img.data[i + 3] = fill[3];
}

describe("core/sprite cropRgba", () => {
  it("crops deterministically and byte-identically to the CanvasOps cropImage", () => {
    const src = fixture(10, 10, [100, 100, 100, 255]);
    setRgba(src, 2, 3, [255, 0, 0, 255]);

    const coreOut = cropRgba(src, 2, 3, 4, 4);
    const legacySrc = makeImageData(src.width, src.height, new Uint8ClampedArray(src.data));
    const legacyOut = cropImage(legacySrc, 2, 3, 4, 4);

    expect(coreOut.width).toBe(4);
    expect(coreOut.height).toBe(4);
    expect(Array.from(coreOut.data)).toEqual(Array.from(legacyOut.data));
    expect(Array.from(coreOut.data.subarray(0, 4))).toEqual([255, 0, 0, 255]);
  });

  it("is deterministic: equal input yields equal output", () => {
    const src = fixture(5, 5, [10, 20, 30, 200]);
    const a = cropRgba(src, 1, 1, 3, 3);
    const b = cropRgba(src, 1, 1, 3, 3);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
});

describe("core/sprite autocropRgba", () => {
  it("trims transparent padding and matches the CanvasOps autocropImage", () => {
    const src = fixture(20, 20, [0, 0, 0, 0]);
    for (let y = 5; y <= 10; y++) {
      for (let x = 5; x <= 10; x++) {
        setRgba(src, x, y, [200, 200, 200, 255]);
      }
    }

    const coreOut = autocropRgba(src);
    const legacySrc = makeImageData(src.width, src.height, new Uint8ClampedArray(src.data));
    const legacyOut = autocropImage(legacySrc);

    expect(coreOut.width).toBe(6);
    expect(coreOut.height).toBe(6);
    expect(Array.from(coreOut.data)).toEqual(Array.from(legacyOut.data));
    expect(coreOut.data[0]).toBe(200);
    expect(coreOut.data[3]).toBe(255);
  });

  it("returns a 1x1 transparent buffer for an empty image", () => {
    const empty = fixture(8, 8, [0, 0, 0, 0]);
    const out = autocropRgba(empty);
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(out.data[3]).toBe(0);
  });
});

describe("core/sprite flipRgba", () => {
  it("flips horizontally and matches the CanvasOps flipImage", () => {
    const src = fixture(4, 4, [0, 0, 0, 255]);
    setRgba(src, 0, 0, [255, 0, 0, 255]);

    const coreOut = flipRgba(src, true, false);
    const legacySrc = makeImageData(src.width, src.height, new Uint8ClampedArray(src.data));
    const legacyOut = flipImage(legacySrc, true, false);

    expect(coreOut.width).toBe(4);
    expect(coreOut.height).toBe(4);
    expect(Array.from(coreOut.data)).toEqual(Array.from(legacyOut.data));
    // top-left red moved to top-right
    expect(coreOut.data[3 * 4]).toBe(255);
  });

  it("flips vertically deterministically", () => {
    const src = fixture(2, 3, [5, 6, 7, 255]);
    const h = flipRgba(src, false, true);
    const h2 = flipRgba(src, false, true);
    expect(Array.from(h.data)).toEqual(Array.from(h2.data));
    expect(h.width).toBe(2);
    expect(h.height).toBe(3);
  });
});

describe("core/sprite padToPowerOfTwoRgba", () => {
  it("pads to power-of-two and matches the CanvasOps padToPowerOfTwo", () => {
    const src = fixture(50, 70, [255, 0, 0, 255]);

    const coreOut = padToPowerOfTwoRgba(src);
    const legacySrc = makeImageData(src.width, src.height, new Uint8ClampedArray(src.data));
    const legacyOut = padToPowerOfTwo(legacySrc);

    expect(coreOut.width).toBe(64);
    expect(coreOut.height).toBe(128);
    expect(Array.from(coreOut.data)).toEqual(Array.from(legacyOut.data));
  });

  it("keeps an already-power-of-two image untouched (copy)", () => {
    const src = fixture(16, 32, [1, 2, 3, 255]);
    const out = padToPowerOfTwoRgba(src);
    expect(out.width).toBe(16);
    expect(out.height).toBe(32);
    expect(Array.from(out.data)).toEqual(Array.from(src.data));
    expect(out.data).not.toBe(src.data);
  });
});

describe("core/sprite detectSpriteBoundsRgba", () => {
  it("detects isolated islands and matches SmartSegmentation.detectSpriteBounds", () => {
    const src = fixture(16, 16, [0, 0, 0, 0]);
    for (let y = 1; y <= 10; y++) {
      for (let x = 1; x <= 8; x++) {
        setRgba(src, x, y, [200, 200, 200, 255]);
      }
    }

    const coreOut = detectSpriteBoundsRgba(src, { minWidth: 8, minHeight: 8, padding: 2 });
    const legacySrc = makeImageData(src.width, src.height, new Uint8ClampedArray(src.data));
    const legacyOut = detectSpriteBounds(legacySrc, { minWidth: 8, minHeight: 8, padding: 2 });

    expect(coreOut.length).toBe(1);
    expect(coreOut).toEqual(legacyOut);
    expect(coreOut[0]).toEqual({ x: 0, y: 0, w: 12, h: 14 });
  });

  it("is deterministic and filters sprites below the minimum size", () => {
    const src = fixture(12, 12, [0, 0, 0, 0]);
    setRgba(src, 2, 2, [9, 9, 9, 255]); // 1x1 -> below minWidth/minHeight

    const a = detectSpriteBoundsRgba(src, {});
    const b = detectSpriteBoundsRgba(src, {});
    expect(a).toEqual(b);
    expect(a).toHaveLength(0);
  });
});
