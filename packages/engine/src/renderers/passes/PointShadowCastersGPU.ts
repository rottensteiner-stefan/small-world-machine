import type { Object3D } from "../../core/Object3D.js";
import type { RenderBatch } from "../../core/Scene.js";
import { MaterialType } from "../../enums/MaterialType.js";
import { Topology } from "../../enums/Topology.js";
import { WireframeMode } from "../../enums/WireframeMode.js";
import { Frustum } from "../../math/index.js";
import { MAX_SHADOWED_POINT_LIGHTS } from "../../core/lights/PointLightShadow.js";

/** @fixed frames an empty caster batch survives before it is dropped (cheap re-show). */
const BATCH_IDLE_FRAMES = 120;

/**
 * Opaque shadow casters within reach of this frame's shadowed point lights (ADR 0052), batched
 * like the scene's render list so the spot pass draw loop and auto-instancing apply unchanged.
 * Collected from the whole scene graph, not the camera's visible list: an occluder outside the
 * view still throws a shadow onto visible receivers (the camera-list pitfall noted in ADR 0031).
 * Zero-alloc once the batches exist.
 */
export class PointShadowCastersGPU {
  public readonly batches: RenderBatch[] = [];
  private readonly _lookup = new Map<string, Map<Topology, RenderBatch>>();
  /** Axis-aligned light-range cubes as frustum planes, so every bounds type tests itself. */
  private readonly _ranges: Frustum[] = [];
  private _rangeCount = 0;

  constructor() {
    for (let i = 0; i < MAX_SHADOWED_POINT_LIGHTS; i++) this._ranges.push(new Frustum());
  }

  /** Starts a new frame: forgets the light ranges and empties every batch. */
  public reset(): void {
    this._rangeCount = 0;
    for (let i = 0; i < this.batches.length; i++) this.batches[i]!.objects.length = 0;
  }

  /** Adds the cube `center ± range` that one shadowed point light can reach. */
  public addRange(x: number, y: number, z: number, range: number): void {
    const p = this._ranges[this._rangeCount++]!.planes;
    p.fill(0);
    // Inward normals, `n · p + d >= 0` inside (Frustum plane convention).
    p[0] = -1;
    p[3] = x + range;
    p[4] = 1;
    p[7] = range - x;
    p[9] = -1;
    p[11] = y + range;
    p[13] = 1;
    p[15] = range - y;
    p[18] = -1;
    p[19] = z + range;
    p[22] = 1;
    p[23] = range - z;
  }

  /** Collects every caster under `root` that touches one of the added ranges. */
  public collect(root: Object3D): void {
    this._visit(root);
    this._pruneIdleBatches();
  }

  private _visit(obj: Object3D): void {
    if (!obj.isVisible) return;
    if (
      obj.castShadow &&
      obj.material &&
      (obj.geometry || (obj as Object3D & { positionBuffer?: unknown }).positionBuffer) &&
      this._inRange(obj)
    ) {
      this._add(obj);
    }
    for (let i = 0; i < obj.children.length; i++) this._visit(obj.children[i]!);
  }

  private _inRange(obj: Object3D): boolean {
    if (!obj.bounds) return true;
    for (let i = 0; i < this._rangeCount; i++) {
      if (obj.bounds.intersectsFrustum(this._ranges[i]!)) return true;
    }
    return false;
  }

  private _add(obj: Object3D): void {
    const manifest = obj.material!.getRenderManifest();
    const state = manifest.state;
    if (state?.isDecal || state?.transparent || manifest.shaderId === MaterialType.SKYBOX) return;
    const topology = state?.topology || obj.geometry?.topology || Topology.DEFAULT;
    const matUuid = obj.material!.uuid;
    let byTopology = this._lookup.get(matUuid);
    if (!byTopology) {
      byTopology = new Map();
      this._lookup.set(matUuid, byTopology);
    }
    let batch = byTopology.get(topology);
    if (!batch) {
      batch = { shaderId: manifest.shaderId, topology, matUuid, objects: [], idleFrames: 0 };
      byTopology.set(topology, batch);
      this.batches.push(batch);
    }
    batch.wireframeMode = state?.wireframeMode || WireframeMode.DEFAULT;
    batch.shadowWidth = state?.shadowWidth ?? 0;
    batch.objects.push(obj);
  }

  private _pruneIdleBatches(): void {
    for (let i = this.batches.length - 1; i >= 0; i--) {
      const batch = this.batches[i]!;
      if (batch.objects.length > 0) {
        batch.idleFrames = 0;
        continue;
      }
      batch.idleFrames = (batch.idleFrames ?? 0) + 1;
      if (batch.idleFrames < BATCH_IDLE_FRAMES) continue;
      this.batches.splice(i, 1);
      const byTopology = this._lookup.get(batch.matUuid)!;
      byTopology.delete(batch.topology);
      if (byTopology.size === 0) this._lookup.delete(batch.matUuid);
    }
  }
}
