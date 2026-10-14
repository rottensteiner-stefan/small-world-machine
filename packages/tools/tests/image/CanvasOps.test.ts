import { describe, it, expect } from "vitest";
import {
  cropImage,
  autocropImage,
  flipImage,
  rotateImage,
  scaleImage,
  padToPowerOfTwo,
  recolorImage,
  adjustImage,
  grayscaleImage,
  invertImage,
  sepiaImage,
  posterizeImage,
  autoLevelsImage,
  outlineImage,
  chromaKeyImage,
  generateEmissiveMap,
  generateSpecularMap,
  generateAoMap,
  parseActionChips,
  makeImageData,
} from "../../src/common/image/index.js";

function createTestImage(
  width: number,
  height: number,
  fillRgba: [number, number, number, number] = [0, 0, 0, 0],
): ImageData {
  const img = makeImageData(width, height);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fillRgba[0];
    data[i + 1] = fillRgba[1];
    data[i + 2] = fillRgba[2];
    data[i + 3] = fillRgba[3];
  }
  return img;
}

describe("CanvasOps Deterministic Image Transformations", () => {
  it("crops image to specified sub-rectangle", () => {
    const src = createTestImage(10, 10, [100, 100, 100, 255]);
    // Set pixel (2, 3) to red
    const idx = (3 * 10 + 2) * 4;
    src.data[idx] = 255;
    src.data[idx + 1] = 0;
    src.data[idx + 2] = 0;

    const cropped = cropImage(src, 2, 3, 4, 4);
    expect(cropped.width).toBe(4);
    expect(cropped.height).toBe(4);
    expect(cropped.data[0]).toBe(255); // (0,0) in crop is (2,3) in src
    expect(cropped.data[1]).toBe(0);
  });

  it("autocrops transparent border padding", () => {
    const src = createTestImage(20, 20, [0, 0, 0, 0]);
    // Paint a 6x6 solid box from (5,5) to (10,10)
    for (let y = 5; y <= 10; y++) {
      for (let x = 5; x <= 10; x++) {
        const i = (y * 20 + x) * 4;
        src.data[i] = 200;
        src.data[i + 3] = 255;
      }
    }

    const trimmed = autocropImage(src);
    expect(trimmed.width).toBe(6);
    expect(trimmed.height).toBe(6);
    expect(trimmed.data[0]).toBe(200);
    expect(trimmed.data[3]).toBe(255);
  });

  it("flips image horizontally and vertically", () => {
    const src = createTestImage(4, 4, [0, 0, 0, 255]);
    // Top-left pixel is red
    src.data[0] = 255;
    src.data[1] = 0;

    const flipH = flipImage(src, true, false);
    // Top-right pixel (x=3, y=0) should be red
    expect(flipH.data[3 * 4]).toBe(255);

    const flipV = flipImage(src, false, true);
    // Bottom-left pixel (x=0, y=3) should be red
    expect(flipV.data[(3 * 4 + 0) * 4]).toBe(255);
  });

  it("rotates image by 90 and 180 degrees", () => {
    const src = createTestImage(4, 2, [0, 0, 0, 255]);
    // Set pixel (0, 0) to red
    src.data[0] = 255;

    const rot90 = rotateImage(src, 90);
    expect(rot90.width).toBe(2);
    expect(rot90.height).toBe(4);

    const rot180 = rotateImage(src, 180);
    expect(rot180.width).toBe(4);
    expect(rot180.height).toBe(2);
  });

  it("scales image using nearest neighbor pixel scaling", () => {
    const src = createTestImage(4, 4, [100, 100, 100, 255]);
    src.data[0] = 255; // Red pixel at (0,0)

    const scaled = scaleImage(src, 2);
    expect(scaled.width).toBe(8);
    expect(scaled.height).toBe(8);
    // 2x2 block at top-left should be red
    expect(scaled.data[0]).toBe(255);
    expect(scaled.data[4]).toBe(255);
    expect(scaled.data[(1 * 8 + 0) * 4]).toBe(255);
    expect(scaled.data[(1 * 8 + 1) * 4]).toBe(255);
  });

  it("pads canvas to next Power-of-Two dimensions", () => {
    const src = createTestImage(50, 70, [255, 0, 0, 255]);
    const pot = padToPowerOfTwo(src);
    expect(pot.width).toBe(64);
    expect(pot.height).toBe(128);
  });

  it("recolors matching pixel hues with tolerance", () => {
    const src = createTestImage(4, 4, [255, 0, 0, 255]); // Pure red
    const recolored = recolorImage(src, "#ff0000", "#0000ff", 30);
    expect(recolored.data[0]).toBe(0);
    expect(recolored.data[1]).toBe(0);
    expect(recolored.data[2]).toBe(255); // Turned blue
  });

  it("adjusts brightness, contrast, grayscale, and invert", () => {
    const src = createTestImage(2, 2, [100, 150, 200, 255]);

    const gray = grayscaleImage(src);
    expect(gray.data[0]).toBe(gray.data[1]);
    expect(gray.data[1]).toBe(gray.data[2]);

    const inverted = invertImage(src);
    expect(inverted.data[0]).toBe(255 - 100);
    expect(inverted.data[1]).toBe(255 - 150);
    expect(inverted.data[2]).toBe(255 - 200);

    const adjusted = adjustImage(src, { brightness: 1.2 });
    expect(adjusted.data[0]).toBe(120);
  });

  it("applies posterization, sepia, auto levels, and chroma key", () => {
    const src = createTestImage(4, 4, [120, 130, 140, 255]);
    const post = posterizeImage(src, 4);
    expect([post.data[0], post.data[1], post.data[2], post.data[3]]).toEqual([85, 170, 170, 255]);

    const sepia = sepiaImage(src);
    expect(sepia.data[0]).toBeGreaterThan(0);

    const levels = autoLevelsImage(src);
    expect([levels.data[0], levels.data[1], levels.data[2]]).toEqual([120, 130, 140]);

    const ramp = makeImageData(
      2,
      1,
      new Uint8ClampedArray([100, 100, 100, 255, 150, 150, 150, 255]),
    );
    const stretched = autoLevelsImage(ramp);
    expect(stretched.data[0]).toBe(0);
    expect(stretched.data[4]).toBe(255);

    const chroma = chromaKeyImage(src, "#78828c", 30);
    expect(chroma.data[3]).toBe(0); // keyed out to transparent
  });

  it("adds pixel-art outline around sprite boundaries", () => {
    const src = createTestImage(6, 6, [0, 0, 0, 0]);
    // 2x2 solid center from (2,2) to (3,3)
    for (let y = 2; y <= 3; y++) {
      for (let x = 2; x <= 3; x++) {
        const i = (y * 6 + x) * 4;
        src.data[i] = 255;
        src.data[i + 3] = 255;
      }
    }

    const outlined = outlineImage(src, "#00ff00", 1);
    // Center remains red
    expect(outlined.data[(2 * 6 + 2) * 4]).toBe(255);
    // Border neighbor (1, 2) becomes green outline
    const borderIdx = (2 * 6 + 1) * 4;
    expect(outlined.data[borderIdx + 1]).toBe(255);
    expect(outlined.data[borderIdx + 3]).toBe(255);
  });

  it("generates emissive, specular, and ambient occlusion maps", () => {
    const src = createTestImage(8, 8, [220, 220, 220, 255]);
    const emissive = generateEmissiveMap(src, 200);
    expect(emissive.data[0]).toBe(220);

    const spec = generateSpecularMap(src, false);
    expect(spec.data[0]).toBeGreaterThan(0);

    const ao = generateAoMap(src, 2);
    expect(ao.data[0]).toBeGreaterThan(0);
  });

  it("parses diverse AI command chips from natural text", () => {
    const aiResponse = `
Here is my analysis of your character sprite:
- We can remove the white background using [REMBG].
- Let's crop the transparent margins with [AUTOCROP].
- Flip it horizontally: [FLIP_H].
- Add a 1px black outline: [OUTLINE: #000000, 1].
- Recolor the belt: [RECOLOR: #ff0000 -> #00ff00].
- Generate tangent-space normal vectors: [NORMAL_MAP] and [DEPTH_MAP].
- Slice into 6 frames: [SLICE: 6].
    `;

    const chips = parseActionChips(aiResponse);
    expect(chips.length).toBe(8);

    const ids = chips.map((c) => c.id);
    expect(ids).toContain("rembg");
    expect(ids).toContain("autocrop");
    expect(ids).toContain("flip_h");
    expect(ids).toContain("outline_#000000_1");
    expect(ids).toContain("recolor_#ff0000_#00ff00");
    expect(ids).toContain("normal_map");
    expect(ids).toContain("depth_map");
    expect(ids).toContain("slice_6");
  });

  it("rejects conversational natural text without bracketed tokens in parseActionChips", () => {
    const conversationalText = `
      Was ist eine Normal Map?
      Can you please trim the border, remove background and calculate ambient occlusion?
      Also rotate and flip horizontally.
    `;
    const chips = parseActionChips(conversationalText);
    expect(chips).toHaveLength(0);
  });

  it("throws error for non-orthogonal rotation angles in rotateImage", () => {
    const src = createTestImage(4, 4, [100, 100, 100, 255]);
    expect(() => rotateImage(src, 45)).toThrow(/only supports right-angle rotations/);
    expect(() => rotateImage(src, 120)).toThrow(/only supports right-angle rotations/);
  });

  it("throws fail-fast error when scaled image exceeds MAX_CANVAS_EDGE or MAX_PIXELS", () => {
    const src = createTestImage(2048, 2048, [50, 50, 50, 255]);
    // 2048 * 4 = 8192 > 4096
    expect(() => scaleImage(src, 4)).toThrow(/exceed maximum allowed canvas size/);
  });
});
