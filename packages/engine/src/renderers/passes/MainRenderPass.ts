import { Scene } from "../../core/index.js";
import { RenderBatch } from "../../core/Scene.js";
import {
  MaterialType,
  Topology,
  PostProcessingEffectType,
  NormalTargetMode,
} from "../../enums/index.js";
import { NORMAL_TARGET_CLEAR } from "../WebGPU/managers/NormalOutputWrapper.js";
import { WebGPURenderer } from "../WebGPU/index.js";
import { RenderPass } from "../index.js";
import { Vector3D } from "../../math/index.js";
import { Object3D } from "../../core/Object3D.js";
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
    const colorAttachments: GPURenderPassColorAttachment[] = [
      {
        view: targetView,
        clearValue: renderer.clearColor,
        loadOp: "clear",
        storeOp: "store",
      },
    ];
    if (normalView) {
      colorAttachments.push({
        view: normalView,
        clearValue: NORMAL_TARGET_CLEAR,
        loadOp: "clear",
        storeOp: "store",
      });
    }
    const opaqueMode = normalView ? NormalTargetMode.WRITE : NormalTargetMode.NONE;
    const maskedMode = normalView ? NormalTargetMode.MASKED : NormalTargetMode.NONE;

    const rp = ce.beginRenderPass({
      colorAttachments,
      depthStencilAttachment: {
        // DepthPrePassGPU already cleared and populated this depth buffer with the frontmost
        // depth for every opaque object this frame -- "load" instead of "clear" builds on top
        // of that instead of erasing it, which is what lets unchanged depthCompare:"less-equal"
        // below reject occluded fragments via early-Z before their fragment shader runs.
        view: renderer.activeDepthView,
        depthLoadOp: "load",
        depthStoreOp: "store",
      },
    });

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

      const decalAttachments: GPURenderPassColorAttachment[] = [
        { view: targetView, loadOp: "load", storeOp: "store" },
      ];
      if (normalView) {
        decalAttachments.push({ view: normalView, loadOp: "load", storeOp: "store" });
      }
      const rpDecal = ce.beginRenderPass({
        colorAttachments: decalAttachments,
        depthStencilAttachment: {
          view: renderer.activeDepthView,
          depthLoadOp: "load",
          depthStoreOp: "store",
        },
      });
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
      const transparentAttachments: GPURenderPassColorAttachment[] = [
        {
          view: targetView,
          loadOp: "load",
          storeOp: "store",
        },
      ];
      if (normalView) {
        transparentAttachments.push({ view: normalView, loadOp: "load", storeOp: "store" });
      }
      const rpTransparent = ce.beginRenderPass({
        colorAttachments: transparentAttachments,
        depthStencilAttachment: {
          view: renderer.activeDepthView,
          depthLoadOp: "load",
          depthStoreOp: "store",
        },
      });

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

      // HBAO and LightShafts need the opaque depth buffer every frame they're enabled, not just when there
      // happen to be transparent objects (the only other consumer of this capture).
      const hbaoNode = renderer.postProcessing.get<import("../post/index.js").HbaoElement>(
        PostProcessingEffectType.HBAO,
      );
      const shaftsNode = renderer.postProcessing.get<import("../post/index.js").LightShaftsElement>(
        PostProcessingEffectType.LIGHT_SHAFTS,
      );
      const needsDepth = (hbaoNode && hbaoNode.enabled) || (shaftsNode && shaftsNode.enabled);
      if (needsDepth && !depthCaptured) {
        renderer.captureOpaqueDepth(ce);
      }
    }
  }
}
