import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { StylizedLavaMaterial } from "../../../src/core/materials/liquid/StylizedLavaMaterial.js";
import { Texture } from "../../../src/core/textures/index.js";
import { VERTEX_COLOR_FLAG } from "../../../src/renderers/shaders/index.js";
import { TextureWrap } from "../../../src/enums/index.js";

const SHADER_DIR = path.resolve(__dirname, "../../../src/core/materials/liquid/shaders");

function repeatingTexture(): Texture {
  return Texture.empty({ addressModeU: TextureWrap.REPEAT, addressModeV: TextureWrap.REPEAT });
}

describe("StylizedLavaMaterial", () => {
  it("defaults to MinionsArt's Astro Kat settings and packs them into the Unity parameter lanes", () => {
    const manifest = new StylizedLavaMaterial().getRenderManifest();
    const p = manifest.properties as Record<string, number[]>;

    // [_Scale, _ScaleDist, _Distortion, _VertexDistortion]
    expect(p["u_matParam0"]).toEqual([0.328, 0.325, 0.292, 0.649]);
    // [_SpeedMainX, _SpeedMainY, _SpeedDistortX, _SpeedDistortY]
    expect(p["u_matParam1"]).toEqual([1.43, 1.04, 0.91, 1.17]);
    // [_Cutoff, _TopBlur, _Offset, _Strength]
    expect(p["u_matParam2"]).toEqual([0.815, 0.1, 1.43, 1.48]);
    // [_Edge, _EdgeBlur, _StrengthTop, unused]
    expect(p["u_matParam3"]).toEqual([5.25, 0.753, 4.94, 0]);
    // [_Speed, _Amount, _Height, unused]
    expect(p["u_matParam4"]).toEqual([0.257, 0.203, 0.282, 0]);
  });

  it("always requests the vertex color stream, and the ramp flag only with a rampMap", () => {
    const material = new StylizedLavaMaterial();
    expect(material.getRenderManifest().flags).toEqual([VERTEX_COLOR_FLAG]);

    material.rampMap = repeatingTexture();
    expect(material.getRenderManifest().flags).toEqual([VERTEX_COLOR_FLAG, "USE_RAMP_LUT"]);

    material.rampMap = undefined;
    expect(material.getRenderManifest().flags).toEqual([VERTEX_COLOR_FLAG]);
  });

  it("routes mainMap/distortMap to their sampler slots", () => {
    const mainMap = repeatingTexture();
    const distortMap = repeatingTexture();
    const manifest = new StylizedLavaMaterial({ mainMap, distortMap }).getRenderManifest();
    expect(manifest.textures["u_diffuseMap"]).toBe(mainMap);
    expect(manifest.textures["u_distortMap"]).toBe(distortMap);
  });

  it("rejects textures that do not repeat (they are projected at world XZ and scrolled)", () => {
    const clamped = Texture.empty({ addressModeU: TextureWrap.CLAMP_TO_EDGE });
    expect(() => new StylizedLavaMaterial({ mainMap: clamped }).getRenderManifest()).toThrow(
      /mainMap must use TextureWrap.REPEAT/,
    );
    expect(() => new StylizedLavaMaterial({ distortMap: clamped }).getRenderManifest()).toThrow(
      /distortMap must use TextureWrap.REPEAT/,
    );
  });

  it("reuses its flag and uniform arrays between frames (no per-frame allocation)", () => {
    const material = new StylizedLavaMaterial();
    const first = material.getRenderManifest();
    const flags = first.flags;
    const lane = (first.properties as Record<string, number[]>)["u_matParam0"];

    material.time = 12.5;
    material.scaleMain = 0.5;
    const second = material.getRenderManifest();

    expect(second.flags).toBe(flags);
    expect((second.properties as Record<string, number[]>)["u_matParam0"]).toBe(lane);
    expect(lane![0]).toBe(0.5);
    expect((second.properties as Record<string, number>)["u_time"]).toBe(12.5);
  });

  it("ships all three shader backends", () => {
    const sources = new StylizedLavaMaterial().getShaderDefinition().sources;
    expect(sources.glsl300?.fs).toContain("u_distortMap");
    expect(sources.glsl100?.fs).toContain("u_distortMap");
    expect(sources.wgsl).toContain("u_distortMap");
  });
});

describe("StylizedLava shader sources", () => {
  const read = (name: string): string => fs.readFileSync(path.join(SHADER_DIR, name), "utf-8");

  it("WGSL only reads flag constants that GPUPipelineCache always declares", () => {
    // GPUPipelineCache emits `const USE_X: bool` only for flags a material lists, except for
    // this set, which always gets a false default. Anything else is an unresolved identifier.
    const alwaysDeclared = new Set([
      "USE_TEXTURE_ARRAY",
      "USE_INSTANCING",
      "USE_NORMAL_MAP",
      "USE_RAMP_LUT",
    ]);
    const used = new Set(read("StylizedLava.frag.wgsl").match(/\bUSE_[A-Z_]+\b/g) ?? []);
    for (const name of used) expect(alwaysDeclared.has(name), name).toBe(true);
  });

  it("uses Unity's time bases in all backends (_Time.x = t/20 in the fragment, _Time.z = 2t in the vertex)", () => {
    for (const file of [
      "StylizedLava.frag.glsl",
      "StylizedLava.frag.glsl100",
      "StylizedLava.frag.wgsl",
    ]) {
      expect(read(file), file).toMatch(/\*\s*0\.05/);
    }
    for (const file of [
      "StylizedLava.vert.glsl",
      "StylizedLava.vert.glsl100",
      "StylizedLava.vert.wgsl",
    ]) {
      expect(read(file), file).toMatch(/\*\s*2\.0/);
    }
  });

  it("every backend multiplies by the red vertex color the way the original does", () => {
    for (const file of [
      "StylizedLava.frag.glsl",
      "StylizedLava.frag.glsl100",
      "StylizedLava.frag.wgsl",
    ]) {
      const source = read(file);
      expect(source, file).toMatch(/\* r;/); // color fade
      expect(source, file).toMatch(/\.r \* r;/); // main texture fade
      expect(source, file).toMatch(/r \* u_matParam0\.w|r \* obj\.matParam0\.w/); // vertex distortion
    }
  });
});
