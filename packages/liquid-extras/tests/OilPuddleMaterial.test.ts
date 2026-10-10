import { describe, it, expect } from "vitest";
import { Color } from "@small-world-machine/engine";
import { OilPuddleMaterial } from "../src/materials/OilPuddle/OilPuddleMaterial.js";

describe("OilPuddleMaterial First-Class Floor-Oil Material", () => {
  it("instantiates cleanly with the mutedSheen default look", () => {
    const mat = new OilPuddleMaterial();
    expect(mat.type).toBe("OilPuddleMaterial");
    expect(mat.transparent).toBe(true);
    // The default must preserve the production-established restrained look (B defaults).
    expect(mat.iridescenceStrength).toBe(0.3);
  });

  it("defaults to the canonical muted thin-film model in all three backends", () => {
    const mat = new OilPuddleMaterial();
    const shaderDef = mat.getShaderDefinition();
    expect(shaderDef).toBeDefined();

    for (const src of [
      shaderDef.sources.glsl300?.fs,
      shaderDef.sources.glsl100?.fs,
      shaderDef.sources.wgsl,
    ]) {
      expect(src).toContain("oilFilmThinFilm");
      expect(src).not.toContain("vec3 thinFilm(");
      // canonical module is single-sourced, never forked inline
      expect(src).toContain("oilFilmRainbow");
    }
  });

  it("transports parameters through the dedicated matParam lanes", () => {
    const mat = new OilPuddleMaterial({ iridescenceStrength: 0.45, timeScale: 1.4 });
    const props = mat.getRenderManifest().properties as Record<string, unknown>;
    expect(props["u_matParam0"]).toEqual([0, 0.45, 1.4, 0]);
    const p1 = props["u_matParam1"] as number[];
    expect(p1[0]).toBe(0.5);
    expect(p1[1]).toBe(0.22);
    const p5 = props["u_matParam5"] as number[];
    expect(p5[3]).toBe(0.4);
  });

  it("applies the posterRings look with rings enabled", () => {
    const mat = new OilPuddleMaterial({ look: "posterRings" });
    const props = mat.getRenderManifest().properties as Record<string, unknown>;
    expect((props["u_matParam0"] as number[])[3]).toBe(1); // ringEnabled
    expect((props["u_matParam4"] as number[])[0]).toBe(5); // ringCount
  });

  it("applies the tarSkin look with wrinkle strength", () => {
    const mat = new OilPuddleMaterial({ look: "tarSkin" });
    const props = mat.getRenderManifest().properties as Record<string, unknown>;
    expect((props["u_matParam3"] as number[])[3]).toBe(0.5);
  });

  it("lets explicit options override the look baseline", () => {
    const mat = new OilPuddleMaterial({ look: "tar", color: new Color(0.5, 0.4, 0.3, 1) });
    expect(mat.color.r).toBeCloseTo(0.5);
    expect(mat.iridescenceStrength).toBe(0.02); // tar iridescence kept
  });

  it("tunes volatility per fluid type without overriding explicit options", () => {
    expect(new OilPuddleMaterial({ fluidType: "petrol" }).timeScale).toBeCloseTo(1.7);
    expect(new OilPuddleMaterial({ fluidType: "diesel" }).timeScale).toBeCloseTo(0.85);
    // explicit timeScale wins
    expect(new OilPuddleMaterial({ fluidType: "petrol", timeScale: 1 }).timeScale).toBe(1);
  });
});
