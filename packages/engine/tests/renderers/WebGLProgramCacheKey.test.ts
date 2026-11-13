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
