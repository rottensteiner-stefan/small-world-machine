import { describe, expect, it } from "vitest";
import { WebGLProgramCache } from "../../src/renderers/gl/managers/WebGLProgramCache.js";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";

describe("WebGLProgramCache.programCacheKey", () => {
  const cache = new WebGLProgramCache({} as WebGL2RenderingContext, new ShaderRegistry());

  it("does not depend on the order of the shader flags", () => {
    expect(cache.programCacheKey("pbr", false, ["USE_A", "USE_B"])).toBe(
      cache.programCacheKey("pbr", false, ["USE_B", "USE_A"]),
    );
  });

  it("does not reorder or mutate the caller's flag array", () => {
    const flags = ["USE_B", "USE_A"];
    cache.programCacheKey("pbr", true, flags);
    expect(flags).toEqual(["USE_B", "USE_A"]);
  });

  it("still separates instanced / non-instanced and different flag sets", () => {
    const keys = new Set([
      cache.programCacheKey("pbr", false, []),
      cache.programCacheKey("pbr", true, []),
      cache.programCacheKey("pbr", false, ["USE_A"]),
      cache.programCacheKey("pbr", false, ["USE_A", "USE_B"]),
    ]);
    expect(keys.size).toBe(4);
  });
});

describe("WebGLProgramCache texture-unit budget", () => {
  const gl = (max: number): WebGL2RenderingContext =>
    ({
      MAX_TEXTURE_IMAGE_UNITS: 0x8872,
      getParameter: () => max,
    }) as unknown as WebGL2RenderingContext;
  const assertUnits = (cache: WebGLProgramCache, id: string, needed: number): void =>
    (
      cache as unknown as { _assertTextureUnits: (id: string, needed: number) => void }
    )._assertTextureUnits(id, needed);

  it("throws, naming the shader, when a program needs more units than the device exposes", () => {
    const cache = new WebGLProgramCache(gl(8), new ShaderRegistry());
    expect(() => assertUnits(cache, "GlassMaterial", 9)).toThrow(
      /"GlassMaterial" needs 9 texture units/,
    );
  });

  it("accepts a program that exactly fills the available units", () => {
    const cache = new WebGLProgramCache(gl(8), new ShaderRegistry());
    expect(() => assertUnits(cache, "GlassMaterial", 8)).not.toThrow();
  });
});
