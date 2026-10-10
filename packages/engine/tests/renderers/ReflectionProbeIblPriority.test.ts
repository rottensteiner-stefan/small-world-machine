import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Enabling scene-level IBL (Scene.irradianceMap/prefilterMap) used to make every material's
// ambient block unconditionally reflect the scene's static, blurry environment bake -- including
// materials with their own per-object dynamic reflection probe (StandardMaterial.envMap, e.g.
// Showcase 15's 3 mirror spheres). That silently hid the sharp real-time reflection behind the
// static one the moment ANY scene-wide IBL was added, with no error or visual cue beyond "the
// mirror spheres look hazy/flat now". These tests pin down the fix: a per-object envMap must be
// checked *before* falling back to the scene's prefilter map, in both the WebGL2 and WebGPU
// ambient-lighting code.
describe("Per-object reflection probe takes priority over scene-level IBL", () => {
  const glsl2Path = path.resolve(
    __dirname,
    "../../src/renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl",
  );
  const glsl2Content = fs.readFileSync(glsl2Path, "utf-8");

  const wgslPath = path.resolve(
    __dirname,
    "../../src/renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl",
  );
  const wgslContent = fs.readFileSync(wgslPath, "utf-8");

  it("WebGL2: checks u_useEnvMap before sampling u_prefilterMap inside the IBL ambient block", () => {
    const iblBlockStart = glsl2Content.indexOf("#ifdef USE_IBL");
    const iblBlockEnd = glsl2Content.indexOf("#else", iblBlockStart);
    expect(iblBlockStart).toBeGreaterThan(-1);
    expect(iblBlockEnd).toBeGreaterThan(iblBlockStart);
    const iblBlock = glsl2Content.slice(iblBlockStart, iblBlockEnd);

    const envMapCheckIndex = iblBlock.indexOf("u_useEnvMap > 0.5");
    const prefilterSampleIndex = iblBlock.indexOf("textureLod(u_prefilterMap");
    expect(envMapCheckIndex).toBeGreaterThan(-1);
    expect(prefilterSampleIndex).toBeGreaterThan(-1);
    expect(envMapCheckIndex).toBeLessThan(prefilterSampleIndex);
    expect(iblBlock).toContain("textureLod(u_envMap, R, lod)");
  });

  it("WebGPU: checks obj.useEnvMap before falling back to u_prefilterMap", () => {
    const envMapCheckIndex = wgslContent.indexOf("obj.useEnvMap > 0.5");
    const prefilterSampleIndex = wgslContent.indexOf("textureSampleLevel(u_prefilterMap");
    expect(envMapCheckIndex).toBeGreaterThan(-1);
    expect(prefilterSampleIndex).toBeGreaterThan(-1);
    expect(envMapCheckIndex).toBeLessThan(prefilterSampleIndex);
    expect(wgslContent).toContain("textureSampleLevel(u_envMap, s, R, lod)");
  });

  it("WebGL2Renderer adds USE_IBL alongside any material-provided flags instead of replacing them", () => {
    const rendererPath = path.resolve(__dirname, "../../src/renderers/WebGL2/WebGL2Renderer.ts");
    const rendererContent = fs.readFileSync(rendererPath, "utf-8");
    const shaderFlagsBlock = rendererContent.slice(
      rendererContent.indexOf("const shaderFlags = manifest.flags"),
    );
    // USE_IBL must be pushed onto the existing flags array, never assigned wholesale -- otherwise
    // a per-material flag like USE_ENV_MAP (added by StandardMaterial whenever `envMap` is set)
    // would be lost as soon as the scene also has IBL data.
    expect(shaderFlagsBlock.indexOf('shaderFlags.push("USE_IBL")')).toBeGreaterThan(-1);
    expect(shaderFlagsBlock).not.toMatch(/shaderFlags\s*=\s*\[\s*"USE_IBL"/);
  });
});
