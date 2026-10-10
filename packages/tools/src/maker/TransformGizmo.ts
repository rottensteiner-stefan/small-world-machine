import {
  Object3D,
  Color,
  BasicMaterial,
  Cylinder,
  Cone,
  Cube,
  Torus,
  Raycaster,
  Vector2D,
  Vector3D,
  CameraInterfaceData,
} from "@small-world-machine/engine";

export type GizmoMode = "translate" | "rotate" | "scale";
export type GizmoAxis = "x" | "y" | "z";

export interface GizmoSnapConfig {
  enabled: boolean;
  translate: number;
  rotate: number;
  scale: number;
}

const AXES: GizmoAxis[] = ["x", "y", "z"];
const AXIS_COLOR: Record<GizmoAxis, Color> = {
  x: new Color(1, 0.2, 0.2),
  y: new Color(0.2, 1, 0.2),
  z: new Color(0.2, 0.4, 1),
};
/** Rotation (radians) that turns a handle built pointing along +Y into pointing along the given
 * world axis instead -- Cylinder/Cone/Cube are all Y-aligned by construction, and `Torus` lies
 * flat in the XZ plane (hole axis = Y), so the same per-axis rotation re-orients both handle
 * families consistently. */
const AXIS_ROTATION: Record<GizmoAxis, Vector3D> = {
  x: new Vector3D(0, 0, -Math.PI / 2),
  y: new Vector3D(0, 0, 0),
  z: new Vector3D(Math.PI / 2, 0, 0),
};

/**
 * Viewport translate/rotate/scale gizmo for Maker's edit-mode camera -- see
 * docs/adr/0010-maker-editor-architecture.md Phase 2. Deliberately a *simplified* gizmo: each axis
 * handle drives its transform from screen-space mouse delta projected onto that axis's on-screen
 * direction, not full ray/plane intersection -- precise numeric entry is still available via
 * `PropertyPanel`, so this is a fast, approximate manipulation aid rather than the only way to
 * transform an object.
 *
 * Operates directly on `target.position`/`rotation`/`scale`, which are parent-local. For a
 * top-level object (parent === scene root, true for everything the palette creates today) that is
 * equivalent to world space; a target nested under a rotated/scaled parent will see the same
 * screen-space delta applied as if it had no such parent, which can look mildly "off" for that
 * case. Documented simplification, not a crash risk -- worth revisiting if/when Maker gains deep
 * hierarchy authoring.
 */
export class TransformGizmo {
  public readonly root = new Object3D("MakerGizmo");
  private _mode: GizmoMode = "translate";
  private readonly _groups: Record<GizmoMode, Object3D>;
  private readonly _axisByHandle = new Map<Object3D, GizmoAxis>();
  private readonly _raycaster = new Raycaster();
  private _target: Object3D | undefined;

  public static readonly GRID_STEPS: readonly number[] = [0.1, 0.25, 0.5, 1.0, 2.0];

  public snap: GizmoSnapConfig = {
    enabled: true,
    translate: 0.5,
    rotate: Math.PI / 12, // 15 degrees
    scale: 0.25,
  };

  public get mode(): GizmoMode {
    return this._mode;
  }

  /** Cycles translation grid snap size up or down among [0.1, 0.25, 0.5, 1.0, 2.0]. */
  public stepGrid(direction: 1 | -1): number {
    const steps = TransformGizmo.GRID_STEPS;
    let idx = steps.indexOf(this.snap.translate);
    if (-1 === idx) idx = 2; // default 0.5
    const nextIdx = Math.max(0, Math.min(steps.length - 1, idx + direction));
    this.snap.translate = steps[nextIdx]!;
    return this.snap.translate;
  }

  /** Snaps a scalar value according to the current mode's snap setting, if snapping is enabled. */
  public snapValue(mode: GizmoMode, value: number): number {
    if (!this.snap.enabled) return value;
    const step =
      "translate" === mode
        ? this.snap.translate
        : "rotate" === mode
          ? this.snap.rotate
          : this.snap.scale;
    if (step <= 0) return value;
    const snapped = Math.round(value / step) * step;
    return "scale" === mode ? Math.max(0.01, snapped) : snapped;
  }

  public toggleSnap(): boolean {
    this.snap.enabled = !this.snap.enabled;
    return this.snap.enabled;
  }

  constructor() {
    this.root.frustumCulled = false;
    this.root.isCollidable = false; // the container itself is never a raycast target, only its leaf handles are
    this.root.isVisible = false;

    this._groups = {
      translate: this._buildAxisSet("translate", (color) => this._buildArrow(color)),
      rotate: this._buildAxisSet("rotate", (color) => this._buildRing(color)),
      scale: this._buildAxisSet("scale", (color) => this._buildArrow(color, true)),
    };
    for (const mode of Object.keys(this._groups) as GizmoMode[]) {
      const group = this._groups[mode];
      group.isVisible = mode === this._mode;
      this.root.add(group);
    }
  }

  public setMode(mode: GizmoMode): void {
    this._mode = mode;
    for (const m of Object.keys(this._groups) as GizmoMode[]) {
      this._groups[m].isVisible = m === mode;
    }
  }

  public attachTo(target: Object3D | undefined): void {
    this._target = target;
    this.root.isVisible = undefined !== target;
  }

  /** Keeps the gizmo glued to the target's world position and at a roughly constant on-screen
   * size regardless of camera distance. Call once per frame, after the target's own
   * `updateMatrixWorld()` has run. */
  public update(camera: CameraInterfaceData): void {
    if (!this._target) return;
    const worldPos = new Vector3D();
    const worldRot = new Vector3D();
    const worldScale = new Vector3D();
    this._target.worldMatrix.decompose(worldPos, worldRot, worldScale);

    this.root.position.copyFrom(worldPos);
    const distance = worldPos.clone().sub(camera.position).length();
    const s = Math.max(0.001, distance * 0.18);
    this.root.scale.set(s, s, s);
    this.root.updateMatrixWorld();
  }

