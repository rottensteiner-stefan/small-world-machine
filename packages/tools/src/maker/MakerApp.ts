// `SmallWorldMachine` deliberately comes from the `@small-world-machine/engine` package root, not a deep import
// of `SmallWorldMachine.ts` (or its `core/index.js` barrel) directly: the whole renderer pipeline
// (WebGL1/2, WebGPU, most render passes) imports the engine's own barrels itself, so touching
// `SmallWorldMachine.ts` as the very first module in the graph can re-enter those barrels mid-evaluation
// and reach `AbstractShowcase.ts`'s `extends SmallWorldMachine` before `SmallWorldMachine`'s own class
// declaration has run (a real, previously-latent TDZ crash, not a hypothetical one -- hit and
// confirmed live in-browser while building this). Importing from the package root avoids it by
// construction, same as every existing showcase/app.
import type {
  Behavior,
  AbstractMaterial,
  BoundingBox,
  BoundingSphere,
  EngineOptions,
  OBB,
  KitDecalItem,
} from "@small-world-machine/engine";
import {
  SmallWorldMachine,
  Object3D,
  attachBehavior,
  detachBehavior,
  DirectionalLight,
  PointLight,
  SpotLight,
  AbstractLight,
  AmbientLight,
  WireframeMaterial,
  Color,
  isEditingTextInput,
  Grid,
  Cube,
  Raycaster,
  BoundingType,
  CameraStrategyType,
  Vector2D,
  Vector3D,
  MathPool,
  StandardMaterial,
  KitRegistry,
  Quaternion,
  Matrix4,
} from "@small-world-machine/engine";

import type { OrbitCameraView } from "./OrbitCameraController.js";
import { OrbitCameraController } from "./OrbitCameraController.js";
import { UndoStack } from "./UndoStack.js";
import { createMakerCommandRunner } from "./MakerUndoCore.js";
import { dispatchMakerKey, type MakerKeyContext } from "./MakerKeymap.js";
import { HierarchyPanel } from "./HierarchyPanel.js";
import { PropertyPanel } from "./PropertyPanel.js";
import { ObjectPalette } from "./ObjectPalette.js";
import { PrefabPalette } from "./PrefabPalette.js";
import { ProjectBinding } from "./ProjectBinding.js";
import type { GizmoMode, GizmoAxis } from "./TransformGizmo.js";
import { TransformGizmo } from "./TransformGizmo.js";
import { LightGizmoManager } from "./LightGizmoManager.js";
import { StageZoneGizmoManager } from "./StageZoneGizmoManager.js";
import { resolveStageProjection, projectRayToUv } from "./StageProjectionResolver.js";
import { BackgroundImportPanel } from "./BackgroundImportPanel.js";
import { MapImportPanel } from "./MapImportPanel.js";
import { MakerPrefabPipeline } from "./MakerPrefabPipeline.js";
import { MakerImportAndZoneTools } from "./MakerImportAndZoneTools.js";
import { MakerToolbarBuilder } from "./MakerToolbarBuilder.js";
import { DecalStampTool, type DecalStampHit } from "./DecalStampTool.js";
import { ContentDrawer } from "./ContentDrawer.js";
import { ToolModeHost } from "./ToolModeHost.js";
import { ModeHashRouter } from "./ModeHashRouter.js";
import { WorldModeAdapter } from "./WorldModeAdapter.js";

export interface MakerAppOptions extends EngineOptions {
  hierarchyContainer: HTMLElement;
  propertyContainer: HTMLElement;
  paletteContainer: HTMLElement;
  statusContainer: HTMLElement;
  contentDrawerContainer?: HTMLElement;
  /** Element secondary tool modes mount into; defaults to `document.body` until a layout slot exists. */
  modeHostContainer?: HTMLElement;
}

interface ObjectTransformSnapshot {
  position: Vector3D;
  rotation: Vector3D;
  scale: Vector3D;
  worldPosition: Vector3D;
}

interface GizmoDragState {
  axis: GizmoAxis;
  mode: GizmoMode;
  pivot: Vector3D;
  accumulatedDelta: number;
  /** Snapshot of the transforms for every selected object at drag start -- multi-selection moves
   * together with pivot-relative rotation/scaling. One before/after undo command is pushed once the
   * drag ends. */
  before: Map<Object3D, ObjectTransformSnapshot>;
}

interface MarqueeState {
  startX: number;
  startY: number;
  isShift: boolean;
}

/** Viewport drag of a single existing zone point (handle grabbed in `StageZoneGizmoManager`) --
 * mirrors `GizmoDragState`'s "collect state during the drag, push exactly one undo command at
 * `pointerup`" pattern, applied to a `(u, v)` pair instead of a transform. */
interface ZonePointDragState {
  marker: import("@small-world-machine/engine").StageZoneMarker;
  index: number;
  before: { u: number; v: number };
}

/**
 * Maker's orchestrating application class -- see docs/adr/0010-maker-editor-architecture.md.
 * Owns the viewport (a plain `SmallWorldMachine` instance with a manual orbit camera), selection +
 * picking, the undo stack, and wiring between the three panels (Hierarchy/Palette/Property)
 * and the live scene graph. Deliberately does not touch `GadgetInspector` -- see the ADR's
 * "retire only after parity" decision.
 *
 * Prefab save/instantiate + thumbnail capture, ASCII/background-image import + zone-draw, and
 * palette toolbar wiring are extracted into `MakerPrefabPipeline`/`MakerImportAndZoneTools`/
 * `MakerToolbarBuilder` (MAJ-10 monolith split) -- selection, the gizmo drag loop, pointer
 * picking/marqueeing, and the undo-backed scene-edit operations stay here, since they all share
 * `_undo`/`_selection`/`_propertyPanel`/`_project` state tightly enough that splitting them
 * further would only replace that coupling with equivalent constructor-injected callbacks.
 */
export class MakerApp extends SmallWorldMachine {
  private readonly _orbit = new OrbitCameraController();
  private readonly _undo = new UndoStack();
  /** Executes undoable scene-edit commands through `_undo` and runs the shared
   * post-apply follow-up (`_hierarchyDirty`, property selection, autosave)
   * exactly once per (re-)application — the ordering contract every call site
   * that delegates to `_commit` relies on (see `MakerUndoCore`). */
  private readonly _commitRunner = createMakerCommandRunner({
    execute: (command): void => this._undo.execute(command),
    afterApply: (): void => {
      this._hierarchyDirty = true;
      this._propertyPanel.setSelection(this._primary, Math.max(0, this._selection.size - 1));
      this._project.scheduleAutosave(() => this.scene.root);
    },
  });
  /** Like `_commitRunner`, but for transform-mode commands: the follow-up keeps
   * the gizmo in sync (`_updateGizmo`) and refreshes selection + autosave,
   * without marking the hierarchy dirty — exactly what the hand-written
   * position/rotation/scale snapshot sites (`snapSelectionToGround`,
   * `nudgeSelection`, gizmo drags) used to do. */
  private readonly _snapshotRunner = createMakerCommandRunner({
    execute: (command): void => this._undo.execute(command),
    afterApply: (): void => {
      this._updateGizmo();
      this._propertyPanel.setSelection(this._primary, Math.max(0, this._selection.size - 1));
      this._project.scheduleAutosave(() => this.scene.root);
    },
  });
  private readonly _project = new ProjectBinding();
  private readonly _raycaster = new Raycaster();
  /** Off-scene holding pen for "soft deleted" objects: reparenting into it uses `Object3D.add()`'s
   * silent detach path, never `Scene.remove()`'s GPU-resource-disposal notification -- so a
   * delete stays cleanly undoable (the object can be reparented right back) instead of risking
   * disposed buffers coming back broken after an undo. Never added to `this.scene` itself. */
  private readonly _trashBin = new Object3D("MakerTrash");
  private readonly _gizmo = new TransformGizmo();
  private readonly _lightGizmos = new LightGizmoManager();
  private readonly _stageZoneGizmos = new StageZoneGizmoManager();
  /** Re-resolved only when the hierarchy actually changes -- mirrors `LightGizmoManager`'s own
   * `hierarchyChanged`-gated re-scan, since a full scene walk every frame is unnecessary. */
  private _stageProjection: ReturnType<typeof resolveStageProjection> = undefined;
  private _zonePointDrag: ZonePointDragState | undefined;

  private _prefabPipeline!: MakerPrefabPipeline;
  private _importTools!: MakerImportAndZoneTools;
  private _decalStamp!: DecalStampTool;
  private _toolbars!: MakerToolbarBuilder;

