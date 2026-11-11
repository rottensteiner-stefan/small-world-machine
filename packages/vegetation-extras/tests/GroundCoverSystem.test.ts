import { describe, expect, it } from "vitest";
import {
  buildGrassClumpGeometry,
  MEADOW_GRASS_VARIETIES,
  type GrassVariety,
} from "../src/groundcover/GrassClump.js";
import { GroundCoverSystem } from "../src/groundcover/GroundCoverSystem.js";

const FINE = MEADOW_GRASS_VARIETIES[0]!;

describe("buildGrassClumpGeometry", () => {
  it("emits 5 verts / 3 tris per blade and keeps the far bucket a prefix of the near bucket", () => {
    const near = buildGrassClumpGeometry(FINE, 0, FINE.blades);
    const far = buildGrassClumpGeometry(FINE, 0, FINE.bladesFar);
    expect(near.vertices.length / 3).toBe(FINE.blades * 5);
    expect(near.indices!.length / 3).toBe(FINE.blades * 3);
    expect(Array.from(near.vertices.subarray(0, far.vertices.length))).toEqual(
      Array.from(far.vertices),
    );
  });

  it("adds a petal fan + centre per stem for flower varieties", () => {
    const daisy = MEADOW_GRASS_VARIETIES.find((v) => v.flower !== undefined)!;
    const geo = buildGrassClumpGeometry(daisy, 6, daisy.blades);
    const per = 5 + daisy.flower!.petals * 2 + 1;
    expect(geo.vertices.length / 3).toBe(daisy.blades * per);
    expect(geo.indices!.length / 3).toBe(daisy.blades * (3 + daisy.flower!.petals));
  });

  it("stays inside the variety footprint and height (+ lean)", () => {
    const v: GrassVariety = { ...FINE, radius: 0.2, height: 0.5, lean: [0, 0.4] };
    const geo = buildGrassClumpGeometry(v, 3, 20);
    for (let i = 0; i < geo.vertices.length; i += 3) {
      expect(Math.hypot(geo.vertices[i]!, geo.vertices[i + 2]!)).toBeLessThanOrEqual(
        0.2 + 0.5 * 0.4 + 0.03,
      );
      expect(geo.vertices[i + 1]!).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });
});

describe("GroundCoverSystem", () => {
  it("rejects lodPx at or below the cull gate", () => {
    expect(
      () =>
        new GroundCoverSystem({
          varieties: [FINE],
          density: 1,
          radius: 20,
          seed: 1,
          cullPixelSize: 4,
          lodPx: 4,
        }),
    ).toThrow();
  });

  it("gates ring rebuilds on camera travel and counts records over all varieties", () => {
    const cover = new GroundCoverSystem({
      varieties: [FINE, MEADOW_GRASS_VARIETIES[1]!],
      density: 2,
      radius: 20,
      seed: 5,
    });
    expect(cover.varietyCount).toBe(2);
    expect(cover.update(0, 0)).toBe(true);
    expect(cover.instanceCount).toBeGreaterThan(0);
    expect(cover.update(0.2, 0.1)).toBe(false);
    expect(cover.update(1, 0)).toBe(true);
    cover.dispose();
    expect(cover.varietyCount).toBe(0);
  });

  it("skips (disposes) varieties the host cannot register", () => {
    const cover = new GroundCoverSystem({
      varieties: [FINE, MEADOW_GRASS_VARIETIES[1]!],
      density: 1,
      radius: 20,
      seed: 2,
    });
    let calls = 0;
    const ok = cover.register({
      registerInstanceField: () => {
        calls++;
        if (calls === 1) throw new Error("device limit");
      },
      unregisterInstanceField: () => {},
    });
    expect(ok).toBe(1);
    expect(cover.varietyCount).toBe(1);
  });
});
