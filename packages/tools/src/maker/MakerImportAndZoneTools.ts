import {
  BasicMaterial,
  Color,
  Object3D,
  Scene,
  StandardMaterial,
  WireframeMaterial,
  Octahedron,
  Polyline,
  Vector3D,
  MathUtils,
  StageZone,
  StageZoneMarker,
  Texture,
  GridLevelBuilder,
} from "@small-world-machine/engine";
import { resolveStageProjection } from "./StageProjectionResolver.js";
import { BackgroundPlane } from "./BackgroundPlane.js";
import { defaultAsciiMapLegend } from "./AsciiMapLegend.js";
import { UndoStack } from "./UndoStack.js";
import { ProjectBinding } from "./ProjectBinding.js";

/** In-progress click-to-draw state for a new `StageZoneMarker` (ADR 0016 Phase 2). `previewRoot`
 * holds ephemeral handle/line markers rebuilt after every placed point -- never added to the
 * undo stack, since nothing here is a real scene object yet; only `finish()`'s single
 * `StageZoneMarker` creation is undoable. */
interface ZoneDrawState {
  points: { u: number; v: number; scale: number }[];
  previewRoot: Object3D;
}

export interface MakerImportAndZoneToolsContext {
  scene: Scene;
  undo: UndoStack;
  project: ProjectBinding;
  addObject: (obj: Object3D) => void;
  disposeTrashedObject: (obj: Object3D) => void;
  trashBin: Object3D;
  markHierarchyDirty: () => void;
  getStageProjection: () => ReturnType<typeof resolveStageProjection>;
}

/**
 * ASCII map import, background reference-image import, and the click-to-draw `StageZoneMarker`
 * state machine -- extracted from `MakerApp` (MAJ-10 monolith split). Owns only the ephemeral
 * zone-draw-in-progress state; every scene mutation still goes through the context's `undo`/
 * `addObject`/`disposeTrashedObject` so history and autosave behave exactly as before.
 */
export class MakerImportAndZoneTools {
  private _zoneDrawState: ZoneDrawState | undefined;
  private _zoneDrawButton: HTMLButtonElement | undefined;

  constructor(private readonly _ctx: MakerImportAndZoneToolsContext) {}

  /** Wired once by the toolbar builder right after the "Draw Zone" button is created. */
  public setZoneDrawButton(button: HTMLButtonElement): void {
    this._zoneDrawButton = button;
  }

  public get isDrawingZone(): boolean {
    return undefined !== this._zoneDrawState;
  }

  /** Bridges MapGenerator's ASCII/`GridLevelBuilder` pipeline into Maker (ADR 0010 Phase 2C):
   * builds the map directly into the live scene, then wraps whatever `GridLevelBuilder` added as
   * a single undo step -- it adds objects via `scene.add()` itself, so there is nothing to defer
   * the way `addObject()` normally does; capturing the before/after child sets is what makes it
   * undoable after the fact. Rough starting scaffold, not a finished level -- see
   * `AsciiMapLegend`'s doc comment. */
  public async importAsciiMap(mapData: string): Promise<void> {
    const { scene, undo, project, trashBin, disposeTrashedObject, markHierarchyDirty } = this._ctx;
    const before = new Set(scene.root.children);
    await new GridLevelBuilder().build(scene, mapData, {
      legend: defaultAsciiMapLegend(),
      defaultFloorMaterial: new StandardMaterial({ color: new Color(0.4, 0.4, 0.42) }),
    });
    const added = scene.root.children.filter((child) => !before.has(child));
    if (0 === added.length) return;

    undo.execute({
      label: `Import ASCII Map (${added.length} objects)`,
      redo: () => {
        for (const obj of added) scene.add(obj);
        markHierarchyDirty();
        project.scheduleAutosave(() => scene.root);
      },
      undo: () => {
        for (const obj of added) trashBin.add(obj);
        markHierarchyDirty();
        project.scheduleAutosave(() => scene.root);
      },
      discard: () => {
        for (const obj of added) disposeTrashedObject(obj);
      },
    });
  }

