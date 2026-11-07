import { describe, expect, it } from "vitest";
import { Collision } from "../../src/physix/Collision.js";
import { OBB } from "../../src/physix/OBB.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { BoundingSphere } from "../../src/physix/BoundingSphere.js";
import { ConvexHull } from "../../src/physix/ConvexHull.js";
import type { BoundingVolume } from "../../src/interfaces/index.js";
import { Vector3D, Matrix4 } from "../../src/math/index.js";

/**
 * Behaviour contract of `Collision.resolve`, independent of any pinned number: the returned
 * minimum translation vector (MTV) pushes `a` out of `b` along the way of least penetration.
 * For random rotated shapes (containment, edge regions and tilts included) that means:
 *   1. moving `a` by 1.001 * MTV separates the pair,
 *   2. moving `a` by 0.9 * MTV does not (the MTV is not longer than necessary),
 *   3. `test` and `resolve` agree on whether the pair touches.
 */

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function boxHull(h: Vector3D): ConvexHull {
  const v = [
    new Vector3D(-h.x, -h.y, -h.z),
    new Vector3D(h.x, -h.y, -h.z),
    new Vector3D(h.x, h.y, -h.z),
    new Vector3D(-h.x, h.y, -h.z),
    new Vector3D(-h.x, -h.y, h.z),
    new Vector3D(h.x, -h.y, h.z),
    new Vector3D(h.x, h.y, h.z),
    new Vector3D(-h.x, h.y, h.z),
  ];
  const f = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [3, 7, 6, 2],
    [0, 4, 7, 3],
    [1, 2, 6, 5],
  ];
  return new ConvexHull(v, f);
}

type Kind = "obb" | "hull" | "box" | "sphere";

function make(kind: Kind, rnd: () => number, center: Vector3D): BoundingVolume {
  const he = new Vector3D(0.4 + rnd(), 0.4 + rnd(), 0.4 + rnd());
  const rot = new Vector3D(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28);
  const m = new Matrix4().compose(center, rot, new Vector3D(1, 1, 1));
  switch (kind) {
    case "obb": {
      const o = new OBB(new Vector3D(0, 0, 0), he);
      o.transform(m);
      return o;
    }
    case "hull": {
      const h = boxHull(he);
      h.transform(m);
      return h;
    }
    case "box":
      return new BoundingBox(center.clone().sub(he), center.clone().add(he));
    case "sphere":
      return new BoundingSphere(center.clone(), 0.5 + rnd());
  }
}

function moved(v: BoundingVolume, by: Vector3D, factor: number): BoundingVolume {
  const off = by.clone().scale(factor);
  if (v.type === 0) return new BoundingSphere(v.center.clone().add(off), v.radius);
  if (v.type === 1) {
    return new BoundingBox(v.min.clone().add(off), v.max.clone().add(off));
  }
  v.translate(off);
  return v;
}

const PAIRS: Array<[Kind, Kind]> = [
  ["obb", "obb"],
  ["hull", "hull"],
  ["hull", "obb"],
  ["hull", "box"],
  ["obb", "box"],
  ["sphere", "obb"],
  ["sphere", "box"],
  ["box", "box"],
  ["sphere", "sphere"],
  ["hull", "sphere"],
  ["obb", "sphere"],
  ["box", "sphere"],
  ["sphere", "hull"],
];

describe("Collision.resolve behaviour (random rotated pairs)", () => {
  for (const [ka, kb] of PAIRS) {
    it(`${ka} vs ${kb}: MTV separates, is minimal-ish, and agrees with test()`, () => {
      const rnd = lcg(1234 + ka.length * 31 + kb.length);
      let checked = 0;
      for (let i = 0; i < 120; i++) {
        const seedA = Math.floor(rnd() * 1e9);
        const seedB = Math.floor(rnd() * 1e9);
        const offset = new Vector3D((rnd() - 0.5) * 2.6, (rnd() - 0.5) * 2.6, (rnd() - 0.5) * 2.6);
        const build = (): [BoundingVolume, BoundingVolume] => {
          const ra = lcg(seedA);
          const rb = lcg(seedB);
          return [make(ka, ra, offset), make(kb, rb, new Vector3D(0, 0, 0))];
        };
        const [a, b] = build();
        const mtv = new Vector3D();
        const hit = Collision.resolve(a, b, mtv);
        expect(hit).toBe(Collision.test(a, b));
        if (!hit) continue;
        checked++;
        const len = mtv.length();
        expect(len).toBeGreaterThan(0);

        // 1. separated after 1.001 * MTV
        const [a1, b1] = build();
        expect(Collision.test(moved(a1, mtv, 1.001), b1)).toBe(false);
        // 2. still touching after 0.9 * MTV
        const [a2, b2] = build();
        expect(Collision.test(moved(a2, mtv, 0.9), b2)).toBe(true);
      }
      expect(checked).toBeGreaterThan(30);
    });
  }
});
