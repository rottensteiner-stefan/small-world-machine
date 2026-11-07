import type { WebGLRenderPass } from "../WebGLRenderPass.js";
import type { AbstractWebGLRenderer } from "../AbstractWebGLRenderer.js";
import { WebGL2Renderer } from "../WebGL2/WebGL2Renderer.js";
import type { Scene } from "../../core/index.js";
import type { Vector3D } from "../../math/index.js";
import type { LightDataInterface } from "../../interfaces/index.js";
import type { RenderList } from "../../core/Scene.js";

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

  public execute(
    renderer: AbstractWebGLRenderer,
    _scene: Scene,
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
      renderer.renderShadowMaps(extractedLights, renderList.opaqueBatches);
    }
    renderer.updateGlobalUBO(vp, camPos, extractedLights, near, far);
  }
}
