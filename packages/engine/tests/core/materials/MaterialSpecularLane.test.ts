import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StandardMaterial } from "../../../src/core/materials/surface/StandardMaterial.js";
import { Color } from "../../../src/core/colors/index.js";
import { Texture } from "../../../src/core/textures/index.js";

const SRC_DIR = join(__dirname, "../../../src");
const read = (relative: string): string => readFileSync(join(SRC_DIR, relative), "utf8");

const f0Of = (ior: number): number => Math.pow((ior - 1) / (ior + 1), 2);

describe("KHR_materials_specular: StandardMaterial lane u_matParam12", () => {
  it("is disabled at the spec defaults (no flag, no compile define)", () => {
    const manifest = new StandardMaterial().getRenderManifest();
    const lane = (manifest.properties as Record<string, number[]>)["u_matParam12"]!;

    expect(lane[3]).toBe(0);
    expect(manifest.flags).not.toContain("USE_MATERIAL_SPECULAR");
  });

  it("folds ior and specularColor into lane 12 and ships specularFactor (F90) in lane 13", () => {
    const material = new StandardMaterial({
      ior: 1.5,
      specularFactor: 0.5,
      specularColor: new Color(1, 0.5, 0),
    });
    const manifest = material.getRenderManifest();
    const props = manifest.properties as Record<string, number[]>;
    const tint = props["u_matParam12"]!;

    expect(tint[0]).toBeCloseTo(f0Of(1.5));
    expect(tint[1]).toBeCloseTo(f0Of(1.5) * Math.pow(0.5, 2.2));
    expect(tint[2]).toBeCloseTo(0);
    expect(tint[3]).toBe(1);
    expect(props["u_matParam13"]![0]).toBe(0.5);
    expect(manifest.flags).toContain("USE_MATERIAL_SPECULAR");
  });

  it("ships the tint unclamped; the shaders clamp F0 to 1", () => {
    const material = new StandardMaterial({
      ior: 3.0,
      specularColor: new Color(1e6, 1e6, 1e6),
    });
    const lane = (material.getRenderManifest().properties as Record<string, number[]>)[
      "u_matParam12"
    ]!;

    expect(lane[0]).toBeGreaterThan(1);
  });

  it("re-disables the lane when the material returns to the defaults", () => {
    const material = new StandardMaterial({ specularFactor: 0.2 });
    material.getRenderManifest();
    material.specularFactor = 1;
    const manifest = material.getRenderManifest();

    expect((manifest.properties as Record<string, number[]>)["u_matParam12"]![3]).toBe(0);
    expect(manifest.flags).not.toContain("USE_MATERIAL_SPECULAR");
  });
});

describe("KHR_materials_specular: textures (WebGPU + WebGL2, ADR 0054 revisit)", () => {
  it("a specular map alone enables the lane and sets only its own compile flag", () => {
    const material = new StandardMaterial({ specularMap: Texture.fromImage({} as ImageBitmap) });
    const manifest = material.getRenderManifest();

    expect((manifest.properties as Record<string, number[]>)["u_matParam12"]![3]).toBe(1);
    expect(manifest.flags).toContain("USE_MATERIAL_SPECULAR");
    expect(manifest.flags).toContain("USE_SPECULAR_WEIGHT_MAP");
    expect(manifest.flags).not.toContain("USE_SPECULAR_COLOR_MAP");
    expect(manifest.textures["u_specularWeightMap"]).toBe(material.specularMap);
  });

  it("a specular colour map sets its own compile flag and texture slot", () => {
    const material = new StandardMaterial({
      specularColorMap: Texture.fromImage({} as ImageBitmap),
    });
    const manifest = material.getRenderManifest();

    expect(manifest.flags).toContain("USE_SPECULAR_COLOR_MAP");
    expect(manifest.flags).not.toContain("USE_SPECULAR_WEIGHT_MAP");
    expect(manifest.textures["u_specularColorMap"]).toBe(material.specularColorMap);
  });

  it("declares both maps as flag-gated WebGPU bindings, packed in the shared layout (ADR 0054 revisit)", () => {
    const table = read("renderers/WebGPU/managers/GPUPipelineCache.ts");
    const wgslStructs = read("renderers/shaders/source/web_gpu/chunks/structs.wgsl");
    const lightingPbr = read("renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl");

    // Both maps reach WebGPU behind the per-flag layouts (bindings 28/29).
    expect(table).toContain("u_specularWeightMap");
    expect(table).toContain("u_specularColorMap");
    expect(table).toContain("requiredFlag: ShaderFlag.SPECULAR_WEIGHT_MAP");
    expect(table).toContain("requiredFlag: ShaderFlag.SPECULAR_COLOR_MAP");
    expect(wgslStructs).toContain("@binding(28) var u_specularWeightMap");
    expect(wgslStructs).toContain("@binding(29) var u_specularColorMap");
    // The weight map is only declared in the unpacked layout; the shared layout reads the
    // strength from the colour map's alpha through one sampler, as on WebGL2.
    expect(wgslStructs).toMatch(
      /#ifdef USE_SPECULAR_WEIGHT_MAP[\s\S]*#ifndef USE_SPECULAR_MAPS_SHARED[\s\S]*@binding\(28\) var u_specularWeightMap: texture_2d<f32>;/,
    );
    expect(lightingPbr).toMatch(
      /#ifdef USE_SPECULAR_WEIGHT_MAP[\s\S]*#ifndef USE_SPECULAR_MAPS_SHARED[\s\S]*textureSample\(u_specularWeightMap, s, i\.uv\)\.a[\s\S]*#else[\s\S]*textureSample\(u_specularColorMap, s, i\.uv\)\.a/,
    );
  });
});

