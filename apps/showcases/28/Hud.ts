import type {
  BloomElement,
  BoundingBox,
  BoundingSphere,
  OrbitController,
  SpotLight,
  Scene,
  Camera,
  Input,
  Renderer,
} from "@small-world-machine/engine";
import {
  BoundingType,
  Color,
  Cube,
  GlassMaterial,
  MathUtils,
  Object3D,
  PostProcessingEffectType,
  Raycaster,
  StandardMaterial,
  Vector2D,
  Vector3D,
  WireframeMaterial,
} from "@small-world-machine/engine";
import { HierarchyPanel, PropertyPanel, UndoStack } from "@small-world-machine/tools";
import { Pane } from "tweakpane";
import { ShowcaseDrawer } from "../shared/ShowcaseDrawer.js";

/** Lab parameters the inspector reads and writes; owned by the showcase, which applies them every frame. */
export interface LabKnobs {
  manualTurntableControl: boolean;
  manualTurntableAngle: number;
  splitterX: number;
  splitterActive: boolean;
  causticIntensity: number;
  chromaticBounceIntensity: number;
}

/** What the inspector needs from the showcase (scene objects are created late, hence the getters). */
export interface LabInspectorHost {
  readonly scene: Scene;
  readonly camera: Camera;
  readonly canvas: HTMLCanvasElement;
  readonly input: Input;
  readonly renderer: Renderer;
  readonly orbitController: OrbitController | undefined;
  readonly turntable: Object3D | undefined;
  readonly prismMesh: Object3D | undefined;
  readonly laserLight: SpotLight | undefined;
  readonly floorCausticMesh: Object3D | undefined;
  readonly chromaticBounceLight: SpotLight | undefined;
  readonly knobs: LabKnobs;
}

const STYLE_ID = "swm-showcase28-inspector-styles";

// Only what differs from shared.css: the tool-theme look of drawer, header and footer button, the
// flat full-width sections and the hierarchy tree.
const STYLE = `
  .swm-inspector-btn:hover,
  .swm-inspector-btn.active {
    border-color: var(--tool-accent, #b000ff);
    color: var(--tool-accent, #b000ff);
  }
  #labInspectorDrawer {
    color: var(--tool-text, #f8fafc);
    font-family: var(--tool-font-ui, sans-serif);
  }
  #labInspectorDrawer .hud-header {
    border-bottom: 1px solid var(--tool-border, rgba(148, 163, 184, 0.15));
    background: var(--tool-panel-solid, #0e121c);
  }
  #labInspectorDrawer .hud-title {
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  #labInspectorDrawer .hud-close-btn {
    padding: 2px 6px;
  }
  #labInspectorDrawer .swm-inspector-section {
    border-bottom: 1px solid var(--tool-border, rgba(148, 163, 184, 0.15));
    display: flex;
    flex-direction: column;
  }
  .swm-inspector-section-header {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    padding: 8px 12px 6px;
    color: var(--tool-accent, #d884ff);
    background: rgba(255, 255, 255, 0.02);
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  }
  .swm-inspector-pane-wrap {
    padding: 6px;
  }
  .swm-inspector-hierarchy-wrap {
    padding: 6px;
    background: rgba(10, 14, 22, 0.6);
  }
  .maker-hierarchy {
    display: flex;
    flex-direction: column;
  }
  .maker-hierarchy-search-wrapper {
    margin-bottom: 6px;
  }
  .maker-hierarchy-search-input {
    width: 100%;
    box-sizing: border-box;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 4px;
    color: #f8fafc;
    padding: 4px 8px;
    font-size: 0.78rem;
    font-family: inherit;
  }
  .maker-hierarchy-search-input:focus {
    outline: none;
    border-color: var(--tool-accent, #b000ff);
  }
  .maker-hierarchy-tree {
    overflow-y: auto;
    max-height: 260px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-right: 2px;
  }
  .maker-hierarchy-row {
    flex-shrink: 0;
    height: 24px;
    line-height: 24px;
    padding-top: 0;
    padding-bottom: 0;
    padding-right: 8px;
    font-family: var(--tool-font-mono, monospace);
    font-size: 0.8rem;
    color: #cbd5e1;
    cursor: pointer;
    user-select: none;
    border-radius: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-sizing: border-box;
    display: flex;
    align-items: center;
  }
  .maker-hierarchy-row:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }
  .maker-hierarchy-row.selected {
    background: rgba(176, 0, 255, 0.22);
    color: var(--tool-accent, #d884ff);
    font-weight: 600;
  }
  .maker-hierarchy-rename-input {
    background: rgba(15, 23, 42, 0.95);
    border: 1px solid var(--tool-accent, #b000ff);
    border-radius: 3px;
    color: #fff;
    padding: 2px 6px;
    font-size: 0.8rem;
    font-family: var(--tool-font-mono, monospace);
    width: 100%;
    height: 22px;
    box-sizing: border-box;
  }
`;

