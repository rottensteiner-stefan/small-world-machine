import FULLSCREEN_VERT_WGSL from "../post/shaders/PostProcess.vert.wgsl?raw";
import POST_PROCESS_FRAG_WGSL from "../post/shaders/PostProcess.frag.wgsl?raw";
import { Scene } from "../../core/index.js";
import { WebGPURenderer } from "../WebGPU/index.js";
import { RenderPass } from "../index.js";
import { Vector3D } from "../../math/index.js";
import {
  PostProcessingEffectType,
  TextureFilter,
  TextureWrap,
  Topology,
} from "../../enums/index.js";
import { ShaderRegistry } from "../shaders/index.js";

/**
 * Full-screen post-processing pass (Uber-Shader).
 * Reads the HDR render texture and writes tone-mapped, gamma-corrected output
 * directly to the swap-chain (canvas). No intermediate ping-pong copies.
 *
 * ── Forward-Pass / Post-Pass tonemapping contract ────────────────────────────────────────────
 * The WebGPU forward pass deliberately sets global.gamma = 1.0 and global.exposure = 1.0 when
 * PostProcessing is enabled. This disables the Reinhard guard inside lighting_pbr.wgsl so that
 * the forward pass writes raw linear-HDR values into the render target — tonemapping and exposure
 * are owned exclusively by this PostProcess pass.
 *
 * Consequence: if no ToneMappingElement is configured, this pass MUST still apply a tonemapper.
 * Without one the output is raw HDR × exposure = no tone curve = visibly dark / flat scene.
 * The u_toneMappingMode injection in _buildPipeline() defaults to Reinhard (1) to ensure this.
 *
 * ⚠️  Never add Reinhard or ACES to a WebGPU forward-pass shader without checking whether
 *     PostProcessing is active. If it is, the forward pass must NOT tonemap (double-tonemapping
 *     produces a systematically darker scene). See WebGPURenderer.ts for where gamma/exposure
 *     are set to 1.0 and the full explanation of the two-pass pipeline.
 */
export class PostProcessPass implements RenderPass {
  public name = "PostProcessPass";

  private _pipeline?: GPURenderPipeline;
  private _bindGroup?: GPUBindGroup;
  private _uniformBuffer?: GPUBuffer;
  private _sampler?: GPUSampler;
  /** 52 floats (208 bytes): DynUniforms in PostProcess.frag.wgsl -- time + the continuous tuning
   * parameters (incl. color grading, gravitational lensing, flash & light shafts), packed as 13x vec4f. */
  private _uniformData: Float32Array = new Float32Array(52);
  private _builtTextureView?: GPUTextureView;
  private _builtBloomTextureView?: GPUTextureView;
  private _builtHbaoTextureView?: GPUTextureView;
  private _builtShaftsTextureView?: GPUTextureView;
  private _builtVolumetricFogTextureView?: GPUTextureView;
  private _compiledSignature?: string;

  private _getSignature(group: import("../post/index.js").PostProcessingGroup): string {
    const tm = group.get<import("../post/index.js").ToneMappingElement>(
      PostProcessingEffectType.TONE_MAPPING,
    );
    const vig = group.get<import("../post/index.js").VignetteElement>(
      PostProcessingEffectType.VIGNETTE,
    );
    const grain = group.get<import("../post/index.js").GrainElement>(
      PostProcessingEffectType.GRAIN,
    );
    const bloom = group.get<import("../post/index.js").BloomElement>(
      PostProcessingEffectType.BLOOM,
    );
    const grade = group.get<import("../post/index.js").ColorGradingElement>(
      PostProcessingEffectType.COLOR_GRADING,
    );
    const quant = group.get<import("../post/index.js").QuantizeElement>(
      PostProcessingEffectType.QUANTIZE,
    );
    const hbao = group.get<import("../post/index.js").HbaoElement>(PostProcessingEffectType.HBAO);
    const shafts = group.get<import("../post/index.js").LightShaftsElement>(
      PostProcessingEffectType.LIGHT_SHAFTS,
    );
    const volFog = group.get<import("../post/index.js").VolumetricFogElement>(
      PostProcessingEffectType.VOLUMETRIC_FOG,
    );
    const outline = group.get<import("../post/index.js").OutlineElement>(
      PostProcessingEffectType.OUTLINE,
    );
    const flash = group.get<import("../post/index.js").FlashElement>(
      PostProcessingEffectType.FLASH,
    );

    // Only structural flags/modes -- these gate real WGSL code paths (branch taken, sample
    // count) and require a shader rebuild. Continuous tuning values (exposure, vignette
    // offset/darkness/roundness, grain intensity, bloom intensity/color, grading
    // contrast/saturation/temperature/tint/lift/gamma/gain, quantize steps, outline
    // thickness/sensitivity/color, flash color/intensity) live in the per-frame DynUniforms
    // buffer instead (see execute()) and deliberately do NOT appear here -- tuning them must
    // never rebuild.
    return [
      group.filterMode,
      tm && tm.enabled ? 1 : 0,
      tm && tm.enabled ? tm.mode : 0,
      vig && vig.enabled ? 1 : 0,
      grain && grain.enabled ? 1 : 0,
      bloom && bloom.enabled ? 1 : 0,
      grade && grade.enabled ? 1 : 0,
      quant && quant.enabled ? 1 : 0,
      hbao && hbao.enabled ? 1 : 0,
      shafts && shafts.enabled ? 1 : 0,
      volFog && volFog.enabled ? 1 : 0,
      outline && outline.enabled ? 1 : 0,
      flash && flash.enabled ? 1 : 0,
    ].join("|");
  }

