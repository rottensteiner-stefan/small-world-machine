import { SpotLight } from "../../src/core/lights/SpotLight.js";
import { MAX_CLUSTERED_LIGHTS_PER_TYPE } from "../../src/core/lights/AbstractLight.js";
import type { PerspectiveProjection } from "../../src/math/index.js";
import { Vector3D } from "../../src/math/index.js";
import type { LightDataInterface } from "../../src/interfaces/index.js";
import { Color } from "../../src/core/colors/index.js";

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

describe("SpotLight", () => {
  it("should initialize with default properties", () => {
    const light = new SpotLight();
    expect(light.castShadow).toBe(false);
    expect(light.shadowCamera).toBeUndefined();
  });

  it("should initialize shadowCamera if castShadow is true", () => {
    const light = new SpotLight({ castShadow: true, angle: Math.PI / 4, distance: 100 });
    expect(light.shadowCamera).toBeDefined();

    const proj = light.shadowCamera!.projection as PerspectiveProjection;
    // FOV should be double the angle
    expect(proj.fov).toBeCloseTo((Math.PI / 4) * 2.0);
    expect(proj.far).toBeCloseTo(100);
  });

  it("should update shadowCamera position and target correctly", () => {
    const light = new SpotLight({ castShadow: true });

    // Set position and update its world matrix
    light.setPosition(10, 20, 30);
    light.direction.set(0, -1, 0);
    light.updateMatrixWorld();

    // Explicitly update shadow camera
    light.updateShadowCamera();

    const cam = light.shadowCamera!;
    expect(cam.position.x).toBeCloseTo(10);
    expect(cam.position.y).toBeCloseTo(20);
    expect(cam.position.z).toBeCloseTo(30);

    // Target should be position + direction
    expect(cam.target.x).toBeCloseTo(10);
    expect(cam.target.y).toBeCloseTo(19); // 20 - 1
    expect(cam.target.z).toBeCloseTo(30);
  });

  it("should adjust up vector if pointing straight down", () => {
    const light = new SpotLight({ castShadow: true });
    light.direction.set(0, -1, 0); // Pointing straight down
    light.updateMatrixWorld();
    light.updateShadowCamera();

    const cam = light.shadowCamera!;
    expect(cam.up.x).toBeCloseTo(0);
    expect(cam.up.y).toBeCloseTo(0);
    expect(cam.up.z).toBeCloseTo(-1);
  });

  it("should use standard up vector if not pointing straight down", () => {
    const light = new SpotLight({ castShadow: true });
    light.direction.set(1, -0.5, 0).normalize();
    light.updateMatrixWorld();
    light.updateShadowCamera();

    const cam = light.shadowCamera!;
    expect(cam.up.x).toBeCloseTo(0);
    expect(cam.up.y).toBeCloseTo(1);
    expect(cam.up.z).toBeCloseTo(0);
  });

  it("pushes itself into the scene-wide light list", () => {
    const light = new SpotLight();
    const data = makeEmptyLightData();
    light.applyTo(data);
    expect(data.sLights).toEqual([light]);
  });

  it(`caps the scene-wide list at ${MAX_CLUSTERED_LIGHTS_PER_TYPE}`, () => {
    const data = makeEmptyLightData();
    for (let i = 0; i < MAX_CLUSTERED_LIGHTS_PER_TYPE + 1; i++) {
      new SpotLight().applyTo(data);
    }
    expect(data.sLights.length).toBe(MAX_CLUSTERED_LIGHTS_PER_TYPE);
  });
});
