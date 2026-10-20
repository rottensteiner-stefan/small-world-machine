import { describe, it, expect } from "vitest";
import { MetalReliefPostProcessor } from "../src/post/MetalReliefPostProcessor.js";

describe("MetalReliefPostProcessor", () => {
  it("initializes with intended default parameters", () => {
    const post = new MetalReliefPostProcessor();

    expect(post.reliefStrength).toBe(1.5);
    expect(post.paletteKnifeStrength).toBe(0.5);
    expect(post.paletteKnifeScale).toBe(24.0);
    expect(post.scratchIntensity).toBe(0.35);
    expect(post.scratchScale).toBe(120.0);
    expect(post.targetHue).toBe(0.0);
    expect(post.hueTolerance).toBe(0.09);
    expect(post.desaturation).toBe(0.95);
    expect(post.rustStrength).toBe(0.8);
    expect(post.edgeGlintStrength).toBe(1.2);
    expect(post.wetRainStreaks).toBe(0.5);
    expect(post.wireMeshStrength).toBe(0.0);
    expect(post.wireMeshScale).toBe(30.0);
  });

  it("accepts custom configurations", () => {
    const post = new MetalReliefPostProcessor({
      reliefStrength: 2.5,
      paletteKnifeStrength: 0.8,
      scratchIntensity: 0.5,
      targetHue: 0.1,
      desaturation: 0.8,
      rustStrength: 0.9,
      edgeGlintStrength: 2.0,
      wetRainStreaks: 0.7,
      wireMeshStrength: 0.4,
    });

    expect(post.reliefStrength).toBe(2.5);
    expect(post.paletteKnifeStrength).toBe(0.8);
    expect(post.scratchIntensity).toBe(0.5);
    expect(post.targetHue).toBe(0.1);
    expect(post.desaturation).toBe(0.8);
    expect(post.rustStrength).toBe(0.9);
    expect(post.edgeGlintStrength).toBe(2.0);
    expect(post.wetRainStreaks).toBe(0.7);
    expect(post.wireMeshStrength).toBe(0.4);
  });

  it("safely handles destroy without prior initialization", () => {
    const post = new MetalReliefPostProcessor();
    expect(() => post.destroy()).not.toThrow();
  });
});
