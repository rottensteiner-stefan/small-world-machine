import { describe, it, expect } from "vitest";
import { OutlineElement } from "../../../../src/renderers/post/elements/OutlineElement.js";
import { PostProcessingEffectType } from "../../../../src/enums/index.js";
import { Color } from "../../../../src/core/colors/index.js";

describe("OutlineElement", () => {
  it("should initialize with default values", () => {
    const el = new OutlineElement();
    expect(el.type).toBe(PostProcessingEffectType.OUTLINE);
    expect(el.enabled).toBe(false);
    expect(el.thickness).toBe(1.0);
    expect(el.sensitivity).toBe(1.0);
    expect(el.color.r).toBe(0.0);
    expect(el.color.g).toBe(0.0);
    expect(el.color.b).toBe(0.0);
  });

  it("should allow customization of parameters", () => {
    const el = new OutlineElement();
    el.enabled = true;
    el.thickness = 2.0;
    el.sensitivity = 1.5;
    el.color = new Color(0.1, 0.1, 0.1);

    expect(el.enabled).toBe(true);
    expect(el.thickness).toBe(2.0);
    expect(el.sensitivity).toBe(1.5);
    expect(el.color.r).toBeCloseTo(0.1);
  });
});
