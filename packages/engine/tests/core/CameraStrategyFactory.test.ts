import { describe, it, expect } from "vitest";
import { CameraStrategyFactory } from "../../src/core/cameras/CameraStrategyFactory.js";
import { CameraStrategyType } from "../../src/enums/CameraStrategyType.js";
import { Camera } from "../../src/core/cameras/Camera.js";
import { PerspectiveProjection, Vector3D } from "../../src/math/index.js";

describe("CameraStrategyFactory", () => {
  it("creates independent strategy instances on each call (no singleton leak)", () => {
    const types = [
      CameraStrategyType.MANUAL,
      CameraStrategyType.HYBRID_SYNC,
      CameraStrategyType.FPS,
      CameraStrategyType.SMOOTH,
      CameraStrategyType.STIFF,
      CameraStrategyType.FIXED,
      CameraStrategyType.ISOMETRIC,
    ];

    for (const type of types) {
      const s1 = CameraStrategyFactory.get(type);
      const s2 = CameraStrategyFactory.get(type);
      expect(s1).toBeDefined();
      expect(s2).toBeDefined();
      expect(s1).not.toBe(s2);
    }
  });

  it("multiple cameras using the same strategy type maintain isolated state", () => {
    const camA = new Camera(new PerspectiveProjection());
    const camB = new Camera(new PerspectiveProjection());

    camA.setStrategy(CameraStrategyType.STIFF);
    camB.setStrategy(CameraStrategyType.STIFF);

    expect(camA.strategy).not.toBe(camB.strategy);

    // Mutating constraints on camA should not mutate camB
    camA.setConstraints({ min: new Vector3D(10, 10, 10), max: new Vector3D(20, 20, 20) });
    camB.setConstraints({ min: new Vector3D(100, 100, 100), max: new Vector3D(200, 200, 200) });

    expect(camA.strategy.constraints?.min?.x).toBe(10);
    expect(camB.strategy.constraints?.min?.x).toBe(100);
  });
});
