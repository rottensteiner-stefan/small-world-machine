import type { WebGPURenderer } from "../WebGPURenderer.js";
import { VIEW_SLOT_MAIN_CAMERA } from "../WebGPURenderer.js";
import { WebGPUGGlobalUniformLayout } from "../../GlobalUniformLayout.js";
import type { CubeTexture, Scene, Texture } from "../../../core/index.js";
import { MAX_CLUSTERED_LIGHTS_PER_TYPE } from "../../../core/index.js";
import type { LightDataInterface } from "../../../interfaces/index.js";
import type { Vector3D } from "../../../math/index.js";
import { DEFAULT_CLUSTER_TILE_SIZE, MathPool, Matrix4 } from "../../../math/index.js";

/** Floats per light slot in the three storage buffers (must match the WGSL `PointLight`/`SpotLight`/`AreaLight` structs). */
const POINT_LIGHT_FLOATS = 8;
const SPOT_LIGHT_FLOATS = 16;
const AREA_LIGHT_FLOATS = 24;
const BYTES_PER_FLOAT = 4;

/**
 * EVSM tuning defaults (only reached when `quality.shadowMode === "evsm"`; ADR 0007).
 * These are the GL2-compatible central defaults; the shadow shaders read the same lanes.
 * `varianceFloor` is the dynamic (chain-rule-scaled by the warp) min-variance epsilon that
 * replaces the depth bias for acne control in EVSM; `lightBleed` is the light-bleeding-reduction
 * remap amount (higher darkens residual leak faster, too high darkens the whole penumbra).
 */
const EVSM_VARIANCE_FLOOR = 1e-3;
const EVSM_LIGHT_BLEED = 0.004;
/** Point/spot buffers hold exactly `MAX_CLUSTERED_LIGHTS_PER_TYPE` slots (64 * 32 B = 2048 B, 64 * 64 B = 4096 B).
 * Functions, not module constants: `core/index.js` is a circular import here and its exports are
 * still undefined while this module evaluates. */
const pointLightBufferBytes = (): number =>
  MAX_CLUSTERED_LIGHTS_PER_TYPE * POINT_LIGHT_FLOATS * BYTES_PER_FLOAT;
const spotLightBufferBytes = (): number =>
  MAX_CLUSTERED_LIGHTS_PER_TYPE * SPOT_LIGHT_FLOATS * BYTES_PER_FLOAT;
/** Area lights are a WebGPU storage array (not the 4-slot std140 block of WebGL2); capacity is whatever fits in one 4 KiB buffer (42). */
const AREA_LIGHT_BUFFER_BYTES = 4096;
const MAX_WEBGPU_AREA_LIGHTS = Math.floor(
  AREA_LIGHT_BUFFER_BYTES / (AREA_LIGHT_FLOATS * BYTES_PER_FLOAT),
);

/** Allocation-free `array.set([x, y, z, w], index)`. */
function setVec4(a: Float32Array, index: number, x: number, y: number, z: number, w: number): void {
  a[index] = x;
  a[index + 1] = y;
  a[index + 2] = z;
  a[index + 3] = w;
}

/**
 * Owns the per-frame global-uniform write path that used to live inside `WebGPURenderer`:
 * the global/light/view data scratch arrays, the four GPU buffers they are uploaded into, the
 * frame's inverse view-projection scratch, and the IBL-change detection that forces a bind-group
 * rebuild whenever a scene swaps its irradiance/prefilter/BRDF maps.
 *
 * The renderer stays the host for everything outside this subsystem -- the `_globalBGL` layout,
 * the cluster-culling buffers, the bone-matrix buffer and `_globalBindGroup` assembly all remain
 * renderer-owned; the writer only reads them back through `WebGPURenderer`'s accessors (device,
 * canvas resolution, post-processing/quality state, cluster dims, view-slot writer). Hot path:
 * `update()` reuses pre-allocated buffers/scratch and never allocates in the steady state (the
 * light scratch arrays only regrow when a frame's light count exceeds the current capacity).
 */
export class GlobalUniformWriter {
  private _globalUniformBuffer!: GPUBuffer;
  private _pointLightBuffer!: GPUBuffer;
  private _spotLightBuffer!: GPUBuffer;
  private _areaLightBuffer!: GPUBuffer;

