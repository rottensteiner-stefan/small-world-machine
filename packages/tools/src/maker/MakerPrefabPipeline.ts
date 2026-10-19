import type { Camera, Object3D, Scene, BoundingVolume } from "@small-world-machine/engine";
import { AbstractLight, Vector3D } from "@small-world-machine/engine";
import type { OrbitCameraController } from "./OrbitCameraController.js";
import type { TransformGizmo } from "./TransformGizmo.js";
import type { LightGizmoManager } from "./LightGizmoManager.js";
import type { StageZoneGizmoManager } from "./StageZoneGizmoManager.js";
import type { PrefabPalette } from "./PrefabPalette.js";
import type { ProjectBinding } from "./ProjectBinding.js";

export interface MakerPrefabPipelineContext {
  scene: Scene;
  camera: Camera;
  canvas: HTMLCanvasElement;
  orbit: OrbitCameraController;
  gizmo: TransformGizmo;
  lightGizmos: LightGizmoManager;
  stageZoneGizmos: StageZoneGizmoManager;
  highlightMeshes: Object3D[];
  project: ProjectBinding;
  prefabPalette: PrefabPalette;
  statusContainer: HTMLElement;
  getSelected: () => Object3D | undefined;
  addObject: (obj: Object3D) => void;
  setThumbnailCaptureActive: (active: boolean) => void;
}

/**
 * Prefab save/instantiate pipeline plus the isolated-thumbnail capture it needs -- extracted from
 * `MakerApp` (MAJ-10 monolith split). Owns no scene-graph state of its own; every method reads the
 * live collaborators it was constructed with directly off `MakerApp`.
 */
export class MakerPrefabPipeline {
  constructor(private readonly _ctx: MakerPrefabPipelineContext) {}

  public async refreshPrefabList(): Promise<void> {
    const names = await this._ctx.project.listPrefabs();
    const entries = await Promise.all(
      names.map(async (name) => {
        const thumbnailDataUrl = await this._ctx.project.loadPrefabThumbnail(name);
        return thumbnailDataUrl ? { name, thumbnailDataUrl } : { name };
      }),
    );
    this._ctx.prefabPalette.setEntries(entries);
  }

  public saveSelectionAsPrefab(name: string): void {
    const obj = this._ctx.getSelected();
    if (!obj) return;
    void (async (): Promise<void> => {
      const saved = await this._ctx.project.savePrefab(name, obj);
      if (saved) {
        const thumbnail = await this._captureIsolatedThumbnail(obj);
        if (thumbnail) await this._ctx.project.savePrefabThumbnail(name, thumbnail);
      }
      this._ctx.statusContainer.textContent = saved
        ? `Saved prefab "${name}"`
        : "Bind a project folder first to save prefabs";
      if (saved) await this.refreshPrefabList();
    })();
  }

  public instantiatePrefab(name: string): void {
    void (async (): Promise<void> => {
      const instance = await this._ctx.project.loadPrefab(name);
      if (instance) this._ctx.addObject(instance);
    })();
  }

  /** Walks up from `obj` to whichever ancestor is a direct child of the scene root -- the unit
   * `_captureIsolatedThumbnail()` keeps visible while hiding every other top-level object. */
  private _topLevelAncestor(obj: Object3D): Object3D {
    let node = obj;
    while (node.parent && node.parent !== this._ctx.scene.root) node = node.parent;
    return node;
  }

  /** World-space AABB enclosing `bounds`, delegated to the volume's own `getAabb()` so every
   * concrete volume type (box, sphere, OBB, hull) is covered uniformly -- OBB/HULL bounds used
   * to yield no frame at all and could clip the prefab preview. */
  private _boundsToAabb(bounds: BoundingVolume): { min: Vector3D; max: Vector3D } | undefined {
    const aabb = bounds.getAabb();
    return { min: aabb.min.clone(), max: aabb.max.clone() };
  }

  /** Combined world-space AABB of `obj`'s own bounds plus every descendant's -- a prefab is
   * often more than one mesh (a barrel + its lid, a lamp + its glass), so framing on just `obj`
   * itself would clip the rest. @returns undefined if nothing in the subtree carries geometry. */
  public computeSubtreeWorldBounds(obj: Object3D): { min: Vector3D; max: Vector3D } | undefined {
    obj.updateMatrixWorld();
    let min: Vector3D | undefined;
    let max: Vector3D | undefined;
    const visit = (node: Object3D): void => {
      if (node.geometry) {
        node.computeBounds();
        const aabb = node.bounds && this._boundsToAabb(node.bounds);
        if (aabb) {
          min = min
            ? new Vector3D(
                Math.min(min.x, aabb.min.x),
                Math.min(min.y, aabb.min.y),
                Math.min(min.z, aabb.min.z),
              )
            : aabb.min;
          max = max
            ? new Vector3D(
                Math.max(max.x, aabb.max.x),
                Math.max(max.y, aabb.max.y),
                Math.max(max.z, aabb.max.z),
              )
            : aabb.max;
        }
      }
      for (const child of node.children) visit(child);
    };
    visit(obj);
    return min && max ? { min, max } : undefined;
  }

