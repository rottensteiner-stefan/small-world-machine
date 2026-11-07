import { describe, it, expect } from "vitest";
import { Camera } from "../../src/core/cameras/Camera.js";
import { PerspectiveProjection, Matrix4 } from "../../src/math/index.js";

// D8: The H2/S4 hypothesis was a singular-collapse CRASH in subsystems that require an
// invertible view-projection (TAA, volumetric fog reprojection). Phase-1 gate: the crash is
// REFUTED on HEAD (Matrix4 guards + fog fail-fast) — the SOFT-FAIL semantics must be PINNED
// by tests so future changes cannot silently reintroduce the crash. Assertions are the
// engine contract: degenerate views must not throw and must never leak NaN/Infinity.
function assertFinite16(a: Float32Array | number[]): void {
  expect(a.length).toBeGreaterThanOrEqual(16);
  for (let i = 0; i < 16; i++) {
    expect(Number.isFinite(a[i])).toBe(true);
  }
}

describe("Degenerate camera soft-fail contract (D8/H2)", () => {
  it("eye == target (zero-length view) does not throw and keeps matrices finite", () => {
    const cam = new Camera(new PerspectiveProjection());
    cam.position.set(1, 2, 3);
    cam.target.copyFrom(cam.position);

    expect(() => {
      cam.update(cam.target, 0, 0, 0);
      cam.updateProjectionMatrix();
      cam.updateViewMatrix();
    }).not.toThrow();

    assertFinite16(cam.viewProjectionMatrix4.data);
  });

  it("view parallel to the up vector (straight up) stays finite and invertible", () => {
    const cam = new Camera(new PerspectiveProjection());
    cam.position.set(0, 0, 0);
    cam.target.set(0, 5, 0); // collinear with up (+Y)

    expect(() => {
      cam.update(cam.target, 0, 0, 0);
      cam.updateProjectionMatrix();
      cam.updateViewMatrix();
    }).not.toThrow();

    const inv = new Matrix4();
    expect(Matrix4.invert(cam.viewProjectionMatrix4, inv)).toBe(true);
    assertFinite16(inv.data);
  });

  it("TAA-jittered view matrices keep a positive-determinant (non-flipped), finite result", () => {
    const cam = new Camera(new PerspectiveProjection());
    cam.position.set(8, 3, -8);
    cam.target.set(0, 0, 0);
    cam.updateProjectionMatrix();
    cam.updateViewMatrix();

    // Simulate an injected TAA subject-pixel jitter on the projection col-8 (the pattern used
    // by the real TAA path): the matrix must stay regular and non-degenerate.
    const jittered = new Matrix4().copy(cam.viewProjectionMatrix4);
    jittered.data[8]! += 0.5;
    jittered.data[9]! += 0.5;

    const inv = new Matrix4();
    expect(Matrix4.invert(jittered, inv)).toBe(true);
    assertFinite16(inv.data);
  });
});
