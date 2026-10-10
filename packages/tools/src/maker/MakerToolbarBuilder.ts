import { Object3D } from "@small-world-machine/engine";
import { OrbitCameraController, OrbitCameraView } from "./OrbitCameraController.js";
import { GizmoMode, TransformGizmo } from "./TransformGizmo.js";
import { ProjectBinding } from "./ProjectBinding.js";

export interface MakerToolbarContext {
  paletteContainer: HTMLElement;
  statusContainer: HTMLElement;
  project: ProjectBinding;
  orbit: OrbitCameraController;
  gizmo: TransformGizmo;
  addObject: (obj: Object3D) => void;
  refreshPrefabList: () => Promise<void>;
  duplicateSelection: () => void;
  groupSelection: () => void;
  snapSelectionToGround: () => void;
  toggleZoneDrawMode: () => void;
}

/**
 * Builds Maker's palette toolbar rows (project binding, duplicate/group/ground, camera bookmarks,
 * gizmo mode/snap) and owns the small pieces of state those rows drive -- extracted from
 * `MakerApp` (MAJ-10 monolith split). Scene mutations themselves stay owned by the context
 * callbacks; this class only wires buttons and tracks UI-local state (bookmarked views, active
 * button highlighting).
 */
export class MakerToolbarBuilder {
  private readonly _cameraBookmarks = new Map<number, OrbitCameraView>();
  private _bookmarkButtons: Record<number, HTMLButtonElement> | undefined;
  private _gizmoButtons: Record<GizmoMode, HTMLButtonElement> | undefined;
  private _snapButton: HTMLButtonElement | undefined;
  private _zoneDrawButton: HTMLButtonElement | undefined;

  constructor(private readonly _ctx: MakerToolbarContext) {}

  public get cameraBookmarks(): ReadonlyMap<number, OrbitCameraView> {
    return this._cameraBookmarks;
  }

  /** Wired once by `MakerApp` right after construction so `MakerImportAndZoneTools` can toggle
   * the "active" highlight on the button this class builds. */
  public get zoneDrawButton(): HTMLButtonElement | undefined {
    return this._zoneDrawButton;
  }

  public setupProjectToolbar(): void {
    const button = document.createElement("button");
    button.className = "maker-palette-btn";
    button.textContent = "📁 Bind Project Folder";
    button.addEventListener("click", (): void => {
      void (async (): Promise<void> => {
        const bound = await this._ctx.project.bind();
        if (!bound) {
          this._ctx.statusContainer.textContent = "File System Access API unavailable or cancelled";
          return;
        }
        // Merge-in rather than replace: keeps the scope small for Phase 1 -- a full "close and
        // reopen a project" flow (clearing existing content first) is a later-phase concern.
        const loadedRoot = await this._ctx.project.load();
        if (loadedRoot) {
          for (const child of [...loadedRoot.children]) {
            this._ctx.addObject(child);
          }
        }
        await this._ctx.refreshPrefabList();
        this._ctx.statusContainer.textContent = "Saved";
      })();
    });
    this._ctx.paletteContainer.prepend(button);
  }

  /** Duplicate/Group/Ground buttons -- mirrors the `Ctrl/Cmd+D`/`Ctrl/Cmd+G`/`End` shortcuts
   * handled by `MakerApp`'s keyboard handler. All three silently no-op with nothing selected,
   * same as the palette's other selection-dependent actions (e.g. "Save as Prefab"). */
  public setupSelectionToolbar(): void {
    const row = document.createElement("div");
    row.className = "maker-gizmo-toolbar";

    const duplicate = document.createElement("button");
    duplicate.className = "maker-palette-btn";
    duplicate.textContent = "⧉ Duplicate (Ctrl+D)";
    duplicate.addEventListener("click", (): void => this._ctx.duplicateSelection());
    row.appendChild(duplicate);

    const group = document.createElement("button");
    group.className = "maker-palette-btn";
    group.textContent = "▤ Group (Ctrl+G)";
    group.addEventListener("click", (): void => this._ctx.groupSelection());
    row.appendChild(group);

    const ground = document.createElement("button");
    ground.className = "maker-palette-btn";
    ground.textContent = "⬇ Ground (End)";
    ground.title = "Snap selected object(s) to floor level (End)";
    ground.addEventListener("click", (): void => this._ctx.snapSelectionToGround());
    row.appendChild(ground);

    this._ctx.paletteContainer.prepend(row);
  }

