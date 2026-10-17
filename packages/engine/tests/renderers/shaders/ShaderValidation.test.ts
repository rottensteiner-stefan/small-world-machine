import { describe, it, expect, beforeAll } from "vitest";
import { ShaderRegistry } from "../../../src/renderers/shaders/ShaderRegistry.js";
import { ShaderBootstrap } from "../../../src/renderers/shaders/ShaderBootstrap.js";
import {
  StandardMaterial,
  PhongMaterial,
  LambertMaterial,
  BasicMaterial,
  DepthMaterial,
  TerrainMaterial,
  SkyboxMaterial,
  FrostglassMaterial,
  GlassMaterial,
  FluidSurfaceMaterial,
  LavaMaterial,
  StylizedLavaMaterial,
  OpenWaterMaterial,
  SlimeMaterial,
  StylizedWaterMaterial,
  RetroScreenMaterial,
  WireframeMaterial,
  WorldMaterial,
} from "../../../src/core/materials/index.js";

const testShaderRegistry = new ShaderRegistry();

describe("ShaderValidation & Contract Suite", () => {
  beforeAll(async () => {
    await ShaderBootstrap.init(testShaderRegistry);
  });

  const materials = [
    { name: "StandardMaterial", instance: new StandardMaterial() },
    { name: "PhongMaterial", instance: new PhongMaterial() },
    { name: "LambertMaterial", instance: new LambertMaterial() },
    { name: "BasicMaterial", instance: new BasicMaterial() },
    { name: "DepthMaterial", instance: new DepthMaterial() },
    { name: "TerrainMaterial", instance: new TerrainMaterial() },
    { name: "SkyboxMaterial", instance: new SkyboxMaterial() },
    { name: "FrostglassMaterial", instance: new FrostglassMaterial() },
    { name: "GlassMaterial", instance: new GlassMaterial() },
    { name: "FluidSurfaceMaterial", instance: new FluidSurfaceMaterial() },
    { name: "LavaMaterial", instance: new LavaMaterial() },
    { name: "StylizedLavaMaterial", instance: new StylizedLavaMaterial() },
    { name: "SlimeMaterial", instance: new SlimeMaterial() },
    { name: "OpenWaterMaterial", instance: new OpenWaterMaterial() },
    { name: "StylizedWaterMaterial", instance: new StylizedWaterMaterial() },
    { name: "RetroScreenMaterial", instance: new RetroScreenMaterial() },
    { name: "WireframeMaterial", instance: new WireframeMaterial() },
    { name: "WorldMaterial", instance: new WorldMaterial() },
  ];

  describe("Chunk Assembly Completeness", () => {
    materials.forEach(({ name, instance }) => {
      it(`should completely resolve all chunks for ${name} without unparsed [CHUNK_ID] placeholders`, () => {
        const def = instance.getShaderDefinition();
        const registry = testShaderRegistry;

        if (def.sources.glsl300) {
          const vs = registry.assemble(def.sources.glsl300.vs, "glsl300");
          const fs = registry.assemble(def.sources.glsl300.fs, "glsl300");

          expect(vs).not.toMatch(/\[[A-Z][A-Z0-9_]+\]/);
          expect(fs).not.toMatch(/\[[A-Z][A-Z0-9_]+\]/);
        }

        if (def.sources.glsl100) {
          const vs = registry.assemble(def.sources.glsl100.vs, "glsl100");
          const fs = registry.assemble(def.sources.glsl100.fs, "glsl100");

          expect(vs).not.toMatch(/\[[A-Z][A-Z0-9_]+\]/);
          expect(fs).not.toMatch(/\[[A-Z][A-Z0-9_]+\]/);
        }

        if (def.sources.wgsl) {
          const wgsl = registry.assemble(def.sources.wgsl, "wgsl");
          expect(wgsl).not.toMatch(/\[[A-Z][A-Z0-9_]+\]/);
        }
      });
    });
  });

  describe("GlobalUniforms UBO Parity in GLSL300", () => {
    it("should have identical GlobalUniforms fields in vertex header and lights fragment chunk", () => {
      const registry = testShaderRegistry;
      const vsHeader = registry.getChunk("BASE_VERTEX_HEADER", "glsl300");
      const lightDefs = registry.getChunk("LIGHT_DEFS", "glsl300");

      expect(vsHeader).toBeDefined();
      expect(lightDefs).toBeDefined();

      const extractUboFields = (source: string): string[] => {
        const match = source.match(/uniform\s+GlobalUniforms\s*\{([\s\S]*?)\};/);
        if (!match || !match[1]) return [];
        return match[1]
          .split(";")
          .map((line) => line.replace(/\/\/.*$/gm, "").trim())
          .filter((line) => line.length > 0);
      };

      const vsFields = extractUboFields(vsHeader!);
      const fsFields = extractUboFields(lightDefs!);

      expect(vsFields.length).toBeGreaterThan(0);
      expect(fsFields.length).toBeGreaterThan(0);
      expect(vsFields).toEqual(fsFields);
    });
  });

  describe("Sampler Unit Budget (MAX_TEXTURE_IMAGE_UNITS <= 16)", () => {
    const preprocessGlsl = (source: string, flags: Set<string>): string => {
      const lines = source.split("\n");
      const result: string[] = [];
      const conditionStack: boolean[] = [];

      for (const rawLine of lines) {
        const line = rawLine.trim();

        if (line.startsWith("#ifdef ")) {
          const flag = line.replace("#ifdef ", "").trim();
          const parentActive =
            conditionStack.length === 0 || conditionStack[conditionStack.length - 1];
          conditionStack.push(Boolean(parentActive && flags.has(flag)));
          continue;
        }

        if (line.startsWith("#ifndef ")) {
          const flag = line.replace("#ifndef ", "").trim();
          const parentActive =
            conditionStack.length === 0 || conditionStack[conditionStack.length - 1];
          conditionStack.push(Boolean(parentActive && !flags.has(flag)));
          continue;
        }

        if (line.startsWith("#else")) {
          if (conditionStack.length > 0) {
            const prev = conditionStack.pop()!;
            const parentActive =
              conditionStack.length === 0 || conditionStack[conditionStack.length - 1];
            conditionStack.push(Boolean(parentActive && !prev));
          }
          continue;
        }

        if (line.startsWith("#endif")) {
          conditionStack.pop();
          continue;
        }

        const isLineActive =
          conditionStack.length === 0 || conditionStack[conditionStack.length - 1];
        if (isLineActive) {
          result.push(rawLine);
        }
      }

      return result.join("\n");
    };

    materials.forEach(({ name, instance }) => {
      it(`should stay within the 16 sampler limit for ${name} across active rendering flags`, () => {
        const def = instance.getShaderDefinition();
        if (!def.sources.glsl300) return;

        const registry = testShaderRegistry;
        let fs = registry.assemble(def.sources.glsl300.fs, "glsl300");

        // Strip comments first
        fs = fs.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

        const activeFlags = new Set<string>(instance.getRenderManifest().flags ?? []);
        const preprocessedFs = preprocessGlsl(fs, activeFlags);

        // Count active sampler declarations: uniform (sampler2D|samplerCube|sampler2DShadow|usampler2D) name;
        const samplerMatches = preprocessedFs.match(
          /uniform\s+(sampler2D|samplerCube|sampler2DShadow|usampler2D|sampler2DArray)\s+([a-zA-Z0-9_]+)(\[\d+\])?;/g,
        );
        let samplerCount = 0;
        if (samplerMatches) {
          for (const decl of samplerMatches) {
            const arrayMatch = decl.match(/\[(\d+)\]/);
            if (arrayMatch && arrayMatch[1]) {
              samplerCount += parseInt(arrayMatch[1], 10);
            } else {
              samplerCount += 1;
            }
          }
        }

        // Must stay <= 16
        expect(samplerCount).toBeLessThanOrEqual(16);
      });
    });
  });
});
