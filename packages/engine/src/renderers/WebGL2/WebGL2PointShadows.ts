import type { PointLight } from "../../core/lights/PointLight.js";
import {
  CUBE_FACE_COUNT,
  MAX_SHADOWED_POINT_LIGHTS,
  selectShadowedPointLights,
  writePointShadowFaceMatrices,
} from "../../core/lights/PointLightShadow.js";
import type { Object3D, RenderBatch } from "../../core/index.js";
import { InstancedMesh } from "../../core/InstancedMesh.js";
import { Frustum, Matrix4, Vector3D } from "../../math/index.js";
import { MaterialType, Topology, WireframeMode } from "../../enums/index.js";

/** @fixed point lights the WebGL2 UBO carries; the shader indexes `u_pointLights[i]` below it. */
const UBO_POINT_LIGHTS = 16;

/**
 * Per-frame CPU side of WebGL2 point-light shadows (ADR 0052): picks the shadowed lights, writes
 * the face matrices and `u_pointShadowInfo` lanes, collects every shadow caster within reach of a
 * chosen light from the whole scene (an off-screen occluder still shadows an on-screen receiver)
 * and filters them per face. The renderer draws the faces with its spot-shadow path.
 */
export class WebGL2PointShadows {
  /** Face view-projections, `slot * 6 + face`, GL clip space (`u_pointShadowMatrix[12]`). */
  public readonly matrices: Float32Array = new Float32Array(
    16 * CUBE_FACE_COUNT * MAX_SHADOWED_POINT_LIGHTS,
  );
  /** Per slot `[bias, normalBias, pLights index, castShadow]` (`u_pointShadowInfo[2]`). */
  public readonly info: Float32Array = new Float32Array(4 * MAX_SHADOWED_POINT_LIGHTS);
  /** Lights of the active slots, `[0, slotCount)`. */
  public readonly lights: PointLight[] = [];

  private _slotCount = 0;
  /** Per slot, bit `face` set when that face's region can reach the camera view. */
  private readonly _faceMask: Uint8Array = new Uint8Array(MAX_SHADOWED_POINT_LIGHTS);
  private readonly _chosen: Int32Array = new Int32Array(MAX_SHADOWED_POINT_LIGHTS);
  private readonly _chosenCasters: Int32Array = new Int32Array(MAX_SHADOWED_POINT_LIGHTS);
  private readonly _chosenPos: Vector3D[] = [];
  private readonly _uboLights: PointLight[] = [];
  private readonly _positions: Vector3D[] = [];
  private readonly _cameraFrustum: Frustum = new Frustum();
  private readonly _faceFrustum: Frustum = new Frustum();
  private readonly _faceMatrix: Matrix4 = new Matrix4();
  private readonly _forward: Vector3D = new Vector3D();
  /** Casters within reach of any chosen light, grouped like `RenderList.opaqueBatches`. */
  private readonly _casterBatches: RenderBatch[] = [];
  private readonly _casterLookup: Map<string, Map<Topology, RenderBatch>> = new Map();
  /** Every batch in `_casterLookup`, walked by index (no Map iteration in the frame loop). */
  private readonly _knownBatches: RenderBatch[] = [];
  /** Per-face filtered views of `_casterBatches` (pooled, never shrunk). */
  private readonly _facePool: RenderBatch[] = [];
  private readonly _faceBatches: RenderBatch[] = [];

  constructor() {
    for (let i = 0; i < MAX_SHADOWED_POINT_LIGHTS; i++) {
      this._chosenPos.push(new Vector3D());
      this._positions.push(new Vector3D());
    }
  }

  /** Active slots of the last {@link prepare}. */
  public get slotCount(): number {
    return this._slotCount;
  }

