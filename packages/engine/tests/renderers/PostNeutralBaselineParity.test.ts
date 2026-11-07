import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// A04: "post processing on, tone mapping ABSENT" must be an IDENTITY passthrough on every tier --
// the neutral baseline contract. The default group enables every element, so this only triggers when
// an app explicitly disables the ToneMappingElement; before the fix the WebGL2 pass gamma-encoded
// its linear HDR buffer with pow(x, 1/2.2) (`u_gamma` forced to 2.2) while WebGPU packed
// `inverseGamma = 1.0` (no curve) and WebGL1 passed the display-referred frame through unchanged --
// same config, three different outputs.
//
// References: PostProcessDynUniforms.ts ("inverseGamma is 1.0 (tone mapping absent = no gamma
// correction; an enabled element describes an actual curve)"), the WebGPU neutral pack, and the
// WebGL1 A03 note in PostProcess100.frag.glsl.

const ROOT = path.resolve(__dirname, "../../../..");

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), "utf-8");
}

/** Code with comments removed -- a mention in a comment must neither satisfy nor break a guard. */
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const GL2_PASS = "packages/engine/src/renderers/post/passes/PostProcessPassGL.ts";
const WGPU_DYN = "packages/engine/src/renderers/post/PostProcessDynUniforms.ts";
const WGPU_FRAG = "packages/engine/src/renderers/post/shaders/PostProcess.frag.wgsl";
const GL1_FRAG = "packages/engine/src/renderers/post/shaders/PostProcess100.frag.glsl";

describe("post neutral-baseline parity with tone mapping absent (A04)", () => {
  it("WebGL2 post sets u_gamma = 1.0 when TM is disabled (identity, no sRGB encode)", () => {
    const src = code(GL2_PASS);
    // The disabled branch of the gamma upload must be 1.0 -- pow(x, 1/1) is the identity curve.
    expect(src).toContain("tm && tm.enabled ? tm.gamma : 1.0");
    // Exposure is already neutral (1.0) in the same branch -- no buried gamma 2.2 default may return.
    expect(src).toContain("tm && tm.enabled ? tm.exposure : 1.0");
    expect(src).not.toContain("tm.gamma : 2.2");
  });

  it("WebGPU packs the neutral baseline with inverseGamma = 1.0 and consumes it via linearToSRGB", () => {
    const neutral = code(WGPU_DYN);
    expect(neutral).toContain("out[o + 2] = 1.0;");
    // The WGSL uber-shader feeds that value straight into the same encode helper, so 1.0 = identity.
    expect(code(WGPU_FRAG)).toContain("linearToSRGB(tonemapped, u_inverseGamma)");
  });

  it("WebGL1 post has NO gamma encode at all (display-referred passthrough, A03 tier note)", () => {
    const src = code(GL1_FRAG);
    expect(src).not.toMatch(/linearToSRGB/);
    // The tier's post tail is the single display-referred gain on the already-encoded frame.
    expect(src).toContain("hdr * u_exposure");
  });
});
