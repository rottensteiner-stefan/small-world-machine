import type { Scene } from "../../core/index.js";
import { DepthMaterial } from "../../core/materials/index.js";
import { MaterialType } from "../../enums/MaterialType.js";
import { Topology } from "../../enums/Topology.js";
import type { WebGPURenderer } from "../WebGPU/WebGPURenderer.js";
import { VIEW_SLOT_SPOT_SHADOW_BASE } from "../WebGPU/WebGPURenderer.js";
import type { RenderPass } from "../index.js";
import { InstancedMesh } from "../../core/InstancedMesh.js";
import type { Object3D } from "../../core/Object3D.js";
import type { SpotLight } from "../../core/lights/SpotLight.js";
import type { Vector3D } from "../../math/index.js";
import { Matrix4, MathPool, Frustum } from "../../math/index.js";
import { WebGPUGGlobalUniformLayout } from "../GlobalUniformLayout.js";

const _scratchLightCasters: SpotLight[] = [];
const _scratchCasters: Object3D[] = [];
const _scratchInstanced: InstancedMesh[] = [];
const _scratchStandard: Object3D[] = [];

/** Frames without a shadow-casting spot light before the shadow atlas is freed. */
const SPOT_FBO_IDLE_FRAMES = 120;

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
  private _shadowCasterBindGroup?: GPUBindGroup;
  private _spotShadowTexView?: GPUTextureView | undefined;
  private _fbo?: GPUTexture | undefined;
  private _layerViews: GPUTextureView[] = [];
  private _frustum: Frustum = new Frustum();

  /**
   * The 4-layer atlas (64 MB at 2048^2) used to live forever once built. After
   * `SPOT_FBO_IDLE_FRAMES` frames with no shadow-casting spot light it is released and the global
   * bind group points back at the dummy map; a light that casts again rebuilds it on demand.
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
    if (casters.length === 0) {
      this._releaseIdleAtlas(renderer, scene);
      return;
    }
    this._idleFrames = 0;

    this._depthMaterial ??= new DepthMaterial();
    renderer.context.shaderRegistry.ensureProvider(MaterialType.DEPTH, this._depthMaterial);

    const shadowRes = casters[0]?.shadowResolution || 1024;

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

    // The atlas follows the first caster's resolution; a changed resolution used to be ignored.
    if (this._fbo && this._fbo.width !== shadowRes) {
      renderer.deferDestroyTexture(this._fbo);
      this._fbo = undefined;
    }
    if (!this._fbo) {
      // Always create 4 layers because maximum spotlights is 4.
      this._fbo = renderer.gpuDevice!.createTexture({
        size: [shadowRes, shadowRes, 4],
        format: "depth32float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this._spotShadowTexView = this._fbo.createView({ dimension: "2d-array" });
      this._layerViews = [];
      for (let j = 0; j < 4; j++) {
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
    const depthManifest = this._depthMaterial.getRenderManifest();

    // The shadow atlas texture is fixed at 4 array layers (see comment above), matching
    // WebGL2Renderer's `u_spotShadowMap[4]` cap -- only the first 4 spot lights (by scene index,
    // not just shadow-casting ones) get a shadow map, mirroring that renderer's loop bound.
    const maxShadowedSpotLights = Math.min(lights.sLights.length, 4);

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

      for (let batchIdx = 0; batchIdx < renderList.opaqueBatches.length; batchIdx++) {
        const batch = renderList.opaqueBatches[batchIdx];
        if (batch!.shaderId === MaterialType.SKYBOX || batch!.objects.length === 0) continue;
        const objects = batch!.objects;
        let topologyStr: GPUPrimitiveTopology = Topology.DEFAULT;
        if (batch!.topology === Topology.POINT_LIST) topologyStr = Topology.POINT_LIST;
        else if (batch!.topology === Topology.LINE_LIST) topologyStr = Topology.LINE_LIST;
        else if (batch!.topology === Topology.LINE_STRIP) topologyStr = Topology.LINE_STRIP;
        else if (typeof batch!.topology === "string")
          topologyStr = batch!.topology as GPUPrimitiveTopology;
        const topology: GPUPrimitiveTopology = topologyStr;

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
            this._depthMaterial.uuid,
            depthManifest,
            viewOffset,
            shadowCam.viewMatrix,
            topology,
          );
        }

        if (_scratchInstanced.length > 0) {
          renderer._renderSubgroup(
            rp,
            _scratchInstanced,
            true,
            this._depthMaterial.uuid,
            depthManifest,
            viewOffset,
            shadowCam.viewMatrix,
            topology,
          );
        }
      }

      rp.end();
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

    if (this._bindGroupNeedsShadowRebuild) {
      renderer.defaultSpotShadowTextureView = this._spotShadowTexView!;
      renderer.globalBindGroup = renderer._createGlobalBindGroup(scene);
      this._bindGroupNeedsShadowRebuild = false;
    }
  }
}
