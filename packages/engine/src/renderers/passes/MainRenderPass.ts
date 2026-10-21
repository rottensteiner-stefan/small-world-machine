import type { Scene } from "../../core/index.js";
import type { RenderBatch } from "../../core/Scene.js";
import { MaterialType, Topology, NormalTargetMode } from "../../enums/index.js";
import { NORMAL_TARGET_CLEAR } from "../WebGPU/managers/NormalOutputWrapper.js";
import type { WebGPURenderer } from "../WebGPU/index.js";
import type { RenderPass } from "../index.js";
import type { Vector3D } from "../../math/index.js";
import type { Object3D } from "../../core/Object3D.js";
/**
 * Standard render pass for opaque and skybox objects.
 */
export class MainRenderPass implements RenderPass {
  public name = "MainRenderPass";

  // Reused across every transparent object in a frame instead of allocating a fresh batch (and
  // its single-element `objects` array) per object -- `_renderBatch` only reads this
  // synchronously within the call below, so overwriting it in place between calls is safe.
  private readonly _scratchTransparentObjects: Object3D[] = [];
  private readonly _scratchTransparentBatch: RenderBatch = {
    shaderId: "",
    topology: Topology.DEFAULT,
    matUuid: "",
    objects: this._scratchTransparentObjects,
  };

  // Same reuse as the transparent batch above: one single-object batch per decal.
  private readonly _scratchDecalObjects: Object3D[] = [];
  private readonly _scratchDecalBatch: RenderBatch = {
    shaderId: "",
    topology: Topology.DEFAULT,
    matUuid: "",
    objects: this._scratchDecalObjects,
  };

  // Render-pass descriptors are consumed synchronously by `beginRenderPass()`, so one set is
  // reused every frame instead of allocating attachment arrays + descriptors per pass.
  private readonly _clearColor: GPURenderPassColorAttachment = {
    view: undefined as unknown as GPUTextureView,
    loadOp: "clear",
    storeOp: "store",
  };
  private readonly _clearNormal: GPURenderPassColorAttachment = {
    view: undefined as unknown as GPUTextureView,
    clearValue: NORMAL_TARGET_CLEAR,
    loadOp: "clear",
    storeOp: "store",
  };
  private readonly _loadColor: GPURenderPassColorAttachment = {
    view: undefined as unknown as GPUTextureView,
    loadOp: "load",
    storeOp: "store",
  };
  private readonly _loadNormal: GPURenderPassColorAttachment = {
    view: undefined as unknown as GPUTextureView,
    loadOp: "load",
    storeOp: "store",
  };
  private readonly _clearAttachments: GPURenderPassColorAttachment[] = [];
  private readonly _loadAttachments: GPURenderPassColorAttachment[] = [];
  private readonly _depthAttachment: GPURenderPassDepthStencilAttachment = {
    view: undefined as unknown as GPUTextureView,
    depthLoadOp: "load",
    depthStoreOp: "store",
  };
  private readonly _clearDescriptor: GPURenderPassDescriptor = {
    colorAttachments: this._clearAttachments,
    depthStencilAttachment: this._depthAttachment,
  };
  private readonly _loadDescriptor: GPURenderPassDescriptor = {
    colorAttachments: this._loadAttachments,
    depthStencilAttachment: this._depthAttachment,
  };

  /** Begins a pass over the reused attachment set; `clear` selects the clearing variant. */
  private _beginPass(
    ce: GPUCommandEncoder,
    renderer: WebGPURenderer,
    targetView: GPUTextureView,
    normalView: GPUTextureView | undefined,
    clear: boolean,
  ): GPURenderPassEncoder {
    const attachments = clear ? this._clearAttachments : this._loadAttachments;
    const color = clear ? this._clearColor : this._loadColor;
    const normal = clear ? this._clearNormal : this._loadNormal;
    color.view = targetView;
    if (clear) color.clearValue = renderer.clearColor;
    attachments.length = 0;
    attachments.push(color);
    if (normalView) {
      normal.view = normalView;
      attachments.push(normal);
    }
    this._depthAttachment.view = renderer.activeDepthView;
    return ce.beginRenderPass(clear ? this._clearDescriptor : this._loadDescriptor);
  }

