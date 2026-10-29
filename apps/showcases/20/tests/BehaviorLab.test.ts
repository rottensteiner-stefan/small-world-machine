// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { defaultBehaviorLabSettings } from "../Hud.js";
import {
  LookAtBehavior,
  Matrix4,
  Object3D,
  SpotLight,
  SpringLerpBehavior,
  Vector3D,
} from "@small-world-machine/engine";

describe("Showcase 20 — Behavior Lab & Geometry Sanity", () => {
  it("provides valid default settings covering all built-in behaviors", () => {
    const s = defaultBehaviorLabSettings();
    expect(s.bobbing).toBe(true);
    expect(s.bobbingAmp).toBeGreaterThan(0);
    expect(s.bobbingFreq).toBeGreaterThan(0);
    expect(s.rotator).toBe(true);
    expect(s.rotatorSpeed).toBe(1.0);
    expect(s.rainbow).toBe(true);
    expect(s.patrol).toBe(true);
    expect(s.patrolDuration).toBe(10.0);
    expect(s.patrolLookForward).toBe(true);
    expect(s.patrolPingPong).toBe(false);
    expect(s.flicker).toBe(true);
    expect(s.trail).toBe(true);
    expect(s.companion).toBe(true);
    expect(s.companionLerp).toBe(0.05);
    expect(s.spotlight).toBe(true);
    expect(s.spotlightTarget).toBe("ship");
    expect(s.bloom).toBe(true);
  });

  it("cone orientation: -PI/2 on X points the apex (+Y) forward to -Z in SWM right-handed coordinates", () => {
    // In Small World Machine: -Z is Forward, +Z is Backward, +Y is Up.
    // Cone apex is at (0, +1.5, 0) in local cylinder coordinates.
    // Rotating by -PI/2 around X maps +Y to -Z (Forward).
    const localApex = new Vector3D(0, 1.5, 0);
    const m = new Matrix4();
    m.compose(new Vector3D(0, 0, 0), new Vector3D(-Math.PI / 2, 0, 0), new Vector3D(1, 1, 1));

    const worldApex = m.transformVector(localApex);
    expect(worldApex.x).toBeCloseTo(0, 5);
    expect(worldApex.y).toBeCloseTo(0, 5);
    expect(worldApex.z).toBeCloseTo(-1.5, 5); // Pointed FORWARD (-Z)

    // Conversely, +PI/2 would point to +Z (Backward into the thruster)
    const badM = new Matrix4();
    badM.compose(new Vector3D(0, 0, 0), new Vector3D(Math.PI / 2, 0, 0), new Vector3D(1, 1, 1));
    const badApex = badM.transformVector(new Vector3D(0, 1.5, 0));
    expect(badApex.z).toBeCloseTo(+1.5, 5); // Backwards!
  });

  it("LookAtBehavior aims SpotLight direction vector towards the target", () => {
    const spot = new SpotLight();
    spot.position.set(0, 15, 0);
    const ship = new Object3D("Ship");
    ship.position.set(10, 5, 0);

    const lookAt = new LookAtBehavior(ship);
    spot.addBehavior(lookAt);
    lookAt.onAttach(spot);

    lookAt.update(0.016);

    // Direction should point from (0, 15, 0) down towards (10, 5, 0) -> dx = 10, dy = -10, dz = 0
    expect(spot.direction.x).toBeGreaterThan(0);
    expect(spot.direction.y).toBeLessThan(0);
    expect(spot.direction.z).toBeCloseTo(0, 5);
    expect(spot.direction.length()).toBeCloseTo(1.0, 5);
  });

  it("SpringLerpBehavior smoothly interpolates target towards goal with frame-rate independence", () => {
    const companion = new Object3D("Companion");
    companion.position.set(0, 0, 0);
    const springLerp = new SpringLerpBehavior(new Vector3D(10, 0, 0), 0.1);
    companion.addBehavior(springLerp);
    springLerp.onAttach(companion);

    // Run one update tick
    springLerp.update(1 / 60);

    // After 1 frame at 60Hz, position should have moved towards target
    expect(companion.position.x).toBeGreaterThan(0);
    expect(companion.position.x).toBeLessThan(10);
  });
});
