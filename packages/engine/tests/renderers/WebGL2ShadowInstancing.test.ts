import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { WebGL2Renderer } from "../../src/renderers/WebGL2/WebGL2Renderer.js";
import { InstancedMesh } from "../../src/core/InstancedMesh.js";
import { Object3D } from "../../src/core/Object3D.js";
import { Cube } from "../../src/geometry/Cube.js";
import { BasicMaterial } from "../../src/core/materials/surface/BasicMaterial.js";
import { WireframeMaterial } from "../../src/core/materials/WireframeMaterial.js";
import { MaterialType, Topology } from "../../src/enums/index.js";
import type { RenderBatch } from "../../src/core/Scene.js";

interface ProgramStub {
  prog: object;
  uniforms: Map<string, unknown>;
  attributes: Map<string, number>;
}

type Fn = ReturnType<typeof vi.fn>;

interface Internals {
  gl: {
    useProgram: Fn;
    uniform4fv: Fn;
    enable: Fn;
    disable: Fn;
    bindVertexArray: Fn;
    drawArrays: Fn;
    CULL_FACE: number;
    TRIANGLES: number;
    LINES: number;
  };
  _programCache: { getProgram: ReturnType<typeof vi.fn> };
  _bindDummyShadowMaps: ReturnType<typeof vi.fn>;
  _renderInstancedObject: ReturnType<typeof vi.fn>;
  _uploadModelMatrix: ReturnType<typeof vi.fn>;
  _textures: { acquireTextures: ReturnType<typeof vi.fn> };
  _geometry: { getOrCreateMesh: ReturnType<typeof vi.fn> };
  _renderShadowScene: (
    shaderId: string,
    lineShaderId: string,
    texelNdc: number,
    batches: RenderBatch[],
  ) => void;
}

function program(name: string): ProgramStub {
  return { prog: { name }, uniforms: new Map([["u_extraParams", {}]]), attributes: new Map() };
}

const RIBBON = { vertexCount: 72 };

interface Setup {
  r: Internals;
  std: ProgramStub;
  inst: ProgramStub;
  line: ProgramStub;
  draw: ReturnType<typeof vi.fn>;
  bindLineRibbon: ReturnType<typeof vi.fn>;
}

function setup(): Setup {
  const r = new WebGL2Renderer() as unknown as Internals;
  const std = program("std");
  const inst = program("inst");
  const line = program("line");
  const draw = vi.fn();
  const bindLineRibbon = vi.fn();
  r.gl = {
    useProgram: vi.fn(),
    uniform4fv: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    bindVertexArray: vi.fn(),
    drawArrays: vi.fn(),
    CULL_FACE: 1,
    TRIANGLES: 4,
    LINES: 1,
  };
  r._programCache = {
    getProgram: vi.fn((id: string, isInstanced?: boolean) =>
      id === "line" ? line : isInstanced ? inst : std,
    ),
  };
  r._bindDummyShadowMaps = vi.fn();
  r._renderInstancedObject = vi.fn();
  r._uploadModelMatrix = vi.fn();
  r._textures = { acquireTextures: vi.fn() };
  r._geometry = {
    getOrCreateMesh: vi.fn(() => ({
      vaoCapable: true,
      bindVAO: vi.fn(),
      draw,
      getLineRibbon: vi.fn(() => RIBBON),
      bindLineRibbon,
    })),
  };
  return { r, std, inst, line, draw, bindLineRibbon };
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

    r._renderShadowScene(MaterialType.DEPTH, "line", 1 / 512, [batch([plain, instMesh])]);

    expect(r._programCache.getProgram).toHaveBeenCalledWith(MaterialType.DEPTH, true);
    expect(r._renderInstancedObject).toHaveBeenCalledWith(
      instMesh,
      inst,
      Topology.TRIANGLE_LIST,
      undefined,
    );
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

    r._renderShadowScene(MaterialType.EVSM, "line", 1 / 512, [batch([instMesh])]);

    expect(r._renderInstancedObject).not.toHaveBeenCalled();
    expect(r._programCache.getProgram).not.toHaveBeenCalledWith(MaterialType.EVSM, true);
  });
});

describe("WebGL2 shadow pass: line casters with a shadowWidth (ADR 0045)", () => {
  function wire(shadowWidth: number): { batch: RenderBatch; obj: Object3D } {
    const obj = new Object3D("Wire");
    obj.geometry = new Cube().getGeometryData();
    obj.material = new WireframeMaterial({ shadowWidth });
    obj.castShadow = true;
    return {
      obj,
      batch: {
        shaderId: "w",
        topology: Topology.LINE_LIST,
        matUuid: "w",
        shadowWidth,
        objects: [obj],
      },
    };
  }

  it("draws the edge ribbon with the line program, culling off, width + texel in u_extraParams", () => {
    const { r, line, bindLineRibbon, draw } = setup();
    const { batch: b } = wire(0.04);

    r._renderShadowScene(MaterialType.DEPTH, "line", 1 / 512, [b]);

    expect(r.gl.useProgram).toHaveBeenCalledWith(line.prog);
    expect(bindLineRibbon).toHaveBeenCalledWith(RIBBON);
    expect(r.gl.drawArrays).toHaveBeenCalledWith(r.gl.TRIANGLES, 0, RIBBON.vertexCount);
    expect(draw).not.toHaveBeenCalled();
    const params = r.gl.uniform4fv.mock.calls[0]![1] as Float32Array;
    expect(params[2]).toBeCloseTo(1 / 512);
    expect(params[3]).toBeCloseTo(0.02);
    expect(r.gl.disable).toHaveBeenCalledWith(r.gl.CULL_FACE);
    expect(r.gl.enable).toHaveBeenCalledWith(r.gl.CULL_FACE);
  });

  it("keeps the 1-texel line path for shadowWidth 0", () => {
    const { r, line, draw } = setup();
    const { batch: b } = wire(0);

    r._renderShadowScene(MaterialType.DEPTH, "line", 1 / 512, [b]);

    expect(r.gl.useProgram).not.toHaveBeenCalledWith(line.prog);
    expect(draw).toHaveBeenCalledWith(r.gl.LINES, b.wireframeMode);
    expect(r.gl.disable).not.toHaveBeenCalled();
  });
});
