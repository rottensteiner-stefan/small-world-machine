import type { Scene } from "../../core/index.js";
import { DepthMaterial } from "../../core/materials/index.js";
import { MaterialType } from "../../enums/MaterialType.js";
import { Topology } from "../../enums/Topology.js";
import type { WebGPURenderer } from "../WebGPU/WebGPURenderer.js";
import {
  VIEW_SLOT_POINT_SHADOW_BASE,
  VIEW_SLOT_SPOT_SHADOW_BASE,
} from "../WebGPU/WebGPURenderer.js";
import type { RenderPass } from "../index.js";
import { InstancedMesh } from "../../core/InstancedMesh.js";
import type { Object3D } from "../../core/Object3D.js";
import type { SpotLight } from "../../core/lights/SpotLight.js";
import type { PointLight } from "../../core/lights/PointLight.js";
import type { RenderBatch } from "../../core/Scene.js";
import { Matrix4, MathPool, Frustum, Vector3D } from "../../math/index.js";
import { WebGPUGGlobalUniformLayout } from "../GlobalUniformLayout.js";
import { usesLineQuadShadow } from "../LineShadowRibbon.js";
import {
  CUBE_FACE_COUNT,
  MAX_SHADOWED_POINT_LIGHTS,
  POINT_SHADOW_NEAR,
  SHADOW_ARRAY_LAYERS,
  SPOT_SHADOW_LAYERS,
  pointShadowLayer,
  selectShadowedPointLights,
  writePointShadowFaceMatrices,
} from "../../core/lights/PointLightShadow.js";
import { PointShadowCastersGPU } from "./PointShadowCastersGPU.js";

const _scratchLightCasters: SpotLight[] = [];
const _scratchCasters: Object3D[] = [];
const _scratchInstanced: InstancedMesh[] = [];
const _scratchStandard: Object3D[] = [];

/** Frames without a shadow-casting spot light before the shadow atlas is freed. */
const SPOT_FBO_IDLE_FRAMES = 120;
/** @fixed atlas resolution fallback when a point light's `shadowResolution` is 0. */
const POINT_SHADOW_FALLBACK_RESOLUTION = 256;

const _lightPos = new Vector3D();
const _cameraForward = new Vector3D();

/**
 * False when no point of the light-range-limited pyramid of `face` lies inside the camera
 * frustum (all five corners behind one plane, `margin` meters of slack): then no visible
 * receiver can sample that face. Conservative, it may keep a face that is not needed.
 */
export function pointShadowFaceReachesView(
  cameraPlanes: Float32Array,
  position: Vector3D,
  far: number,
  face: number,
  margin: number,
): boolean {
  const axis = face >> 1;
  const sign = (face & 1) === 0 ? far : -far;
  for (let p = 0; p < 24; p += 4) {
    const nx = cameraPlanes[p]!;
    const ny = cameraPlanes[p + 1]!;
    const nz = cameraPlanes[p + 2]!;
    const apex = nx * position.x + ny * position.y + nz * position.z + cameraPlanes[p + 3]!;
    if (apex >= -margin) continue;
    // Far corners: apex + sign * axis ± far * the two other axes. The plane distance is linear,
    // so the farthest-inside corner takes the sign of each remaining normal component.
    const n = axis === 0 ? nx : axis === 1 ? ny : nz;
    const spread = far * (Math.abs(nx) + Math.abs(ny) + Math.abs(nz) - Math.abs(n));
    if (apex + sign * n + spread >= -margin) continue;
    return false;
  }
  return true;
}

export class SpotShadowPassGPU implements RenderPass {
  public name = "SpotShadowPassGPU";

