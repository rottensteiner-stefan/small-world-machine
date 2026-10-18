/**
 * Exact-token PBR texture-slot detection for kit texture directories.
 *
 * Mirrors the filename conventions of `packages/tools/src/common/io/PbrSlotMatcher.ts`
 * (trailing token wins; the anchored patterns only match whole tokens flanked by
 * separators/word boundaries, never a bare substring), but covers only the five
 * channels the Maker / kit-inspector loaders consume today. Kept in the engine
 * (not imported from tools) so `@small-world-machine/engine` stays dependency-free
 * of the tools package.
 */

export type TextureMapSlot = "albedo" | "normal" | "roughness" | "ao" | "metalness";

const TEXTURE_SLOT_PATTERNS: Record<TextureMapSlot, RegExp> = {
  albedo: /(?:_|\b)(?:albedo|alb|basecolor|base_color|color|col|diffuse|diff|d)(?:_|\.|$)/i,
  normal: /(?:_|\b)(?:normal|norm|nor|nrm|normalgl|normaldx|n)(?:_|\.|$)/i,
  roughness: /(?:_|\b)(?:roughness|rough|rgh|r)(?:_|\.|$)/i,
  metalness: /(?:_|\b)(?:metallic|metalness|metal|met|m)(?:_|\.|$)/i,
  ao: /(?:_|\b)(?:ao|ambientocclusion|ambient_occlusion|occlusion|occ)(?:_|\.|$)/i,
};

/** First match wins; `albedo` last so a multi-channel file's slot is unambiguous. */
const SLOT_PRIORITY: readonly TextureMapSlot[] = [
  "normal",
  "roughness",
  "metalness",
  "ao",
  "albedo",
];

/**
 * Detects which PBR slot a filename belongs to. The trailing token wins
 * (`m_albedo.png` is albedo, not metallic); only if it names no slot is a
 * whole-token keyword match anywhere in the name accepted (`brick_ao_2k.png`
 * is AO). Substring false positives are impossible: `ao` inside `saos` is not
 * a token, so `saos.png` matches nothing.
 */
export function detectTextureMapSlot(filename: string): TextureMapSlot | undefined {
  const base = filename.replace(/\.[^/.]+$/, "");
  const lastToken = base.split(/[_\-. ]+/).pop() ?? "";
  for (const slot of SLOT_PRIORITY) {
    if (TEXTURE_SLOT_PATTERNS[slot].test(`_${lastToken}.`)) return slot;
  }
  return SLOT_PRIORITY.find((slot) => TEXTURE_SLOT_PATTERNS[slot].test(filename));
}

/**
 * Picks the filename of the first map for `slot` from a kit texture item's
 * `maps` list (exact-token match, deduplicated -- the first file that maps to
 * the slot wins). Returns `undefined` when no file maps to the slot.
 */
export function pickKitTextureMap(
  maps: readonly string[],
  slot: TextureMapSlot,
): string | undefined {
  return maps.find((file) => detectTextureMapSlot(file) === slot);
}