  /** Raycast against only the currently visible mode's handles. Returns the hit axis, or
   * `undefined` if the ray missed every handle (or the gizmo has no attached target). */
  public pickAxis(ndc: Vector2D, camera: CameraInterfaceData): GizmoAxis | undefined {
    if (!this._target) return undefined;
    const group = this._groups[this._mode];
    const candidates: Object3D[] = [];
    for (const handle of group.children) {
      this._collectLeaves(handle, candidates);
    }
    for (const leaf of candidates) {
      leaf.updateMatrixWorld();
      leaf.computeBounds();
    }
    this._raycaster.setFromCamera(ndc, camera);
    const hits = this._raycaster.intersectObjects(candidates, true);
    if (0 === hits.length) return undefined;
    return this._axisByHandle.get(hits[0]!.object);
  }

  /** Handles are either a single mesh (rings) or a container of geometry-less sub-meshes
   * (arrows: shaft + tip) -- only objects that actually carry geometry are raycastable. */
  private _collectLeaves(node: Object3D, out: Object3D[]): void {
    if (node.geometry) out.push(node);
    for (const child of node.children) this._collectLeaves(child, out);
  }

  /** Converts this frame's accumulated screen-space mouse delta into a scalar change for the
   * given axis, appropriate to the current mode (world units for translate, radians for rotate,
   * a unitless scale increment for scale). Projects the axis onto the camera's screen-right/up
   * basis so dragging "along" an axis's on-screen direction feels natural from any viewing angle. */
  public computeAxisDelta(
    axis: GizmoAxis,
    dx: number,
    dy: number,
    camera: CameraInterfaceData,
  ): number {
    // Rotation is driven by horizontal drag alone, regardless of axis: dragging "along" an
    // axis's own screen-projected direction (the translate/scale approach below) breaks down for
    // a ring, since the natural gesture is tangential to the ring's circumference, not along the
    // axis itself -- for a ring whose axis projects mostly *vertically* on screen (Y, from most
    // viewing angles) that would perversely require a vertical drag to spin it. A flat "left/right
    // spins it" convention sidesteps computing per-axis tangent direction and reads consistently
    // across all three axes.
    if ("rotate" === this._mode) return dx * 0.01;

    const forward = camera.target.clone().sub(camera.position).normalize();
    const right = forward.clone().cross(camera.up).normalize();
    const screenUp = right.clone().cross(forward).normalize();

    const axisVec = new Vector3D(0, 0, 0);
    axisVec[axis] = 1;
    const screenX = axisVec.dot(right);
    const screenY = -axisVec.dot(screenUp); // screen Y grows downward, world/camera up doesn't
    const len = Math.hypot(screenX, screenY) || 1;
    const projected = (dx * screenX + dy * screenY) / len;

    if ("scale" === this._mode) return projected * 0.01;

    const worldPos = new Vector3D();
    if (this._target) this._target.worldMatrix.decompose(worldPos, new Vector3D(), new Vector3D());
    const camDistance = worldPos.clone().sub(camera.position).length();
    return projected * camDistance * 0.002;
  }

  private _buildAxisSet(mode: GizmoMode, factory: (color: Color) => Object3D): Object3D {
    const group = new Object3D(`MakerGizmo_${mode}`);
    for (const axis of AXES) {
      const handle = factory(AXIS_COLOR[axis]);
      handle.name = `MakerGizmoHandle_${mode}_${axis}`;
      handle.rotation.copyFrom(AXIS_ROTATION[axis]);
      handle.isVisible = true;
      handle.frustumCulled = false;
      group.add(handle);
      for (const leaf of this._leavesOf(handle)) this._axisByHandle.set(leaf, axis);
    }
    return group;
  }

  private _leavesOf(node: Object3D): Object3D[] {
    const out: Object3D[] = [];
    this._collectLeaves(node, out);
    return out;
  }

  /** A shaft + tip pointing along +Y. `cubeTip` swaps the cone for a cube tip, the conventional
   * visual distinction between translate and scale handles. */
  private _buildArrow(color: Color, cubeTip: boolean = false): Object3D {
    const handle = new Object3D("GizmoArrow");
    const mat = new BasicMaterial({ color });
    mat.depthTest = false;
    mat.depthWrite = false;

    const shaft = new Object3D("Shaft");
    shaft.geometry = new Cylinder({
      radiusTop: 0.03,
      radiusBottom: 0.03,
      height: 0.7,
    }).getGeometryData();
    shaft.material = mat;
    shaft.position.set(0, 0.35, 0);
    handle.add(shaft);

    const tip = new Object3D("Tip");
    tip.geometry = cubeTip
      ? new Cube({ size: 0.14 }).getGeometryData()
      : new Cone({ radius: 0.1, height: 0.28 }).getGeometryData();
    tip.material = mat;
    tip.position.set(0, 0.84, 0);
    handle.add(tip);

    handle.updateMatrixWorld();
    return handle;
  }

  /** A ring lying flat in the XZ plane (hole axis = Y) -- see `AXIS_ROTATION` for how each axis
   * re-orients it. */
  private _buildRing(color: Color): Object3D {
    const handle = new Object3D("GizmoRing");
    const mat = new BasicMaterial({ color });
    mat.depthTest = false;
    mat.depthWrite = false;

    handle.geometry = new Torus({ radius: 0.9, tube: 0.05, tubularSegments: 48 }).getGeometryData();
    handle.material = mat;
    handle.updateMatrixWorld();
    return handle;
  }
}
