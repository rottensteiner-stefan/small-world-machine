import { beforeAll, describe, expect, it } from "vitest";
import {
  BlendingMode,
  ImposterSprite,
  SpriteMaterial,
  ShaderRegistry,
} from "../../../src/index.js";
import { ShaderBootstrap } from "../../../src/renderers/shaders/ShaderBootstrap.js";
import { Texture } from "../../../src/core/textures/Texture.js";

const testShaderRegistry = new ShaderRegistry();

class MockTexture extends Texture {
  constructor() {
    super();
  }
}

function mockTex(): Texture {
  return new MockTexture();
}

/**
 * Regression guard for "grass tufts visible through the billboard trees" (Showcase 34):
 * an ImposterSprite must render as an OPAQUE, depth-writing alpha-cutout surface so its
 * billboard occludes the grass and props behind it, instead of blending into the transparent
 * pass without writing depth (which let anything behind it show straight through the trunk).
 */
describe("SpriteMaterial alphaTest cutout mode", () => {
  it("stays alpha-blended without depth-write by default (unchanged)", () => {
    const mat = new SpriteMaterial({ texture: mockTex() });
    const state = mat.getRenderManifest().state!;
    expect(mat.transparent).toBe(true);
    expect(mat.alphaTest).toBe(0);
    expect(state.transparent).toBe(true);
    expect(state.blending).toBe(BlendingMode.ALPHA);
    expect(state.depthWrite).toBe(false);
  });

  it("becomes an opaque, depth-writing cutout surface when alphaTest > 0", () => {
    const mat = new SpriteMaterial({ texture: mockTex(), alphaTest: 0.5 });
    const manifest = mat.getRenderManifest();
    expect(mat.transparent).toBe(false);
    expect(mat.alphaTest).toBe(0.5);
    expect(manifest.state!.transparent).toBe(false);
    expect(manifest.state!.blending).toBe(BlendingMode.OPAQUE);
    expect(manifest.state!.depthWrite).toBe(true);
    expect((manifest.properties!["u_extraParams"] as number[])[1]).toBe(0.5);
  });

  it("is never transparent once cutout is set, even if transparent is requested", () => {
    const mat = new SpriteMaterial({ texture: mockTex(), transparent: true, alphaTest: 0.3 });
    expect(mat.transparent).toBe(false);
    expect(mat.getRenderManifest().state!.transparent).toBe(false);
    expect(mat.getRenderManifest().state!.depthWrite).toBe(true);
  });

  it("ImposterSprite defaults to an opaque cutout surface (no see-through billboards)", () => {
    const textures = [mockTex(), mockTex()];
    const sprite = new ImposterSprite("Tree", textures);
    const mat = sprite.material as SpriteMaterial;
    const manifest = mat.getRenderManifest();
    expect(mat.alphaTest).toBe(0.5);
    expect(mat.transparent).toBe(false);
    expect(manifest.state!.transparent).toBe(false);
    expect(manifest.state!.blending).toBe(BlendingMode.OPAQUE);
    expect(manifest.state!.depthWrite).toBe(true);
    expect((manifest.properties!["u_extraParams"] as number[])[1]).toBe(0.5);
  });
});

describe("Sprite cutout discard (all backends)", () => {
  beforeAll(async () => {
    await ShaderBootstrap.init(testShaderRegistry);
  });

  it("ties the cutout discard to the material threshold on every backend", () => {
    const sources = new SpriteMaterial({ texture: mockTex(), alphaTest: 0.5 }).getShaderDefinition()
      .sources;

    // WGSL: threshold-driven via obj.extraParams.y (the material's alphaTest).
    const wgsl = testShaderRegistry.assemble(sources.wgsl as string, "wgsl");
    expect(wgsl).toContain("obj.extraParams.y");
    expect(wgsl).not.toMatch(/\[[A-Z][A-Z0-9_]{2,}\]/);

    for (const lang of ["glsl300", "glsl100"] as const) {
      const gl = testShaderRegistry.assemble(sources[lang]!.fs, lang);
      // The GLSL base headers declare u_extraParams; the discard must use it, never a
      // hard-coded constant (blended sprites keep threshold 0 and must not discard).
      expect(gl).toContain("u_extraParams.y");
      expect(gl).toContain("discard");
      expect(gl).not.toMatch(/\[[A-Z][A-Z0-9_]{2,}\]/);
    }
  });
});