const BODY = `
  <div class="swm-inspector-section">
    <div class="swm-inspector-section-header">Lab Parameters</div>
    <div id="swmInspectorParams" class="swm-inspector-pane-wrap"></div>
  </div>
  <div class="swm-inspector-section">
    <div class="swm-inspector-section-header">Scene Hierarchy</div>
    <div id="swmInspectorHierarchy" class="swm-inspector-hierarchy-wrap"></div>
  </div>
  <div class="swm-inspector-section">
    <div class="swm-inspector-section-header">Selected Object</div>
    <div id="swmInspectorProps" class="swm-inspector-pane-wrap"></div>
  </div>
`;

/**
 * Showcase 28's in-viewport Lab Inspector: collapsible drawer with the Lab Knobs, a hierarchy and a
 * property panel, viewport picking and a selection highlight.
 */
export class LabInspector {
  private _drawer: ShowcaseDrawer | undefined = undefined;
  private _isHoveringInspector = false;
  private _isDraggingInspector = false;
  private _undo = new UndoStack();
  private _hierarchyPanel: HierarchyPanel | undefined = undefined;
  private _propertyPanel: PropertyPanel | undefined = undefined;
  private _selectedObject: Object3D | undefined = undefined;
  private _selection = new Set<Object3D>();
  private _highlightMesh: Object3D | undefined = undefined;
  private readonly _raycaster = new Raycaster();
  private _pointerDownPos: { x: number; y: number } | null = null;
  constructor(private readonly host: LabInspectorHost) {}

  /** Whether the drawer is open. */
  public get isOpen(): boolean {
    return this._drawer?.isOpen ?? false;
  }

  /** Whether the user is interacting with the drawer (hover, drag or keyboard focus inside it). */
  public get isActive(): boolean {
    return (
      this.isOpen &&
      (this._isHoveringInspector ||
        this._isDraggingInspector ||
        (undefined !== this._drawer && this._drawer.root.contains(document.activeElement)))
    );
  }

  /** Re-syncs the selection highlight; call once per frame while an object is selected. */
  public syncSelection(): void {
    if (this.isOpen && this._selectedObject) {
      this._syncHighlight();
    }
  }

  private _isExcludedFromHierarchy(obj: Object3D): boolean {
    return (
      obj === this._highlightMesh ||
      obj.name === "EditorHighlight" ||
      obj.name.startsWith("SpectralRay_") ||
      obj.name.startsWith("IncidentBeam_") ||
      obj.name === "ReflectedBeam_90Deg" ||
      obj.name === "RefSensorSpot" ||
      obj.name === "InternalBeamPath" ||
      obj.name === "Band_Gradient" ||
      obj.name === "BenchCausticSpill" ||
      obj.name === "ChromaticBounceSpot" ||
      obj === this.host.chromaticBounceLight ||
      obj.name === "Skybox"
    );
  }

