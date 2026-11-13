import { describe, expect, it } from "vitest";
import {
  canWrapFragmentWithNormalOutput,
  wrapFragmentWithNormalOutput,
} from "../../src/renderers/WebGPU/managers/NormalOutputWrapper.js";
import {
  canWrapFragmentWithNormalOutputGL,
  wrapFragmentWithNormalOutputGL,
} from "../../src/renderers/gl/managers/NormalOutputWrapperGL.js";

// Odd formatting / foreign entry points the wrappers cannot rewrite.
const UNMATCHED_WGSL = [
  "@fragment fn fs(i: Out) -> @location(0) vec4h { return vec4h(1.0); }",
  "@fragment fn main_fs(i: Out) -> @location(0) vec4f { return vec4f(1.0); }",
  "@fragment fn fs(i: Out, @builtin(front_facing) ff: bool) -> @location(0) vec4f { return vec4f(1.0); }",
  "@fragment fn fs(i: Out) -> FragOut { return FragOut(vec4f(1.0)); }",
];
const UNMATCHED_GLSL = [
  "#version 300 es\nout vec4 outColor;\nvoid main() { outColor = vec4(1.0); }",
  "#version 300 es\nout vec4 fragColor;\nvoid mainImage() { fragColor = vec4(1.0); }",
  "#version 300 es\nlayout(location = 0) out vec4 fragColor, o2;\nvoid main() {}",
];

describe("normal output wrappers: unmatched shaders", () => {
  it("WGSL: unmatched shaders are reported and returned verbatim", () => {
    for (const src of UNMATCHED_WGSL) {
      expect(canWrapFragmentWithNormalOutput(src), src).toBe(false);
      expect(wrapFragmentWithNormalOutput(src), src).toBe(src);
    }
    expect(
      canWrapFragmentWithNormalOutput(
        "@fragment fn fs(i: Out) -> @location(0) vec4f { return v; }",
      ),
    ).toBe(true);
  });

  it("GLSL: unmatched shaders are reported and returned verbatim", () => {
    for (const src of UNMATCHED_GLSL) {
      expect(canWrapFragmentWithNormalOutputGL(src), src).toBe(false);
      expect(wrapFragmentWithNormalOutputGL(src), src).toBe(src);
    }
    expect(
      canWrapFragmentWithNormalOutputGL(
        "out vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }",
      ),
    ).toBe(true);
  });
});
