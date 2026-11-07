import { describe, expect, it } from "vitest";
import { Camera } from "../../src/core/cameras/Camera.js";
import { PerspectiveProjection, Vector3D } from "../../src/math/index.js";
import { CameraStrategyType } from "../../src/enums/index.js";

/**
 * @invariant CAM-TRANSITION-INVARIANCE: Strategiewechsel FPS ↔ Orbit-Follow (SMOOTH/STIFF) erhält
 *   die Blickrichtung (Skalarprodukt der Forward-Vektoren > 0, kein ~180°-Snap), wenn der
 *   aktuelle Look-Punkt durchgereicht wird, und erzeugt in KEINEM Fall eine Spiegelung: Die
 *   Determinante der View-Matrix bleibt strikt positiv (Rechtshändigkeit). Beim Eintritt in FPS
 *   re-deriviert der D3-Konvertierer die Theta/Phi aus der IST-Blickrichtung; beim Verlassen von
 *   FPS ist der Retain-Look-Point das dokumentierte Muster (FPS hat keinen Orbit-Anker).
 *   Deterministisches Sweep über Blickrichtungen (vitest-nativ, kein PBT).
 */

const viewDet = (cam: Camera): number => cam.viewMatrix4.determinant();

const forwardOf = (cam: Camera): Vector3D =>
  new Vector3D(
    cam.target.x - cam.position.x,
    cam.target.y - cam.position.y,
    cam.target.z - cam.position.z,
  ).normalize();

const dot = (a: Vector3D, b: Vector3D): number => a.x * b.x + a.y * b.y + a.z * b.z;

const VIEWS: [number, number][] = [
  [0.3, 0.2],
  [1.0, -0.2],
  [2.2, 0.05],
  [3.6, 0.3],
  [4.9, -0.3],
  [-1.4, -0.1],
  [5.6, 0.45],
];

const makeCam = (): Camera =>
  new Camera(new PerspectiveProjection({ fov: Math.PI / 3, aspect: 1.5, near: 0.1, far: 1000 }));

describe("CAM-TRANSITION-INVARIANCE (FPS <-> orbit follow, deterministic sweep)", () => {
  it.each(VIEWS)(
    "SMOOTH -> FPS: forward preserved (dot>0) and view stays right-handed (det>0), h=%s p=%s",
    (heading, pitch) => {
      const cam = makeCam();
      const target = new Vector3D(0, 0, 0);
      cam.setStrategy(CameraStrategyType.SMOOTH);
      cam.position.set(
        10 * Math.cos(pitch) * Math.sin(heading),
        10 * Math.sin(pitch),
        10 * Math.cos(pitch) * Math.cos(heading),
      );
      cam.update(target, 0, 0, 0);

      const fwdBefore = forwardOf(cam);
      const detBefore = viewDet(cam);

      cam.setStrategy(CameraStrategyType.FPS); // D3 explizite Zustandskonvertierung
      cam.update(cam.target.clone(), 0, 0, 0);

      expect(dot(fwdBefore, forwardOf(cam))).toBeGreaterThan(0);
      expect(viewDet(cam)).toBeGreaterThan(0);
      expect(Math.sign(viewDet(cam))).toBe(Math.sign(detBefore));
    },
  );

  it.each(VIEWS)(
    "FPS -> STIFF (retained look point): forward preserved (dot>0) and view stays right-handed, h=%s p=%s",
    (heading, pitch) => {
      const cam = makeCam();
      const target = new Vector3D(0, 0, 0);
      cam.setStrategy(CameraStrategyType.FPS);
      cam.position.set(
        10 * Math.cos(pitch) * Math.sin(heading),
        10 * Math.sin(pitch),
        10 * Math.cos(pitch) * Math.cos(heading),
      );
      cam.update(target, 0, 0, 0);

      const fwdBefore = forwardOf(cam);
      const detBefore = viewDet(cam);
      const retainedLook = cam.target.clone();

      cam.setStrategy(CameraStrategyType.STIFF);
      cam.update(retainedLook, 0, 0, 0); // dokumentiertes Muster: Look-Punkt wird durchgereicht

      expect(dot(fwdBefore, forwardOf(cam))).toBeGreaterThan(0);
      expect(viewDet(cam)).toBeGreaterThan(0);
      expect(Math.sign(viewDet(cam))).toBe(Math.sign(detBefore));
    },
  );

  it("never flips handedness (det(view) strictly positive) on any FPS<->orbit switch, even with a re-aimed target", () => {
    // Schwach aber echt: Auch wenn der Orbit-Target bewusst neu ausgerichtet wird (naives (0,0,0)),
    // darf der Wechsel KEINE Spiegelung der View erzeugen (det(M) > 0 für alle Strategiepfade).
    for (const [heading, pitch] of VIEWS) {
      const camA = makeCam();
      camA.setStrategy(CameraStrategyType.SMOOTH);
      camA.position.set(
        10 * Math.cos(pitch!) * Math.sin(heading!),
        10 * Math.sin(pitch!),
        10 * Math.cos(pitch!) * Math.cos(heading!),
      );
      camA.update(new Vector3D(0, 0, 0), 0, 0, 0);
      const detA = viewDet(camA);
      camA.setStrategy(CameraStrategyType.FPS);
      camA.update(camA.target, 0, 0, 0);
      expect(viewDet(camA)).toBeGreaterThan(0);
      expect(Math.sign(viewDet(camA))).toBe(Math.sign(detA));

      const camB = makeCam();
      camB.setStrategy(CameraStrategyType.FPS);
      camB.position.set(
        10 * Math.cos(pitch!) * Math.sin(heading!),
        10 * Math.sin(pitch!),
        10 * Math.cos(pitch!) * Math.cos(heading!),
      );
      camB.update(new Vector3D(0, 0, 0), 0, 0, 0);
      const detB = viewDet(camB);
      camB.setStrategy(CameraStrategyType.STIFF);
      camB.update(new Vector3D(0, 0, 0), 0, 0, 0);
      expect(viewDet(camB)).toBeGreaterThan(0);
      expect(Math.sign(viewDet(camB))).toBe(Math.sign(detB));
    }
  });
});
