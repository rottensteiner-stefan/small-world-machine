import {
  StandardMaterial,
  BasicMaterial,
  LambertMaterial,
  PhongMaterial,
  FluidSurfaceMaterial,
  LavaMaterial,
  SlimeMaterial,
  OpenWaterMaterial,
  StylizedWaterMaterial,
  SpriteMaterial,
  TerrainMaterial,
  WorldMaterial,
  GlassMaterial,
  FrostglassMaterial,
  SkyboxMaterial,
  WireframeMaterial,
  RetroScreenMaterial,
  DepthMaterial,
  ShaderRegistry,
} from "../../src/index.js";
import { ShaderBootstrap } from "../../src/renderers/shaders/ShaderBootstrap.js";

const testShaderRegistry = new ShaderRegistry();

describe("Shader Assembly & Linter", () => {
  beforeAll(async () => {
    await ShaderBootstrap.init(testShaderRegistry);
  });

  const checkDuplicates = (shaderCode: string, materialName: string, shaderType: string): void => {
    const lines = shaderCode.split("\n");
    const declarations = new Set<string>();
    let conditionalDepth = 0;
    let currentConditionalVars: Set<string> | null = null;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]!.trim();
      // Remove comments
      if (line.includes("//")) {
        line = line.split("//")[0]!.trim();
      }

      if (line.startsWith("#ifdef") || line.startsWith("#ifndef") || line.startsWith("#if ")) {
        conditionalDepth++;
        if (conditionalDepth === 1) currentConditionalVars = new Set<string>();
      } else if (line.startsWith("#else") || line.startsWith("#elif")) {
        if (conditionalDepth === 1 && currentConditionalVars) {
          // Remove vars declared in the true-branch so the false-branch can declare them
          currentConditionalVars.forEach((v) => declarations.delete(v));
          currentConditionalVars.clear();
        }
      } else if (line.startsWith("#endif")) {
        conditionalDepth--;
        if (conditionalDepth <= 0) {
          conditionalDepth = 0;
          currentConditionalVars = null;
        }
      }

      if (line.startsWith("uniform ") || line.startsWith("in ") || line.startsWith("out ")) {
        // e.g. "uniform sampler2D u_diffuseMap;"
        const parts = line.split(/\s+/);
        if (parts.length >= 3) {
          const varNameWithSemicolon = parts[2]!;
          // Handle arrays like "u_spotShadowMap[4];"
          const varName = varNameWithSemicolon.split("[")[0]!.replace(";", "");

          if (declarations.has(varName)) {
            throw new Error(
              `${materialName} ${shaderType} Error: Redefinition of '${varName}' on line ${i + 1}:\n${lines[i]}`,
            );
          }
          declarations.add(varName);
          if (conditionalDepth === 1 && currentConditionalVars) {
            currentConditionalVars.add(varName);
          }
        }
      }
    }
  };

  const materials = [
    new BasicMaterial(),
    new LambertMaterial(),
    new PhongMaterial(),
    new StandardMaterial(),
    new FluidSurfaceMaterial(),
    new LavaMaterial(),
    new SlimeMaterial(),
    new OpenWaterMaterial(),
    new StylizedWaterMaterial(),
    new SpriteMaterial(),
    new TerrainMaterial(),
    new WorldMaterial(),
    new GlassMaterial(),
    new FrostglassMaterial(),
    new SkyboxMaterial(),
    new WireframeMaterial(),
    new RetroScreenMaterial(),
    new DepthMaterial(),
  ];

  const checkDuplicatesWGSL = (
    shaderCode: string,
    materialName: string,
    shaderType: string,
  ): void => {
    const lines = shaderCode.split("\n");
    const declarations = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]!.trim();
      if (line.includes("//")) {
        line = line.split("//")[0]!.trim();
      }

      // Match global WGSL variable declarations:
      // @group(x) @binding(y) var name: type
      // var<uniform> name: type
      // var name: type
      const match = line.match(
        /(?:@group\(\d+\)\s*)?(?:@binding\(\d+\)\s*)?var(?:<[^>]+>)?\s+([a-zA-Z0-9_]+)\s*:/,
      );
      if (match && match[1]) {
        const varName = match[1];
        // Ignore loop variables or local vars (indentation could filter, but let's assume globals start at beginning of line)
        // A simple heuristic: if it's not indented or has @group, it's a global
        if (
          (!lines[i]!.startsWith(" ") && !lines[i]!.startsWith("\t")) ||
          line.includes("@group")
        ) {
          if (declarations.has(varName)) {
            throw new Error(
              `${materialName} ${shaderType} Error: Redefinition of WGSL variable '${varName}' on line ${i + 1}:\n${lines[i]}`,
            );
          }
          declarations.add(varName);
        }
      }
    }
  };

  for (const mat of materials) {
    const matName = mat.constructor.name;

    it(`should compile and lint ${matName} for WebGL2 (glsl300) without duplicate uniforms`, () => {
      const def = mat.getShaderDefinition();
      const vs = def.sources.glsl300?.vs;
      const fs = def.sources.glsl300?.fs;

      if (!vs || !fs) {
        return; // Skip materials without glsl300
      }

      const finalVs = testShaderRegistry.assemble(vs, "glsl300");
      const finalFs = testShaderRegistry.assemble(fs, "glsl300");
      checkDuplicates(finalVs, matName, "Vertex Shader");
      checkDuplicates(finalFs, matName, "Fragment Shader");
    });

    it(`should compile and lint ${matName} for WebGPU (wgsl) without duplicate uniforms`, () => {
      const def = mat.getShaderDefinition();
      const wgsl = def.sources.wgsl;

      if (!wgsl) {
        // Some materials might not support WGSL yet, but if they do, we check them
        return;
      }

      const finalWgsl = testShaderRegistry.assemble(wgsl, "wgsl");
      checkDuplicatesWGSL(finalWgsl, matName, "Combined Shader");
    });
  }
});
