import { Vector2D, Vector3D, Quaternion, MathUtils } from "../math/index.js";
import { Color } from "./colors/index.js";

/**
 * Shallow-clones `source` (same runtime prototype via `Object.create`, every own enumerable
 * property copied via `Object.assign`), then fixes up the things a blind shallow copy gets
 * wrong for `Object3D`/`AbstractMaterial`/`Behavior` in this engine:
 * - Any own property that is a value type (`Vector2D`, `Vector3D`, `Quaternion`, `Color`) is deep-cloned.
 * - Any own Array / TypedArray property is cloned (with value-type elements inside Arrays cloned).
 * - Any plain object literal is shallow-cloned (`{ ...value }`, one level deep only -- a
 *   `Vector3D`/`Quaternion`/`Color` nested *inside* a plain-object field would still be shared
 *   across both copies; no such field exists in the engine today, but a future one would need
 *   this function taught to recurse, or to clone that field itself before/after calling this).
 * - An own `uuid: string` property is regenerated, so the copy gets its own identity.
 *
 * Everything else -- geometry data, textures, enum/primitive fields -- stays shared by
 * reference, which is the correct default: geometry/texture data is immutable, and sharing it
 * across duplicated objects is standard practice, not a bug.
 *
 * Callers (`Object3D.clone()`, `AbstractMaterial.clone()`, `Behavior.clone()`) each still need to
 * fix up their own class-specific reference fields this can't know about generically -- e.g.
 * `Object3D.clone()` must still deep-clone `children`/`behaviors`/`material` and reset `parent`/
 * `bounds`/the transform matrices itself.
 */
export function shallowCloneWithValueTypes<T extends object>(source: T): T {
  const copy = Object.create(Object.getPrototypeOf(source) as object) as T;
  Object.assign(copy, source);

  for (const key of Object.keys(copy) as (keyof T)[]) {
    const value = copy[key];
    if (null === value || undefined === value) {
      continue;
    }

    if (
      value instanceof Vector2D ||
      value instanceof Vector3D ||
      value instanceof Quaternion ||
      value instanceof Color
    ) {
      copy[key] = (value as unknown as { clone(): unknown }).clone() as T[keyof T];
    } else if (Array.isArray(value)) {
      copy[key] = value.map((item) => {
        if (
          item instanceof Vector2D ||
          item instanceof Vector3D ||
          item instanceof Quaternion ||
          item instanceof Color
        ) {
          return item.clone();
        }
        return item;
      }) as unknown as T[keyof T];
    } else if (
      ArrayBuffer.isView(value) &&
      "slice" in value &&
      typeof (value as { slice?: unknown }).slice === "function"
    ) {
      copy[key] = (value as unknown as { slice(): unknown }).slice() as T[keyof T];
    } else if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      copy[key] = { ...value } as T[keyof T];
    }
  }

  if ("uuid" in copy && "string" === typeof (copy as { uuid?: unknown }).uuid) {
    (copy as { uuid: string }).uuid = MathUtils.generateUUID();
  }

  return copy;
}
