import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { wrapFragmentWithNormalOutput } from "../../src/renderers/WebGPU/managers/NormalOutputWrapper.js";
import { GPUPipelineCache } from "../../src/renderers/WebGPU/managers/GPUPipelineCache.js";
import { NormalTargetMode } from "../../src/enums/index.js";
import type { RenderManifest } from "../../src/renderers/shaders/RenderManifest.js";

const materialsDir = fileURLToPath(new URL("../../src/core/materials", import.meta.url));

function collectFragmentShaders(dir: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(found, collectFragmentShaders(path));
    else if (entry.name.endsWith(".frag.wgsl")) found[path] = readFileSync(path, "utf8");
  }
  return found;
}

const materialFragments = collectFragmentShaders(materialsDir);

describe("wrapFragmentWithNormalOutput", () => {
  it("renames fs to fs_color and writes the geometry normal for Out inputs", () => {
    const wrapped = wrapFragmentWithNormalOutput(
      "@fragment fn fs(i: Out) -> @location(0) vec4f {\n  return vec4f(1.0);\n}",
    );

    expect(wrapped).toContain("fn fs_color(i: Out) -> vec4f {");
    expect(wrapped).toContain("g_shadingNormal = normalize(i.n);");
    expect(wrapped).toContain("octEncode(g_shadingNormal)");
    expect(wrapped).toContain("@location(1) normal: vec4f");
  });

  it("matches multi-line entry points and the vec4<f32> spelling", () => {
    const wrapped = wrapFragmentWithNormalOutput(
      "@fragment\nfn fs(in: Out) -> @location(0) vec4<f32> {\n  return vec4f(1.0);\n}",
    );

    expect(wrapped).toContain("fn fs_color(in: Out) -> vec4f {");
    expect(wrapped).toContain("fs_color(in)");
  });

  it("writes the out-of-range sentinel for non-Out inputs", () => {
    const wrapped = wrapFragmentWithNormalOutput(
      "@fragment fn fs(i: LavaOut) -> @location(0) vec4f { return vec4f(1.0); }",
    );

    expect(wrapped).toContain("vec2f(-2.0, -2.0)");
    expect(wrapped).not.toContain("g_shadingNormal = normalize");
  });

  it("returns shaders without a matching entry point unchanged", () => {
    const source = "@compute @workgroup_size(1) fn cs_main() {}";

    expect(wrapFragmentWithNormalOutput(source)).toBe(source);
  });

  it("wraps every material fragment shader the engine ships", () => {
    const entries = Object.entries(materialFragments);
    expect(entries.length).toBeGreaterThan(10);

    for (const [path, source] of entries) {
      if (path.endsWith("Depth.frag.wgsl")) continue;
      expect(wrapFragmentWithNormalOutput(source), path).toContain("fn fs_color(");
    }
  });
});

describe("GPUPipelineCache.pipelineCacheKey normal mode", () => {
  const manifest = {
    shaderId: "Standard",
    properties: [],
    textures: [],
  } as unknown as RenderManifest;
  const cache = Object.create(GPUPipelineCache.prototype) as GPUPipelineCache;

  it("separates write, masked, blend and plain variants", () => {
    const key = (mode: NormalTargetMode): string =>
      cache.pipelineCacheKey(manifest, "triangle-list", false, "rgba16float", mode);

    const keys = new Set([
      key(NormalTargetMode.NONE),
      key(NormalTargetMode.WRITE),
      key(NormalTargetMode.MASKED),
      key(NormalTargetMode.BLEND),
    ]);

    expect(keys.size).toBe(4);
    expect(cache.pipelineCacheKey(manifest, "triangle-list", false, "rgba16float")).toBe(
      key(NormalTargetMode.NONE),
    );
  });
});
