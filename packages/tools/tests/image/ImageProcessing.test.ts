import { describe, it, expect } from "vitest";
import {
  detectSpriteBounds,
  magicWand,
  removeBackground,
  generateNormalMap,
  generateDepthMap,
} from "../../src/common/image/index.js";

function createTestImageData(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  if (typeof ImageData !== "undefined") {
    return new ImageData(data, width, height);
  }
  return {
    width,
    height,
    data,
    colorSpace: "srgb",
  } as unknown as ImageData;
}

describe("Smart Image Processing & Segmentation", () => {
  it("detects isolated opaque sprite islands on a transparent sheet", () => {
    const width = 64;
    const height = 64;
    const img = createTestImageData(width, height);
    const data = img.data;

    // Draw Sprite A at (10, 10) size 12x12
    for (let y = 10; y < 22; y++) {
      for (let x = 10; x < 22; x++) {
        const idx = (y * width + x) * 4;
        data[idx] = 255;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 255;
      }
    }

    // Draw Sprite B at (40, 40) size 16x16
    for (let y = 40; y < 56; y++) {
      for (let x = 40; x < 56; x++) {
        const idx = (y * width + x) * 4;
        data[idx] = 0;
        data[idx + 1] = 255;
        data[idx + 2] = 0;
        data[idx + 3] = 255;
      }
    }

    const boxes = detectSpriteBounds(img, { minWidth: 8, minHeight: 8 });
    expect(boxes.length).toBe(2);
    expect(boxes[0]).toEqual({ x: 10, y: 10, w: 12, h: 12 });
    expect(boxes[1]).toEqual({ x: 40, y: 40, w: 16, h: 16 });
  });

  it("performs magic wand flood-fill to capture bounding box and alpha mask", () => {
    const width = 32;
    const height = 32;
    const img = createTestImageData(width, height);
    const data = img.data;

    // Fill background with black
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }

    // Draw white rectangle from (8, 8) to (20, 20)
    for (let y = 8; y < 20; y++) {
      for (let x = 8; x < 20; x++) {
        const idx = (y * width + x) * 4;
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = 255;
      }
    }

    const result = magicWand(img, 10, 10, 20);
    expect(result).not.toBeNull();
    expect(result!.box.x).toBe(8);
    expect(result!.box.y).toBe(8);
    expect(result!.box.w).toBe(12);
    expect(result!.box.h).toBe(12);
    expect(result!.mask[10 * width + 10]).toBe(255);
    expect(result!.mask[0]).toBe(0);
  });

  it("removes background color based on corner sampling and tolerance", () => {
    const width = 16;
    const height = 16;
    const img = createTestImageData(width, height);
    const data = img.data;

    // Fill with green background (chroma key)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 0;
      data[i + 1] = 255;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }

    // Center character is red (4,4 to 12,12)
    for (let y = 4; y < 12; y++) {
      for (let x = 4; x < 12; x++) {
        const idx = (y * width + x) * 4;
        data[idx] = 255;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 255;
      }
    }

    const out = removeBackground(img, { tolerance: 30, feather: 1 });
    // Corner should be transparent
    expect(out.data[3]).toBe(0);
    // Center character should stay fully opaque
    const centerIdx = (6 * width + 6) * 4;
    expect(out.data[centerIdx]).toBe(255);
    expect(out.data[centerIdx + 3]).toBe(255);
  });

  it("generates tangent space normal map and depth map", () => {
    const width = 8;
    const height = 8;
    const img = createTestImageData(width, height);
    // Fill half white, half black
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const val = x >= 4 ? 255 : 0;
        const idx = (y * width + x) * 4;
        img.data[idx] = val;
        img.data[idx + 1] = val;
        img.data[idx + 2] = val;
        img.data[idx + 3] = 255;
      }
    }

    const normalMap = generateNormalMap(img, 2.0);
    expect(normalMap.width).toBe(width);
    expect(normalMap.height).toBe(height);
    // Blue channel (Z / up) should be > 0
    expect(normalMap.data[2]).toBeGreaterThan(0);

    const depthMap = generateDepthMap(img);
    expect(depthMap.width).toBe(width);
    expect(depthMap.data[0]).toBe(0);
    expect(depthMap.data[4 * 4]).toBe(255);
  });
});
