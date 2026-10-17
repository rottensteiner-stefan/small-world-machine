// T4 (D3-minimal): Style identity & dispatch registry test.
//
// [DEFERRED] The full float-styleId -> Enum refactor stays out of scope for this period
// (roadmap §8.3 D3): only when a 6th published style is planned. Any new lane / meaning must
// still pass the Lane-Contract-Registry (T3) first.
//
// This test pins the *current* contract honestly:
//   - published base styles dispatch to their styleId lane (u_styleB.w is the selector)
//   - styleId == 3.0 marks the extension band (Noir/Oil carve-out on u_styleA.w)
//   - the selector lane and the extension carve-outs are declared in
//     scripts/lane-contracts/lane-contracts.json (Lane-Contract-Abgleich)
// The shader itself derives its flags from u_styleB.w (StylizedWater.frag.glsl:55,101), which
// is exactly the dispatch this test locks down.

import { describe, it, expect } from "vitest";
import fs from "fs";
import { StylizedWaterMaterial } from "../../../src/core/materials/liquid/StylizedWaterMaterial.js";
import type { RenderManifest } from "../../../src/renderers/shaders/RenderManifest.js";

const REGISTRY_JSON = new URL(
  "../../../../../scripts/lane-contracts/lane-contracts.json",
  import.meta.url,
);

type StyleName = "flat" | "toon" | "soft" | "sparkle" | "dredge" | "bold";

// Published base presets and their documented styleId selector (StylizedWaterMaterial.ts:163-165).
const PUBLISHED_STYLES: Array<{ name: StyleName; styleId: number }> = [
  { name: "flat", styleId: 0 },
  { name: "toon", styleId: 0 },
  { name: "soft", styleId: 1 },
  { name: "sparkle", styleId: 2 },
  { name: "dredge", styleId: 4 },
  { name: "bold", styleId: 5 },
];

// Minimal extension stub mirroring the Noir/Oil carve-out pattern (styleId 3.0 overrides
// u_styleA.w after the base pack). Kept local so the test does not couple the engine suite
// to the @small-world-machine/liquid-extras package.
const EXTENSION_LANE_VALUE = 6;
class ExtensionStubMaterial extends StylizedWaterMaterial {
  constructor() {
    super(
      {
        style: "custom",
        styleId: 3.0,
        lineDensity: 0.0,
        lineWidth: 0.0,
        glitterStrength: 0.0,
      },
      "ExtensionStubMaterial",
    );
  }

  public override getRenderManifest(): RenderManifest {
    const manifest = super.getRenderManifest();
    const props = manifest.properties as Record<string, number[]>;
    props["u_styleA"]![3] = EXTENSION_LANE_VALUE;
    return manifest;
  }
}

describe("StylizedWater style dispatch registry (T4)", () => {
  it("dispatches every published base style to its styleId selector lane", () => {
    for (const { name, styleId } of PUBLISHED_STYLES) {
      const mat = new StylizedWaterMaterial({ style: name });
      expect(mat.styleId).toBe(styleId);
      const styleB = mat.getRenderManifest().properties["u_styleB"] as number[];
      expect(styleB[3]).toBe(styleId);
    }
  });

  it("keeps published styles distinguishable from each other", () => {
    const manifestOf = (style: StyleName): Record<string, number[]> =>
      new StylizedWaterMaterial({ style }).getRenderManifest().properties as Record<
        string,
        number[]
      >;

    const toon = manifestOf("toon");
    const soft = manifestOf("soft");
    const sparkle = manifestOf("sparkle");
    const dredge = manifestOf("dredge");
    const bold = manifestOf("bold");

    expect((toon["u_styleB"] as number[])[3]).not.toBe((soft["u_styleB"] as number[])[3]);
    expect((soft["u_styleB"] as number[])[3]).not.toBe((sparkle["u_styleB"] as number[])[3]);
    expect((sparkle["u_styleB"] as number[])[3]).not.toBe((dredge["u_styleB"] as number[])[3]);
    expect((dredge["u_styleB"] as number[])[3]).not.toBe((bold["u_styleB"] as number[])[3]);

    // Distinct visuals beyond the selector lane: style vectors must actually differ.
    const aSoft = soft["u_styleA"] as number[];
    const aSparkle = sparkle["u_styleA"] as number[];
    const aDredge = dredge["u_styleA"] as number[];
    const aBold = bold["u_styleA"] as number[];
    expect(aSoft).not.toEqual(aSparkle);
    expect(aSparkle).not.toEqual(aDredge);
    expect(aDredge).not.toEqual(aBold);
  });

  it("treats styleId 3.0 as the extension band with a u_styleA.w carve-out", () => {
    const stub = new ExtensionStubMaterial();
    const props = stub.getRenderManifest().properties as Record<string, number[]>;

    expect((props["u_styleB"] as number[])[3]).toBe(3.0);
    // extension override displaces the base lineWidth meaning on the same lane
    expect((props["u_styleA"] as number[])[3]).toBe(EXTENSION_LANE_VALUE);
    // base ripple lines are off for the extension band (lane reuse, see NoirWaterMaterial)
    expect((props["u_styleA"] as number[])[2]).toBe(0);
  });

  it("the shader consumes the styleId selector, i.e. dispatch is real, not cosmetic", () => {
    const def = new StylizedWaterMaterial({ style: "bold" }).getShaderDefinition();
    expect(def.sources.glsl300?.fs).toContain("u_styleB.w");
    expect(def.sources.glsl100?.fs).toContain("u_styleB.w");
  });

  it("matches the Lane-Contract-Registry: selector covers 0..5, extensions are styleId 3 only", () => {
    const doc = JSON.parse(fs.readFileSync(REGISTRY_JSON, "utf8"));
    const lanes: Array<{
      lane: string;
      styleIds: number[];
      meaning: string;
      materialTypes: string[];
    }> = doc.lanes;

    const selector = lanes.find((l) => l.lane === "u_styleB.w");
    expect(selector).toBeDefined();
    const ids = (selector?.styleIds ?? []).map((n: number) => Number(n));
    for (const id of [0, 1, 2, 3, 4, 5]) expect(ids).toContain(id);

    const baseEscrow = lanes.filter(
      (l) => l.lane === "u_styleA.w" && l.materialTypes.includes("StylizedWaterMaterial"),
    );
    expect(baseEscrow.length).toBeGreaterThanOrEqual(1);
    expect(baseEscrow[0]!.styleIds).not.toContain(3);

    const extensionLanes = lanes.filter(
      (l) => l.lane === "u_styleA.w" && !l.materialTypes.includes("StylizedWaterMaterial"),
    );
    expect(extensionLanes.length).toBeGreaterThanOrEqual(2);
    for (const ext of extensionLanes) expect(ext.styleIds).toEqual([3]);
  });
});
