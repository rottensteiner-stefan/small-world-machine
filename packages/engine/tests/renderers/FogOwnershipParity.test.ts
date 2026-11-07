import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { PostProcessingGroup } from "../../src/index.js";
import { PostProcessingEffectType } from "../../src/enums/index.js";
import type { VolumetricFogElement } from "../../src/renderers/post/elements/VolumetricFogElement.js";

// A05: fog may never be applied twice to the same pixel. When the volumetric fog element is active
// the post composite attenuates the whole frame with its froxel transmittance + in-scatter AFTER
// the forward pass -- so the forward pass MUST NOT also apply the scene's analytic fog (fogMode).
// One-owner rule, centralized on `PostProcessingGroup.volumetricFogOwnsFog`; WebGL2 and WebGPU gate
// their analytic-fog write on it. WebGL1 is deliberately NOT gated: its post tier has no volumetric
// term (PostProcess100.frag.glsl), so the analytic scene fog stays the single owner there -- a
// cross-tier divergence that would otherwise strip every WebGL1 scene of its fog.

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

describe("one-owner fog rule (A05)", () => {
  it("volumetricFogOwnsFog is true only with post ENABLED and the opt-in volumetric element active", () => {
    const group = new PostProcessingGroup();
    expect(group.enabled).toBe(false);

    // Post disabled -> never owns even if the volumetric element is enabled.
    const volFog = group.get<VolumetricFogElement>(PostProcessingEffectType.VOLUMETRIC_FOG)!;
    volFog.enabled = true;
    expect(group.volumetricFogOwnsFog).toBe(false);

    // Volumetric fog is opt-in, off by default: enabling post alone does NOT steal fog ownership.
    group.enabled = true;
    volFog.enabled = false;
    expect(group.volumetricFogOwnsFog).toBe(false);

    // Only the combination (post on AND element on) yields the one-owner gate.
    volFog.enabled = true;
    expect(group.volumetricFogOwnsFog).toBe(true);
  });

  it("WebGL2 suppresses the analytic fog write when volumetric fog owns the frame", () => {
    const src = code("packages/engine/src/renderers/WebGL2/WebGL2Renderer.ts");
    // The effective fog handed to the binder is nulled under `volumetricFogOwnsFog`, which makes
    // _bindFogUniforms write u_fogMode = NONE (its else branch).
    expect(src).toContain("this.postProcessing.volumetricFogOwnsFog ? undefined : scene?.fog");
  });

  it("WebGPU gates the analytic fog write the same way (fogMode = NONE)", () => {
    const src = code("packages/engine/src/renderers/WebGPU/managers/GlobalUniformWriter.ts");
    expect(src).toContain("!this._host.postProcessing.volumetricFogOwnsFog");
    expect(src).toContain("const analyticFogActive");
  });

  it("WebGL1 stays ungated -- tier note documents the deliberate single-owner absence", () => {
    // GL1 must NOT gate (no volumetric composite on tier).
    expect(code("packages/engine/src/renderers/WebGL1/WebGL1Renderer.ts")).not.toContain(
      "volumetricFogOwnsFog",
    );
    // The deliberate-absence reasoning is documented next to the GL1 fog bind.
    expect(read("packages/engine/src/renderers/WebGL1/WebGL1Renderer.ts")).toContain(
      "A05 tier note",
    );
  });
});
