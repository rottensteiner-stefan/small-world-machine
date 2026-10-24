import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { WebGL2Renderer } from "../../src/renderers/WebGL2/WebGL2Renderer.js";
import { InstancedMesh } from "../../src/core/InstancedMesh.js";
import { Object3D } from "../../src/core/Object3D.js";
import { Cube } from "../../src/geometry/Cube.js";
import { BasicMaterial } from "../../src/core/materials/surface/BasicMaterial.js";
import { MaterialType, Topology } from "../../src/enums/index.js";
import type { RenderBatch } from "../../src/core/Scene.js";

interface ProgramStub {
  prog: object;
  uniforms: Map<string, unknown>;
  attributes: Map<string, number>;
}

interface Internals {
  gl: { useProgram: ReturnType<typeof vi.fn>; uniform4fv: ReturnType<typeof vi.fn> };
  _programCache: { getProgram: ReturnType<typeof vi.fn> };
  _bindDummyShadowMaps: ReturnType<typeof vi.fn>;
  _renderInstancedObject: ReturnType<typeof vi.fn>;
  _uploadModelMatrix: ReturnType<typeof vi.fn>;
  _textures: { acquireTextures: ReturnType<typeof vi.fn> };
  _geometry: { getOrCreateMesh: ReturnType<typeof vi.fn> };
  _renderShadowScene: (shaderId: string, batches: RenderBatch[]) => void;
}

function program(): ProgramStub {
  return { prog: {}, uniforms: new Map([["u_extraParams", {}]]), attributes: new Map() };
}

function setup(): {
  r: Internals;
  std: ProgramStub;
  inst: ProgramStub;
  draw: ReturnType<typeof vi.fn>;
} {
  const r = new WebGL2Renderer() as unknown as Internals;
  const std = program();
  const inst = program();
  const draw = vi.fn();
  r.gl = { useProgram: vi.fn(), uniform4fv: vi.fn() };
  r._programCache = {
    getProgram: vi.fn((_id: string, isInstanced?: boolean) => (isInstanced ? inst : std)),
  };
  r._bindDummyShadowMaps = vi.fn();
  r._renderInstancedObject = vi.fn();
  r._uploadModelMatrix = vi.fn();
  r._textures = { acquireTextures: vi.fn() };
  r._geometry = {
    getOrCreateMesh: vi.fn(() => ({ vaoCapable: true, bindVAO: vi.fn(), draw })),
  };
  return { r, std, inst, draw };
}

function batch(objects: Object3D[]): RenderBatch {
  return { shaderId: "test", topology: Topology.TRIANGLE_LIST, matUuid: "m", objects };
}

describe("WebGL2 shadow pass: InstancedMesh casters", () => {
  it("draws an instanced caster with the instanced depth program, every instance included", () => {
    const { r, std, inst, draw } = setup();
    const mat = new BasicMaterial();
    const geo = new Cube().getGeometryData();
    const instMesh = new InstancedMesh("Inst", geo, mat, 8);
    instMesh.castShadow = true;
    const plain = new Object3D("Plain");
    plain.geometry = geo;
    plain.material = mat;
    plain.castShadow = true;

    r._renderShadowScene(MaterialType.DEPTH, [batch([plain, instMesh])]);

    expect(r._programCache.getProgram).toHaveBeenCalledWith(MaterialType.DEPTH, true);
    expect(r._renderInstancedObject).toHaveBeenCalledWith(instMesh, inst, Topology.TRIANGLE_LIST);
    expect(draw).toHaveBeenCalledTimes(1); // only the plain caster takes the non-instanced path
    expect(r.gl.useProgram.mock.calls.map((c) => c[0])).toEqual([std.prog, inst.prog]);
    // The alpha-test uniforms are re-set on the instanced program after the switch.
    expect(r.gl.uniform4fv).toHaveBeenCalledTimes(2);
  });

  it("skips an InstancedMesh with zero live instances and never builds the instanced program", () => {
    const { r } = setup();
    const mat = new BasicMaterial();
    const instMesh = new InstancedMesh("Inst", new Cube().getGeometryData(), mat, 8);
    instMesh.castShadow = true;
    instMesh.instanceCount = 0;

    r._renderShadowScene(MaterialType.EVSM, [batch([instMesh])]);

    expect(r._renderInstancedObject).not.toHaveBeenCalled();
    expect(r._programCache.getProgram).not.toHaveBeenCalledWith(MaterialType.EVSM, true);
  });
});
