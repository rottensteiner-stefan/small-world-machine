import { describe, expect, it } from "vitest";
import {
  cloneTextureTransforms,
  DepthMaterial,
  hasAnyTextureTransform,
  isIdentityTextureTransform,
  packUvTransformSlot,
  StandardMaterial,
  TEXTURE_SLOT_INDEX,
  TEXTURE_SLOT_ORDER,
  textureTransformCacheKey,
  UV_TRANSFORM_FLOAT_COUNT,
  UV_TRANSFORM_VEC4_COUNT,
} from "../../../src/core/materials/index.js";
import { EvsmMomentMaterial } from "../../../src/core/materials/EvsmMomentMaterial.js";
import { Texture } from "../../../src/core/textures/index.js";
import { Object3D } from "../../../src/core/Object3D.js";
import { ShaderFlag } from "../../../src/enums/index.js";
import { AlphaCutoutGroups } from "../../../src/renderers/passes/AlphaCutoutGroups.js";

describe("TextureTransform layout & math helpers", () => {
  it("matches the 19-slot (38 vec4 / 152 float) shader contract", () => {
    expect(TEXTURE_SLOT_ORDER.length).toBe(19);
    expect(UV_TRANSFORM_VEC4_COUNT).toBe(38);
    expect(UV_TRANSFORM_FLOAT_COUNT).toBe(152);
    for (let i = 0; i < TEXTURE_SLOT_ORDER.length; i++) {
      expect(TEXTURE_SLOT_INDEX[TEXTURE_SLOT_ORDER[i]!]).toBe(i);
    }
  });

  it("packs explicit transform parameters with trig rotation and falls back cleanly", () => {
    const out = new Float32Array(UV_TRANSFORM_FLOAT_COUNT);
    const angle = Math.PI / 3;
    packUvTransformSlot(out, TEXTURE_SLOT_INDEX.normal, {
      offset: [0.25, -0.5],
      scale: [2, 3],
      rotation: angle,
      texCoord: 1,
    });
    const base = TEXTURE_SLOT_INDEX.normal * 8;
    expect(out[base]).toBeCloseTo(0.25);
    expect(out[base + 1]).toBeCloseTo(-0.5);
    expect(out[base + 2]).toBeCloseTo(2);
    expect(out[base + 3]).toBeCloseTo(3);
    expect(out[base + 4]).toBeCloseTo(Math.cos(angle));
    expect(out[base + 5]).toBeCloseTo(Math.sin(angle));
    expect(out[base + 6]).toBe(1);
    expect(out[base + 7]).toBe(0);

    const tex = Texture.fromImage({} as ImageBitmap);
    tex.offset = { x: 0.1, y: 0.2 };
    tex.repeat = { x: 4, y: 5 };
    tex.rotation = 0.5;
    packUvTransformSlot(out, TEXTURE_SLOT_INDEX.diffuse, undefined, tex);
    expect(out[0]).toBeCloseTo(0.1);
    expect(out[1]).toBeCloseTo(0.2);
    expect(out[2]).toBeCloseTo(4);
    expect(out[3]).toBeCloseTo(5);
    expect(out[4]).toBeCloseTo(Math.cos(0.5));
    expect(out[5]).toBeCloseTo(Math.sin(0.5));
    expect(out[6]).toBe(0);
  });

  it("classifies identity transforms, deep clones, and formats distinct cache keys", () => {
    expect(isIdentityTextureTransform(undefined)).toBe(true);
    expect(
      isIdentityTextureTransform({ offset: [0, 0], scale: [1, 1], rotation: 0, texCoord: 0 }),
    ).toBe(true);
    expect(isIdentityTextureTransform({ texCoord: 1 })).toBe(false);
    expect(hasAnyTextureTransform({ ao: { texCoord: 1 } })).toBe(true);
    expect(hasAnyTextureTransform({ ao: { scale: [1, 1] } })).toBe(false);

    const src = {
      diffuse: { offset: [0.2, 0.3] as [number, number], scale: [2, 2] as [number, number] },
    };
    const copy = cloneTextureTransforms(src)!;
    copy.diffuse!.offset![0] = 0.9;
    expect(src.diffuse.offset[0]).toBe(0.2);

    expect(textureTransformCacheKey(undefined)).toBe(textureTransformCacheKey({ scale: [1, 1] }));
    expect(textureTransformCacheKey({ offset: [0.5, 0] })).not.toBe(
      textureTransformCacheKey({ texCoord: 1 }),
    );
  });
});

