import type { Texture } from "../textures/index.js";

/**
 * Canonical ordered list of material texture slots indexed by `u_uvTransforms` (two `vec4` entries
 * per slot, `UV_TRANSFORM_VEC4_COUNT = 38`). Must stay 1:1 with the slot indices in all shaders.
 */
export const TEXTURE_SLOT_ORDER = [
  "diffuse",
  "normal",
  "metallic",
  "roughness",
  "ao",
  "emissive",
  "alpha",
  "specular",
  "specularColor",
  "clearcoat",
  "clearcoatRoughness",
  "clearcoatNormal",
  "sheenColor",
  "sheenRoughness",
  "transmission",
  "thickness",
  "anisotropy",
  "iridescence",
  "iridescenceThickness",
] as const;

/** Valid texture slot name for per-slot UV transforms (`StandardMaterial.textureTransforms`). */
export type TextureSlotName = (typeof TEXTURE_SLOT_ORDER)[number];

/** Slot index lookup (`0..18`) into `u_uvTransforms`. */
export const TEXTURE_SLOT_INDEX: Readonly<Record<TextureSlotName, number>> = {
  diffuse: 0,
  normal: 1,
  metallic: 2,
  roughness: 3,
  ao: 4,
  emissive: 5,
  alpha: 6,
  specular: 7,
  specularColor: 8,
  clearcoat: 9,
  clearcoatRoughness: 10,
  clearcoatNormal: 11,
  sheenColor: 12,
  sheenRoughness: 13,
  transmission: 14,
  thickness: 15,
  anisotropy: 16,
  iridescence: 17,
  iridescenceThickness: 18,
};

/** Total number of `vec4` registers in `u_uvTransforms` (19 slots × 2 vec4). */
export const UV_TRANSFORM_VEC4_COUNT = TEXTURE_SLOT_ORDER.length * 2;

/** Total number of floats in the packed `u_uvTransforms` uniform buffer (`38 × 4 = 152`). */
export const UV_TRANSFORM_FLOAT_COUNT = UV_TRANSFORM_VEC4_COUNT * 4;

/**
 * Per-slot UV transform matching glTF 2.0 `KHR_texture_transform` and `textureInfo.texCoord`:
 * `uv' = offset + R(rotation) * (scale * uv_texCoord)`.
 */
export interface TextureTransform {
  /** UV translation added after scale and rotation. Defaults to `[0, 0]`. */
  offset?: [number, number];
  /** UV scale applied before rotation. Defaults to `[1, 1]`. */
  scale?: [number, number];
  /** Counter-clockwise UV rotation in radians around UV origin. Defaults to `0`. */
  rotation?: number;
  /** Texture coordinate set index (`0` = `TEXCOORD_0`, `1` = `TEXCOORD_1`). Defaults to `0`. */
  texCoord?: number;
}

/** Texture-like fallback carrying legacy per-texture `offset`, `repeat`, and `rotation`. */
export type TextureUvFallback = Pick<Texture, "offset" | "repeat" | "rotation">;

/** Returns `true` when `t` represents the identity UV transform on `TEXCOORD_0`. */
export function isIdentityTextureTransform(t: TextureTransform | undefined): boolean {
  if (!t) return true;
  const ox = t.offset?.[0] ?? 0;
  const oy = t.offset?.[1] ?? 0;
  const sx = t.scale?.[0] ?? 1;
  const sy = t.scale?.[1] ?? 1;
  const rot = t.rotation ?? 0;
  const tc = t.texCoord ?? 0;
  return ox === 0 && oy === 0 && sx === 1 && sy === 1 && rot === 0 && tc === 0;
}

/** Returns `true` when any slot in `transforms` is non-identity (or selects `texCoord !== 0`). */
export function hasAnyTextureTransform(
  transforms: Partial<Record<TextureSlotName, TextureTransform>> | undefined,
): boolean {
  if (!transforms) return false;
  for (let i = 0; i < TEXTURE_SLOT_ORDER.length; i++) {
    const slot = TEXTURE_SLOT_ORDER[i]!;
    if (!isIdentityTextureTransform(transforms[slot])) return true;
  }
  return false;
}

/**
 * Packs one texture slot into `out` at `slotIndex * 8` (2 `vec4` entries:
 * `[offsetX, offsetY, scaleX, scaleY]` and `[cos(rotation), sin(rotation), texCoord, 0]`).
 * Zero-allocation hot-path helper.
 */
export function packUvTransformSlot(
  out: Float32Array,
  slotIndex: number,
  transform: TextureTransform | undefined,
  fallbackTex?: TextureUvFallback,
): void {
  const base = slotIndex * 8;
  let ox = 0;
  let oy = 0;
  let sx = 1;
  let sy = 1;
  let rot = 0;
  let tc = 0;
  if (transform) {
    ox = transform.offset?.[0] ?? 0;
    oy = transform.offset?.[1] ?? 0;
    sx = transform.scale?.[0] ?? 1;
    sy = transform.scale?.[1] ?? 1;
    rot = transform.rotation ?? 0;
    tc = transform.texCoord ?? 0;
  } else if (fallbackTex) {
    ox = fallbackTex.offset.x;
    oy = fallbackTex.offset.y;
    sx = fallbackTex.repeat.x;
    sy = fallbackTex.repeat.y;
    rot = fallbackTex.rotation ?? 0;
  }
  out[base] = ox;
  out[base + 1] = oy;
  out[base + 2] = sx;
  out[base + 3] = sy;
  if (rot !== 0) {
    out[base + 4] = Math.cos(rot);
    out[base + 5] = Math.sin(rot);
  } else {
    out[base + 4] = 1;
    out[base + 5] = 0;
  }
  out[base + 6] = tc;
  out[base + 7] = 0;
}

/** Deep-clones a `textureTransforms` map (used by `StandardMaterial.clone()`). */
export function cloneTextureTransforms(
  transforms: Partial<Record<TextureSlotName, TextureTransform>> | undefined,
): Partial<Record<TextureSlotName, TextureTransform>> | undefined {
  if (!transforms) return undefined;
  const copy: Partial<Record<TextureSlotName, TextureTransform>> = {};
  for (let i = 0; i < TEXTURE_SLOT_ORDER.length; i++) {
    const slot = TEXTURE_SLOT_ORDER[i]!;
    const t = transforms[slot];
    if (!t) continue;
    const cloned: TextureTransform = {};
    if (t.offset) cloned.offset = [t.offset[0], t.offset[1]];
    if (t.scale) cloned.scale = [t.scale[0], t.scale[1]];
    if (t.rotation !== undefined) cloned.rotation = t.rotation;
    if (t.texCoord !== undefined) cloned.texCoord = t.texCoord;
    copy[slot] = cloned;
  }
  return copy;
}

/** Stable string key for grouping cutout shadow/depth draws by `(diffuseMap, alphaTest, diffuseTransform)`. */
export function textureTransformCacheKey(t: TextureTransform | undefined): string {
  if (isIdentityTextureTransform(t)) return "id";
  const ox = t!.offset?.[0] ?? 0;
  const oy = t!.offset?.[1] ?? 0;
  const sx = t!.scale?.[0] ?? 1;
  const sy = t!.scale?.[1] ?? 1;
  const rot = t!.rotation ?? 0;
  const tc = t!.texCoord ?? 0;
  return `${ox},${oy},${sx},${sy},${rot},${tc}`;
}
