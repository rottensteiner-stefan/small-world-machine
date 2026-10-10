import { describe, it, expect, vi, beforeEach } from "vitest";
import { AxesHelper } from "../../../src/core/helpers/AxesHelper.js";
import { Color } from "../../../src/core/colors/Color.js";
import { BasicMaterial } from "../../../src/core/materials/surface/BasicMaterial.js";
import { SpriteMaterial } from "../../../src/core/materials/SpriteMaterial.js";
import { Sprite } from "../../../src/core/sprites/Sprite.js";

// Mock Canvas API for TextTexture
const mockMeasureText = vi.fn().mockReturnValue({ width: 50 });
const mockGetContext = vi.fn().mockReturnValue({
  measureText: mockMeasureText,
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  fillText: vi.fn(),
  strokeText: vi.fn(),
  createLinearGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
});

describe("AxesHelper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("document", {
      createElement: vi.fn().mockImplementation((tag) => {
        if (tag === "canvas") {
          return {
            getContext: mockGetContext,
            width: 0,
            height: 0,
          };
        }
        return {};
      }),
      fonts: {
        add: vi.fn(),
      },
    });
  });

  it("constructs with default options and 3 axes", () => {
    const helper = new AxesHelper();
    expect(helper.name).toBe("AxesHelper");
    expect(helper.size).toBe(1.0);
    expect(helper.children.length).toBe(3);

    expect(helper.xAxis.name).toBe("Axis_X");
    expect(helper.yAxis.name).toBe("Axis_Y");
    expect(helper.zAxis.name).toBe("Axis_Z");
  });

  it("contains shafts and arrow heads with correct neon colors", () => {
    const helper = new AxesHelper();

    // Check X Axis material
    const xShaft = helper.xAxis.getObjectByName("Shaft_X");
    expect(xShaft).toBeDefined();
    expect(xShaft?.material).toBeInstanceOf(BasicMaterial);
    const xMat = xShaft?.material as BasicMaterial;
    expect(xMat.color.r).toBeCloseTo(1.0);
    expect(xMat.color.g).toBeCloseTo(0.09);
    expect(xMat.color.b).toBeCloseTo(0.27);

    // Check Y Axis material
    const yShaft = helper.yAxis.getObjectByName("Shaft_Y");
    expect(yShaft).toBeDefined();
    expect(yShaft?.material).toBeInstanceOf(BasicMaterial);
    const yMat = yShaft?.material as BasicMaterial;
    expect(yMat.color.r).toBeCloseTo(0.0);
    expect(yMat.color.g).toBeCloseTo(0.9);
    expect(yMat.color.b).toBeCloseTo(0.46);

    // Check Z Axis material
    const zShaft = helper.zAxis.getObjectByName("Shaft_Z");
    expect(zShaft).toBeDefined();
    expect(zShaft?.material).toBeInstanceOf(BasicMaterial);
    const zMat = zShaft?.material as BasicMaterial;
    expect(zMat.color.r).toBeCloseTo(0.0);
    expect(zMat.color.g).toBeCloseTo(0.9);
    expect(zMat.color.b).toBeCloseTo(1.0);
  });

  it("creates billboard text labels X, Y, Z when showLabels is true", () => {
    const helper = new AxesHelper({ showLabels: true });
    expect(helper.xLabel).toBeInstanceOf(Sprite);
    expect(helper.yLabel).toBeInstanceOf(Sprite);
    expect(helper.zLabel).toBeInstanceOf(Sprite);

    expect(helper.xLabel?.name).toBe("Label_X");
    expect(helper.yLabel?.name).toBe("Label_Y");
    expect(helper.zLabel?.name).toBe("Label_Z");

    expect(helper.xLabel?.material).toBeInstanceOf(SpriteMaterial);
  });

  it("does not create labels when showLabels is false", () => {
    const helper = new AxesHelper({ showLabels: false });
    expect(helper.xLabel).toBeUndefined();
    expect(helper.yLabel).toBeUndefined();
    expect(helper.zLabel).toBeUndefined();
  });

  it("supports custom size and colors", () => {
    const helper = new AxesHelper({
      size: 5.0,
      xColor: new Color(1, 0, 0),
      yColor: new Color(0, 1, 0),
      zColor: new Color(0, 0, 1),
    });

    expect(helper.size).toBe(5.0);
    const xMat = helper.xAxis.getObjectByName("Shaft_X")?.material as BasicMaterial;
    expect(xMat.color.r).toBe(1);
    expect(xMat.color.g).toBe(0);
    expect(xMat.color.b).toBe(0);
  });
});