  /** Insertion-ordered so "the last thing clicked/toggled" (via `Array.from(...).at(-1)`) is
   * well-defined -- `_primary` always mirrors that. */
  private readonly _selection = new Set<Object3D>();
  /** The object the Property panel shows and the gizmo pivots on -- Blender/Unity's "active
   * object" convention. `undefined` iff `_selection` is empty. */
  private _primary: Object3D | undefined;
  /** Read-only alias kept for every pre-multi-select call site that only ever needs "the one
   * relevant object" (gizmo drag math, `attachBehaviorToSelection`, etc.) -- there is
   * deliberately no setter; `selectObject()`/`toggleSelect()`/`_selectMultiple()` are the only
   * ways to change the selection. */
  /** Public read-only access for inspector/testing */
  public get selection(): ReadonlySet<Object3D> {
    return this._selection;
  }
  public get primary(): Object3D | undefined {
    return this._primary;
  }
  public get gizmo(): TransformGizmo {
    return this._gizmo;
  }
  public get lightGizmos(): LightGizmoManager {
    return this._lightGizmos;
  }
  public get orbit(): OrbitCameraController {
    return this._orbit;
  }
  public get undoStack(): UndoStack {
    return this._undo;
  }
  public get cameraBookmarks(): ReadonlyMap<number, OrbitCameraView> {
    return this._toolbars.cameraBookmarks;
  }
  public get contentDrawer(): ContentDrawer {
    return this._contentDrawer;
  }
  public get kitRegistry(): KitRegistry {
    return this._kitRegistry;
  }
  public get modeHost(): ToolModeHost {
    return this._modeHost;
  }
  public get modeRouter(): ModeHashRouter {
    return this._modeRouter;
  }

  /** Launcher hook for the mode-switcher UI (see `maker.html`): in-app mode switch, never navigation. */
  public launchMode(modeId: string): void {
    this._modeRouter.navigate(modeId);
  }

  private readonly _kitRegistry = new KitRegistry();
  private _contentDrawer!: ContentDrawer;

  private get _selected(): Object3D | undefined {
    return this._primary;
  }
  /** Pooled per-selected-object wireframe highlight boxes, indexed by current selection order
   * (not tied to a fixed object) -- reused across `_syncHighlight()` calls so selecting N
   * objects doesn't allocate N new meshes every frame. */
  private readonly _highlightMeshes: Object3D[] = [];
  private readonly _editorGrid: Object3D = new Object3D("EditorGrid");
  private static readonly _PRIMARY_HIGHLIGHT_COLOR = new Color(0, 1, 1);
  private static readonly _SECONDARY_HIGHLIGHT_COLOR = new Color(1, 0.7, 0);
  private _hierarchyPanel!: HierarchyPanel;
  private _propertyPanel!: PropertyPanel;
  private _hierarchyDirty = true;
  private _gizmoDrag: GizmoDragState | undefined;
  private _marqueeEl!: HTMLElement;
  private _marqueeState: MarqueeState | undefined;
  private _cameraDrag: { lastX: number; lastY: number } | undefined;
  /** Set for the duration of `MakerPrefabPipeline`'s temporary camera reframing while capturing a
   * prefab thumbnail -- `update()` skips `_orbit.update()` while true so the orbit controller
   * doesn't immediately overwrite the thumbnail shot on the next frame. */
  private _thumbnailCaptureActive = false;
  private _abortController = new AbortController();

  private readonly _modeHost: ToolModeHost;
  private readonly _modeRouter: ModeHashRouter;

  constructor(private readonly _makerOptions: MakerAppOptions) {
    super(_makerOptions);
    this._modeHost = new ToolModeHost(this._makerOptions.modeHostContainer ?? document.body);
    this._modeHost.register(new WorldModeAdapter());
    this._modeRouter = new ModeHashRouter(this._modeHost);
    this._modeRouter.start();
  }

  /** Editor-only scene children: hidden in the hierarchy and never written to `scene.gltf`. */
  private _isEditorHelper(obj: Object3D): boolean {
    return (
      this._highlightMeshes.includes(obj) ||
      obj === this._gizmo.root ||
      this._lightGizmos.isHelperMesh(obj) ||
      this._stageZoneGizmos.isHelperMesh(obj) ||
      this._decalStamp.isGhost(obj) ||
      this._importTools.isZonePreview(obj)
    );
  }

  protected override async setupScene(): Promise<void> {
    const grid = this._editorGrid;
    grid.geometry = new Grid({ size: 40, divisions: 40 }).getGeometryData();
    grid.material = new WireframeMaterial(new Color(0.3, 0.3, 0.35));
    grid.isVisible = true;
    this.scene.add(grid);

    this.scene.add(new DirectionalLight({ name: "SunLight", intensity: 1.0 }));
    this.scene.add(new AmbientLight({ name: "Fill", intensity: 0.4 }));

    this.scene.add(this._gizmo.root);
    this.scene.add(this._lightGizmos.root);
    this.scene.add(this._stageZoneGizmos.root);

    this.camera.setStrategy(CameraStrategyType.MANUAL);
    this.camera.position.set(8, 6, 8);
    this._orbit.target.set(0, 0, 0);

    this._marqueeEl = document.createElement("div");
    this._marqueeEl.className = "maker-marquee-box";
    this.canvas.parentElement?.appendChild(this._marqueeEl);

    this._propertyPanel = new PropertyPanel(this._makerOptions.propertyContainer, this._undo, {
      onPropertyChanged: (_obj, propKey): void => {
        if ("name" === propKey) {
          this._hierarchyDirty = true;
          this._hierarchyPanel.refresh();
        }
        this._project.scheduleAutosave(() => this.scene.root);
      },
      onDetachBehavior: (obj, behavior): void => {
        this.detachBehaviorFromObject(obj, behavior);
      },
      onSetMaterial: (obj, material): void => {
        this.setMaterialOnObject(obj, material);
      },
    });
    this._decalStamp = new DecalStampTool({
      raycast: (canvasX, canvasY): DecalStampHit | undefined => this._pickSurface(canvasX, canvasY),
      raycastRay: (origin, direction): DecalStampHit | undefined =>
        this._pickRay(origin, direction),
      scene: this.scene,
      hydrate: (decal): Promise<boolean> => this._kitRegistry.hydrateDecal(decal),
      addObject: (decal): void => this.addObject(decal),
      getNudgeStep: (): number => (this._gizmo.snap.enabled ? this._gizmo.snap.translate : 0.5),
      getScaleStep: (): number => (this._gizmo.snap.enabled ? this._gizmo.snap.scale : 0.25),
      setStatus: (message): void => {
        this._makerOptions.statusContainer.textContent = message;
      },
    });
    this._project.excludeFromSave = (obj): boolean =>
      obj === this._editorGrid || this._isEditorHelper(obj);

    this._hierarchyPanel = new HierarchyPanel(
      this._makerOptions.hierarchyContainer,
      () => this.scene.root,
      {
        onSelect: (obj, toggle): void => {
          if (toggle) this.toggleSelect(obj);
          else this.selectObject(obj);
        },
        onReparent: (obj, newParent): void => this.reparent(obj, newParent),
        onRename: (obj, newName): void => this.renameObject(obj, newName),
      },
      (obj) => this._isEditorHelper(obj),
    );
    new ObjectPalette(this._makerOptions.paletteContainer, {
      createObject: (factory): void => this.addObject(factory()),
      attachBehavior: (factory): void => this.attachBehaviorToSelection(factory),
    });

    this._importTools = new MakerImportAndZoneTools({
      scene: this.scene,
      undo: this._undo,
      project: this._project,
      addObject: (obj): void => this.addObject(obj),
      disposeTrashedObject: (obj): void => this._disposeTrashedObject(obj),
      trashBin: this._trashBin,
      markHierarchyDirty: (): void => {
        this._hierarchyDirty = true;
      },
      getStageProjection: (): ReturnType<typeof resolveStageProjection> => this._stageProjection,
    });

    const prefabPalette = new PrefabPalette(this._makerOptions.paletteContainer, {
      saveSelectionAsPrefab: (name): void => this._prefabPipeline.saveSelectionAsPrefab(name),
      instantiate: (name): void => this._prefabPipeline.instantiatePrefab(name),
    });
    this._prefabPipeline = new MakerPrefabPipeline({
      scene: this.scene,
      camera: this.camera,
      canvas: this.canvas,
      orbit: this._orbit,
      gizmo: this._gizmo,
      lightGizmos: this._lightGizmos,
      stageZoneGizmos: this._stageZoneGizmos,
      highlightMeshes: this._highlightMeshes,
      project: this._project,
      prefabPalette,
      statusContainer: this._makerOptions.statusContainer,
      getSelected: (): Object3D | undefined => this._selected,
      addObject: (obj): void => this.addObject(obj),
      setThumbnailCaptureActive: (active): void => {
        this._thumbnailCaptureActive = active;
      },
    });

    new MapImportPanel(this._makerOptions.paletteContainer, (mapData): void => {
      void this._importTools.importAsciiMap(mapData);
    });
    new BackgroundImportPanel(this._makerOptions.paletteContainer, this.canvas, (file): void => {
      void this._importTools.importBackgroundImage(file);
    });

    this._project.onDirtyChange((dirty) => {
      this._makerOptions.statusContainer.textContent = dirty ? "Unsaved changes…" : "Saved";
    });

    this._toolbars = new MakerToolbarBuilder({
      paletteContainer: this._makerOptions.paletteContainer,
      statusContainer: this._makerOptions.statusContainer,
      project: this._project,
      orbit: this._orbit,
      gizmo: this._gizmo,
      addObject: (obj, opts): void => this.addObject(obj, opts),
      loadProjectObjects: (children): void => this.loadProjectObjects(children),
      refreshPrefabList: (): Promise<void> => this._prefabPipeline.refreshPrefabList(),
      duplicateSelection: (): void => this.duplicateSelection(),
      groupSelection: (): void => this.groupSelection(),
      snapSelectionToGround: (): void => this.snapSelectionToGround(),
      toggleZoneDrawMode: (): void => {
        this._decalStamp.disable();
        this._importTools.toggle();
      },
      toggleDecalStamp: (): void => {
        this._importTools.cancel();
        this._decalStamp.toggle();
      },
      resolveDecals: (root): Promise<number> => this._kitRegistry.resolveLevelDecals(root),
      replaceLightsWith: (loaded): void => {
        for (const child of loaded) {
          if (!(child instanceof AbstractLight)) continue;
          const existing = this.scene.root.children.find(
            (c) => c instanceof AbstractLight && c.name === child.name,
          );
          if (existing) this.scene.remove(existing);
        }
        this._hierarchyDirty = true;
      },
    });
    this._toolbars.setupProjectToolbar();
    this._toolbars.setupSelectionToolbar();
    this._toolbars.setupCameraBookmarkToolbar();
    this._toolbars.setupGizmoToolbar();
    if (this._toolbars.zoneDrawButton)
      this._importTools.setZoneDrawButton(this._toolbars.zoneDrawButton);
    if (this._toolbars.decalStampButton)
      this._decalStamp.setButton(this._toolbars.decalStampButton);

    const drawerContainer =
      this._makerOptions.contentDrawerContainer ?? this.canvas.parentElement ?? document.body;

    this._contentDrawer = new ContentDrawer({
      container: drawerContainer,
      canvas: this.canvas,
      kitRegistry: this._kitRegistry,
      callbacks: {
        loadKitProp: async (kitPropId, worldPos): Promise<Object3D | undefined> => {
          try {
            const instance = await this._kitRegistry.loadProp(kitPropId);
            if (worldPos) {
              instance.root.position.copyFrom(worldPos);
            }
            this.addObject(instance.root);
            this.selectObject(instance.root);
            return instance.root;
          } catch (err) {
            console.error(`[Maker] Failed to load kit prop '${kitPropId}':`, err);
            return undefined;
          }
        },
        createPrimitive: (factory, worldPos): Object3D => {
          const obj = factory();
          if (worldPos) {
            obj.position.copyFrom(worldPos);
          }
          this.addObject(obj);
          this.selectObject(obj);
          return obj;
        },
        applyTexture: async (kitId, textureItem, targetObject): Promise<void> => {
          const target = targetObject ?? this._selected;
          if (!target) return;
          try {
            const tex = textureItem as { id: string; maps: string[] };
            // Shared, exact-token map resolution (also powers the KitInspector);
            // loads every found channel in parallel and now includes metalness.
            const maps = await this._kitRegistry.resolveTextureMaps(kitId, tex);
            const mat = new StandardMaterial({ color: Color.WHITE, metallic: 0, roughness: 0.8 });
            if (maps.albedo) mat.diffuseMap = maps.albedo;
            if (maps.normal) mat.normalMap = maps.normal;
            if (maps.roughness) mat.roughnessMap = maps.roughness;
            if (maps.ao) mat.aoMap = maps.ao;
            if (maps.metalness) {
              mat.metallicMap = maps.metalness;
              mat.metallic = 1.0;
            }
            this.setMaterialOnObject(target, mat);
          } catch (err) {
            console.error("[Maker] Failed to apply texture:", err);
          }
        },
        createDecal: (_kitId, decalItem): Promise<void> => {
          // A click on a kit decal arms the stamp tool (no decal is created until the user clicks
          // in the viewport), so there is no world position to use here.
          const item = decalItem as KitDecalItem;
          this._importTools.cancel();
          this._decalStamp.arm({
            kitDecal: item.id,
            name: item.name,
            size: item.size ?? [1, 1, 0.5],
          });
          return Promise.resolve();
        },
        instantiatePrefab: async (name, worldPos): Promise<void> => {
          this._prefabPipeline.instantiatePrefab(name);
          if (worldPos && this._selected) {
            this._selected.position.copyFrom(worldPos);
          }
        },
        getRaycastHit: (
          screenX,
          screenY,
        ): { position: Vector3D; targetObject?: Object3D; normal?: Vector3D } => {
          const hit = this._pickSurface(screenX, screenY);
          if (!hit) return { position: new Vector3D(0, 0, 0) };
          return hit.object
            ? { position: hit.point, targetObject: hit.object, normal: hit.normal }
            : { position: hit.point, normal: hit.normal };
        },
      },
    });

    const signal = this._abortController.signal;
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault(), { signal });
    this.canvas.addEventListener("pointerdown", (e) => this._onPointerDown(e), { signal });
    window.addEventListener("pointermove", (e) => this._onWindowPointerMove(e), { signal });
    window.addEventListener("pointerup", (e) => this._onWindowPointerUp(e), { signal });
    window.addEventListener("keydown", (e) => this._onMakerKeyDown(e), { signal });

