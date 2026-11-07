import { Decal } from "../../core/objects/Decal.js";
import { DecalMaterial } from "../../core/materials/surface/DecalMaterial.js";
import type { LevelDecalPlacement } from "./KitTypes.js";

/**
 * The instance data of a decal as `SWM_decal` persists it: a `LevelDecalPlacement` without the
 * parts the glTF node already carries (id = node name, position/rotation/scale = node TRS,
 * parent = node hierarchy). `size` is required here and authoritative on read.
 */
export type SwmDecalPayload = Required<Pick<LevelDecalPlacement, "kitDecal" | "size">> &
  Pick<LevelDecalPlacement, "fade" | "opacity" | "priority" | "tags">;

/** A placement with a resolved size (placement override, kit default or 1 m). */
export type SizedDecalPlacement = LevelDecalPlacement & { size: [number, number, number] };

/** Throws on a payload that can never produce a decal. */
export function validateDecalPayload(
  id: string,
  p: Pick<SizedDecalPlacement, "kitDecal" | "size" | "opacity" | "priority" | "tags">,
): void {
  if (typeof p.kitDecal !== "string" || p.kitDecal.length === 0) {
    throw new Error(`[Decal] '${id}': kitDecal must be a non-empty string.`);
  }
  if (
    !Array.isArray(p.size) ||
    p.size.length !== 3 ||
    !p.size.every((v) => Number.isFinite(v) && v > 0)
  ) {
    throw new Error(
      `[Decal] '${id}': size must be three positive finite numbers, got ${JSON.stringify(p.size)}.`,
    );
  }
  if (
    p.opacity !== undefined &&
    !(Number.isFinite(p.opacity) && p.opacity >= 0 && p.opacity <= 1)
  ) {
    throw new Error(`[Decal] '${id}': opacity must be within 0..1, got ${String(p.opacity)}.`);
  }
  if (p.priority !== undefined && !Number.isFinite(p.priority)) {
    throw new Error(`[Decal] '${id}': priority must be finite, got ${String(p.priority)}.`);
  }
  if (
    p.tags !== undefined &&
    !(Array.isArray(p.tags) && p.tags.every((t) => typeof t === "string"))
  ) {
    throw new Error(`[Decal] '${id}': tags must be an array of strings.`);
  }
}

/**
 * Builds a texture-less decal from a placement: transform, size, fade, opacity, priority and tags,
 * but no maps. `KitRegistry` fills the maps afterwards (level loading and `hydrateDecal` share
 * this shell).
 */
export function createDecalShell(placement: SizedDecalPlacement): Decal {
  validateDecalPayload(placement.id, placement);
  const fade = placement.fade;
  const material = new DecalMaterial();
  if (fade?.angleStart !== undefined) material.angleFadeStart = fade.angleStart;
  if (fade?.angleEnd !== undefined) material.angleFadeEnd = fade.angleEnd;
  if (fade?.edge !== undefined) material.edgeFade = fade.edge;
  material.color.a = placement.opacity ?? 1;

  const decal = new Decal(material, placement.id);
  decal.kitDecal = placement.kitDecal;
  const size = placement.size;
  decal.scale.set(size[0], size[2], size[1]); // [width, height, depth]: the projection axis is local Y, the image height runs along Z
  if (placement.position) {
    decal.position.set(placement.position[0], placement.position[1], placement.position[2]);
  }
  if (placement.rotation) {
    decal.rotation.set(placement.rotation[0], placement.rotation[1], placement.rotation[2]);
  }
  decal.priority = placement.priority ?? 0;
  decal.userData["tags"] = placement.tags ? [...placement.tags] : [];
  return decal;
}

/** Inverse of `createDecalShell` for the glTF payload: reads size back from the node scale. */
export function decalToPayload(decal: Decal, kitDecal: string): SwmDecalPayload {
  const material = decal.material as DecalMaterial;
  const tags = decal.userData["tags"];
  return {
    kitDecal,
    size: [decal.scale.x, decal.scale.z, decal.scale.y],
    fade: {
      angleStart: material.angleFadeStart,
      angleEnd: material.angleFadeEnd,
      edge: material.edgeFade,
    },
    opacity: material.color.a,
    priority: decal.priority,
    tags: Array.isArray(tags) ? (tags as string[]) : [],
  };
}
