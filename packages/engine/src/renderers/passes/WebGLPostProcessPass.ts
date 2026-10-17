import type { WebGLRenderPass } from "../WebGLRenderPass.js";
import type { AbstractWebGLRenderer } from "../AbstractWebGLRenderer.js";
import type { Scene } from "../../core/index.js";
import type { Vector3D } from "../../math/index.js";
import type { LightDataInterface } from "../../interfaces/index.js";
import type { RenderList } from "../../core/Scene.js";

export class WebGLPostProcessPass implements WebGLRenderPass {
  public name = "WebGLPostProcessPass";

  public execute(
    renderer: AbstractWebGLRenderer,
    _scene: Scene,
    _vp: Float32Array,
    _camPos: Vector3D,
    _vMat: Float32Array | undefined,
    _renderList: RenderList,
    _extractedLights: LightDataInterface,
    _near?: number,
    _far?: number,
  ): void {
    renderer.flushPostProcess();
  }
}
