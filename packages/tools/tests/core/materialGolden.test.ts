import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { NormalMapFormat } from "@small-world-machine/engine";
import {
  derivePbrMaps,
  MATERIAL_STUDIO_PRESETS,
  type MaterialStudioMapParams,
} from "../../src/core/material.js";
import type { RgbaImage } from "../../src/core/RasterIO.js";

// Golden gate against drift between the web UI and the CLI derivation. The hashes were produced by
// running the ORIGINAL inline pipeline of `public/tools/pbr-gen.html` (verbatim, before the page was
// switched to `derivePbrMaps`) over this fixture, so a mismatch means the maps changed — never
// re-pin them without a deliberate decision to change the look of every exported PBR set.

/** Seeded value noise + two sine ridges: a deterministic stand-in for a rock texture. */
function graniteFixture(width: number, height: number): RgbaImage {
  let s = 0x9e3779b9;
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    const t = Math.imul(s ^ (s >>> 15), 1 | s);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = 128 + Math.sin(x * 0.4) * 40 + Math.cos(y * 0.3) * 40 + rnd() * 30;
      data[i] = v;
      data[i + 1] = v - 10;
      data[i + 2] = v - 20;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

const sha = (data: Uint8ClampedArray): string =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

/** Every flag flipped and the thickness/blur branches taken, to cover paths the presets skip. */
const ALL_BRANCHES: MaterialStudioMapParams = {
  heightBlur: 2,
  heightContrast: 0.9,
  heightInvert: true,
  normalStrength: 150,
  normalFormat: NormalMapFormat.DIRECTX,
  normalInvertR: true,
  specContrast: 0,
  specThresh: 40,
  specInvert: true,
  roughGamma: 1.5,
  roughInvert: true,
  aoSoft: 5,
  aoFine: 0.5,
  aoLevel: 40,
  edgeThresh: 95,
  edgeThick: 3,
  edgeInvert: false,
};

const GOLDEN: ReadonlyArray<[string, MaterialStudioMapParams, Record<string, string>]> = [
  [
    "default preset",
    MATERIAL_STUDIO_PRESETS.default,
    {
      height: "3acdec8cb53c60f6",
      normal: "262ec51f51fdd1cf",
      specular: "bb29e7241571cd96",
      roughness: "5604754af1337004",
      ao: "75b9f130343464a0",
      edge: "4e864bbe561071fc",
    },
  ],
  [
    "stone preset",
    MATERIAL_STUDIO_PRESETS.stone,
    {
      height: "8925cc7f586b1abb",
      normal: "664729b6dc3289f3",
      specular: "2429fcaa410b5e9c",
      roughness: "85c2f6547c4ccb68",
      ao: "ecdd92340e07e0ea",
      edge: "97a7a610c19b9c21",
    },
  ],
  [
    "all flags flipped, DirectX normals",
    ALL_BRANCHES,
    {
      height: "0d5c9ce0afe7033e",
      normal: "217037b68caf828f",
      specular: "efbd63f2b1e2d4fd",
      roughness: "bb10e7222c1ad5fe",
      ao: "21c29495b393f15c",
      edge: "493a88b198ab0833",
    },
  ],
];

describe("core/material golden maps (legacy pbr-gen pipeline)", () => {
  const image = graniteFixture(48, 40);

  it.each(GOLDEN)("%s reproduces the legacy maps byte for byte", (_name, params, expected) => {
    const maps = derivePbrMaps(image, params);
    const actual = Object.fromEntries(
      (["height", "normal", "specular", "roughness", "ao", "edge"] as const).map((key) => [
        key,
        sha(maps[key].data),
      ]),
    );
    expect(actual).toEqual(expected);
  });
});
