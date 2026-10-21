import type { Scene } from "../../core/index.js";
import { DepthMaterial } from "../../core/materials/index.js";
import { MaterialType, Topology } from "../../enums/index.js";
import type { WebGPURenderer } from "../WebGPU/WebGPURenderer.js";
import { VIEW_SLOT_CASCADE_BASE } from "../WebGPU/WebGPURenderer.js";
import type { RenderPass } from "../index.js";
import { DirectionalLight } from "../../core/lights/DirectionalLight.js";
import { InstancedMesh } from "../../core/InstancedMesh.js";
import type { Object3D } from "../../core/Object3D.js";
import type { Vector3D } from "../../math/index.js";
import { Matrix4, MathPool, Frustum } from "../../math/index.js";
import { WebGPUGGlobalUniformLayout } from "../GlobalUniformLayout.js";

const _scratchCasters: Object3D[] = [];
const _scratchInstanced: InstancedMesh[] = [];
const _scratchStandard: Object3D[] = [];

export class CascadedShadowPassGPU implements RenderPass {
  public name = "CascadedShadowPassGPU";

  /**
   * Keyed by format rather than a single cached view: this pass renders both during the main
   * scene pass (format = `renderer.currentColorTargetFormat` while no custom RenderTarget is
   * active) and again during e.g. a `PlanarReflectionNode`'s reflection sub-render (a custom
   * RenderTarget IS active there), and those two contexts can legitimately need different dummy
   * formats within the same frame. A single cached view -- fixed at whichever format happened to
   * be current the first time this pass ever ran -- silently mismatched the depth material's
   * pipeline (built fresh per call from the SAME `currentColorTargetFormat`) in whichever context
   * didn't match that first one, which WebGPU rejects as an attachment-state mismatch.
   */
  private _dummyTargets = new Map<
    GPUTextureFormat,
    { tex: GPUTexture; view: GPUTextureView; resolution: number }
  >();
  private _dirShadowTexView?: GPUTextureView;
  private _cascadeLayerViews: GPUTextureView[] = [];
  private _cachedFbo?: GPUTexture | undefined;
  private _bindGroupNeedsShadowRebuild = true;
  private _shadowCasterBindGroupVersion = -1;
  private _depthMaterial?: DepthMaterial;
  /**
   * A snapshot of the global bind group taken BEFORE it ever gets rebuilt to
   * reference the real shadow map (see below). Used only while rendering shadow
   * casters: it still references the dummy fallback shadow textures, so binding
   * it doesn't create a read/write conflict on the shadow map texture we're
   * actively rendering into within the same render pass.
   */
  private _shadowCasterBindGroup?: GPUBindGroup;
  private _frustum: Frustum = new Frustum();

  /**
   * Frees the shadow map of every light that is no longer the scene's directional light
   * (removed or replaced) and points the global bind group back at the dummy map, so nothing
   * bound still references the destroyed texture.
   */
  private _releaseStaleShadowMaps(
    renderer: WebGPURenderer,
    scene: Scene,
    current: DirectionalLight | undefined,
  ): void {
    let released = false;
    for (const [light, tex] of renderer.shadowMaps) {
      if (light === current || !(light instanceof DirectionalLight)) continue;
      renderer.deferDestroyTexture(tex);
      renderer.shadowMaps.delete(light);
      released = true;
    }
    if (!released) return;
    this._cachedFbo = undefined;
    this._cascadeLayerViews = [];
    this._bindGroupNeedsShadowRebuild = true;
    renderer.defaultDirShadowTextureView = renderer.dummyDirShadowTextureView;
    renderer.globalBindGroup = renderer._createGlobalBindGroup(scene);
  }