  /**
   * Chooses up to `max` lights, keeps only those with at least one caster in reach and one face
   * that can reach the camera view, and fills `matrices`/`info`/`lights` for them. `root` is the
   * scene root (whole-scene caster search); without it the camera-visible `fallback` batches are
   * the casters. Requires current world matrices and bounds. Zero-alloc after warm-up.
   */
  public prepare(
    pLights: readonly PointLight[],
    cameraViewProj: Matrix4,
    cameraPos: Vector3D,
    max: number,
    root: Object3D | undefined,
    fallback: readonly RenderBatch[],
  ): number {
    this._slotCount = 0;
    this.lights.length = 0;
    this.info.fill(0);
    this._faceMask.fill(0);
    this._casterBatches.length = 0;
    if (max <= 0 || pLights.length === 0) return 0;

    this._cameraFrustum.setFromMatrix(cameraViewProj);
    // The normalised near plane's normal is the view direction of a perspective camera.
    const planes = this._cameraFrustum.planes;
    this._forward.set(planes[16]!, planes[17]!, planes[18]!);

    const candidates = this._uboCandidates(pLights);
    const chosen = selectShadowedPointLights(
      candidates,
      cameraPos,
      this._forward,
      Math.min(max, MAX_SHADOWED_POINT_LIGHTS),
      this._chosen,
    );
    if (chosen === 0) return 0;
    for (let c = 0; c < chosen; c++) {
      candidates[this._chosen[c]!]!.getWorldPosition(this._chosenPos[c]!);
      this._chosenCasters[c] = 0;
    }

    this._collectCasters(root, fallback, candidates, chosen);

    for (let c = 0; c < chosen; c++) {
      if (this._chosenCasters[c] === 0) continue;
      const light = candidates[this._chosen[c]!]!;
      const pos = this._chosenPos[c]!;
      let mask = 0;
      for (let face = 0; face < CUBE_FACE_COUNT; face++) {
        if (this._faceReachesView(pos, light.distance, face)) mask |= 1 << face;
      }
      if (mask === 0) continue;

      const slot = this._slotCount++;
      this._faceMask[slot] = mask;
      this._positions[slot]!.copyFrom(pos);
      this.lights.push(light);
      writePointShadowFaceMatrices(pos, light.distance, this.matrices, slot * 16 * CUBE_FACE_COUNT);
      const o = slot * 4;
      this.info[o] = light.shadowBias;
      this.info[o + 1] = light.shadowNormalBias;
      this.info[o + 2] = this._chosen[c]!;
      this.info[o + 3] = 1;
    }
    return this._slotCount;
  }

  /** Whether `face` of `slot` must be rendered (its region can reach the camera view). */
  public isFaceVisible(slot: number, face: number): boolean {
    return (this._faceMask[slot]! & (1 << face)) !== 0;
  }

  /** World position of the light in `slot` as of {@link prepare}. */
  public position(slot: number): Vector3D {
    return this._positions[slot]!;
  }

  /**
   * Casters of `face` of `slot`: the collected casters whose bounds touch the face frustum
   * (which ends at the light's range). Valid until the next call.
   */
  public faceCasters(slot: number, face: number): RenderBatch[] {
    const m = this._faceMatrix.data;
    const all = this.matrices;
    const base = (slot * CUBE_FACE_COUNT + face) * 16;
    for (let k = 0; k < 16; k++) m[k] = all[base + k]!;
    this._faceFrustum.setFromMatrix(this._faceMatrix);

    const out = this._faceBatches;
    out.length = 0;
    for (let b = 0; b < this._casterBatches.length; b++) {
      const src = this._casterBatches[b]!;
      let dst: RenderBatch | undefined;
      for (let j = 0; j < src.objects.length; j++) {
        const o = src.objects[j]!;
        if (
          o.bounds &&
          !(o instanceof InstancedMesh) &&
          !this._faceFrustum.intersectsVolume(o.bounds)
        )
          continue;
        if (!dst) {
          dst = this._facePool[out.length];
          if (!dst) {
            dst = { shaderId: "", topology: Topology.DEFAULT, matUuid: "", objects: [] };
            this._facePool.push(dst);
          }
          dst.shaderId = src.shaderId;
          dst.topology = src.topology;
          dst.matUuid = src.matUuid;
          dst.wireframeMode = src.wireframeMode ?? WireframeMode.DEFAULT;
          dst.shadowWidth = src.shadowWidth ?? 0;
          dst.objects.length = 0;
          out.push(dst);
        }
        dst.objects.push(o);
      }
    }
    return out;
  }

  /** The first 16 point lights (the ones the UBO, and so the shader's light index, can address). */
  private _uboCandidates(pLights: readonly PointLight[]): readonly PointLight[] {
    if (pLights.length <= UBO_POINT_LIGHTS) return pLights;
    const out = this._uboLights;
    out.length = 0;
    for (let i = 0; i < UBO_POINT_LIGHTS; i++) out.push(pLights[i]!);
    return out;
  }