  private _bgl?: GPUBindGroupLayout;
  private _pipelineLayout?: GPUPipelineLayout;

  private _ensureResources(device: GPUDevice): void {
    this._sampler ??= device.createSampler({
      minFilter: TextureFilter.LINEAR,
      magFilter: TextureFilter.LINEAR,
      addressModeU: TextureWrap.CLAMP_TO_EDGE,
      addressModeV: TextureWrap.CLAMP_TO_EDGE,
    });

    this._uniformBuffer ??= device.createBuffer({
      size: 208, // DynUniforms: 13 x vec4f
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._bgl ??= device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });

    this._pipelineLayout ??= device.createPipelineLayout({ bindGroupLayouts: [this._bgl] });
  }

  /**
   * Lazily compiles or rebuilds the render pipeline when structural shader settings change.
   */
  private _buildPipeline(
    renderer: WebGPURenderer,
    group: import("../post/index.js").PostProcessingGroup,
  ): void {
    const device = renderer.gpuDevice!;
    this._ensureResources(device);

    const vertModule = device.createShaderModule({ code: FULLSCREEN_VERT_WGSL });
    let assembledFrag = ShaderRegistry.instance.assemble(POST_PROCESS_FRAG_WGSL, "wgsl");

    const tm = group.get<import("../post/index.js").ToneMappingElement>(
      PostProcessingEffectType.TONE_MAPPING,
    );
    const vig = group.get<import("../post/index.js").VignetteElement>(
      PostProcessingEffectType.VIGNETTE,
    );
    const grain = group.get<import("../post/index.js").GrainElement>(
      PostProcessingEffectType.GRAIN,
    );
    const bloom = group.get<import("../post/index.js").BloomElement>(
      PostProcessingEffectType.BLOOM,
    );
    const grade = group.get<import("../post/index.js").ColorGradingElement>(
      PostProcessingEffectType.COLOR_GRADING,
    );
    const quant = group.get<import("../post/index.js").QuantizeElement>(
      PostProcessingEffectType.QUANTIZE,
    );
    const hbao = group.get<import("../post/index.js").HbaoElement>(PostProcessingEffectType.HBAO);
    const outline = group.get<import("../post/index.js").OutlineElement>(
      PostProcessingEffectType.OUTLINE,
    );
    const flash = group.get<import("../post/index.js").FlashElement>(
      PostProcessingEffectType.FLASH,
    );
    const shafts = group.get<import("../post/index.js").LightShaftsElement>(
      PostProcessingEffectType.LIGHT_SHAFTS,
    );

    const tmEnabled = tm && tm.enabled;
    const vigEnabled = vig && vig.enabled;
    const grainEnabled = grain && grain.enabled;
    const bloomEnabled = bloom && bloom.enabled;
    const gradeEnabled = grade && grade.enabled;
    const quantEnabled = quant && quant.enabled;
    const hbaoEnabled = hbao && hbao.enabled;
    const shaftsEnabled = shafts && shafts.enabled;
    const outlineEnabled = outline && outline.enabled;
    const flashEnabled = flash && flash.enabled;
    const volFog = group.get<import("../post/index.js").VolumetricFogElement>(
      PostProcessingEffectType.VOLUMETRIC_FOG,
    );
    const volFogEnabled = volFog && volFog.enabled;

    // Inject only STRUCTURAL parameters as WGSL constants -- these gate real code paths (branch
    // taken, sample count), so changing them legitimately needs a rebuild. Continuous tuning
    // values (exposure, vignette/grain/bloom/quantize/outline numeric params) no longer appear
    // here at all -- they're written every frame into DynUniforms instead (see execute()).
    assembledFrag = assembledFrag.replace(
      "const u_toneMappingMode: u32 = 0u;",
      // Default to Reinhard (1) when no ToneMappingElement is configured — matches GL2 which
      // always applies Reinhard unconditionally in the forward pass. Without this fallback,
      // WebGPU PostProcess path with no tonemapper outputs raw HDR * exposure with no tone
      // curve, producing a visibly darker/flat result compared to GL2.
      `const u_toneMappingMode: u32 = ${tmEnabled ? tm!.mode : 1}u;`,
    );
    assembledFrag = assembledFrag.replace(
      "const u_vignetteEnabled: u32 = 0u;",
      `const u_vignetteEnabled: u32 = ${vigEnabled ? 1 : 0}u;`,
    );
    assembledFrag = assembledFrag.replace(
      "const u_grainEnabled: u32 = 0u;",
      `const u_grainEnabled: u32 = ${grainEnabled ? 1 : 0}u;`,
    );
    assembledFrag = assembledFrag.replace(
      "const u_colorGradingEnabled: u32 = 0u;",
      `const u_colorGradingEnabled: u32 = ${gradeEnabled ? 1 : 0}u;`,
    );
    assembledFrag = assembledFrag.replace(
      "const u_bloomEnabled: u32 = 0u;",
      `const u_bloomEnabled: u32 = ${bloomEnabled ? 1 : 0}u;`,
    );
    assembledFrag = assembledFrag.replace(
      "const u_quantizeEnabled: u32 = 0u;",
      `const u_quantizeEnabled: u32 = ${quantEnabled ? 1 : 0}u;`,
    );
    assembledFrag = assembledFrag.replace(
      "const u_hbaoEnabled: u32 = 0u;",
      `const u_hbaoEnabled: u32 = ${hbaoEnabled ? 1 : 0}u;`,
    );
    assembledFrag = assembledFrag.replace(
      "const u_lightShaftsEnabled: u32 = 0u;",
      `const u_lightShaftsEnabled: u32 = ${shaftsEnabled ? 1 : 0}u;`,
    );
    assembledFrag = assembledFrag.replace(
      "const u_volumetricFogEnabled: u32 = 0u;",
      `const u_volumetricFogEnabled: u32 = ${volFogEnabled ? 1 : 0}u;`,
    );
    assembledFrag = assembledFrag.replace(
      "const u_outlineEnabled: u32 = 0u;",
      `const u_outlineEnabled: u32 = ${outlineEnabled ? 1 : 0}u;`,
    );
    assembledFrag = assembledFrag.replace(
      "const u_flashEnabled: u32 = 0u;",
      `const u_flashEnabled: u32 = ${flashEnabled ? 1 : 0}u;`,
    );
    assembledFrag = assembledFrag.replace(
      "const u_filterMode: u32 = 0u;",
      `const u_filterMode: u32 = ${group.filterMode}u;`,
    );

    const fragModule = device.createShaderModule({ code: assembledFrag });

    this._pipeline = device.createRenderPipeline({
      layout: this._pipelineLayout!,
      vertex: { module: vertModule, entryPoint: "vs_main" },
      fragment: {
        module: fragModule,
        entryPoint: "fs_main",
        targets: [{ format: renderer.gpuFormat }],
      },
      primitive: { topology: Topology.TRIANGLE_LIST },
    });
  }

