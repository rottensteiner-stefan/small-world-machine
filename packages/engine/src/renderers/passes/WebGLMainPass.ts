import type { WebGLRenderPass } from "../WebGLRenderPass.js";
import type { AbstractWebGLRenderer } from "../AbstractWebGLRenderer.js";
import type { Scene, Object3D } from "../../core/index.js";
import { Vector3D } from "../../math/index.js";
import type { LightDataInterface } from "../../interfaces/index.js";
import type { RenderList, RenderBatch } from "../../core/Scene.js";
import { Topology, MaterialType } from "../../enums/index.js";
import { Color } from "../../core/colors/index.js";

/** Frozen "no lights" payload of the skybox batch — `Color.BLACK`/`Vector3D.ZERO` are shared
 * frozen constants and the empty arrays are never mutated. Read synchronously by `renderBatch`,
 * so one module-level instance is safe across every engine instance (zero allocation per skybox). */
const SKYBOX_EMPTY_LIGHTS: LightDataInterface = {
  aCol: Color.BLACK,
  aIntensity: 0,
  dCol: Color.BLACK,
  dIntensity: 0,
  dDir: Vector3D.ZERO,
  pLights: [],
  sLights: [],
  aLights: [],
};

/** Reused ADR 0059 opaque field-draw context. All optional members pre-declared for a stable
 * hidden class (zero allocation per frame; absent `vMat` is passed as `undefined`, never a
 * fresh spread object). `drawInstanceFieldView` consumes it synchronously and keeps no reference,
 * so overwriting between calls is safe. Mutable local structural type because the public
 * `InstanceFieldDrawContext` members are `readonly` (their type is still satisfied structurally). */
const FIELD_CTX_SCRATCH: {
  lights?: LightDataInterface | undefined;
  scene?: Scene | undefined;
  vMat?: Float32Array | undefined;
  vp?: Float32Array | undefined;
  camPos?: Vector3D | undefined;
  shaderId?: string | undefined;
} = {
  lights: undefined,
  scene: undefined,
  vMat: undefined,
  vp: undefined,
  camPos: undefined,
  shaderId: undefined,
};

export class WebGLMainPass implements WebGLRenderPass {
  public name = "WebGLMainPass";

