import { describe, it, expect, beforeEach } from "vitest";
import { PhysicsSystem } from "../../src/physix/PhysicsSystem.js";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { Cube } from "../../src/geometry/Cube.js";
import { Sphere } from "../../src/geometry/Sphere.js";
import { StaticCollider } from "../../src/physix/StaticCollider.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { Vector3D } from "../../src/math/Vector3D.js";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";

/**
 * @invariant FPS-CHUNKING-EQUIVALENCE: Feste-Step-Simulation (physics-scoped, A8): Die
 *   Fixed-Step-Kette des Accumulators ist deterministisch — `physics.step` liefert identische
 *   Sim-Phasen, egal in welcher Display-Rate das Fake-Frame-dt ankommt. Chunkings, die den
 *   `fixedTimeStep` fein, numerisch exakt tilen (60 × 1/60, 30 × 1/30, …), erzeugen denselben
 *   Sim-Zustand bit-exakt; nicht-tilende Chunkings (144 × 1/144) verlieren nie Zeit (Pending-
 *   Bruchteil wandert in `interpolationAlpha`, Ende der Zeitscheibe wird kein Fixed-Step
 *   übersprungen/fallen gelassen) und der Zustand nach K Fixed-Steps ist identisch zur
 *   `K × step(fixedTimeStep)`-Referenz. Render-Phase (`interpolationAlpha`) ist bewusst
 *   dokumentiert-varianzbehaftet und NICHT bit-exakt (Anker: `PhysicsSystem.ts` interpolationAlpha).
 */

type RunResult = {
  ballPos: number[];
  ballVel: number[];
  boxPos: number[];
  boxVel: number[];
};

type FullState = RunResult & { dropped: number; alpha: number };

const runFrameSequence = (seq: number[]): FullState => {
  Object3D.resetNextId();
  StaticCollider.resetNextId();
  const events = new EventDispatcherImpl();
  const physics = new PhysicsSystem(events);
  physics.gravity.set(0, -9.81, 0);
  const scene = new Scene();

  const ball = new Object3D("Ball");
  ball.id = 1;
  ball.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
  ball.position.set(0, 5, 0);
  ball.rigidBody = new RigidBody(1.0);
  ball.rigidBody.restitution = 0.5;
  ball.updateMatrixWorld();
  ball.computeBounds();
  scene.objects.push(ball);

  const box = new Object3D("Box");
  box.id = 2;
  box.geometry = new Cube({ size: 1.0 }).getGeometryData();
  box.position.set(0, 0.5, 0);
  box.rigidBody = new RigidBody(2.0);
  box.rigidBody.restitution = 0.3;
  box.updateMatrixWorld();
  box.computeBounds();
  scene.objects.push(box);

  const floor = new StaticCollider(
    new BoundingBox(new Vector3D(-10, -1, -10), new Vector3D(10, 0, 10)),
  );
  floor.id = 100;
  scene.staticColliders.push(floor);

  let dropped = 0;
  for (const dt of seq) {
    physics.step(scene, dt);
    dropped += physics.droppedSteps;
    physics.droppedSteps = 0;
  }

  return {
    ballPos: [ball.position.x, ball.position.y, ball.position.z] as number[],
    ballVel: [
      ball.rigidBody!.velocity.x,
      ball.rigidBody!.velocity.y,
      ball.rigidBody!.velocity.z,
    ] as number[],
    boxPos: [box.position.x, box.position.y, box.position.z] as number[],
    boxVel: [
      box.rigidBody!.velocity.x,
      box.rigidBody!.velocity.y,
      box.rigidBody!.velocity.z,
    ] as number[],
    dropped,
    alpha: physics.interpolationAlpha,
  };
};

