import { beforeAll, describe, expect, it, vi } from "vitest";
import "../../src/index.js";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";
import { ShaderBootstrap } from "../../src/renderers/shaders/ShaderBootstrap.js";
import { wrapFragmentWithNormalOutputGL } from "../../src/renderers/WebGL2/managers/NormalOutputWrapperGL.js";
import { WebGLMainPass } from "../../src/renderers/passes/WebGLMainPass.js";
import { Vector3D } from "../../src/math/index.js";
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
} from "../../src/core/materials/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Internals = any;

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
    expect(wrapped).toContain("layout(location = 1) out vec2 o_normal;");
    expect(wrapped).toContain("void swm_main() {");
    expect(wrapped).toMatch(/void main\(\) \{[\s\S]*swm_main\(\);[\s\S]*o_normal = octEncode\(/);
  });

  it("writes the out-of-range sentinel when the shader has no v_normal varying", () => {
    const wrapped = wrapFragmentWithNormalOutputGL(
      "#version 300 es\nout vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }",
    );

    expect(wrapped).toContain("o_normal = vec2(-2.0, -2.0);");
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
    await ShaderBootstrap.init();
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
  ];

  for (const material of materials) {
    const name = material.constructor.name;
    it(`wraps the assembled ${name} fragment shader`, () => {
      const source = material.getShaderDefinition().sources.glsl300;
      if (!source) return;
      const fs = ShaderRegistry.instance.assemble(source.fs, "glsl300");

      const wrapped = wrapFragmentWithNormalOutputGL(fs);

      expect(wrapped).toContain("layout(location = 1) out vec2 o_normal;");
      expect(wrapped).toContain("void swm_main() {");
    });
  }
});

describe("WebGLMainPass normal target phases", () => {
  function run(hasNormalTarget: boolean): string[] {
    const calls: string[] = [];
    const gl = {
      COLOR_BUFFER_BIT: 0x4000,
      DEPTH_BUFFER_BIT: 0x100,
      BLEND: 0xbe2,
      SRC_ALPHA: 0x302,
      ONE_MINUS_SRC_ALPHA: 0x303,
      clear: vi.fn(() => calls.push("clear")),
      depthMask: vi.fn(),
      enable: vi.fn(),
      blendFunc: vi.fn(),
    };
    const batch = { shaderId: "standard", objects: [{}] };
    const renderer: Internals = {
      webglContext: gl,
      hasNormalTarget,
      bindMainRenderTarget: vi.fn(),
      resetStateCache: vi.fn(),
      clearNormalTarget: vi.fn(() => calls.push("clearNormal")),
      setNormalWriteEnabled: vi.fn((on: boolean) => calls.push(`normalWrite:${on}`)),
      renderBatch: vi.fn(() => calls.push("opaqueBatch")),
      copyToOpaqueDepthTexture: vi.fn(),
      copyToOpaqueTexture: vi.fn(),
      postProcessing: { get: vi.fn(() => undefined) },
    };

    new WebGLMainPass().execute(
      renderer,
      {} as Internals,
      new Float32Array(16),
      new Vector3D(0, 0, 0),
      undefined,
      { opaqueBatches: [batch], transparent: [] } as Internals,
      {} as Internals,
    );
    return calls;
  }

  it("clears the normal target and writes it only around the opaque batches", () => {
    expect(run(true)).toEqual([
      "clear",
      "clearNormal",
      "normalWrite:true",
      "opaqueBatch",
      "normalWrite:false",
    ]);
  });

  it("never touches the normal target when the renderer has none", () => {
    expect(run(false)).toEqual(["clear", "opaqueBatch"]);
  });
});
