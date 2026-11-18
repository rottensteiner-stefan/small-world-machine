import { describe, expect, it } from "vitest";
import {
  Color,
  MaterialType,
  OceanMaterial,
  type OceanWaveSample,
  Vector2D,
} from "../../../src/index.js";

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
      causticsStrength: 0.62,
      downwashCenter: new Vector2D(12.5, -24.0),
      downwashRadius: 18.0,
      downwashStrength: 1.25,
    });

    const def = mat.getShaderDefinition();
    const manifest = mat.getRenderManifest();
    const props = manifest.properties;
    expect(props["u_matParam2"]).toEqual([0.6, 0.8, 1.25, 40]);
    expect(props["u_matParam3"]).toEqual([300, 1800, 0.45, 1.3]);
    expect(props["u_matParam4"]).toEqual([0.05, 0.25, 0.32, 0.55]);
    expect(props["u_matParam5"]).toEqual([1.4, 1, 180, 1.15]);
    expect(props["u_matParam6"]).toEqual([12.5, -24.0, 18.0, 1.25]);
    // Without reflectionMap assigned, strength lane drops to 0 so the shader skips sampling.
    expect(props["u_matParam9"]).toEqual([0, 0.12, 0.05, 0.62]);
    expect(def.layout.textures).toHaveProperty("u_oceanDispMap");
    expect(def.layout.textures).toHaveProperty("u_oceanNormFoamMap");

    const disabledFft = new OceanMaterial({
      fftEnabled: false,
      fftPatchSize: 240,
      choppiness: 1.45,
    });
    expect(disabledFft.getRenderManifest().properties["u_matParam5"]).toEqual([1.15, 0, 240, 1.45]);
    expect(disabledFft.getRenderManifest().properties["u_matParam6"]).toEqual([0, 0, 0, 0]);
    expect(disabledFft.getRenderManifest().properties["u_matParam9"]).toEqual([
      0, 0.11, 0.04, 0.38,
    ]);
  });

  it("clones all ocean parameters including FFT, caustics, and downwash controls into an independent instance", () => {
    const original = new OceanMaterial({
      waveScale: 1.4,
      windDirection: new Vector2D(1, 0),
      causticsStrength: 0.52,
      downwashCenter: new Vector2D(8, -14),
      downwashRadius: 22,
      downwashStrength: 0.9,
      fftEnabled: true,
      fftPatchSize: 210,
      choppiness: 1.35,
    });
    const cloned = original.clone();
    expect(cloned).not.toBe(original);
    expect(cloned.uuid).not.toBe(original.uuid);
    cloned.waveScale = 2.0;
    cloned.windDirection.set(0, 1);
    cloned.causticsStrength = 0.1;
    cloned.downwashCenter.set(-5, 9);
    cloned.downwashRadius = 4;
    cloned.downwashStrength = 0.2;
    cloned.fftEnabled = false;
    cloned.fftPatchSize = 96;
    cloned.choppiness = 0.5;
    expect(original.waveScale).toBe(1.4);
    expect(original.windDirection.x).toBe(1);
    expect(original.causticsStrength).toBe(0.52);
    expect(original.downwashCenter.x).toBe(8);
    expect(original.downwashCenter.y).toBe(-14);
    expect(original.downwashRadius).toBe(22);
    expect(original.downwashStrength).toBe(0.9);
    expect(original.fftEnabled).toBe(true);
    expect(original.fftPatchSize).toBe(210);
    expect(original.choppiness).toBe(1.35);
  });

  it("samples the 5-wave Gerstner field in-place for near-field buoyancy and flattens beyond swellFadeEnd", () => {
    const mat = new OceanMaterial({
      waveScale: 1.2,
      waveWavelength: 34,
      swellFadeStart: 200,
      swellFadeEnd: 800,
      windDirection: new Vector2D(1, 0),
      windSpeed: 1.0,
    });
    mat.time = 2.5;

    const out: OceanWaveSample = {
      height: 0,
      displacementX: 0,
      displacementZ: 0,
      normalX: 0,
      normalY: 1,
      normalZ: 0,
      crest: 0,
    };

    const nearResult = mat.sampleWaveAt(15.0, -9.0, out, 0.0, 0.0);
    expect(nearResult).toBe(out);
    expect(Math.abs(out.height)).toBeGreaterThan(1e-3);
    expect(Math.hypot(out.displacementX, out.displacementZ)).toBeGreaterThan(1e-3);
    expect(out.normalY).toBeLessThan(1.0);
    expect(Math.hypot(out.normalX, out.normalY, out.normalZ)).toBeCloseTo(1.0, 5);
    expect(out.crest).toBeGreaterThanOrEqual(0.0);
    expect(out.crest).toBeLessThanOrEqual(1.0);

    // Beyond swellFadeEnd (radial distance 1000 > 800), swellFade reaches 0 -> flat horizon plane.
    mat.sampleWaveAt(1000.0, 0.0, out, 0.0, 0.0);
    expect(out.height).toBe(0);
    expect(out.displacementX).toBe(0);
    expect(out.displacementZ).toBe(0);
    expect(out.normalX).toBe(0);
    expect(out.normalY).toBe(1);
    expect(out.normalZ).toBe(0);
    expect(out.crest).toBe(0);
  });

  it("uses camera-centered radial distance across all 3 shader dialects for moving oceans", () => {
    const sources = new OceanMaterial().getShaderDefinition().sources;
    expect(sources.wgsl).toContain("length(wp.xz - global.viewPos.xz)");
    expect(sources.wgsl).toContain("#ifdef USE_OCEAN_FFT");
    expect(sources.glsl300?.vs).toContain("length(wp.xz - u_viewPos.xz)");
    expect(sources.glsl100?.vs).toContain("uniform vec3 u_viewPos;");
    expect(sources.glsl100?.vs).toContain("length(wp.xz - u_viewPos.xz)");
  });

  it("ships the upgraded foam model per dialect and reads no legacy slots", () => {
    const sources = new OceanMaterial().getShaderDefinition().sources;
    const dialects: Record<string, string | undefined> = {
      wgsl: sources.wgsl,
      glsl300: sources.glsl300?.fs,
      glsl100: sources.glsl100?.fs,
    };
    for (const [name, src] of Object.entries(dialects)) {
      expect(src, `${name} fragment source`).toBeDefined();
      for (const id of [
        "oceanFoamCells",
        "foamLace",
        "crestTexture",
        "downwashRadius",
        "downwashStrength",
        "downwashFoam",
      ]) {
        expect(src, `${name} contains ${id}`).toContain(id);
      }
      // Only u_matParam0..6 and u_matParam9 are packed by OceanMaterial; lanes 7..8 are legacy.
      expect(src, `${name} reads no legacy matParam7..8`).not.toMatch(/matParam[78]\b/);
    }
    // Bore front + contact splash + shallow-water caustics need the shore depth terms: WebGPU and WebGL2 only (WebGL1 has none).
    for (const src of [sources.wgsl, sources.glsl300?.fs]) {
      expect(src).toContain("boreFront");
      expect(src).toContain("contactSplash");
      expect(src).toContain("causticsStrength > 0.0");
      expect(src).toContain("causticNet");
    }
    expect(sources.glsl100?.fs).not.toContain("boreFront");
    expect(sources.glsl100?.fs).not.toContain("contactSplash");
    expect(sources.glsl100?.fs).not.toContain("causticsStrength > 0.0");
    expect(sources.glsl100?.fs).not.toContain("causticNet");
    // Fold (Jacobian) crest channel exists only where the FFT texture exists (WebGPU).
    expect(sources.wgsl).toContain("fftCrestAccum");
    expect(sources.wgsl).toContain("foldCaps");
    expect(sources.wgsl).toContain("nfA.z");
    expect(sources.glsl300?.fs).not.toContain("fftCrestAccum");
    expect(sources.glsl100?.fs).not.toContain("fftCrestAccum");
  });
});
