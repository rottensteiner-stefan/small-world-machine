import type { WebGLRenderPass } from "../WebGLRenderPass.js";
import type { AbstractWebGLRenderer } from "../AbstractWebGLRenderer.js";
import { WebGL2Renderer } from "../WebGL2/WebGL2Renderer.js";
import type { Scene } from "../../core/index.js";
import type { Vector3D } from "../../math/index.js";
import type { LightDataInterface } from "../../interfaces/index.js";
import type { RenderBatch, RenderList } from "../../core/Scene.js";
import { SPOT_SHADOW_LAYERS } from "../../core/lights/PointLightShadow.js";
import { ShadowCasterCollector } from "./ShadowCasterCollector.js";

/**
 * Shadow map rendering + global UBO flush -- WebGL2-only (`renderShadowMaps()`/`updateGlobalUBO()`
 * only exist on `WebGL2Renderer`). Typed against the shared `AbstractWebGLRenderer` interface with
 * a real `instanceof WebGL2Renderer` guard below, same pattern as `WebGLClusterCullPass` -- NOT the
 * `renderer as unknown as { renderShadowMaps?: ...; updateGlobalUBO?: ... }` duck-typed cast this
 * file used before, which regressed exactly the hazard that pattern was introduced to fix: an
 * unchecked cast type-checks against any shape (both methods are `?`-optional), so it would keep
 * compiling silently even if `WebGL2Renderer`'s real signatures ever drifted from this file's copy.
 */
export class WebGLShadowPass implements WebGLRenderPass {
  public name = "WebGLShadowPass";
  private readonly _casterCollector = new ShadowCasterCollector();

  public execute(
    renderer: AbstractWebGLRenderer,
    scene: Scene,
    vp: Float32Array,
    camPos: Vector3D,
    _vMat: Float32Array | undefined,
    renderList: RenderList,
    extractedLights: LightDataInterface,
    near?: number,
    far?: number,
  ): void {
    if (!(renderer instanceof WebGL2Renderer)) return;

    // Skip rebuilding the shadow atlas for a secondary offscreen camera (a DynamicReflectionProbe
    // face or a PlanarReflectionNode) -- see `isOffscreenRenderTarget`'s doc comment. The atlas
    // already reflects the main camera's frame; only `updateGlobalUBO` needs to run so this
    // camera's own view/position are current for the color pass that follows.
    if (!renderer.isOffscreenRenderTarget) {
      let shadowBatches: RenderBatch[] = renderList.opaqueBatches;
      if (scene?.root) {
        this._casterCollector.reset();
        const dLight = extractedLights.dLight;
        if (dLight && dLight.castShadow && dLight.numCascades > 0) {
          const numCascades = Math.min(dLight.numCascades, dLight.cascadeCameras.length);
          for (let i = 0; i < numCascades; i++) {
            const cam = dLight.cascadeCameras[i];
            if (cam) this._casterCollector.addViewProjectionMatrix(cam.viewProjectionMatrix);
          }
        }
        const spotSlots = Math.min(extractedLights.sLights.length, SPOT_SHADOW_LAYERS);
        for (let i = 0; i < spotSlots; i++) {
          const sLight = extractedLights.sLights[i]!;
          if (!sLight.castShadow) continue;
          sLight.updateShadowCamera();
          if (sLight.shadowCamera) {
            this._casterCollector.addViewProjectionMatrix(sLight.shadowCamera.viewProjectionMatrix);
          }
        }
        this._casterCollector.collect(scene.root);
        shadowBatches = this._casterCollector.batches;
      }
      renderer.renderShadowMaps(extractedLights, shadowBatches);
    }
    renderer.updateGlobalUBO(vp, camPos, extractedLights, near, far);
  }
}

