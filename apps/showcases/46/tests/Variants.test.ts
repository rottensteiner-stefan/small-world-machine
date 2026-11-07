import { describe, expect, it } from "vitest";
import {
  CAMERA_OVERRIDES,
  CAMERA_POOL_IDS,
  CAMERA_POOLS,
  PARTICLE_VARIANTS,
  VARIANT_BY_ID,
  cameraFor,
  cameraFrom,
  resolveVariant,
} from "../Variants.js";

describe("46 Variants", () => {
  it("variant ids are unique and each has label, icon, hint and at least one lane", () => {
    const ids = PARTICLE_VARIANTS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const v of PARTICLE_VARIANTS) {
      expect(v.title.length).toBeGreaterThan(0);
      expect(v.icon.length).toBeGreaterThan(0);
      expect(v.hint.length).toBeGreaterThan(0);
      expect(Object.values(v.lanes).some(Boolean)).toBe(true);
    }
  });

  it("overview is the only all-CPU-lanes variant and gpu is the only GPU lane", () => {
    const overview = VARIANT_BY_ID["overview"]!;
    expect(overview.lanes).toMatchObject({
      sparks: true,
      smoke: true,
      trails: true,
      weather: true,
    });
    expect(PARTICLE_VARIANTS.filter((v) => v.lanes.gpu).map((v) => v.id)).toEqual(["gpu"]);
  });

  it("every pool has a camera with distinct position and target; overrides reference real pools", () => {
    expect(CAMERA_POOL_IDS.slice().sort()).toEqual(Object.keys(CAMERA_POOLS).sort());
    for (const id of CAMERA_POOL_IDS) {
      const { position, target } = CAMERA_POOLS[id];
      expect(position).not.toEqual(target);
    }
    for (const [variant, pools] of Object.entries(CAMERA_OVERRIDES)) {
      expect(VARIANT_BY_ID[variant]).toBeDefined();
      for (const pool of Object.keys(pools)) expect(CAMERA_POOL_IDS).toContain(pool);
    }
  });

  it("cameraFor prefers an override and otherwise returns the base pool", () => {
    expect(cameraFor("trails", "closeup")).toBe(CAMERA_OVERRIDES.trails!.closeup);
    expect(cameraFor("trails", "closeup")).not.toBe(CAMERA_POOLS.closeup);
    expect(cameraFor("forge", "closeup")).toBe(CAMERA_POOLS.closeup);
    expect(cameraFor("trails", "overview")).toBe(CAMERA_POOLS.overview);
  });

  it("resolveVariant degrades unknown, empty and nullish input to overview", () => {
    expect(resolveVariant("smoke").id).toBe("smoke");
    expect(resolveVariant("nope").id).toBe("overview");
    expect(resolveVariant("").id).toBe("overview");
    expect(resolveVariant(null).id).toBe("overview");
    expect(resolveVariant(undefined).id).toBe("overview");
    expect(resolveVariant("toString").id).toBe("overview");
  });

  it("cameraFrom materializes tuple components in order", () => {
    const cam = cameraFrom({ position: [1, 2, 3], target: [4, 5, 6] });
    expect([cam.position.x, cam.position.y, cam.position.z]).toEqual([1, 2, 3]);
    expect([cam.target.x, cam.target.y, cam.target.z]).toEqual([4, 5, 6]);
  });
});
