import {
  Object3D,
  StageZoneMarker,
  BasicMaterial,
  WireframeMaterial,
  Color,
  CullMode,
  Octahedron,
  Polyline,
  PolygonFan,
  Vector3D,
} from "@small-world-machine/engine";
import type { StageUvProjection } from "./StageProjectionResolver.js";

const DEFAULT_COLOR = new Color(0.2, 0.85, 1.0);
const SELECTED_COLOR = new Color(1.0, 0.8, 0.2);
const FILL_ALPHA = 0.15;
const HANDLE_RADIUS = 0.08;

interface StageZoneGizmoEntry {
  marker: StageZoneMarker;
  outline: Object3D;
  outlineMat: WireframeMaterial;
  /** The actual pick target -- a filled, semi-transparent fan of real triangles (the thin
   * outline alone would give false-positive bounding-box hits on concave zones). */
  fill: Object3D;
  fillMat: BasicMaterial;
  handles: Object3D[];
  handleMat: BasicMaterial;
  /** Cheap dirty-check: rebuild the visual geometry only when a zone's points actually change,
   * not every frame. */
  lastPointsSignature: string;
}

/**
 * Manages 3D editor representations (outline, fill pick-target, per-point handles) for every
 * `StageZoneMarker` in the Maker scene graph -- direct structural analog of `LightGizmoManager`,
 * see ADR 0016 Phase 2. Display/selection only in this first pass: point-handle dragging and the
 * click-to-draw tool are wired up in `MakerApp` separately, on top of the mappings this class
 * already exposes (`getPointForObject`).
 */
export class StageZoneGizmoManager {
  public readonly root = new Object3D("MakerStageZoneGizmos");
  private readonly _entries = new Map<StageZoneMarker, StageZoneGizmoEntry>();
  private readonly _fillToMarker = new Map<Object3D, StageZoneMarker>();
  private readonly _handleToPoint = new Map<Object3D, { marker: StageZoneMarker; index: number }>();
  /** Reused across frames; only repopulated via a full scene walk when `hierarchyChanged` is true. */
  private readonly _liveMarkers = new Set<StageZoneMarker>();

  constructor() {
    this.root.isVisible = true;
  }

  /** Returns whether `obj` is the gizmo root or one of its descendants. */
  public isHelperMesh(obj: Object3D): boolean {
    let curr: Object3D | undefined = obj;
    while (curr) {
      if (curr === this.root) return true;
      curr = curr.parent;
    }
    return false;
  }

  /** Returns the `StageZoneMarker` a clicked fill/handle mesh belongs to. */
  public getZoneForObject(obj: Object3D): StageZoneMarker | undefined {
    let curr: Object3D | undefined = obj;
    while (curr) {
      const marker = this._fillToMarker.get(curr);
      if (marker) return marker;
      const point = this._handleToPoint.get(curr);
      if (point) return point.marker;
      curr = curr.parent;
    }
    return undefined;
  }

  /** Returns the `(marker, point index)` a clicked handle mesh represents, if any. */
  public getPointForObject(obj: Object3D): { marker: StageZoneMarker; index: number } | undefined {
    return this._handleToPoint.get(obj);
  }

  /** Collects only point handles -- used for viewport point-dragging, which must be checked
   * before the fill (a broader target that would otherwise win first). */
  public collectHandlePickables(out: Object3D[]): void {
    for (const entry of this._entries.values()) {
      for (const handle of entry.handles) {
        if (handle.isVisible) {
          handle.computeBounds();
          out.push(handle);
        }
      }
    }
  }

  /** Collects every zone's fill mesh (the real pick target) for raycasting. */
  public collectPickables(out: Object3D[]): void {
    for (const entry of this._entries.values()) {
      if (entry.fill.isVisible) {
        entry.fill.computeBounds();
        out.push(entry.fill);
      }
      for (const handle of entry.handles) {
        if (handle.isVisible) {
          handle.computeBounds();
          out.push(handle);
        }
      }
    }
  }

  /**
   * Syncs and updates all zone gizmos with the current scene state. Without a resolved
   * projection (see `StageProjectionResolver`), zones have no way to place their (u, v) points
   * in 3D space, so nothing is drawn -- not an error, just nothing to show yet (e.g. no
   * `StageMovementBehavior` in the scene at all).
   */
  public update(
    sceneRoot: Object3D,
    selection: ReadonlySet<Object3D>,
    hierarchyChanged: boolean,
    projection: StageUvProjection | undefined,
  ): void {
    if (hierarchyChanged) {
      this._liveMarkers.clear();
      this._findZones(sceneRoot, this._liveMarkers);
    }

    for (const [marker, entry] of this._entries.entries()) {
      if (!this._liveMarkers.has(marker) || !marker.parent) {
        this._removeEntry(entry);
        this._entries.delete(marker);
      }
    }

    if (!projection) return;

    for (const marker of this._liveMarkers) {
      let entry = this._entries.get(marker);
      if (!entry) {
        entry = this._createEntry(marker, projection);
        this._entries.set(marker, entry);
      }
      this._updateEntry(entry, projection, selection.has(marker));
    }
  }

