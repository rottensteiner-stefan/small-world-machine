import type { Scene } from "../../core/index.js";
import { DepthMaterial } from "../../core/materials/index.js";
import { MaterialType, Topology } from "../../enums/index.js";
import type { WebGPURenderer } from "../WebGPU/WebGPURenderer.js";
import { VIEW_SLOT_MAIN_CAMERA } from "../WebGPU/WebGPURenderer.js";
import type { RenderPass } from "../index.js";
import { InstancedMesh } from "../../core/InstancedMesh.js";
import type { Object3D } from "../../core/Object3D.js";
import type { Vector3D } from "../../math/index.js";
import { MathUtils } from "../../math/index.js";
import type { Texture } from "../../core/textures/index.js";
import type { AbstractMaterial } from "../../core/materials/AbstractMaterial.js";
import type { RenderManifest } from "../shaders/RenderManifest.js";

const _scratchInstanced: InstancedMesh[] = [];
const _scratchStandard: Object3D[] = [];

/** One (diffuseMap, alphaTest) group of objects sharing an alpha-cutout depth draw call. */
interface AlphaTestGroup {
  /** Stable synthetic matUuid for this texture's bind group / object-uniform ring slot,
   * assigned once and reused across frames (see `DepthPrePassGPU._alphaGroupUuids`). */
  groupUuid: string;
  alphaTest: number;
  standard: Object3D[];
  instanced: InstancedMesh[];
}

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

  /** Groups objects needing alpha-cutout within the batch currently being processed, keyed by
   * their real material's diffuseMap texture -- rebuilt every batch, see `execute()`. */
  private readonly _alphaGroups = new Map<Texture, AlphaTestGroup>();

  /** Stable synthetic matUuid per alpha-cutout diffuseMap texture, assigned once and reused
   * across frames so `_getMaterialBindGroup`'s cache (and the object-uniform ring's per-slot
   * cache, both keyed by matUuid) actually get reused instead of rebuilding every frame. */
  private readonly _alphaGroupUuids = new WeakMap<Texture, string>();

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
    const renderList = scene.getVisibleObjectsSorted(vp, camPos);

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
      this._alphaGroups.clear();
      // A batch is keyed by material, so consecutive objects share it: build its manifest once.
      let lastMaterial: AbstractMaterial | undefined = undefined;
      let objManifest: RenderManifest | undefined = undefined;

      // Split into the fast opaque path (no per-object texture -- everything that doesn't
      // alpha-test) and one group per alpha-cutout diffuseMap: a shared depth-only pipeline
      // can't early-Z alpha-tested geometry correctly without actually sampling THAT object's
      // own cutout texture, so treating it as opaque here would let the depth pre-pass write
      // solid depth for pixels the color pass will later discard (see class doc + the
      // GPUTextureResourceCache.acquireTextures doc for why a stand-in, always-undefined
      // diffuseMap on the shared DepthMaterial was also corrupting the main pass's own texture
      // lifecycle).
      for (let i = 0; i < objects.length; i++) {
        const obj = objects[i]!;
        if (obj.material !== lastMaterial) {
          lastMaterial = obj.material;
          objManifest = lastMaterial?.getRenderManifest();
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
        const extraParams = objManifest?.properties["u_extraParams"] as number[] | undefined;
        const alphaTest = extraParams?.[1] ?? 0;
        const diffuseMap =
          alphaTest > 0
            ? (objManifest!.textures["u_diffuseMap"] as Texture | undefined)
            : undefined;

        if (passThrough && (diffuseMap || obj instanceof InstancedMesh)) {
          nStandard = this._leavePassThrough(objects, i);
          passThrough = false;
        }
        if (diffuseMap) {
          let group = this._alphaGroups.get(diffuseMap);
          if (!group) {
            let groupUuid = this._alphaGroupUuids.get(diffuseMap);
            if (!groupUuid) {
              groupUuid = MathUtils.generateUUID();
              this._alphaGroupUuids.set(diffuseMap, groupUuid);
            }
            group = { groupUuid, alphaTest, standard: [], instanced: [] };
            this._alphaGroups.set(diffuseMap, group);
          }
          if (obj instanceof InstancedMesh) group.instanced.push(obj);
          else group.standard.push(obj);
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

      for (const [diffuseMap, group] of this._alphaGroups) {
        this._depthMaterial.diffuseMap = diffuseMap;
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
    }

    // ADR 0059 P1-2: pulled field depth draws for the main view (their cutout alpha writes this
    // same shared depth buffer right after the scene casters, so the color pass's unchanged
    // early-Z rejects occluded foliage like any other occluder). The main-view culls ran at the
    // frame head; the pass already bound group 0 above.
    renderer._recordFieldDraws(rp, 0, VIEW_SLOT_MAIN_CAMERA, false, "depth");

    rp.end();
  }
}