  public execute(
    renderer: WebGPURenderer,
    scene: Scene,
    ce: GPUCommandEncoder,
    targetView: GPUTextureView,
    vp: Float32Array,
    camPos: Vector3D,
    vMat?: Float32Array,
  ): void {
    const renderList = scene.getVisibleObjectsSorted(vp, camPos);

    const normalView = renderer.activeNormalView;
    const opaqueMode = normalView ? NormalTargetMode.WRITE : NormalTargetMode.NONE;
    const maskedMode = normalView ? NormalTargetMode.MASKED : NormalTargetMode.NONE;

    // DepthPrePassGPU already cleared and populated this depth buffer with the frontmost depth
    // for every opaque object this frame -- "load" instead of "clear" builds on top of that,
    // which is what lets depthCompare:"less-equal" reject occluded fragments via early-Z.
    const rp = this._beginPass(ce, renderer, targetView, normalView, true);

    // 1. Skybox first
    for (let i = 0; i < renderList.opaqueBatches.length; i++) {
      const batch = renderList.opaqueBatches[i];
      if (batch!.shaderId === MaterialType.SKYBOX && batch!.objects.length > 0) {
        renderer._renderBatch(rp, batch!, vMat, maskedMode);
      }
    }

    // 2. All other opaque objects
    for (let i = 0; i < renderList.opaqueBatches.length; i++) {
      const batch = renderList.opaqueBatches[i];
      if (batch!.shaderId !== MaterialType.SKYBOX && batch!.objects.length > 0) {
        renderer._renderBatch(rp, batch!, vMat, opaqueMode);
      }
    }

    // Decals read the finished opaque depth/normals, so they get their own pass right after the
    // opaque one (and before the transparents, which then see them in their refraction capture).
    const drawDecals = renderList.decals.length > 0 && renderer.canDrawDecals;
    let opaquePassEnded = false;
    let depthCaptured = false;
    if (drawDecals) {
      rp.end();
      opaquePassEnded = true;
      renderer.captureOpaqueDepth(ce);
      depthCaptured = true;
      if (normalView) renderer.captureOpaqueNormal(ce);

      const rpDecal = this._beginPass(ce, renderer, targetView, normalView, false);
      const decalMode = normalView ? NormalTargetMode.BLEND : NormalTargetMode.NONE;
      for (const decal of renderList.decals) {
        this._scratchDecalObjects[0] = decal;
        this._scratchDecalBatch.shaderId = decal.material!.getRenderManifest().shaderId;
        this._scratchDecalBatch.matUuid = decal.material!.uuid;
        renderer._renderBatch(rpDecal, this._scratchDecalBatch, vMat, decalMode);
      }
      rpDecal.end();
    }

    if (renderList.transparent.length > 0) {
      if (!opaquePassEnded) rp.end();

      // Capture opaque texture for transparent materials (like glass)
      const targetTex = renderer.activeColorTexture;
      renderer.captureOpaqueTexture(ce, targetTex);
      if (!depthCaptured) renderer.captureOpaqueDepth(ce);

      // Start transparent pass
      const rpTransparent = this._beginPass(ce, renderer, targetView, normalView, false);

      // 3. Transparent objects
      for (const obj of renderList.transparent) {
        const manifest = obj.material!.getRenderManifest();

        // AbstractGeometry always sets .topology explicitly, so this only matters for
        // hand-built GeometryData that skips it -- default to triangles rather than
        // guessing from index count (a 2-index geometry isn't reliably a line).
        const topology = manifest.state?.topology || obj.geometry?.topology || Topology.DEFAULT;

        this._scratchTransparentBatch.shaderId = manifest.shaderId;
        this._scratchTransparentBatch.topology = topology as Topology;
        this._scratchTransparentBatch.matUuid = obj.material!.uuid;
        this._scratchTransparentObjects[0] = obj;

        renderer._renderBatch(rpTransparent, this._scratchTransparentBatch, vMat, maskedMode);
      }
      rpTransparent.end();
    } else {
      if (!opaquePassEnded) rp.end();

      // HBAO, light shafts and volumetric fog need the opaque depth buffer every frame they're
      // enabled -- the single `postProcessing.requiresOpaqueDepth` property is the renderer's only
      // source of truth for depth-consuming effects (no per-effect OR-chains, see ADR 0037).
      // The post chain only runs for the main camera target (PostProcessPass is skipped for
      // offscreen renders), so an offscreen render (reflection, probe) never needs the copy.
      if (
        !renderer.activeRenderTarget &&
        renderer.postProcessing.enabled &&
        renderer.postProcessing.requiresOpaqueDepth &&
        !depthCaptured
      ) {
        renderer.captureOpaqueDepth(ce);
      }
    }
  }
}
