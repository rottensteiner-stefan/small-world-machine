import type { Scene } from "../../core/index.js";
import {
  DepthMaterial,
  StandardMaterial,
  type TextureTransform,
} from "../../core/materials/index.js";
import { MaterialType, Topology } from "../../enums/index.js";
import type { WebGPURenderer } from "../WebGPU/WebGPURenderer.js";
import { VIEW_SLOT_MAIN_CAMERA } from "../WebGPU/WebGPURenderer.js";
import type { RenderPass } from "../index.js";
import { InstancedMesh } from "../../core/InstancedMesh.js";
import type { Object3D } from "../../core/Object3D.js";
import type { Vector3D } from "../../math/index.js";
import type { Texture } from "../../core/textures/index.js";
import type { AbstractMaterial } from "../../core/materials/AbstractMaterial.js";
import type { RenderManifest } from "../shaders/RenderManifest.js";
import { AlphaCutoutGroups } from "./AlphaCutoutGroups.js";

const _scratchInstanced: InstancedMesh[] = [];
const _scratchStandard: Object3D[] = [];

/**
 * Z-only pre-pass for opaque objects, using the shared DepthMaterial pipeline (same
 * one-pipeline-for-everyone approach CascadedShadowPassGPU/SpotShadowPassGPU already use for
 * shadow casters). Populates the main depth buffer BEFORE MainRenderPass's color pass runs, so
 * its unchanged depthCompare:"less-equal" test rejects occluded fragments via hardware early-Z
 * before their (often expensive, PBR + clustered-lighting) fragment shader ever runs -- no
 * change to depthWrite/depthCompare needed there, the win comes from the depth buffer already
 * holding the frontmost value by the time the color pass draws. MainRenderPass's opaque pass
 * switches depthLoadOp from "clear" to "load" to build on top of what this pass writes, instead
 * of erasing it -- this pass owns the once-per-frame clear now.
 */
export class DepthPrePassGPU implements RenderPass {
  public name = "DepthPrePassGPU";

  private _depthMaterial?: DepthMaterial;
  private readonly _cutoutGroups = new AlphaCutoutGroups();