  // Size comes from the single layout table (GlobalUniformLayout.ts), pinned against structs.wgsl
  // by tests/renderers/GlobalUniformLayout.test.ts.
  private _scratchGlobalBufferData = new Float32Array(WebGPUGGlobalUniformLayout.totalFloats);
  private _scratchPointLightData = new Float32Array(4 * POINT_LIGHT_FLOATS); // grows dynamically
  private _scratchSpotLightData = new Float32Array(4 * SPOT_LIGHT_FLOATS); // grows dynamically
  private _scratchAreaLightData = new Float32Array(4 * AREA_LIGHT_FLOATS); // grows dynamically

  /** Inverse of this frame's GL (non zero-to-one) view-projection; decals unproject depth with it. */
  private readonly _frameInvViewProj: Matrix4 = new Matrix4();

  private _currentIrradianceMap?: CubeTexture | undefined;
  private _currentPrefilterMap?: CubeTexture | undefined;
  private _currentBrdfLUT?: Texture | undefined;

  constructor(private readonly _host: WebGPURenderer) {}

  public get globalUniformBuffer(): GPUBuffer {
    return this._globalUniformBuffer;
  }

  public get pointLightBuffer(): GPUBuffer {
    return this._pointLightBuffer;
  }

  public get spotLightBuffer(): GPUBuffer {
    return this._spotLightBuffer;
  }

  public get areaLightBuffer(): GPUBuffer {
    return this._areaLightBuffer;
  }

  /** Reused every frame (never reallocated) -- see `update()`. */
  public get scratchGlobalBufferData(): Float32Array {
    return this._scratchGlobalBufferData;
  }

  /** Inverse of this frame's GL (non zero-to-one) view-projection, for decal unprojection. */
  public get frameInvViewProj(): Matrix4 {
    return this._frameInvViewProj;
  }

