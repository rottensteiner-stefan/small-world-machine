import { describe, it, expect } from "vitest";
import { LightShaftsElement } from "../../../../src/renderers/post/elements/LightShaftsElement.js";
import { PostProcessingGroup } from "../../../../src/renderers/post/PostProcessingGroup.js";
import { PostProcessingEffectType } from "../../../../src/enums/index.js";

describe("LightShaftsElement", () => {
  it("initializes with physically grounded atmospheric defaults", () => {
    const elem = new LightShaftsElement();

    expect(elem.type).toBe(PostProcessingEffectType.LIGHT_SHAFTS);
    expect(elem.enabled).toBe(false);
    expect(elem.intensity).toBeCloseTo(1.0);
    expect(elem.density).toBeCloseTo(0.05);
    expect(elem.asymmetry).toBeCloseTo(0.7);
    expect(elem.maxDistance).toBeCloseTo(40.0);
    expect(elem.samples).toBe(16);
    expect(elem.decay).toBeCloseTo(0.95);
    expect(elem.weight).toBeCloseTo(0.5);
    expect(elem.color.r).toBeCloseTo(1.0);
    expect(elem.color.g).toBeCloseTo(0.95);
    expect(elem.color.b).toBeCloseTo(0.85);
  });

  it("updates atmospheric and scattering parameters dynamically", () => {
    const elem = new LightShaftsElement();

    elem.enabled = true;
    elem.intensity = 2.5;
    elem.density = 0.12;
    elem.asymmetry = 0.82;
    elem.maxDistance = 60.0;
    elem.samples = 24;
    elem.decay = 0.92;
    elem.weight = 0.65;
    elem.color.set(1.0, 0.8, 0.4);

    expect(elem.enabled).toBe(true);
    expect(elem.intensity).toBeCloseTo(2.5);
    expect(elem.density).toBeCloseTo(0.12);
    expect(elem.asymmetry).toBeCloseTo(0.82);
    expect(elem.maxDistance).toBeCloseTo(60.0);
    expect(elem.samples).toBe(24);
    expect(elem.decay).toBeCloseTo(0.92);
    expect(elem.weight).toBeCloseTo(0.65);
    expect(elem.color.r).toBeCloseTo(1.0);
    expect(elem.color.g).toBeCloseTo(0.8);
    expect(elem.color.b).toBeCloseTo(0.4);
  });

  it("is registered within PostProcessingGroup by default", () => {
    const group = new PostProcessingGroup();
    const elem = group.get<LightShaftsElement>(PostProcessingEffectType.LIGHT_SHAFTS);

    expect(elem).toBeDefined();
    expect(elem).toBeInstanceOf(LightShaftsElement);
    expect(elem?.enabled).toBe(false);
  });
});
