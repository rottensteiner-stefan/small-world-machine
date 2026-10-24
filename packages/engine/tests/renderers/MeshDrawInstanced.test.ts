import { describe, expect, it, vi } from "vitest";
import { Mesh } from "../../src/renderers/Mesh.js";
import { WireframeMode } from "../../src/enums/index.js";
import type { GeometryDataInterface } from "../../src/interfaces/index.js";

const GL = {
  ARRAY_BUFFER: 1,
  ELEMENT_ARRAY_BUFFER: 2,
  STATIC_DRAW: 3,
  UNSIGNED_SHORT: 4,
  UNSIGNED_INT: 5,
  LINES: 6,
  TRIANGLES: 7,
};

function mockGl(): WebGL2RenderingContext & {
  drawElementsInstanced: ReturnType<typeof vi.fn>;
  drawArraysInstanced: ReturnType<typeof vi.fn>;
} {
  let id = 0;
  return {
    ...GL,
    createBuffer: vi.fn(() => ({ id: id++ })),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    drawElementsInstanced: vi.fn(),
    drawArraysInstanced: vi.fn(),
  } as unknown as WebGL2RenderingContext & {
    drawElementsInstanced: ReturnType<typeof vi.fn>;
    drawArraysInstanced: ReturnType<typeof vi.fn>;
  };
}

// One triangle: 3 triangle indices, 2 structural edges (4 indices).
const TRI: GeometryDataInterface = {
  vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  indices: new Uint16Array([0, 1, 2]),
  wireframeIndices: new Uint16Array([0, 1, 1, 2]),
} as GeometryDataInterface;

describe("Mesh.drawInstanced", () => {
  it("draws the structural edge buffer for an instanced structural wireframe", () => {
    const gl = mockGl();
    const mesh = new Mesh(gl, TRI);

    mesh.drawInstanced(gl.LINES, 5, WireframeMode.STRUCTURAL);

    expect(gl.drawElementsInstanced).toHaveBeenCalledWith(gl.LINES, 4, gl.UNSIGNED_SHORT, 0, 5);
    expect(gl.bindBuffer).toHaveBeenLastCalledWith(gl.ELEMENT_ARRAY_BUFFER, mesh.webo);
  });

  it("keeps the triangle indices for TRIANGLES mode and for triangle draws", () => {
    const gl = mockGl();
    const mesh = new Mesh(gl, TRI);

    mesh.drawInstanced(gl.LINES, 5, WireframeMode.TRIANGLES);
    mesh.drawInstanced(gl.TRIANGLES, 5, WireframeMode.STRUCTURAL);

    expect(gl.drawElementsInstanced).toHaveBeenNthCalledWith(
      1,
      gl.LINES,
      3,
      gl.UNSIGNED_SHORT,
      0,
      5,
    );
    expect(gl.drawElementsInstanced).toHaveBeenNthCalledWith(
      2,
      gl.TRIANGLES,
      3,
      gl.UNSIGNED_SHORT,
      0,
      5,
    );
  });

  it("falls back to an instanced array draw for non-indexed geometry", () => {
    const gl = mockGl();
    const mesh = new Mesh(gl, { vertices: TRI.vertices } as GeometryDataInterface);

    mesh.drawInstanced(gl.TRIANGLES, 2);

    expect(gl.drawArraysInstanced).toHaveBeenCalledWith(gl.TRIANGLES, 0, 3, 2);
  });
});
