import "../../src/index.js";
import { describe, expect, it, vi, beforeAll } from "vitest";
import { WebGLProgramCache } from "../../src/renderers/gl/managers/WebGLProgramCache.js";
import { CoreShaderChunks } from "../../src/renderers/shaders/CoreShaderChunks.js";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";
import { BasicMaterial } from "../../src/core/materials/surface/BasicMaterial.js";
import { Object3D } from "../../src/core/Object3D.js";
import { MaterialType } from "../../src/enums/index.js";

function makeMockGl(): WebGL2RenderingContext {
  const shaders = new Set<object>();
  const programs = new Set<object>();
  return {
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ""),
    createProgram: vi.fn(() => {
      const p = {};
      programs.add(p);
      return p;
    }),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ""),
    deleteShader: vi.fn((s: object) => shaders.delete(s)),
    deleteProgram: vi.fn(),
    bindAttribLocation: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    getUniformLocation: vi.fn(() => ({})),
    getActiveUniform: vi.fn(() => null),
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ACTIVE_UNIFORMS: 5,
    SAMPLER_2D: 6,
    SAMPLER_CUBE: 7,
    SAMPLER_2D_SHADOW: 8,
    SAMPLER_2D_ARRAY: 9,
  } as unknown as WebGL2RenderingContext;
}

const registry = new ShaderRegistry();

function makeCache(): { cache: WebGLProgramCache; gl: WebGL2RenderingContext } {
  const gl = makeMockGl();
  const cache = new WebGLProgramCache(gl, registry, {
    globalUBO: { bindToProgram: vi.fn() } as never,
  });
  return { cache, gl };
}

describe("WebGLProgramCache reference counting", () => {
  beforeAll(async () => {
    await CoreShaderChunks.init(registry);
  });

  it("compiles a program on first use and reuses it for a second object sharing the material's shader", () => {
    const { cache, gl } = makeCache();
    // A real material so ShaderRegistry has a genuine, valid GLSL300 definition to compile.
    registry.ensureProvider(MaterialType.BASIC, new BasicMaterial());

    const objA = new Object3D("A");
    const objB = new Object3D("B");
    const key = cache.programCacheKey(MaterialType.BASIC, false, []);

    const cacheA = cache.getProgram(MaterialType.BASIC);
    cache.acquireProgram(objA, key);
    expect(gl.createProgram).toHaveBeenCalledTimes(1);
    expect(cacheA.refCount).toBe(1);

    cache.acquireProgram(objB, key);
    expect(gl.createProgram).toHaveBeenCalledTimes(1); // reused, not recompiled
    expect(cacheA.refCount).toBe(2);
  });

  it("does not delete the shared program while another object still references it", () => {
    const { cache, gl } = makeCache();
    registry.ensureProvider(MaterialType.BASIC, new BasicMaterial());

    const objA = new Object3D("A");
    const objB = new Object3D("B");
    const key = cache.programCacheKey(MaterialType.BASIC, false, []);

    cache.getProgram(MaterialType.BASIC);
    cache.acquireProgram(objA, key);
    cache.acquireProgram(objB, key);

    cache.releaseObjectProgram(objA);
    expect(gl.deleteProgram).not.toHaveBeenCalled();

    cache.releaseObjectProgram(objB);
    expect(gl.deleteProgram).toHaveBeenCalled();
  });

  it("releases the old program and acquires the new one when an object's material changes shader at runtime", () => {
    const { cache, gl } = makeCache();
    registry.ensureProvider(MaterialType.BASIC, new BasicMaterial());

    const obj = new Object3D("Swappable");
    const keyA = cache.programCacheKey(MaterialType.BASIC, false, []);
    const keyB = cache.programCacheKey(MaterialType.BASIC, false, ["SOME_FLAG"]);

    const resolvedA = cache.getProgram(MaterialType.BASIC);
    cache.acquireProgram(obj, keyA);
    expect(resolvedA.refCount).toBe(1);

    const resolvedB = cache.getProgram(MaterialType.BASIC, false, ["SOME_FLAG"]);
    cache.acquireProgram(obj, keyB);
    expect(resolvedB.refCount).toBe(1);
    expect(resolvedA.refCount).toBe(0);
    expect(gl.deleteProgram).toHaveBeenCalled();
  });
});
