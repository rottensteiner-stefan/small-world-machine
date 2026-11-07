import "../../src/index.js";
import { describe, expect, it } from "vitest";
import { WebGL2Renderer } from "../../src/renderers/WebGL2/WebGL2Renderer.js";
import { ShadowMode } from "../../src/enums/index.js";
import type { RenderManifest } from "../../src/renderers/shaders/index.js";

// The EVSM moment-atlas sampler only exists in the USE_EVSM program variant (one texture unit less
// for every default PCSS/PCF program on 16-unit WebGL2 hardware). A shadowMode switch has to select
// the other variant on the next subgroup build, in both directions.

interface FlagInternals {
  _quality: { shadowMode: ShadowMode; normalBuffer?: boolean };
  _buildSubgroupShaderFlags(
    firstObject: undefined,
    manifest: RenderManifest,
    scene: undefined,
    isInst: boolean,
  ): string[];
}

function flagsFor(renderer: FlagInternals, mode: ShadowMode): string[] {
  renderer._quality.shadowMode = mode;
  return renderer._buildSubgroupShaderFlags(undefined, {} as RenderManifest, undefined, false);
}

describe("WebGL2Renderer EVSM program variant", () => {
  it("adds USE_EVSM only in EVSM mode and drops it again when switching back", () => {
    const renderer = Object.create(WebGL2Renderer.prototype) as FlagInternals;
    renderer._quality = { shadowMode: ShadowMode.DEFAULT };

    expect(flagsFor(renderer, ShadowMode.PCSS)).not.toContain("USE_EVSM");
    expect(flagsFor(renderer, ShadowMode.EVSM)).toContain("USE_EVSM");
    expect(flagsFor(renderer, ShadowMode.PCSS)).not.toContain("USE_EVSM");
  });
});
