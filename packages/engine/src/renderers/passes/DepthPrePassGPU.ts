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
      _scratchInstanced.length = 0;
      _scratchStandard.length = 0;
      this._alphaGroups.clear();

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
        const objManifest = obj.material?.getRenderManifest();
        if (
          objManifest?.state?.skipDepthPrePass === true ||
          objManifest?.state?.depthWrite === false ||
          objManifest?.state?.depthTest === false ||
          obj.material?.depthWrite === false ||
          obj.material?.depthTest === false
        ) {
          continue;
        }
        const extraParams = objManifest?.properties["u_extraParams"] as number[] | undefined;
        const alphaTest = extraParams?.[1] ?? 0;
        const diffuseMap =
          alphaTest > 0
            ? (objManifest!.textures["u_diffuseMap"] as Texture | undefined)
            : undefined;

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
          _scratchInstanced.push(obj);
        } else {
          _scratchStandard.push(obj);
        }
      }

      // Slot 0 (VIEW_SLOT_MAIN_CAMERA) is already correct this frame, written once by
      // _updateGlobalBuffers() -- its offset is always 0, no _setViewMatrix() call needed.
      if (_scratchStandard.length > 0 || _scratchInstanced.length > 0) {
        this._depthMaterial.diffuseMap = undefined;
        const opaqueManifest = this._depthMaterial.getRenderManifest();

        if (_scratchStandard.length > 0) {
          renderer._renderSubgroup(
            rp,
            _scratchStandard,
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

    rp.end();
  }
}