    // Prevent wheel scrolling on sidebars/panels from zooming the 3D editor viewport
    const isolateWheel = (el: HTMLElement | null | undefined): void => {
      el?.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true, signal });
    };
    isolateWheel(this._makerOptions.hierarchyContainer);
    isolateWheel(this._makerOptions.propertyContainer);
    isolateWheel(this._makerOptions.paletteContainer);
    isolateWheel(this._makerOptions.statusContainer);
    isolateWheel(this._makerOptions.hierarchyContainer?.closest(".maker-sidebar"));
    isolateWheel(this._makerOptions.propertyContainer?.closest(".maker-sidebar"));
    if (typeof document !== "undefined") {
      document.querySelectorAll(".maker-sidebar, .tool-header, .maker-status").forEach((el) => {
        isolateWheel(el as HTMLElement);
      });
    }

    this._hierarchyPanel.refresh();
  }

  /** Saves the current viewport view into bookmark `slot` (1-9), overwriting whatever was
   * there. */
  public saveCameraBookmark(slot: number): void {
    this._toolbars.saveCameraBookmark(slot);
  }

  /** Jumps to bookmark `slot`, if one has been saved -- silent no-op otherwise. */
  public jumpToCameraBookmark(slot: number): void {
    this._toolbars.jumpToCameraBookmark(slot);
  }

  public toggleSnap(): boolean {
    return this._toolbars.toggleSnap();
  }

  public stepGrid(dir: 1 | -1): number {
    return this._toolbars.stepGrid(dir);
  }

  /** Enters/exits click-to-draw mode for a new `StageZoneMarker` (ADR 0016 Phase 2). */
  public toggleZoneDrawMode(): void {
    this._importTools.toggle();
  }

  protected override update(deltaTime: number): void {
    // Would immediately undo `MakerPrefabPipeline`'s temporary camera framing and hidden
    // highlight boxes for that one shot.
    if (!this._thumbnailCaptureActive) {
      this._orbit.update(this.camera, this.input);
      this._syncHighlight();
    }
    const hierarchyChanged = this._hierarchyDirty;
    if (this._hierarchyDirty) {
      this._hierarchyPanel.refresh();
      this._hierarchyDirty = false;
    }
    this.scene.update(deltaTime);
    this._lightGizmos.update(this.scene.root, this._selection, hierarchyChanged, this.camera);
    if (hierarchyChanged) this._stageProjection = resolveStageProjection(this.scene.root);
    this._stageZoneGizmos.update(
      this.scene.root,
      this._selection,
      hierarchyChanged,
      this._stageProjection,
    );
    this._updateGizmo();
  }

  private _updateGizmo(): void {
    this._gizmo.update(this.camera);
    if (!this._gizmoDrag) return;

    const { axis, mode, pivot, before } = this._gizmoDrag;
    const delta = this._gizmo.computeAxisDelta(
      axis,
      this.input.mouse.dx,
      this.input.mouse.dy,
      this.camera,
    );
    this._gizmoDrag.accumulatedDelta += delta;
    const rawDelta = this._gizmoDrag.accumulatedDelta;
    const isMulti = this._selection.size > 1;

    for (const [obj, snap] of before) {
      if ("translate" === mode) {
        const rawVal = snap.position[axis] + rawDelta;
        obj.position[axis] = this._gizmo.snapValue("translate", rawVal);
      } else if ("rotate" === mode) {
        const rawAngle = snap.rotation[axis] + rawDelta;
        const finalAngle = this._gizmo.snapValue("rotate", rawAngle);
        const angleDelta = finalAngle - snap.rotation[axis];

        obj.rotation[axis] = finalAngle;

        if (isMulti && obj !== this._primary) {
          const offset = snap.worldPosition.clone().sub(pivot);
          const rotated = offset.clone();
          if ("x" === axis) {
            const c = Math.cos(angleDelta);
            const s = Math.sin(angleDelta);
            rotated.y = offset.y * c - offset.z * s;
            rotated.z = offset.y * s + offset.z * c;
          } else if ("y" === axis) {
            const c = Math.cos(angleDelta);
            const s = Math.sin(angleDelta);
            rotated.x = offset.x * c + offset.z * s;
            rotated.z = -offset.x * s + offset.z * c;
          } else if ("z" === axis) {
            const c = Math.cos(angleDelta);
            const s = Math.sin(angleDelta);
            rotated.x = offset.x * c - offset.y * s;
            rotated.y = offset.x * s + offset.y * c;
          }
          const newWorld = pivot.clone().add(rotated);
          if (!obj.parent || obj.parent === this.scene.root) {
            obj.position.copyFrom(newWorld);
          } else {
            const invParent = MathPool.acquireMatrix();
            if (obj.parent.worldMatrix.invert(invParent)) {
              invParent.transformVector(newWorld);
              obj.position.copyFrom(newWorld);
            }
            MathPool.releaseMatrix(invParent);
          }
        }
      } else if ("scale" === mode) {
        const rawScale = snap.scale[axis] + rawDelta;
        const finalScale = this._gizmo.snapValue("scale", rawScale);
        const scaleRatio = snap.scale[axis] > 0.0001 ? finalScale / snap.scale[axis] : 1;

        obj.scale[axis] = finalScale;

        if (isMulti && obj !== this._primary) {
          const offset = snap.worldPosition.clone().sub(pivot);
          offset[axis] *= scaleRatio;
          const newWorld = pivot.clone().add(offset);
          if (!obj.parent || obj.parent === this.scene.root) {
            obj.position.copyFrom(newWorld);
          } else {
            const invParent = MathPool.acquireMatrix();
            if (obj.parent.worldMatrix.invert(invParent)) {
              invParent.transformVector(newWorld);
              obj.position.copyFrom(newWorld);
            }
            MathPool.releaseMatrix(invParent);
          }
        }
      }
      obj.updateMatrixWorld();
    }
    this._propertyPanel.setSelection(this._primary, Math.max(0, this._selection.size - 1));

    if (!this.input.mouse.left) this._finishGizmoDrag();
  }

  private _finishGizmoDrag(): void {
    const drag = this._gizmoDrag;
    this._gizmoDrag = undefined;
    if (!drag) return;

    const { axis, mode, before } = drag;
    const after = new Map<Object3D, { position: Vector3D; rotation: Vector3D; scale: Vector3D }>();
    let changed = false;
    for (const [obj, snap] of before) {
      const curPos = obj.position.clone();
      const curRot = obj.rotation.clone();
      const curScale = obj.scale.clone();
      after.set(obj, { position: curPos, rotation: curRot, scale: curScale });
      if (
        curPos.x !== snap.position.x ||
        curPos.y !== snap.position.y ||
        curPos.z !== snap.position.z ||
        curRot.x !== snap.rotation.x ||
        curRot.y !== snap.rotation.y ||
        curRot.z !== snap.rotation.z ||
        curScale.x !== snap.scale.x ||
        curScale.y !== snap.scale.y ||
        curScale.z !== snap.scale.z
      ) {
        changed = true;
      }
    }
    if (!changed) return; // click without drag -- nothing to undo

    const apply = (
      values: Map<Object3D, { position: Vector3D; rotation: Vector3D; scale: Vector3D }>,
    ): void => {
      for (const [obj, transform] of values) {
        obj.position.copyFrom(transform.position);
        obj.rotation.copyFrom(transform.rotation);
        obj.scale.copyFrom(transform.scale);
        obj.updateMatrixWorld();
      }
    };

    const beforeValues = new Map(
      [...before.entries()].map(([k, v]) => [
        k,
        {
          position: v.position.clone(),
          rotation: v.rotation.clone(),
          scale: v.scale.clone(),
        },
      ]),
    );

    this._commit(
      `Gizmo ${mode} ${axis.toUpperCase()}${before.size > 1 ? ` (${before.size})` : ""}`,
      () => apply(after),
      () => apply(beforeValues),
    );
  }

  /** Replaces the entire selection with just `obj` (or clears it for `undefined`) -- a plain
   * click's behavior. See `toggleSelect()` for Shift/Ctrl-click's add/remove-one behavior. */
  public selectObject(obj: Object3D | undefined): void {
    this._selection.clear();
    if (obj) this._selection.add(obj);
    this._primary = obj;
    this._applySelectionChange();
  }

  /** Adds/removes `obj` from the selection without disturbing the rest of it -- Shift/Ctrl-click's
   * behavior, in both the viewport and the Hierarchy panel. The toggled object becomes primary
   * when added; when removed, primary falls back to whichever object was selected most recently
   * (or undefined if the selection is now empty). */
  public toggleSelect(obj: Object3D): void {
    if (this._selection.has(obj)) {
      this._selection.delete(obj);
      this._primary = Array.from(this._selection).at(-1);
    } else {
      this._selection.add(obj);
      this._primary = obj;
    }
    this._applySelectionChange();
  }

  /** Replaces the entire selection with `objs`, the last of which becomes primary -- used after
   * an operation (duplicate, group, undo) that should leave a specific set selected, distinct
   * from `selectObject()`'s single-object contract. */
  private _selectMultiple(objs: Object3D[]): void {
    this._selection.clear();
    for (const obj of objs) this._selection.add(obj);
    this._primary = objs.at(-1);
    this._applySelectionChange();
  }

  private _applySelectionChange(): void {
    this._propertyPanel.setSelection(this._primary, Math.max(0, this._selection.size - 1));
    this._hierarchyPanel.setSelected(this._selection);
    this._gizmo.attachTo(this._primary);
    this._syncHighlight();
  }

  private _computeSmartSpawnPosition(obj: Object3D): Vector3D {
    const target = this._orbit.target.clone();
    const rayDir = new Vector3D().copyFrom(target).sub(this.camera.position).normalize();

    let spawnX = target.x;
    let spawnZ = target.z;

    if (Math.abs(rayDir.y) > 0.001) {
      const t = -this.camera.position.y / rayDir.y;
      if (t > 0 && t < 100) {
        spawnX = this.camera.position.x + rayDir.x * t;
        spawnZ = this.camera.position.z + rayDir.z * t;
      }
    }

    if (this._gizmo.snap.enabled) {
      spawnX = this._gizmo.snapValue("translate", spawnX);
      spawnZ = this._gizmo.snapValue("translate", spawnZ);
    }

    let spawnY = 0;
    if (obj instanceof PointLight) {
      spawnY = 2.0;
    } else if (obj instanceof DirectionalLight) {
      spawnY = 5.0;
    } else if (obj instanceof SpotLight) {
      spawnY = 3.0;
    } else if (obj instanceof AmbientLight) {
      spawnY = 1.0;
    } else if (obj.geometry) {
      obj.computeBounds();
      if (obj.bounds && BoundingType.BOX === obj.bounds.type) {
        const box = obj.bounds as BoundingBox;
        spawnY = -box.min.y;
      }
    }

    return new Vector3D(spawnX, spawnY, spawnZ);
  }

  /** Releases an object's GPU resources for real, once we know for certain it can never be
   * brought back by `undo()`/`redo()` again (its owning `UndoCommand` was just permanently
   * discarded by `UndoStack` -- see `UndoCommand.discard()`). No-op if `obj` isn't currently
   * parked in `_trashBin` (its command may have been discarded while `redo()`, not `undo()`, was
   * the side last applied, i.e. it's live in the scene, not trashed).
   *
   * `_trashBin` is deliberately never added to `this.scene`, so `Scene`'s GPU-disposal
   * notification (`Object3D.pendingRemovalSink`) never fires for objects parked there -- that's
   * what keeps a soft-deleted object cheap to undo. Briefly routing it through the real scene
   * (`add` then immediately `remove`, both synchronous, no frame renders in between) is the only
   * way to trigger that same real disposal without inventing a second, parallel mechanism. */
  private _disposeTrashedObject(obj: Object3D): void {
    if (obj.parent !== this._trashBin) return;
    this.scene.add(obj);
    this.scene.remove(obj);
  }

  public addObject(obj: Object3D, options: { spawn?: boolean } = {}): void {
    if (
      options.spawn !== false &&
      0 === obj.position.x &&
      0 === obj.position.y &&
      0 === obj.position.z
    ) {
      const smartPos = this._computeSmartSpawnPosition(obj);
      obj.position.copyFrom(smartPos);
    }

    this._commit(
      `Add ${obj.name}`,
      () => {
        this.scene.add(obj);
        this.selectObject(obj);
      },
      () => {
        this._trashBin.add(obj);
        if (this._selected === obj) this.selectObject(undefined);
      },
      () => this._disposeTrashedObject(obj),
    );
  }

  /**
   * Inserts loaded project objects into the scene graph without smart-spawn repositioning,
   * without flooding the undo stack, and clears the undo stack for the freshly loaded project.
   */
  public loadProjectObjects(children: Object3D[]): void {
    for (const child of children) {
      this.scene.add(child);
    }
    this._hierarchyDirty = true;
    this.selectObject(undefined);
    this._undo.clear();
  }

  /** Filters the current selection to only return root nodes whose ancestors are not also selected,
   * preventing duplicate recursive operations (e.g. duplicating or trashing a parent and child together). */
  private _getTopLevelSelection(): Object3D[] {
    const selectedSet = new Set(this._selection);
    return Array.from(this._selection).filter((obj) => {
      if (!obj.parent) return false;
      let curr: Object3D | undefined = obj.parent;
      while (curr) {
        if (selectedSet.has(curr)) return false;
        curr = curr.parent;
      }
      return true;
    });
  }

  /** Deletes every currently selected object as one batch undo step. Works the same for a single
   * selected object as it did before multi-selection existed. */
  public deleteSelection(): void {
    const objs = this._getTopLevelSelection();
    if (0 === objs.length) return;
    const parents = objs.map((obj) => obj.parent!);

    this._commit(
      `Delete ${objs.length} object${objs.length > 1 ? "s" : ""}`,
      () => {
        for (const obj of objs) this._trashBin.add(obj);
        this.selectObject(undefined);
      },
      () => {
        objs.forEach((obj, i) => parents[i]!.add(obj));
        this._selectMultiple(objs);
      },
      () => {
        for (const obj of objs) this._disposeTrashedObject(obj);
      },
    );
  }

  public reparent(obj: Object3D, newParent: Object3D): void {
    const oldParent = obj.parent;
    if (!oldParent || oldParent === newParent) return;
    this._commit(
      `Move ${obj.name}`,
      () => {
        newParent.add(obj);
      },
      () => {
        oldParent.add(obj);
      },
    );
  }

  public renameObject(obj: Object3D, newName: string): void {
    const oldName = obj.name;
    if (oldName === newName) return;
    this._commit(
      `Rename to "${newName}"`,
      () => {
        obj.name = newName;
        this._hierarchyPanel.refresh();
      },
      () => {
        obj.name = oldName;
        this._hierarchyPanel.refresh();
      },
    );
  }

  /** Clones every selected object (via `Object3D.clone()`) and inserts each copy as a sibling
   * right next to its original, then selects the whole new set of copies as one batch undo step.
   * Works the same for a single selected object as it did before multi-selection existed. */
  public duplicateSelection(): void {
    const objs = this._getTopLevelSelection();
    if (0 === objs.length) return;
    const clones = objs.map((obj) => {
      const clone = obj.clone();
      clone.name = obj.name ? `${obj.name} Copy` : clone.name;
      return { parent: obj.parent!, clone };
    });

    this._commit(
      `Duplicate ${objs.length} object${objs.length > 1 ? "s" : ""}`,
      () => {
        for (const { parent, clone } of clones) parent.add(clone);
        this._selectMultiple(clones.map((c) => c.clone));
      },
      () => {
        for (const { clone } of clones) this._trashBin.add(clone);
        this._selectMultiple(objs);
      },
      () => {
        for (const { clone } of clones) this._disposeTrashedObject(clone);
      },
    );
  }

  /** Groups the current selection into a new empty parent. A single selected object is wrapped
   * at its own current world transform -- the group takes the object's old local transform, the
   * object resets to identity within it, Blender/Unity's "Group Selected". Multiple selected
   * objects go through `_groupMultiple()` instead. */
  public groupSelection(): void {
    const objs = this._getTopLevelSelection();
    if (0 === objs.length) return;
    if (1 === objs.length) {
      this._groupSingle(objs[0]!);
      return;
    }
    this._groupMultiple(objs);
  }

  private _groupSingle(obj: Object3D): void {
    const parent = obj.parent;
    if (!parent) return;

    const beforePos = obj.position.clone();
    const beforeRot = obj.rotation.clone();
    const beforeScale = obj.scale.clone();
    const group = new Object3D("Group");
    group.position.copyFrom(beforePos);
    group.rotation.copyFrom(beforeRot);
    group.scale.copyFrom(beforeScale);

    this._commit(
      `Group ${obj.name}`,
      () => {
        parent.add(group);
        group.updateMatrixWorld(); // group.worldMatrix must be current before children re-derive
        // their own worldMatrix from it below -- a freshly-added Object3D starts at identity.
        group.add(obj);
        obj.position.set(0, 0, 0);
        obj.rotation.set(0, 0, 0);
        obj.scale.set(1, 1, 1);
        obj.updateMatrixWorld();
        this.selectObject(group);
      },
      () => {
        parent.add(obj);
        obj.position.copyFrom(beforePos);
        obj.rotation.copyFrom(beforeRot);
        obj.scale.copyFrom(beforeScale);
        obj.updateMatrixWorld();
        this._trashBin.add(group);
        this.selectObject(obj);
      },
      () => this._disposeTrashedObject(group),
    );
  }

  /** Wraps several selected objects (possibly with different original parents) together under
   * one new group, added directly to the scene root and positioned at their centroid. Each
   * object's own position is adjusted to preserve its exact world position; rotation/scale are
   * left untouched, since the group itself gets identity rotation/scale -- that keeps the math to
   * a position-only offset instead of a full transform decomposition. Undoing restores each
   * object to its own original parent and position. */
  private _groupMultiple(objs: Object3D[]): void {
    const snapshots = objs.map((obj) => ({
      obj,
      parent: obj.parent!,
      position: obj.position.clone(),
    }));

    for (const obj of objs) obj.updateMatrixWorld();
    const worldPositions = objs.map((obj) => obj.getWorldPosition());
    const centroid = new Vector3D();
    for (const p of worldPositions) centroid.add(p);
    centroid.scale(1 / objs.length);

    const group = new Object3D("Group");
    group.position.copyFrom(centroid);

    this._commit(
      `Group ${objs.length} objects`,
      () => {
        this.scene.add(group);
        group.updateMatrixWorld(); // see the comment in _groupSingle()'s redo -- same reason.
        objs.forEach((obj, i) => {
          group.add(obj);
          obj.position.copyFrom(worldPositions[i]!.clone().sub(centroid));
          obj.updateMatrixWorld();
        });
        this.selectObject(group);
      },
      () => {
        for (const s of snapshots) {
          s.parent.add(s.obj);
          s.obj.position.copyFrom(s.position);
          s.obj.updateMatrixWorld();
        }
        this._trashBin.add(group);
        this._selectMultiple(objs);
      },
      () => this._disposeTrashedObject(group),
    );
  }

  public attachBehaviorToSelection(factory: () => Behavior): void {
    const objs = Array.from(this._selection);
    if (0 === objs.length) return;
    const sample = factory();
    const behaviorName = sample.constructor.name;
    const attached = new Map<Object3D, Behavior>();
    for (const obj of objs) {
      attached.set(obj, factory());
    }

    this._commit(
      `Attach ${behaviorName}${objs.length > 1 ? ` (${objs.length})` : ""}`,
      () => {
        for (const [obj, behavior] of attached) {
          attachBehavior(obj.behaviors, behavior, obj);
        }
      },
      () => {
        for (const [obj, behavior] of attached) {
          detachBehavior(obj.behaviors, behavior);
        }
      },
    );
  }

  public detachBehaviorFromObject(obj: Object3D, behavior: Behavior): void {
    const behaviorName = behavior.constructor.name;
    this._commit(
      `Detach ${behaviorName}`,
      () => {
        detachBehavior(obj.behaviors, behavior);
      },
      () => {
        attachBehavior(obj.behaviors, behavior, obj);
      },
    );
  }

  public setMaterialOnObject(obj: Object3D, newMaterial: AbstractMaterial | undefined): void {
    const oldMaterial = obj.material;
    const label = newMaterial ? `Set ${newMaterial.constructor.name}` : "Remove Material";
    this._commit(
      label,
      () => {
        obj.material = newMaterial;
      },
      () => {
        obj.material = oldMaterial;
      },
    );
  }

  private _onPointerDown(event: PointerEvent): void {
    // Camera Orbit: Right-click (2), Middle-click (1), Alt+Left-click, or Mac Ctrl+Click
    const isOrbit =
      2 === event.button ||
      1 === event.button ||
      event.buttons === 2 ||
      event.buttons === 4 ||
      (0 === event.button && event.altKey) ||
      (0 === event.button && event.ctrlKey && !event.metaKey && !event.shiftKey);
    if (isOrbit) {
      this._cameraDrag = { lastX: event.clientX, lastY: event.clientY };
      try {
        this.canvas.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture unavailable or unattached
      }
      event.preventDefault();
      return;
    }

    if (0 !== event.button) return; // Left click only for picking / gizmo / marquee
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2D(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );

    if (this._decalStamp.isActive) {
      void this._decalStamp.handlePointerDown(
        event.clientX - rect.left,
        event.clientY - rect.top,
        event.altKey,
      );
      return; // Stamp mode consumes every click -- no gizmo/selection while active.
    }

    if (this._importTools.isDrawingZone) {
      if (this._stageProjection) {
        this._raycaster.setFromCamera(ndc, this.camera);
        const uv = projectRayToUv(this._raycaster.ray, this._stageProjection);
        if (uv) this._importTools.addPoint(uv.u, uv.v);
      }
      return; // Drawing consumes every click -- no gizmo/selection while active.
    }

    if (this._stageProjection) {
      this._raycaster.setFromCamera(ndc, this.camera);
      const handles: Object3D[] = [];
      this._stageZoneGizmos.collectHandlePickables(handles);
      const handleHits = this._raycaster.intersectObjects(handles, true);
      const hitPoint =
        0 < handleHits.length
          ? this._stageZoneGizmos.getPointForObject(handleHits[0]!.object)
          : undefined;
      if (hitPoint) {
        const p = hitPoint.marker.zone.points[hitPoint.index]!;
        this._zonePointDrag = {
          marker: hitPoint.marker,
          index: hitPoint.index,
          before: { u: p.u, v: p.v },
        };
        return; // Point-handle grabbed -- don't also run normal object picking below.
      }
    }

    const gizmoAxis = this._gizmo.pickAxis(ndc, this.camera);
    if (gizmoAxis && this._primary) {
      const mode = this._gizmo.mode;
      this._primary.updateMatrixWorld();
      const pivot = this._primary.getWorldPosition();
      const before = new Map<Object3D, ObjectTransformSnapshot>();
      for (const obj of this._selection) {
        obj.updateMatrixWorld();
        before.set(obj, {
          position: obj.position.clone(),
          rotation: obj.rotation.clone(),
          scale: obj.scale.clone(),
          worldPosition: obj.getWorldPosition(),
        });
      }
      this._gizmoDrag = {
        axis: gizmoAxis,
        mode,
        pivot,
        accumulatedDelta: 0,
        before,
      };
      return; // Gizmo handle grabbed -- don't also run normal object picking below.
    }

    this._raycaster.setFromCamera(ndc, this.camera);
    const pickable: Object3D[] = [];
    this._collectPickable(this.scene.root, pickable);
    this._lightGizmos.collectPickables(pickable);
    this._stageZoneGizmos.collectPickables(pickable);
    const hits = this._raycaster.intersectObjects(pickable, true);
    const hitObj = 0 < hits.length ? hits[0]!.object : undefined;

    if (hitObj) {
      const targetObj =
        this._lightGizmos.getLightForObject(hitObj) ??
        this._stageZoneGizmos.getZoneForObject(hitObj) ??
        hitObj;
      if (event.shiftKey || event.metaKey) {
        this.toggleSelect(targetObj);
      } else {
        this.selectObject(targetObj);
      }
    } else {
      // Empty space clicked with primary left-click -- begin marquee selection
      this._marqueeState = {
        startX: event.clientX,
        startY: event.clientY,
        isShift: event.shiftKey || event.metaKey,
      };
    }
  }

  private _onWindowPointerMove(event: PointerEvent): void {
    if (this._decalStamp.isActive && !this._cameraDrag) {
      if (event.target === this.canvas) {
        const rect = this.canvas.getBoundingClientRect();
        this._decalStamp.handlePointerMove(
          event.clientX - rect.left,
          event.clientY - rect.top,
          event.altKey,
        );
      } else {
        this._decalStamp.handlePointerLeave();
      }
    }
    if (this._cameraDrag) {
      const dx = event.clientX - this._cameraDrag.lastX;
      const dy = event.clientY - this._cameraDrag.lastY;
      this._cameraDrag.lastX = event.clientX;
      this._cameraDrag.lastY = event.clientY;
      this._orbit.rotate(dx, dy);
      return;
    }

    if (this._zonePointDrag) {
      if (!this._stageProjection) return;
      const rect = this.canvas.getBoundingClientRect();
      const ndc = new Vector2D(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this._raycaster.setFromCamera(ndc, this.camera);
      const uv = projectRayToUv(this._raycaster.ray, this._stageProjection);
      if (uv) {
        const point = this._zonePointDrag.marker.zone.points[this._zonePointDrag.index]!;
        point.u = uv.u;
        point.v = uv.v;
      }
      return;
    }

    if (!this._marqueeState) return;
    const rect = this.canvas.getBoundingClientRect();
    const minX = Math.max(rect.left, Math.min(this._marqueeState.startX, event.clientX));
    const maxX = Math.min(rect.right, Math.max(this._marqueeState.startX, event.clientX));
    const minY = Math.max(rect.top, Math.min(this._marqueeState.startY, event.clientY));
    const maxY = Math.min(rect.bottom, Math.max(this._marqueeState.startY, event.clientY));
    const w = maxX - minX;
    const h = maxY - minY;

    if (w > 4 || h > 4) {
      this._marqueeEl.style.display = "block";
      this._marqueeEl.style.left = `${minX - rect.left}px`;
      this._marqueeEl.style.top = `${minY - rect.top}px`;
      this._marqueeEl.style.width = `${w}px`;
      this._marqueeEl.style.height = `${h}px`;
    }
  }

  private _onWindowPointerUp(event: PointerEvent): void {
    if (this._cameraDrag) {
      this._cameraDrag = undefined;
      try {
        this.canvas.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture already released or unattached
      }
      return;
    }

    if (this._zonePointDrag) {
      const { marker, index, before } = this._zonePointDrag;
      this._zonePointDrag = undefined;
      const point = marker.zone.points[index]!;
      const after = { u: point.u, v: point.v };
      if (after.u === before.u && after.v === before.v) return; // Click without an actual drag.

      // One undo command for the whole drag, exactly like `_finishGizmoDrag()` -- nothing was
      // pushed per pointermove above, only the live (u, v) mutation itself.
      this._commit(
        "Move Zone Point",
        () => {
          point.u = after.u;
          point.v = after.v;
        },
        () => {
          point.u = before.u;
          point.v = before.v;
        },
      );
      return;
    }

    if (!this._marqueeState) return;
    const { startX, startY, isShift } = this._marqueeState;
    this._marqueeState = undefined;
    this._marqueeEl.style.display = "none";

    const rect = this.canvas.getBoundingClientRect();
    const minX = Math.max(rect.left, Math.min(startX, event.clientX));
    const maxX = Math.min(rect.right, Math.max(startX, event.clientX));
    const minY = Math.max(rect.top, Math.min(startY, event.clientY));
    const maxY = Math.min(rect.bottom, Math.max(startY, event.clientY));
    const w = maxX - minX;
    const h = maxY - minY;

    if (w > 4 || h > 4) {
      const candidates: Object3D[] = [];
      this._collectPickable(this.scene.root, candidates);
      const matched: Object3D[] = [];

      for (const obj of candidates) {
        obj.updateMatrixWorld();
        if (this._isObjectInScreenRect(obj, minX, maxX, minY, maxY, rect)) {
          matched.push(obj);
        }
      }

      if (isShift) {
        for (const obj of matched) this._selection.add(obj);
        if (matched.length > 0) this._primary = matched.at(-1);
        this._applySelectionChange();
      } else {
        this._selectMultiple(matched);
      }
    } else {
      if (!isShift) {
        this.selectObject(undefined);
      }
    }
  }

  private _isObjectInScreenRect(
    obj: Object3D,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    rect: DOMRect,
  ): boolean {
    const pointsToTest: Vector3D[] = [];
    if (obj.bounds) {
      if (BoundingType.BOX === obj.bounds.type) {
        const box = obj.bounds as BoundingBox;
        pointsToTest.push(
          new Vector3D(box.min.x, box.min.y, box.min.z),
          new Vector3D(box.max.x, box.min.y, box.min.z),
          new Vector3D(box.min.x, box.max.y, box.min.z),
          new Vector3D(box.max.x, box.max.y, box.min.z),
          new Vector3D(box.min.x, box.min.y, box.max.z),
          new Vector3D(box.max.x, box.min.y, box.max.z),
          new Vector3D(box.min.x, box.max.y, box.max.z),
          new Vector3D(box.max.x, box.max.y, box.max.z),
        );
      } else if (BoundingType.SPHERE === obj.bounds.type) {
        const s = obj.bounds as BoundingSphere;
        pointsToTest.push(
          s.center.clone(),
          s.center.clone().add(new Vector3D(s.radius, 0, 0)),
          s.center.clone().add(new Vector3D(-s.radius, 0, 0)),
          s.center.clone().add(new Vector3D(0, s.radius, 0)),
          s.center.clone().add(new Vector3D(0, -s.radius, 0)),
          s.center.clone().add(new Vector3D(0, 0, s.radius)),
          s.center.clone().add(new Vector3D(0, 0, -s.radius)),
        );
      }
    } else {
      pointsToTest.push(obj.getWorldPosition());
    }

    let objMinX = Infinity;
    let objMaxX = -Infinity;
    let objMinY = Infinity;
    let objMaxY = -Infinity;
    let anyInFront = false;

    for (const p of pointsToTest) {
      const ndc = this.camera.viewProjectionMatrix4.transformVector(p.clone());
      if (ndc.z >= -1 && ndc.z <= 1) {
        anyInFront = true;
        const sx = (ndc.x * 0.5 + 0.5) * rect.width + rect.left;
        const sy = (-ndc.y * 0.5 + 0.5) * rect.height + rect.top;
        objMinX = Math.min(objMinX, sx);
        objMaxX = Math.max(objMaxX, sx);
        objMinY = Math.min(objMinY, sy);
        objMaxY = Math.max(objMaxY, sy);
      }
    }

    if (!anyInFront) return false;
    return !(objMaxX < minX || objMinX > maxX || objMaxY < minY || objMinY > maxY);
  }

  /** Ray-picks the surface under a canvas-relative position: scene geometry first (never the
   * editor grid, helper meshes or the stamp ghost), then the Y=0 ground plane with a +Y normal. */
  private _pickSurface(
    canvasX: number,
    canvasY: number,
  ): (DecalStampHit & { object?: Object3D }) | undefined {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2D((canvasX / rect.width) * 2 - 1, -(canvasY / rect.height) * 2 + 1);
    this._raycaster.setFromCamera(ndc, this.camera);

    const pickable: Object3D[] = [];
    this._collectPickable(this.scene.root, pickable);
    const hits = this._raycaster.intersectObjects(
      pickable.filter((o) => "EditorGrid" !== o.name),
      true,
    );
    const hit = hits[0];
    if (hit) return { point: hit.point, normal: hit.normal, object: hit.object };

    const ray = this._raycaster.ray;
    if (Math.abs(ray.direction.y) > 1e-4) {
      const t = -ray.origin.y / ray.direction.y;
      if (t > 0 && t < 1000) return { point: ray.at(t), normal: new Vector3D(0, 1, 0) };
    }
    return undefined;
  }

  /** World-space ray pick with the same scope and ground-plane fallback as `_pickSurface`. */
  private _pickRay(origin: Vector3D, direction: Vector3D): DecalStampHit | undefined {
    const ray = this._raycaster.ray;
    ray.origin.copyFrom(origin);
    ray.direction.copyFrom(direction);
    const pickable: Object3D[] = [];
    this._collectPickable(this.scene.root, pickable);
    const hit = this._raycaster.intersectObjects(
      pickable.filter((o) => "EditorGrid" !== o.name),
      true,
    )[0];
    if (hit) return { point: hit.point, normal: hit.normal };
    if (Math.abs(direction.y) > 1e-4) {
      const t = -origin.y / direction.y;
      if (t > 0 && t < 1000) return { point: ray.at(t), normal: new Vector3D(0, 1, 0) };
    }
    return undefined;
  }

  /** Mirrors `GadgetInspector`'s own picking scope (visible objects only, own helper meshes
   * excluded) so Maker and the still-live GadgetInspector behave consistently while both exist. */
  private _collectPickable(parent: Object3D, out: Object3D[]): void {
    if (
      this._highlightMeshes.includes(parent) ||
      parent === this._gizmo.root ||
      this._lightGizmos.isHelperMesh(parent) ||
      this._stageZoneGizmos.isHelperMesh(parent) ||
      this._decalStamp.isGhost(parent)
    ) {
      return;
    }
    if (parent.isVisible) {
      if (parent.geometry) parent.computeBounds();
      out.push(parent);
    }
    for (const child of parent.children) this._collectPickable(child, out);
  }

  private _getOrCreateHighlightMesh(index: number): Object3D {
    let mesh = this._highlightMeshes[index];
    if (!mesh) {
      mesh = new Object3D(`MakerHighlight${index}`);
      mesh.geometry = new Cube({ size: 1 }).getGeometryData();
      mesh.material = new WireframeMaterial(new Color(0, 1, 1));
      mesh.isVisible = false;
      this.scene.add(mesh);
      this._highlightMeshes[index] = mesh;
    }
    return mesh;
  }

  /** Fits `mesh` (a wireframe cube) to `obj`'s current world bounds. @returns Whether a fit was
   * possible -- false (with `mesh` left hidden by the caller) if `obj` has no bounds. */
  private _fitHighlightMesh(obj: Object3D, mesh: Object3D): boolean {
    if (!obj.bounds) return false;
    const epsilon = new Vector3D(0.02, 0.02, 0.02);
    if (BoundingType.BOX === obj.bounds.type) {
      const box = obj.bounds as BoundingBox;
      const size = new Vector3D().copyFrom(box.max).sub(box.min).add(epsilon);
      mesh.position.copyFrom(box.center);
      mesh.rotation.set(0, 0, 0);
      mesh.scale.copyFrom(size);
      mesh.updateMatrixWorld();
      return true;
    }
    if (BoundingType.OBB === obj.bounds.type) {
      // Oriented bounds (e.g. a Decal's box): the pooled cube takes the box's rotation, too.
      const obb = obj.bounds as OBB;
      const [ax, ay, az] = obb.axes;
      const basis = new Matrix4();
      basis.data.set([ax.x, ax.y, ax.z, 0, ay.x, ay.y, ay.z, 0, az.x, az.y, az.z, 0, 0, 0, 0, 1]);
      new Quaternion().setFromRotationMatrix(basis).toEuler(mesh.rotation);
      mesh.position.copyFrom(obb.center);
      mesh.scale.copyFrom(obb.halfExtents).scale(2).add(epsilon);
      mesh.updateMatrixWorld();
      return true;
    }
    if (BoundingType.SPHERE === obj.bounds.type) {
      const sphere = obj.bounds as BoundingSphere;
      const diameter = sphere.radius * 2;
      const size = new Vector3D(diameter, diameter, diameter).add(epsilon);
      mesh.position.copyFrom(sphere.center);
      mesh.rotation.set(0, 0, 0);
      mesh.scale.copyFrom(size);
      mesh.updateMatrixWorld();
      return true;
    }
    return false;
  }

  /** One highlight box per selected object, pooled by index -- the primary object's box is cyan,
   * every other selected object's is amber, so it's obvious at a glance which one the gizmo/
   * Property panel are actually driving. */
  private _syncHighlight(): void {
    const objs = Array.from(this._selection);
    for (let i = 0; i < objs.length; i++) {
      const obj = objs[i]!;
      const mesh = this._getOrCreateHighlightMesh(i);
      (mesh.material as WireframeMaterial).color.copyFrom(
        obj === this._primary
          ? MakerApp._PRIMARY_HIGHLIGHT_COLOR
          : MakerApp._SECONDARY_HIGHLIGHT_COLOR,
      );
      if (obj.geometry) obj.computeBounds();
      mesh.isVisible = this._fitHighlightMesh(obj, mesh);
    }
    for (let i = objs.length; i < this._highlightMeshes.length; i++) {
      this._highlightMeshes[i]!.isVisible = false;
    }
  }

  /** Central guard so any shortcut checks `INPUT`/`TEXTAREA`/`SELECT`/`contenteditable`,
   * preventing single-key shortcuts and undo from hijacking key events while typing in fields. */
  private _isEditingField(
    target: EventTarget | null = typeof document !== "undefined" ? document.activeElement : null,
  ): boolean {
    return isEditingTextInput(target) || isEditingTextInput();
  }

  /** Executes an undoable scene-edit command and runs the shared post-apply
   * follow-up (`_hierarchyDirty`, property selection, autosave) exactly once per
   * (re-)application. The ordering contract lives in `MakerUndoCore`; this thin
   * wrapper keeps every call site on the named helper. */
  private _commit(label: string, redo: () => void, undo: () => void, discard?: () => void): void {
    this._commitRunner.commit(label, redo, undo, discard);
  }

  /** Snapshots `objs` for one undo step, runs `apply` once to reach the target
   * state, then commits a single redo/undo pair (restoring the captured state)
   * with the transform-style follow-up (gizmo sync + selection + autosave). */
  private _snapshotCommand<T, O extends Object3D>(
    objs: O[],
    read: (obj: O) => T,
    write: (obj: O, value: T) => void,
    label: string,
    apply: () => void,
  ): void {
    this._snapshotRunner.snapshotCommand(objs, read, write, label, apply);
  }

  /** Editor operations the keymap table drives — built lazily (only after
   * `setupScene` has wired the panels/tools) and cached for the session. */
  private _keyContext: MakerKeyContext | undefined;
  private _getKeyContext(): MakerKeyContext {
    if (this._keyContext) return this._keyContext;
    const ctx: MakerKeyContext = {
      isEditingField: (): boolean => this._isEditingField(),
      isDecalStampActive: (): boolean => this._decalStamp.isActive,
      isDrawingZone: (): boolean => this._importTools.isDrawingZone,
      selectionSize: (): number => this._selection.size,
      hasPrimary: (): boolean => this._primary !== undefined,
      undo: (): void => this._undo.undo(),
      redo: (): void => this._undo.redo(),
      refreshSelectionAndHierarchy: (): void => {
        this._propertyPanel.setSelection(this._primary, Math.max(0, this._selection.size - 1));
        this._hierarchyDirty = true;
      },
      decalHandleKeyDown: (event): boolean =>
        // `MakerKeyEvent` is a structural subset of `KeyboardEvent`; the real
        // event flows straight through and only needs a cast for the tool's type.
        this._decalStamp.handleKeyDown(event as KeyboardEvent),
      decalDisable: (): void => this._decalStamp.disable(),
      zoneCancel: (): void => this._importTools.cancel(),
      zoneFinish: (): void => this._importTools.finish(),
      zoneToggle: (): void => this._importTools.toggle(),
      deleteSelection: (): void => this.deleteSelection(),
      startRenamingPrimary: (): void => {
        if (this._primary) this._hierarchyPanel.startRenaming(this._primary);
      },
      focusSearch: (): void => this._hierarchyPanel.focusSearch(),
      duplicateSelection: (): void => this.duplicateSelection(),
      groupSelection: (): void => this.groupSelection(),
      toggleSnap: (): void => {
        this._toolbars.toggleSnap();
      },
      saveCameraBookmark: (slot): void => this._toolbars.saveCameraBookmark(slot),
      jumpToCameraBookmark: (slot): void => this._toolbars.jumpToCameraBookmark(slot),
      setGizmoMode: (mode): void => this._toolbars.setGizmoMode(mode),
      stepGrid: (dir): void => {
        this._toolbars.stepGrid(dir);
      },
      snapSelectionToGround: (): void => this.snapSelectionToGround(),
      nudgeSelection: (key, isShift, isAlt): void => this.nudgeSelection(key, isShift, isAlt),
    };
    this._keyContext = ctx;
    return ctx;
  }

  /** Resolves every keyboard shortcut through the `MAKER_KEYMAP` table (ordered,
   * precedence explicit) instead of a hand-maintained if-chain. The table's
   * guards (editing fields, selection state, decal stamp pass-through) are the
   * exact ones the historical if-chain applied — see `MakerKeymap.ts`. */
  private _onMakerKeyDown(event: KeyboardEvent): void {
    dispatchMakerKey(event, this._getKeyContext());
  }

  /** Snaps selected object(s) so their lowest bounding-box point aligns exactly with the ground (Y = 0). */
  public snapSelectionToGround(): void {
    const objs = Array.from(this._selection);
    if (0 === objs.length) return;

    let minY = Infinity;
    for (const obj of objs) {
      obj.updateMatrixWorld();
      const aabb = this._prefabPipeline.computeSubtreeWorldBounds(obj);
      if (aabb) {
        minY = Math.min(minY, aabb.min.y);
      } else {
        minY = Math.min(minY, obj.getWorldPosition().y);
      }
    }

    if (!Number.isFinite(minY)) return;
    const dy = -minY;
    if (Math.abs(dy) < 0.0001) return;

    this._snapshotCommand(
      objs,
      (obj) => obj.position.clone(),
      (obj, pos) => {
        obj.position.copyFrom(pos);
      },
      `Snap ${objs.length} object${objs.length > 1 ? "s" : ""} to Ground`,
      () => {
        for (const obj of objs) {
          const nextPos = obj.position.clone();
          nextPos.y += dy;
          if (this._gizmo.snap.enabled) {
            nextPos.y = this._gizmo.snapValue("translate", nextPos.y);
          }
          obj.position.copyFrom(nextPos);
        }
      },
    );
  }

  /** Nudges selected object(s) along X/Y/Z axes via arrow keys according to active Gizmo mode (Move/Rotate/Scale) or Alt modifiers. */
  public nudgeSelection(key: string, isShift: boolean, isAlt: boolean = false): void {
    const objs = Array.from(this._selection);
    if (0 === objs.length) return;

    // Alt forces Rotate (or Alt+Shift forces Scale), otherwise follows current gizmo mode
    const mode: GizmoMode = isAlt && isShift ? "scale" : isAlt ? "rotate" : this._gizmo.mode;

    if ("rotate" === mode) {
      const baseAngle = this._gizmo.snap.enabled ? this._gizmo.snap.rotate : Math.PI / 12; // 15 deg
      const multiplier = isShift ? 6 : 1; // 6x = 90 deg quarter turn
      const snapAngle = baseAngle * multiplier;
      let rx = 0;
      let ry = 0;
      let rz = 0;

      if ("PageUp" === key) rz = snapAngle;
      else if ("PageDown" === key) rz = -snapAngle;
      else if ("ArrowLeft" === key) ry = snapAngle;
      else if ("ArrowRight" === key) ry = -snapAngle;
      else if ("ArrowUp" === key) rx = -snapAngle;
      else if ("ArrowDown" === key) rx = snapAngle;

      if (0 === rx && 0 === ry && 0 === rz) return;

      this._snapshotCommand(
        objs,
        (obj) => obj.rotation.clone(),
        (obj, rot) => {
          obj.rotation.copyFrom(rot);
        },
        `Rotate ${objs.length} object${objs.length > 1 ? "s" : ""}`,
        () => {
          for (const obj of objs) {
            const nextRot = obj.rotation.clone();
            nextRot.x += rx;
            nextRot.y += ry;
            nextRot.z += rz;
            if (this._gizmo.snap.enabled) {
              nextRot.x = this._gizmo.snapValue("rotate", nextRot.x);
              nextRot.y = this._gizmo.snapValue("rotate", nextRot.y);
              nextRot.z = this._gizmo.snapValue("rotate", nextRot.z);
            }
            obj.rotation.copyFrom(nextRot);
          }
        },
      );
      return;
    }

    if ("scale" === mode) {
      const baseStep = this._gizmo.snap.enabled ? this._gizmo.snap.scale : 0.25;
      const multiplier = isShift ? 10 : 1;
      const step = baseStep * multiplier;
      let sx = 0;
      let sy = 0;
      let sz = 0;

      if ("PageUp" === key) sy = step;
      else if ("PageDown" === key) sy = -step;
      else if ("ArrowLeft" === key) sx = -step;
      else if ("ArrowRight" === key) sx = step;
      else if ("ArrowUp" === key) sz = -step;
      else if ("ArrowDown" === key) sz = step;

      if (0 === sx && 0 === sy && 0 === sz) return;

      this._snapshotCommand(
        objs,
        (obj) => obj.scale.clone(),
        (obj, scale) => {
          obj.scale.copyFrom(scale);
        },
        `Scale ${objs.length} object${objs.length > 1 ? "s" : ""}`,
        () => {
          for (const obj of objs) {
            const nextScale = obj.scale.clone();
            nextScale.x = Math.max(0.01, nextScale.x + sx);
            nextScale.y = Math.max(0.01, nextScale.y + sy);
            nextScale.z = Math.max(0.01, nextScale.z + sz);
            if (this._gizmo.snap.enabled) {
              nextScale.x = this._gizmo.snapValue("scale", nextScale.x);
              nextScale.y = this._gizmo.snapValue("scale", nextScale.y);
              nextScale.z = this._gizmo.snapValue("scale", nextScale.z);
            }
            obj.scale.copyFrom(nextScale);
          }
        },
      );
      return;
    }

    // Default: Translate mode
    const baseStep = this._gizmo.snap.enabled ? this._gizmo.snap.translate : 0.5;
    const multiplier = isShift ? 10 : 1;
    const step = baseStep * multiplier;

    // Camera-cardinal alignment: arrow directions match on-screen visual perspective
    const camFwd = this.camera.target.clone().sub(this.camera.position);
    camFwd.y = 0;
    if (camFwd.lengthSq() < 0.0001) camFwd.set(0, 0, -1);
    else camFwd.normalize();

    let fwdX = 0;
    let fwdZ = 0;
    let rgtX = 0;
    let rgtZ = 0;

    if (Math.abs(camFwd.z) >= Math.abs(camFwd.x)) {
      fwdZ = camFwd.z > 0 ? 1 : -1;
      rgtX = -fwdZ;
    } else {
      fwdX = camFwd.x > 0 ? 1 : -1;
      rgtZ = fwdX;
    }

    let dx = 0;
    let dy = 0;
    let dz = 0;

    if ("PageUp" === key) {
      dy = step;
    } else if ("PageDown" === key) {
      dy = -step;
    } else if ("ArrowLeft" === key) {
      dx = -rgtX * step;
      dz = -rgtZ * step;
    } else if ("ArrowRight" === key) {
      dx = rgtX * step;
      dz = rgtZ * step;
    } else if ("ArrowUp" === key) {
      dx = fwdX * step;
      dz = fwdZ * step;
    } else if ("ArrowDown" === key) {
      dx = -fwdX * step;
      dz = -fwdZ * step;
    }

    if (0 === dx && 0 === dy && 0 === dz) return;

    this._snapshotCommand(
      objs,
      (obj) => obj.position.clone(),
      (obj, pos) => {
        obj.position.copyFrom(pos);
      },
      `Move ${objs.length} object${objs.length > 1 ? "s" : ""}`,
      () => {
        for (const obj of objs) {
          const nextPos = obj.position.clone();
          nextPos.x += dx;
          nextPos.y += dy;
          nextPos.z += dz;
          if (this._gizmo.snap.enabled) {
            nextPos.x = this._gizmo.snapValue("translate", nextPos.x);
            nextPos.y = this._gizmo.snapValue("translate", nextPos.y);
            nextPos.z = this._gizmo.snapValue("translate", nextPos.z);
          }
          obj.position.copyFrom(nextPos);
        }
      },
    );
  }

  public override destroy(): void {
    this._abortController.abort();
    this._abortController = new AbortController();
    this._modeRouter.stop();
    this._trashBin.remove(...this._trashBin.children);
    this._undo.clear();
    super.destroy();
  }
}
