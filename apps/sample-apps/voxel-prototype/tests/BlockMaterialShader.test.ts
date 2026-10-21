import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fragSource = readFileSync(
  new URL("../voxel/material/shaders/BlockMaterial.frag.glsl", import.meta.url),
  "utf8",
);

describe("BlockMaterial fragment lighting", () => {
  it("keeps the ambient floor inside the direct term (faces with ndl == 0 must not go black)", () => {
    expect(fragSource).toMatch(/\(ambient \+ \(1\.0 - ambient\) \* ndl\)/);
    expect(fragSource).not.toMatch(/\*\s*ndl\s*\*\s*lightFactor/);
  });
});
