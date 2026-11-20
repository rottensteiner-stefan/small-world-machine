import { InstancedMesh } from "../../core/InstancedMesh.js";
import type { Object3D } from "../../core/Object3D.js";
import type { RenderBatch } from "../../core/Scene.js";
import { MaterialType } from "../../enums/MaterialType.js";
import { Topology } from "../../enums/Topology.js";
import { WireframeMode } from "../../enums/WireframeMode.js";
import { Frustum, MathPool } from "../../math/index.js";

/** @fixed frames an empty caster batch survives before it is dropped (cheap re-show). */
const BATCH_IDLE_FRAMES = 120;

/** @fixed initial frustum pool capacity covering 4 CSM cascades + 4 spot lights + 2 point ranges. */
const INITIAL_FRUSTUM_POOL = 10;

/**
 * Collects opaque shadow casters directly from `scene.root` across one or more light frustums or
 * axis-aligned point-light ranges (R2 / ADR 0031 / ADR 0052). Ignores the main camera's `inFrustum`
 * and `occlusionCulled` flags so off-screen or camera-occluded casters continue to cast shadows
 * into the visible view. Zero-alloc once batches and frustum slots warm up.
 */
export class ShadowCasterCollector {
  public readonly batches: RenderBatch[] = [];
  private readonly _lookup = new Map<string, Map<Topology, RenderBatch>>();
  private readonly _frustums: Frustum[] = [];
  private _frustumCount = 0;

  constructor() {
    for (let i = 0; i < INITIAL_FRUSTUM_POOL; i++) {
      this._frustums.push(new Frustum());
    }
  }

  /** Starts a new collection pass: forgets active frustums and empties every batch without dropping backing stores. */
  public reset(): void {
    this._frustumCount = 0;
    for (let i = 0; i < this.batches.length; i++) {
      this.batches[i]!.objects.length = 0;
    }
  }

  private _acquireFrustum(): Frustum {
    if (this._frustumCount >= this._frustums.length) {
      this._frustums.push(new Frustum());
    }
    return this._frustums[this._frustumCount++]!;
  }

  /** Adds a light or cascade frustum from a 4x4 view-projection matrix (`Float32Array`). */
  public addViewProjectionMatrix(vp: Float32Array): void {
    const frustum = this._acquireFrustum();
    const tempMat = MathPool.acquireMatrix();
    tempMat.data.set(vp);
    frustum.setFromMatrix(tempMat);
    MathPool.releaseMatrix(tempMat);
  }

  /** Adds a pre-computed `Frustum` by copying its 24 plane floats. */
  public addFrustum(source: Frustum): void {
    const frustum = this._acquireFrustum();
    frustum.planes.set(source.planes);
  }

  /** Adds the axis-aligned cube `center ± range` that one shadowed point light can reach. */
  public addRange(x: number, y: number, z: number, range: number): void {
    const p = this._acquireFrustum().planes;
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

  /** Collects every shadow caster under `root` that intersects at least one added frustum/range. */
  public collect(root: Object3D): void {
    if (this._frustumCount === 0) {
      this._pruneIdleBatches();
      return;
    }
    this._visit(root);
    this._pruneIdleBatches();
  }

  private _visit(obj: Object3D): void {
    if (!obj.isVisible) return;
    if (
      obj.castShadow &&
      obj.material &&
      (obj.geometry || obj.positionBuffer) &&
      this._inAnyFrustum(obj)
    ) {
      this._add(obj);
    }
    const children = obj.children;
    for (let i = 0; i < children.length; i++) {
      this._visit(children[i]!);
    }
  }

  private _inAnyFrustum(obj: Object3D): boolean {
    // InstancedMesh bounds cover only the base geometry, not the instances (WebGL2 parity).
    if (!obj.bounds || obj instanceof InstancedMesh) return true;
    for (let i = 0; i < this._frustumCount; i++) {
      if (this._frustums[i]!.intersectsVolume(obj.bounds)) return true;
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
