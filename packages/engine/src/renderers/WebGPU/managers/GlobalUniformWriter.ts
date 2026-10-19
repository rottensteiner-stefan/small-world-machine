import type { WebGPURenderer } from "../WebGPURenderer.js";
import { VIEW_SLOT_MAIN_CAMERA } from "../WebGPURenderer.js";
import { WebGPUGGlobalUniformLayout } from "../../GlobalUniformLayout.js";
import type { CubeTexture, Scene, Texture } from "../../../core/index.js";
import { MAX_CLUSTERED_LIGHTS_PER_TYPE } from "../../../core/index.js";
import type { LightDataInterface } from "../../../interfaces/index.js";
import type { Vector3D } from "../../../math/index.js";
import { DEFAULT_CLUSTER_TILE_SIZE, MathPool, Matrix4 } from "../../../math/index.js";

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

  // 212 floats: GlobalUniforms grew by 8 floats (resolution/projScale/tileSizePx/clusterDims)
  // for clustered light culling -- see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md.
  private _scratchGlobalBufferData = new Float32Array(212);
  private _scratchPointLightData = new Float32Array(32); // Initial capacity, grows dynamically
  private _scratchSpotLightData = new Float32Array(64); // Initial capacity, grows dynamically
  private _scratchAreaLightData = new Float32Array(96); // Initial capacity, grows dynamically

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
      // 848 bytes: GlobalUniforms grew by 40 bytes (resolution/projScale/tileSizePx/clusterDims)
      // for clustered light culling -- see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md.
      size: 848,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._pointLightBuffer = device.createBuffer({
      size: 2048,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this._spotLightBuffer = device.createBuffer({
      size: 4096,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this._areaLightBuffer = device.createBuffer({
      size: 4096,
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
    if (lights.aLights.length > 42) {
      throw new Error(
        `[WebGPURenderer] Area light count exceeds limit of 42: ${lights.aLights.length}`,
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
    gData.set([camPos.x, camPos.y, camPos.z, 1], glob.viewPos.index);
    // Slot 0 = main camera in the per-draw view buffer (group 3) -- kept correct here, once per
    // frame, independent of whatever CascadedShadowPassGPU/SpotShadowPassGPU write into their own
    // slots afterward. See VIEW_SLOT_MAIN_CAMERA.
    this._host._writeViewSlot(VIEW_SLOT_MAIN_CAMERA, correctedVp.data);

    MathPool.releaseMatrix(originalVp);
    MathPool.releaseMatrix(correctedVp);
    gData.set(
      [
        lights.aCol.r * lights.aIntensity,
        lights.aCol.g * lights.aIntensity,
        lights.aCol.b * lights.aIntensity,
        1,
      ],
      glob.ambientColor.index,
    );
    gData.set(
      [
        lights.dCol.r * lights.dIntensity,
        lights.dCol.g * lights.dIntensity,
        lights.dCol.b * lights.dIntensity,
        1,
      ],
      glob.dirLightColor.index,
    );
    // Fix: lights.dDir is already negated to point TO the light in applyTo.
    gData.set([lights.dDir.x, lights.dDir.y, lights.dDir.z, 0], glob.dirLightDir.index);
    // ── Forward-Pass / Post-Pass tonemapping contract ──────────────────────────────────────────
    // When PostProcessing is enabled the WebGPU pipeline is split into two passes:
    //   1. Forward pass  – renders the scene into an HDR render-target (linear, NOT tonemapped).
    //                      gamma=1.0 disables the Reinhard guard in lighting_pbr.wgsl so that
    //                      no tonemapping happens here. exposure=1.0 because the PostPass applies
    //                      scene exposure itself via ToneMappingElement.
    //   2. PostProcess pass – composites bloom/AO/etc., applies exposure, tonemap, and gamma.
    //                         PostProcessPass.ts defaults to Reinhard when no ToneMappingElement
    //                         is configured (see the u_toneMappingMode injection there).
    //
    // ⚠️  If you add tonemapping or gamma correction to the forward pass and PostProcessing is
    //     enabled, you will double-tonemap: once here and once in the PostProcess pass.
    //     This produces a visibly darker/flat scene (the symptom that triggered this comment).
    //
    // When PostProcessing is DISABLED, gamma and exposure come from _quality (default 2.2 / 1.0),
    // the forward shader's gamma guard fires, and Reinhard + linearToSRGB run directly in the
    // forward pass as a lightweight single-pass pipeline — no HDR buffer, no PostPass.
    const gamma = this._host.postProcessing.enabled ? 1.0 : (this._host.quality.gamma ?? 2.2);
    const exposure = this._host.postProcessing.enabled ? 1.0 : (this._host.quality.exposure ?? 1.0);
    gData.set(
      [lights.pLights.length, lights.sLights.length, lights.aLights.length, gamma],
      glob.numPointLights.index,
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
      gData.set([fog.color.r, fog.color.g, fog.color.b, 1.0], glob.fogColor.index);
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
    gData[glob.projScale.index] = projMatrix?.[0] ?? 1.0;
    gData[glob.projScale.index + 1] = projMatrix?.[5] ?? 1.0;
    const tileSizePx = this._host.quality.clusteredLighting?.tileSize ?? DEFAULT_CLUSTER_TILE_SIZE;
    gData[glob.tileSizePx.index] = tileSizePx[0];
    gData[glob.tileSizePx.index + 1] = tileSizePx[1];
    gData[glob.clusterDims.index] = this._host.clusterDims.x;
    gData[glob.clusterDims.index + 1] = this._host.clusterDims.y;
    gData[glob.clusterDims.index + 2] = this._host.clusterDims.z;
    gData[glob.clusterDims.index + 3] = this._host.clusterMaxLightsPerCluster;

    // Default spot shadow values
    for (let i = 0; i < glob.spotShadowInfo.count; i++) {
      gData[glob.spotShadowInfo.index + i * glob.spotShadowInfo.stride] = 0.001; // bias
      gData[glob.spotShadowInfo.index + i * glob.spotShadowInfo.stride + 1] = 0.002; // normalBias
      gData[glob.spotShadowInfo.index + i * glob.spotShadowInfo.stride + 2] = 0.0; // castShadow off
      gData[glob.spotShadowInfo.index + i * glob.spotShadowInfo.stride + 3] = -1.0; // layer index (-1 = no shadow)
    }

    const device = this._host.gpuDevice!;
    device.queue.writeBuffer(this._globalUniformBuffer, 0, gData);

    const plDataSize = Math.max(lights.pLights.length * 8, 8);
    if (this._scratchPointLightData.length < plDataSize) {
      this._scratchPointLightData = new Float32Array(plDataSize);
    }
    const plData = this._scratchPointLightData;
    for (let i = 0; i < lights.pLights.length; i++) {
      const l = lights.pLights[i]!;
      const d = l.worldMatrix.data;
      plData.set([d[12]!, d[13]!, d[14]!, l.distance], i * 8);
      plData.set(
        [l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity, l.decay],
        i * 8 + 4,
      );
    }
    device.queue.writeBuffer(this._pointLightBuffer, 0, plData.subarray(0, plDataSize));

    const slDataSize = Math.max(lights.sLights.length * 16, 16);
    if (this._scratchSpotLightData.length < slDataSize) {
      this._scratchSpotLightData = new Float32Array(slDataSize);
    }
    const slData = this._scratchSpotLightData;
    for (let i = 0; i < lights.sLights.length; i++) {
      const l = lights.sLights[i]!;
      const d = l.worldMatrix.data;
      slData.set([d[12]!, d[13]!, d[14]!, 1], i * 16);
      const dir = MathPool.acquireVector().copyFrom(l.direction).normalize();
      slData.set([dir.x, dir.y, dir.z, 0], i * 16 + 4);
      slData.set(
        [l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity, 1],
        i * 16 + 8,
      );
      slData.set(
        [Math.cos(l.angle), Math.cos(l.angle * (1.0 - l.penumbra)), l.distance, l.decay],
        i * 16 + 12,
      );
      MathPool.releaseVector(dir);
    }
    device.queue.writeBuffer(this._spotLightBuffer, 0, slData.subarray(0, slDataSize));

    const alDataSize = Math.max(lights.aLights.length * 24, 24);
    if (this._scratchAreaLightData.length < alDataSize) {
      this._scratchAreaLightData = new Float32Array(alDataSize);
    }
    const alData = this._scratchAreaLightData;
    for (let i = 0; i < lights.aLights.length; i++) {
      const l = lights.aLights[i]!;
      const m = l.worldMatrix.data;
      const off = i * 24;
      alData.set([m[12]!, m[13]!, m[14]!, 1], off);
      alData.set(
        [l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity, 1],
        off + 4,
      );
      alData.set([m[0]!, m[1]!, m[2]!, 0], off + 8);
      alData.set([m[4]!, m[5]!, m[6]!, 0], off + 12);
      alData.set([m[8]!, m[9]!, m[10]!, 0], off + 16);
      alData.set([l.width / 2, l.height / 2, l.distance, l.decay], off + 20);
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
