import { describe, expect, it } from "vitest";
import { ShaderRegistry } from "@small-world-machine/engine";
import {
  OctahedralImpostorMaterial,
  buildOctahedralImpostorGeometry,
  captureOctahedralImpostorAtlas,
  createOctahedralImpostorManifest,
  createProceduralImpostorAtlas,
  createTexturesFromImpostorAtlas,
  dirToFullOctahedron,
  dirToHemiOctahedron,
  fullOctahedronToDir,
  hemiOctahedronToDir,
  octahedralCellCenterDir,
  sampleOctahedralCells,
} from "../src/impostors/OctahedralImpostor.js";

describe("OctahedralImpostor", () => {
  it("bijectively round-trips hemi-octahedral directions in upper hemisphere (@invariant VEG-OCT-BIJECTION)", () => {
    const dirs: [number, number, number][] = [
      [0, 1, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [0.45, 0.72, -0.52],
      [-0.68, 0.25, 0.69],
      [0.12, 0.98, 0.16],
    ];
    for (const [rx, ry, rz] of dirs) {
      const len = Math.hypot(rx, ry, rz);
      const dx = rx / len;
      const dy = ry / len;
      const dz = rz / len;
      const [u, v] = dirToHemiOctahedron(dx, dy, dz);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      const [ox, oy, oz] = hemiOctahedronToDir(u, v);
      expect(ox).toBeCloseTo(dx, 5);
      expect(oy).toBeCloseTo(dy, 5);
      expect(oz).toBeCloseTo(dz, 5);
    }
  });

  it("bijectively round-trips full-octahedral directions across S^2 (@invariant VEG-OCT-BIJECTION)", () => {
    const dirs: [number, number, number][] = [
      [0, 1, 0],
      [0, -1, 0],
      [0.5, -0.7, 0.5],
      [-0.8, -0.35, -0.48],
      [0.33, 0.66, -0.67],
    ];
    for (const [rx, ry, rz] of dirs) {
      const len = Math.hypot(rx, ry, rz);
      const dx = rx / len;
      const dy = ry / len;
      const dz = rz / len;
      const [u, v] = dirToFullOctahedron(dx, dy, dz);
      const [ox, oy, oz] = fullOctahedronToDir(u, v);
      expect(ox).toBeCloseTo(dx, 5);
      expect(oy).toBeCloseTo(dy, 5);
      expect(oz).toBeCloseTo(dz, 5);
    }
  });

  it("samples 3 nearest cells with exact non-negative barycentric partition of unity (@invariant VEG-OCT-WEIGHTS)", () => {
    const scratch = {
      c0x: 0,
      c0y: 0,
      w0: 0,
      c1x: 0,
      c1y: 0,
      w1: 0,
      c2x: 0,
      c2y: 0,
      w2: 0,
    };
    const grid = 12;
    for (let i = 0; i < 40; i++) {
      const theta = (i / 40) * Math.PI * 2;
      const phi = ((i % 7) / 6) * Math.PI - Math.PI * 0.5;
      const dx = Math.cos(phi) * Math.cos(theta);
      const dy = Math.sin(phi);
      const dz = Math.cos(phi) * Math.sin(theta);

      for (const mode of ["hemi", "full"] as const) {
        const res = sampleOctahedralCells(dx, dy, dz, grid, mode, scratch);
        expect(res).toBe(scratch);
        expect(res.w0).toBeGreaterThanOrEqual(-1e-9);
        expect(res.w1).toBeGreaterThanOrEqual(-1e-9);
        expect(res.w2).toBeGreaterThanOrEqual(-1e-9);
        expect(res.w0 + res.w1 + res.w2).toBeCloseTo(1.0, 6);
        for (const cx of [res.c0x, res.c1x, res.c2x]) {
          expect(cx).toBeGreaterThanOrEqual(0);
          expect(cx).toBeLessThan(grid);
        }
        for (const cy of [res.c0y, res.c1y, res.c2y]) {
          expect(cy).toBeGreaterThanOrEqual(0);
          expect(cy).toBeLessThan(grid);
        }
      }
    }
  });

  it("generates atlas pair, billboard geometry, and resolves all shader chunks cleanly across all 3 tiers", async () => {
    const manifest = createOctahedralImpostorManifest({
      gridSize: 4,
      tileResolution: 16,
      boundingRadius: 3.5,
      mapping: "hemi",
    });
    const geom = buildOctahedralImpostorGeometry(manifest);
    expect(geom.indices).toBeInstanceOf(Uint16Array);
    expect(geom.indices!.length).toBe(6);

    const atlas = createProceduralImpostorAtlas(manifest, { seed: 7 });
    expect(atlas.width).toBe(64);
    expect(atlas.height).toBe(64);
    expect(atlas.albedoAlpha.length).toBe(64 * 64 * 4);
    expect(atlas.normalDepth.length).toBe(64 * 64 * 4);

    // Verify capture rig visits every cell and honors direction unit length
    let seenCells = 0;
    const captured = await captureOctahedralImpostorAtlas(manifest, ({ col, row, direction }) => {
      seenCells++;
      const expected = octahedralCellCenterDir(col, row, manifest.gridSize, manifest.mapping);
      expect(Math.hypot(direction[0], direction[1], direction[2])).toBeCloseTo(1, 5);
      expect(direction[0]).toBeCloseTo(expected[0], 5);
      return {
        albedoAlpha: new Uint8Array(manifest.tileResolution * manifest.tileResolution * 4).fill(
          255,
        ),
      };
    });
    expect(seenCells).toBe(16);
    expect(captured.normalDepth.length).toBe(64 * 64 * 4);

    const { albedoMap, normalDepthMap } = createTexturesFromImpostorAtlas(atlas);
    const mat = new OctahedralImpostorMaterial({ manifest, albedoMap, normalDepthMap });
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

    const manifestFlags = mat.getRenderManifest().flags ?? [];
    expect(manifestFlags).toContain("USE_NORMAL_MAP");

    const fs300Assembled = registry.assemble(def.sources.glsl300!.fs, "glsl300");
    const fs300WithFlags = fs300Assembled.replace(
      "#version 300 es",
      `#version 300 es\n${manifestFlags.map((f) => `#define ${f}`).join("\n")}`,
    );
    const gl3Res = await validate(
      [
        {
          name: "impostor.vert",
          source: registry.assemble(def.sources.glsl300!.vs, "glsl300"),
          stage: "vertex",
        },
        { name: "impostor.frag", source: fs300WithFlags, stage: "fragment" },
      ],
      {
        target: "webgl2",
        limits: { ...LIMITS.webgl2, maxFragmentUniformVectors: 1024, maxTextureImageUnits: 32 },
      },
    );
    const gl1Res = await validate(
      [
        {
          name: "impostor.vert",
          source: registry.assemble(def.sources.glsl100!.vs, "glsl100"),
          stage: "vertex",
        },
        {
          name: "impostor.frag",
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