describe("Material UV_TRANSFORMS mode transitions", () => {
  it("transitions StandardMaterial between per-slot u_uvTransforms and legacy texture UV state cleanly", () => {
    const tex = Texture.fromImage({} as ImageBitmap);
    tex.offset = { x: 0.4, y: 0.6 };
    tex.repeat = { x: 3, y: 2 };
    tex.rotation = 0.3;

    const mat = new StandardMaterial({ diffuseMap: tex, emissiveMap: tex });
    const initial = mat.getRenderManifest();
    expect(initial.flags).not.toContain(ShaderFlag.UV_TRANSFORMS);
    expect(initial.flags).not.toContain(ShaderFlag.UV1);
    expect(initial.properties["u_uvTransforms"]).toBeUndefined();
    expect(initial.properties["u_texOffset"]).toEqual([0.4, 0.6]);
    expect(initial.properties["u_texRepeat"]).toEqual([3, 2]);
    expect(initial.properties["u_texRotation"]).toBeCloseTo(0.3);

    mat.textureTransforms = {
      diffuse: { offset: [0.1, 0.2], scale: [2, 4] },
      emissive: { texCoord: 1 },
    };
    const transformed = mat.getRenderManifest();
    expect(transformed.flags).toContain(ShaderFlag.UV_TRANSFORMS);
    expect(transformed.flags).toContain(ShaderFlag.UV1);
    expect(transformed.properties["u_texOffset"]).toEqual([0, 0]);
    expect(transformed.properties["u_texRepeat"]).toEqual([1, 1]);
    expect(transformed.properties["u_texRotation"]).toBe(0);

    const packed = transformed.properties["u_uvTransforms"] as Float32Array;
    expect(packed.length).toBe(UV_TRANSFORM_FLOAT_COUNT);
    expect(packed[0]).toBeCloseTo(0.1);
    expect(packed[2]).toBeCloseTo(2);
    expect(packed[TEXTURE_SLOT_INDEX.emissive * 8 + 6]).toBe(1);

    const cloned = mat.clone();
    cloned.textureTransforms!.diffuse!.offset![0] = 0.8;
    expect(mat.textureTransforms.diffuse!.offset![0]).toBeCloseTo(0.1);

    mat.textureTransforms = undefined;
    const reverted = mat.getRenderManifest();
    expect(reverted.flags).not.toContain(ShaderFlag.UV_TRANSFORMS);
    expect(reverted.flags).not.toContain(ShaderFlag.UV1);
    expect(reverted.properties["u_uvTransforms"]).toBeUndefined();
    expect(reverted.properties["u_texOffset"]).toEqual([0.4, 0.6]);
    expect(reverted.properties["u_texRepeat"]).toEqual([3, 2]);
  });

  it("toggles UV_TRANSFORMS and UV1 on DepthMaterial and EvsmMomentMaterial only for cutout transforms", () => {
    const tex = Texture.fromImage({} as ImageBitmap);
    for (const mat of [new DepthMaterial(), new EvsmMomentMaterial()]) {
      mat.diffuseMap = tex;
      mat.alphaTest = 0.5;
      mat.diffuseTransform = { offset: [0.5, 0], texCoord: 1 };
      const cutout = mat.getRenderManifest();
      expect(cutout.flags).toContain(ShaderFlag.UV_TRANSFORMS);
      expect(cutout.flags).toContain(ShaderFlag.UV1);
      expect((cutout.properties["u_uvTransforms"] as Float32Array)[0]).toBeCloseTo(0.5);
      expect((cutout.properties["u_uvTransforms"] as Float32Array)[6]).toBe(1);

      mat.diffuseMap = undefined;
      mat.diffuseTransform = undefined;
      mat.alphaTest = 0;
      const opaque = mat.getRenderManifest();
      expect(opaque.flags).not.toContain(ShaderFlag.UV_TRANSFORMS);
      expect(opaque.flags).not.toContain(ShaderFlag.UV1);
      expect(opaque.properties["u_uvTransforms"]).toBeUndefined();
    }
  });
});

describe("AlphaCutoutGroups pass splitting", () => {
  it("isolates shared textures with differing transforms/cutoffs and preserves stable groupUuids across recycle", () => {
    const groups = new AlphaCutoutGroups();
    const sharedTex = Texture.fromImage({} as ImageBitmap);
    const objA1 = new Object3D();
    const objA2 = new Object3D();
    const objB = new Object3D();
    const objC = new Object3D();

    groups.add(objA1, sharedTex, 0.5, { offset: [0.5, 0] });
    groups.add(objA2, sharedTex, 0.5, { offset: [0.5, 0] });
    groups.add(objB, sharedTex, 0.5, { texCoord: 1 });
    groups.add(objC, sharedTex, 0.8, { offset: [0.5, 0] });

    expect(groups.active.length).toBe(3);
    expect(groups.active[0]!.standard).toEqual([objA1, objA2]);
    const uuids = groups.active.map((g) => g.groupUuid);
    expect(new Set(uuids).size).toBe(3);

    groups.recycle();
    expect(groups.active.length).toBe(0);

    groups.add(objB, sharedTex, 0.5, { texCoord: 1 });
    expect(groups.active.length).toBe(1);
    expect(groups.active[0]!.groupUuid).toBe(uuids[1]);
  });
});