  /**
   * Lazily re-creates the bind group when any of the bound texture views change.
   */
  private _buildBindGroup(
    renderer: WebGPURenderer,
    colorView: GPUTextureView,
    bloomActiveView: GPUTextureView,
    hbaoActiveView: GPUTextureView,
    shaftsActiveView: GPUTextureView,
    volumetricFogActiveView: GPUTextureView,
  ): void {
    const device = renderer.gpuDevice!;
    this._ensureResources(device);

    this._bindGroup = device.createBindGroup({
      layout: this._bgl!,
      entries: [
        { binding: 0, resource: this._sampler! },
        { binding: 1, resource: colorView },
        { binding: 2, resource: { buffer: this._uniformBuffer! } },
        { binding: 3, resource: bloomActiveView },
        { binding: 4, resource: hbaoActiveView },
        { binding: 5, resource: shaftsActiveView },
        { binding: 6, resource: volumetricFogActiveView },
      ],
    });
  }

  public execute(
    renderer: WebGPURenderer,
    _scene: Scene,
    ce: GPUCommandEncoder,
    _targetView: GPUTextureView,
    _vp: Float32Array,
    _camPos: Vector3D,
  ): void {
    const group = renderer.postProcessing;
    if (!group.enabled || !renderer.hdrTextureView) return;

    // If TAA and/or Motion Trail resolved this frame, the uber pass reacts to that instead of
    // the raw per-frame color -- `_hdrTextureView` itself must stay untouched so both keep
    // reading fresh input next frame (see WebGPURenderer.render()).
    const colorView =
      renderer.motionTrailResolvedView ?? renderer.taaResolvedView ?? renderer.hdrTextureView;

    const bloom = group.get<import("../post/index.js").BloomElement>(
      PostProcessingEffectType.BLOOM,
    );
    const bloomActiveView =
      bloom && bloom.enabled && renderer.bloomTextureView
        ? renderer.bloomTextureView
        : renderer.whiteTextureView;

    const hbao = group.get<import("../post/index.js").HbaoElement>(PostProcessingEffectType.HBAO);
    const hbaoActiveView =
      hbao && hbao.enabled && renderer.hbaoTextureView
        ? renderer.hbaoTextureView
        : renderer.whiteTextureView;

    const shafts = group.get<import("../post/index.js").LightShaftsElement>(
      PostProcessingEffectType.LIGHT_SHAFTS,
    );
    const shaftsActiveView =
      shafts && shafts.enabled && renderer.lightShaftsTextureView
        ? renderer.lightShaftsTextureView
        : renderer.whiteTextureView;

    const volFog = group.get<import("../post/index.js").VolumetricFogElement>(
      PostProcessingEffectType.VOLUMETRIC_FOG,
    );
    const volFogActiveView =
      volFog && volFog.enabled && renderer.volumetricFogTextureView
        ? renderer.volumetricFogTextureView
        : renderer.whiteTextureView;

    const sig = this._getSignature(group);

    // Rebuild pipeline ONLY if the structural shader signature changed
    if (!this._pipeline || sig !== this._compiledSignature) {
      this._buildPipeline(renderer, group);
      this._compiledSignature = sig;
    }

    // Rebuild bind group ONLY if the bound texture views changed
    if (
      !this._bindGroup ||
      this._builtTextureView !== colorView ||
      this._builtBloomTextureView !== bloomActiveView ||
      this._builtHbaoTextureView !== hbaoActiveView ||
      this._builtShaftsTextureView !== shaftsActiveView ||
      this._builtVolumetricFogTextureView !== volFogActiveView
    ) {
      this._buildBindGroup(
        renderer,
        colorView,
        bloomActiveView,
        hbaoActiveView,
        shaftsActiveView,
        volFogActiveView,
      );
      this._builtTextureView = colorView;
      this._builtBloomTextureView = bloomActiveView;
      this._builtHbaoTextureView = hbaoActiveView;
      this._builtShaftsTextureView = shaftsActiveView;
      this._builtVolumetricFogTextureView = volFogActiveView;
    }

    // Write the continuous tuning values every frame, independent of the rebuild guard above --
    // this is the whole point: moving a slider never touches the pipeline. Matches DynUniforms'
    // layout in PostProcess.frag.wgsl exactly (5x vec4f, index comments below give the offset).
    const tm = group.get<import("../post/index.js").ToneMappingElement>(
      PostProcessingEffectType.TONE_MAPPING,
    );
    const vig = group.get<import("../post/index.js").VignetteElement>(
      PostProcessingEffectType.VIGNETTE,
    );
    const grain = group.get<import("../post/index.js").GrainElement>(
      PostProcessingEffectType.GRAIN,
    );
    const grade = group.get<import("../post/index.js").ColorGradingElement>(
      PostProcessingEffectType.COLOR_GRADING,
    );
    const quant = group.get<import("../post/index.js").QuantizeElement>(
      PostProcessingEffectType.QUANTIZE,
    );
    const outline = group.get<import("../post/index.js").OutlineElement>(
      PostProcessingEffectType.OUTLINE,
    );
    const flash = group.get<import("../post/index.js").FlashElement>(
      PostProcessingEffectType.FLASH,
    );

    const d = this._uniformData;
    d[0] = (performance.now() % 100000) / 1000.0; // a.x: time
    d[1] = tm ? tm.exposure : 1.0; // a.y: exposure
    d[2] = tm ? 1.0 / tm.gamma : 1.0; // a.z: inverseGamma
    d[3] = vig ? vig.offset : 0.8; // a.w: vignetteOffset
    d[4] = vig ? vig.darkness : 0.5; // b.x: vignetteDarkness
    d[5] = vig ? vig.roundness : 2.0; // b.y: vignetteRoundness
    d[6] = grain ? grain.intensity : 0.05; // b.z: grainIntensity
    d[7] = bloom ? bloom.intensity : 1.0; // b.w: bloomIntensity
    d[8] = quant ? quant.steps : 8.0; // c.x: quantizeSteps
    d[9] = outline ? outline.thickness : 1.0; // c.y: outlineThickness
    d[10] = outline ? outline.sensitivity : 1.0; // c.z: outlineSensitivity
    d[11] = grade ? grade.gain.b : 1.0; // c.w: gainB
    d[12] = bloom ? bloom.color.r : 1.0; // bloomColor.rgb
    d[13] = bloom ? bloom.color.g : 1.0;
    d[14] = bloom ? bloom.color.b : 1.0;
    d[15] = 0; // pad
    d[16] = outline ? outline.color.r : 0.0; // outlineColor.rgb
    d[17] = outline ? outline.color.g : 0.0;
    d[18] = outline ? outline.color.b : 0.0;
    d[19] = 0; // pad
    d[20] = grade ? grade.contrast : 1.0; // grading0.x: contrast
    d[21] = grade ? grade.saturation : 1.0; // grading0.y: saturation
    d[22] = grade ? grade.temperature : 0.0; // grading0.z: temperature
    d[23] = grade ? grade.tint : 0.0; // grading0.w: tint
    d[24] = grade ? grade.lift.r : 0.0; // grading1.x: liftR
    d[25] = grade ? grade.lift.g : 0.0; // grading1.y: liftG
    d[26] = grade ? grade.lift.b : 0.0; // grading1.z: liftB
    d[27] = grade ? grade.gamma.r : 1.0; // grading1.w: gammaR
    d[28] = grade ? grade.gamma.g : 1.0; // grading2.x: gammaG
    d[29] = grade ? grade.gamma.b : 1.0; // grading2.y: gammaB
    d[30] = grade ? grade.gain.r : 1.0; // grading2.z: gainR
    d[31] = grade ? grade.gain.g : 1.0; // grading2.w: gainG

    const lensing = group.get<import("../post/index.js").GravitationalLensingElement>(
      PostProcessingEffectType.GRAVITATIONAL_LENSING,
    );
    const singPos = lensing ? lensing.singularityScreenPos : group.singularityScreenPos;
    d[32] = singPos.x; // singularityPos.x
    d[33] = singPos.y; // singularityPos.y
    d[34] = singPos.z; // singularityPos.z
    d[35] = lensing ? lensing.eventHorizonRadius : 0.03; // singularityPos.w: eventHorizonRadius
    d[36] = lensing ? lensing.strength : 0.25; // lensingParams.x: strength
    d[37] = lensing ? lensing.spaghettification : 0.15; // lensingParams.y: spaghettification
    d[38] = lensing ? lensing.relativisticBeaming : 1.2; // lensingParams.z: relativisticBeaming
    d[39] = lensing ? lensing.ringGlowIntensity : 2.5; // lensingParams.w: ringGlowIntensity

    d[40] = flash ? flash.color.r : 1.0; // flashParams.x: color.r
    d[41] = flash ? flash.color.g : 1.0; // flashParams.y: color.g
    d[42] = flash ? flash.color.b : 1.0; // flashParams.z: color.b
    d[43] = flash ? flash.intensity : 0.0; // flashParams.w: intensity

    d[44] = shafts ? shafts.intensity : 1.0; // shaftsParams.x: intensity
    d[45] = shafts ? shafts.density : 0.05; // shaftsParams.y: density
    d[46] = 0;
    d[47] = 0;
    d[48] = shafts ? shafts.color.r : 1.0; // shaftsColor.r
    d[49] = shafts ? shafts.color.g : 1.0; // shaftsColor.g
    d[50] = shafts ? shafts.color.b : 1.0; // shaftsColor.b
    d[51] = 1.0;

    renderer.gpuDevice!.queue.writeBuffer(this._uniformBuffer!, 0, d);

    // Final blit directly to the swap-chain (canvas)
    const screenView = renderer.gpuCanvasContext.getCurrentTexture().createView();
    const rp = ce.beginRenderPass({
      colorAttachments: [
        {
          view: screenView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
        },
      ],
    });

    rp.setPipeline(this._pipeline!);
    rp.setBindGroup(0, this._bindGroup!);
    // No vertex buffer needed: vertex position is generated from vertex_index
    rp.draw(3);
    rp.end();
  }

  public destroy(): void {
    this._uniformBuffer?.destroy();
  }
}
