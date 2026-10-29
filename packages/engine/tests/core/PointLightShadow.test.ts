import { describe, expect, it } from "vitest";
import { PointLight } from "../../src/core/lights/PointLight.js";
import {
  CUBE_FACE_COUNT,
  POINT_SHADOW_NEAR,
  SHADOW_ARRAY_LAYERS,
  cubeFaceForDirection,
  pointShadowLayer,
  selectShadowedPointLights,
  writePointShadowFaceMatrices,
} from "../../src/core/lights/PointLightShadow.js";
import { Vector3D } from "../../src/math/index.js";

const AXES: Array<[number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function project(m: Float32Array, offset: number, p: [number, number, number]): number[] {
  const out = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) {
    out[r] =
      m[offset + r]! * p[0] +
      m[offset + 4 + r]! * p[1] +
      m[offset + 8 + r]! * p[2] +
      m[offset + 12 + r]!;
  }
  return out;
}

describe("PointLightShadow layout", () => {
  it("places the faces of two lights after the four spot layers", () => {
    expect(pointShadowLayer(0, 0)).toBe(4);
    expect(pointShadowLayer(1, 5)).toBe(15);
    expect(SHADOW_ARRAY_LAYERS).toBe(16);
  });

  it("picks the major axis, ties resolved X before Y before Z", () => {
    AXES.forEach((a, face) => expect(cubeFaceForDirection(a[0], a[1], a[2])).toBe(face));
    expect(cubeFaceForDirection(1, 1, 1)).toBe(0);
    expect(cubeFaceForDirection(0, -1, 1)).toBe(3);
    expect(cubeFaceForDirection(0.2, 0.1, -0.9)).toBe(5);
  });
});

describe("writePointShadowFaceMatrices", () => {
  const light = new Vector3D(2, 1, -3);
  const m = new Float32Array(CUBE_FACE_COUNT * 16);
  writePointShadowFaceMatrices(light, 8, m);

  it("maps each face axis to the centre of that face and inside the depth range", () => {
    AXES.forEach((a, face) => {
      const p: [number, number, number] = [
        light.x + a[0] * 4,
        light.y + a[1] * 4,
        light.z + a[2] * 4,
      ];
      const [x, y, z, w] = project(m, face * 16, p);
      expect(w).toBeGreaterThan(0);
      expect(x! / w!).toBeCloseTo(0, 5);
      expect(y! / w!).toBeCloseTo(0, 5);
      expect(Math.abs(z! / w!)).toBeLessThan(1);
    });
  });

  it("covers a 90° cone: the face corner direction lands on the clip border", () => {
    const [x, , , w] = project(m, 0, [light.x + 1, light.y, light.z + 1]);
    expect(Math.abs(x! / w!)).toBeCloseTo(1, 5);
  });

  it("clips at the light range and the fixed near plane", () => {
    const [, , zFar, wFar] = project(m, 0, [light.x + 8, light.y, light.z]);
    const [, , zNear, wNear] = project(m, 0, [light.x + POINT_SHADOW_NEAR, light.y, light.z]);
    expect(zFar! / wFar!).toBeCloseTo(1, 4);
    expect(zNear! / wNear!).toBeCloseTo(-1, 4);
  });
});

describe("selectShadowedPointLights", () => {
  function light(x: number, z: number, castShadow = true, distance = 8): PointLight {
    const l = new PointLight({ distance });
    l.castShadow = castShadow;
    l.position.set(x, 1, z);
    l.updateMatrixWorld(true);
    return l;
  }
  const camera = new Vector3D(0, 1, 0);
  const forward = new Vector3D(0, 0, -1);
  const out = new Int32Array(2);

  it("chooses only casters, nearest first", () => {
    const lights = [light(0, -20), light(0, -2, false), light(0, -5), light(0, -9)];
    expect(selectShadowedPointLights(lights, camera, forward, 2, out)).toBe(2);
    expect([out[0], out[1]]).toEqual([2, 3]);
  });

  it("ranks a light whose whole range is behind the camera last", () => {
    const lights = [light(0, 10), light(0, -12)];
    expect(selectShadowedPointLights(lights, camera, forward, 1, out)).toBe(1);
    expect(out[0]).toBe(1);
  });

  it("respects a smaller tier budget and returns 0 without casters", () => {
    expect(selectShadowedPointLights([light(0, -3), light(0, -4)], camera, forward, 1, out)).toBe(
      1,
    );
    expect(selectShadowedPointLights([light(0, -3, false)], camera, forward, 2, out)).toBe(0);
  });
});