  /**
   * Allocates the four global-upload buffers. Called once during renderer initialization, before
   * the global bind group is assembled (the bind group binds these buffers).
   */
  public init(device: GPUDevice): void {
    this._globalUniformBuffer = device.createBuffer({
      size: WebGPUGGlobalUniformLayout.totalBytes,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._pointLightBuffer = device.createBuffer({
      size: pointLightBufferBytes(),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this._spotLightBuffer = device.createBuffer({
      size: spotLightBufferBytes(),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this._areaLightBuffer = device.createBuffer({
      size: AREA_LIGHT_BUFFER_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * Resets the IBL-change-detection state so the next `update()` rebuilds the global bind group
   * with the scene's real IBL textures. Called by the renderer's cluster-buffer reallocation
   * (that path has no `Scene` to pull the maps from itself, see `WebGPURenderer._allocateClusterBuffers`).
   */
  public resetSceneTextures(): void {
    this._currentIrradianceMap = undefined;
    this._currentPrefilterMap = undefined;
    this._currentBrdfLUT = undefined;
  }

  public update(
    vp: Float32Array,
    camPos: Vector3D,
    lights: LightDataInterface,
    scene: Scene,
    near: number = 0.1,
    far: number = 1000,
    projMatrix?: Float32Array,
  ): void {
    if (lights.pLights.length > MAX_CLUSTERED_LIGHTS_PER_TYPE) {
      throw new Error(
        `[WebGPURenderer] Point light count exceeds limit of ${MAX_CLUSTERED_LIGHTS_PER_TYPE}: ${lights.pLights.length}`,
      );
    }
    if (lights.sLights.length > MAX_CLUSTERED_LIGHTS_PER_TYPE) {
      throw new Error(
        `[WebGPURenderer] Spot light count exceeds limit of ${MAX_CLUSTERED_LIGHTS_PER_TYPE}: ${lights.sLights.length}`,
      );
    }
    if (lights.aLights.length > MAX_WEBGPU_AREA_LIGHTS) {
      throw new Error(
        `[WebGPURenderer] Area light count exceeds limit of ${MAX_WEBGPU_AREA_LIGHTS}: ${lights.aLights.length}`,
      );
    }
    // Fail fast on a corrupt camera instead of uploading NaN/inverted planes that silently break
    // clustering, fog and HZB. Orthographic cameras may legitimately have near <= 0, so only
    // finiteness and ordering are checked.
    if (!Number.isFinite(near) || !Number.isFinite(far) || far <= near) {
      throw new Error(`[WebGPURenderer] Invalid camera near/far: near=${near}, far=${far}`);
    }
    if (projMatrix !== undefined && projMatrix.length < 16) {
      throw new Error(
        `[WebGPURenderer] projMatrix must have 16 elements, got ${projMatrix.length}`,
      );
    }
    if (
      this._currentIrradianceMap !== scene.irradianceMap ||
      this._currentPrefilterMap !== scene.prefilterMap ||
      this._currentBrdfLUT !== scene.brdfLUT
    ) {
      this._currentIrradianceMap = scene.irradianceMap;
      this._currentPrefilterMap = scene.prefilterMap;
      this._currentBrdfLUT = scene.brdfLUT;
      this._host._rebuildGlobalBindGroupForScene(scene);
    }

    const correctedVp = MathPool.acquireMatrix();
    const originalVp = MathPool.acquireMatrix();
    originalVp.data.set(vp);
    Matrix4.invert(originalVp, this._frameInvViewProj);

    // WebGPU uses [0, 1] depth range, but our projection matrices use [-1, 1] (OpenGL standard).
    // Apply ZO (Zero-to-One) correction matrix to fix clipping without modifying shaders.
    Matrix4.multiply(Matrix4.ZO_CORRECTION, originalVp, correctedVp);

    const gData = this._scratchGlobalBufferData;
    const glob = WebGPUGGlobalUniformLayout.fields;
    gData.set(correctedVp.data, glob.vp.index);
    setVec4(gData, glob.viewPos.index, camPos.x, camPos.y, camPos.z, 1);
    // Slot 0 = main camera in the per-draw view buffer (group 3) -- kept correct here, once per
    // frame, independent of whatever CascadedShadowPassGPU/SpotShadowPassGPU write into their own
    // slots afterward. See VIEW_SLOT_MAIN_CAMERA.
    this._host._writeViewSlot(VIEW_SLOT_MAIN_CAMERA, correctedVp.data);

    MathPool.releaseMatrix(originalVp);
    MathPool.releaseMatrix(correctedVp);
    setVec4(
      gData,
      glob.ambientColor.index,
      lights.aCol.r * lights.aIntensity,
      lights.aCol.g * lights.aIntensity,
      lights.aCol.b * lights.aIntensity,
      1,
    );
    setVec4(
      gData,
      glob.dirLightColor.index,
      lights.dCol.r * lights.dIntensity,
      lights.dCol.g * lights.dIntensity,
      lights.dCol.b * lights.dIntensity,
      1,
    );
    // lights.dDir is already negated to point TO the light in applyTo.
    setVec4(gData, glob.dirLightDir.index, lights.dDir.x, lights.dDir.y, lights.dDir.z, 0);
    // Tonemapping contract: with post-processing enabled the forward pass writes linear HDR
    // (gamma 1.0 disables the forward shader's Reinhard guard, exposure 1.0) and the PostProcess
    // pass applies exposure/tonemap/gamma once. Without post-processing the forward pass does it
    // itself from `quality.gamma`/`quality.exposure`. Never apply both (double tonemapping).
    const gamma = this._host.postProcessing.enabled ? 1.0 : (this._host.quality.gamma ?? 2.2);
    const exposure = this._host.postProcessing.enabled ? 1.0 : (this._host.quality.exposure ?? 1.0);
    setVec4(
      gData,
      glob.numPointLights.index,
      lights.pLights.length,
      lights.sLights.length,
      lights.aLights.length,
      gamma,
    );
    gData[glob.exposure.index] = exposure; // exposure

    const fog = scene.fog;
    if (fog) {
      gData[glob.fogMode.index] = fog.mode;
      gData[glob.fogDensity.index] = fog.density;
      gData[glob.fogNear.index] = fog.near;
      gData[glob.fogFar.index] = fog.far;
      gData[glob.fogHeight.index] = fog.height;
      gData[glob.fogHeightFalloff.index] = fog.heightFalloff;
      gData[glob.envIntensity.index] = scene.environmentIntensity; // envIntensity instead of _pad
      setVec4(gData, glob.fogColor.index, fog.color.r, fog.color.g, fog.color.b, 1.0);
    } else {
      gData[glob.fogMode.index] = 0.0; // fogMode NONE
      gData[glob.envIntensity.index] = scene.environmentIntensity; // envIntensity
    }

    // Default shadow values in case there are no shadows.
    // Struct order in structs.wgsl is cascadeMatrices (128-191) -> cascadeSplits
    // (192-195) -> dirShadowInfo (196-199); CascadedShadowPassGPU overwrites these
    // with real values (at these same, correct offsets) once a shadow-casting
    // directional light is actually rendered this frame.
    const splits = glob.cascadeSplits;
    gData[splits.index] = 0.0; // cascadeSplits.x
    gData[splits.index + 1] = 0.0;
    gData[splits.index + 2] = 0.0;
    gData[splits.index + 3] = 0.0;

    // dirShadowInfo (bias, normalBias, castShadow, numCascades)
    const dirInfo = glob.dirShadowInfo;
    gData[dirInfo.index] = 0.001;
    gData[dirInfo.index + 1] = 0.002;
    gData[dirInfo.index + 2] = 0.0; // castShadow off by default
    gData[dirInfo.index + 3] = 4.0;

    gData[glob.cameraNearFar.index] = near;
    gData[glob.cameraNearFar.index + 1] = far;

    // Clustered light culling metadata (see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md).
    // resolution/tileSizePx/clusterDims must exactly match what ClusterCullPassGPU used to build
    // pointClusterGrid/spotClusterGrid this frame -- see setSize()/_allocateClusterBuffers().
    gData[glob.resolution.index] = this._host.gpuCanvasContext.canvas.width;
    gData[glob.resolution.index + 1] = this._host.gpuCanvasContext.canvas.height;
    // No projMatrix = orthographic / offscreen-reflection render (callers legitimately omit it):
    // projScale is then the documented neutral 1.0 (the cluster/HZB footprint math has no
    // perspective to undo). A *present* but malformed matrix already threw above.
    gData[glob.projScale.index] = projMatrix ? projMatrix[0]! : 1.0;
    gData[glob.projScale.index + 1] = projMatrix ? projMatrix[5]! : 1.0;
    const tileSizePx = this._host.quality.clusteredLighting?.tileSize ?? DEFAULT_CLUSTER_TILE_SIZE;
    gData[glob.tileSizePx.index] = tileSizePx[0];
    gData[glob.tileSizePx.index + 1] = tileSizePx[1];
    gData[glob.clusterDims.index] = this._host.clusterDims.x;
    gData[glob.clusterDims.index + 1] = this._host.clusterDims.y;
    gData[glob.clusterDims.index + 2] = this._host.clusterDims.z;
    gData[glob.clusterDims.index + 3] = this._host.clusterMaxLightsPerCluster;

    // shadowSoftness (WebGPU PCSS tuning): [penumbraScale, pcfMaxRadius, pad, pad].
    // Neutral defaults keep the pre-knob behavior byte-identical: penumbraScale 1.0 reproduces
    // the legacy clamp(1 + delta/bias, 1, 4) exactly, maxPcfRadius 4 the legacy cap. The knobs
    // only take effect when an author overrides them via `quality` (ADR 0035 override-lock);
    // CascadedShadowPassGPU's wedge re-upload never touches this range (it ends at dirShadowInfo).
    const soft = glob.shadowSoftness;
    gData[soft.index] = this._host.quality.shadowSoftness ?? 1.0;
    gData[soft.index + 1] = this._host.quality.shadowMaxPcfRadius ?? 4.0;
    gData[soft.index + 2] = 0.0;
    gData[soft.index + 3] = 0.0;

    // evsmParams (WebGPU EVSM tuning, ADR 0007): x = mode flag (1 only when the author opted in,
    // so the default stays byte-identical PCSS), y = dynamic variance floor, z = light-bleeding
    // reduction, w = reserved. See the EVSM_VARIANCE_FLOOR/EVSM_LIGHT_BLEED constants above.
    const evsm = glob.evsmParams;
    gData[evsm.index] = this._host.quality.shadowMode === "evsm" ? 1.0 : 0.0;
    gData[evsm.index + 1] = EVSM_VARIANCE_FLOOR;
    gData[evsm.index + 2] = EVSM_LIGHT_BLEED;
    gData[evsm.index + 3] = 0.0;

    // Default spot shadow values
    for (let i = 0; i < glob.spotShadowInfo.count; i++) {
      gData[glob.spotShadowInfo.index + i * glob.spotShadowInfo.stride] = 0.001; // bias
      gData[glob.spotShadowInfo.index + i * glob.spotShadowInfo.stride + 1] = 0.002; // normalBias
      gData[glob.spotShadowInfo.index + i * glob.spotShadowInfo.stride + 2] = 0.0; // castShadow off
      gData[glob.spotShadowInfo.index + i * glob.spotShadowInfo.stride + 3] = -1.0; // layer index (-1 = no shadow)
    }

    const device = this._host.gpuDevice!;
    device.queue.writeBuffer(this._globalUniformBuffer, 0, gData);

    const plDataSize = Math.max(lights.pLights.length * POINT_LIGHT_FLOATS, POINT_LIGHT_FLOATS);
    if (this._scratchPointLightData.length < plDataSize) {
      this._scratchPointLightData = new Float32Array(plDataSize);
    }
    const plData = this._scratchPointLightData;
    for (let i = 0; i < lights.pLights.length; i++) {
      const l = lights.pLights[i]!;
      const d = l.worldMatrix.data;
      const o = i * POINT_LIGHT_FLOATS;
      setVec4(plData, o, d[12]!, d[13]!, d[14]!, l.distance);
      setVec4(
        plData,
        o + 4,
        l.color.r * l.intensity,
        l.color.g * l.intensity,
        l.color.b * l.intensity,
        l.decay,
      );
    }
    device.queue.writeBuffer(this._pointLightBuffer, 0, plData.subarray(0, plDataSize));

    const slDataSize = Math.max(lights.sLights.length * SPOT_LIGHT_FLOATS, SPOT_LIGHT_FLOATS);
    if (this._scratchSpotLightData.length < slDataSize) {
      this._scratchSpotLightData = new Float32Array(slDataSize);
    }
    const slData = this._scratchSpotLightData;
    for (let i = 0; i < lights.sLights.length; i++) {
      const l = lights.sLights[i]!;
      const d = l.worldMatrix.data;
      const o = i * SPOT_LIGHT_FLOATS;
      setVec4(slData, o, d[12]!, d[13]!, d[14]!, 1);
      const dir = MathPool.acquireVector().copyFrom(l.direction).normalize();
      setVec4(slData, o + 4, dir.x, dir.y, dir.z, 0);
      setVec4(
        slData,
        o + 8,
        l.color.r * l.intensity,
        l.color.g * l.intensity,
        l.color.b * l.intensity,
        1,
      );
      setVec4(
        slData,
        o + 12,
        Math.cos(l.angle),
        Math.cos(l.angle * (1.0 - l.penumbra)),
        l.distance,
        l.decay,
      );
      MathPool.releaseVector(dir);
    }
    device.queue.writeBuffer(this._spotLightBuffer, 0, slData.subarray(0, slDataSize));

    const alDataSize = Math.max(lights.aLights.length * AREA_LIGHT_FLOATS, AREA_LIGHT_FLOATS);
    if (this._scratchAreaLightData.length < alDataSize) {
      this._scratchAreaLightData = new Float32Array(alDataSize);
    }
    const alData = this._scratchAreaLightData;
    for (let i = 0; i < lights.aLights.length; i++) {
      const l = lights.aLights[i]!;
      const m = l.worldMatrix.data;
      const off = i * AREA_LIGHT_FLOATS;
      setVec4(alData, off, m[12]!, m[13]!, m[14]!, 1);
      setVec4(
        alData,
        off + 4,
        l.color.r * l.intensity,
        l.color.g * l.intensity,
        l.color.b * l.intensity,
        1,
      );
      setVec4(alData, off + 8, m[0]!, m[1]!, m[2]!, 0);
      setVec4(alData, off + 12, m[4]!, m[5]!, m[6]!, 0);
      setVec4(alData, off + 16, m[8]!, m[9]!, m[10]!, 0);
      setVec4(alData, off + 20, l.width / 2, l.height / 2, l.distance, l.decay);
    }
    device.queue.writeBuffer(this._areaLightBuffer, 0, alData.subarray(0, alDataSize));
  }

  public dispose(): void {
    this._globalUniformBuffer?.destroy();
    this._pointLightBuffer?.destroy();
    this._spotLightBuffer?.destroy();
    this._areaLightBuffer?.destroy();
  }
}