  /**
   * Gathers casters within reach of any chosen light into `_casterBatches` and counts them per
   * light. Objects without usable bounds (none, or an `InstancedMesh`, whose bounds cover only the
   * base geometry) count for every chosen light.
   */
  private _collectCasters(
    root: Object3D | undefined,
    fallback: readonly RenderBatch[],
    candidates: readonly PointLight[],
    chosen: number,
  ): void {
    const known = this._knownBatches;
    for (let b = 0; b < known.length; b++) known[b]!.objects.length = 0;
    if (root) {
      this._walk(root, candidates, chosen);
    } else {
      for (let b = 0; b < fallback.length; b++) {
        const objects = fallback[b]!.objects;
        for (let j = 0; j < objects.length; j++) this._consider(objects[j]!, candidates, chosen);
      }
    }
    // Batches that collected nothing are dropped, so a re-created material uuid never leaks.
    for (let b = known.length - 1; b >= 0; b--) {
      const batch = known[b]!;
      if (batch.objects.length > 0) continue;
      const byTopology = this._casterLookup.get(batch.matUuid);
      byTopology?.delete(batch.topology);
      if (byTopology && byTopology.size === 0) this._casterLookup.delete(batch.matUuid);
      known.splice(b, 1);
    }
    for (let b = 0; b < known.length; b++) this._casterBatches.push(known[b]!);
  }

  private _walk(obj: Object3D, candidates: readonly PointLight[], chosen: number): void {
    if (!obj.isVisible) return;
    this._consider(obj, candidates, chosen);
    const children = obj.children;
    for (let i = 0; i < children.length; i++) this._walk(children[i]!, candidates, chosen);
  }

  private _consider(obj: Object3D, candidates: readonly PointLight[], chosen: number): void {
    if (!obj.castShadow || !obj.geometry || !obj.material) return;
    const manifest = obj.material.getRenderManifest();
    const state = manifest.state;
    if (state?.transparent || state?.isDecal || manifest.shaderId === MaterialType.SKYBOX) return;

    const bounds = obj instanceof InstancedMesh ? undefined : obj.bounds;
    let reached = false;
    for (let c = 0; c < chosen; c++) {
      if (bounds) {
        const reach = candidates[this._chosen[c]!]!.distance + bounds.getBroadRadius();
        if (bounds.center.distanceTo(this._chosenPos[c]!) > reach) continue;
      }
      this._chosenCasters[c] = this._chosenCasters[c]! + 1;
      reached = true;
    }
    if (!reached) return;

    const topology = state?.topology || obj.geometry.topology || Topology.DEFAULT;
    let byTopology = this._casterLookup.get(obj.material.uuid);
    if (!byTopology) {
      byTopology = new Map();
      this._casterLookup.set(obj.material.uuid, byTopology);
    }
    let batch = byTopology.get(topology);
    if (!batch) {
      batch = { shaderId: manifest.shaderId, topology, matUuid: obj.material.uuid, objects: [] };
      byTopology.set(topology, batch);
      this._knownBatches.push(batch);
    }
    batch.wireframeMode = state?.wireframeMode || WireframeMode.DEFAULT;
    batch.shadowWidth = state?.shadowWidth ?? 0;
    batch.objects.push(obj);
  }

  /**
   * Conservative test whether the region `face` covers (the pyramid from the light to the face's
   * far square at `range`) can intersect the camera frustum: false only when one camera plane has
   * the apex and all four far corners behind it. Fragments outside that region never pick `face`,
   * and fragments beyond `range` receive no light, so a skipped face is never sampled.
   */
  private _faceReachesView(pos: Vector3D, range: number, face: number): boolean {
    const axis = face >> 1;
    const sign = (face & 1) === 0 ? range : -range;
    const p = this._cameraFrustum.planes;
    for (let k = 0; k < 24; k += 4) {
      const nx = p[k]!;
      const ny = p[k + 1]!;
      const nz = p[k + 2]!;
      const apex = nx * pos.x + ny * pos.y + nz * pos.z + p[k + 3]!;
      if (apex >= 0) continue;
      const n = axis === 0 ? nx : axis === 1 ? ny : nz;
      // Far square center plus the largest offset its corners reach along the plane normal.
      const spread = (Math.abs(nx) + Math.abs(ny) + Math.abs(nz) - Math.abs(n)) * range;
      if (apex + n * sign + spread >= 0) continue;
      return false;
    }
    return true;
  }
}
