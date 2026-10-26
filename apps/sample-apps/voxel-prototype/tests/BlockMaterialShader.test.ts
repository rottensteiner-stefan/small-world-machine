import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fragSource = readFileSync(
  new URL("../voxel/material/shaders/BlockMaterial.frag.glsl", import.meta.url),
  "utf8",
);

const wgslSource = readFileSync(
  new URL("../voxel/material/shaders/BlockMaterial.wgsl", import.meta.url),
  "utf8",
);

describe("BlockMaterial fragment lighting", () => {
  it("keeps the ambient floor inside the direct term (faces with ndl == 0 must not go black)", () => {
    expect(fragSource).toMatch(/\(ambient \+ \(1\.0 - ambient\) \* ndl\)/);
    expect(fragSource).not.toMatch(/\*\s*ndl\s*\*\s*lightFactor/);
  });

  it("WGSL keeps the same ambient floor and reads the same lanes as GLSL", () => {
    expect(wgslSource).toMatch(/\(ambient \+ \(1\.0 - ambient\) \* ndl\)/);
    expect(wgslSource).toContain("obj.matParam0.x"); // daylight
    expect(wgslSource).toContain("obj.matParam0.yzw"); // sun direction
    expect(wgslSource).toContain("obj.matParam1.xyz"); // light tint
    expect(fragSource).toContain("u_matParam0.x");
    expect(fragSource).toContain("u_matParam0.yzw");
    expect(fragSource).toContain("u_matParam1.rgb");
  });

  it("both tiers use the shared ambient constant", () => {
    const ambient = (source: string): string | undefined =>
      /ambient = (\d\.\d+);/.exec(source)?.[1];
    expect(ambient(wgslSource)).toBeDefined();
    expect(ambient(wgslSource)).toBe(ambient(fragSource));
  });

  it("WGSL samples the palette as an array layer and never names the engine's output struct", () => {
    expect(wgslSource).toContain("textureSampleLevel(u_diffuseMap, s, i.uv, i.layer, 0.0)");
    expect(wgslSource).not.toMatch(/-> Out\b/);
  });
});
