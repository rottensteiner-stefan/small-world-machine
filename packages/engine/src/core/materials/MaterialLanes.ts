import type { RenderManifest } from "../../renderers/shaders/index.js";

/**
 * Typed semantic material-lane table (ADR 0027 512-byte `u_matParam0..15` bank, extended by
 * ADR 0039 "Material-Lane-Tabellen").
 *
 * Every material that needs per-material parameters beyond the generic `ObjectUniforms` layout
 * MUST declare its own typed lane table that maps each semantic field onto a `u_matParamN` vec4
 * slot instead of reusing generic slots (`u_extraParams`, `u_liquidParams`,
 * `u_thresholds`, `u_texOffset`, `u_color.a`) for an unrelated meaning. Generic slots keep only
 * their canonical base meaning (see `AbstractMaterial._createBaseManifest`).
 *
 * The table is documentation AND machine-checked: `writeLane` packs a value into the manifest
 * through the declared lane, and the parity test suite asserts that migrated materials no longer
 * reference the deprecated magic slots.
 */
export interface MaterialLane<T extends string = string> {
  /** The semantic field name as used in material options / documentation. */
  readonly semantic: T;
  /** The concrete `u_matParamN` lane the field travels in. */
  readonly lane: `u_matParam${number}`;
  /** Optional human-readable note (component meaning, valid range, …). */
  readonly note?: string;
}

export type MaterialLaneTable<T extends string = string> = ReadonlyArray<MaterialLane<T>>;

/**
 * Packs a `[x, y, z, w]` value into `lane` on the render manifest. The lane table entry is the
 * single source of truth for where a semantic field lives, so a rename never silently detaches
 * material from shader. Returns the same array reference that is stored in the manifest.
 */
export function writeLane(
  manifest: RenderManifest,
  lane: `u_matParam${number}` | MaterialLane,
  value: readonly [number, number, number, number],
): number[] {
  const key = typeof lane === "string" ? lane : lane.lane;
  const existing = manifest.properties[key];
  if (undefined === existing) {
    const fresh = [value[0], value[1], value[2], value[3]];
    manifest.properties[key] = fresh;
    return fresh;
  }
  const arr = existing as number[];
  arr[0] = value[0];
  arr[1] = value[1];
  arr[2] = value[2];
  arr[3] = value[3];
  return arr;
}
