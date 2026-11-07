/**
 * C2 (T8) — ParticleTrailRenderer verification (trail lane), Charlie.
 *
 * Implementer / owner: Dave (D4) — `packages/vfx-extras/src/ParticleTrailRenderer.ts`. Landed as
 * worktree WIP during this C2 run and upgraded from `it.todo` to real tests against the canonical
 * invariant IDs:
 *
 *   @invariant TRAIL-ZERO-ALLOC: `update` performs zero heap allocation (ring, compaction and
 *     basis math all write into preallocated typed arrays) — C1 AllocationHarness frames 2..1000.
 *   @invariant TRAIL-GEOMETRY-VALID: every emitted segment connects exactly two consecutive live
 *     history samples (its translation is the midpoint of those samples and its length axis spans
 *     them) — connected chain, no gaps/NaN/Inf, even under zero-velocity and camera-degenerate
 *     configurations.
 */
import { describe, expect, it } from "vitest";
import { BasicMaterial, Vector3D } from "@small-world-machine/engine";
import { ParticleTrailRenderer } from "../src/ParticleTrailRenderer.js";
import { assertZeroAllocationFrames } from "./helpers/AllocationHarness.js";

const MODEL_COL = 4; // column 4-6 of the 16-float instance matrix = segment length axis
const TRANS_COL = 12; // column 12-14 = translation (segment midpoint)

function makeTrail(maxHistory = 64): ParticleTrailRenderer {
  return new ParticleTrailRenderer({
    name: "C2Trail",
    maxHistory,
    width: 0.2,
    minStep: 0.05,
    fadeTime: 0.8,
    material: new BasicMaterial(),
  });
}

function isFiniteMatrix(trail: ParticleTrailRenderer): boolean {
  const m = trail.mesh.instanceMatrices;
  const live = trail.mesh.instanceCount;
  for (let i = 0; i < live * 16; i++) {
    if (!Number.isFinite(m[i])) return false;
  }
  if (trail.mesh.instanceData) {
    for (let i = 0; i < live * 4; i++) {
      if (!Number.isFinite(trail.mesh.instanceData[i]!)) return false;
    }
  }
  return true;
}

describe("C2 ParticleTrailRenderer (Dave D4 — TRAIL-ZERO-ALLOC)", () => {
  it("steady-state ring update + segment rebuild allocate zero typed arrays (C1 frames 2..1000, ring full)", () => {
    const trail = makeTrail(64);
    const node = new Vector3D(0, 0, 0);
    const cam = new Vector3D(10, 10, 10);

    // Full-ring steady state: the node moves every frame (records a sample every frame), so the
    // ring is at capacity for the whole trace window — the true hot path.
    assertZeroAllocationFrames(
      "ParticleTrailRenderer.update full-ring steady state",
      (frame) => {
        node.x = frame * 0.1;
        node.y = Math.sin(frame * 0.01) * 0.1;
        cam.x = 10 + frame * 0.02;
        trail.update(0.016, node, cam);
        expect(trail.liveSamples).toBeGreaterThan(0);
        expect(trail.mesh.instanceCount).toBeLessThanOrEqual(trail.maxHistory - 1);
      },
      { totalFrames: 1000 },
    );
  });

  it("ring history is bounded: liveSamples never exceeds maxHistory under sustained motion", () => {
    const trail = makeTrail(16);
    const node = new Vector3D(0, 0, 0);
    const cam = new Vector3D(10, 10, 10);
    for (let f = 0; f < 500; f++) {
      node.x = f * 0.1;
      trail.update(0.016, node, cam);
      expect(trail.liveSamples).toBeLessThanOrEqual(16);
      expect(trail.mesh.instanceCount).toBeLessThanOrEqual(15);
    }
    expect(trail.liveSamples).toBe(16); // ring fully engaged, oldest samples overwritten
  });
});

