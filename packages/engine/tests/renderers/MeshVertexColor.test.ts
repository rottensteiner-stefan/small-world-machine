import { describe, expect, it, vi } from "vitest";
import { Mesh, VERTEX_COLOR_LOCATION } from "../../src/renderers/Mesh.js";
import { Plane } from "../../src/geometry/index.js";
import type { GeometryDataInterface } from "../../src/interfaces/index.js";

interface FakeGlCalls {
  ARRAY_BUFFER: number;
  STATIC_DRAW: number;
  FLOAT: number;
  bufferData: ReturnType<typeof vi.fn>;
  deleteBuffer: ReturnType<typeof vi.fn>;
  vertexAttribPointer: ReturnType<typeof vi.fn>;
  enableVertexAttribArray: ReturnType<typeof vi.fn>;
  disableVertexAttribArray: ReturnType<typeof vi.fn>;
  vertexAttrib4f: ReturnType<typeof vi.fn>;
}

function createFakeGl(): Record<string, number | ReturnType<typeof vi.fn>> & FakeGlCalls {
  let nextBuffer = 0;
  return {
    ARRAY_BUFFER: 1,
    ELEMENT_ARRAY_BUFFER: 2,
    STATIC_DRAW: 3,
    FLOAT: 4,
    UNSIGNED_SHORT: 5,
    UNSIGNED_INT: 6,
    createBuffer: vi.fn(() => ({ id: nextBuffer++ })),
    deleteBuffer: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    vertexAttribPointer: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    disableVertexAttribArray: vi.fn(),
    vertexAttrib4f: vi.fn(),
  };
}

const triangle = (colors?: Float32Array): GeometryDataInterface => {
  const plane = new Plane();
  plane.colors = colors;
  return plane.getGeometryData();
};

describe("Mesh vertex colors", () => {
  it("uploads the color stream and points the attribute at it", () => {
    const gl = createFakeGl();
    const colors = new Float32Array(12).fill(0.5);
    const mesh = new Mesh(gl as unknown as WebGL2RenderingContext, triangle(colors));

    expect(mesh.cbo).toBeDefined();
    expect(gl.bufferData).toHaveBeenCalledWith(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);

    mesh.bind(0, -1, -1, -1, -1, -1, 7);
    expect(gl.vertexAttribPointer).toHaveBeenCalledWith(7, 4, gl.FLOAT, false, 0, 0);
    expect(gl.enableVertexAttribArray).toHaveBeenCalledWith(7);
    expect(gl.vertexAttrib4f).not.toHaveBeenCalled();
  });

  it("falls back to opaque white (not the GL default black) when the mesh has no colors", () => {
    const gl = createFakeGl();
    const mesh = new Mesh(gl as unknown as WebGL2RenderingContext, triangle());

    expect(mesh.cbo).toBeUndefined();
    mesh.bind(0, -1, -1, -1, -1, -1, 7);
    expect(gl.disableVertexAttribArray).toHaveBeenCalledWith(7);
    expect(gl.vertexAttrib4f).toHaveBeenCalledWith(7, 1, 1, 1, 1);
  });

  it("does not touch the color attribute for programs without one", () => {
    const gl = createFakeGl();
    const mesh = new Mesh(gl as unknown as WebGL2RenderingContext, triangle());
    mesh.bind(0);
    expect(gl.vertexAttrib4f).not.toHaveBeenCalled();
  });

  it("captures the color stream (or the white constant) in the VAO at the fixed location", () => {
    const gl = {
      ...createFakeGl(),
      createVertexArray: vi.fn(() => ({})),
      bindVertexArray: vi.fn(),
    };
    const withColors = new Mesh(
      gl as unknown as WebGL2RenderingContext,
      triangle(new Float32Array(12).fill(1)),
    );
    withColors.bindVAO();
    expect(gl.vertexAttribPointer).toHaveBeenCalledWith(
      VERTEX_COLOR_LOCATION,
      4,
      gl.FLOAT,
      false,
      0,
      0,
    );

    gl.vertexAttrib4f.mockClear();
    const without = new Mesh(gl as unknown as WebGL2RenderingContext, triangle());
    without.bindVAO();
    expect(gl.vertexAttrib4f).toHaveBeenCalledWith(VERTEX_COLOR_LOCATION, 1, 1, 1, 1);
  });

  it("frees the color buffer on dispose", () => {
    const gl = createFakeGl();
    const mesh = new Mesh(gl as unknown as WebGL2RenderingContext, triangle(new Float32Array(12)));
    const colorBuffer = mesh.cbo;
    mesh.dispose();
    expect(gl.deleteBuffer).toHaveBeenCalledWith(colorBuffer);
  });
});
