import { beforeAll, describe, expect, it } from "vitest";
import "../../src/index.js";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";
import { ShaderBootstrap } from "../../src/renderers/shaders/ShaderBootstrap.js";
import { wrapFragmentWithNormalOutputGL } from "../../src/renderers/gl/managers/NormalOutputWrapperGL.js";
import {
  StandardMaterial,
  PhongMaterial,
  LambertMaterial,
  BasicMaterial,
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
  DecalMaterial,
} from "../../src/core/materials/index.js";

const testShaderRegistry = new ShaderRegistry();

const LIT_SHADER = `#version 300 es
in vec3 v_normal;
out vec4 fragColor;
void main() {
  fragColor = vec4(v_normal, 1.0);
}`;

describe("wrapFragmentWithNormalOutputGL", () => {
  it("pins fragColor to location 0, adds a location 1 output and wraps main", () => {
    const wrapped = wrapFragmentWithNormalOutputGL(LIT_SHADER);

    expect(wrapped).toContain("layout(location = 0) out vec4 fragColor;");
    expect(wrapped).toContain("layout(location = 1) out vec4 o_normal;");
    expect(wrapped).toContain("void swm_main() {");
    expect(wrapped).toMatch(
      /void main\(\) \{[\s\S]*swm_main\(\);[\s\S]*o_normal = vec4\(octEncode\(/,
    );
  });

  it("writes the out-of-range sentinel when the shader has no v_normal varying", () => {
    const wrapped = wrapFragmentWithNormalOutputGL(
      "#version 300 es\nout vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }",
    );

    expect(wrapped).toContain("o_normal = vec4(vec2(-2.0, -2.0), 0.0, fragColor.a);");
    expect(wrapped).not.toContain("normalize(v_normal)");
  });

  it("does not redeclare g_shadingNormal when a chunk already did", () => {
    const wrapped = wrapFragmentWithNormalOutputGL(
      `#version 300 es
in vec3 v_normal;
out vec4 fragColor;
#ifdef USE_NORMAL_OUT
vec3 g_shadingNormal = vec3(0.0, 1.0, 0.0);
#endif
void main() { fragColor = vec4(1.0); }`,
    );

    expect(wrapped.match(/vec3 g_shadingNormal/g)).toHaveLength(1);
  });

  it("returns sources without fragColor or main unchanged", () => {
    const source = "#version 300 es\nvoid helper() {}";

    expect(wrapFragmentWithNormalOutputGL(source)).toBe(source);
  });
});

describe("wrapFragmentWithNormalOutputGL on shipped shaders", () => {
  beforeAll(async () => {
    await ShaderBootstrap.init(testShaderRegistry);
  });

  const materials = [
    new StandardMaterial(),
    new PhongMaterial(),
    new LambertMaterial(),
    new BasicMaterial(),
    new TerrainMaterial(),
    new SkyboxMaterial(),
    new FrostglassMaterial(),
    new GlassMaterial(),
    new FluidSurfaceMaterial(),
    new LavaMaterial(),
    new StylizedLavaMaterial(),
    new OpenWaterMaterial(),
    new SlimeMaterial(),
    new StylizedWaterMaterial(),
    new RetroScreenMaterial(),
    new WireframeMaterial(),
    new WorldMaterial(),
    new DecalMaterial(),
  ];

  for (const material of materials) {
    const name = material.constructor.name;
    it(`wraps the assembled ${name} fragment shader`, () => {
      const source = material.getShaderDefinition().sources.glsl300;
      if (!source) return;
      const fs = testShaderRegistry.assemble(source.fs, "glsl300");

      const wrapped = wrapFragmentWithNormalOutputGL(fs);

      expect(wrapped).toContain("layout(location = 1) out vec4 o_normal;");
      expect(wrapped).toContain("void swm_main() {");
    });
  }
});
