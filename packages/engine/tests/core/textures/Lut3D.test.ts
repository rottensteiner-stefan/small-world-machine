import { describe, it, expect } from "vitest";
import { Lut3D } from "../../../src/core/textures/Lut3D.js";

describe("Lut3D", () => {
  it("creates an identity 3D LUT with correct dimensions and corner values", () => {
    const lut = Lut3D.createIdentity(4);
    expect(lut.size).toBe(4);
    expect(lut.data.length).toBe(4 * 4 * 4 * 4); // 256 floats

    // (0, 0, 0) should be (0, 0, 0, 1)
    expect(lut.data[0]).toBe(0.0);
    expect(lut.data[1]).toBe(0.0);
    expect(lut.data[2]).toBe(0.0);
    expect(lut.data[3]).toBe(1.0);

    // (3, 3, 3) should be (1, 1, 1, 1)
    const lastIndex = (4 * 4 * 4 - 1) * 4;
    expect(lut.data[lastIndex]).toBe(1.0);
    expect(lut.data[lastIndex + 1]).toBe(1.0);
    expect(lut.data[lastIndex + 2]).toBe(1.0);
    expect(lut.data[lastIndex + 3]).toBe(1.0);
  });

  it("throws on invalid size or data length mismatch", () => {
    expect(() => new Lut3D(new Float32Array(16), 1)).toThrow("size must be an integer > 1");
    expect(() => new Lut3D(new Float32Array(10), 2)).toThrow("data length");
  });
});