  /** Keyed by format -- see `CascadedShadowPassGPU._dummyTargetViews`'s doc comment for why a
   * single cached view (fixed at whichever format happened to be current the first time this
   * pass ever ran) silently mismatched the depth material's pipeline in whichever context
   * (main scene pass vs. a `PlanarReflectionNode` sub-render) didn't match that first one. */
  private _dummyTargets = new Map<
    GPUTextureFormat,
    { tex: GPUTexture; view: GPUTextureView; resolution: number }
  >();
  /** Consecutive frames without any shadow-casting spot light, see `SPOT_FBO_IDLE_FRAMES`. */
  private _idleFrames = 0;
  private _bindGroupNeedsShadowRebuild = true;
  private _shadowCasterBindGroupVersion = -1;
  private _depthMaterial?: DepthMaterial;
  /** Line casters with a `shadowWidth` (ADR 0045): edges drawn as world-width quads. */
  private _lineDepthMaterial?: DepthMaterial;
  private _shadowCasterBindGroup?: GPUBindGroup;
  private _spotShadowTexView?: GPUTextureView | undefined;
  private _fbo?: GPUTexture | undefined;
  private _layerViews: GPUTextureView[] = [];
  private _frustum: Frustum = new Frustum();
  private _cameraFrustum: Frustum = new Frustum();
  /** Consecutive frames without a shadowed point light; the face layers go after the grace period. */
  private _pointIdleFrames = 0;
  /** pLights index per point shadow slot this frame, see `selectShadowedPointLights`. */
  private readonly _pointSlots = new Int32Array(MAX_SHADOWED_POINT_LIGHTS);
  private readonly _faceMatrices = new Float32Array(
    MAX_SHADOWED_POINT_LIGHTS * CUBE_FACE_COUNT * 16,
  );
  private readonly _pointCasters = new PointShadowCastersGPU();
  /** Point faces rendered / skipped by the view test in the last frame (diagnostics, tests). */
  public pointFacesRendered = 0;
  public pointFacesSkipped = 0;

  /**
   * The atlas (4 layers, 16 with point faces; 64 MB at 2048^2 for 4) used to live forever once
   * built. After `SPOT_FBO_IDLE_FRAMES` frames with no shadow-casting spot or point light it is
   * released and the global bind group points back at the dummy map; a light that casts again
   * rebuilds it on demand.
   */
  private _releaseIdleAtlas(renderer: WebGPURenderer, scene: Scene): void {
    if (!this._fbo) return;
    if (++this._idleFrames < SPOT_FBO_IDLE_FRAMES) return;
    renderer.deferDestroyTexture(this._fbo);
    this._fbo = undefined;
    this._spotShadowTexView = undefined;
    this._layerViews = [];
    this._bindGroupNeedsShadowRebuild = true;
    renderer.defaultSpotShadowTextureView = renderer.dummySpotShadowTextureView;
    renderer.globalBindGroup = renderer._createGlobalBindGroup(scene);
  }

