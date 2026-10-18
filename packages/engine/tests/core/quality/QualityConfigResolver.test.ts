import { describe, it, expect } from "vitest";
import { QualityConfigResolver } from "../../../src/core/quality/QualityConfigResolver.js";
import { PerformanceTier } from "../../../src/core/DeviceCaps.js";
import type { PostProcessingConfig, QualityConfig } from "../../../src/interfaces/index.js";

describe("QualityConfigResolver (ADR 0035, statischer Tier-Resolver)", () => {
  it("HIGH reproduces today's desktop behavior: stays empty when no explicit overrides", () => {
    const resolved = QualityConfigResolver.resolve(PerformanceTier.HIGH);
    expect(resolved.quality).toEqual({});
    expect(resolved.postProcessing).toEqual({});
  });

  it("HIGH still carries through explicit author overrides untouched", () => {
    const quality: QualityConfig = { hdr: true, msaa: 8 };
    const post: PostProcessingConfig = { enabled: true, effects: { bloom: { enabled: true } } };
    const resolved = QualityConfigResolver.resolve(PerformanceTier.HIGH, quality, post);
    expect(resolved.quality).toEqual(quality);
    expect(resolved.postProcessing).toEqual(post);
  });

  it("LOW applies the aggressive tier policy when the author set nothing", () => {
    const resolved = QualityConfigResolver.resolve(PerformanceTier.LOW);
    expect(resolved.quality.hdr).toBe(false);
    expect(resolved.quality.msaa).toBe(0);
    expect(resolved.quality.maxAnisotropy).toBe(1);
    expect(resolved.quality.maxShadowResolution).toBe(512);
    expect(resolved.quality.maxPixelRatio).toBe(1);
    expect(resolved.postProcessing.effects?.hbao?.enabled).toBe(false);
    expect(resolved.postProcessing.effects?.volumetricFog?.enabled).toBe(false);
    expect(resolved.postProcessing.effects?.lightShafts?.enabled).toBe(false);
  });

  it("MEDIUM applies only conservative reductions when the author set nothing", () => {
    const resolved = QualityConfigResolver.resolve(PerformanceTier.MEDIUM);
    expect(resolved.quality.msaa).toBe(2);
    expect(resolved.quality.maxAnisotropy).toBe(2);
    expect(resolved.quality.hdr).toBeUndefined();
  });

  it("generic override lock: an explicitly set author field wins against the tier (Ebene 3)", () => {
    const quality: QualityConfig = { hdr: true, msaa: 4, maxShadowResolution: 2048 };
    const resolved = QualityConfigResolver.resolve(PerformanceTier.LOW, quality);
    expect(resolved.quality.hdr).toBe(true);
    expect(resolved.quality.msaa).toBe(4);
    expect(resolved.quality.maxShadowResolution).toBe(2048);
    // unset axes still follow the tier policy
    expect(resolved.quality.maxAnisotropy).toBe(1);
    expect(resolved.quality.maxPixelRatio).toBe(1);
  });

  it("override lock works per effect: author's effect object wins, policy still fills the rest", () => {
    const post: PostProcessingConfig = {
      effects: { bloom: { enabled: true, intensity: 0.9 } },
    };
    const resolved = QualityConfigResolver.resolve(PerformanceTier.LOW, undefined, post);
    expect(resolved.postProcessing.effects?.bloom?.enabled).toBe(true);
    expect(resolved.postProcessing.effects?.bloom?.intensity).toBe(0.9);
    // untouched expensive effects still get disabled by the low policy
    expect(resolved.postProcessing.effects?.hbao?.enabled).toBe(false);
    expect(resolved.postProcessing.effects?.volumetricFog?.enabled).toBe(false);
  });

  it("author-set postProcessing.enabled=false is preserved, not flipped by the tier", () => {
    const resolved = QualityConfigResolver.resolve(PerformanceTier.LOW, undefined, {
      enabled: false,
    });
    expect(resolved.postProcessing.enabled).toBe(false);
  });

  it("empty author objects resolve identically to no author config (no partial leftovers)", () => {
    const withEmpty = QualityConfigResolver.resolve(PerformanceTier.LOW, {}, {});
    const without = QualityConfigResolver.resolve(PerformanceTier.LOW);
    expect(withEmpty).toEqual(without);
  });
});
