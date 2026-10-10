import { Object3D } from "../Object3D.js";
import { InspectorField } from "../Inspectable.js";
import { StageZone } from "./StageZone.js";

/**
 * The scene-graph presence for a `StageZone`: a non-renderable marker node (no geometry/material
 * -- consistent with how Maker represents other non-renderable helpers) that carries a `StageZone`
 * instance so it can be selected, listed in Maker's hierarchy panel, and round-tripped through
 * glTF as an `SWM_stage_zone` extension (see ADR 0016). Composition rather than
 * `StageZone extends Object3D`: `StageZone` itself stays a pure data/math class consumed at
 * runtime purely through `containsPoint`/`getScaleAt`/`getLocalAxes` (never through a transform
 * or children), matching `StageMovementBehaviorOptions.zones: StageZone[]`'s existing shape.
 */
export class StageZoneMarker extends Object3D {
  /** Inspector schema for StageZoneMarker properties (the point-list itself is edited via
   * Maker's dedicated `StageZone` property-panel block, not this generic schema -- see ADR 0016
   * Phase 2). */
  public static override readonly inspector: Record<string, InspectorField> = {
    "zone.name": { type: "string", label: "Display Name", path: "zone.name" },
  };

  public zone: StageZone;

  constructor(zone: StageZone) {
    super(zone.id);
    this.zone = zone;
  }

  /** Deep-clones the held `StageZone` (including its `points` array) so that duplicating a
   * marker in Maker never leaves two markers sharing the same point list -- the generic
   * `Object3D.clone()`/`shallowCloneWithValueTypes` only deep-clones recognized value types
   * (`Vector2D/3D`, `Quaternion`, `Color`) and plain object literals, not arbitrary class
   * instances like `StageZone`. */
  public override clone(): StageZoneMarker {
    const copy = super.clone() as StageZoneMarker;
    copy.zone = new StageZone({
      id: this.zone.id,
      name: this.zone.name,
      points: this.zone.points.map((p) => ({ ...p })),
    });
    return copy;
  }
}
