import { Cube, Object3D } from "@small-world-machine/engine";
import type { AbstractMaterial } from "@small-world-machine/engine";

/**
 * Single unit cube geometry shared by every `box(...)` call. The showcases previously created one
 * shared cube geometry and re-used it across many objects; keeping this as a module-level singleton
 * preserves that behavior (one geometry, many instances) instead of allocating one per box.
 */
const UNIT_CUBE_GEOMETRY = new Cube({ size: 1 }).getGeometryData();

/**
 * Shadow-figur flags for the shared primitive helpers.
 */
export interface PrimShadowOptions {
  /** Whether the primitive casts shadows on other geometry. Defaults to false. */
  cast?: boolean;
  /** Whether the primitive can receive shadows. Defaults to false. */
  receive?: boolean;
}

/**
 * Builds a unit-cube `Object3D` scaled to `size` and placed at `position`, carrying `material`.
 * Collapses the repetitive `new Object3D(...) + geometry + scale/position + cast/receive +
 * scene.add` boilerplate the showcases copy/pasted. The caller decides where the object lands
 * (direct `scene.add(...)` or as a child of a group).
 * @param name Object name (also its scene-graph identity for e.g. lookup code).
 * @param material Surface material to assign.
 * @param size Scale triple `[sx, sy, sz]`.
 * @param position Local position triple `[px, py, pz]`. Defaults to the origin.
 * @param options Shadow flags (`cast`/`receive`).
 * @returns The configured, NOT yet attached object.
 */
export function box(
  name: string,
  material: AbstractMaterial,
  size: readonly [number, number, number],
  position: readonly [number, number, number] = [0, 0, 0],
  options: PrimShadowOptions = {},
): Object3D {
  const obj = new Object3D(name);
  obj.geometry = UNIT_CUBE_GEOMETRY;
  obj.material = material;
  obj.scale.set(size[0], size[1], size[2]);
  obj.position.set(position[0], position[1], position[2]);
  obj.castShadow = options.cast ?? false;
  obj.receiveShadow = options.receive ?? false;
  return obj;
}
