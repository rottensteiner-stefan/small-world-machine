import { afterEach, describe, expect, it, vi } from "vitest";
import { StandardWebGPULayout, UniformPacker } from "../../src/renderers/shaders/index.js";

// A CustomShaderMaterial on the standard WGSL layout usually supplies only a few uniforms. The
// packer warned once per missing field, per object, per frame (ten fields: thousands of warnings
// a second and 28 ms of CPU time in the voxel prototype). The layout now carries neutral defaults.

describe("StandardWebGPULayout defaults", () => {
  afterEach(() => vi.restoreAllMocks());

  it("packs a material that supplies only the model matrix and colour without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    UniformPacker.packInto(
      StandardWebGPULayout,
      { u_model: new Float32Array(16), u_color: [1, 1, 1, 1], u_isSkinned: 0, u_boneOffset: 0 },
      new Float32Array(128),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("defaults texRepeat to identity, so UVs are not collapsed to a point", () => {
    expect(StandardWebGPULayout.uniforms["u_texRepeat"]?.defaultValue).toEqual([1, 1]);
    expect(StandardWebGPULayout.uniforms["u_texOffset"]?.defaultValue).toEqual([0, 0]);
  });
});
