import { describe, it, expect } from "vitest";
import { UniformPacker } from "../../src/renderers/shaders/UniformPacker.js";
import { ShaderPropertyType } from "../../src/enums/index.js";
import { Color } from "../../src/core/colors/Color.js";
import { Matrix4 } from "../../src/math/index.js";

describe("WebGPU Object Uniform Color/Alpha Packing", () => {
  it("correctly preserves alpha when packing 4-component COLOR into uniform buffer", () => {
    const layout = {
      uniforms: {
        u_color: { type: ShaderPropertyType.COLOR },
      },
      uniformLayout: ["u_color"],
      textures: {},
    };

    const targetBuffer = new Float32Array(16); // 64 bytes = 16 floats

    // Case 1: Custom color with specific alpha
    const color = new Color(0.2, 0.4, 0.6, 0.8);
    const scratchColor = new Float32Array([color.r, color.g, color.b, color.a]);

    UniformPacker.packInto(layout, { u_color: scratchColor }, targetBuffer);

    expect(targetBuffer[0]).toBeCloseTo(0.2);
    expect(targetBuffer[1]).toBeCloseTo(0.4);
    expect(targetBuffer[2]).toBeCloseTo(0.6);
    expect(targetBuffer[3]).toBeCloseTo(0.8);

    // Case 2: Fallback when material has no color (defaults to 1.0, 1.0, 1.0, 1.0)
    const fallbackColor = new Float32Array([1.0, 1.0, 1.0, 1.0]);
    UniformPacker.packInto(layout, { u_color: fallbackColor }, targetBuffer);

    expect(targetBuffer[0]).toBeCloseTo(1.0);
    expect(targetBuffer[1]).toBeCloseTo(1.0);
    expect(targetBuffer[2]).toBeCloseTo(1.0);
    expect(targetBuffer[3]).toBeCloseTo(1.0);
  });
});

describe("WebGPU Object Uniform MAT4 alignment (WGSL/std140 spec compliance)", () => {
  it("aligns a MAT4 following a scalar to a 16-byte (4-float) boundary, not 64 bytes", () => {
    // WGSL/std140: a mat4x4's base alignment equals its column type's (vec4 -> 16 bytes),
    // not its total size (64 bytes). A single leading FLOAT lands at float-offset 0; the correct
    // next aligned offset for a MAT4 is 4 (16 bytes), not 16 (64 bytes).
    const layout = {
      uniforms: {
        u_pad: { type: ShaderPropertyType.FLOAT },
        u_model: { type: ShaderPropertyType.MAT4 },
      },
      uniformLayout: ["u_pad", "u_model"],
      textures: {},
    };

    const identity = new Matrix4();
    const targetBuffer = new Float32Array(32);
    UniformPacker.packInto(layout, { u_pad: 1, u_model: identity }, targetBuffer);

    expect(targetBuffer[0]).toBeCloseTo(1); // u_pad at offset 0
    // The 3 floats between the scalar and the correct 4-float alignment boundary must be padding.
    expect(Array.from(targetBuffer.slice(1, 4))).toEqual([0, 0, 0]);
    // u_model must start at float-offset 4 (16 bytes), matching the WGSL struct layout exactly --
    // not offset 16, which the old (spec-violating) 64-byte alignment would have produced.
    expect(Array.from(targetBuffer.slice(4, 20))).toEqual(Array.from(identity.data));
  });

  it("still packs correctly when a MAT4 is the very first uniform (offset 0 either way)", () => {
    const layout = {
      uniforms: {
        u_model: { type: ShaderPropertyType.MAT4 },
        u_color: { type: ShaderPropertyType.COLOR },
      },
      uniformLayout: ["u_model", "u_color"],
      textures: {},
    };

    const identity = new Matrix4();
    const color = new Color(0.1, 0.2, 0.3, 0.4);
    const targetBuffer = new Float32Array(32);
    UniformPacker.packInto(layout, { u_model: identity, u_color: color }, targetBuffer);

    expect(Array.from(targetBuffer.slice(0, 16))).toEqual(Array.from(identity.data));
    // A MAT4 still occupies its full 64 bytes (16 floats) -- only its *alignment* changed.
    const packedColor = Array.from(targetBuffer.slice(16, 20));
    [0.1, 0.2, 0.3, 0.4].forEach((expected, i) => expect(packedColor[i]).toBeCloseTo(expected));
  });
});

describe("StandardWebGPULayout ObjectUniforms 512-byte budget and style slots", () => {
  it("packs StandardWebGPULayout into exactly 128 floats (512 bytes) with u_styleA at float 56, u_styleB at float 60 and u_matParam0 at float 64", async () => {
    const { StandardWebGPULayout } =
      await import("../../src/renderers/shaders/StandardWebGPULayout.js");
    const targetBuffer = new Float32Array(128);
    const dummyValues: Record<string, unknown> = {
      u_model: new Matrix4(),
      u_color: new Float32Array([1, 1, 1, 1]),
      u_specColor: new Float32Array([0, 0, 0, 0]),
      u_texOffset: [0, 0],
      u_texRepeat: [1, 1],
      u_shininess: 30,
      u_isTerrain: 0,
      u_metallic: 0,
      u_roughness: 1,
      u_extraParams: [0, 0, 0, 0],
      u_liquidParams: [0, 0, 0, 0],
      u_thresholds: [0, 0, 0, 0],
      u_useEnvMap: 0,
      u_useReflectionMap: 0,
      u_reflectivity: 1,
      u_time: 0,
      u_isSkinned: 0,
      u_boneOffset: 0,
      u_pad1: 0,
      u_pad2: 0,
      u_pad3: 0,
      u_styleA: [0.8, 0.5, 0.4, 1.2],
      u_styleB: [0.12, 0.6, 0.3, 2.0],
      u_matParam0: [1.0, 2.0, 3.0, 4.0],
    };

    UniformPacker.packInto(StandardWebGPULayout, dummyValues, targetBuffer);

    // u_styleA must land at float offset 56 (byte offset 224)
    expect(targetBuffer[56]).toBeCloseTo(0.8);
    expect(targetBuffer[57]).toBeCloseTo(0.5);
    expect(targetBuffer[58]).toBeCloseTo(0.4);
    expect(targetBuffer[59]).toBeCloseTo(1.2);

    // u_styleB must land at float offset 60 (byte offset 240)
    expect(targetBuffer[60]).toBeCloseTo(0.12);
    expect(targetBuffer[61]).toBeCloseTo(0.6);
    expect(targetBuffer[62]).toBeCloseTo(0.3);
    expect(targetBuffer[63]).toBeCloseTo(2.0);

    // u_matParam0 must land at float offset 64 (byte offset 256)
    expect(targetBuffer[64]).toBeCloseTo(1.0);
    expect(targetBuffer[65]).toBeCloseTo(2.0);
    expect(targetBuffer[66]).toBeCloseTo(3.0);
    expect(targetBuffer[67]).toBeCloseTo(4.0);
  });
});