describe("C2 ParticleTrailRenderer (Dave D4 — TRAIL-GEOMETRY-VALID)", () => {
  it("every segment connects exactly two consecutive samples (midpoint translation, spanning length axis)", () => {
    const trail = makeTrail(64);
    const node = new Vector3D(0, 0, 0);
    const cam = new Vector3D(10, 10, 10);
    // Record a straight line along +X with 0.1 m steps (>= minStep).
    for (let f = 0; f < 20; f++) {
      node.x = f * 0.1;
      trail.update(0.016, node, cam);
    }

    const m = trail.mesh.instanceMatrices;
    const segments = trail.mesh.instanceCount;
    expect(segments).toBe(trail.liveSamples - 1);
    for (let k = 0; k < segments; k++) {
      // Segment k spans samples k and k+1: length axis = sample[k+1] - sample[k], translation =
      // midpoint of the two samples (the ring is linear here: tail advances only on overwrite).
      const sx = k * 0.1;
      const ex = (k + 1) * 0.1;
      const off = k * 16;
      const spanX = m[off + MODEL_COL]!;
      const transX = m[off + TRANS_COL]!;
      // Exact: dir=(1,0,0), length=0.1 -> axis column (0.1,0,0); trans=(mid, 0, 0).
      expect(spanX).toBeCloseTo(ex - sx, 5);
      expect(transX).toBeCloseTo((sx + ex) / 2, 5);
      expect(m[off + MODEL_COL + 1]).toBeCloseTo(0, 5);
      expect(m[off + MODEL_COL + 2]).toBeCloseTo(0, 5);
      expect(m[off + TRANS_COL + 1]).toBeCloseTo(0, 5);
      expect(m[off + TRANS_COL + 2]).toBeCloseTo(0, 5);
    }
    expect(isFiniteMatrix(trail)).toBe(true);
  });

  it("stays finite under zero-velocity node motion (no division blow-up, no NaN)", () => {
    const trail = makeTrail(8);
    const cam = new Vector3D(0, 0, 10);
    // Record TWO distinct samples, then hold the node perfectly still (zero velocity).
    trail.update(0.016, new Vector3D(0, 0, 0), cam);
    trail.update(0.016, new Vector3D(0, 0, 1), cam);
    expect(trail.liveSamples).toBe(2);
    const stationary = new Vector3D(0, 0, 1);
    for (let f = 0; f < 200; f++) {
      trail.update(0.016, stationary, cam); // node does not move -> no new sample, no NaN
      expect(isFiniteMatrix(trail)).toBe(true);
      expect(trail.liveSamples).toBeLessThanOrEqual(2);
    }
  });

  it("stays finite under camera-degenerate configurations (camera at midpoint and colinear with segment)", () => {
    // Camera AT the segment midpoint: toCam = 0 -> right basis falls back, must stay finite.
    const a = makeTrail(8);
    a.update(0.016, new Vector3D(0, 0, 0), new Vector3D(0, 0, 0.5));
    a.update(0.016, new Vector3D(0, 0, 1), new Vector3D(0, 0, 0.5));
    expect(a.liveSamples).toBe(2);
    for (let f = 0; f < 50; f++) a.update(0.016, new Vector3D(0, 0, 1 + f * 0.1), new Vector3D(0, 0, 0.5));
    expect(isFiniteMatrix(a)).toBe(true);
    for (let i = 0; i < a.mesh.instanceCount; i++) {
      const off = i * 16;
      expect(a.mesh.instanceMatrices[off + 14]).toBeGreaterThan(0); // translation Z still moving +Z
    }

    // Camera colinear with the segment direction (cross(dir, toCam) == 0 -> fallback basis).
    const b = makeTrail(8);
    b.update(0.016, new Vector3D(0, 0, 0), new Vector3D(0, 0, -10));
    b.update(0.016, new Vector3D(0, 0, 1), new Vector3D(0, 0, -10));
    expect(b.liveSamples).toBe(2);
    for (let f = 0; f < 50; f++) b.update(0.016, new Vector3D(0, 0, 1 + f * 0.1), new Vector3D(0, 0, -10));
    expect(isFiniteMatrix(b)).toBe(true);

    // upLocked mode with a vertical trail: cross(dir||+Y, upAxis) == 0 -> fallback, finite.
    const c = makeTrail(8);
    c.billboard = "upLocked";
    c.update(0.016, new Vector3D(0, 0, 0), new Vector3D(5, 0, 5));
    c.update(0.016, new Vector3D(0, 1, 0), new Vector3D(5, 0, 5));
    expect(c.liveSamples).toBe(2);
    for (let f = 0; f < 50; f++) c.update(0.016, new Vector3D(0, 1 + f * 0.1, 0), new Vector3D(5, 0, 5));
    expect(isFiniteMatrix(c)).toBe(true);
  });

  it("instanceData alpha stays in [0,1] (tail fade envelope never overshoots)", () => {
    const trail = makeTrail(16);
    const node = new Vector3D(0, 0, 0);
    const cam = new Vector3D(10, 10, 10);
    for (let f = 0; f < 80; f++) {
      node.x = f * 0.1;
      trail.update(0.016, node, cam);
      const data = trail.mesh.instanceData!;
      for (let i = 0; i < trail.mesh.instanceCount * 4; i += 4) {
        const alpha = data[i + 3]!;
        expect(alpha).toBeGreaterThanOrEqual(0);
        expect(alpha).toBeLessThanOrEqual(1);
      }
    }
  });
});
