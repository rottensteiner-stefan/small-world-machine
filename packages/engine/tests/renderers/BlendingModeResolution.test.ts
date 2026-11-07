import { describe, it, expect } from "vitest";
import { resolveBlendingMode } from "../../src/renderers/WebGPU/managers/GPUPipelineCache.js";
import { BlendingMode } from "../../src/enums/index.js";

// WebGL enables SRC_ALPHA/ONE_MINUS_SRC_ALPHA for every transparent draw; WebGPU bakes blending
// into the pipeline, so it has to derive the same answer from the manifest state.
describe("resolveBlendingMode (WebGPU parity with WebGL's transparent pass)", () => {
  it("blends a transparent material that never chose a blending mode", () => {
    expect(resolveBlendingMode({ transparent: true })).toBe(BlendingMode.ALPHA);
  });

  it("keeps an explicitly chosen blending function", () => {
    expect(resolveBlendingMode({ transparent: true, blending: BlendingMode.ADDITIVE })).toBe(
      BlendingMode.ADDITIVE,
    );
    expect(resolveBlendingMode({ blending: BlendingMode.PREMULTIPLIED_ALPHA })).toBe(
      BlendingMode.PREMULTIPLIED_ALPHA,
    );
  });

  it("stays opaque for opaque materials", () => {
    expect(resolveBlendingMode({})).toBe(BlendingMode.DEFAULT);
    expect(resolveBlendingMode({ transparent: false })).toBe(BlendingMode.DEFAULT);
  });
});
