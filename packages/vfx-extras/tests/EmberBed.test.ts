import { describe, it, expect } from "vitest";
import type { StandardMaterial } from "@small-world-machine/engine";
import { Vector3D } from "@small-world-machine/engine";
import { EmberBed } from "../src/fire/EmberBed.js";

const POS = new Vector3D(0, 0.05, 0);

function intensity(bed: EmberBed): number {
  return (bed.mesh.material as StandardMaterial).emissiveIntensity;
}

describe("EmberBed", () => {
  it("breathes deterministically from the same seed and differs across seeds", () => {
    const a = new EmberBed({ position: POS, seed: 5 });
    const b = new EmberBed({ position: POS, seed: 5 });
    const c = new EmberBed({ position: POS, seed: 6 });
    for (let i = 0; i < 40; i++) {
      a.update(0.1);
      b.update(0.1);
      c.update(0.1);
    }
    expect(intensity(a)).toBeCloseTo(intensity(b), 12);
    expect(intensity(a)).not.toBeCloseTo(intensity(c), 3);
  });

  it("freezes at deltaTime 0 and while disabled (capture/pause support)", () => {
    const a = new EmberBed({ position: POS, seed: 5 });
    const b = new EmberBed({ position: POS, seed: 5 });
    a.update(0.1);
    b.update(0.1);
    b.update(0);
    expect(intensity(a)).toBeCloseTo(intensity(b), 12);
    b.update(0.5);
    const frozen = intensity(b);
    b.enabled = false;
    b.update(0.5);
    expect(intensity(b)).toBe(frozen);
  });

  it("keeps the emissive intensity inside the authored breath band", () => {
    const bed = new EmberBed({ position: POS, seed: 3, emissiveIntensity: 2, breathStrength: 0.2 });
    for (let i = 0; i < 500; i++) {
      bed.update(0.15);
      expect(intensity(bed)).toBeGreaterThanOrEqual(2 * 0.8 - 1e-6);
      expect(intensity(bed)).toBeLessThanOrEqual(2 + 1e-6);
    }
  });

  it("is an opaque emissive cylinder that casts no glow sticker", () => {
    const bed = new EmberBed({ position: POS, radius: 0.3 });
    const material = bed.mesh.material as StandardMaterial;
    expect(material.emissiveIntensity).toBe(2);
    expect(material.emissiveColor.r).toBeGreaterThan(0.5); // deep ember orange, sRGB-authored
    expect(material.emissiveColor.b).toBeLessThan(0.2);
    expect(bed.mesh.geometry).toBeDefined();
    expect(bed.mesh.position.y).toBe(0.05);
  });
});
