import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// A04/WP-C2: "post processing on, tone mapping element DISABLED or absent" must apply the SAME
// fallback on every tier that owns a post tail: `ToneMappingMode.DEFAULT` curve (PBR_NEUTRAL) +
// exposure 1.0 + display gamma 2.2. The default group enables every element, so this only triggers
// when an app explicitly disables the ToneMappingElement; WP-C2 supersedes the earlier A04 identity
// passthrough (which left WebGL2 writing unencoded linear HDR to the sRGB canvas while WebGPU did
// no gamma either and WebGL1 passed the display-referred frame through -- three outputs diverging
// from the DEFAULT curve). WebGL1 post remains display-referred passthrough (no gamma encode; the
// frame is already sRGB-encoded on that tier).
//
// References: PostProcessPassGL.ts (default gamma 2.2 upload), PostProcessDynUniforms.ts ("the
// identity baseline"), and the WebGL1 A03 note in PostProcess100.frag.glsl.

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

describe("post disabled-tone-mapping parity (A04 / WP-C2)", () => {
  it("WebGL2 post applies the DEFAULT-curve gamma 2.2 when TM is disabled (never 1.0 identity)", () => {
    const src = code(GL2_PASS);
    // WP-C2: the disabled branch of the gamma upload must be 2.2 -- pow(x, 1/2.2) is the display
    // encode the WebGPU tier performs with inverseGamma 1/2.2.
    expect(src).toContain("tm && tm.enabled ? tm.gamma : 2.2");
    // Exposure is already neutral (1.0) in the same branch -- no buried gamma 1.0 default may return.
    expect(src).toContain("tm && tm.enabled ? tm.exposure : 1.0");
    expect(src).not.toContain("tm.gamma : 1.0)");
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
