import { describe, expect, it } from "vitest";
import {
  createSeededRng,
  generateTestEquirect,
  resolveIblGenOptions,
  IBL_GEN_DEFAULTS,
  type IblGenOptions,
} from "../src/ibl-gen/ibl-gen-core.js";

describe("createSeededRng (deterministic PRNG — P1 proof: seed actually reseeds)", () => {
  it("returns the same sequence for the same seed", () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("returns a different sequence for a different seed", () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    expect([a(), a()]).not.toEqual([b(), b()]);
  });

  it("is bounded to [0, 1)", () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 50; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("does not leak state across reseeded instances (fresh reseed per call)", () => {
    const first = createSeededRng(123);
    for (let i = 0; i < 10; i++) first();
    const second = createSeededRng(123);
    expect(second()).toEqual(createSeededRng(123)());
  });
});

describe("generateTestEquirect (deterministic input panorama)", () => {
  it("produces byte-identical output for the same seed and size", () => {
    const a = generateTestEquirect(5, 64, 32);
    const b = generateTestEquirect(5, 64, 32);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("produces different output for a different seed", () => {
    const a = generateTestEquirect(5, 64, 32);
    const b = generateTestEquirect(6, 64, 32);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("respects dimensions and always emits opaque RGBA pixels", () => {
    const data = generateTestEquirect(5, 64, 32);
    expect(data.length).toBe(64 * 32 * 4);
    for (let i = 3; i < data.length; i += 4) {
      expect(data[i]).toBe(255);
    }
  });

  it("rejects invalid dimensions (fail fast)", () => {
    expect(() => generateTestEquirect(1, 0, 32)).toThrow(/invalid dimensions/);
    expect(() => generateTestEquirect(1, 64, -1)).toThrow(/invalid dimensions/);
  });
});

describe("resolveIblGenOptions (fail-fast validation)", () => {
  it("fills defaults for omitted options", () => {
    const opts = resolveIblGenOptions({ seed: 3 });
    expect(opts.seed).toBe(3);
    expect(opts.width).toBe(512);
    expect(opts.height).toBe(256);
    expect(opts.envResolution).toBe(IBL_GEN_DEFAULTS.envResolution);
    expect(opts.irradianceResolution).toBe(IBL_GEN_DEFAULTS.irradianceResolution);
    expect(opts.prefilterResolution).toBe(IBL_GEN_DEFAULTS.prefilterResolution);
    expect(opts.prefilterMips).toBe(IBL_GEN_DEFAULTS.prefilterMips);
    expect(opts.brdfResolution).toBe(IBL_GEN_DEFAULTS.brdfResolution);
  });

  it("keeps provided values", () => {
    const opts = resolveIblGenOptions({
      seed: 9,
      width: 1024,
      height: 512,
      envResolution: 256,
    } as Partial<IblGenOptions>);
    expect(opts.width).toBe(1024);
    expect(opts.height).toBe(512);
    expect(opts.envResolution).toBe(256);
  });

  it("rejects non-positive or non-integer numeric options (fail fast)", () => {
    expect(() => resolveIblGenOptions({ width: 0 })).toThrow(/width/);
    expect(() => resolveIblGenOptions({ height: -4 })).toThrow(/height/);
    expect(() => resolveIblGenOptions({ envResolution: 1.5 })).toThrow(/envResolution/);
    expect(() => resolveIblGenOptions({ prefilterMips: 0 })).toThrow(/prefilterMips/);
  });
});
