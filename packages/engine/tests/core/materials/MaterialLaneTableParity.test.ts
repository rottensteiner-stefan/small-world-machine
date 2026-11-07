import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  Color,
  FluidSurfaceMaterial,
  OpenWaterMaterial,
  StandardMaterial,
  StylizedWaterMaterial,
} from "../../../src/index.js";
import type { RenderManifest } from "../../../src/index.js";
import { writeLane } from "../../../src/core/materials/MaterialLanes.js";

const SHADER_DIR = join(__dirname, "../../../src/core/materials");

// ADR 0027 / 0039: materials carry per-material look parameters in the typed `u_matParamN` bank
// instead of smuggling them through generic slots (`u_extraParams`, `u_liquidParams`,
// `u_thresholds`, `u_texOffset`, `u_texRepeat`, `u_color.a`). These tests machine-check the two
// halves of that contract:
//   1. the migrated shader trios no longer name the legacy slots (source invariant), and
//   2. the material lane tables reach the render manifest (parity / "same field" proof).

const MIGRATED_SHADER_FILES: ReadonlyArray<[string, string]> = [
  ["Standard.frag.glsl", join(SHADER_DIR, "surface/shaders/Standard.frag.glsl")],
  ["Standard.frag.glsl100", join(SHADER_DIR, "surface/shaders/Standard.frag.glsl100")],
  ["Standard.frag.wgsl", join(SHADER_DIR, "surface/shaders/Standard.frag.wgsl")],
  ["Decal.frag.glsl", join(SHADER_DIR, "surface/shaders/Decal.frag.glsl")],
  ["FluidSurface.frag.glsl", join(SHADER_DIR, "liquid/shaders/FluidSurface.frag.glsl")],
  ["FluidSurface.frag.glsl100", join(SHADER_DIR, "liquid/shaders/FluidSurface.frag.glsl100")],
  ["FluidSurface.frag.wgsl", join(SHADER_DIR, "liquid/shaders/FluidSurface.frag.wgsl")],
  ["FluidSurface.vert.glsl", join(SHADER_DIR, "liquid/shaders/FluidSurface.vert.glsl")],
  ["FluidSurface.vert.glsl100", join(SHADER_DIR, "liquid/shaders/FluidSurface.vert.glsl100")],
  ["FluidSurface.vert.wgsl", join(SHADER_DIR, "liquid/shaders/FluidSurface.vert.wgsl")],
  ["OpenWater.frag.glsl", join(SHADER_DIR, "liquid/shaders/OpenWater.frag.glsl")],
  ["OpenWater.frag.glsl100", join(SHADER_DIR, "liquid/shaders/OpenWater.frag.glsl100")],
  ["OpenWater.frag.wgsl", join(SHADER_DIR, "liquid/shaders/OpenWater.frag.wgsl")],
  ["OpenWater.vert.glsl", join(SHADER_DIR, "liquid/shaders/OpenWater.vert.glsl")],
  ["OpenWater.vert.glsl100", join(SHADER_DIR, "liquid/shaders/OpenWater.vert.glsl100")],
  ["OpenWater.vert.wgsl", join(SHADER_DIR, "liquid/shaders/OpenWater.vert.wgsl")],
  ["StylizedWater.frag.glsl", join(SHADER_DIR, "liquid/shaders/StylizedWater.frag.glsl")],
  ["StylizedWater.frag.glsl100", join(SHADER_DIR, "liquid/shaders/StylizedWater.frag.glsl100")],
  ["StylizedWater.frag.wgsl", join(SHADER_DIR, "liquid/shaders/StylizedWater.frag.wgsl")],
  ["StylizedWater.vert.glsl", join(SHADER_DIR, "liquid/shaders/StylizedWater.vert.glsl")],
  ["StylizedWater.vert.glsl100", join(SHADER_DIR, "liquid/shaders/StylizedWater.vert.glsl100")],
  ["StylizedWater.vert.wgsl", join(SHADER_DIR, "liquid/shaders/StylizedWater.vert.wgsl")],
];

describe("no magic-slot reuse in migrated shader trios", () => {
  it.each(MIGRATED_SHADER_FILES)(
    "%s never names a deprecated magic padding slot",
    (_name, file) => {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/\bu_pad\d?\b/);
      expect(src).not.toMatch(/\bobj\.pad\d?\b/);
    },
  );

  const legacyGlslDecl =
    /^\s*uniform\s+vec[2-4]\s+u_(extraParams|liquidParams|thresholds|texOffset|texRepeat)\s*;/gm;
  const legacyWgslRead = /\bobj\.(extraParams|liquidParams|thresholds|texOffset|texRepeat)\b/g;

  it.each(
    MIGRATED_SHADER_FILES.filter(([n]) => !n.startsWith("Standard") && !n.startsWith("Decal")),
  )("%s no longer reads the generic wave/edge slots (liquid family)", (_name, file) => {
    const src = readFileSync(file, "utf8");
    if (file.endsWith(".wgsl")) {
      expect(src.match(legacyWgslRead)).toBeNull();
    } else {
      expect(src.match(legacyGlslDecl)).toBeNull();
    }
  });

  it.each([
    "StylizedWater.frag.glsl",
    "StylizedWater.frag.glsl100",
    "StylizedWater.frag.wgsl",
  ] as const)("%s reads specular from u_matParam7, not u_color.a", (name) => {
    const src = readFileSync(join(SHADER_DIR, "liquid/shaders", name), "utf8");
    if (name.endsWith(".wgsl")) {
      expect(src).toContain("obj.matParam7.x");
      expect(src).not.toContain("* obj.color.a");
    } else {
      expect(src).toContain("u_matParam7.x");
      expect(src).not.toContain("* u_color.a");
    }
  });
});

