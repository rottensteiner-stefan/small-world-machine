import { describe, expect, it } from "vitest";
import { OrthographicProjection, PerspectiveProjection } from "../../src/math/projections/index.js";
import { Vector3D, Matrix4 } from "../../src/math/index.js";
import { DirectionalLight } from "../../src/core/lights/DirectionalLight.js";
import { Camera } from "../../src/core/cameras/Camera.js";

describe("DirectionalLight.updateCascades", () => {
  it("updates cascades for an orthographic (ISOMETRIC) camera instead of early-returning", () => {
    const camera = new Camera(
      new OrthographicProjection({
        left: -25,
        right: 25,
        bottom: -25,
        top: 25,
        near: 0.1,
        far: 200,
      }),
    );
    camera.position.set(0, 50, 0);
    camera.target.set(0, 0, 0);

    const light = new DirectionalLight({
      direction: new Vector3D(0, -1, 0),
      numCascades: 4,
      castShadow: true,
    });

    light.updateCascades(camera);

    // The ortho branch must compute split distances spanning the real far plane; the old code
    // returned early here and left cascadeSplits untouched at their initial value of 0.
    expect(light.cascadeSplits[light.numCascades - 1]).toBeCloseTo(200, 5);

    // Cascade cameras must be refit to the ortho main frustum instead of staying frozen at the
    // constructor's default -10..10 origin box.
    const firstCascade = light.cascadeCameras[0]!.projection as OrthographicProjection;
    expect(firstCascade.right - firstCascade.left).toBeGreaterThan(0);
    expect(firstCascade.top - firstCascade.bottom).toBeGreaterThan(0);
  });
});

describe("DirectionalLight.updateCascades view-projection matrices", () => {
  // Regression: cascadeCam.updateViewMatrix() ran BEFORE the new orthographic bounds were applied
  // and updateProjectionMatrix() never rebuilt the cached view-projection matrix, so the matrix
  // used by both the shadow pass and the shader lookup always carried the PREVIOUS frame's bounds
  // (the constructor's -10..10 box on the very first frame).
  it("bakes the freshly fitted ortho bounds into every cascade's view-projection matrix", () => {
    const camera = new Camera(
      new PerspectiveProjection({ fov: Math.PI / 3, aspect: 1.5, near: 0.1, far: 120 }),
    );
    camera.position.set(3, 2, 8);
    camera.target.set(0, 1, 0);
    camera.updateViewMatrix();

    const light = new DirectionalLight({
      direction: new Vector3D(-0.45, -0.75, -0.45).normalize(),
      numCascades: 4,
      castShadow: true,
    });
    light.updateCascades(camera);

    const expected = new Matrix4();
    for (const cascade of light.cascadeCameras) {
      Matrix4.multiply(cascade.projection.getMatrix(), cascade.viewMatrix4, expected);
      const actual = cascade.viewProjectionMatrix;
      for (let i = 0; i < 16; i++) {
        expect(actual[i]).toBeCloseTo(expected.data[i]!, 4);
      }
    }
  });
});

describe("DirectionalLight per-cascade normal-offset bias (P3-E10 / DP-13, CsmC0Continuity anchor)", () => {
  function makeCam(): Camera {
    const camera = new Camera(
      new PerspectiveProjection({ fov: Math.PI / 3, aspect: 1.5, near: 0.1, far: 120 }),
    );
    camera.position.set(3, 2, 8);
    camera.target.set(0, 1, 0);
    camera.updateViewMatrix();
    return camera;
  }

  function makeBiasLight(shadowResolution: number): DirectionalLight {
    const light = new DirectionalLight({
      direction: new Vector3D(-0.45, -0.75, -0.45).normalize(),
      numCascades: 4,
      castShadow: true,
      shadowResolution,
    });
    light.updateCascades(makeCam());
    return light;
  }

  // C0-continuity anchor for the per-cascade bias curve (see the CSM-C0-CONTINUITY invariant
  // family in CsmC0Continuity.test.ts): the baked offsets must be positive, finite and
  // monotonically non-decreasing from the near cascade to the far cascade. A decreasing step at
  // a seam would invert the E10 intent (the near side of the seam under-bias, the far side
  // over-bias) and reintroduce a continuity break the golden baselines now pin down.
  it("bakes a positive, finite, monotonically non-decreasing bias per cascade (near < far)", () => {
    const biases = makeBiasLight(512).cascadeNormalBiases;
    expect(biases).toHaveLength(4);
    for (let i = 0; i < biases.length; i++) {
      expect(Number.isFinite(biases[i]!)).toBe(true);
      expect(biases[i]!).toBeGreaterThan(0);
      if (i > 0) expect(biases[i]!).toBeGreaterThanOrEqual(biases[i - 1]!);
    }
  });

  // The bias is derived from the cascade's own shadow-texel size (k * texel), not a constant:
  // identical geometry at double the shadow resolution halves every cascade's texel and must
  // therefore halve every baked bias exactly. This pins that the near/far cascade ratio is
  // texel-bound and meaningful, not an arbitrary author-set ramp.
  it("derives the bias from the cascade texel size: doubling the shadow resolution halves every cascade's bias", () => {
    const low = makeBiasLight(512).cascadeNormalBiases;
    const high = makeBiasLight(1024).cascadeNormalBiases;
    for (let i = 0; i < low.length; i++) {
      expect(low[i]! / high[i]!).toBeCloseTo(2, 6);
    }
  });

  // Fail-safe: lanes stay zero (no offset, no NaN) before a shadow-casting light ever runs
  // updateCascades or when shadows are off, so a partial state can never feed a bad bias into
  // the shader lane.
  it("keeps every cascade lane at zero before a shadow-casting light runs updateCascades", () => {
    const light = new DirectionalLight({ numCascades: 4, castShadow: false });
    expect(light.cascadeNormalBiases).toEqual([0, 0, 0, 0]);
    light.updateCascades(makeCam());
    expect(light.cascadeNormalBiases).toEqual([0, 0, 0, 0]);
  });
});