  /** Copies the plain prefix `objects[0..end)` into the scratch list; returns its length. */
  private _leavePassThrough(objects: readonly Object3D[], end: number): number {
    for (let k = 0; k < end; k++) _scratchStandard[k] = objects[k]!;
    return end;
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
    this._depthMaterial ??= new DepthMaterial();
    renderer.context.shaderRegistry.ensureProvider(MaterialType.DEPTH, this._depthMaterial);
    // Frame-frozen list computed once per frame by the renderer -- never re-collect here (the
    // same list + ordering must reach every pass); direct/test executions fall back to the scene.
    const renderList = renderer.frameRenderList ?? scene.getVisibleObjectsSorted(vp, camPos);

    // No early return: the depth clear must happen every frame regardless of whether there's
    // anything to draw yet, since MainRenderPass's opaque pass now relies on it (depthLoadOp
    // "load") instead of clearing itself.
    const rp = ce.beginRenderPass({
      colorAttachments: [
        {
          // Reused as a throwaway target -- MainRenderPass clears (loadOp: "clear") this same
          // view again right after, so whatever this pass writes here is discarded either way.
          // Avoids needing our own canvas-sized dummy texture (unlike the shadow passes' fixed-
          // resolution dummy target, this would need resize tracking to stay valid).
          view: targetView,
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          storeOp: "discard",
        },
      ],
      depthStencilAttachment: {
        view: renderer.activeDepthView,
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });

    // No dummy-bind-group snapshot dance needed here (unlike the shadow passes): the main depth
    // buffer this pass writes into is never itself bound as a texture in the global bind group.
    rp.setBindGroup(0, renderer.globalBindGroup);

    for (let batchIdx = 0; batchIdx < renderList.opaqueBatches.length; batchIdx++) {
      const batch = renderList.opaqueBatches[batchIdx];
      if (batch!.objects.length === 0) {
        continue;
      }

      let topology: GPUPrimitiveTopology = Topology.DEFAULT;
      if (batch!.topology === Topology.POINT_LIST) topology = Topology.POINT_LIST;
      else if (batch!.topology === Topology.LINE_LIST) topology = Topology.LINE_LIST;
      else if (batch!.topology === Topology.LINE_STRIP) topology = Topology.LINE_STRIP;

      const objects = batch!.objects;
      // Index writes + final `length = n` (V8 drops the backing store on `length = 0`).
      let nInstanced = 0;
      let nStandard = 0;
      // While every object takes the plain opaque path, the batch list itself is that path (no
      // copy); the first deviating object switches to the scratch list (prefix copied once).
      let passThrough = true;
      this._cutoutGroups.recycle();
      // A batch is keyed by material, so consecutive objects share it: build its manifest once.
      let lastMaterial: AbstractMaterial | undefined = undefined;
      let objManifest: RenderManifest | undefined = undefined;
      let matAlphaTest = 0;
      let matDiffuseMap: Texture | undefined = undefined;
      let matDiffuseTransform: TextureTransform | undefined = undefined;

      // Split into the fast opaque path (no per-object texture -- everything that doesn't
      // alpha-test) and one group per (diffuseMap, alphaTest, diffuseTransform): a shared
      // depth-only pipeline can't early-Z alpha-tested geometry correctly without actually
      // sampling THAT object's cutout texture + UV transform.
      for (let i = 0; i < objects.length; i++) {
        const obj = objects[i]!;
        if (obj.material !== lastMaterial) {
          lastMaterial = obj.material;
          objManifest = lastMaterial?.getRenderManifest();
          const extraParams = objManifest?.properties["u_extraParams"] as number[] | undefined;
          matAlphaTest = extraParams?.[1] ?? 0;
          matDiffuseMap =
            matAlphaTest > 0
              ? (objManifest?.textures["u_diffuseMap"] as Texture | undefined)
              : undefined;
          matDiffuseTransform =
            matDiffuseMap && lastMaterial instanceof StandardMaterial
              ? lastMaterial.textureTransforms?.diffuse
              : undefined;
        }
        if (
          objManifest?.state?.skipDepthPrePass === true ||
          objManifest?.state?.depthWrite === false ||
          objManifest?.state?.depthTest === false ||
          obj.material?.depthWrite === false ||
          obj.material?.depthTest === false
        ) {
          if (passThrough) nStandard = this._leavePassThrough(objects, i);
          passThrough = false;
          continue;
        }

        if (passThrough && (matDiffuseMap || obj instanceof InstancedMesh)) {
          nStandard = this._leavePassThrough(objects, i);
          passThrough = false;
        }
        if (matDiffuseMap) {
          this._cutoutGroups.add(obj, matDiffuseMap, matAlphaTest, matDiffuseTransform);
        } else if (obj instanceof InstancedMesh) {
          _scratchInstanced[nInstanced++] = obj;
        } else if (!passThrough) {
          _scratchStandard[nStandard++] = obj;
        }
      }
      _scratchInstanced.length = nInstanced;
      if (!passThrough) _scratchStandard.length = nStandard;
      const standardList = passThrough ? objects : _scratchStandard;

      // Slot 0 (VIEW_SLOT_MAIN_CAMERA) is already correct this frame, written once by
      // _updateGlobalBuffers() -- its offset is always 0, no _setViewMatrix() call needed.
      if (standardList.length > 0 || _scratchInstanced.length > 0) {
        this._depthMaterial.diffuseMap = undefined;
        this._depthMaterial.diffuseTransform = undefined;
        this._depthMaterial.alphaTest = 0;
        const opaqueManifest = this._depthMaterial.getRenderManifest();

        if (standardList.length > 0) {
          renderer._renderSubgroup(
            rp,
            standardList,
            false,
            this._depthMaterial.uuid,
            opaqueManifest,
            VIEW_SLOT_MAIN_CAMERA,
            vMat,
            topology,
          );
        }

        if (_scratchInstanced.length > 0) {
          renderer._renderSubgroup(
            rp,
            _scratchInstanced,
            true,
            this._depthMaterial.uuid,
            opaqueManifest,
            VIEW_SLOT_MAIN_CAMERA,
            vMat,
            topology,
          );
        }
      }

      const activeCutouts = this._cutoutGroups.active;
      for (let g = 0; g < activeCutouts.length; g++) {
        const group = activeCutouts[g]!;
        this._depthMaterial.diffuseMap = group.diffuseMap;
        this._depthMaterial.diffuseTransform = group.diffuseTransform;
        this._depthMaterial.alphaTest = group.alphaTest;
        const alphaManifest = this._depthMaterial.getRenderManifest();

        if (group.standard.length > 0) {
          renderer._renderSubgroup(
            rp,
            group.standard,
            false,
            group.groupUuid,
            alphaManifest,
            VIEW_SLOT_MAIN_CAMERA,
            vMat,
            topology,
          );
        }

        if (group.instanced.length > 0) {
          renderer._renderSubgroup(
            rp,
            group.instanced,
            true,
            group.groupUuid,
            alphaManifest,
            VIEW_SLOT_MAIN_CAMERA,
            vMat,
            topology,
          );
        }
      }
      this._depthMaterial.diffuseMap = undefined;
      this._depthMaterial.diffuseTransform = undefined;
      this._depthMaterial.alphaTest = 0;
    }

    // ADR 0059 P1-2: pulled field depth draws for the main view (their cutout alpha writes this
    // same shared depth buffer right after the scene casters, so the color pass's unchanged
    // early-Z rejects occluded foliage like any other occluder). The main-view culls ran at the
    // frame head; the pass already bound group 0 above.
    renderer._recordFieldDraws(rp, 0, VIEW_SLOT_MAIN_CAMERA, false, "depth");

    rp.end();
  }
}
