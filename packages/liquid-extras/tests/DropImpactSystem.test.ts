import { describe, it, expect } from "vitest";
import { DropImpactSystem, type DropImpactSurface } from "../src/drops/DropImpactSystem.js";
import type { DropSurfaceParams } from "../src/drops/DropSurfaceParams.js";
import { FLUID_PRESETS, FluidPreset } from "../src/drops/FluidProperties.js";

class FakeSurface implements DropImpactSurface {
  public calls: number = 0;
  public last: DropSurfaceParams | null = null;

  public setDropSurfaceParams(params: DropSurfaceParams): void {
    this.calls++;
    this.last = params;
  }
}

describe("DropImpactSystem", () => {
  it("defaults to water and pushes immediately on addSurface", () => {
    const system = new DropImpactSystem();
    const surface = new FakeSurface();
    system.addSurface(surface);
    expect(surface.calls).toBe(1);
    // sigma/rho of water is ~7.2-7.3e-5 m^3/s^2 depending on the source.
    expect(surface.last?.sigmaOverRho).toBeGreaterThan(7.1e-5);
    expect(surface.last?.sigmaOverRho).toBeLessThan(7.4e-5);
  });

  it("pushes only after a change and reuses one params object", () => {
    const system = new DropImpactSystem();
    const surface = new FakeSurface();
    system.addSurface(surface);
    system.apply();
    const first = surface.last;
    const callsAfterFirstApply = surface.calls;
    system.apply();
    expect(surface.calls).toBe(callsAfterFirstApply);

    system.fluid = FLUID_PRESETS[FluidPreset.BLOOD];
    system.apply();
    expect(surface.calls).toBe(callsAfterFirstApply + 1);
    expect(surface.last).toBe(first);
    expect(surface.last?.scatteringPerMm).toBe(FLUID_PRESETS[FluidPreset.BLOOD].scatteringPerMm);
  });

  it("still notifies surfaces when params were read before apply", () => {
    const system = new DropImpactSystem();
    const surface = new FakeSurface();
    system.addSurface(surface);
    system.apply();
    const calls = surface.calls;
    system.fluid = FLUID_PRESETS[FluidPreset.OLIVE_OIL];
    expect(system.params.ior).toBe(FLUID_PRESETS[FluidPreset.OLIVE_OIL].ior);
    system.apply();
    expect(surface.calls).toBe(calls + 1);
  });

  it("stops pushing to removed surfaces", () => {
    const system = new DropImpactSystem();
    const surface = new FakeSurface();
    system.addSurface(surface);
    system.removeSurface(surface);
    system.fluid = FLUID_PRESETS[FluidPreset.SEAWATER];
    system.apply();
    expect(surface.calls).toBe(1);
  });
});
