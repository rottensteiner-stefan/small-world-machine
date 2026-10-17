import { describe, it, expect } from "vitest";
import { Object3D } from "../../../src/core/Object3D.js";
import { PhysicsBroadphase } from "../../../src/physix/broadphase/PhysicsBroadphase.js";
import { BoundingBox } from "../../../src/physix/BoundingBox.js";
import { Vector3D } from "../../../src/math/index.js";
import type { Collidable } from "../../../src/interfaces/index.js";

/**
 * Deterministic LCG so the stress scenarios are reproducible across runs and platforms.
 */
class LCG {
  private _s: number;
  constructor(seed: number) {
    this._s = seed >>> 0;
  }
  public next(): number {
    this._s = (this._s * 1664525 + 1013904223) >>> 0;
    return this._s / 4294967296;
  }
  public range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
}

function makeBounds(cx: number, cy: number, cz: number, half: number): BoundingBox {
  return new BoundingBox(
    new Vector3D(cx - half, cy - half, cz - half),
    new Vector3D(cx + half, cy + half, cz + half),
  );
}

function collectCandidates(bp: PhysicsBroadphase, b: Collidable): Collidable[] {
  const hits: Collidable[] = [];
  if (!b.bounds) return hits;
  bp.queryVolume(b.bounds, hits);
  return hits.filter((h) => h !== b);
}

/**
 * Soundness of temporal-coherence skipping: after arbitrarily many seeded motion frames, the
 * incremental broadphase must NEVER return a strictly smaller candidate set for any collider
 * than an identical from-scratch rebuild at the very same world state. The from-scratch rebuild
 * is ground truth (it cannot suffer stale placements). Losing a candidate is a silent
 * missed-pair: the narrow phase never even gets to test it.
 *
 * Overshooting (incremental returning extra candidates) is tolerated: it costs only narrow-phase
 * work, never correctness.
 */
describe("PhysicsBroadphase temporal-coherence soundness", () => {
  it("never loses candidate pairs vs a fresh rebuild across seeded stress motion", () => {
    const scenarios: { seed: number; fatMargin: number }[] = [
      { seed: 0x1234, fatMargin: 0.1 },
      { seed: 0xabcd, fatMargin: 0.5 },
    ];

    for (const { seed, fatMargin } of scenarios) {
      const rng = new LCG(seed);
      const colliders: Object3D[] = [];

      // Dense, heavily overlapping blocks: AABBs of half-size 0.5 on a 0.3 grid -> guaranteed
      // candidate pairs (each query volume overlaps several neighbours), forces deep subdivision.
      const BLOCK = 5;
      for (let x = 0; x < BLOCK; x++) {
        for (let y = 0; y < BLOCK; y++) {
          for (let z = 0; z < BLOCK; z++) {
            const o = new Object3D("block");
            o.bounds = makeBounds(x * 0.3, y * 0.3, z * 0.3, 0.5);
            colliders.push(o);
          }
        }
      }

      // Drifters: tiny per-frame motion, mostly within the fat shell -> exercises the SKIP path.
      const DRIFT = 30;
      const drifterStart = colliders.length;
      for (let i = 0; i < DRIFT; i++) {
        const o = new Object3D("drift");
        o.bounds = makeBounds(rng.range(-3, 0), rng.range(-3, 0), rng.range(-3, 0), 0.45);
        colliders.push(o);
      }

      // Teleporters: occasional large jumps -> exercises the re-insert path.
      const TELE = 10;
      const teleStart = colliders.length;
      for (let i = 0; i < TELE; i++) {
        const o = new Object3D("tele");
        o.bounds = makeBounds(rng.range(-4, 4), rng.range(-4, 4), rng.range(-4, 4), 0.4);
        colliders.push(o);
      }

      // Statics: never move -> must stay permanently in-tree and always be returned.
      const STATIC = 10;
      for (let i = 0; i < STATIC; i++) {
        const o = new Object3D("static");
        o.bounds = makeBounds(rng.range(10, 12), rng.range(10, 12), rng.range(10, 12), 0.5);
        colliders.push(o);
      }

      const incremental = new PhysicsBroadphase({ fatMargin });
      incremental.update(colliders);

      let totalSkips = 0;
      let totalMoves = 0;
      let totalReferencedPairs = 0;
      let totalIncrementalPairs = 0;

      const FRAMES = 14;
      for (let frame = 0; frame < FRAMES; frame++) {
        // Advance motion deterministically.
        for (let i = teleStart; i < teleStart + TELE; i++) {
          const o = colliders[i]!;
          const b = o.bounds as BoundingBox;
          const half = (b.max.x - b.min.x) / 2;
          const cx = b.min.x + half + rng.range(-0.7, 0.7);
          const cy = b.min.y + half + rng.range(-0.7, 0.7);
          const cz = b.min.z + half + rng.range(-0.7, 0.7);
          o.bounds = makeBounds(cx, cy, cz, half);
        }
        // Drifters wander slightly; kept inside a bounded region to stay clustered.
        for (let i = drifterStart; i < drifterStart + DRIFT; i++) {
          const o = colliders[i]!;
          const b = o.bounds as BoundingBox;
          const half = (b.max.x - b.min.x) / 2;
          let cx = b.min.x + half + rng.range(-0.02, 0.02);
          let cy = b.min.y + half + rng.range(-0.02, 0.02);
          let cz = b.min.z + half + rng.range(-0.02, 0.02);
          if (cx > 0.5) cx -= 1;
          if (cx < -3.5) cx += 1;
          if (cy > 0.5) cy -= 1;
          if (cy < -3.5) cy += 1;
          if (cz > 0.5) cz -= 1;
          if (cz < -3.5) cz += 1;
          o.bounds = makeBounds(cx, cy, cz, half);
        }
        // Statics never move.

        incremental.update(colliders);
        totalSkips += incremental.skippedCount;
        totalMoves += incremental.movedCount;

        // Ground truth: a from-scratch rebuild at the identical world state.
        const reference = new PhysicsBroadphase({ fatMargin });
        reference.update(colliders);

        for (let i = 0; i < colliders.length; i++) {
          const b = colliders[i]!;
          const refHits = collectCandidates(reference, b);
          const incHits = collectCandidates(incremental, b);
          totalReferencedPairs += refHits.length;
          totalIncrementalPairs += incHits.length;

          for (const candidate of refHits) {
            expect(
              incHits.includes(candidate),
              `frame ${frame}, seed 0x${seed.toString(16)}: incremental lost candidate for ${b} -> ${candidate}`,
            ).toBe(true);
          }
        }
      }

      // The scenario must exercise BOTH the skip path and the re-insert path, or the test is
      // vacuous. Statics alone guarantee skips; teleporters guarantee moves.
      expect(totalSkips).toBeGreaterThan(0);
      expect(totalMoves).toBeGreaterThan(0);
      expect(totalReferencedPairs).toBeGreaterThan(0);
      expect(totalIncrementalPairs).toBeGreaterThanOrEqual(totalReferencedPairs);
    }
  }, 20000);
});
