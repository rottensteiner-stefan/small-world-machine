import { describe, it, expect } from "vitest";
import { Color } from "../../src/core/colors/Color.js";
import { StandardMaterial } from "../../src/core/materials/surface/StandardMaterial.js";
import { PhongMaterial } from "../../src/core/materials/surface/PhongMaterial.js";
import { LambertMaterial } from "../../src/core/materials/surface/LambertMaterial.js";
import { TerrainMaterial } from "../../src/core/materials/TerrainMaterial.js";
import { SkyboxMaterial } from "../../src/core/materials/SkyboxMaterial.js";
import { WireframeMaterial } from "../../src/core/materials/WireframeMaterial.js";
import { PointLight } from "../../src/core/lights/PointLight.js";
import { SpotLight } from "../../src/core/lights/SpotLight.js";
import { DirectionalLight } from "../../src/core/lights/DirectionalLight.js";
import { AmbientLight } from "../../src/core/lights/AmbientLight.js";
import { AreaLight } from "../../src/core/lights/AreaLight.js";
import { OutlineElement } from "../../src/renderers/post/elements/OutlineElement.js";
import { Object3D } from "../../src/core/Object3D.js";
import { RainbowBehavior } from "../../src/core/behaviors/RainbowBehavior.js";

describe("Color Mutability and Non-Frozen Defaults", () => {
  it("materials and lights should have mutable default colors", () => {
    const instances = [
      new StandardMaterial(),
      new PhongMaterial(),
      new LambertMaterial(),
      new TerrainMaterial(),
      new SkyboxMaterial(),
      new WireframeMaterial(),
      new PointLight(),
      new SpotLight(),
      new DirectionalLight(),
      new AmbientLight(),
      new AreaLight(),
      new OutlineElement(),
    ];

    for (const inst of instances) {
      expect(Object.isFrozen(inst.color)).toBe(false);
      expect(() => {
        inst.color.r = 0.5;
        inst.color.copyFrom(new Color(0.2, 0.3, 0.4));
      }).not.toThrow();
      expect(inst.color.r).toBeCloseTo(0.2);
    }

    const phong = new PhongMaterial();
    expect(Object.isFrozen(phong.specularColor)).toBe(false);
    expect(() => {
      phong.specularColor.g = 0.7;
    }).not.toThrow();
  });

  it("should clone frozen Color constants when passed in constructor options", () => {
    const mat = new StandardMaterial({ color: Color.WHITE });
    expect(Object.isFrozen(mat.color)).toBe(false);
    expect(mat.color).not.toBe(Color.WHITE);
    expect(() => {
      mat.color.r = 0.123;
    }).not.toThrow();
    expect(mat.color.r).toBeCloseTo(0.123);
    expect(Color.WHITE.r).toBe(1.0); // Constant remains untouched
  });

  it("RainbowBehavior updates default materials and lights without throwing", () => {
    const obj = new Object3D("test");
    obj.material = new StandardMaterial();
    const behavior = new RainbowBehavior(1.0);
    behavior.target = obj;
    expect(() => behavior.update(0.1)).not.toThrow();

    const light = new PointLight();
    behavior.target = light;
    expect(() => behavior.update(0.1)).not.toThrow();
  });
});