  // Reused across all transparent objects in a frame instead of allocating a fresh batch (and
  // its single-element `objects` array) per object -- `renderBatch` only ever reads this
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
    renderer: AbstractWebGLRenderer,
    scene: Scene,
    vp: Float32Array,
    camPos: Vector3D,
    vMat: Float32Array | undefined,
    renderList: RenderList,
    extractedLights: LightDataInterface,
    _near?: number,
    _far?: number,
  ): void {
    const gl = renderer.webglContext;

    // 1. Bind Main Render Target
    renderer.bindMainRenderTarget();

    // 2. Clear (depth writes must be on: a depthMask(false) leaked from the previous frame's
    // transparent / post-process draws would turn the depth clear into a no-op)
    gl.depthMask(true);
    (renderer as AbstractWebGLRenderer).resetStateCache();
    // The sRGB clear colour in the forward pass's output space (ADR 0049); set per pass because the
    // lane follows postProcessing.enabled and shadow passes repoint gl.clearColor.
    const cc = renderer.targetClearColor;
    gl.clearColor(cc.r, cc.g, cc.b, cc.a);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const writesNormals = renderer.hasNormalTarget;
    if (writesNormals) renderer.clearNormalTarget();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // 3. Render Skybox
    gl.depthMask(false);
    for (let i = 0; i < renderList.opaqueBatches.length; i++) {
      const batch = renderList.opaqueBatches[i];
      if (batch!.shaderId === MaterialType.SKYBOX && batch!.objects.length > 0) {
        (renderer as AbstractWebGLRenderer).renderBatch(
          batch!,
          vMat,
          vp,
          camPos,
          SKYBOX_EMPTY_LIGHTS,
          scene,
        );
      }
    }
    gl.depthMask(true);

    // 4. Render Opaque (the only phase that writes the normal buffer: skybox and transparents
    // leave it untouched, matching WebGPU's MASKED mode)
    if (writesNormals) renderer.setNormalWriteEnabled(true);
    for (let i = 0; i < renderList.opaqueBatches.length; i++) {
      const batch = renderList.opaqueBatches[i];
      if (batch!.shaderId !== MaterialType.SKYBOX && batch!.objects.length > 0) {
        (renderer as AbstractWebGLRenderer).renderBatch(
          batch!,
          vMat,
          vp,
          camPos,
          extractedLights,
          scene,
        );
      }
    }

    // ADR 0059 field lane (CPU-cell GL fallback): draw every registered field's OPAQUE command
    // source right after the regular opaque geometry -- the fields are opaque, depth-writing
    // draws whose shared / per-field state the draw hook binds itself (single-point surface, no
    // backend branches here). Runs while the normal buffer is write-enabled like the opaque loop.
    FIELD_CTX_SCRATCH.lights = extractedLights;
    FIELD_CTX_SCRATCH.scene = scene;
    FIELD_CTX_SCRATCH.vMat = vMat;
    FIELD_CTX_SCRATCH.vp = vp;
    FIELD_CTX_SCRATCH.camPos = camPos;
    (renderer as AbstractWebGLRenderer).drawInstanceFieldView(0, "opaque", FIELD_CTX_SCRATCH);

    if (writesNormals) renderer.setNormalWriteEnabled(false);

    // Decals read the finished opaque depth (and normal copy) and are drawn before the
    // transparents, which then see them in their refraction capture. The depth copy made here is
    // reused below instead of blitting it a second time.
    let depthCaptured = false;
    if (renderList.decals.length > 0 && renderer.canDrawDecals) {
      renderer.copyToOpaqueDepthTexture();
      depthCaptured = true;
      if (writesNormals) {
        renderer.copyToOpaqueNormalTexture();
        renderer.setNormalWriteEnabled(true);
      }
      gl.depthMask(false);
      for (const decal of renderList.decals) {
        const manifest = decal.material!.getRenderManifest();
        this._scratchDecalObjects[0] = decal;
        this._scratchDecalBatch.shaderId = manifest.shaderId;
        this._scratchDecalBatch.matUuid = decal.material!.uuid;
        (renderer as AbstractWebGLRenderer).renderBatch(
          this._scratchDecalBatch,
          vMat,
          vp,
          camPos,
          extractedLights,
          scene,
        );
      }
      gl.depthMask(true);
      if (writesNormals) renderer.setNormalWriteEnabled(false);
    }

    // HBAO, light shafts and volumetric fog need the opaque depth buffer every frame they are
    // enabled, not just when there happen to be transparent objects (the only other consumer of
    // this capture, for refraction). Single source of truth: `postProcessing.requiresOpaqueDepth`
    // -- never a per-effect ad-hoc OR chain (ADR 0038 §4).
    if (
      renderList.transparent.length === 0 &&
      renderer.postProcessing.requiresOpaqueDepth &&
      !depthCaptured
    ) {
      renderer.copyToOpaqueDepthTexture();
    }

    // 5. Render Transparent
    if (renderList.transparent.length > 0) {
      renderer.copyToOpaqueTexture();
      // With post-processing the capture was always done; without it (default framebuffer) only
      // pay the depth blit when a transparent material actually samples u_opaqueDepthMap.
      let needsDepth = renderer.postProcessing.enabled;
      for (let i = 0; !needsDepth && i < renderList.transparent.length; i++) {
        const mat = renderList.transparent[i]!.material;
        if (mat) needsDepth = renderer.requiresOpaqueDepth(mat.getRenderManifest().shaderId);
      }
      if (needsDepth && !depthCaptured) renderer.copyToOpaqueDepthTexture();

      for (const obj of renderList.transparent) {
        if (!obj.material) continue;
        const manifest = obj.material.getRenderManifest();
        // AbstractGeometry always sets .topology explicitly, so this only matters for
        // hand-built GeometryData that skips it -- default to triangles rather than
        // guessing from index count (a 2-index geometry isn't reliably a line).
        const topology = manifest.state?.topology || obj.geometry?.topology || Topology.DEFAULT;

        this._scratchTransparentBatch.shaderId = manifest.shaderId;
        this._scratchTransparentBatch.topology = topology as Topology;
        this._scratchTransparentBatch.matUuid = obj.material.uuid;
        this._scratchTransparentObjects[0] = obj;
        (renderer as AbstractWebGLRenderer).renderBatch(
          this._scratchTransparentBatch,
          vMat,
          vp,
          camPos,
          extractedLights,
          scene,
        );
      }
    }
  }
}
