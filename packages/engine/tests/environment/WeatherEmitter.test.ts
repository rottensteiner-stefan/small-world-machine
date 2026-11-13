import { describe, it, expect, vi } from "vitest";
import { WeatherEmitter, Matrix4, Vector3D } from "../../src/index.js";

/** Decodes instance `i`'s position out of the mesh's raw instance matrix buffer. */
function readPosition(emitter: WeatherEmitter, i: number): Vector3D {
  const matrix = new Matrix4();
  matrix.data.set(emitter.mesh.instanceMatrices.subarray(i * 16, i * 16 + 16));
  const position = new Vector3D();
  const rotation = new Vector3D();
  const scale = new Vector3D();
  matrix.decompose(position, rotation, scale);
  return position;
}

describe("WeatherEmitter", () => {
  it("never leaves a particle below the spawn box's floor after many updates", () => {
    const center = new Vector3D(0, 10, 0);
    const emitter = new WeatherEmitter("Test", {
      count: 50,
      center,
      spawnArea: { width: 4, depth: 4, height: 6 },
      fallSpeed: [2, 3],
    });
    const floorY = center.y - 3; // height / 2

    for (let frame = 0; frame < 200; frame++) {
      emitter.update(0.1);
    }

    for (let i = 0; i < emitter.mesh.instanceCount; i++) {
      expect(readPosition(emitter, i).y).toBeGreaterThanOrEqual(floorY);
    }
  });

  it("treats the floor plane itself as still inside the box (no recycle exactly at the boundary)", () => {
    const center = new Vector3D(0, 0, 0);
    const emitter = new WeatherEmitter("Test", {
      count: 1,
      center,
      spawnArea: { width: 4, depth: 4, height: 6 },
      fallSpeed: [1, 1],
      windGustiness: 0,
    });
    const floorY = -3; // center.y - height / 2

    // Drive the single particle to land exactly on the floor plane via a deltaTime chosen from
    // its actual (randomized) starting height, then verify one more zero-length update leaves it
    // exactly there rather than recycling it back to the top.
    const before = readPosition(emitter, 0);
    const dtToFloor = (before.y - floorY) / 1; // fallSpeed is fixed to 1
    emitter.update(dtToFloor);
    const atFloor = readPosition(emitter, 0);
    expect(atFloor.y).toBeCloseTo(floorY, 5);

    emitter.update(0);
    const afterZeroStep = readPosition(emitter, 0);
    expect(afterZeroStep.y).toBeCloseTo(floorY, 5);
  });

  it("recycles a particle back to the top of the box once it falls past the floor", () => {
    const center = new Vector3D(0, 0, 0);
    const emitter = new WeatherEmitter("Test", {
      count: 1,
      center,
      spawnArea: { width: 4, depth: 4, height: 6 },
      fallSpeed: [1, 1],
    });
    const topY = 3; // center.y + height / 2
    const floorY = -3;

    const before = readPosition(emitter, 0);
    // Fall well past the floor in a single step.
    emitter.update(before.y - floorY + 1);

    const after = readPosition(emitter, 0);
    expect(after.y).toBeCloseTo(topY, 5);
  });

  it("drifts particles horizontally in the wind's direction", () => {
    const emitter = new WeatherEmitter("Test", {
      count: 1,
      center: new Vector3D(0, 100, 0),
      spawnArea: { width: 100000, depth: 100000, height: 100000 },
      fallSpeed: [0, 0],
      wind: new Vector3D(5, 0, 0),
      windGustiness: 0,
    });

    const before = readPosition(emitter, 0);
    emitter.update(1);
    const after = readPosition(emitter, 0);

    expect(after.x - before.x).toBeCloseTo(5, 5);
  });

  it("flags instanceMatrixNeedsUpdate after every update()", () => {
    const emitter = new WeatherEmitter("Test", {
      count: 5,
      spawnArea: { width: 4, depth: 4, height: 4 },
    });
    emitter.mesh.instanceMatrixNeedsUpdate = false;
    emitter.update(0.016);
    expect(emitter.mesh.instanceMatrixNeedsUpdate).toBe(true);
  });

  it("is byte-deterministic with a fixed seed (same seed in, identical instances out)", () => {
    const spawnArea = { width: 4, depth: 4, height: 6 };
    const build = (seed: number): WeatherEmitter =>
      new WeatherEmitter("D", {
        count: 24,
        center: new Vector3D(0, 10, 0),
        spawnArea,
        fallSpeed: [2, 3],
        seed,
      });
    const a = build(12345);
    const b = build(12345);
    // Recycle particles so the deterministic stream is exercised beyond construction.
    for (let frame = 0; frame < 40; frame++) {
      a.update(0.1);
      b.update(0.1);
    }
    expect(Array.from(a.mesh.instanceMatrices)).toEqual(Array.from(b.mesh.instanceMatrices));
    // A different seed must diverge (sanity: the option actually branches the stream).
    const c = build(54321);
    for (let frame = 0; frame < 40; frame++) c.update(0.1);
    expect(Array.from(c.mesh.instanceMatrices)).not.toEqual(Array.from(a.mesh.instanceMatrices));
  });

  it("without a seed it draws from Math.random (legacy behavior preserved)", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const emitter = new WeatherEmitter("Legacy", {
        count: 8,
        center: new Vector3D(3, 10, -4),
        spawnArea: { width: 4, depth: 4, height: 6 },
      });
      // Every spawn draw is exactly 0.5 -> offsets from center are (0.5 - 0.5) * extent = 0.
      expect(random).toHaveBeenCalled();
      const m = emitter.mesh.instanceMatrices;
      emitter.update(0);
      for (let i = 0; i < 8; i++) {
        expect(m[i * 16 + 12]).toBeCloseTo(3, 5);
        expect(m[i * 16 + 14]).toBeCloseTo(-4, 5);
      }
    } finally {
      random.mockRestore();
    }
  });

  it("with a seed it never touches Math.random", () => {
    const random = vi.spyOn(Math, "random");
    try {
      const emitter = new WeatherEmitter("Seeded", {
        count: 8,
        spawnArea: { width: 4, depth: 4, height: 6 },
        seed: 7,
      });
      for (let frame = 0; frame < 20; frame++) emitter.update(0.1);
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });
});
