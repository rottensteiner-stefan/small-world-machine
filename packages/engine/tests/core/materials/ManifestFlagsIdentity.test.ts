import { describe, expect, it } from "vitest";
import { StandardMaterial } from "../../../src/core/materials/surface/StandardMaterial.js";
import { PhongMaterial } from "../../../src/core/materials/surface/PhongMaterial.js";
import { ShaderFlag } from "../../../src/enums/ShaderFlag.js";

// getRenderManifest() runs per object and per pass; a fresh flags array per call was the dominant
// per-frame allocation (showcase 51, 6000 objects). Contract: identical while stable, replaced
// (never mutated) on change -- resolveManifestFlags caches derived arrays per input identity.
describe("material manifest flags are allocation-stable", () => {
  it("returns the same flags array while the material does not change", () => {
    const material = new StandardMaterial({ anisotropyStrength: 0.5 });
    const first = material.getRenderManifest().flags;
    const second = material.getRenderManifest().flags;
    expect(second).toBe(first);
  });

  it("replaces the array (old one untouched) when the flag set changes", () => {
    const material = new StandardMaterial({ anisotropyStrength: 0.5 });
    const before = material.getRenderManifest().flags!;
    const snapshot = [...before];
    material.anisotropyStrength = 0;
    const after = material.getRenderManifest().flags!;
    expect(after).not.toBe(before);
    expect(before).toEqual(snapshot);
    expect(after).not.toContain(ShaderFlag.ANISOTROPY);
  });

  it("applies to the other flag-building materials too", () => {
    const phong = new PhongMaterial();
    expect(phong.getRenderManifest().flags).toBe(phong.getRenderManifest().flags);
  });

  it("packs lanes into stable arrays (no per-call literal)", () => {
    const material = new StandardMaterial({ anisotropyStrength: 0.5 });
    const lane = material.getRenderManifest().properties["u_matParam15"];
    material.anisotropyStrength = 0.25;
    expect(material.getRenderManifest().properties["u_matParam15"]).toBe(lane);
    expect((lane as number[])[0]).toBe(0.25);
  });
});