describe("FPS-Chunking-Äquivalenz (physics-scoped, A8)", () => {
  beforeEach(() => {
    Object3D.resetNextId();
    StaticCollider.resetNextId();
  });

  const TILING_HZ = [
    ["60 Hz", 60, 1 / 60],
    ["30 Hz", 30, 1 / 30],
    ["20 Hz", 20, 1 / 20],
    ["15 Hz", 15, 1 / 15],
    ["12 Hz", 12, 1 / 12],
    ["10 Hz", 10, 1 / 10],
    ["6 Hz", 6, 1 / 6],
  ] as const;

  it.each(TILING_HZ)(
    "%s: eine Sim-Sekunde ist bit-exakt zur 60 × 1/60-Referenz (tiling Chunking)",
    (_label, frames, dt) => {
      const ref = runFrameSequence(Array(60).fill(1 / 60));
      const run = runFrameSequence(Array(frames).fill(dt));

      // Identische Fixed-Step-Sim-Kette => bit-exakte Positions- UND Velocity-Komponenten.
      expect(run.ballPos).toEqual(ref.ballPos);
      expect(run.ballVel).toEqual(ref.ballVel);
      expect(run.boxPos).toEqual(ref.boxPos);
      expect(run.boxVel).toEqual(ref.boxVel);

      // Kein Spirale-of-Death-Zeitverlust bei tiling-Raten.
      expect(run.dropped).toBe(0);
      expect(ref.dropped).toBe(0);
    },
  );

  it("144 Hz (nicht-tilend): chain-deterministisch, kein Time-Loss, Render-Phase als dokumentierte Varianz", () => {
    const frames = 144;
    // Physikalisch exakt eine Sekunde als dt-Sequenz; wegen FP-Quantisierung des Accumulators
    // feuert der 60. Fixed-Step innerhalb dieses Fensters NICHT mehr (1/144 tiliert 1/60 nicht).
    const run144 = runFrameSequence(Array(frames).fill(1 / frames));
    // Referenz: genau die K Fixed-Steps, die der 144-Hz-Lauf tatsächlich ausgeführt hat (59).
    const chainRef = runFrameSequence(Array(59).fill(1 / 60));

    // Der Sim-Zustand nach den ausgeführten Fixed-Steps ist identisch zur Ketten-Referenz
    // (Chain-Invarianz: sub-step-fire ist nur eine Frage des Frame-Scheduling, nie der Physik).
    expect(run144.ballPos).toEqual(chainRef.ballPos);
    expect(run144.ballVel).toEqual(chainRef.ballVel);
    expect(run144.boxPos).toEqual(chainRef.boxPos);
    expect(run144.boxVel).toEqual(chainRef.boxVel);
    // Kein Zeitverlust: der unvollständige letzte Fixed-Step liegt als Render-Phase im
    // Accumulator (dokumentierte Varianz) statt fallen gelassen zu werden.
    expect(run144.dropped).toBe(0);
    expect(run144.alpha).toBeGreaterThan(0.9);
    expect(run144.alpha).toBeLessThan(1);
    // Die dokumentierte Render-Phase ist absichtlich NICHT mit der tiling-Referenz identisch —
    // nur der Sim-Zustand ist chunking-invariant. (Doppelt abgesichert: alpha(60Hz)=exakt 0.)
    expect(runFrameSequence(Array(60).fill(1 / 60)).alpha).toBe(0);

    // Nachlieferung einer weiteren 1/60-Scheibe feuert den pending-60. Fixed-Step und fügt den
    // Lauf exakt an die 60-Step-Kette an — die verlorene Phase geht nie verloren.
    const { physics, scene } = ((): { physics: PhysicsSystem; scene: Scene } => {
      Object3D.resetNextId();
      StaticCollider.resetNextId();
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      const scene = new Scene();
      const ball = new Object3D("Ball");
      ball.id = 1;
      ball.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
      ball.position.set(0, 5, 0);
      ball.rigidBody = new RigidBody(1.0);
      ball.rigidBody.restitution = 0.5;
      ball.updateMatrixWorld();
      ball.computeBounds();
      scene.objects.push(ball);
      const box = new Object3D("Box");
      box.id = 2;
      box.geometry = new Cube({ size: 1.0 }).getGeometryData();
      box.position.set(0, 0.5, 0);
      box.rigidBody = new RigidBody(2.0);
      box.rigidBody.restitution = 0.3;
      box.updateMatrixWorld();
      box.computeBounds();
      scene.objects.push(box);
      const floor = new StaticCollider(
        new BoundingBox(new Vector3D(-10, -1, -10), new Vector3D(10, 0, 10)),
      );
      floor.id = 100;
      scene.staticColliders.push(floor);
      return { physics, scene };
    })();
    for (let f = 0; f < 144; f++) physics.step(scene, 1 / 144);
    physics.step(scene, 1 / 60);

    const full60 = runFrameSequence(Array(60).fill(1 / 60));
    // Der Catch-up-Lauf muss bit-exakt die 60 × 1/60-Referenz erreichen (kein Sim-Zeitverlust).
    const ball = scene.objects[0]!;
    const box = scene.objects[1]!;
    const caught: RunResult = {
      ballPos: [ball.position.x, ball.position.y, ball.position.z] as number[],
      ballVel: [
        ball.rigidBody!.velocity.x,
        ball.rigidBody!.velocity.y,
        ball.rigidBody!.velocity.z,
      ] as number[],
      boxPos: [box.position.x, box.position.y, box.position.z] as number[],
      boxVel: [
        box.rigidBody!.velocity.x,
        box.rigidBody!.velocity.y,
        box.rigidBody!.velocity.z,
      ] as number[],
    };
    expect(caught.ballPos).toEqual(full60.ballPos);
    expect(caught.ballVel).toEqual(full60.ballVel);
    expect(caught.boxPos).toEqual(full60.boxPos);
    expect(caught.boxVel).toEqual(full60.boxVel);
  });
});
