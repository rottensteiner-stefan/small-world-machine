import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../../../src");
const GL1_PBR = join(SRC, "renderers/shaders/source/web_gl1/chunks/light_calc_pbr.frag.glsl");
const GL2_PBR = join(SRC, "renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl");
const WGSL_PBR = join(SRC, "renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl");
const STD_GL3 = join(SRC, "core/materials/surface/shaders/Standard.frag.glsl");
const STD_GL1 = join(SRC, "core/materials/surface/shaders/Standard.frag.glsl100");

// ADR 0039 sheen decision (2026-10-19): sheen is decoupled from the emissive `u_specColor` lane.
// Tint and an enable w-flag travel in the typed `u_matParam10` lane (StandardMaterial._LANES). These
// tests pin the decoupling in every dialect source so a shader edit cannot silently re-couple sheen
// to the emissive channel (which used to give every emissive material an unintended sheen lobe on
// WebGL1/WebGPU) or let one backend drift to a different activation condition.

describe("Sheen/emissive decoupling (ADR 0039 sheen decision)", () => {
  const gl1 = readFileSync(GL1_PBR, "utf8");
  const gl2 = readFileSync(GL2_PBR, "utf8");
  const wgsl = readFileSync(WGSL_PBR, "utf8");
  const stdGL3 = readFileSync(STD_GL3, "utf8");
  const stdGL1 = readFileSync(STD_GL1, "utf8");

  it("gates sheen exclusively on the u_matParam10 enable flag in every dialect", () => {
    expect(gl1).toContain("u_matParam10.w > 0.5");
    expect(wgsl).toContain("obj.matParam10.w > 0.5");
    // WebGL2 stays compile-gated on the same push basis; the tint must come from the lane, not white.
    expect(gl2).toContain("#ifdef USE_SHEEN");
    expect(gl2).toContain("sRGBToLinear(u_matParam10.rgb)");
  });

  it("no longer reads the emissive u_specColor channel inside any sheen lobe", () => {
    // `D_Charlie(` marks the sheen term; the old gate `specColor.r||g||b > 0` would surface on these
    // lines again if a refactor ever re-couples sheen to the emissive channel.
    for (const [name, src] of [
      ["web_gl1 light_calc_pbr", gl1],
      ["web_gl2 light_calc_pbr", gl2],
      ["web_gpu lighting_pbr", wgsl],
    ] as const) {
      const sheenLines = src.split("\n").filter((line) => line.includes("D_Charlie("));
      expect(sheenLines.length, `${name} has sheen lobes`).toBeGreaterThan(0);
      for (const line of sheenLines) {
        expect(line, `${name} sheen line stays decoupled: ${line.trim()}`).not.toContain(
          "specColor",
        );
      }
    }
  });

  it("removes the old emissive-driven activation condition everywhere", () => {
    const oldGateGl = "(u_specColor.r > 0.0 || u_specColor.g > 0.0 || u_specColor.b > 0.0)";
    const oldGateWgsl = "(obj.specColor.r > 0.0 || obj.specColor.g > 0.0 || obj.specColor.b > 0.0)";
    expect(gl1).not.toContain(oldGateGl);
    expect(gl2).not.toContain(oldGateGl);
    expect(wgsl).not.toContain(oldGateWgsl);
  });

  it("declares the sheen lane uniformly in the Standard fragment templates", () => {
    expect(stdGL3).toContain("uniform vec4 u_matParam10;");
    expect(stdGL1).toContain("uniform vec4 u_matParam10;");
  });

  it("keeps u_specColor as the emissive channel (unchanged role)", () => {
    expect(gl1).toContain("sRGBToLinear(u_specColor.rgb)");
    expect(gl2).toContain("sRGBToLinear(u_specColor.rgb)");
    expect(wgsl).toContain("sRGBToLinear(obj.specColor.rgb)");
  });
});