  public execute(
    renderer: WebGPURenderer,
    scene: Scene,
    ce: GPUCommandEncoder,
    _targetView: GPUTextureView,
    vp: Float32Array,
    camPos: Vector3D,
    _vMat?: Float32Array,
  ): void {
    const lights = renderer.extractLights(scene);
    const dLight = lights.dLight;
    this._releaseStaleShadowMaps(renderer, scene, dLight);
    // `numCascades` is a public field but `cascadeCameras` is built once by the light's
    // constructor: raising it later would index missing cameras, so the usable count is clamped.
    const numCascades = dLight ? Math.min(dLight.numCascades, dLight.cascadeCameras.length) : 0;
    if (!dLight || !dLight.castShadow || numCascades === 0) return;

    this._depthMaterial ??= new DepthMaterial();
    renderer.context.shaderRegistry.ensureProvider(MaterialType.DEPTH, this._depthMaterial);

    // The dummy color attachment must match the depth attachment's size, so it follows the
    // shadow resolution (a resolution change used to leave the first frame's size in place).
    const dummyFormat = renderer.currentColorTargetFormat;
    let dummy = this._dummyTargets.get(dummyFormat);
    if (!dummy || dummy.resolution !== dLight.shadowResolution) {
      if (dummy) renderer.deferDestroyTexture(dummy.tex);
      const tex = renderer.gpuDevice!.createTexture({
        size: [dLight.shadowResolution, dLight.shadowResolution],
        format: dummyFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      dummy = { tex, view: tex.createView(), resolution: dLight.shadowResolution };
      this._dummyTargets.set(dummyFormat, dummy);
    }
    const dummyTargetView = dummy.view;

    let fbo = renderer.shadowMaps.get(dLight) as GPUTexture | undefined;
    // Resolution / cascade count are live properties of the light: a map built for other values
    // would be sampled with the wrong layout (or fail `createView` on a missing array layer).
    if (fbo && (fbo.width !== dLight.shadowResolution || fbo.depthOrArrayLayers !== numCascades)) {
      renderer.deferDestroyTexture(fbo);
      renderer.shadowMaps.delete(dLight);
      fbo = undefined;
    }
    if (!fbo) {
      fbo = renderer.gpuDevice!.createTexture({
        size: [dLight.shadowResolution, dLight.shadowResolution, numCascades],
        format: "depth32float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      renderer.shadowMaps.set(dLight, fbo);
      this._dirShadowTexView = fbo.createView({ dimension: "2d-array" });
      this._bindGroupNeedsShadowRebuild = true;
    }

    if (this._cachedFbo !== fbo || this._cascadeLayerViews.length !== numCascades) {
      this._cachedFbo = fbo;
      this._cascadeLayerViews = [];
      for (let i = 0; i < numCascades; i++) {
        this._cascadeLayerViews.push(
          fbo.createView({
            dimension: "2d",
            baseArrayLayer: i,
            arrayLayerCount: 1,
          }),
        );
      }
    }

    // Temporarily swap back default fallback shadow views so the shadow caster bind group
    // does not reference fbo (which would create a WebGPU write/read usage conflict).
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

    for (let i = 0; i < numCascades; i++) {
      const cascadeCam = dLight.cascadeCameras[i]!;

      // Per-cascade frustum, mirroring SpotShadowPassGPU's approach: without this, every
      // cascade would draw every shadow-casting object from the (much larger) main-camera
      // renderList, including ones nowhere near this cascade's much tighter light-space volume.
      const tempMat = MathPool.acquireMatrix();
      tempMat.data.set(cascadeCam.viewProjectionMatrix);
      this._frustum.setFromMatrix(tempMat);
      MathPool.releaseMatrix(tempMat);

      // This cascade's view-projection lives in its own dynamic-offset slot (group 3) --
      // see VIEW_SLOT_CASCADE_BASE -- instead of temporarily clobbering the shared
      // GlobalUniforms.vp and needing a separate command encoder/submit per cascade to make
      // that clobber visible before the next one overwrites it. Depth.frag.wgsl reads nothing
      // from `global` at all, so there's nothing else this cascade needs to swap in.
      const viewOffset = renderer._setViewMatrix(
        VIEW_SLOT_CASCADE_BASE + i,
        cascadeCam.viewProjectionMatrix,
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
          view: this._cascadeLayerViews[i]!,
          depthClearValue: 1.0,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });

      // _renderSubgroup only sets bind groups 1 (material) and 2 (object); unlike
      // _renderGroup, it does not set the global bind group 0 -- do that ourselves
      // once per cascade pass. Use the dummy-referencing snapshot, NOT
      // renderer.globalBindGroup: once rebuilt (below), that one references the
      // real shadow map we're actively rendering into here.
      rp.setBindGroup(0, this._shadowCasterBindGroup!);

      // Render all shadow-casting opaque objects into this cascade using a single,
      // shared DepthMaterial pipeline -- regardless of each object's own material --
      // mirroring WebGL2's "bind one depth program, source only the model matrix per
      // object" approach (WebGL2Renderer._renderShadowScene).
      for (let batchIdx = 0; batchIdx < renderList.opaqueBatches.length; batchIdx++) {
        const batch = renderList.opaqueBatches[batchIdx];
        if (batch!.shaderId === MaterialType.SKYBOX || batch!.objects.length === 0) continue;

        let topology: GPUPrimitiveTopology = Topology.DEFAULT;
        if (batch!.topology === Topology.POINT_LIST) topology = Topology.POINT_LIST;
        else if (batch!.topology === Topology.LINE_LIST) topology = Topology.LINE_LIST;
        else if (batch!.topology === Topology.LINE_STRIP) topology = Topology.LINE_STRIP;

        const objects = batch!.objects;

        _scratchCasters.length = 0;
        for (let i = 0; i < objects.length; i++) {
          const o = objects[i]!;
          if (o.castShadow && (!o.bounds || this._frustum.intersectsVolume(o.bounds))) {
            _scratchCasters.push(o);
          }
        }
        if (_scratchCasters.length === 0) continue;

        _scratchInstanced.length = 0;
        _scratchStandard.length = 0;
        for (let i = 0; i < _scratchCasters.length; i++) {
          const obj = _scratchCasters[i]!;
          if (obj instanceof InstancedMesh) {
            _scratchInstanced.push(obj);
          } else {
            _scratchStandard.push(obj);
          }
        }

        if (_scratchStandard.length > 0) {
          renderer._renderSubgroup(
            rp,
            _scratchStandard,
            false,
            this._depthMaterial.uuid,
            depthManifest,
            viewOffset,
            cascadeCam.viewMatrix,
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
            cascadeCam.viewMatrix,
            topology,
          );
        }
      }

      rp.end();
    }

    // GlobalUniforms was never touched by the loop above (only the dedicated view-slot buffer
    // was), so it still holds this frame's real camera data from the one _updateGlobalBuffers()
    // call at the top of render() -- no restore needed. Only overlay the shadow-sampling data
    // MainRenderPass actually needs (cascade matrices/splits/dirShadowInfo).
    const gData = renderer.scratchGlobalBufferData;
    const glob = WebGPUGGlobalUniformLayout.fields;
    const dirInfo = glob.dirShadowInfo;
    gData[dirInfo.index] = dLight.shadowBias;
    gData[dirInfo.index + 1] = dLight.shadowNormalBias;
    gData[dirInfo.index + 2] = 1.0; // castShadow on
    gData[dirInfo.index + 3] = numCascades;

    const rawCascadeVp = MathPool.acquireMatrix();
    const correctedCascadeVp = MathPool.acquireMatrix();
    for (let i = 0; i < numCascades; i++) {
      const cascadeCam = dLight.cascadeCameras[i]!;
      gData[glob.cascadeSplits.index + i] = dLight.cascadeSplits[i]!;

      // WebGPU's [0, 1] depth range needs the same ZO correction _updateGlobalBuffers
      // applies to the main camera VP -- getShadowPCF reprojects using this matrix,
      // so it must match how the shadow map's depth values were actually written.
      rawCascadeVp.data.set(cascadeCam.viewProjectionMatrix);
      Matrix4.multiply(Matrix4.ZO_CORRECTION, rawCascadeVp, correctedCascadeVp);
      gData.set(
        correctedCascadeVp.data,
        glob.cascadeMatrices.index + i * glob.cascadeMatrices.stride,
      );
    }
    MathPool.releaseMatrix(rawCascadeVp);
    MathPool.releaseMatrix(correctedCascadeVp);

    // Only cascadeMatrices/cascadeSplits/dirShadowInfo (the wedge from cascadeMatrices.index
    // through dirShadowInfo.index + dirShadowInfo.floats, see GlobalUniforms in structs.wgsl)
    // were touched above -- upload just that slice instead of the whole 848-byte buffer.
    // Re-uploading the untouched vp/lights/fog fields here too would be pure waste, and is one of
    // up to 3 full-buffer writes of the same buffer per frame otherwise (this pass,
    // SpotShadowPassGPU, and _updateGlobalBuffers()'s own once-per-frame write).
    renderer.gpuDevice!.queue.writeBuffer(
      renderer.globalUniformBuffer,
      glob.cascadeMatrices.index * 4,
      gData,
      glob.cascadeMatrices.index,
      dirInfo.index + dirInfo.floats - glob.cascadeMatrices.index,
    );

    // Bind the resulting texture array to the WebGPU Renderer's global bind group,
    // exactly once (the underlying GPUTexture is reused and just re-rendered into
    // on subsequent frames, so the bind group doesn't need to be rebuilt again).
    if (this._bindGroupNeedsShadowRebuild) {
      renderer.defaultDirShadowTextureView = this._dirShadowTexView!;
      renderer.globalBindGroup = renderer._createGlobalBindGroup(scene);
      this._bindGroupNeedsShadowRebuild = false;
    }
  }
}
