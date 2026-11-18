import { describe, expect, it } from "vitest";
import { Color, MaterialType, OceanMaterial, Vector2D } from "../../../src/index.js";

describe("OceanMaterial (ADR 0062)", () => {
  it("enforces opaque depth-writing state with skipDepthPrePass enabled", () => {
    const mat = new OceanMaterial();
    expect(mat.type).toBe(MaterialType.OCEAN);
    expect(mat.transparent).toBe(false);
    expect(mat.depthWrite).toBe(true);
    expect(mat.depthTest).toBe(true);
    // In headless Node without document, procedural canvas normal map returns undefined safely.
    expect(mat.normalMap).toBeUndefined();

    const manifest = mat.getRenderManifest();
    expect(manifest.state?.transparent).toBe(false);
    expect(manifest.state?.depthWrite).toBe(true);
    expect(manifest.state?.skipDepthPrePass).toBe(true);
  });

  it("packs domain parameters cleanly into dedicated u_matParamN lanes and zeroes absent reflection", () => {
    const mat = new OceanMaterial({
      waterColor: new Color(0.02, 0.07, 0.12),
      deepWaterColor: new Color(0.005, 0.02, 0.04),
      scatterColor: new Color(0.05, 0.25, 0.32),
      scatterStrength: 0.55,
      windDirection: new Vector2D(3, 4), // norm (0.6, 0.8)
      waveScale: 1.25,
      waveWavelength: 40,
      swellFadeStart: 300,
      swellFadeEnd: 1800,
      foamCoverage: 0.45,
      detailScale: 1.3,
      detailStrength: 1.4,
      reflectionStrength: 0.8,
      reflectionDistortion: 0.12,
      reflectionRoughness: 0.05,
    });

    const def = mat.getShaderDefinition();
    const manifest = mat.getRenderManifest();
    const props = manifest.properties;
    expect(props["u_matParam2"]).toEqual([0.6, 0.8, 1.25, 40]);
    expect(props["u_matParam3"]).toEqual([300, 1800, 0.45, 1.3]);
    expect(props["u_matParam4"]).toEqual([0.05, 0.25, 0.32, 0.55]);
    expect(props["u_matParam5"]).toEqual([1.4, 1, 180, 1.15]);
    // Without reflectionMap assigned, strength lane drops to 0 so the shader skips sampling.
    expect(props["u_matParam9"]).toEqual([0, 0.12, 0.05, 0]);
    expect(def.layout.textures).toHaveProperty("u_oceanDispMap");
    expect(def.layout.textures).toHaveProperty("u_oceanNormFoamMap");

    const disabledFft = new OceanMaterial({
      fftEnabled: false,
      fftPatchSize: 240,
      choppiness: 1.45,
    });
    expect(disabledFft.getRenderManifest().properties["u_matParam5"]).toEqual([1.15, 0, 240, 1.45]);
  });

  it("clones all ocean parameters including FFT controls into an independent instance", () => {
    const original = new OceanMaterial({
      waveScale: 1.4,
      windDirection: new Vector2D(1, 0),
      fftEnabled: true,
      fftPatchSize: 210,
      choppiness: 1.35,
    });
    const cloned = original.clone();
    expect(cloned).not.toBe(original);
    expect(cloned.uuid).not.toBe(original.uuid);
    cloned.waveScale = 2.0;
    cloned.windDirection.set(0, 1);
    cloned.fftEnabled = false;
    cloned.fftPatchSize = 96;
    cloned.choppiness = 0.5;
    expect(original.waveScale).toBe(1.4);
    expect(original.windDirection.x).toBe(1);
    expect(original.fftEnabled).toBe(true);
    expect(original.fftPatchSize).toBe(210);
    expect(original.choppiness).toBe(1.35);
  });

  it("uses camera-centered radial distance across all 3 shader dialects for moving oceans", () => {
    const sources = new OceanMaterial().getShaderDefinition().sources;
    expect(sources.wgsl).toContain("length(wp.xz - global.viewPos.xz)");
    expect(sources.wgsl).toContain("#ifdef USE_OCEAN_FFT");
    expect(sources.glsl300?.vs).toContain("length(wp.xz - u_viewPos.xz)");
    expect(sources.glsl100?.vs).toContain("uniform vec3 u_viewPos;");
    expect(sources.glsl100?.vs).toContain("length(wp.xz - u_viewPos.xz)");
  });
});
