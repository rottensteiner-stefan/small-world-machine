import { PointLight } from "../../src/core/lights/PointLight.js";
import { MAX_CLUSTERED_LIGHTS_PER_TYPE } from "../../src/core/lights/AbstractLight.js";
import { LightDataInterface } from "../../src/interfaces/index.js";
import { Color } from "../../src/core/colors/index.js";
import { Vector3D } from "../../src/math/index.js";

function makeEmptyLightData(): LightDataInterface {
  return {
    aCol: new Color(0, 0, 0),
    aIntensity: 0,
    dDir: new Vector3D(0, -1, 0),
    dCol: new Color(0, 0, 0),
    dIntensity: 0,
    pLights: [],
    sLights: [],
    aLights: [],
  };
}

describe("PointLight", () => {
  it("contributes to volumetric fog at full strength by default and honours the option", () => {
    expect(new PointLight().volumetricIntensity).toBe(1);
    expect(new PointLight({ volumetricIntensity: 0 }).volumetricIntensity).toBe(0);
  });

  it("initializes with default distance/decay", () => {
    const light = new PointLight();
    expect(light.distance).toBeCloseTo(50.0);
    expect(light.decay).toBeCloseTo(2.0);
  });

  it("pushes itself into the scene-wide light list", () => {
    const light = new PointLight();
    const data = makeEmptyLightData();
    light.applyTo(data);
    expect(data.pLights).toEqual([light]);
  });

  it(`caps the scene-wide list at ${MAX_CLUSTERED_LIGHTS_PER_TYPE}`, () => {
    const data = makeEmptyLightData();
    for (let i = 0; i < MAX_CLUSTERED_LIGHTS_PER_TYPE + 1; i++) {
      new PointLight().applyTo(data);
    }
    expect(data.pLights.length).toBe(MAX_CLUSTERED_LIGHTS_PER_TYPE);
  });
});
