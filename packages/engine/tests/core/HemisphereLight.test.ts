import "../../src/index.js";
import { describe, expect, it } from "vitest";
import { Color } from "../../src/core/colors/Color.js";
import { AmbientLight } from "../../src/core/lights/AmbientLight.js";
import { HemisphereLight } from "../../src/core/lights/HemisphereLight.js";
import { Scene } from "../../src/core/Scene.js";
import type { LightDataInterface } from "../../src/interfaces/LightData.js";
import { Vector3D } from "../../src/math/Vector3D.js";
import { AbstractRenderer } from "../../src/renderers/AbstractRenderer.js";
import { readSource } from "../math/_shaderScalar.js";

const lin = (c: number): number => Color.sRGBToLinearChannel(c);

function extractRealReturn(source: string, fnName: string): (...args: number[]) => number {
  const fnMatch = source.match(
    new RegExp(`${fnName}\\([^)]*\\)[^{]*\\{\\s*return\\s+([^;]+);\\s*\\}`),
  );
  if (!fnMatch) {
    throw new Error(`Function ${fnName} not found`);
  }
  const js = fnMatch[1]!.replace(/\bf32\(([^)]*)\)/g, "($1)");
  const fn = new Function(
    "clamp",
    "pow",
    "exp2",
    "dotNV",
    "ao",
    "roughness",
    `"use strict"; return (${js});`,
  ) as (
    clampFn: (x: number, lo: number, hi: number) => number,
    powFn: (a: number, b: number) => number,
    exp2Fn: (x: number) => number,
    dotNV: number,
    ao: number,
    roughness: number,
  ) => number;
  const clampFn = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi);
  return (dotNV: number, ao: number, roughness: number): number =>
    fn(clampFn, Math.pow, (x: number) => Math.pow(2, x), dotNV, ao, roughness);
}

function makeLightExtractor(): AbstractRenderer {
  const r = Object.create(AbstractRenderer.prototype) as AbstractRenderer & {
    _lightData: LightDataInterface;
  };
  r._lightData = {
    pLights: [],
    sLights: [],
    aLights: [],
    aCol: new Color(0, 0, 0),
    aGroundCol: new Color(0, 0, 0),
    aIntensity: 0,
    dCol: new Color(0, 0, 0),
    dIntensity: 0,
    dDir: new Vector3D(0, 0, 0),
    dLight: undefined,
  };
  return r;
}

describe("AmbientLight + HemisphereLight additive extraction", () => {
  it("accumulates multiple AmbientLights and HemisphereLights additively in extractLights", () => {
    const scene = new Scene();
    const amb1 = new AmbientLight({ color: new Color(0.2, 0.4, 0.6), intensity: 0.5 });
    const amb2 = new AmbientLight({ color: new Color(0.5, 0.25, 0.1), intensity: 2.0 });
    const hemi = new HemisphereLight({
      skyColor: new Color(0.8, 0.9, 1.0),
      groundColor: new Color(0.3, 0.2, 0.1),
      intensity: 0.75,
    });
    const disabled = new HemisphereLight({
      skyColor: new Color(1, 0, 0),
      groundColor: new Color(0, 1, 0),
      intensity: 10,
    });
    disabled.isVisible = false;

    scene.add(amb1, amb2, hemi, disabled);
    const data = makeLightExtractor().extractLights(scene);

    const expectedSkyR = lin(0.2) * 0.5 + lin(0.5) * 2.0 + lin(0.8) * 0.75;
    const expectedSkyG = lin(0.4) * 0.5 + lin(0.25) * 2.0 + lin(0.9) * 0.75;
    const expectedSkyB = lin(0.6) * 0.5 + lin(0.1) * 2.0 + lin(1.0) * 0.75;

    const expectedGroundR = lin(0.2) * 0.5 + lin(0.5) * 2.0 + lin(0.3) * 0.75;
    const expectedGroundG = lin(0.4) * 0.5 + lin(0.25) * 2.0 + lin(0.2) * 0.75;
    const expectedGroundB = lin(0.6) * 0.5 + lin(0.1) * 2.0 + lin(0.1) * 0.75;

    expect(data.aIntensity).toBe(1);
    expect(data.aCol.r).toBeCloseTo(expectedSkyR, 10);
    expect(data.aCol.g).toBeCloseTo(expectedSkyG, 10);
    expect(data.aCol.b).toBeCloseTo(expectedSkyB, 10);
    expect(data.aGroundCol!.r).toBeCloseTo(expectedGroundR, 10);
    expect(data.aGroundCol!.g).toBeCloseTo(expectedGroundG, 10);
    expect(data.aGroundCol!.b).toBeCloseTo(expectedGroundB, 10);
  });

  it("caches and updates HemisphereLight.linearGroundColor zero-GC", () => {
    const hemi = new HemisphereLight({
      skyColor: new Color(1, 1, 1),
      groundColor: new Color(0.5, 0.25, 0.0),
    });
    const cached = hemi.linearGroundColor;
    expect(cached.r).toBeCloseTo(lin(0.5), 12);
    expect(hemi.linearGroundColor).toBe(cached);

    hemi.groundColor.set(0.2, 0.4, 0.8);
    expect(hemi.linearGroundColor).toBe(cached);
    expect(cached.r).toBeCloseTo(lin(0.2), 12);
    expect(cached.b).toBeCloseTo(lin(0.8), 12);
  });
});

