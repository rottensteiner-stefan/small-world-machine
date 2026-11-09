/**
 * FRANK (P1-3) regression guard: glslang-compiles the REAL assembled field vertex shaders
 * (GL2 chunk pair + GL1 base.vert) exactly as the renderer ships them, because
 * `npm run lint:glsl` deliberately skips `/renderers/shaders/source/`. Any drift between the
 * frozen decode in `InstanceField.ts`, these chunks and the WebGPU pull shader fails here.
 */
import { describe, expect, it } from "vitest";
import { validate, LIMITS } from "@moreplease/glslang";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";
import { CoreShaderChunks } from "../../src/renderers/shaders/CoreShaderChunks.js";

function withDefines(src: string, defines: string[], glsl100: boolean): string {
  const block = defines.map((d) => `#define ${d} 1`).join("\n");
  if (glsl100) return `${block}\n${src}`;
  if (!src.startsWith("#version 300 es")) {
    throw new Error("glsl300 shader must start with #version 300 es");
  }
  return src.replace("#version 300 es", `#version 300 es\n${block}`);
}

const registry = new ShaderRegistry();
await CoreShaderChunks.init(registry);

describe("scratch: ADR 0059 field vertex shaders compile (glslang, real assembly)", () => {
  it("WebGL2 field vertex shader compiles with USE_INSTANCE_FIELD AND without it (no regression)", async () => {
    const assembled = registry.assemble("[BASE_VERTEX_HEADER][BASE_VERTEX_MAIN]", "glsl300");
    const srcField = withDefines(assembled, ["USE_INSTANCE_FIELD"], false);
    const srcPlain = withDefines(assembled, [], false);
    for (const [name, src] of [
      ["field", srcField],
      ["plain", srcPlain],
    ] as const) {
      const res = await validate([{ name: `base_vs_${name}`, source: src, stage: "vertex" }], {
        target: "webgl2",
        limits: { ...LIMITS.webgl2, maxFragmentUniformVectors: 1024, maxTextureImageUnits: 32 },
      });
      expect(res.ok, `${name}: ${res.diagnostics.map((d) => d.message).join("\n")}`).toBe(true);
      if (name === "field") {
        expect(src).toContain("buildInstanceFieldMatrix");
        expect(src).toContain("packedPose >> 16u");
      }
    }
  });

  it("WebGL1 field vertex shader compiles with USE_INSTANCE_FIELD AND without it (no regression)", async () => {
    const assembled = registry.assemble("[BASE_VS]", "glsl100");
    const srcField = withDefines(assembled, ["USE_INSTANCE_FIELD"], true);
    const srcPlain = withDefines(assembled, [], true);
    for (const [name, src] of [
      ["field", srcField],
      ["plain", srcPlain],
    ] as const) {
      const res = await validate([{ name: `base_vs_${name}`, source: src, stage: "vertex" }], {
        target: "webgl1",
        limits: { ...LIMITS.webgl1, maxFragmentUniformVectors: 1024, maxTextureImageUnits: 16 },
      });
      expect(res.ok, `${name}: ${res.diagnostics.map((d) => d.message).join("\n")}`).toBe(true);
      if (name === "field") {
        expect(src).toContain("buildInstanceFieldMatrix");
        expect(src).toContain("a_instanceScale");
      }
    }
  });
});