  /** Decodes the dropped/picked file and places it as a `BackgroundPlane` sized to preserve its
   * aspect ratio exactly (height is always derived from width, never entered independently, so
   * the reference image can never end up stretched -- see ADR 0016 Phase 2). Re-importing while
   * a `BackgroundPlane` already exists keeps its current width (so re-tracing zones on a
   * replacement image doesn't silently change scale) and simply swaps the old plane out --
   * intentionally not folded into the new plane's own undo step, since replacing a reference
   * image is a "just do it" action, not something worth a multi-part undo/redo round trip. */
  public async importBackgroundImage(file: File): Promise<void> {
    // Matches `AssetManager.loadImage(url, undefined, flipY=true)`'s own decode options exactly
    // (see `flakturm-tunnel/showcase.ts`'s `Texture.fromUrl(..., { flipY: true })`) -- a plain
    // `createImageBitmap(file)` decodes top-down, but this engine's texture-sampling convention
    // expects bottom-up, so the image renders upside down without this.
    const bitmap = await createImageBitmap(file, {
      colorSpaceConversion: "none",
      imageOrientation: "flipY",
    });
    const aspect = bitmap.width / bitmap.height;
    const existing = this._findBackgroundPlane();
    const width = existing?.width ?? 10;
    const height = width / aspect;

    if (existing) {
      this._ctx.scene.remove(existing);
      this._ctx.markHierarchyDirty();
    }

    const plane = new BackgroundPlane({ texture: Texture.fromImage(bitmap), width, height });
    plane.position.set(0, height / 2, 0);
    this._ctx.addObject(plane);
  }

  private _findBackgroundPlane(): BackgroundPlane | undefined {
    for (const child of this._ctx.scene.root.children) {
      if (child instanceof BackgroundPlane) return child;
    }
    return undefined;
  }

  /** Enters/exits click-to-draw mode for a new `StageZoneMarker` (ADR 0016 Phase 2). Silently
   * does nothing if there's no resolved projection yet (see `StageProjectionResolver`) -- there
   * would be nowhere to actually place a point. */
  public toggle(): void {
    if (this._zoneDrawState) {
      this.cancel();
      return;
    }
    if (!this._ctx.getStageProjection()) return;

    this._zoneDrawState = { points: [], previewRoot: new Object3D("ZoneDrawPreview") };
    this._ctx.scene.add(this._zoneDrawState.previewRoot);
    this._zoneDrawButton?.classList.add("active");
  }

  public cancel(): void {
    if (!this._zoneDrawState) return;
    this._ctx.scene.remove(this._zoneDrawState.previewRoot);
    this._zoneDrawState = undefined;
    this._zoneDrawButton?.classList.remove("active");
  }

  public addPoint(u: number, v: number): void {
    if (!this._zoneDrawState) return;
    this._zoneDrawState.points.push({ u, v, scale: 1.0 });
    this._refreshPreview();
  }

  /** Rebuilds the ephemeral preview (placed-point handles + an open connecting polyline) from
   * scratch after every click -- simplest correct approach given how few points a zone actually
   * has; no live segment follows the mouse between clicks, only committed points are shown. */
  private _refreshPreview(): void {
    const state = this._zoneDrawState;
    const projection = this._ctx.getStageProjection();
    if (!state || !projection) return;

    for (const child of state.previewRoot.children.slice()) state.previewRoot.remove(child);

    const worldPoints = state.points.map((p) => {
      const w = projection.toWorld(p.u, p.v);
      return new Vector3D(w.x, w.y, w.z);
    });

    const previewColor = new Color(1.0, 0.6, 0.1);
    for (const wp of worldPoints) {
      const handle = new Object3D("ZoneDrawHandle");
      handle.geometry = new Octahedron({ radius: 0.08 }).getGeometryData();
      handle.material = new BasicMaterial({ color: previewColor });
      handle.position.copyFrom(wp);
      state.previewRoot.add(handle);
    }

    if (2 <= worldPoints.length) {
      const line = new Object3D("ZoneDrawLine");
      line.geometry = new Polyline({ points: worldPoints, closed: false }).getGeometryData();
      line.material = new WireframeMaterial(previewColor);
      state.previewRoot.add(line);
    }
  }

  /** Closes the zone being drawn (min. 3 points) into a real `StageZoneMarker`, added through
   * the normal `addObject()` undo path -- exactly one undo command for the whole multi-click
   * interaction, the same "collect state locally, commit once at the end" pattern as gizmo drag.
   * No-op below 3 points (can't form a polygon). */
  public finish(): void {
    const state = this._zoneDrawState;
    if (!state || 3 > state.points.length) return;

    this._ctx.scene.remove(state.previewRoot);
    this._zoneDrawState = undefined;
    this._zoneDrawButton?.classList.remove("active");

    const zone = new StageZone({
      id: `zone_${MathUtils.generateUUID()}`,
      name: "New Zone",
      points: state.points,
    });
    this._ctx.addObject(new StageZoneMarker(zone));
  }
}
