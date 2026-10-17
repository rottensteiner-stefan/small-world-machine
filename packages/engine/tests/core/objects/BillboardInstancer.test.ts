import { describe, it, expect } from "vitest";
import {
  BillboardInstancer,
  Camera,
  Matrix4,
  PerspectiveProjection,
  Vector3D,
} from "../../../src/index.js";

function readRotationY(instancer: BillboardInstancer, i: number): number {
  const matrix = new Matrix4();
  matrix.data.set(instancer.mesh.instanceMatrices.subarray(i * 16, i * 16 + 16));
  const position = new Vector3D();
  const rotation = new Vector3D();
  const scale = new Vector3D();
  matrix.decompose(position, rotation, scale);
  return rotation.y;
}

function makeCamera(x: number, y: number, z: number): Camera {
  const camera = new Camera(new PerspectiveProjection());
  camera.position.set(x, y, z);
  return camera;
}

describe("BillboardInstancer", () => {
  it("sizes the instanced pool from explicit positions", () => {
    const instancer = new BillboardInstancer("Test", {
      positions: [new Vector3D(0, 0, 0), new Vector3D(1, 0, 0), new Vector3D(2, 0, 0)],
    });
    expect(instancer.mesh.instanceCount).toBe(3);
  });

  it("sizes the instanced pool from `count` when scattering", () => {
    const instancer = new BillboardInstancer("Test", {
      count: 42,
      scatterArea: { width: 10, depth: 10 },
    });
    expect(instancer.mesh.instanceCount).toBe(42);
  });

  it("defaults to a pool of 300 particles", () => {
    const instancer = new BillboardInstancer("Test", { scatterArea: { width: 5, depth: 5 } });
    expect(instancer.mesh.instanceCount).toBe(300);
  });

  it("axis-locked: faces the camera around Y only, yaw 0 when the camera is along +Z", () => {
    const instancer = new BillboardInstancer("Test", {
      positions: [new Vector3D(0, 0, 0)],
      axisLocked: true,
    });
    instancer.update(makeCamera(0, 0, 5));
    expect(readRotationY(instancer, 0)).toBeCloseTo(0, 5);
  });

  it("axis-locked: yaws toward the camera when it's off to the side", () => {
    const instancer = new BillboardInstancer("Test", {
      positions: [new Vector3D(0, 0, 0)],
      axisLocked: true,
    });
    instancer.update(makeCamera(5, 0, 0));
    expect(readRotationY(instancer, 0)).toBeCloseTo(Math.PI / 2, 5);
  });

  it("spherical: faces the camera with the same yaw as axis-locked when the camera is along +Z", () => {
    const instancer = new BillboardInstancer("Test", {
      positions: [new Vector3D(0, 0, 0)],
      axisLocked: false,
    });
    instancer.update(makeCamera(0, 0, 5));
    expect(readRotationY(instancer, 0)).toBeCloseTo(0, 5);
  });

  it("spherical: yaws toward the camera when it's off to the side, matching axis-locked", () => {
    const instancer = new BillboardInstancer("Test", {
      positions: [new Vector3D(0, 0, 0)],
      axisLocked: false,
    });
    instancer.update(makeCamera(5, 0, 0));
    expect(readRotationY(instancer, 0)).toBeCloseTo(Math.PI / 2, 5);
  });

  it("flags instanceMatrixNeedsUpdate after every update()", () => {
    const instancer = new BillboardInstancer("Test", {
      positions: [new Vector3D(0, 0, 0), new Vector3D(1, 0, 0)],
    });
    instancer.mesh.instanceMatrixNeedsUpdate = false;
    instancer.update(makeCamera(0, 0, 5));
    expect(instancer.mesh.instanceMatrixNeedsUpdate).toBe(true);
  });

  it("scatters the same field for the same seed and a different one for another seed", () => {
    const scatter = (seed: number | undefined): Float32Array => {
      const instancer = new BillboardInstancer("Seeded", {
        count: 16,
        scatterArea: { width: 10, depth: 10 },
        ...(seed !== undefined && { seed }),
      });
      instancer.update(makeCamera(0, 0, 5));
      return instancer.mesh.instanceMatrices.slice();
    };
    expect(scatter(7)).toEqual(scatter(7));
    expect(scatter(7)).not.toEqual(scatter(8));
    expect(scatter(undefined)).not.toEqual(scatter(undefined));
  });
});