  /** Nine numbered viewport-view slots -- mirrors the `1`-`9`/`Ctrl+1`-`9` shortcuts handled in
   * `MakerApp`'s keyboard handler. Left-click jumps to a saved view (no-op if the slot is empty);
   * right-click saves the current view into it, same "left acts, right configures" split as
   * Unity/Unreal's numpad camera bookmarks, adapted to mouse-only use. */
  public setupCameraBookmarkToolbar(): void {
    const row = document.createElement("div");
    row.className = "maker-gizmo-toolbar";
    const buttons: Partial<Record<number, HTMLButtonElement>> = {};
    for (let slot = 1; slot <= 9; slot++) {
      const button = document.createElement("button");
      button.className = "maker-palette-btn";
      button.textContent = `📷${slot}`;
      button.title = "Left-click: jump to view. Right-click: save current view here.";
      button.addEventListener("click", (): void => this.jumpToCameraBookmark(slot));
      button.addEventListener("contextmenu", (e: MouseEvent): void => {
        e.preventDefault();
        this.saveCameraBookmark(slot);
      });
      row.appendChild(button);
      buttons[slot] = button;
    }
    this._bookmarkButtons = buttons as Record<number, HTMLButtonElement>;
    this._ctx.paletteContainer.prepend(row);
  }

  /** Saves the current viewport view into bookmark `slot` (1-9), overwriting whatever was
   * there. */
  public saveCameraBookmark(slot: number): void {
    this._cameraBookmarks.set(slot, this._ctx.orbit.getView());
    this._bookmarkButtons?.[slot]?.classList.add("active");
  }

  /** Jumps to bookmark `slot`, if one has been saved -- silent no-op otherwise. */
  public jumpToCameraBookmark(slot: number): void {
    const view = this._cameraBookmarks.get(slot);
    if (view) this._ctx.orbit.setView(view);
  }

  /** Move/Rotate/Scale mode buttons -- mirrors the `W`/`E`/`R` shortcuts handled in `MakerApp`'s
   * keyboard handler, Blender/Godot/Unity convention. */
  public setupGizmoToolbar(): void {
    const row = document.createElement("div");
    row.className = "maker-gizmo-toolbar";
    const buttons: Partial<Record<GizmoMode, HTMLButtonElement>> = {};
    const specs: { mode: GizmoMode; label: string }[] = [
      { mode: "translate", label: "Move (W)" },
      { mode: "rotate", label: "Rotate (E)" },
      { mode: "scale", label: "Scale (R)" },
    ];
    for (const { mode, label } of specs) {
      const button = document.createElement("button");
      button.className = "maker-palette-btn";
      button.textContent = label;
      button.addEventListener("click", (): void => this.setGizmoMode(mode));
      row.appendChild(button);
      buttons[mode] = button;
    }
    this._gizmoButtons = buttons as Record<GizmoMode, HTMLButtonElement>;

    const snapBtn = document.createElement("button");
    snapBtn.className = "maker-palette-btn active";
    snapBtn.title = "Toggle grid/angle snapping (X). Use [ and ] to change grid size.";
    snapBtn.addEventListener("click", (): void => {
      this.toggleSnap();
    });
    row.appendChild(snapBtn);
    this._snapButton = snapBtn;
    this._updateSnapButton();

    const decGrid = document.createElement("button");
    decGrid.className = "maker-palette-btn";
    decGrid.textContent = "[-]";
    decGrid.title = "Decrease grid snap size ([)";
    decGrid.addEventListener("click", (): void => {
      this.stepGrid(-1);
    });
    row.appendChild(decGrid);

    const incGrid = document.createElement("button");
    incGrid.className = "maker-palette-btn";
    incGrid.textContent = "[+]";
    incGrid.title = "Increase grid snap size (])";
    incGrid.addEventListener("click", (): void => {
      this.stepGrid(1);
    });
    row.appendChild(incGrid);

    const drawZoneBtn = document.createElement("button");
    drawZoneBtn.className = "maker-palette-btn";
    drawZoneBtn.textContent = "✏️ Draw Zone (Z)";
    drawZoneBtn.title =
      "Click to place points (min. 3), Enter to close the zone, Escape to cancel.";
    drawZoneBtn.addEventListener("click", (): void => this._ctx.toggleZoneDrawMode());
    row.appendChild(drawZoneBtn);
    this._zoneDrawButton = drawZoneBtn;

    this._ctx.paletteContainer.prepend(row);
    this.setGizmoMode("translate");
  }

  public toggleSnap(): boolean {
    const enabled = this._ctx.gizmo.toggleSnap();
    this._updateSnapButton();
    return enabled;
  }

  public stepGrid(dir: 1 | -1): number {
    const step = this._ctx.gizmo.stepGrid(dir);
    this._updateSnapButton();
    return step;
  }

  private _updateSnapButton(): void {
    if (!this._snapButton) return;
    this._snapButton.textContent = `🧲 ${this._ctx.gizmo.snap.translate}m (X)`;
    this._snapButton.classList.toggle("active", this._ctx.gizmo.snap.enabled);
  }

  public setGizmoMode(mode: GizmoMode): void {
    this._ctx.gizmo.setMode(mode);
    if (!this._gizmoButtons) return;
    for (const m of Object.keys(this._gizmoButtons) as GizmoMode[]) {
      this._gizmoButtons[m].classList.toggle("active", m === mode);
    }
  }
}