  public execute(
    renderer: WebGPURenderer,
    scene: Scene,
    ce: GPUCommandEncoder,
    _targetView: GPUTextureView,
    vp: Float32Array,
    camPos: Vector3D,
  ): void {
    const lights = renderer.extractLights(scene);
    _scratchLightCasters.length = 0;
    for (let i = 0; i < lights.sLights.length; i++) {
      if (lights.sLights[i]!.castShadow) _scratchLightCasters.push(lights.sLights[i]!);
    }
    const casters = _scratchLightCasters;
    const pointCount = this._selectPointLights(renderer, lights.pLights, vp, camPos);
    this.pointFacesRendered = 0;
    this.pointFacesSkipped = 0;
    if (casters.length === 0 && pointCount === 0) {
      this._releaseIdleAtlas(renderer, scene);
      return;
    }
    this._idleFrames = 0;
    this._pointIdleFrames = pointCount > 0 ? 0 : this._pointIdleFrames + 1;

    this._depthMaterial ??= new DepthMaterial();
    renderer.context.shaderRegistry.ensureProvider(MaterialType.DEPTH, this._depthMaterial);

    // Spots keep the first caster's resolution; point faces share the layer size, so the atlas
    // grows to the largest shadowed point light when one asks for more.
    let shadowRes = casters.length > 0 ? casters[0]!.shadowResolution || 1024 : 0;
    for (let k = 0; k < pointCount; k++) {
      const res = lights.pLights[this._pointSlots[k]!]!.shadowResolution;
      shadowRes = Math.max(shadowRes, res || POINT_SHADOW_FALLBACK_RESOLUTION);
    }

    this._lineDepthMaterial ??= new DepthMaterial({ lineQuads: true });
    renderer.context.shaderRegistry.ensureProvider(
      DepthMaterial.LINE_QUADS_SHADER_ID,
      this._lineDepthMaterial,
    );
    // All atlas layers share shadowRes, so one texel is the same NDC size for every spot/face.
    this._lineDepthMaterial.shadowTexelNdc = 2 / shadowRes;

    const dummyFormat = renderer.currentColorTargetFormat;
    let dummy = this._dummyTargets.get(dummyFormat);
    if (!dummy || dummy.resolution !== shadowRes) {
      if (dummy) renderer.deferDestroyTexture(dummy.tex);
      const tex = renderer.gpuDevice!.createTexture({
        size: [shadowRes, shadowRes],
        format: dummyFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      dummy = { tex, view: tex.createView(), resolution: shadowRes };
      this._dummyTargets.set(dummyFormat, dummy);
    }
    const dummyTargetView = dummy.view;

    // The 12 point-face layers (ADR 0052) are only allocated while a point light casts and
    // dropped again after the idle grace period, so spot-only scenes keep the 4-layer atlas.
    const keepFaces =
      this._fbo?.depthOrArrayLayers === SHADOW_ARRAY_LAYERS &&
      this._pointIdleFrames < SPOT_FBO_IDLE_FRAMES;
    const layers = pointCount > 0 || keepFaces ? SHADOW_ARRAY_LAYERS : SPOT_SHADOW_LAYERS;
    if (this._fbo && (this._fbo.width !== shadowRes || this._fbo.depthOrArrayLayers !== layers)) {
      renderer.deferDestroyTexture(this._fbo);
      this._fbo = undefined;
    }
    if (!this._fbo) {
      this._fbo = renderer.gpuDevice!.createTexture({
        size: [shadowRes, shadowRes, layers],
        format: "depth32float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this._spotShadowTexView = this._fbo.createView({ dimension: "2d-array" });
      this._layerViews = [];
      for (let j = 0; j < layers; j++) {
        this._layerViews.push(
          this._fbo.createView({
            dimension: "2d",
            baseArrayLayer: j,
            arrayLayerCount: 1,
          }),
        );
      }
      this._bindGroupNeedsShadowRebuild = true;
    }

    // Temporarily swap back default fallback shadow views so the shadow caster bind group
    // does not reference this._fbo (which would create a WebGPU write/read usage conflict).
    if (
      !this._shadowCasterBindGroup ||
      this._bindGroupNeedsShadowRebuild ||
      this._shadowCasterBindGroupVersion !== renderer.globalResourcesVersion
    ) {
      const realDirShadow = renderer.defaultDirShadowTextureView;
      const realSpotShadow = renderer.defaultSpotShadowTextureView;
      renderer.defaultDirShadowTextureView = renderer.dummyDirShadowTextureView;
      renderer.defaultSpotShadowTextureView = renderer.dummySpotShadowTextureView;
      this._shadowCasterBindGroup = renderer._createGlobalBindGroup(scene);
      this._shadowCasterBindGroupVersion = renderer.globalResourcesVersion;
      renderer.defaultDirShadowTextureView = realDirShadow;
      renderer.defaultSpotShadowTextureView = realSpotShadow;
    }

    const renderList = scene.getVisibleObjectsSorted(vp, camPos);

    // Layers 0..3 belong to spots, matching WebGL2Renderer's spot slots -- only the first 4 spot
    // lights (by scene index, not just shadow-casting ones) get a shadow map, mirroring that
    // renderer's loop bound.
    const maxShadowedSpotLights = Math.min(lights.sLights.length, SPOT_SHADOW_LAYERS);

    for (let j = 0; j < maxShadowedSpotLights; j++) {
      const sLight = lights.sLights[j]!;
      if (!sLight.castShadow) continue;

      // Also creates the shadow camera when castShadow was switched on after construction.
      sLight.updateShadowCamera();
      const shadowCam = sLight.shadowCamera;
      if (!shadowCam) continue;

      const tempMat = MathPool.acquireMatrix();
      tempMat.data.set(shadowCam.viewProjectionMatrix);
      this._frustum.setFromMatrix(tempMat);
      MathPool.releaseMatrix(tempMat);

      // This light's view-projection lives in its own dynamic-offset slot (group 3) -- see
      // VIEW_SLOT_SPOT_SHADOW_BASE -- instead of temporarily clobbering the shared
      // GlobalUniforms.vp and needing a separate command encoder/submit per light. Depth.frag.wgsl
      // reads nothing from `global` at all, so there's nothing else this pass needs to swap in.
      const viewOffset = renderer._setViewMatrix(
        VIEW_SLOT_SPOT_SHADOW_BASE + j,
        shadowCam.viewProjectionMatrix,
      );

      const rp = ce.beginRenderPass({
        colorAttachments: [
          {
            view: dummyTargetView,
            loadOp: "clear",
            storeOp: "store",
          },
        ],
        depthStencilAttachment: {
          view: this._layerViews[j]!,
          depthClearValue: 1.0,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });

      rp.setBindGroup(0, this._shadowCasterBindGroup!);
      this._drawCasters(renderer, rp, renderList.opaqueBatches, viewOffset, shadowCam.viewMatrix);
      rp.end();
    }

    if (pointCount > 0) {
      this._renderPointFaces(renderer, scene, ce, lights.pLights, pointCount, vp, dummyTargetView);
    }

    // GlobalUniforms was never touched by the loop above (only the dedicated view-slot buffer
    // was), so it still holds this frame's real camera data from the one _updateGlobalBuffers()
    // call at the top of render() -- no restore needed. Only overlay the shadow-sampling data
    // MainRenderPass actually needs (spot shadow matrices/bias/info).
    const gData = renderer.scratchGlobalBufferData;
    const glob = WebGPUGGlobalUniformLayout.fields;
    const rawVp = MathPool.acquireMatrix();
    const correctedVp = MathPool.acquireMatrix();

    for (let j = 0; j < maxShadowedSpotLights; j++) {
      const sLight = lights.sLights[j]!;
      if (sLight.castShadow && sLight.shadowCamera) {
        gData[glob.spotShadowInfo.index + j * glob.spotShadowInfo.stride] = sLight.shadowBias;
        gData[glob.spotShadowInfo.index + j * glob.spotShadowInfo.stride + 1] =
          sLight.shadowNormalBias;
        gData[glob.spotShadowInfo.index + j * glob.spotShadowInfo.stride + 2] = 1.0;
        gData[glob.spotShadowInfo.index + j * glob.spotShadowInfo.stride + 3] = j;

        rawVp.data.set(sLight.shadowCamera.viewProjectionMatrix);
        Matrix4.multiply(Matrix4.ZO_CORRECTION, rawVp, correctedVp);
        gData.set(
          correctedVp.data,
          glob.spotShadowMatrices.index + j * glob.spotShadowMatrices.stride,
        );
      }
    }

    for (let k = 0; k < pointCount; k++) {
      const pLight = lights.pLights[this._pointSlots[k]!]!;
      const info = glob.pointShadowInfo.index + k * glob.pointShadowInfo.stride;
      gData[info] = pLight.shadowBias;
      gData[info + 1] = pLight.shadowNormalBias;
      gData[info + 2] = this._pointSlots[k]!;
      gData[info + 3] = 1.0;
      for (let face = 0; face < CUBE_FACE_COUNT; face++) {
        const m = k * CUBE_FACE_COUNT + face;
        copyMatrix(this._faceMatrices, m * 16, rawVp.data);
        Matrix4.multiply(Matrix4.ZO_CORRECTION, rawVp, correctedVp);
        gData.set(
          correctedVp.data,
          glob.pointShadowMatrices.index + m * glob.pointShadowMatrices.stride,
        );
      }
    }

    MathPool.releaseMatrix(rawVp);
    MathPool.releaseMatrix(correctedVp);

    // Only spotShadowMatrices/spotShadowInfo (the wedge from spotShadowMatrices.index through
    // spotShadowInfo.index + spotShadowInfo.floats, see GlobalUniforms in structs.wgsl) were
    // touched above -- upload just that slice instead of the whole 848-byte buffer. Re-uploading
    // the untouched vp/lights/fog fields here too would be pure waste, and is one of up to 3
    // full-buffer writes of the same buffer per frame otherwise (this pass, CascadedShadowPassGPU,
    // and _updateGlobalBuffers()'s own once-per-frame write).
    renderer.gpuDevice!.queue.writeBuffer(
      renderer.globalUniformBuffer,
      glob.spotShadowMatrices.index * 4,
      gData,
      glob.spotShadowMatrices.index,
      glob.spotShadowInfo.index + glob.spotShadowInfo.floats - glob.spotShadowMatrices.index,
    );

    if (pointCount > 0) {
      // Slots >= pointCount keep the writer's per-frame defaults (castShadow 0, index -1).
      const first = glob.pointShadowMatrices.index;
      renderer.gpuDevice!.queue.writeBuffer(
        renderer.globalUniformBuffer,
        first * 4,
        gData,
        first,
        glob.pointShadowInfo.index + glob.pointShadowInfo.floats - first,
      );
    }

    if (this._bindGroupNeedsShadowRebuild) {
      renderer.defaultSpotShadowTextureView = this._spotShadowTexView!;
      renderer.globalBindGroup = renderer._createGlobalBindGroup(scene);
      this._bindGroupNeedsShadowRebuild = false;
    }
  }

  /** Fills `_pointSlots` with this frame's shadowed point lights; returns how many. */
  private _selectPointLights(
    renderer: WebGPURenderer,
    pLights: readonly PointLight[],
    vp: Float32Array,
    camPos: Vector3D,
  ): number {
    const max = Math.min(
      renderer.quality.maxShadowedPointLights ?? MAX_SHADOWED_POINT_LIGHTS,
      MAX_SHADOWED_POINT_LIGHTS,
    );
    if (max <= 0 || pLights.length === 0) return 0;
    // Row 2 of a GL view-projection is a positive multiple of the camera forward axis for
    // perspective and orthographic projections alike.
    _cameraForward.set(vp[2]!, vp[6]!, vp[10]!).normalize();
    return selectShadowedPointLights(pLights, camPos, _cameraForward, max, this._pointSlots);
  }

  /**
   * Renders the six cube faces of every chosen point light into layers `pointShadowLayer(slot,
   * face)`, following the light's current position (no caching: fire jitter must move shadows).
   * Faces whose range-limited pyramid misses the camera frustum are skipped.
   */
  private _renderPointFaces(
    renderer: WebGPURenderer,
    scene: Scene,
    ce: GPUCommandEncoder,
    pLights: readonly PointLight[],
    pointCount: number,
    vp: Float32Array,
    dummyTargetView: GPUTextureView,
  ): void {
    const casters = this._pointCasters;
    casters.reset();
    for (let k = 0; k < pointCount; k++) {
      const light = pLights[this._pointSlots[k]!]!;
      const d = light.worldMatrix.data;
      casters.addRange(d[12]!, d[13]!, d[14]!, pointShadowFar(light));
    }
    casters.collect(scene.root);

    const mat = MathPool.acquireMatrix();
    mat.data.set(vp);
    this._cameraFrustum.setFromMatrix(mat);

    for (let k = 0; k < pointCount; k++) {
      const light = pLights[this._pointSlots[k]!]!;
      const d = light.worldMatrix.data;
      _lightPos.set(d[12]!, d[13]!, d[14]!);
      const far = pointShadowFar(light);
      writePointShadowFaceMatrices(_lightPos, far, this._faceMatrices, k * CUBE_FACE_COUNT * 16);
      // The normal offset can push a receiver sample slightly outside the view.
      const margin = light.shadowNormalBias + POINT_SHADOW_NEAR;

      for (let face = 0; face < CUBE_FACE_COUNT; face++) {
        if (!pointShadowFaceReachesView(this._cameraFrustum.planes, _lightPos, far, face, margin)) {
          this.pointFacesSkipped++;
          continue;
        }
        this.pointFacesRendered++;
        const m = k * CUBE_FACE_COUNT + face;
        copyMatrix(this._faceMatrices, m * 16, mat.data);
        this._frustum.setFromMatrix(mat);
        const viewOffset = renderer._setViewMatrix(VIEW_SLOT_POINT_SHADOW_BASE + m, mat.data);

        const rp = ce.beginRenderPass({
          colorAttachments: [
            {
              view: dummyTargetView,
              loadOp: "clear",
              storeOp: "store",
            },
          ],
          depthStencilAttachment: {
            view: this._layerViews[pointShadowLayer(k, face)]!,
            depthClearValue: 1.0,
            depthLoadOp: "clear",
            depthStoreOp: "store",
          },
        });
        rp.setBindGroup(0, this._shadowCasterBindGroup!);
        // No view matrix: only sprite billboards read it, and they never cast into the cube.
        this._drawCasters(renderer, rp, casters.batches, viewOffset, undefined);
        rp.end();
      }
    }
    MathPool.releaseMatrix(mat);
  }

  /** Draws the shadow casters of `batches` that touch `this._frustum` with the depth material. */
  private _drawCasters(
    renderer: WebGPURenderer,
    rp: GPURenderPassEncoder,
    batches: readonly RenderBatch[],
    viewOffset: number,
    viewMatrix: Float32Array | undefined,
  ): void {
    const depthMaterial = this._depthMaterial!;
    const depthManifest = depthMaterial.getRenderManifest();
    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx]!;
      if (batch.shaderId === MaterialType.SKYBOX || batch.objects.length === 0) continue;
      const objects = batch.objects;
      let topologyStr: GPUPrimitiveTopology = Topology.DEFAULT;
      if (batch.topology === Topology.POINT_LIST) topologyStr = Topology.POINT_LIST;
      else if (batch.topology === Topology.LINE_LIST) topologyStr = Topology.LINE_LIST;
      else if (batch.topology === Topology.LINE_STRIP) topologyStr = Topology.LINE_STRIP;
      else if (typeof batch.topology === "string")
        topologyStr = batch.topology as GPUPrimitiveTopology;
      let topology: GPUPrimitiveTopology = topologyStr;

      let material: DepthMaterial = depthMaterial;
      let manifest = depthManifest;
      if (usesLineQuadShadow(batch)) {
        material = this._lineDepthMaterial!;
        material.lineHalfWidth = batch.shadowWidth! * 0.5;
        manifest = material.getRenderManifest();
        topology = Topology.TRIANGLE_LIST;
      }

      _scratchCasters.length = 0;
      _scratchInstanced.length = 0;
      _scratchStandard.length = 0;

      for (let i = 0; i < objects.length; i++) {
        const o = objects[i]!;
        if (o.castShadow && (!o.bounds || this._frustum.intersectsVolume(o.bounds))) {
          _scratchCasters.push(o);
          if (o instanceof InstancedMesh) {
            _scratchInstanced.push(o);
          } else {
            _scratchStandard.push(o);
          }
        }
      }

      if (_scratchCasters.length === 0) continue;

      if (_scratchStandard.length > 0) {
        renderer._renderSubgroup(
          rp,
          _scratchStandard,
          false,
          material.uuid,
          manifest,
          viewOffset,
          viewMatrix,
          topology,
          batch.wireframeMode,
        );
      }

      if (_scratchInstanced.length > 0) {
        renderer._renderSubgroup(
          rp,
          _scratchInstanced,
          true,
          material.uuid,
          manifest,
          viewOffset,
          viewMatrix,
          topology,
          batch.wireframeMode,
        );
      }
    }
  }
}

/** Reach of a point light's cube faces; matches the far plane `writePointShadowFaceMatrices` uses. */
function pointShadowFar(light: PointLight): number {
  return Math.max(light.distance, POINT_SHADOW_NEAR * 2);
}

/** Copies 16 floats from `src` at `offset` into `dst` without creating a subarray view. */
function copyMatrix(src: Float32Array, offset: number, dst: Float32Array): void {
  for (let i = 0; i < 16; i++) dst[i] = src[offset + i]!;
}
