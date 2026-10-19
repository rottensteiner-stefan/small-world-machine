import FULLSCREEN_VERT_WGSL from "../post/shaders/PostProcess.vert.wgsl?raw";
import POST_PROCESS_FRAG_WGSL from "../post/shaders/PostProcess.frag.wgsl?raw";
import type { Scene } from "../../core/index.js";
import type { WebGPURenderer } from "../WebGPU/index.js";
import type { RenderPass } from "../index.js";
import type { Vector3D } from "../../math/index.js";
import { TextureFilter, TextureWrap, Topology } from "../../enums/index.js";
import {
  POST_PROCESS_DYNUNIFORM_FLOATS,
  packPostProcessNeutralUniforms,
} from "../post/PostProcessDynUniforms.js";
import type { PostProcessingGroup } from "../post/index.js";
import type { PostEffectBundle } from "../post/PostEffectBundle.js";
import { decodeBundle } from "../post/PostEffectBundle.js";

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
   * parameters (incl. color grading, gravitational lensing, flash & light shafts), packed as 13x vec4f.
   * Elements write their own slices via `packUniforms`; the identity baseline is seeded once. */
  private _uniformData: Float32Array = new Float32Array(POST_PROCESS_DYNUNIFORM_FLOATS);
  private _builtTextureView?: GPUTextureView;
  private _builtBloomTextureView?: GPUTextureView;
  private _builtHbaoTextureView?: GPUTextureView;
  private _builtShaftsTextureView?: GPUTextureView;
  private _builtVolumetricFogTextureView?: GPUTextureView;
  private _compiledSignature?: string;

  constructor() {
    // Identity baseline. The group registers every effect by default, so element slices are
    // overwritten every frame; this only prevents stale data if an element type is absent.
    packPostProcessNeutralUniforms(this._uniformData, 0);
  }

  private _computeSignature(filterMode: number, e: PostEffectBundle): string {
    // Only structural flags/modes -- these gate real WGSL code paths (branch taken, sample
    // count) and require a shader rebuild. Continuous tuning values (exposure, vignette
    // offset/darkness/roundness, grain intensity, bloom intensity/color, grading
    // contrast/saturation/temperature/tint/lift/gamma/gain, quantize steps, outline
    // thickness/sensitivity/color, flash color/intensity) live in the per-frame DynUniforms
    // buffer instead (see execute()) and deliberately do NOT appear here -- tuning them must
    // never rebuild. The element's structuralKey() owns what forces a rebuild.
    return [
      filterMode,
      e.tm ? e.tm.structuralKey() : "0|0",
      e.vig ? e.vig.structuralKey() : "0",
      e.grain ? e.grain.structuralKey() : "0",
      e.bloom ? e.bloom.structuralKey() : "0",
      e.grade ? e.grade.structuralKey() : "0",
      e.quant ? e.quant.structuralKey() : "0",
      e.hbao ? e.hbao.structuralKey() : "0",
      e.shafts ? e.shafts.structuralKey() : "0",
      e.volFog ? e.volFog.structuralKey() : "0",
      e.outline ? e.outline.structuralKey() : "0",
      e.flash ? e.flash.structuralKey() : "0",
    ].join("|");
  }

  /** Replaces a WGSL compile-time constant, failing loudly instead of silently becoming a no-op
   * when the PostProcess.frag.wgsl source drifts from what the pass expects. */
  private _replaceConst(code: string, pattern: string, replacement: string): string {
    if (!code.includes(pattern)) {
      throw new Error(
        `PostProcessPass: WGSL constant '${pattern}' not found in PostProcess.frag.wgsl -- the shader drifted from the pass; update one or the other.`,
      );
    }
    return code.replace(pattern, replacement);
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
    group: PostProcessingGroup,
    e: PostEffectBundle,
  ): void {
    const device = renderer.gpuDevice!;
    this._ensureResources(device);

    const vertModule = device.createShaderModule({ code: FULLSCREEN_VERT_WGSL });
    let assembledFrag = renderer.context.shaderRegistry.assemble(POST_PROCESS_FRAG_WGSL, "wgsl");

    const tmEnabled = e.tm && e.tm.enabled;
    const vigEnabled = e.vig && e.vig.enabled;
    const grainEnabled = e.grain && e.grain.enabled;
    const bloomEnabled = e.bloom && e.bloom.enabled;
    const gradeEnabled = e.grade && e.grade.enabled;
    const quantEnabled = e.quant && e.quant.enabled;
    const hbaoEnabled = e.hbao && e.hbao.enabled;
    const shaftsEnabled = e.shafts && e.shafts.enabled;
    const outlineEnabled = e.outline && e.outline.enabled;
    const flashEnabled = e.flash && e.flash.enabled;
    const volFogEnabled = e.volFog && e.volFog.enabled;

    // Inject only STRUCTURAL parameters as WGSL constants -- these gate real code paths (branch
    // taken, sample count), so changing them legitimately needs a rebuild. Continuous tuning
    // values (exposure, vignette/grain/bloom/quantize/outline numeric params) no longer appear
    // here at all -- they're written every frame into DynUniforms instead (see execute()).
    // _replaceConst() throws when the WGSL no longer contains the constant, so a shader edit
    // can never silently disable an effect. The table keeps the injected strings byte-identical
    // to the former sequential calls.
    const constInjections: [string, string][] = [
      // Default to Reinhard (1) when no ToneMappingElement is configured -- matches GL2 which
      // always applies Reinhard unconditionally in the forward pass. Without this fallback,
      // WebGPU PostProcess path with no tonemapper outputs raw HDR * exposure with no tone
      // curve, producing a visibly darker/flat result compared to GL2.
      [
        "const u_toneMappingMode: u32 = 0u;",
        `const u_toneMappingMode: u32 = ${tmEnabled ? e.tm!.mode : 1}u;`,
      ],
      [
        "const u_vignetteEnabled: u32 = 0u;",
        `const u_vignetteEnabled: u32 = ${vigEnabled ? 1 : 0}u;`,
      ],
      ["const u_grainEnabled: u32 = 0u;", `const u_grainEnabled: u32 = ${grainEnabled ? 1 : 0}u;`],
      [
        "const u_colorGradingEnabled: u32 = 0u;",
        `const u_colorGradingEnabled: u32 = ${gradeEnabled ? 1 : 0}u;`,
      ],
      ["const u_bloomEnabled: u32 = 0u;", `const u_bloomEnabled: u32 = ${bloomEnabled ? 1 : 0}u;`],
      [
        "const u_quantizeEnabled: u32 = 0u;",
        `const u_quantizeEnabled: u32 = ${quantEnabled ? 1 : 0}u;`,
      ],
      ["const u_hbaoEnabled: u32 = 0u;", `const u_hbaoEnabled: u32 = ${hbaoEnabled ? 1 : 0}u;`],
      [
        "const u_lightShaftsEnabled: u32 = 0u;",
        `const u_lightShaftsEnabled: u32 = ${shaftsEnabled ? 1 : 0}u;`,
      ],
      [
        "const u_volumetricFogEnabled: u32 = 0u;",
        `const u_volumetricFogEnabled: u32 = ${volFogEnabled ? 1 : 0}u;`,
      ],
      [
        "const u_outlineEnabled: u32 = 0u;",
        `const u_outlineEnabled: u32 = ${outlineEnabled ? 1 : 0}u;`,
      ],
      ["const u_flashEnabled: u32 = 0u;", `const u_flashEnabled: u32 = ${flashEnabled ? 1 : 0}u;`],
      ["const u_filterMode: u32 = 0u;", `const u_filterMode: u32 = ${group.filterMode}u;`],
    ];
    for (const [pattern, replacement] of constInjections) {
      assembledFrag = this._replaceConst(assembledFrag, pattern, replacement);
    }

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

  /**
   * Selects the texture view the uber pass samples for an effect: the effect's resolved view when
   * the effect is enabled AND produced one this frame, else the neutral pass-through white fallback
   * (an inactive effect must not tint the output -- same convention as the GL2 uber pass family).
   */
  private _activeViewOrWhite(
    renderer: WebGPURenderer,
    elem: { readonly enabled: boolean } | undefined,
    view: GPUTextureView | undefined,
  ): GPUTextureView {
    return elem?.enabled && view ? view : renderer.whiteTextureView;
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

    // Resolve the effect bundle exactly once per frame -- texture selection, the structural
    // rebuild signature and the DynUniforms packing all read from the same decoded references
    // (the group used to be asked separately ~34x per frame).
    const e = decodeBundle(group);

    // If TAA, Motion Trail and/or depth of field resolved this frame, the uber pass reacts to that instead of
    // the raw per-frame color -- `_hdrTextureView` itself must stay untouched so both keep
    // reading fresh input next frame (see WebGPURenderer.render()).
    const colorView =
      renderer.depthOfFieldResolvedView ??
      renderer.motionTrailResolvedView ??
      renderer.taaResolvedView ??
      renderer.hdrTextureView;

    const bloomActiveView = this._activeViewOrWhite(renderer, e.bloom, renderer.bloomTextureView);
    const hbaoActiveView = this._activeViewOrWhite(renderer, e.hbao, renderer.hbaoTextureView);
    const shaftsActiveView = this._activeViewOrWhite(
      renderer,
      e.shafts,
      renderer.lightShaftsTextureView,
    );
    const volFogActiveView = this._activeViewOrWhite(
      renderer,
      e.volFog,
      renderer.volumetricFogTextureView,
    );

    const sig = this._computeSignature(group.filterMode, e);

    // Rebuild pipeline ONLY if the structural shader signature changed
    if (!this._pipeline || sig !== this._compiledSignature) {
      this._buildPipeline(renderer, group, e);
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
    // this is the whole point: moving a slider never touches the pipeline. Every effect that
    // feeds the DynUniforms block owns its slice and packs it itself via packUniforms(), so no
    // per-slot `group.get` remains here (the bundle above is the single decode).
    const d = this._uniformData;
    d[0] = renderer.frameInfo.realTime % 100.0; // a.x: time (real time: effects like grain must not freeze in hit-stop)
    e.tm?.packUniforms?.(d, 0);
    e.vig?.packUniforms?.(d, 0);
    e.grain?.packUniforms?.(d, 0);
    e.bloom?.packUniforms?.(d, 0);
    e.quant?.packUniforms?.(d, 0);
    e.outline?.packUniforms?.(d, 0);
    e.grade?.packUniforms?.(d, 0);
    e.lensing?.packUniforms?.(d, 0);
    e.flash?.packUniforms?.(d, 0);
    e.shafts?.packUniforms?.(d, 0);

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