  /** Points the camera at `obj`'s combined subtree bounds from a fixed 3/4 angle, distance scaled
   * to the bounds' size. Falls back to a default distance around the object's own position if it
   * (and its subtree) carries no geometry at all. */
  private _frameCameraOn(obj: Object3D): void {
    const aabb = this.computeSubtreeWorldBounds(obj);
    let center: Vector3D;
    let radius: number;
    if (aabb) {
      center = aabb.min.clone().add(aabb.max).scale(0.5);
      radius = aabb.max.clone().sub(aabb.min).length() / 2;
    } else {
      obj.updateMatrixWorld();
      center = obj.getWorldPosition();
      radius = 1;
    }
    const distance = Math.max(1, radius * 2.2);
    const direction = new Vector3D(1, 0.75, 1).normalize();
    this._ctx.camera.position.copyFrom(center.clone().add(direction.scale(distance)));
    this._ctx.camera.target.copyFrom(center);
  }

  /** Captures a PNG snapshot of just `obj` (and its subtree) in isolation for a prefab
   * thumbnail: hides the gizmo, the selection highlight boxes, and every OTHER top-level scene
   * object except lights, then reframes the camera on `obj`'s own bounds.
   * Pauses the orbit camera controller for the duration (`setThumbnailCaptureActive`, checked by
   * `MakerApp.update()`) so it doesn't immediately overwrite this temporary framing on the next
   * tick.
   *
   * Waits two `requestAnimationFrame`s before reading the canvas, then restores everything --
   * visibility, camera position/target, and the orbit controller's own view state. Races that
   * against a 1s timeout: a tab that loses visibility right after the click can pause
   * `requestAnimationFrame` indefinitely.
   * @returns undefined if the canvas can't be read, or the timeout wins, rather than throwing.
   */
  private _captureIsolatedThumbnail(obj: Object3D): Promise<string | undefined> {
    const { gizmo, lightGizmos, stageZoneGizmos, highlightMeshes, scene, orbit, camera, canvas } =
      this._ctx;
    const wasGizmoVisible = gizmo.root.isVisible;
    const wasLightGizmosVisible = lightGizmos.root.isVisible;
    const wasStageZoneGizmosVisible = stageZoneGizmos.root.isVisible;
    const wasHighlightVisible = highlightMeshes.map((mesh) => mesh.isVisible);
    gizmo.root.isVisible = false;
    lightGizmos.root.isVisible = false;
    stageZoneGizmos.root.isVisible = false;
    for (const mesh of highlightMeshes) mesh.isVisible = false;

    const topAncestor = this._topLevelAncestor(obj);
    // Scene lights (SunLight/Fill, added at the same top level as anything the palette places)
    // must stay visible -- hiding them along with everything else would leave the isolated shot
    // completely unlit.
    const hiddenSiblings = scene.root.children.filter(
      (child) =>
        child !== topAncestor &&
        !highlightMeshes.includes(child) &&
        child !== gizmo.root &&
        child !== lightGizmos.root &&
        child !== stageZoneGizmos.root &&
        !lightGizmos.isHelperMesh(child) &&
        !stageZoneGizmos.isHelperMesh(child) &&
        !(child instanceof AbstractLight),
    );
    const wasSiblingVisible = hiddenSiblings.map((child) => child.isVisible);
    for (const child of hiddenSiblings) child.isVisible = false;

    const savedView = orbit.getView();
    const savedCameraPosition = camera.position.clone();
    const savedCameraTarget = camera.target.clone();
    this._ctx.setThumbnailCaptureActive(true);
    this._frameCameraOn(obj);

    const restore = (): void => {
      this._ctx.setThumbnailCaptureActive(false);
      orbit.setView(savedView);
      camera.position.copyFrom(savedCameraPosition);
      camera.target.copyFrom(savedCameraTarget);
      gizmo.root.isVisible = wasGizmoVisible;
      lightGizmos.root.isVisible = wasLightGizmosVisible;
      stageZoneGizmos.root.isVisible = wasStageZoneGizmosVisible;
      highlightMeshes.forEach((mesh, i) => {
        mesh.isVisible = wasHighlightVisible[i]!;
      });
      hiddenSiblings.forEach((child, i) => {
        child.isVisible = wasSiblingVisible[i]!;
      });
    };

    const capture = new Promise<string | undefined>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            resolve(canvas.toDataURL("image/png"));
          } catch {
            resolve(undefined);
          }
        });
      });
    });
    const timeout = new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), 1000);
    });

    return Promise.race([capture, timeout]).then((result) => {
      restore();
      return result;
    });
  }
}
