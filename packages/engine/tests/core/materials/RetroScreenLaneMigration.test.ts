import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RetroScreenMaterial } from "../../../src/core/materials/RetroScreenMaterial.js";

const SRC_DIR = join(__dirname, "../../../src");
const SHADER_DIR = join(SRC_DIR, "core/materials/shaders");

// ── P3/S1 R6 (E9-A, audit §2.6): RetroScreen hijacked the generic `u_extraParams` (intensity,
// time, speed, mode) and `u_liquidParams` (param1..4) slots instead of the typed u_matParamN
// bank (ADR 0027/0039). Migration is strict and value-preserving: the exact legacy byte values
// move to owned u_matParam0 (control) / u_matParam1 (mode params) lanes -- a parity assertion,
// no output change. The audit's "800-line sine flickers in the distance" warning is addressed
// with a Nyquist scanline guard (only active when a pixel would carry more than one full line
// period, i.e. `fwidth(uv.y) * scanlineCount > 0.5`); at every normal on-screen TV density the
// guard is a numeric identity, so the migration changes no default frames. WebGL1 (glsl100) has
// no guaranteed `fwidth` (OES_standard_derivatives), so it keeps the plain sine -- documented
// tier limitation.

describe("E9-A: RetroScreen migrates to typed lanes with a value-preserving parity claim", () => {
  it("tv50s default manifests carry the exact legacy values in u_matParam0/u_matParam1", () => {
    const mat = new RetroScreenMaterial();
    const props = mat.getRenderManifest().properties as Record<string, number[]>;
    expect(props["u_matParam0"]).toEqual([1.0, 0.0, 1.0, 0.0]); // intensity, time, speed, mode
    expect(props["u_matParam1"]).toEqual([0.08, 800.0, 1.0, 0.15]); // param1..4 (tv50s defaults)
  });

  it("film19th mode flags and params land identically in the lanes", () => {
    const mat = new RetroScreenMaterial({
      mode: "film19th",
      intensity: 0.7,
      speed: 1.5,
      param1: 2.0,
      param2: 20.0,
      param3: 1.2,
      param4: 0.8,
    });
    mat.time = 42.0;
    const props = mat.getRenderManifest().properties as Record<string, number[]>;
    expect(props["u_matParam0"]).toEqual([0.7, 42.0, 1.5, 1.0]);
    expect(props["u_matParam1"]).toEqual([2.0, 20.0, 1.2, 0.8]);
  });

  it("no shader tier reads the generic extraParams/liquidParams slots anymore", () => {
    for (const file of [
      "RetroScreen.frag.wgsl",
      "RetroScreen.frag.glsl",
      "RetroScreen.frag.glsl100",
    ]) {
      const source = readFileSync(join(SHADER_DIR, file), "utf8");
      expect(source, file).not.toMatch(/obj\.(extraParams|liquidParams)/);
      expect(source, file).not.toMatch(/u_(extraParams|liquidParams)\./);
      expect(source, file).toMatch(/matParam0|matParam1/);
    }
  });

  it("the source material writes the typed lanes (no legacy slot writes)", () => {
    const src = readFileSync(join(SRC_DIR, "core/materials/RetroScreenMaterial.ts"), "utf8");
    expect(src).toMatch(/u_matParam0/);
    expect(src).toMatch(/u_matParam1/);
  });
});

describe("E9-A: documented scanline Nyquist anti-alias guard", () => {
  it("wgsl and glsl300 carry an identity-at-reference Nyquist clamp on the line count", () => {
    for (const file of ["RetroScreen.frag.wgsl", "RetroScreen.frag.glsl"]) {
      const source = readFileSync(join(SHADER_DIR, file), "utf8");
      expect(source, file).toMatch(/fwidth\(uv\.y\)/);
      expect(source, file).toMatch(/min\(scanlineCount, /);
      expect(source, file).toMatch(/Nyquist|alias|flicker/i);
    }
  });

  it("glsl100 documents the WebGL1 tier exclusion (no guaranteed fwidth/OES_standard_derivatives)", () => {
    const glsl100 = readFileSync(join(SHADER_DIR, "RetroScreen.frag.glsl100"), "utf8");
    expect(glsl100).toMatch(/tier limitation|OES_standard_derivatives|no.*fwidth|WebGL1/i);
    expect(glsl100).not.toMatch(/fwidth\(/);
  });
});
