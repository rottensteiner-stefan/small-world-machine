import { PointLight } from "../../src/core/lights/PointLight.js";
import { MAX_CLUSTERED_LIGHTS_PER_TYPE } from "../../src/core/lights/AbstractLight.js";
import type { LightDataInterface } from "../../src/interfaces/index.js";
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
