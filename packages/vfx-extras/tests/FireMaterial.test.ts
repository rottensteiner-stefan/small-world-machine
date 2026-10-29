import { describe, it, expect } from "vitest";
import { BlendingMode, Color, CullMode, Vector3D } from "@small-world-machine/engine";
import { FireMaterial, FlamePalettes } from "../src/fire/FireMaterial.js";
import { FlameGlowMaterial } from "../src/fire/FlameGlowMaterial.js";
import { createFlameCardGeometry } from "../src/fire/createFlameCardGeometry.js";

describe("FireMaterial", () => {
  it("renders additively, double-sided and without depth writes", () => {
    const state = new FireMaterial().getRenderManifest().state!;
    expect(state.blending).toBe(BlendingMode.ADDITIVE);
    expect(state.transparent).toBe(true);
    expect(state.depthWrite).toBe(false);
    expect(state.culling).toBe(CullMode.NONE);
  });

  it("derives core, body and tip colours from the body temperature", () => {
    const props = new FireMaterial({ temperatureK: 2000 }).getRenderManifest().properties;
    const core = Color.fromTemperature(2800);
    const body = Color.fromTemperature(2000);
    const tip = Color.fromTemperature(1300);
    expect((props["u_matParam1"] as number[]).slice(0, 3)).toEqual([core.r, core.g, core.b]);
    expect((props["u_matParam2"] as number[]).slice(0, 3)).toEqual([body.r, body.g, body.b]);
    expect((props["u_matParam3"] as number[]).slice(0, 3)).toEqual([tip.r, tip.g, tip.b]);
  });

  it("re-derives the ramp when the temperature changes", () => {
    const mat = new FireMaterial({ temperatureK: 2000 });
    mat.getRenderManifest();
    mat.temperatureK = 1500;
    const body = Color.fromTemperature(1500);
    const lane = mat.getRenderManifest().properties["u_matParam2"] as number[];
    expect(lane.slice(0, 3)).toEqual([body.r, body.g, body.b]);
  });

  it("uses an explicit palette instead of the blackbody ramp", () => {
    const props = new FireMaterial({ palette: FlamePalettes.SPECTRAL }).getRenderManifest()
      .properties;
    const { core, body, tip } = FlamePalettes.SPECTRAL;
    expect((props["u_matParam1"] as number[]).slice(0, 3)).toEqual([core.r, core.g, core.b]);
    expect((props["u_matParam2"] as number[]).slice(0, 3)).toEqual([body.r, body.g, body.b]);
    expect((props["u_matParam3"] as number[]).slice(0, 3)).toEqual([tip.r, tip.g, tip.b]);
  });

  it("converts between palette and blackbody mode in both directions", () => {
    const mat = new FireMaterial({ temperatureK: 2000 });
    const lane = (): number[] =>
      (mat.getRenderManifest().properties["u_matParam2"] as number[]).slice(0, 3);
    const blackbody = Color.fromTemperature(2000);
    const wisp = FlamePalettes.WISP.body;

    expect(lane()).toEqual([blackbody.r, blackbody.g, blackbody.b]);
    mat.palette = FlamePalettes.WISP;
    expect(lane()).toEqual([wisp.r, wisp.g, wisp.b]);
    // A temperature change while the palette rules must still land once the palette is dropped.
    mat.temperatureK = 1600;
    mat.palette = undefined;
    const cooled = Color.fromTemperature(1600);
    expect(lane()).toEqual([cooled.r, cooled.g, cooled.b]);
  });

  it("updates its lanes in place across frames", () => {
    const mat = new FireMaterial({ seed: 3, lean: new Vector3D(0.2, 0, -0.1) });
    const first = mat.getRenderManifest().properties["u_matParam0"];
    mat.time = 1.5;
    mat.intensity = 6;
    const props = mat.getRenderManifest().properties;
    expect(props["u_matParam0"]).toBe(first);
    expect(props["u_matParam0"]).toEqual([1.5, 6, 1, 1]);
    expect((props["u_matParam1"] as number[])[3]).toBe(3);
    expect((props["u_matParam4"] as number[]).slice(0, 3)).toEqual([0.2, 0, -0.1]);
  });

  it("ships the same flame model to all three backends", () => {
    const sources = new FireMaterial().getShaderDefinition().sources;
    for (const fs of [sources.glsl300?.fs, sources.glsl100?.fs, sources.wgsl]) {
      expect(fs).toContain("fireFbm");
      expect(fs).toContain("edgeFade");
      expect(fs).toContain("cardTangent");
    }
  });
});

describe("FlameGlowMaterial", () => {
  it("is an additive billboard", () => {
    const state = new FlameGlowMaterial().getRenderManifest().state!;
    expect(state.blending).toBe(BlendingMode.ADDITIVE);
    expect(state.isSprite).toBe(true);
    expect(state.depthWrite).toBe(false);
  });

  it("carries intensity, falloff and temperature colour", () => {
    const props = new FlameGlowMaterial({
      temperatureK: 1900,
      intensity: 0.8,
      falloff: 5,
    }).getRenderManifest().properties;
    const c = Color.fromTemperature(1900);
    expect((props["u_matParam0"] as number[]).slice(0, 2)).toEqual([0.8, 5]);
    expect((props["u_matParam1"] as number[]).slice(0, 3)).toEqual([c.r, c.g, c.b]);
  });

  it("lets an explicit tint override the temperature colour", () => {
    const tint = FlamePalettes.SPECTRAL.body;
    const props = new FlameGlowMaterial({ tint }).getRenderManifest().properties;
    expect((props["u_matParam1"] as number[]).slice(0, 3)).toEqual([tint.r, tint.g, tint.b]);
  });
});

describe("createFlameCardGeometry", () => {
  it("builds one quad per card standing on the origin", () => {
    const geo = createFlameCardGeometry({ cards: 3, width: 0.5, height: 0.8 }).getGeometryData();
    expect(geo.indices!.length).toBe(18);
    const v = geo.vertices;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < v.length; i += 3) {
      minY = Math.min(minY, v[i]!);
      maxY = Math.max(maxY, v[i]!);
    }
    expect(minY).toBe(0);
    expect(maxY).toBeCloseTo(0.8);
  });

  it("aligns each card's +u with cross(up, normal), the axis the shader leans along", () => {
    const geo = createFlameCardGeometry({ cards: 2, width: 1 }).getGeometryData();
    const v = geo.vertices;
    const n = geo.normals!;
    for (let card = 0; card < 2; card++) {
      const o = card * 12;
      const ux = v[o + 3]! - v[o]!;
      const uz = v[o + 5]! - v[o + 2]!;
      const nx = n[o]!;
      const nz = n[o + 2]!;
      // cross((0,1,0), (nx,0,nz)) = (nz, 0, -nx)
      expect(ux).toBeCloseTo(nz);
      expect(uz).toBeCloseTo(-nx);
    }
  });
});
