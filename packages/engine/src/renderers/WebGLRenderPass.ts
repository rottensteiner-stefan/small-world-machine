import type { AbstractWebGLRenderer } from "./AbstractWebGLRenderer.js";
import type { Scene, RenderList } from "../core/Scene.js";
import type { Vector3D } from "../math/index.js";
import type { LightDataInterface } from "../interfaces/index.js";

/**
 * Ein einheitliches Interface für WebGL-Passes (WebGL1 und WebGL2).
 * Jeder Pass sollte seine benötigten RenderTargets und State-Einstellungen selbst verwalten.
 */
export interface WebGLRenderPass {
  /** Name des Passes */
  name: string;

  /**
   * Führt diesen Pass aus.
   * @param renderer Der ausführende WebGL-Renderer (WebGL1 oder WebGL2).
   * @param scene Die Szene.
   * @param vp View-Projection Matrix.
   * @param camPos Kamera-Position.
   * @param vMat View Matrix (optional).
   * @param renderList Die sortierte Liste der zu rendernden Objekte.
   * @param extractedLights Die extrahierten Lichter der Szene.
   * @param near Kamera-Near-Plane.
   * @param far Kamera-Far-Plane.
   * @param projMatrix Die rohe (nicht mit der View kombinierte) Projektionsmatrix dieses Frames --
   *   explizit statt über ein public Renderer-Feld, s. `WebGLClusterCullPass`.
   */
  execute(
    renderer: AbstractWebGLRenderer,
    scene: Scene,
    vp: Float32Array,
    camPos: Vector3D,
    vMat: Float32Array | undefined,
    renderList: RenderList,
    extractedLights: LightDataInterface,
    near?: number,
    far?: number,
    projMatrix?: Float32Array,
  ): void;
}