  private _findZones(parent: Object3D, out: Set<StageZoneMarker>): void {
    if (this.isHelperMesh(parent)) return;
    if (parent instanceof StageZoneMarker) out.add(parent);
    for (const child of parent.children) this._findZones(child, out);
  }

  private _worldPoints(marker: StageZoneMarker, projection: StageUvProjection): Vector3D[] {
    return marker.zone.points.map((p) => {
      const w = projection.toWorld(p.u, p.v);
      return new Vector3D(w.x, w.y, w.z);
    });
  }

  private _createEntry(
    marker: StageZoneMarker,
    projection: StageUvProjection,
  ): StageZoneGizmoEntry {
    const worldPoints = this._worldPoints(marker, projection);

    const outline = new Object3D(`ZoneOutline_${marker.name}`);
    const outlineMat = new WireframeMaterial(DEFAULT_COLOR.clone());
    outline.geometry = new Polyline({ points: worldPoints, closed: true }).getGeometryData();
    outline.material = outlineMat;
    this.root.add(outline);

    const fill = new Object3D(`ZoneFill_${marker.name}`);
    const fillMat = new BasicMaterial({ color: DEFAULT_COLOR.clone() });
    fillMat.transparent = true;
    fillMat.color.a = FILL_ALPHA;
    // Editor helper, not real scene geometry -- must read correctly from either side regardless
    // of the fan triangulation's winding order relative to a given camera angle.
    fillMat.cullMode = CullMode.NONE;
    fill.geometry = new PolygonFan({ points: worldPoints }).getGeometryData();
    fill.material = fillMat;
    this.root.add(fill);
    this._fillToMarker.set(fill, marker);

    const handleMat = new BasicMaterial({ color: new Color(1, 1, 1) });
    const handles = worldPoints.map((wp, index) => {
      const handle = new Object3D(`ZoneHandle_${marker.name}_${index}`);
      handle.geometry = new Octahedron({ radius: HANDLE_RADIUS }).getGeometryData();
      handle.material = handleMat;
      handle.position.copyFrom(wp);
      this.root.add(handle);
      this._handleToPoint.set(handle, { marker, index });
      return handle;
    });

    return {
      marker,
      outline,
      outlineMat,
      fill,
      fillMat,
      handles,
      handleMat,
      lastPointsSignature: StageZoneGizmoManager._pointsSignature(marker),
    };
  }

  private _updateEntry(
    entry: StageZoneGizmoEntry,
    projection: StageUvProjection,
    isSelected: boolean,
  ): void {
    const signature = StageZoneGizmoManager._pointsSignature(entry.marker);
    if (signature !== entry.lastPointsSignature) {
      this._rebuildGeometry(entry, projection);
      entry.lastPointsSignature = signature;
    }

    const color = isSelected ? SELECTED_COLOR : DEFAULT_COLOR;
    entry.outlineMat.color.r = color.r;
    entry.outlineMat.color.g = color.g;
    entry.outlineMat.color.b = color.b;
    entry.fillMat.color.r = color.r;
    entry.fillMat.color.g = color.g;
    entry.fillMat.color.b = color.b;
  }

  /** Rebuilds outline/fill/handle geometry in place after a zone's points changed (added,
   * removed, or moved via the property panel / drawing tool) -- point count itself may have
   * changed, so handles are torn down and recreated rather than resized in place. */
  private _rebuildGeometry(entry: StageZoneGizmoEntry, projection: StageUvProjection): void {
    const worldPoints = this._worldPoints(entry.marker, projection);

    entry.outline.geometry = new Polyline({ points: worldPoints, closed: true }).getGeometryData();
    entry.fill.geometry = new PolygonFan({ points: worldPoints }).getGeometryData();

    for (const handle of entry.handles) {
      this._handleToPoint.delete(handle);
      this.root.remove(handle);
    }
    entry.handles = worldPoints.map((wp, index) => {
      const handle = new Object3D(`ZoneHandle_${entry.marker.name}_${index}`);
      handle.geometry = new Octahedron({ radius: HANDLE_RADIUS }).getGeometryData();
      handle.material = entry.handleMat;
      handle.position.copyFrom(wp);
      this.root.add(handle);
      this._handleToPoint.set(handle, { marker: entry.marker, index });
      return handle;
    });
  }

  private _removeEntry(entry: StageZoneGizmoEntry): void {
    this._fillToMarker.delete(entry.fill);
    for (const handle of entry.handles) this._handleToPoint.delete(handle);
    this.root.remove(entry.outline);
    this.root.remove(entry.fill);
    for (const handle of entry.handles) this.root.remove(handle);
  }

  private static _pointsSignature(marker: StageZoneMarker): string {
    return marker.zone.points.map((p) => `${p.u},${p.v},${p.scale}`).join("|");
  }
}