describe("typed material lane tables reach the render manifest", () => {
  it("StandardMaterial: reflectionFresnelBlend rides u_matParam0.x, no legacy padding", () => {
    const mat = new StandardMaterial({ reflectionFresnelBlend: 0.42 });
    const props = mat.getRenderManifest().properties;
    expect(props["u_matParam0"]).toEqual([0.42, 0, 0, 0]);
    expect(props).not.toHaveProperty("u_pad1");
  });

  it("FluidSurfaceMaterial: every look parameter rides a dedicated u_matParamN lane", () => {
    const emissiveColor = new Color(1, 0.5, 0);
    const emissiveStrength = 1.4;
    const mat = new FluidSurfaceMaterial({
      shade: 0.7,
      rimStrength: 0.4,
      specularStrength: 0.3,
      specularPower: 60.0,
      normalStrength: 1.2,
      absorption: 3.0,
      emissiveMask: 0.5,
      flowSpeed: 1.5,
      distortion: 2.2,
      emissivePulse: 0.2,
      emissivePulseSpeed: 3.0,
      transitionSoftness: 0.25,
      viscosity: 8.0,
      waveAmplitude: 0.1,
      emissiveColor,
      emissiveStrength,
    });
    mat.time = 0.5;
    const props = mat.getRenderManifest().properties;
    expect(props["u_matParam0"]).toEqual([0.7, 0.4, 0.3, 1.2]);
    expect(props["u_matParam1"]).toEqual([60.0, 3.0, 0.5, 0.25]);
    expect(props["u_matParam2"]).toEqual([1.5, 2.2, 0.2, 3.0]);
    expect(props["u_matParam3"]).toEqual([
      emissiveColor.r * emissiveStrength,
      emissiveColor.g * emissiveStrength,
      emissiveColor.b * emissiveStrength,
      0.5,
    ]);
    const p4 = props["u_matParam4"] as number[];
    expect(p4[1]).toBe(0.1);
    expect(p4[2]).toBe(0);
    expect(p4[3]).toBe(0);
    expect(props).not.toHaveProperty("u_pad1");
  });

  it("OpenWaterMaterial: waves ride u_matParam3..5, edge rides u_matParam6 (generic slots stay neutral)", () => {
    const mat = new OpenWaterMaterial({
      wave1: [1.0, 0.5, 0.1, 8.0],
      wave2: [0.2, 0.7, 0.12, 5.0],
      wave3: [-0.3, 0.5, 0.04, 2.0],
      edgeColor: new Color(0.9, 0.95, 1.0),
      edgeSoftness: 1.2,
    });
    const props = mat.getRenderManifest().properties;
    expect(props["u_matParam3"]).toEqual([1.0, 0.5, 0.1, 8.0]);
    expect(props["u_matParam4"]).toEqual([0.2, 0.7, 0.12, 5.0]);
    expect(props["u_matParam5"]).toEqual([-0.3, 0.5, 0.04, 2.0]);
    expect(props["u_matParam6"]).toEqual([0.9, 0.95, 1.0, 1.2]);
    // The generic slots keep only their canonical base meaning -- no wave/edge smuggling.
    expect(props["u_extraParams"]).toEqual([1, 0, 1, 1]);
    expect(props["u_liquidParams"]).toEqual([0, 0, 0, 0]);
    expect(props["u_thresholds"]).toEqual([0, 0, 0, 0]);
    expect(props["u_texOffset"]).toEqual([0, 0]);
    expect(props["u_texRepeat"]).toEqual([1, 1]);
    expect(props).not.toHaveProperty("u_pad1");
  });

  it("StylizedWaterMaterial: specularStrength rides u_matParam7.x and u_color.a is the real alpha", () => {
    const mat = new StylizedWaterMaterial({ style: "toon", specularStrength: 0.31 });
    const props = mat.getRenderManifest().properties;
    expect(props["u_matParam7"]).toEqual([0.31, 0, 0, 0]);
    expect((props["u_color"] as number[])[3]).toBe(1.0);
  });

  it("writeLane packs through the declared lane (single source of truth)", () => {
    const mat = new StandardMaterial();
    const manifest: RenderManifest = mat.getRenderManifest();
    const lane = { semantic: "reflectionFresnelBlend", lane: "u_matParam9" } as const;
    const packed = writeLane(manifest, lane, [1, 2, 3, 4]);
    expect(packed).toBe(manifest.properties["u_matParam9"]);
    expect(packed).toEqual([1, 2, 3, 4]);
    writeLane(manifest, lane, [5, 6, 7, 8]);
    expect(manifest.properties["u_matParam9"]).toEqual([5, 6, 7, 8]);
  });
});
