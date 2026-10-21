import { describe, expect, it } from "vitest";
import {
  detectTextureMapSlot,
  pickKitTextureMap,
} from "../../src/loaders/kit/TextureSlotMatcher.js";

describe("detectTextureMapSlot", () => {
  it("lets the trailing slot token win", () => {
    expect(detectTextureMapSlot("m_albedo.png")).toBe("albedo");
    expect(detectTextureMapSlot("brick_normal.png")).toBe("normal");
    expect(detectTextureMapSlot("brick_rough.png")).toBe("roughness");
  });

  it("skips resolution suffixes instead of matching an earlier material word", () => {
    // `rough` / `metal` here describe the material, the slot is the diffuse token.
    expect(detectTextureMapSlot("rough_concrete_diff_4k.png")).toBe("albedo");
    expect(detectTextureMapSlot("metal_plate_diff_4k.png")).toBe("albedo");
    expect(detectTextureMapSlot("rough_concrete_nor_gl_4k.png")).toBe("normal");
    expect(detectTextureMapSlot("brick_ao_2k.png")).toBe("ao");
    expect(detectTextureMapSlot("brick_rough_8k.jpg")).toBe("roughness");
  });

  it("never matches substrings", () => {
    expect(detectTextureMapSlot("saos.png")).toBeUndefined();
    expect(detectTextureMapSlot("graphite.png")).toBeUndefined();
  });

  it("picks the first file of a slot from a kit item's map list", () => {
    const maps = ["rough_concrete_diff_4k.png", "rough_concrete_rough_4k.png"];
    expect(pickKitTextureMap(maps, "albedo")).toBe("rough_concrete_diff_4k.png");
    expect(pickKitTextureMap(maps, "roughness")).toBe("rough_concrete_rough_4k.png");
  });
});
