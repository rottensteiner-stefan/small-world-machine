// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RainStreaks, Matrix4, Vector3D } from "../../src/index.js";

/** jsdom has no working 2D canvas backing store (the `canvas` npm package is not installed),
 *  and `RainStreaks` builds its streak texture procedurally, so stub the canvas context. */
function stubCanvas2D(): void {
  const mockGetContext = vi.fn().mockReturnValue({
    createImageData: vi.fn((width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    })),
    putImageData: vi.fn(),
  });
  vi.stubGlobal("document", {
    createElement: vi.fn().mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return { getContext: mockGetContext, width: 0, height: 0 };
      }
      return {};
    }),
  });
}

/** Decodes instance `i`'s position out of the mesh's raw instance matrix buffer. */
function readPosition(rain: RainStreaks, i: number): Vector3D {
  const matrix = new Matrix4();
  matrix.data.set(rain.mesh.instanceMatrices.subarray(i * 16, i * 16 + 16));
  const position = new Vector3D();
  const rotation = new Vector3D();
  const scale = new Vector3D();
  matrix.decompose(position, rotation, scale);
  return position;
}

describe("RainStreaks", () => {
  beforeEach(() => {
    stubCanvas2D();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a fixed-size instanced pool matching `count`", () => {
    const rain = new RainStreaks({ count: 37 });
    expect(rain.mesh.instanceCount).toBe(37);
  });

  it("defaults to a light-rain pool of 6000 streaks", () => {
    const rain = new RainStreaks();
    expect(rain.mesh.instanceCount).toBe(6000);
  });

  it("never lets a drop leave the rain box vertically after many updates", () => {
    const rain = new RainStreaks({ count: 64, halfExtent: 5, height: 8 });
    const camera = new Vector3D(0, 0, 0);

    for (let frame = 0; frame < 300; frame++) {
      rain.update(0.016, frame * 0.016, camera);
    }

    for (let i = 0; i < rain.mesh.instanceCount; i++) {
      const y = readPosition(rain, i).y;
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(8);
    }
  });

  it("follows the camera horizontally so density stays uniform", () => {
    const rain = new RainStreaks({ count: 32, halfExtent: 6, height: 8 });
    const camera = new Vector3D(40, 3, -25);

    for (let frame = 0; frame < 5; frame++) {
      rain.update(0.016, frame * 0.016, camera);
    }

    for (let i = 0; i < rain.mesh.instanceCount; i++) {
      const position = readPosition(rain, i);
      expect(Math.abs(position.x - camera.x)).toBeLessThanOrEqual(6 + 1e-3);
      expect(Math.abs(position.z - camera.z)).toBeLessThanOrEqual(6 + 1e-3);
    }
  });

  it("lets drops fall downward when there is no wind", () => {
    const rain = new RainStreaks({ count: 8, halfExtent: 20, height: 100, windX: 0, windZ: 0 });
    const camera = new Vector3D(0, 0, 0);

    // Populate the instanced matrices with the initial random positions (no movement at dt = 0).
    rain.update(0, 0, camera);
    const before = new Array<number>(rain.mesh.instanceCount);
    for (let i = 0; i < rain.mesh.instanceCount; i++) before[i] = readPosition(rain, i).y;

    // One small step: every drop must gain fall (no wrap can occur in 100 m of height).
    rain.update(0.01, 0, camera);

    for (let i = 0; i < rain.mesh.instanceCount; i++) {
      expect(readPosition(rain, i).y).toBeLessThan(before[i]!);
    }
  });

  it("drifts drops away from the box edge in the wind's direction", () => {
    const rain = new RainStreaks({ count: 8, halfExtent: 10, height: 100, windX: 5, windZ: 0 });
    const camera = new Vector3D(0, 0, 0);

    // Populate the instanced matrices with the initial random positions (no movement at dt = 0).
    rain.update(0, 0, camera);
    const before = new Array<number>(rain.mesh.instanceCount);
    for (let i = 0; i < rain.mesh.instanceCount; i++) before[i] = readPosition(rain, i).x;

    // One gust-amplified (+x, capped at ~1.5x base) step.
    rain.update(0.01, 0, camera);
    const range = 10 - 5 * 1.5 * 0.01; // drops that cannot wrap within one step

    for (let i = 0; i < rain.mesh.instanceCount; i++) {
      const bx = before[i]!;
      if (Math.abs(bx) < range) {
        expect(readPosition(rain, i).x).toBeGreaterThan(bx);
      }
    }
  });

  it("orients every streak along the gusting wind", () => {
    const rain = new RainStreaks({ count: 8, windX: 5, windZ: 0 });
    rain.update(0.016, 0, new Vector3D(0, 0, 0));

    const matrices = rain.mesh.instanceMatrices;
    for (let i = 0; i < rain.mesh.instanceCount; i++) {
      // Column Y of the streak matrix = -axis * streakLength; a +x wind makes the axis point
      // +x (ux > 0), so this column's X is negative for every drop -- no wrap/precision noise here.
      expect(matrices[i * 16 + 4]!).toBeLessThan(0);
    }
  });

  it("flags instanceMatrixNeedsUpdate after every update()", () => {
    const rain = new RainStreaks({ count: 5 });
    rain.mesh.instanceMatrixNeedsUpdate = false;
    rain.update(0.016, 0, new Vector3D(0, 0, 0));
    expect(rain.mesh.instanceMatrixNeedsUpdate).toBe(true);
  });

  it("fails fast on invalid options", () => {
    expect(() => new RainStreaks({ count: 0 })).toThrow(RangeError);
    expect(() => new RainStreaks({ dropSizeRange: [0.003, 0.001] })).toThrow(RangeError);
  });
});