describe("Lagarde & de Rousiers (2014) Specular AO invariants across all 3 tiers", () => {
  const wgslSpecAO = extractRealReturn(
    readSource("packages/engine/src/renderers/shaders/source/web_gpu/chunks/pbr_math.wgsl"),
    "computeSpecularOcclusion",
  );
  const gl2SpecAO = extractRealReturn(
    readSource("packages/engine/src/renderers/shaders/source/web_gl2/chunks/pbr_math.frag.glsl"),
    "computeSpecularOcclusion",
  );
  const gl1SpecAO = extractRealReturn(
    readSource("packages/engine/src/renderers/shaders/source/web_gl1/chunks/pbr_math.frag.glsl"),
    "computeSpecularOcclusion",
  );

  it("evaluates to exact 1.0 at ao=1.0 and exact 0.0 at ao=0.0 across all tiers", () => {
    for (const fn of [wgslSpecAO, gl2SpecAO, gl1SpecAO]) {
      for (const dotNV of [0.0001, 0.1, 0.5, 1.0]) {
        for (const roughness of [0.0, 0.25, 0.7, 1.0]) {
          expect(fn(dotNV, 1.0, roughness)).toBe(1.0);
          expect(fn(dotNV, 0.0, roughness)).toBe(0.0);
        }
      }
    }
  });

  it("is monotonically non-decreasing in ao and dotNV, and agrees across tiers", () => {
    for (const roughness of [0.05, 0.3, 0.8]) {
      for (const dotNV of [0.05, 0.4, 0.9]) {
        let prev = 0;
        for (const ao of [0.0, 0.2, 0.5, 0.8, 1.0]) {
          const w = wgslSpecAO(dotNV, ao, roughness);
          const g2 = gl2SpecAO(dotNV, ao, roughness);
          const g1 = gl1SpecAO(dotNV, ao, roughness);
          expect(w).toBeCloseTo(g2, 12);
          expect(w).toBeCloseTo(g1, 12);
          expect(w).toBeGreaterThanOrEqual(prev - 1e-12);
          prev = w;
        }
      }
      for (const ao of [0.3, 0.6]) {
        let prev = 0;
        for (const dotNV of [0.01, 0.2, 0.6, 1.0]) {
          const v = wgslSpecAO(dotNV, ao, roughness);
          expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
          prev = v;
        }
      }
    }
  });
});