  private _collectPickable(parent: Object3D, out: Object3D[]): void {
    if (this._isExcludedFromHierarchy(parent)) return;
    if (parent.isVisible && parent.geometry) {
      parent.computeBounds();
      out.push(parent);
    }
    for (const child of parent.children) {
      this._collectPickable(child, out);
    }
  }

  private _pickFromScreen(clientX: number, clientY: number): void {
    const rect = this.host.canvas.getBoundingClientRect();
    const ndc = new Vector2D(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster.setFromCamera(ndc, this.host.camera);
    const pickables: Object3D[] = [];
    this._collectPickable(this.host.scene.root, pickables);
    const hits = this._raycaster.intersectObjects(pickables, true);
    const hitObj = hits.length > 0 ? hits[0]!.object : undefined;
    this._selectObject(hitObj);
  }

  private _selectObject(obj: Object3D | undefined): void {
    this._selection.clear();
    if (obj) {
      this._selection.add(obj);
    }
    this._selectedObject = obj;
    this._propertyPanel?.setSelection(obj);
    this._hierarchyPanel?.setSelected(this._selection);
    this._syncHighlight();
  }

  private _syncHighlight(): void {
    if (!this._highlightMesh) {
      const hl = new Object3D("EditorHighlight");
      hl.geometry = new Cube({ size: 1 }).getGeometryData();
      hl.material = new WireframeMaterial(new Color(0, 0.929, 1));
      hl.isVisible = false;
      this.host.scene.add(hl);
      this._highlightMesh = hl;
    }
    const hl = this._highlightMesh;
    if (!this.isOpen || !this._selectedObject) {
      hl.isVisible = false;
      return;
    }
    const obj = this._selectedObject;
    if (obj.geometry) {
      obj.computeBounds();
    }
    if (!obj.bounds) {
      hl.isVisible = false;
      return;
    }
    const epsilon = new Vector3D(0.015, 0.015, 0.015);
    if (BoundingType.BOX === obj.bounds.type) {
      const box = obj.bounds as BoundingBox;
      const size = new Vector3D().copyFrom(box.max).sub(box.min).add(epsilon);
      hl.position.copyFrom(box.center);
      hl.rotation.set(0, 0, 0);
      hl.scale.copyFrom(size);
      hl.updateMatrixWorld();
      hl.isVisible = true;
    } else if (BoundingType.SPHERE === obj.bounds.type) {
      const sphere = obj.bounds as BoundingSphere;
      const diameter = sphere.radius * 2;
      const size = new Vector3D(diameter, diameter, diameter).add(epsilon);
      hl.position.copyFrom(sphere.center);
      hl.rotation.set(0, 0, 0);
      hl.scale.copyFrom(size);
      hl.updateMatrixWorld();
      hl.isVisible = true;
    } else {
      hl.isVisible = false;
    }
  }

  public toggle(force?: boolean): void {
    this._drawer?.toggle(force);
    this._onToggled();
  }

  /** Handles the I / H panel shortcut. Returns true when the key was consumed. */
  public handleKey(event: KeyboardEvent): boolean {
    if (!this._drawer?.handleKey(event)) {
      return false;
    }
    this._onToggled();
    return true;
  }

  private _onToggled(): void {
    if (this.isOpen) {
      this._hierarchyPanel?.refresh();
      this._syncHighlight();
      return;
    }
    this._isHoveringInspector = false;
    this._isDraggingInspector = false;
    if (this.host.orbitController) {
      this.host.orbitController.enabled = true;
    }
    if (this._highlightMesh) {
      this._highlightMesh.isVisible = false;
    }
  }

  public setup(): void {
    if (typeof document === "undefined") return;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = STYLE;
      document.head.appendChild(style);
    }

    this._drawer = new ShowcaseDrawer({
      id: "labInspectorDrawer",
      title: "Lab Inspector",
      icon: "⚙",
      body: BODY,
      open: false,
    });
    const drawer = this._drawer.root;
    // Focused panel controls keep their keys (arrows in Tweakpane) away from the lab shortcuts.
    for (const eventName of ["keydown", "keyup"]) {
      drawer.addEventListener(eventName, (e: Event): void => e.stopPropagation());
    }
    // Runs after the drawer's own toggle handlers.
    const onToggled = (): void => this._onToggled();
    this._drawer.toggleButton.addEventListener("click", onToggled);
    this._drawer.query(".hud-close-btn")?.addEventListener("click", onToggled);

    drawer.addEventListener("pointerenter", () => {
      this._isHoveringInspector = true;
      if (this.host.orbitController) {
        this.host.orbitController.enabled = false;
      }
    });

    drawer.addEventListener("pointerleave", (e: PointerEvent) => {
      if (0 === e.buttons && !this._isDraggingInspector) {
        this._isHoveringInspector = false;
        if (this.host.orbitController) {
          this.host.orbitController.enabled = true;
        }
      }
    });

    drawer.addEventListener("pointerdown", () => {
      this._isHoveringInspector = true;
      this._isDraggingInspector = true;
      if (this.host.orbitController) {
        this.host.orbitController.enabled = false;
      }
      this.host.input.mouse.dx = 0;
      this.host.input.mouse.dy = 0;
      this.host.input.mouse.zoom = 0;
      this.host.input.mouse.left = false;
    });

    window.addEventListener("pointerup", () => {
      this._isDraggingInspector = false;
      if (!drawer.matches(":hover")) {
        this._isHoveringInspector = false;
        if (this.host.orbitController) {
          this.host.orbitController.enabled = true;
        }
      }
    });

    // Lab quick params pane
    const paramsContainer = drawer.querySelector("#swmInspectorParams") as HTMLElement;
    if (paramsContainer) {
      const pane = new Pane({ container: paramsContainer });

      const fTurntable = pane.addFolder({ title: "Prism & Turntable", expanded: true });
      const currentDeg = this.host.turntable
        ? MathUtils.radToDeg(this.host.turntable.rotation.y)
        : 0;
      fTurntable
        .addBinding({ angleDeg: currentDeg }, "angleDeg", {
          min: -180,
          max: 180,
          step: 0.5,
          label: "Stage Angle",
        })
        .on("change", (ev) => {
          if (!this.host.knobs.manualTurntableControl) {
            this.host.knobs.manualTurntableControl = true;
          }
          this.host.knobs.manualTurntableAngle = MathUtils.degToRad(ev.value);
          if (this.host.turntable)
            this.host.turntable.rotation.y = this.host.knobs.manualTurntableAngle;
        });

      fTurntable
        .addBinding({ autoWobble: !this.host.knobs.manualTurntableControl }, "autoWobble", {
          label: "Auto-Wobble",
        })
        .on("change", (ev) => {
          this.host.knobs.manualTurntableControl = !ev.value;
          if (this.host.knobs.manualTurntableControl && this.host.turntable) {
            this.host.knobs.manualTurntableAngle = this.host.turntable.rotation.y;
          }
        });

      const fSplitter = pane.addFolder({ title: "50:50 Beam Splitter", expanded: true });
      fSplitter
        .addBinding({ splitterX: this.host.knobs.splitterX }, "splitterX", {
          min: -3.35,
          max: -1.15,
          step: 0.05,
          label: "Rail Pos X",
        })
        .on("change", (ev) => {
          this.host.knobs.splitterX = ev.value;
        });

      fSplitter
        .addBinding({ active: this.host.knobs.splitterActive }, "active", {
          label: "Splitter Engaged",
        })
        .on("change", (ev) => {
          this.host.knobs.splitterActive = ev.value;
        });

      const fOptics = pane.addFolder({ title: "Optics & Glass", expanded: false });
      if (this.host.prismMesh && this.host.prismMesh.material instanceof GlassMaterial) {
        const gm = this.host.prismMesh.material;
        fOptics.addBinding(gm, "ior", { min: 1.1, max: 2.2, step: 0.01, label: "Prism IOR" });
        fOptics.addBinding(gm, "roughness", {
          min: 0.0,
          max: 0.35,
          step: 0.01,
          label: "Roughness",
        });
        fOptics.addBinding(gm, "thickness", { min: 0.1, max: 1.5, step: 0.05, label: "Thickness" });
      }

      const fLight = pane.addFolder({ title: "Laser & Bloom", expanded: false });
      if (this.host.laserLight) {
        fLight.addBinding(this.host.laserLight, "intensity", {
          min: 0.5,
          max: 6.0,
          step: 0.1,
          label: "Laser Power",
        });
      }
      const bloom = this.host.renderer.postProcessing.get<BloomElement>(
        PostProcessingEffectType.BLOOM,
      );
      if (bloom) {
        fLight.addBinding(bloom, "intensity", {
          min: 0.0,
          max: 1.2,
          step: 0.05,
          label: "Bloom Glow",
        });
      }

      const fCaustics = pane.addFolder({ title: "Caustics & Atmosphere (P2)", expanded: false });
      fCaustics
        .addBinding({ intensity: this.host.knobs.causticIntensity }, "intensity", {
          min: 0.0,
          max: 1.5,
          step: 0.05,
          label: "Caustic Power",
        })
        .on("change", (ev) => {
          this.host.knobs.causticIntensity = ev.value;
          if (this.host.floorCausticMesh?.material instanceof StandardMaterial) {
            this.host.floorCausticMesh.material.emissiveIntensity =
              this.host.knobs.causticIntensity;
          }
        });

      fCaustics
        .addBinding({ bounce: this.host.knobs.chromaticBounceIntensity }, "bounce", {
          min: 0.0,
          max: 2.5,
          step: 0.1,
          label: "Chromatic Bounce",
        })
        .on("change", (ev) => {
          this.host.knobs.chromaticBounceIntensity = ev.value;
        });
    }

    // Hierarchy Panel integration
    const hierarchyContainer = drawer.querySelector("#swmInspectorHierarchy") as HTMLElement;
    if (hierarchyContainer) {
      this._hierarchyPanel = new HierarchyPanel(
        hierarchyContainer,
        () => this.host.scene.root,
        {
          onSelect: (obj): void => {
            this._selectObject(obj);
          },
          onReparent: (): void => {},
          onRename: (obj, newName): void => {
            obj.name = newName;
            this._hierarchyPanel?.refresh();
          },
        },
        (obj): boolean => this._isExcludedFromHierarchy(obj),
      );
    }

    // Property Panel integration
    const propsContainer = drawer.querySelector("#swmInspectorProps") as HTMLElement;
    if (propsContainer) {
      this._propertyPanel = new PropertyPanel(propsContainer, this._undo, {
        onPropertyChanged: (_obj, propKey): void => {
          if ("name" === propKey) {
            this._hierarchyPanel?.refresh();
          }
        },
      });
    }

    // Viewport 3D object picking on canvas pointer interaction
    this.host.canvas.addEventListener("pointerdown", (event: PointerEvent) => {
      if (0 === event.button) {
        this._pointerDownPos = { x: event.clientX, y: event.clientY };
      }
    });

    this.host.canvas.addEventListener("pointerup", (event: PointerEvent) => {
      if (!this.isOpen || 0 !== event.button || !this._pointerDownPos) {
        return;
      }
      const dx = event.clientX - this._pointerDownPos.x;
      const dy = event.clientY - this._pointerDownPos.y;
      this._pointerDownPos = null;
      if (Math.hypot(dx, dy) > 5) {
        return;
      }
      this._pickFromScreen(event.clientX, event.clientY);
    });
  }
}