describe("KHR_materials_specular: shader parity across the three tiers", () => {
  it("WGSL swaps the IOR-derived F0 for matParam12 behind the runtime w-flag", () => {
    const wgsl = read("renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl");

    expect(wgsl).toContain("obj.matParam12.xyz");
    expect(wgsl).toContain("obj.matParam12.w > 0.5");
    expect(wgsl).toContain("obj.matParam13.x");
  });

  it("WebGL2 swaps F0 behind the USE_MATERIAL_SPECULAR compile gate and declares the uniform under it", () => {
    const chunk = read("renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl");
    const standard = read("core/materials/surface/shaders/Standard.frag.glsl");
    const decal = read("core/materials/surface/shaders/Decal.frag.glsl");

    expect(chunk).toMatch(
      /#ifdef USE_MATERIAL_SPECULAR[\s\S]*vec3 specularTint = u_matParam12\.rgb;[\s\S]*float specularWeight = u_matParam13\.x;[\s\S]*F0 = min\(specularTint, vec3\(1\.0\)\);\s*\n\s*F90 = specularWeight;/,
    );
    expect(chunk).toMatch(
      /#ifdef USE_SPECULAR_COLOR_MAP\s*\n\s*specularTint \*= sRGBToLinear\(texture\(u_specularColorMap, v_uv\)\.rgb\);/,
    );
    expect(chunk).toMatch(
      /#ifdef USE_SPECULAR_WEIGHT_MAP\s*\n(?:#ifdef USE_SPECULAR_MAPS_SHARED[^\n]*\n[^\n]*\n[^\n]*\n#else\n)?\s*specularWeight \*= texture\(u_specularWeightMap, v_uv\)\.a;/,
    );
    expect(standard).toMatch(
      /#ifdef USE_SPECULAR_COLOR_MAP\s*\n\s*uniform sampler2D u_specularColorMap;/,
    );
    expect(standard).toMatch(
      /#if defined\(USE_SPECULAR_WEIGHT_MAP\) && !defined\(USE_SPECULAR_MAPS_SHARED\)\s*\n\s*uniform sampler2D u_specularWeightMap;/,
    );
    expect(standard).toMatch(
      /#ifdef USE_MATERIAL_SPECULAR[\s\S]*uniform vec4 u_matParam12;\s*\n\s*uniform vec4 u_matParam13;/,
    );
    expect(decal).not.toContain("u_matParam12");
    expect(decal).not.toContain("u_matParam13");
  });

  it("WebGL1 swaps F0 behind the runtime w-flag and declares the uniform", () => {
    const chunk = read("renderers/shaders/source/web_gl1/chunks/light_calc_pbr.frag.glsl");
    const standard = read("core/materials/surface/shaders/Standard.frag.glsl100");

    expect(chunk).toContain("specularEnabled ? min(u_matParam12.rgb, vec3(1.0))");
    expect(chunk).toContain("specularEnabled ? u_matParam13.x : 1.0");
    expect(standard).toContain("uniform vec4 u_matParam12;");
    expect(standard).toContain("uniform vec4 u_matParam13;");
  });

  const chunks: ReadonlyArray<readonly [string, string]> = [
    ["WGSL", "renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl"],
    ["WebGL2", "renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl"],
    ["WebGL1", "renderers/shaders/source/web_gl1/chunks/light_calc_pbr.frag.glsl"],
  ];

  for (const [tier, file] of chunks) {
    it(`${tier}: every F0 Fresnel call carries F90 (only the fixed 0.04 clearcoat lobe stays plain)`, () => {
      const source = read(file);
      const plainF0Calls = source.match(/F_Schlick(Roughness)?\([^)]*\bF0\b[^)]*\)/g) ?? [];

      expect(plainF0Calls).toEqual([]);
      expect(source).toMatch(/F90 = mix\(\s*(dielectricF90|F90), 1\.0, metallic\)/);
    });
  }
});