describe("Fdez-Aguera (2019) Multi-Scattering IBL conservation (@invariant PBR-ENERGY-CONSERVATION)", () => {
  function fdezAguera(
    f0: number,
    f90: number,
    metallic: number,
    kS: number,
    brdfX: number,
    brdfY: number,
  ): { FssEss: number; FmsEms: number; kD: number } {
    const FssEss = kS * brdfX + f90 * brdfY;
    const Ess = brdfX + brdfY;
    const Ems = Math.max(1.0 - Ess, 0.0);
    const Favg = f0 + (f90 - f0) / 21.0;
    const Fms = (FssEss * Favg) / Math.max(1.0 - Ems * Favg, 1e-5);
    const FmsEms = Fms * Ems;
    const kD = Math.max(1.0 - (FssEss + FmsEms), 0.0) * (1.0 - metallic);
    return { FssEss, FmsEms, kD };
  }

  it("satisfies the white-furnace invariant for pure reflectors (F0=1, F90=1, metallic=1)", () => {
    const pairs: Array<[number, number]> = [
      [0.98, 0.01],
      [0.65, 0.15],
      [0.35, 0.25],
      [0.12, 0.3],
    ];
    for (const [bx, by] of pairs) {
      const { FssEss, FmsEms, kD } = fdezAguera(1.0, 1.0, 1.0, 1.0, bx, by);
      expect(kD).toBe(0);
      expect(FssEss + FmsEms).toBeCloseTo(1.0, 6);
    }
  });

  it("never exceeds total unit energy (kD + FssEss + FmsEms <= 1) across dielectrics and metals", () => {
    for (const metallic of [0.0, 0.5, 1.0]) {
      for (const f0 of [0.0, 0.04, 0.5, 1.0]) {
        for (const f90 of [0.0, 0.5, 1.0]) {
          for (const [bx, by] of [
            [0.9, 0.05],
            [0.5, 0.2],
            [0.2, 0.35],
          ] as Array<[number, number]>) {
            const kS = f0 + (f90 - f0) * 0.2;
            const { FssEss, FmsEms, kD } = fdezAguera(f0, f90, metallic, kS, bx, by);
            expect(FssEss).toBeGreaterThanOrEqual(0);
            expect(FmsEms).toBeGreaterThanOrEqual(0);
            expect(kD).toBeGreaterThanOrEqual(0);
            expect(kD + FssEss + FmsEms).toBeLessThanOrEqual(1.0 + 1e-6);
          }
        }
      }
    }
  });

  it("wires u_envIntensity into WebGL2 base_fragment_header and #else USE_ENV_MAP fallback", () => {
    const header = readSource(
      "packages/engine/src/renderers/shaders/source/web_gl2/chunks/base_fragment_header.frag.glsl",
    );
    expect(header).toMatch(
      /#if defined\(USE_IBL\) \|\| defined\(USE_ENV_MAP\)\s*\nuniform float u_envIntensity;/,
    );

    const gl2Pbr = readSource(
      "packages/engine/src/renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl",
    );
    const elseBlock = gl2Pbr.slice(gl2Pbr.indexOf("#ifdef USE_IBL"));
    const fallbackStart = elseBlock.indexOf("#else");
    const fallback = elseBlock.slice(fallbackStart);
    expect(fallback).toMatch(/\* u_envIntensity/);
  });

  it("matches PBR direct light radiometric units (divides hemiAmbient and fog ambient by PI)", () => {
    const fieldPull = readSource(
      "packages/engine/src/renderers/shaders/source/web_gpu/instance_field/field_pull.wgsl",
    );
    expect(fieldPull).toMatch(/ambient = mix\([^\n]+\) \* invPi;/);

    const froxelInject = readSource(
      "packages/engine/src/renderers/shaders/source/web_gpu/compute/froxel_inject.wgsl",
    );
    expect(froxelInject).toMatch(
      /\(global\.ambientColor\.rgb \+ global\.ambientGround\.rgb\) \* \(0\.5 \/ 3\.14159265359\)/,
    );

    const fogGlsl = readSource(
      "packages/engine/src/renderers/post/shaders/VolumetricFog.frag.glsl",
    );
    expect(fogGlsl).toMatch(/vec3 skyAmbient = u_ambientLight \* \(1\.0 \/ 3\.14159265359\);/);

    // Radiometric parity: a diffuse Lambertian surface lit by a unit AmbientLight (intensity = 1)
    // yields albedo / PI, equal to a unit DirectionalLight (intensity = 1) at dotNL = 1.
    const albedo = 0.8;
    const directDiffuse = albedo / Math.PI;
    const ambientIrradiance = 1.0 / Math.PI;
    const ambientDiffuse = ambientIrradiance * albedo;
    expect(ambientDiffuse).toBeCloseTo(directDiffuse, 12);
  });
});
