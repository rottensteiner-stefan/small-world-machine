import { describe, it, expect } from "vitest";
import { LutGradingElement } from "../../src/renderers/post/elements/LutGradingElement.js";
import { Lut3D } from "../../src/core/textures/Lut3D.js";
import { PostProcessingGroup } from "../../src/renderers/post/PostProcessingGroup.js";
import { decodeBundle } from "../../src/renderers/post/PostEffectBundle.js";
import { PostProcessingEffectType } from "../../src/enums/index.js";

describe("LutGradingElement", () => {
  it("initializes with default values and neutral structural key", () => {
    const elem = new LutGradingElement();
    expect(elem.type).toBe(PostProcessingEffectType.LUT_GRADING);
    expect(elem.lut).toBeNull();
    expect(elem.intensity).toBe(1.0);
    expect(elem.enabled).toBe(true);
    // When lut is null, structuralKey should report active 0
    expect(elem.structuralKey()).toBe("0|0");
  });

  it("reports active structural key when enabled with a Lut3D", () => {
    const lut = Lut3D.createIdentity(16);
    const elem = new LutGradingElement(lut, 0.75);
    expect(elem.structuralKey()).toBe("1|16");

    elem.enabled = false;
    expect(elem.structuralKey()).toBe("0|0");
  });

  it("packs intensity and size into dyn uniforms slice", () => {
    const lut = Lut3D.createIdentity(32);
    const elem = new LutGradingElement(lut, 0.8);
    const uniforms = new Float32Array(52);

    elem.packUniforms(uniforms, 0);
    expect(uniforms[46]).toBeCloseTo(0.8);
    expect(uniforms[47]).toBe(32.0);

    elem.enabled = false;
    elem.packUniforms(uniforms, 0);
    expect(uniforms[46]).toBe(0.0);
  });

  it("is registered by default in PostProcessingGroup and decodes into PostEffectBundle", () => {
    const group = new PostProcessingGroup();
    const elem = group.get<LutGradingElement>(PostProcessingEffectType.LUT_GRADING);
    expect(elem).toBeDefined();
    expect(elem instanceof LutGradingElement).toBe(true);

    const bundle = decodeBundle(group);
    expect(bundle.lutGrading).toBe(elem);
  });
});
