import { describe, expect, it, vi } from "vitest";
import { WebGL2UniformBuffer } from "../../src/renderers/WebGL2/WebGL2UniformBuffer.js";
import { Vector3D } from "../../src/math/index.js";

describe("WebGL2UniformBuffer component setters", () => {
  const mockGL = {
    UNIFORM_BUFFER: 0x8a11,
    DYNAMIC_DRAW: 0x88e8,
    createBuffer: vi.fn().mockReturnValue({}),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    bindBufferBase: vi.fn(),
    bufferSubData: vi.fn(),
    deleteBuffer: vi.fn(),
    getUniformBlockIndex: vi.fn().mockReturnValue(0),
    uniformBlockBinding: vi.fn(),
  } as unknown as WebGL2RenderingContext;

  it("correctly sets vec3 values via setVec3 without Vector3D allocations", () => {
    const ubo = new WebGL2UniformBuffer(mockGL, 256, 0);

    ubo.setVec3(16, 1.5, 2.5, 3.5);
    ubo.setVector3(32, new Vector3D(1.5, 2.5, 3.5));

    // Access the internal Float32Array to verify values match setVector3
    const data = (ubo as unknown as { _data: Float32Array })._data;
    expect(data[4]).toBeCloseTo(1.5);
    expect(data[5]).toBeCloseTo(2.5);
    expect(data[6]).toBeCloseTo(3.5);

    expect(data[8]).toBeCloseTo(1.5);
    expect(data[9]).toBeCloseTo(2.5);
    expect(data[10]).toBeCloseTo(3.5);
  });

  it("correctly sets vec4 values via setVec4", () => {
    const ubo = new WebGL2UniformBuffer(mockGL, 256, 0);

    ubo.setVec4(64, 10, 20, 30, 40);

    const data = (ubo as unknown as { _data: Float32Array })._data;
    expect(data[16]).toBeCloseTo(10);
    expect(data[17]).toBeCloseTo(20);
    expect(data[18]).toBeCloseTo(30);
    expect(data[19]).toBeCloseTo(40);
  });
});
