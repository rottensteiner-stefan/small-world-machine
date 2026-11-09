import type { Scene } from "../Scene.js";
import type { Camera } from "../cameras/Camera.js";
import type { InputInterface } from "./Input.js";
import type { Object3D } from "../Object3D.js";
import type { Intersection } from "../../physix/index.js";
import { Raycaster } from "../../physix/index.js";
import { Vector2D } from "../../math/index.js";

/**
 * Handles Gamification events: raycasts into the scene and triggers pointer events
 * on Object3D instances (onPointerEnter, onPointerLeave, onPointerClick).
 */
export class InteractionManager {
  private _raycaster: Raycaster = new Raycaster();
  private _ndcCoords: Vector2D = new Vector2D();
  private _queryHits: Object3D[] = [];
  private _pickables: Object3D[] = [];
  private _pickableSet: Set<Object3D> = new Set();
  private _hoveredObject: Object3D | null = null;
  private _activeObject: Object3D | null = null;
  private _wasLeftDown: boolean = false;
  private _downX: number = 0;
  private _downY: number = 0;
  private _lastQueryHitsCount: number = 0;
  private _lastIntersectCount: number = 0;

  /** Maximum movement distance in pixels between pointer-down and pointer-up to still count as a click. */
  public clickDragThreshold: number = 6;

  constructor(
    public scene: Scene,
    public camera: Camera,
    public canvas: HTMLCanvasElement,
    public input: InputInterface,
  ) {}

  public get activeObject(): Object3D | null {
    return this._activeObject;
  }

  public get hoveredObject(): Object3D | null {
    return this._hoveredObject;
  }

  public get lastQueryHitsCount(): number {
    return this._lastQueryHitsCount;
  }

  public get lastIntersectCount(): number {
    return this._lastIntersectCount;
  }

  /**
   * Called every frame to process input and fire events.
   */
  public update(): void {
    const mouse = this.input.mouse;
    const rect = this.canvas.getBoundingClientRect();
    const x = mouse.x - rect.left;
    const y = mouse.y - rect.top;
    const outsideCanvas = x < 0 || x > rect.width || y < 0 || y > rect.height;

    if (this.input.isPointerLocked || outsideCanvas) {
      this._clearHover();
      // Release while locked/outside only ends the press (`onPointerUp`). `onPointerClick` is
      // intentionally NOT fired: a click requires the pointer to still be over the pressed object
      // on release (same `activeObject === hoveredObject` rule as below), and hover was just cleared.
      if (this._activeObject && !mouse.left) {
        if (this._activeObject.onPointerUp) {
          this._activeObject.onPointerUp();
        }
        this._activeObject = null;
      }
      this._wasLeftDown = mouse.left;
      return;
    }

    this._ndcCoords.x = (x / rect.width) * 2 - 1;
    this._ndcCoords.y = -(y / rect.height) * 2 + 1;

    this._raycaster.setFromCamera(this._ndcCoords, this.camera);

    this._pickableSet.clear();
    if (this.scene.staticOctree || this.scene.dynamicOctree || this.scene.spatialHash) {
      this._pickables.length = 0;
      this._queryHits.length = 0;
      if (this.scene.staticOctree) {
        this.scene.staticOctree.queryRay(this._raycaster.ray, this._queryHits);
      }
      if (this.scene.spatialHash) {
        this.scene.spatialHash.queryRay(this._raycaster.ray, this._queryHits);
      }
      if (this.scene.dynamicOctree) {
        this.scene.dynamicOctree.queryRay(this._raycaster.ray, this._queryHits);
      }
      for (const obj of this._queryHits) {
        const pickable = obj as Object3D;
        if (pickable.isPickable && !this._pickableSet.has(pickable)) {
          this._pickableSet.add(pickable);
          this._pickables.push(pickable);
        }
      }
    } else {
      const roots = this.scene.objects;
      let n = 0;
      for (let i = 0; i < roots.length; i++) {
        n = this._getPickableObjects(roots[i]!, this._pickables, n);
      }
      this._pickables.length = n;
    }

    const intersects: Intersection[] = this._raycaster.intersectObjects(this._pickables, true);
    this._lastQueryHitsCount = this._pickables.length;
    this._lastIntersectCount = intersects.length;

    let hitObject: Object3D | null = null;
    const firstIntersect = intersects[0];
    if (firstIntersect) {
      hitObject = firstIntersect.object;
    }

    // Handle enter/leave
    if (hitObject !== this._hoveredObject) {
      if (this._hoveredObject && this._hoveredObject.onPointerLeave) {
        this._hoveredObject.onPointerLeave();
      }
      this._hoveredObject = hitObject;
      if (this._hoveredObject && this._hoveredObject.onPointerEnter) {
        this._hoveredObject.onPointerEnter();
      }
    }

    // Handle click (fire on mouse release if we started pressing over the canvas)
    const isLeftDown = mouse.left;
    if (!this._wasLeftDown && isLeftDown) {
      // Mouse just pressed
      this._downX = mouse.x;
      this._downY = mouse.y;
      if (this._hoveredObject) {
        this._activeObject = this._hoveredObject;
        if (this._activeObject.onPointerDown) {
          const point = this._raycaster.ray.at(firstIntersect ? firstIntersect.distance : 0);
          this._activeObject.onPointerDown(this._raycaster.ray, point);
        }
      }
    } else if (this._wasLeftDown && !isLeftDown) {
      // Mouse just released
      if (this._activeObject) {
        if (this._activeObject.onPointerUp) {
          this._activeObject.onPointerUp();
        }
        const dragDist = Math.hypot(mouse.x - this._downX, mouse.y - this._downY);
        if (
          dragDist <= this.clickDragThreshold &&
          this._activeObject === this._hoveredObject &&
          this._activeObject.onPointerClick
        ) {
          this._activeObject.onPointerClick();
        }
      }
      this._activeObject = null;
    }

    if (this._activeObject && this._activeObject.onPointerMove) {
      this._activeObject.onPointerMove(this._raycaster.ray);
    }

    this._wasLeftDown = isLeftDown;
  }

  private _clearHover(): void {
    if (this._hoveredObject) {
      if (this._hoveredObject.onPointerLeave) {
        this._hoveredObject.onPointerLeave();
      }
      this._hoveredObject = null;
    }
  }

  /** Appends pickables below `parent` at `out[n..]`, returns the new count. Index writes and an
   * indexed loop: this walk runs over the whole scene every frame the pointer is over the canvas. */
  private _getPickableObjects(parent: Object3D, out: Object3D[], n: number): number {
    if (parent.isPickable) {
      parent.computeBounds();
      out[n++] = parent;
    }
    const children = parent.children;
    for (let i = 0; i < children.length; i++) {
      n = this._getPickableObjects(children[i]!, out, n);
    }
    return n;
  }
}
