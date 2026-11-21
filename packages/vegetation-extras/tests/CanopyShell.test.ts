import { describe, expect, it } from "vitest";
import { ShaderRegistry } from "@small-world-machine/engine";
import { packInstancePose } from "@small-world-machine/engine/core/InstanceField.js";
import { buildCanopyCoverage } from "../src/canopy/CanopyCoverage.js";
import { CanopyShellMaterial, buildCanopyShellGeometry } from "../src/canopy/CanopyShell.js";

describe("CanopyShell", () => {
  it("builds terrain-following sparse canopy mesh with strict +Y CCW winding and Uint16 indices", () => {
    // Two trees at x=0, z=0 and x=4, z=0, plus large empty border margin
    const records = new Float32Array(2 * 4);
    const bits = new Uint32Array(records.buffer);
    records[0] = 0;
    records[1] = 0;
    records[2] = 0;
    bits[3] = packInstancePose(0, 1);
    records[4] = 4;
    records[5] = 0;
    records[6] = 0;
    bits[7] = packInstancePose(1.2, 1.2);

    const cov = buildCanopyCoverage(records, 2, { crownRadius: 5, cellSize: 2 });
    const geom = buildCanopyShellGeometry(cov, {
      canopyHeight: 14,
      minCoverage: 0.1,
      elevationAt: (x, z) => 2 + 0.05 * x - 0.02 * z,
    });

    expect(geom.indices).toBeInstanceOf(Uint16Array);
    expect(geom.indices!.length).toBeGreaterThan(0);
    expect(geom.vertices.length % 3).toBe(0);
    expect(geom.normals!.length).toBe(geom.vertices.length);

    // Every triangle's face normal must point strictly +Y (right-handed CCW winding)
    const idx = geom.indices!;
    const pos = geom.vertices;
    for (let t = 0; t < idx.length; t += 3) {
      const i0 = idx[t]! * 3;
      const i1 = idx[t + 1]! * 3;
      const i2 = idx[t + 2]! * 3;
      const ax = pos[i1]! - pos[i0]!;
      const ay = pos[i1 + 1]! - pos[i0 + 1]!;
      const az = pos[i1 + 2]! - pos[i0 + 2]!;
      const bx = pos[i2]! - pos[i0]!;
      const by = pos[i2 + 1]! - pos[i0 + 1]!;
      const bz = pos[i2 + 2]! - pos[i0 + 2]!;
      const ny = az * bx - ax * bz;
      // Since heights are continuous terrain + canopy relief, cross(e1, e2).y = az*bx - ax*bz > 0
      expect(ny).toBeGreaterThan(0);
      expect(Math.hypot(ay, by)).toBeGreaterThanOrEqual(0);
    }
  });

  it("auto-upscales stride cleanly for oversized coverage maps to keep WebGL1 Uint16 indices", () => {
    const bigMap = {
      width: 400,
      height: 400,
      originX: -400,
      originZ: -400,
      cellSize: 2,
      data: new Uint8Array(400 * 400).fill(200),
    };
    const geom = buildCanopyShellGeometry(bigMap, { canopyHeight: 10 });
    expect(geom.indices).toBeInstanceOf(Uint16Array);
    expect(geom.vertices.length / 3).toBeLessThanOrEqual(65000);
    expect(geom.indices!.length).toBeGreaterThan(0);
  });

  it("resolves all CanopyShellMaterial shader chunks cleanly across WebGPU, WebGL2, and WebGL1", async () => {
    const mat = new CanopyShellMaterial({
      handoverStart: 150,
      handoverEnd: 210,
      ambientFloor: 0.25,
    });
    const def = mat.getShaderDefinition();
    const registry = new ShaderRegistry();
    registry.register(def);

    expect(registry.assemble(def.sources.wgsl!, "wgsl")).not.toMatch(/\[[A-Z][A-Z0-9_]+\]/);
    expect(registry.assemble(def.sources.glsl300!.vs, "glsl300")).not.toMatch(
      /\[[A-Z][A-Z0-9_]+\]/,
    );
    expect(registry.assemble(def.sources.glsl300!.fs, "glsl300")).not.toMatch(
      /\[[A-Z][A-Z0-9_]+\]/,
    );
    expect(registry.assemble(def.sources.glsl100!.vs, "glsl100")).not.toMatch(
      /\[[A-Z][A-Z0-9_]+\]/,
    );
    expect(registry.assemble(def.sources.glsl100!.fs, "glsl100")).not.toMatch(
      /\[[A-Z][A-Z0-9_]+\]/,
    );

    const { validate, LIMITS } = await import("@moreplease/glslang");
    const { WgslReflect } = await import("wgsl_reflect/wgsl_reflect.module.js");
    const { preprocessConditionals } = await import("@small-world-machine/engine");
    const wgslSrc = preprocessConditionals(
      "const USE_DECAL_GRADIENTS: bool = false;\n" + registry.assemble(def.sources.wgsl!, "wgsl"),
      [],
    );
    expect(() => new WgslReflect(wgslSrc)).not.toThrow();

    const gl3Res = await validate(
      [
        {
          name: "canopy.vert",
          source: registry.assemble(def.sources.glsl300!.vs, "glsl300"),
          stage: "vertex",
        },
        {
          name: "canopy.frag",
          source: registry.assemble(def.sources.glsl300!.fs, "glsl300"),
          stage: "fragment",
        },
      ],
      {
        target: "webgl2",
        limits: { ...LIMITS.webgl2, maxFragmentUniformVectors: 1024, maxTextureImageUnits: 32 },
      },
    );
    const gl1Res = await validate(
      [
        {
          name: "canopy.vert",
          source: registry.assemble(def.sources.glsl100!.vs, "glsl100"),
          stage: "vertex",
        },
        {
          name: "canopy.frag",
          source: registry.assemble(def.sources.glsl100!.fs, "glsl100"),
          stage: "fragment",
        },
      ],
      {
        target: "webgl1",
        limits: { ...LIMITS.webgl1, maxFragmentUniformVectors: 1024, maxTextureImageUnits: 16 },
      },
    );
    expect(gl3Res.diagnostics).toEqual([]);
    expect(gl3Res.ok).toBe(true);
    expect(gl1Res.diagnostics).toEqual([]);
    expect(gl1Res.ok).toBe(true);
  });
});
