import { describe, it, expect } from "vitest";
import { CustomShaderMaterial, Texture, TextureArray } from "../../../src/index.js";
import { ShaderFlag } from "../../../src/enums/ShaderFlag.js";
import { resolveManifestFlags } from "../../../src/renderers/shaders/RenderManifest.js";

function makeMaterial(): CustomShaderMaterial {
  return new CustomShaderMaterial({
    sources: { wgsl: "fn test() {}" },
    layout: { uniforms: {}, textures: {} },
  });
}

describe("CustomShaderMaterial compile flags", () => {
  it("derives USE_*_MAP flags from the assigned textures", () => {
    const mat = makeMaterial();
    mat.setTexture("u_emissiveMap", Texture.empty());
    mat.setTexture("u_normalMap", Texture.empty());
    mat.setTexture("u_aoMap", undefined);
    expect(mat.getRenderManifest().flags).toEqual(["USE_EMISSIVE_MAP", "USE_NORMAL_MAP"]);
  });

  it("keeps the flags array reference while unchanged and publishes a NEW array when the flags change", () => {
    const mat = makeMaterial();
    mat.setTexture("u_emissiveMap", Texture.empty());
    const first = mat.getRenderManifest().flags;
    expect(mat.getRenderManifest().flags).toBe(first);

    mat.setTexture("u_emissiveMap", undefined);
    const second = mat.getRenderManifest();
    expect(second.flags).not.toBe(first);
    expect(second.flags).toEqual([]);
    // The previously published array is never mutated (resolveManifestFlags caches derived arrays by identity).
    expect(first).toEqual(["USE_EMISSIVE_MAP"]);
  });

  it("does not hand a stale cached resolveManifestFlags variant to a changed flag set", () => {
    const mat = new CustomShaderMaterial({
      sources: { wgsl: "fn test() {}" },
      layout: { uniforms: {}, textures: {} },
      flags: [ShaderFlag.RAMP_LUT],
    });
    mat.setTexture("u_emissiveMap", Texture.empty());
    const before = resolveManifestFlags(mat.getRenderManifest().flags, true);
    expect(before).toEqual(["USE_EMISSIVE_MAP"]);

    mat.setTexture("u_normalMap", Texture.empty());
    const after = resolveManifestFlags(mat.getRenderManifest().flags, true);
    expect(after).toContain("USE_NORMAL_MAP");
    expect(after).toContain("USE_EMISSIVE_MAP");
    expect(after).not.toContain(ShaderFlag.RAMP_LUT);
  });

  it("adds the explicitly requested flags after the texture-derived ones", () => {
    const mat = new CustomShaderMaterial({
      sources: { wgsl: "fn test() {}" },
      layout: { uniforms: {}, textures: {} },
      flags: ["USE_VERTEX_COLOR", "USE_NORMAL_MAP"],
    });
    mat.setTexture("u_normalMap", Texture.empty());
    expect(mat.getRenderManifest().flags).toEqual(["USE_NORMAL_MAP", "USE_VERTEX_COLOR"]);
  });

  it("flags a bound TextureArray as USE_TEXTURE_ARRAY (WGSL: texture_2d_array)", () => {
    const mat = makeMaterial();
    const image = { width: 16, height: 16 } as ImageBitmap;
    mat.setTexture("u_diffuseMap", TextureArray.fromImages([image, image]));
    expect(mat.getRenderManifest().flags).toContain("USE_TEXTURE_ARRAY");
    mat.setTexture("u_diffuseMap", Texture.empty());
    expect(mat.getRenderManifest().flags).not.toContain("USE_TEXTURE_ARRAY");
  });
});
