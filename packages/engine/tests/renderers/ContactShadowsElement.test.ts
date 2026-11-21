import { describe, it, expect } from "vitest";
import { ContactShadowsElement } from "../../src/renderers/post/elements/ContactShadowsElement.js";
import { PostProcessingGroup } from "../../src/renderers/post/PostProcessingGroup.js";
import { decodeBundle } from "../../src/renderers/post/PostEffectBundle.js";
import { PostProcessingEffectType } from "../../src/enums/index.js";

describe("ContactShadowsElement", () => {
  it("initializes with default values and structural key", () => {
    const elem = new ContactShadowsElement();
    expect(elem.type).toBe(PostProcessingEffectType.CONTACT_SHADOWS);
    expect(elem.enabled).toBe(false);
    expect(elem.intensity).toBe(1.0);
    expect(elem.maxDistance).toBe(0.5);
    expect(elem.thickness).toBe(0.05);
    expect(elem.raySteps).toBe(16);
    expect(elem.fadeDistance).toBe(30.0);
    expect(elem.bias).toBe(0.005);
    expect(elem.structuralKey()).toBe("0|16");
  });

  it("updates structural key based on enabled state and raySteps", () => {
    const elem = new ContactShadowsElement({
      enabled: true,
      raySteps: 24,
      intensity: 0.8,
    });
    expect(elem.structuralKey()).toBe("1|24");

    elem.enabled = false;
    expect(elem.structuralKey()).toBe("0|24");

    elem.raySteps = 32;
    expect(elem.structuralKey()).toBe("0|32");
  });

  it("packs intensity into DynUniforms slot 48", () => {
    const elem = new ContactShadowsElement({
      enabled: true,
      intensity: 0.75,
    });
    const uniforms = new Float32Array(52);

    elem.packUniforms(uniforms, 0);
    expect(uniforms[48]).toBeCloseTo(0.75);

    elem.enabled = false;
    elem.packUniforms(uniforms, 0);
    expect(uniforms[48]).toBe(0.0);
  });

  it("is registered in PostProcessingGroup and decodes into PostEffectBundle", () => {
    const group = new PostProcessingGroup();
    const elem = group.get<ContactShadowsElement>(PostProcessingEffectType.CONTACT_SHADOWS);
    expect(elem).toBeDefined();
    expect(elem instanceof ContactShadowsElement).toBe(true);

    const bundle = decodeBundle(group);
    expect(bundle.contactShadows).toBe(elem);
  });
});
