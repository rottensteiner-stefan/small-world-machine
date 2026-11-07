import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const GLASS_DIR = join(__dirname, "../../../src/core/materials/glass/shaders");

// `Out.uv` already carries repeat, rotation and offset (base.vert.wgsl). A fragment-side
// `i.uv / obj.texRepeat` would silently drop rotation/offset; the untransformed UV is the
// vertex output `i.original_uv`. Glass/Frostglass sample only `i.uv` (normal map), so neither
// shader may re-derive an "original" UV by division.
describe.each(["Glass", "Frostglass"])("%s fragment UV usage", (name) => {
  const wgsl = readFileSync(join(GLASS_DIR, `${name}.frag.wgsl`), "utf8");

  it("does not re-derive the untransformed UV from i.uv / texRepeat", () => {
    expect(wgsl).not.toMatch(/i\.uv\s*\/\s*obj\.texRepeat/);
  });

  it("samples the normal map with the transformed i.uv", () => {
    expect(wgsl).toMatch(/textureSample\(u_normalMap,\s*s,\s*i\.uv\)/);
  });
});
