import { describe, it, expect } from "vitest";
import { Object3D, PointLight, Vector3D } from "@small-world-machine/engine";
import { Fire, FIRE_PRESETS } from "../src/fire/Fire.js";

const DT = 1 / 60;
const CAMERA = new Vector3D(2, 1.6, 5);

function run(fire: Fire, frames: number, dt: number = DT, camera: Vector3D = CAMERA): void {
  for (let i = 0; i < frames; i++) {
    fire.update(dt, camera);
  }
}

function trailsSnapshot(fire: Fire): number[] {
  const out: number[] = [];
  if (fire.embers) {
    out.push(...Array.from(fire.embers.system.arrays.positions));
  }
  if (fire.smoke) {
    out.push(...Array.from(fire.smoke.system.arrays.positions));
  }
  return out;
}

describe("Fire prefab construction", () => {
  it("authors layers from the named presets", () => {
    const candle = new Fire({ preset: "candle" });
    expect(candle.embers).toBeUndefined();
    expect(candle.smoke).toBeUndefined();
    expect(candle.emberBed).toBeUndefined();
    expect(candle.soot).toBeUndefined();
    expect(candle.width).toBe(FIRE_PRESETS.candle.width);

    const torch = new Fire({ preset: "torch" });
    expect(torch.embers).toBeDefined();
    expect(torch.smoke).toBeDefined();
    expect(torch.emberBed).toBeDefined();
    expect(torch.soot).toBeUndefined();

    const campfire = new Fire({ preset: "campfire" });
    expect(campfire.embers).toBeDefined();
    expect(campfire.smoke).toBeDefined();
    expect(campfire.emberBed).toBeDefined();
    // Soot needs a DOM canvas texture; the headless test environment keeps it undefined.
    expect(campfire.soot).toBeUndefined();

    candle.dispose();
    torch.dispose();
    campfire.dispose();
  });

  it("merges per-field overrides over the preset data", () => {
    const fire = new Fire({ preset: "torch", data: { cards: 3, height: 0.9, soot: true } });
    expect(fire.width).toBe(FIRE_PRESETS.torch.width);
    expect(fire.height).toBe(0.9);
    fire.dispose();
  });
});

describe("Fire prefab determinism", () => {
  it("reproduces identical trail snapshots from the same seed", () => {
    const a = new Fire({ preset: "torch", seed: 7 });
    const b = new Fire({ preset: "torch", seed: 7 });
    for (let i = 0; i < 20; i++) {
      a.update(0.2, CAMERA);
      b.update(0.2, CAMERA);
    }
    expect(trailsSnapshot(a)).toEqual(trailsSnapshot(b));
    a.dispose();
    b.dispose();
  });

  it("gives different seeds different trail trajectories", () => {
    const a = new Fire({ preset: "torch", seed: 1 });
    const b = new Fire({ preset: "torch", seed: 2 });
    for (let i = 0; i < 20; i++) {
      a.update(0.2, CAMERA);
      b.update(0.2, CAMERA);
    }
    expect(trailsSnapshot(a)).not.toEqual(trailsSnapshot(b));
    a.dispose();
    b.dispose();
  });

  it("freezes completely at deltaTime 0 (capture/pause support)", () => {
    const a = new Fire({ preset: "torch", seed: 3 });
    const b = new Fire({ preset: "torch", seed: 3 });
    run(a, 20);
    run(b, 20);
    const before = trailsSnapshot(b);
    b.update(0, CAMERA);
    b.update(0, CAMERA);
    expect(trailsSnapshot(b)).toEqual(before);
    a.dispose();
    b.dispose();
  });
});

describe("Fire prefab layer toggles", () => {
  it("hides the flame/glow/light objects while keeping the envelope live", () => {
    const fire = new Fire({ preset: "torch", seed: 5 });
    fire.setLayerEnabled("flame", false);
    expect(fire.flameEnabled).toBe(false);
    run(fire, 3);
    // Hidden layers still evolve internally — the flame envelope keeps breathing.
    expect(fire.flame.time).toBeGreaterThan(0);
    fire.dispose();
  });

  it("stops trail spawns when disabled but keeps the mesh handle", () => {
    const fire = new Fire({ preset: "torch", seed: 5 });
    fire.setLayerEnabled("embers", false);
    run(fire, 10);
    expect(fire.embers!.system.activeCount).toBe(0);
    expect(fire.embers!.mesh.isVisible).toBe(false);
    fire.dispose();
  });

  it("re-enables a previously hidden layer", () => {
    const fire = new Fire({ preset: "torch", seed: 5 });
    fire.setLayerEnabled("smoke", false);
    run(fire, 5);
    fire.setLayerEnabled("smoke", true);
    run(fire, 5);
    expect(fire.smoke!.mesh.isVisible).toBe(true);
    fire.dispose();
  });
});

describe("Fire prefab world anchoring", () => {
  it("spawns trails at the live root position (moving fire)", () => {
    const fire = new Fire({ preset: "torch", seed: 11 });
    const moving = new Vector3D(2, 1, 3);
    fire.root.position.copyFrom(moving);
    // Enough frames for the rate accumulator to actually spawn (2 frames never fire).
    for (let i = 0; i < 90; i++) {
      fire.update(DT, CAMERA);
    }
    // Positions live around the moving anchor, never at the origin.
    const positions = Array.from(fire.embers!.system.arrays.positions);
    let nearAnchor = false;
    for (let i = 0; i < positions.length; i += 3) {
      const dx = positions[i]! - moving.x;
      const dy = positions[i + 1]! - moving.y;
      const dz = positions[i + 2]! - moving.z;
      if (Math.hypot(dx, dy, dz) < 0.8) nearAnchor = true;
    }
    expect(nearAnchor).toBe(true);
    fire.dispose();
  });

  it("omits trail updates when no camera is supplied (carried-torch path)", () => {
    const fire = new Fire({ preset: "torch", seed: 11 });
    for (let i = 0; i < 10; i++) {
      fire.update(DT);
    }
    // Without a camera the trail simulators never run: no particles were emitted.
    expect(fire.embers!.system.activeCount).toBe(0);
    fire.dispose();
  });
});

describe("Fire prefab light path", () => {
  it("uses an injected external light and never reparents it", () => {
    const external = new PointLight({ name: "external", intensity: 3, distance: 8 });
    const holder = new Object3D("Holder");
    external.position.set(0, 1, 0);
    holder.add(external);
    const fire = new Fire({ preset: "torch", seed: 4, light: external });
    expect(fire.light).toBe(external);
    expect(external.parent).toBe(holder);
    fire.dispose();
  });
});

describe("Fire prefab disposal", () => {
  it("removes every part from its parent and is safe to call twice", () => {
    const holder = new Object3D("Holder");
    const fire = new Fire({ preset: "campfire", seed: 4 });
    holder.add(fire.root);
    fire.dispose();
    expect(fire.root.parent).toBeUndefined();
    fire.dispose();
  });
});
