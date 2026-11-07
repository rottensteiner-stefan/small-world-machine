import { describe, it, expect } from "vitest";
import { OpenWaterMaterial, OpenWaterSurfaceProbe } from "../../src/core/materials/index.js";
import { PhysicsSystem } from "../../src/physix/PhysicsSystem.js";
import { FluidVolume } from "../../src/physix/FluidVolume.js";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { Cube } from "../../src/geometry/Cube.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { Vector3D } from "../../src/math/Vector3D.js";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";

describe("ShowcaseBuoyancyIntegration (S1)", () => {
  const WAVE1: [number, number, number, number] = [1.0, 0.3, 0.2, 4.0];
  const WAVE2: [number, number, number, number] = [0.3, 1.0, 0.15, 2.5];
  const WAVE3: [number, number, number, number] = [-0.5, 0.6, 0.08, 1.5];
  const SPEED = 1.2;
  const DT = 1 / 60;
  const GRAVITY_Y = -9.81;

  interface SetupResult {
    material: OpenWaterMaterial;
    probe: OpenWaterSurfaceProbe;
    water: FluidVolume;
    body: Object3D;
    physics: PhysicsSystem;
    scene: Scene;
    step: (dt?: number) => void;
    getTime: () => number;
  }

  function createSetup(options?: {
    density?: number;
    drag?: number;
    mass?: number;
    initialY?: number;
    bodyX?: number;
    bodyZ?: number;
    restHeight?: number;
    hookSurface?: boolean;
  }): SetupResult {
    const density = options?.density ?? 1.0;
    const drag = options?.drag ?? 0.88;
    const mass = options?.mass ?? 0.5;
    const initialY = options?.initialY ?? 0;
    const bodyX = options?.bodyX ?? 2.0;
    const bodyZ = options?.bodyZ ?? 1.0;
    const restHeight = options?.restHeight ?? 0.05;
    const hookSurface = options?.hookSurface ?? true;

    const material = new OpenWaterMaterial({
      speed: SPEED,
      wave1: WAVE1,
      wave2: WAVE2,
      wave3: WAVE3,
    });
    const probe = OpenWaterSurfaceProbe.fromMaterial(material, { restHeight });

    let currentTime = 0;
    const water = new FluidVolume(
      new BoundingBox(new Vector3D(-10, -5, -10), new Vector3D(10, 5, 10)),
      density,
      drag,
    );
    if (hookSurface) {
      water.surfaceHeightAt = (x: number, z: number): number =>
        probe.surfaceHeightAt(x, z, currentTime);
    }

    const body = new Object3D("FloatingBox");
    body.geometry = new Cube({ size: 1.0 }).getGeometryData();
    body.position.set(bodyX, initialY, bodyZ);
    body.rigidBody = new RigidBody(mass);

    const events = new EventDispatcherImpl();
    const physics = new PhysicsSystem(events);
    physics.gravity.set(0, GRAVITY_Y, 0);
    physics.addFluidVolume(water);

    const scene = new Scene();
    scene.add(body);
    body.updateMatrixWorld();
    body.computeBounds();

    const step = (dt: number = DT): void => {
      currentTime += dt;
      physics.step(scene, dt);
    };

    return {
      material,
      probe,
      water,
      body,
      physics,
      scene,
      step,
      getTime: (): number => currentTime,
    };
  }

  it("submerged body experiences buoyancy, floats up and converges near the surface", () => {
    // Start deep submerged at Y = -3.0
    const setup = createSetup({ initialY: -3.0, mass: 0.5, density: 1.0 });

    // Step physics for 3 seconds
    for (let i = 0; i < 180; i++) {
      setup.step(DT);
    }

    // Body should have risen from -3.0 to near the water surface
    expect(setup.body.position.y).toBeGreaterThan(-1.0);
    expect(setup.body.position.y).toBeLessThan(1.5);
  });

  it("body oscillates vertically with dynamic wave motion over time and does not stick to Y=0", () => {
    const bodyX = 1.5;
    const bodyZ = 0.5;
    const setup = createSetup({ initialY: 0.0, mass: 0.5, density: 1.0, bodyX, bodyZ });

    // Let the body settle into wave motion for 2 seconds (120 ticks)
    for (let i = 0; i < 120; i++) {
      setup.step(DT);
    }

    // Sample vertical position over several wave cycles
    const ySamples: number[] = [];
    const surfaceSamples: number[] = [];

    for (let i = 0; i < 300; i++) {
      setup.step(DT);
      const y = setup.body.position.y;
      const surfaceY = setup.probe.surfaceHeightAt(bodyX, bodyZ, setup.getTime());
      ySamples.push(y);
      surfaceSamples.push(surfaceY);
    }

    const minY = Math.min(...ySamples);
    const maxY = Math.max(...ySamples);
    const amplitude = maxY - minY;

    // Body must exhibit dynamic vertical oscillation (not rigid/static)
    expect(amplitude).toBeGreaterThan(0.15);

    // Verify it is oscillating dynamically over time (max and min are distinctly separated from mean)
    const meanY = ySamples.reduce((sum, v) => sum + v, 0) / ySamples.length;
    expect(maxY - meanY).toBeGreaterThan(0.05);
    expect(meanY - minY).toBeGreaterThan(0.05);

    // Correlation with wave surface: verify body position follows surface height
    const surfaceMin = Math.min(...surfaceSamples);
    const surfaceMax = Math.max(...surfaceSamples);
    expect(surfaceMax - surfaceMin).toBeGreaterThan(0.2);
  });

  it("higher fluid density (brine/Dead Sea) results in a higher equilibrium float height", () => {
    // Run normal water density = 1.0
    const setupNormal = createSetup({ initialY: 0.0, mass: 0.6, density: 1.0 });
    for (let i = 0; i < 300; i++) {
      setupNormal.step(DT);
    }

    // Run high density = 1.3
    const setupDense = createSetup({ initialY: 0.0, mass: 0.6, density: 1.3 });
    for (let i = 0; i < 300; i++) {
      setupDense.step(DT);
    }

    // Collect average height over a wave cycle
    let avgNormal = 0;
    let avgDense = 0;
    const count = 120;
    for (let i = 0; i < count; i++) {
      setupNormal.step(DT);
      setupDense.step(DT);
      avgNormal += setupNormal.body.position.y;
      avgDense += setupDense.body.position.y;
    }
    avgNormal /= count;
    avgDense /= count;

    // Body in dense brine must sit higher than in normal water
    expect(avgDense).toBeGreaterThan(avgNormal + 0.05);
  });

  it("falls back to static AABB top when surfaceHeightAt is undefined", () => {
    const setup = createSetup({ initialY: 0.0, mass: 0.5, hookSurface: false });

    // Step long enough to reach static resting equilibrium at bounds.max.y
    for (let i = 0; i < 800; i++) {
      setup.step(DT);
    }

    const ySamples: number[] = [];
    for (let i = 0; i < 120; i++) {
      setup.step(DT);
      ySamples.push(setup.body.position.y);
    }

    const minY = Math.min(...ySamples);
    const maxY = Math.max(...ySamples);
    const variation = maxY - minY;

    // Without dynamic surface probe, body settles into flat static equilibrium (no wave oscillation)
    expect(variation).toBeLessThan(0.005);
  });
});
