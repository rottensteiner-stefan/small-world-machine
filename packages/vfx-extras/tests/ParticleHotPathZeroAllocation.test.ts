/**
 * C1 (T6) — Zero-allocation gate for existing hot paths, Charlie.
 *
 * Binding contract (S34 topic §3.2): NO heap allocation on hot paths for frames 2..1000.
 * Uses the AllocationHarness (monkeypatched typed-array ctors + ArrayBuffer/DataView). This is the
 * infrastructure harness for all S3/S4 lanes; lane-specific zero-alloc tests (TRAIL/LIGHTPOOL/GPU)
 * live in the C2 verification suite once the implementers land their files.
 */
import { describe, expect, it } from "vitest";
import { ParticleSystem } from "../src/ParticleSystem.js";
import { ParticleMeshRenderer } from "../src/ParticleMeshRenderer.js";
import { BasicMaterial, Vector3D } from "@small-world-machine/engine";
import { assertZeroAllocationFrames } from "./helpers/AllocationHarness.js";

const N = 10_000;

function buildSystem(maxLife = 1e9): ParticleSystem {
  const system = new ParticleSystem({ capacity: N });
  const pos = new Vector3D();
  for (let i = 0; i < N; i++) {
    pos.set((i % 100) * 0.1, Math.floor(i / 100) * 0.1, (i % 10) * -0.2);
    system.emit({ position: pos, size: 0.15, alpha: 0.9, maxLife });
  }
  return system;
}

describe("C1 zero-allocation gate (frames 2..1000)", () => {
  it("ParticleSystem.update(dt) allocates zero heap memory in steady state", () => {
    const system = buildSystem();
    // Warm the tick loop outside the trace window; every subsequent frame must be clean.
    const frames = 1000;
    assertZeroAllocationFrames(
      "ParticleSystem.update",
      (_frame) => {
        system.update(0.016);
        expect(system.activeCount).toBe(N);
      },
      { totalFrames: frames },
    );
  });

  it("ParticleMeshRenderer.sync(camera) allocates zero heap memory in steady state", () => {
    const system = buildSystem();
    const renderer = new ParticleMeshRenderer({
      system,
      geometryMode: "octagon",
      material: new BasicMaterial(),
      billboard: "spherical",
    });
    const cam = new Vector3D(5, 5, 15);
    const frames = 1000;
    assertZeroAllocationFrames(
      "ParticleMeshRenderer.sync",
      (frame) => {
        cam.x = 5 + frame * 0.01;
        cam.y = 5 - frame * 0.005;
        renderer.sync(cam);
        expect(renderer.mesh.instanceCount).toBe(N);
      },
      { totalFrames: frames },
    );
  });
});
