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
  DecalMaterial,
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
    new DecalMaterial(),
  ];

  for (const material of materials) {
    const name = material.constructor.name;
    it(`wraps the assembled ${name} fragment shader`, () => {
      const source = material.getShaderDefinition().sources.glsl300;
      if (!source) return;
      const fs = ShaderRegistry.instance.assemble(source.fs, "glsl300");

      const wrapped = wrapFragmentWithNormalOutputGL(fs);

      expect(wrapped).toContain("layout(location = 1) out vec4 o_normal;");
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
      { opaqueBatches: [batch], transparent: [], decals: [] } as Internals,
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
describe("WebGLMainPass decal phase", () => {
  function run(options: { canDrawDecals: boolean; hasNormalTarget: boolean }): string[] {
    const calls: string[] = [];
    const gl = {
      COLOR_BUFFER_BIT: 0x4000,
      DEPTH_BUFFER_BIT: 0x100,
      BLEND: 0xbe2,
      SRC_ALPHA: 0x302,
      ONE_MINUS_SRC_ALPHA: 0x303,
      clear: vi.fn(),
      depthMask: vi.fn((on: boolean) => calls.push(`depthMask:${on}`)),
      enable: vi.fn(),
      blendFunc: vi.fn(),
    };
    const decal = {
      material: { uuid: "decal", getRenderManifest: vi.fn(() => ({ shaderId: "DecalMaterial" })) },
    };
    const renderer: Internals = {
      webglContext: gl,
      hasNormalTarget: options.hasNormalTarget,
      canDrawDecals: options.canDrawDecals,
      bindMainRenderTarget: vi.fn(),
      resetStateCache: vi.fn(),
      clearNormalTarget: vi.fn(),
      setNormalWriteEnabled: vi.fn((on: boolean) => calls.push(`normalWrite:${on}`)),
      renderBatch: vi.fn(() => calls.push("decalBatch")),
      copyToOpaqueDepthTexture: vi.fn(() => calls.push("copyDepth")),
      copyToOpaqueNormalTexture: vi.fn(() => calls.push("copyNormal")),
      copyToOpaqueTexture: vi.fn(),
      postProcessing: { enabled: false, get: vi.fn(() => undefined) },
    };

    new WebGLMainPass().execute(
      renderer,
      {} as Internals,
      new Float32Array(16),
      new Vector3D(0, 0, 0),
      undefined,
      { opaqueBatches: [], transparent: [], decals: [decal] } as Internals,
      {} as Internals,
    );
    return calls;
  }

  it("copies depth and the normal buffer, then draws decals with normal writes and no depth writes", () => {
    const calls = run({ canDrawDecals: true, hasNormalTarget: true });

    expect(calls).toEqual(
      expect.arrayContaining(["copyDepth", "copyNormal", "decalBatch", "normalWrite:true"]),
    );
    expect(calls.indexOf("copyDepth")).toBeLessThan(calls.indexOf("decalBatch"));
    expect(calls.indexOf("copyNormal")).toBeLessThan(calls.indexOf("decalBatch"));
    expect(calls.lastIndexOf("normalWrite:false")).toBeGreaterThan(calls.indexOf("decalBatch"));
  });

  it("skips the normal copy without a normal target but still draws decals", () => {
    const calls = run({ canDrawDecals: true, hasNormalTarget: false });

    expect(calls).toContain("decalBatch");
    expect(calls).not.toContain("copyNormal");
  });

  it("draws no decals where the renderer cannot (offscreen targets, WebGL1)", () => {
    const calls = run({ canDrawDecals: false, hasNormalTarget: true });

    expect(calls).not.toContain("decalBatch");
    expect(calls).not.toContain("copyDepth");
  });
});
