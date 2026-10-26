import { describe, expect, it } from "vitest";
import { TextureArray, VERTEX_COLOR_FLAG } from "@small-world-machine/engine";
import { BlockMaterial } from "../voxel/material/BlockMaterial.js";

function makeAtlas(): TextureArray {
  const layer = { width: 16, height: 16 } as ImageBitmap;
  return TextureArray.fromImages([layer, layer, layer]);
}

describe("BlockMaterial (WebGPU array texture + dynamic lanes)", () => {
  it("binds the palette as u_diffuseMap, the one name WebGPU binds as texture_2d_array", () => {
    const atlas = makeAtlas();
    const manifest = new BlockMaterial(atlas).getRenderManifest();
    expect(manifest.textures["u_diffuseMap"]).toBe(atlas);
  });

  it("flags the array texture and the vertex colours (layer / AO / light ride in a_color)", () => {
    const flags = new BlockMaterial(makeAtlas()).getRenderManifest().flags;
    expect(flags).toContain("USE_TEXTURE_ARRAY");
    expect(flags).toContain(VERTEX_COLOR_FLAG);
  });

  it("offers a WGSL and a GLSL300 shader pair", () => {
    const sources = new BlockMaterial(makeAtlas()).getShaderDefinition().sources;
    expect(sources.wgsl).toContain("texture");
    expect(sources.glsl300?.vs).toBeDefined();
    expect(sources.glsl300?.fs).toBeDefined();
  });

  it("writes daylight, sun direction and light tint into the shared lanes in place", () => {
    const material = new BlockMaterial(makeAtlas());
    const first = material.getRenderManifest().properties as Record<string, number[]>;
    const lane0 = first["u_matParam0"]!;
    const lane1 = first["u_matParam1"]!;

    material.setDaylight(0.4);
    material.setSunDirection([0.1, 0.9, 0.2]);
    material.setLightTint(1, 0.8, 0.6);

    const next = material.getRenderManifest().properties as Record<string, number[]>;
    expect(next["u_matParam0"]).toBe(lane0); // same array: nothing allocates per frame
    expect(next["u_matParam1"]).toBe(lane1);
    expect(lane0).toEqual([0.4, 0.1, 0.9, 0.2]);
    expect(lane1.slice(0, 3)).toEqual([1, 0.8, 0.6]);
  });

  it("declares the packed standard layout and the palette slot", () => {
    const layout = new BlockMaterial(makeAtlas()).getShaderDefinition().layout;
    expect(layout.uniformLayout).toContain("u_matParam0");
    expect(layout.uniformLayout).toContain("u_matParam1");
    expect(layout.textures).toHaveProperty("u_diffuseMap");
  });
});
