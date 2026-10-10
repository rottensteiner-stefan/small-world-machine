// T3: Posterize/quantization transport + level-count contract (liquid-extras side).
//
// Part of `.agents/collaborate/liquid-roadmap.md` §8.2/T3. Verifies that the Noir/Oil
// extension snippets (which ride the `u_styleA.w` lane) are transported through the full
// shader-assembly pipeline in all three backends, and that the posterize rule
//   inkSteps = max(posterizeSteps - 1, 1) ; out = floor(v * inkSteps + 0.5) / inkSteps
// produces exactly inkSteps+1 levels with a top bucket (+0.5 rounding) that never overflows
// — i.e. NO off-by-one "fix" and no >1 clamp artifact. Mirrors the shader math in JS.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import { ShaderRegistry } from "@small-world-machine/engine";
import { ShaderBootstrap } from "@small-world-machine/engine/core/renderers/shaders/ShaderBootstrap.js";
import { NoirWaterMaterial } from "../src/materials/NoirWater/NoirWaterMaterial.js";
import { OilSlickMaterial } from "../src/materials/OilSlick/OilSlickMaterial.js";

const REGISTRY_JSON = new URL(
  "../../../scripts/lane-contracts/lane-contracts.json",
  import.meta.url,
);

const registry = ShaderRegistry.instance;

function quantize(v: number, posterizeSteps: number): number {
  const inkSteps = Math.max(posterizeSteps - 1, 1);
  return Math.floor(v * inkSteps + 0.5) / inkSteps;
}

describe("Liquid extension shader transport (T3)", () => {
  beforeAll(async () => {
    await ShaderBootstrap.init();
  });

  it("assembles Noir across glsl300/glsl100/wgsl and transports the posterize block", () => {
    const def = new NoirWaterMaterial({ posterizeSteps: 5 }).getShaderDefinition();
    expect(def.sources.glsl300?.fs).toBeDefined();
    expect(def.sources.glsl100?.fs).toBeDefined();
    expect(def.sources.wgsl).toBeDefined();

    const backends = [
      ["glsl300", def.sources.glsl300!.fs!],
      ["glsl100", def.sources.glsl100!.fs!],
      ["wgsl", def.sources.wgsl!],
    ] as const;
    for (const [backend, source] of backends) {
      const assembled = registry.assemble(source, backend);
      expect(assembled).not.toMatch(/\[[A-Z][A-Z0-9_]+\]/);
      expect(assembled).toContain("inkSteps");
      expect(assembled).toContain("floor(inkTone * inkSteps + 0.5) / inkSteps");
    }
  });

  it("keeps the inkSteps = max(posterizeSteps - 1, 1) rule (no off-by-one fix)", () => {
    const def = new NoirWaterMaterial().getShaderDefinition();
    const backends = [
      ["glsl300", def.sources.glsl300!.fs!],
      ["glsl100", def.sources.glsl100!.fs!],
      ["wgsl", def.sources.wgsl!],
    ] as const;
    for (const [backend, source] of backends) {
      const assembled = registry.assemble(source, backend);
      expect(assembled).toMatch(/inkSteps\s*=\s*max\([^)]*-\s*1\.0/);
    }
  });

  it("transports OilSlick across all backends via the same lane", () => {
    const def = new OilSlickMaterial().getShaderDefinition();
    const backends = [
      ["glsl300", def.sources.glsl300!.fs!],
      ["glsl100", def.sources.glsl100!.fs!],
      ["wgsl", def.sources.wgsl!],
    ] as const;
    for (const [backend, source] of backends) {
      const assembled = registry.assemble(source, backend);
      expect(assembled).not.toMatch(/\[[A-Z][A-Z0-9_]+\]/);
      expect(assembled).toContain("oilFilmThinFilm");
    }
  });

  it("produces exactly inkSteps+1 quantization levels for every posterizeSteps 2..8", () => {
    for (let p = 2; p <= 8; p++) {
      const inkSteps = p - 1;
      const outputs = new Set<number>();
      for (let i = 0; i <= 1024; i++) {
        outputs.add(quantize(i / 1024, p));
      }
      expect(outputs.size).toBe(inkSteps + 1);
      expect(Math.min(...outputs)).toBe(0);
      expect(Math.max(...outputs)).toBe(1);
      expect(quantize(1.0, p)).toBe(1.0);
      expect(quantize(0.9999, p)).toBeLessThanOrEqual(1.0);
    }
  });

  it("keeps the bright-input top bucket plus-0.5 rounding from ever overflowing 1.0", () => {
    // Art-bucket audit: the shoot rule floor(v*inkSteps+0.5)/inkSteps must not emit >1 for any
    // input in [0,1], including the top bucket on near-white values.
    for (let p = 2; p <= 8; p++) {
      for (let i = 0; i <= 4096; i++) {
        const out = quantize(i / 4096, p);
        expect(out).toBeGreaterThanOrEqual(0);
        expect(out).toBeLessThanOrEqual(1);
      }
    }
  });

  it("matches the registry: lane carve-outs are declaratively exclusive for styleId 3", () => {
    const registryDoc = JSON.parse(fs.readFileSync(REGISTRY_JSON, "utf8"));
    const lanes = registryDoc.lanes;

    const posterize = lanes.find(
      (l: { meaning: string }) => "posterizeSteps (extension carve-out)" === l.meaning,
    );
    expect(posterize).toBeDefined();
    expect(posterize.materialTypes).toContain("NoirWaterMaterial");
    expect(posterize.styleIds).toEqual([3]);

    const iridescence = lanes.find(
      (l: { meaning: string }) => "iridescenceStrength (extension carve-out)" === l.meaning,
    );
    expect(iridescence).toBeDefined();
    expect(iridescence.materialTypes).toContain("OilSlickMaterial");
    expect(iridescence.styleIds).toEqual([3]);

    const baseLineWidth = lanes.find(
      (l: { meaning: string; materialTypes: string[] }) =>
        "lineWidth" === l.meaning && l.materialTypes.includes("StylizedWaterMaterial"),
    );
    expect(baseLineWidth).toBeDefined();
    expect(baseLineWidth.styleIds).not.toContain(3);
  });
});
