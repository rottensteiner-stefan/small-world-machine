import { Object3D } from "../Object3D.js";
import { Cube } from "../../geometry/index.js";
import { OBB } from "../../physix/index.js";
import type { AbstractMaterial } from "../materials/index.js";
import type { InspectorField } from "../Inspectable.js";
import type { GeometryDataInterface } from "../../interfaces/index.js";

let _sharedBox: GeometryDataInterface | undefined;
let _nextSequence = 0;

/**
 * A box-projected decal. The unit box spans [-0.5, 0.5] on every axis and `scale` is its world
 * size; the projection axis is local -Y (+Y is the decal's "up", i.e. the receiving surface's
 * normal) and the decal texture maps onto box x/z. The material (`DecalMaterial`) reads the
 * already-rendered opaque depth and draws only where the box intersects that geometry.
 */
export class Decal extends Object3D {
  /** Own fields on top of `Object3D.inspector`; the material ones are reached via `path` (the host is always a `DecalMaterial`). */
  public static override readonly inspector: Record<string, InspectorField> = {
    priority: { type: "number", label: "Priority", step: 1 },
    opacity: {
      type: "number",
      label: "Opacity",
      min: 0,
      max: 1,
      step: 0.01,
      path: "material.color.a",
    },
    edgeFade: {
      type: "number",
      label: "Edge Fade",
      min: 0,
      max: 0.5,
      step: 0.01,
      path: "material.edgeFade",
    },
    angleFadeStart: {
      type: "number",
      label: "Angle Fade Start",
      min: 0,
      max: 90,
      step: 1,
      path: "material.angleFadeStart",
    },
    angleFadeEnd: {
      type: "number",
      label: "Angle Fade End",
      min: 0,
      max: 90,
      step: 1,
      path: "material.angleFadeEnd",
    },
  };

  /** Explicit stacking override: higher values draw later, i.e. on top of lower ones. */
  public priority: number = 0;
  private _sequence: number = _nextSequence++;
  /** Creation order (or the last `restack()`), the deterministic last tie-break of the stacking order. */
  public get sequence(): number {
    return this._sequence;
  }
  /** Namespaced kit decal id (`kit/id`) this decal was placed from; what `SWM_decal` persists and `KitRegistry.hydrateDecal` resolves. */
  public kitDecal: string | undefined;

  constructor(material: AbstractMaterial, name: string = "Decal") {
    super(name);
    _sharedBox ??= new Cube({ size: 1 }).getGeometryData();
    this.geometry = _sharedBox;
    this.material = material;
    // A decal is neither a physics collider nor a raycast target. Its OBB bounds below exist only
    // so frustum culling and the octree work; with `isCollidable = false` the base class would
    // leave `bounds` undefined and the decal would never be culled.
    this.isCollidable = false;
    this.castShadow = false;
    this.receiveShadow = false;
  }

  /** Moves this decal to the top of its stacking tier, as if it had just been created (a recycled `DecalPool` decal must land above the newer ones). */
  public restack(): void {
    this._sequence = _nextSequence++;
  }

  /** @inheritdoc */
  public override computeBounds(): this {
    const obb = this.bounds instanceof OBB ? this.bounds : new OBB();
    obb.setLocalCenter(0, 0, 0);
    obb.setLocalHalfExtents(0.5, 0.5, 0.5);
    obb.transform(this.worldMatrix);
    this.bounds = obb;
    return this;
  }
}
