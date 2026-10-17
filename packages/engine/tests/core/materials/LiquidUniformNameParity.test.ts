import { describe, it, expect, beforeAll } from "vitest";
import {
  OpenWaterMaterial,
  StylizedWaterMaterial,
  FluidSurfaceMaterial,
  LavaMaterial,
  SlimeMaterial,
  ShaderBootstrap,
} from "../../../src/index.js";
import type { AbstractMaterial } from "../../../src/index.js";
import { NoirWaterMaterial, OilSlickMaterial } from "../../../../liquid-extras/src/index.js";
import { ShaderRegistry } from "../../../src/renderers/shaders/ShaderRegistry.js";

const testShaderRegistry = new ShaderRegistry();

/**
 * Cross-checks the uniform names a liquid shader READS against what its material actually WRITES.
 * A shader that reads a slot nobody fills compiles fine and silently renders garbage (the
 * StylizedWater WGSL bug read `obj.shininess`/`obj.pad*`, which the liquid manifests never set).
 */
const LEGACY_WGSL_SLOTS = [
  "shininess",
  "pad1",
  "pad2",
  "pad3",
  "useReflectionMap",
  "useEnvMap",
  "isSkinned",
  "boneOffset",
];
// Provided by the renderer itself, not by the material manifest.
const RENDERER_GLSL_UNIFORMS = new Set(["u_model", "u_vp", "u_viewPos"]);
// Frame-global lighting/post uniforms the WebGL1 renderer sets for every program (GlobalUniforms on WebGL2).
const RENDERER_GLSL_GLOBAL =
  /^u_(dirLight|ambient|numPoint|numSpot|numArea|pointLight|spotLight|areaLight|gamma|exposure|cameraNearFar|fog)/;
const RENDERER_WGSL_FIELDS = new Set(["model"]);

const WAVE_FAMILY: Array<[string, () => AbstractMaterial]> = [
  ["OpenWaterMaterial", (): AbstractMaterial => new OpenWaterMaterial()],
  ["StylizedWaterMaterial", (): AbstractMaterial => new StylizedWaterMaterial()],
  ["NoirWaterMaterial", (): AbstractMaterial => new NoirWaterMaterial()],
  ["OilSlickMaterial", (): AbstractMaterial => new OilSlickMaterial()],
];
const ALL_LIQUIDS: Array<[string, () => AbstractMaterial]> = [
  ...WAVE_FAMILY,
  ["FluidSurfaceMaterial", (): AbstractMaterial => new FluidSurfaceMaterial()],
  ["LavaMaterial", (): AbstractMaterial => new LavaMaterial()],
  ["SlimeMaterial", (): AbstractMaterial => new SlimeMaterial()],
];

function wgslReads(source: string): Set<string> {
  const reads = new Set<string>();
  for (const m of source.matchAll(/\bobj\.([A-Za-z_]\w*)/g)) {
    reads.add(m[1]!);
  }
  return reads;
}

function glslUniforms(source: string): { plain: Set<string>; samplers: Set<string> } {
  const plain = new Set<string>();
  const samplers = new Set<string>();
  for (const m of source.matchAll(
    /^\s*uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?(\w+)\s+(u_\w+)/gm,
  )) {
    (m[1]!.startsWith("sampler") ? samplers : plain).add(m[2]!);
  }
  return { plain, samplers };
}

describe("Liquid shader <-> material uniform name parity", () => {
  beforeAll(async () => {
    await ShaderBootstrap.init(testShaderRegistry);
  });

  describe.each(WAVE_FAMILY)("%s WGSL", (_name, create) => {
    it("never reads the legacy ObjectUniforms slots", () => {
      const wgsl = create().getShaderDefinition().sources.wgsl ?? "";
      expect(wgsl.length).toBeGreaterThan(0);
      const reads = wgslReads(wgsl);
      for (const slot of LEGACY_WGSL_SLOTS) {
        expect(reads.has(slot), `reads obj.${slot}`).toBe(false);
      }
    });
  });

  describe.each(ALL_LIQUIDS)("%s", (_name, create) => {
    it("WGSL only reads ObjectUniforms fields the manifest writes", () => {
      const material = create();
      const wgsl = material.getShaderDefinition().sources.wgsl ?? "";
      const written = material.getRenderManifest().properties;
      for (const field of wgslReads(wgsl)) {
        if (RENDERER_WGSL_FIELDS.has(field)) continue;
        expect(written, `obj.${field} is read but u_${field} is never written`).toHaveProperty(
          `u_${field}`,
        );
      }
    });

    for (const dialect of ["glsl300", "glsl100"] as const) {
      it(`${dialect} only declares uniforms the manifest provides`, () => {
        const material = create();
        const sources = material.getShaderDefinition().sources[dialect];
        expect(sources).toBeDefined();
        const manifest = material.getRenderManifest();
        const layoutTextures = material.getShaderDefinition().layout.textures ?? {};
        for (const stage of [sources!.vs, sources!.fs]) {
          const { plain, samplers } = glslUniforms(stage);
          for (const name of plain) {
            if (RENDERER_GLSL_UNIFORMS.has(name) || RENDERER_GLSL_GLOBAL.test(name)) continue;
            expect(
              manifest.properties,
              `${dialect}: ${name} is declared but never written`,
            ).toHaveProperty(name);
          }
          for (const name of samplers) {
            const known = name in manifest.textures || name in layoutTextures;
            expect(known, `${dialect}: sampler ${name} has no texture binding`).toBe(true);
          }
        }
      });
    }
  });
});
