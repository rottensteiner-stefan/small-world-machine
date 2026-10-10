import { RainbowBehavior } from "../../../src/core/behaviors/RainbowBehavior.js";
import { Object3D } from "../../../src/core/Object3D.js";
import { StandardMaterial } from "../../../src/core/materials/surface/StandardMaterial.js";
import { PointLight } from "../../../src/core/lights/PointLight.js";
import { Color } from "../../../src/core/colors/Color.js";

describe("RainbowBehavior", () => {
  it("should shift the color through the full 360 degree HSL spectrum for Object3D materials", () => {
    const target = new Object3D("testTarget");
    target.material = new StandardMaterial({ color: new Color(0, 0, 0) });

    // Speed is 1.0 loops per second
    const behavior = new RainbowBehavior(1.0);
    behavior.onAttach(target);

    // Update by 0.5 seconds -> hue should be 0.5 * 360 = 180 (Cyan)
    behavior.update(0.5);

    // Check if color is Cyan (R=0, G=1, B=1)
    const material = target.material as StandardMaterial;
    expect(material.color.r).toBeCloseTo(0, 1);
    expect(material.color.g).toBeCloseTo(1, 1);
    expect(material.color.b).toBeCloseTo(1, 1);

    // Update by another 0.5 seconds -> hue should be 1.0 * 360 = 360/0 (Red)
    behavior.update(0.5);
    expect(material.color.r).toBeCloseTo(1, 1);
    expect(material.color.g).toBeCloseTo(0, 1);
    expect(material.color.b).toBeCloseTo(0, 1);
  });

  it("should shift the color through the full 360 degree HSL spectrum for Lights", () => {
    const light = new PointLight();
    light.color = new Color(0, 0, 0);

    const behavior = new RainbowBehavior(0.25);
    behavior.onAttach(light);

    // Update by 1.0 seconds at speed 0.25 -> hue is 0.25 * 360 = 90 (Yellow-Green)
    behavior.update(1.0);

    // HSL(90, 1, 0.5) is R=0.5, G=1, B=0
    expect(light.color.r).toBeCloseTo(0.5, 1);
    expect(light.color.g).toBeCloseTo(1.0, 1);
    expect(light.color.b).toBeCloseTo(0.0, 1);
  });
});
