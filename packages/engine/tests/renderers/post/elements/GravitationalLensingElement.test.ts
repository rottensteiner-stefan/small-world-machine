import { describe, it, expect } from "vitest";
import { GravitationalLensingElement } from "../../../../src/renderers/post/elements/GravitationalLensingElement.js";
import { PostProcessingGroup } from "../../../../src/renderers/post/PostProcessingGroup.js";
import { PostProcessingEffectType } from "../../../../src/enums/index.js";

describe("GravitationalLensingElement", () => {
  it("initializes with physically grounded relativistic defaults", () => {
    const elem = new GravitationalLensingElement();

    expect(elem.type).toBe(PostProcessingEffectType.GRAVITATIONAL_LENSING);
    expect(elem.enabled).toBe(true);
    expect(elem.eventHorizonRadius).toBeCloseTo(0.03);
    expect(elem.strength).toBeCloseTo(0.25);
    expect(elem.spaghettification).toBeCloseTo(0.15);
    expect(elem.relativisticBeaming).toBeCloseTo(1.2);
    expect(elem.ringGlowIntensity).toBeCloseTo(2.5);
    expect(elem.singularityScreenPos.x).toBe(0);
    expect(elem.singularityScreenPos.y).toBe(0);
    expect(elem.singularityScreenPos.z).toBe(1);
  });

  it("updates parameters and screen coordinates dynamically", () => {
    const elem = new GravitationalLensingElement();

    elem.singularityScreenPos.set(0.25, -0.4, 0.9);
    elem.eventHorizonRadius = 0.05;
    elem.strength = 0.5;
    elem.spaghettification = 0.3;
    elem.relativisticBeaming = 1.8;
    elem.ringGlowIntensity = 4.0;

    expect(elem.singularityScreenPos.x).toBeCloseTo(0.25);
    expect(elem.singularityScreenPos.y).toBeCloseTo(-0.4);
    expect(elem.singularityScreenPos.z).toBeCloseTo(0.9);
    expect(elem.eventHorizonRadius).toBeCloseTo(0.05);
    expect(elem.strength).toBeCloseTo(0.5);
    expect(elem.spaghettification).toBeCloseTo(0.3);
    expect(elem.relativisticBeaming).toBeCloseTo(1.8);
    expect(elem.ringGlowIntensity).toBeCloseTo(4.0);
  });

  it("loads configuration from PostProcessingGroup.loadConfig() with object and array formats", () => {
    const group = new PostProcessingGroup();

    // 1. Array coordinate format
    group.loadConfig({
      effects: {
        gravitationalLensing: {
          enabled: true,
          singularityScreenPos: [0.3, -0.1, 0.7],
          eventHorizonRadius: 0.06,
          strength: 0.35,
          spaghettification: 0.18,
          relativisticBeaming: 1.4,
          ringGlowIntensity: 3.2,
        },
      },
    });

    const elem = group.get<GravitationalLensingElement>(
      PostProcessingEffectType.GRAVITATIONAL_LENSING,
    )!;
    expect(elem).toBeDefined();
    expect(elem.enabled).toBe(true);
    expect(elem.singularityScreenPos.x).toBeCloseTo(0.3);
    expect(elem.singularityScreenPos.y).toBeCloseTo(-0.1);
    expect(elem.singularityScreenPos.z).toBeCloseTo(0.7);
    expect(elem.eventHorizonRadius).toBeCloseTo(0.06);
    expect(elem.strength).toBeCloseTo(0.35);
    expect(elem.spaghettification).toBeCloseTo(0.18);
    expect(elem.relativisticBeaming).toBeCloseTo(1.4);
    expect(elem.ringGlowIntensity).toBeCloseTo(3.2);

    // 2. Object coordinate format
    group.loadConfig({
      effects: {
        gravitationalLensing: {
          singularityScreenPos: { x: -0.5, y: 0.2, z: 0.4 },
          strength: 0.8,
        },
      },
    });

    expect(elem.singularityScreenPos.x).toBeCloseTo(-0.5);
    expect(elem.singularityScreenPos.y).toBeCloseTo(0.2);
    expect(elem.singularityScreenPos.z).toBeCloseTo(0.4);
    expect(elem.strength).toBeCloseTo(0.8);
  });

  it("supports lifecycle operations in PostProcessingGroup", () => {
    const group = new PostProcessingGroup();
    expect(group.get(PostProcessingEffectType.GRAVITATIONAL_LENSING)).toBeDefined();

    const deleted = group.delete(PostProcessingEffectType.GRAVITATIONAL_LENSING);
    expect(deleted).toBe(true);
    expect(group.get(PostProcessingEffectType.GRAVITATIONAL_LENSING)).toBeUndefined();

    const newElem = new GravitationalLensingElement();
    newElem.strength = 0.99;
    group.add(newElem);

    expect(
      group.get<GravitationalLensingElement>(PostProcessingEffectType.GRAVITATIONAL_LENSING)
        ?.strength,
    ).toBeCloseTo(0.99);
  });
});
