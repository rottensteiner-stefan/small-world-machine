import { describe, it, expect } from "vitest";
import { OpenWaterMaterial } from "../../../src/core/materials/liquid/OpenWaterMaterial.js";
import { StylizedWaterMaterial } from "../../../src/core/materials/liquid/StylizedWaterMaterial.js";
import { OpenWaterSurfaceProbe } from "../../../src/core/materials/liquid/OpenWaterSurfaceProbe.js";

// Golden values: hand-evaluated in f64 from the OpenWater.vert.glsl formulas for the default
// OpenWaterMaterial lanes (independent of the probe code). Splat: ring at the origin spawned at
// t=10, sampled at t=10.5, x=1.9 (ringDist 0.15). Walls: poolHalfExtent 4, sampled at t=2.
const BASE_HEIGHT_X1_9_T10_5 = -0.11134023692865734;
const SPLAT_DELTA_X1_9_T10_5 = 0.074076512863529;
const WALL_X_HEIGHT_3_5_0_5_T2 = 0.05223932160884788;
const NO_WALL_HEIGHT_3_5_0_5_T2 = 0.1010424421794894;

describe("OpenWater impact ring lane (S2)", () => {
  it("packs the splat lane into u_styleA and exposes a read-only view", () => {
    const material = new OpenWaterMaterial();
    expect(material.getRenderManifest().properties["u_styleA"]).toEqual([0, 0, -9999, 0]);

    material.emitSplat(1.5, -2.0, 12.4, 0.85);
    expect(material.getRenderManifest().properties["u_styleA"]).toEqual([1.5, -2.0, 12.4, 0.85]);
    expect(material.splat).toEqual([1.5, -2.0, 12.4, 0.85]);
  });

  it("is a no-op on presets that render no impact ring", () => {
    const material = new StylizedWaterMaterial();
    const before = material.getRenderManifest().properties["u_styleA"] as number[];
    const snapshot = before.slice();
    material.emitSplat(1.5, -2.0, 12.4, 0.85);
    const after = material.getRenderManifest().properties["u_styleA"] as number[];
    expect(after).toEqual(snapshot);
  });
});

describe("OpenWaterSurfaceProbe mirrors the impact ring", () => {
  it("adds the ring displacement to the height at the ring front", () => {
    const material = new OpenWaterMaterial();
    const probe = OpenWaterSurfaceProbe.fromMaterial(material, { f32Precision: false });
    expect(probe.heightAt(1.9, 0, 10.5)).toBeCloseTo(BASE_HEIGHT_X1_9_T10_5, 12);

    // The probe was built before the splat: it must see the splat live.
    material.emitSplat(0, 0, 10, 1);
    expect(probe.heightAt(1.9, 0, 10.5)).toBeCloseTo(
      BASE_HEIGHT_X1_9_T10_5 + SPLAT_DELTA_X1_9_T10_5,
      12,
    );
  });

  it("is silent before spawn, after the 4 s lifetime and without energy", () => {
    const material = new OpenWaterMaterial();
    const probe = OpenWaterSurfaceProbe.fromMaterial(material, { f32Precision: false });
    const baseBefore = probe.heightAt(1.9, 0, 9.0);
    const baseAfter = probe.heightAt(1.9, 0, 14.5);
    material.emitSplat(0, 0, 10, 1);
    expect(probe.heightAt(1.9, 0, 9.0)).toBe(baseBefore);
    expect(probe.heightAt(1.9, 0, 14.5)).toBe(baseAfter);

    material.emitSplat(0, 0, 10, 0);
    expect(probe.heightAt(1.9, 0, 10.5)).toBeCloseTo(BASE_HEIGHT_X1_9_T10_5, 12);
  });

  it("does not reach far beyond the ring front", () => {
    const material = new OpenWaterMaterial();
    const probe = OpenWaterSurfaceProbe.fromMaterial(material, { f32Precision: false });
    const farBase = probe.heightAt(6.0, 0, 10.5);
    material.emitSplat(0, 0, 10, 1);
    expect(Math.abs(probe.heightAt(6.0, 0, 10.5) - farBase)).toBeLessThan(1e-4);
  });

  it("keeps the f32 mirror within a millimetre of the f64 mirror", () => {
    const material = new OpenWaterMaterial();
    material.emitSplat(0, 0, 10, 1);
    const f64 = OpenWaterSurfaceProbe.fromMaterial(material, { f32Precision: false });
    const f32 = OpenWaterSurfaceProbe.fromMaterial(material, { f32Precision: true });
    expect(Math.abs(f32.heightAt(1.9, 0, 10.5) - f64.heightAt(1.9, 0, 10.5))).toBeLessThan(1e-3);
  });
});

describe("OpenWater clapotis wall lane (S3)", () => {
  it("packs poolHalfExtent into u_matParam2.w (default 4.0 = the Showcase 10 basin)", () => {
    const material = new OpenWaterMaterial();
    expect((material.getRenderManifest().properties["u_matParam2"] as number[])[3]).toBe(4.0);

    material.poolHalfExtent = 0;
    expect((material.getRenderManifest().properties["u_matParam2"] as number[])[3]).toBe(0);
    expect(new OpenWaterMaterial({ poolHalfExtent: 2.5 }).poolHalfExtent).toBe(2.5);
  });

  it("probe adds the reflected wave near a wall and matches the golden value", () => {
    const material = new OpenWaterMaterial();
    const probe = OpenWaterSurfaceProbe.fromMaterial(material, { f32Precision: false });
    expect(probe.heightAt(3.5, 0.5, 2)).toBeCloseTo(WALL_X_HEIGHT_3_5_0_5_T2, 12);
  });

  it("is switched off by poolHalfExtent = 0 and leaves the basin interior untouched", () => {
    const walled = new OpenWaterMaterial();
    const open = new OpenWaterMaterial({ poolHalfExtent: 0 });
    const walledProbe = OpenWaterSurfaceProbe.fromMaterial(walled, { f32Precision: false });
    const openProbe = OpenWaterSurfaceProbe.fromMaterial(open, { f32Precision: false });

    expect(openProbe.heightAt(3.5, 0.5, 2)).toBeCloseTo(NO_WALL_HEIGHT_3_5_0_5_T2, 12);
    expect(walledProbe.heightAt(0.3, -0.2, 2)).toBe(openProbe.heightAt(0.3, -0.2, 2));

    open.poolHalfExtent = 4;
    expect(openProbe.heightAt(3.5, 0.5, 2)).toBeCloseTo(WALL_X_HEIGHT_3_5_0_5_T2, 12);
  });

  it("buoyancy query near a wall stays finite and bounded by the summed amplitude", () => {
    const material = new OpenWaterMaterial();
    const probe = OpenWaterSurfaceProbe.fromMaterial(material);
    for (let t = 0; t < 6; t += 0.37) {
      const h = probe.surfaceHeightAt(3.8, -3.9, t);
      expect(Number.isFinite(h)).toBe(true);
      expect(Math.abs(h)).toBeLessThan(1.5);
    }
  });
});
