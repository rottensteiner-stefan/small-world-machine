import FULLSCREEN_VERT_GLSL from "../shaders/PostProcess.vert.glsl?raw";
import { compileProgram } from "../../compileProgram.js";
import POST_PROCESS_FRAG_GLSL from "../shaders/PostProcess.frag.glsl?raw";

import FULLSCREEN_VERT_GLSL100 from "../shaders/PostProcess100.vert.glsl?raw";
import POST_PROCESS_FRAG_GLSL100 from "../shaders/PostProcess100.frag.glsl?raw";
import { PostProcessingEffectType } from "../../../enums/index.js";
import type { ShaderRegistry } from "../../shaders/index.js";
import type { PostProcessingGroup } from "../PostProcessingGroup.js";
import type {
  BloomElement,
  ColorGradingElement,
  FlashElement,
  GrainElement,
  GravitationalLensingElement,
  HbaoElement,
  LightShaftsElement,
  OutlineElement,
  QuantizeElement,
  ToneMappingElement,
  VignetteElement,
  VolumetricFogElement,
} from "../elements/index.js";
import type { GLPostEffectPassContext } from "./GLPostEffectPass.js";
import { requireGlObject } from "../../gl/requireGlObject.js";

/**
 * Handles post-processing blit for WebGL1 and WebGL2.
 * Reads from the HDR framebuffer texture and writes tone-mapped,
 * gamma-corrected output to the default (canvas) framebuffer.
 */
export class PostProcessPassGL {
  private _prog: WebGLProgram | undefined = undefined;
  private _vao: WebGLVertexArrayObject | undefined = undefined;
  private _vb: WebGLBuffer | undefined = undefined;
  private _uHdrTexture: WebGLUniformLocation | null = null;
  private _uBloomTexture: WebGLUniformLocation | null = null;
  private _uHbaoTexture: WebGLUniformLocation | null = null;
  private _uLightShaftsTexture: WebGLUniformLocation | null = null;
  private _uLightShaftsEnabled: WebGLUniformLocation | null = null;
  private _uLightShaftsIntensity: WebGLUniformLocation | null = null;
  private _uVolumetricFogTexture: WebGLUniformLocation | null = null;
  private _uTime: WebGLUniformLocation | null = null;

  private _uBloomIntensity: WebGLUniformLocation | null = null;
  private _uBloomColor: WebGLUniformLocation | null = null;
  private _uExposure: WebGLUniformLocation | null = null;
  private _uGamma: WebGLUniformLocation | null = null;
  private _uInverseGamma: WebGLUniformLocation | null = null;
  private _uVignetteOffset: WebGLUniformLocation | null = null;
  private _uVignetteDarkness: WebGLUniformLocation | null = null;
  private _uVignetteRoundness: WebGLUniformLocation | null = null;
  private _uGrainIntensity: WebGLUniformLocation | null = null;
  private _uContrast: WebGLUniformLocation | null = null;
  private _uSaturation: WebGLUniformLocation | null = null;
  private _uTemperature: WebGLUniformLocation | null = null;
  private _uTint: WebGLUniformLocation | null = null;
  private _uLiftColor: WebGLUniformLocation | null = null;
  private _uGammaColor: WebGLUniformLocation | null = null;
  private _uGainColor: WebGLUniformLocation | null = null;
  private _uQuantizeSteps: WebGLUniformLocation | null = null;
  private _uOutlineThickness: WebGLUniformLocation | null = null;
  private _uOutlineSensitivity: WebGLUniformLocation | null = null;
  private _uOutlineColor: WebGLUniformLocation | null = null;
  private _uSingularityScreenPos: WebGLUniformLocation | null = null;
  private _uLensingEventHorizon: WebGLUniformLocation | null = null;
  private _uLensingStrength: WebGLUniformLocation | null = null;
  private _uLensingSpaghetti: WebGLUniformLocation | null = null;
  private _uLensingBeaming: WebGLUniformLocation | null = null;
  private _uLensingRingGlow: WebGLUniformLocation | null = null;
  private _uFlashColor: WebGLUniformLocation | null = null;
  private _uFlashIntensity: WebGLUniformLocation | null = null;

  private _aPos: number = -1;
  private readonly _gl: WebGLRenderingContext | WebGL2RenderingContext;
  private readonly _isWebGL2: boolean;
  private _compiledSignature: number | undefined;
  /**
   * Whether this frame's upstream passes actually produced HBAO / light-shafts / fog textures. The
   * matching `#define`s are baked from these (not from `element.enabled` alone): a pass can return
   * no texture (e.g. a sun without shadows), and an enabled define with nothing bound would sample
   * the HDR colour (unit 0) as if it were shafts/fog.
   */
  private _hasHbaoTexture = false;
  private _hasShaftsTexture = false;
  private _hasFogTexture = false;

  private readonly _shaderRegistry: ShaderRegistry;

  constructor(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    isWebGL2: boolean,
    shaderRegistry: ShaderRegistry,
  ) {
    this._gl = gl;
    this._isWebGL2 = isWebGL2;
    this._shaderRegistry = shaderRegistry;
  }

  /**
   * Bit-packed structural signature (no per-frame array / string allocation): bits 0-3 filter
   * mode, 4 tone-map on, 5-8 tone-map mode, 9.. one bit per effect in the order below.
   */
  private _getSignature(group: PostProcessingGroup): number {
    const tm = group.get<ToneMappingElement>(PostProcessingEffectType.TONE_MAPPING);
    const vig = group.get<VignetteElement>(PostProcessingEffectType.VIGNETTE);
    const grain = group.get<GrainElement>(PostProcessingEffectType.GRAIN);
    const bloom = group.get<BloomElement>(PostProcessingEffectType.BLOOM);
    const grade = group.get<ColorGradingElement>(PostProcessingEffectType.COLOR_GRADING);
    const quant = group.get<QuantizeElement>(PostProcessingEffectType.QUANTIZE);
    const hbao = group.get<HbaoElement>(PostProcessingEffectType.HBAO);
    const shafts = group.get<LightShaftsElement>(PostProcessingEffectType.LIGHT_SHAFTS);
    const volFog = group.get<VolumetricFogElement>(PostProcessingEffectType.VOLUMETRIC_FOG);
    const outline = group.get<OutlineElement>(PostProcessingEffectType.OUTLINE);
    const flash = group.get<FlashElement>(PostProcessingEffectType.FLASH);

    // Only structural flags/modes trigger a shader rebuild (matching WebGPU).
    // Continuous tuning values (exposure, gamma, vignette darkness/offset, grain intensity,
    // bloom intensity/color, grading contrast/saturation/temperature/tint/lift/gamma/gain,
    // quantize steps, outline thickness/color, flash color/intensity) are set via uniforms per
    // frame.
    const tmOn = tm !== undefined && tm.enabled;
    return (
      (group.filterMode & 0xf) |
      ((tmOn ? 1 : 0) << 4) |
      (((tmOn ? tm.mode : 0) & 0xf) << 5) |
      ((vig && vig.enabled ? 1 : 0) << 9) |
      ((grain && grain.enabled ? 1 : 0) << 10) |
      ((bloom && bloom.enabled ? 1 : 0) << 11) |
      ((grade && grade.enabled ? 1 : 0) << 12) |
      ((quant && quant.enabled ? 1 : 0) << 13) |
      ((hbao && hbao.enabled && this._hasHbaoTexture ? 1 : 0) << 14) |
      ((shafts && shafts.enabled && this._hasShaftsTexture ? 1 : 0) << 15) |
      ((volFog && volFog.enabled && this._hasFogTexture ? 1 : 0) << 16) |
      ((outline && outline.enabled ? 1 : 0) << 17) |
      ((flash && flash.enabled ? 1 : 0) << 18)
    );
  }

  private _build(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    group: PostProcessingGroup,
  ): void {
    if (this._prog) {
      gl.deleteProgram(this._prog);
      this._prog = undefined;
    }
    if (this._vb) {
      gl.deleteBuffer(this._vb);
      this._vb = undefined;
    }
    if (this._isWebGL2 && this._vao) {
      (gl as WebGL2RenderingContext).deleteVertexArray(this._vao);
      this._vao = undefined;
    }

    const vert = this._isWebGL2 ? FULLSCREEN_VERT_GLSL : FULLSCREEN_VERT_GLSL100;
    const rawFrag = this._isWebGL2 ? POST_PROCESS_FRAG_GLSL : POST_PROCESS_FRAG_GLSL100;
    let frag = this._isWebGL2 ? this._shaderRegistry.assemble(rawFrag, "glsl300") : rawFrag;

    const tm = group.get<ToneMappingElement>(PostProcessingEffectType.TONE_MAPPING);
    const vig = group.get<VignetteElement>(PostProcessingEffectType.VIGNETTE);
    const grain = group.get<GrainElement>(PostProcessingEffectType.GRAIN);
    const bloom = group.get<BloomElement>(PostProcessingEffectType.BLOOM);
    const grade = group.get<ColorGradingElement>(PostProcessingEffectType.COLOR_GRADING);
    const quant = group.get<QuantizeElement>(PostProcessingEffectType.QUANTIZE);
    const hbao = group.get<HbaoElement>(PostProcessingEffectType.HBAO);
    const shafts = group.get<LightShaftsElement>(PostProcessingEffectType.LIGHT_SHAFTS);
    const volFog = group.get<VolumetricFogElement>(PostProcessingEffectType.VOLUMETRIC_FOG);
    const outline = group.get<OutlineElement>(PostProcessingEffectType.OUTLINE);
    const flash = group.get<FlashElement>(PostProcessingEffectType.FLASH);

    const tmEnabled = tm && tm.enabled;
    const vigEnabled = vig && vig.enabled;
    const grainEnabled = grain && grain.enabled;
    const bloomEnabled = bloom && bloom.enabled;
    const gradeEnabled = grade && grade.enabled;
    const quantEnabled = quant && quant.enabled;
    const hbaoEnabled = hbao && hbao.enabled && this._hasHbaoTexture;
    const shaftsEnabled = shafts && shafts.enabled && this._hasShaftsTexture;
    const volFogEnabled = volFog && volFog.enabled && this._hasFogTexture;
    const outlineEnabled = outline && outline.enabled;
    const flashEnabled = flash && flash.enabled;

    // Inject ONLY structural feature flags as compile-time macros
    frag = frag.replace(
      "uniform int u_bloomEnabled;",
      `#define u_bloomEnabled ${bloomEnabled ? 1 : 0}`,
    );
    frag = frag.replace(
      "uniform int u_toneMappingMode;",
      `#define u_toneMappingMode ${tmEnabled ? tm.mode : 1}`,
    );
    frag = frag.replace(
      "uniform int u_vignetteEnabled;",
      `#define u_vignetteEnabled ${vigEnabled ? 1 : 0}`,
    );
    frag = frag.replace(
      "uniform int u_grainEnabled;",
      `#define u_grainEnabled ${grainEnabled ? 1 : 0}`,
    );
    frag = frag.replace(
      "uniform int u_colorGradingEnabled;",
      `#define u_colorGradingEnabled ${gradeEnabled ? 1 : 0}`,
    );
    frag = frag.replace(
      "uniform int u_quantizeEnabled;",
      `#define u_quantizeEnabled ${quantEnabled ? 1 : 0}`,
    );
    frag = frag.replace(
      "uniform int u_hbaoEnabled;",
      `#define u_hbaoEnabled ${hbaoEnabled ? 1 : 0}`,
    );
    frag = frag.replace(
      "uniform int u_lightShaftsEnabled;",
      `#define u_lightShaftsEnabled ${shaftsEnabled ? 1 : 0}`,
    );
    frag = frag.replace(
      "uniform int u_volumetricFogEnabled;",
      `#define u_volumetricFogEnabled ${volFogEnabled ? 1 : 0}`,
    );
    frag = frag.replace(
      "uniform int u_outlineEnabled;",
      `#define u_outlineEnabled ${outlineEnabled ? 1 : 0}`,
    );
    frag = frag.replace(
      "uniform int u_flashEnabled;",
      `#define u_flashEnabled ${flashEnabled ? 1 : 0}`,
    );
    frag = frag.replace("uniform int u_filterMode;", `#define u_filterMode ${group.filterMode}`);

    const p = compileProgram(gl, vert, frag, "PostProcessPassGL");

    this._prog = p;
    this._uHdrTexture = gl.getUniformLocation(p, "u_hdrTexture");
    this._uBloomTexture = gl.getUniformLocation(p, "u_bloomTexture");
    this._uHbaoTexture = gl.getUniformLocation(p, "u_hbaoTexture");
    this._uLightShaftsTexture = gl.getUniformLocation(p, "u_lightShaftsTexture");
    this._uLightShaftsEnabled = gl.getUniformLocation(p, "u_lightShaftsEnabled");
    this._uLightShaftsIntensity = gl.getUniformLocation(p, "u_lightShaftsIntensity");
    this._uVolumetricFogTexture = gl.getUniformLocation(p, "u_volumetricFogTexture");
    this._uTime = gl.getUniformLocation(p, "u_time");

    this._uBloomIntensity = gl.getUniformLocation(p, "u_bloomIntensity");
    this._uBloomColor = gl.getUniformLocation(p, "u_bloomColor");
    this._uExposure = gl.getUniformLocation(p, "u_exposure");
    this._uGamma = gl.getUniformLocation(p, "u_gamma");
    this._uInverseGamma = gl.getUniformLocation(p, "u_inverseGamma");
    this._uVignetteOffset = gl.getUniformLocation(p, "u_vignetteOffset");
    this._uVignetteDarkness = gl.getUniformLocation(p, "u_vignetteDarkness");
    this._uVignetteRoundness = gl.getUniformLocation(p, "u_vignetteRoundness");
    this._uGrainIntensity = gl.getUniformLocation(p, "u_grainIntensity");
    this._uContrast = gl.getUniformLocation(p, "u_contrast");
    this._uSaturation = gl.getUniformLocation(p, "u_saturation");
    this._uTemperature = gl.getUniformLocation(p, "u_temperature");
    this._uTint = gl.getUniformLocation(p, "u_tint");
    this._uLiftColor = gl.getUniformLocation(p, "u_liftColor");
    this._uGammaColor = gl.getUniformLocation(p, "u_gammaColor");
    this._uGainColor = gl.getUniformLocation(p, "u_gainColor");
    this._uQuantizeSteps = gl.getUniformLocation(p, "u_quantizeSteps");
    this._uOutlineThickness = gl.getUniformLocation(p, "u_outlineThickness");
    this._uOutlineSensitivity = gl.getUniformLocation(p, "u_outlineSensitivity");
    this._uOutlineColor = gl.getUniformLocation(p, "u_outlineColor");
    this._uSingularityScreenPos = gl.getUniformLocation(p, "u_singularityScreenPos");
    this._uLensingEventHorizon = gl.getUniformLocation(p, "u_lensingEventHorizon");
    this._uLensingStrength = gl.getUniformLocation(p, "u_lensingStrength");
    this._uLensingSpaghetti = gl.getUniformLocation(p, "u_lensingSpaghetti");
    this._uLensingBeaming = gl.getUniformLocation(p, "u_lensingBeaming");
    this._uLensingRingGlow = gl.getUniformLocation(p, "u_lensingRingGlow");
    this._uFlashColor = gl.getUniformLocation(p, "u_flashColor");
    this._uFlashIntensity = gl.getUniformLocation(p, "u_flashIntensity");

    if (this._isWebGL2) {
      const gl2 = gl as WebGL2RenderingContext;
      this._vao = requireGlObject(gl2.createVertexArray(), "vertex array");
    } else {
      this._aPos = gl.getAttribLocation(p, "a_pos");
      this._vb = requireGlObject(gl.createBuffer(), "buffer");
      gl.bindBuffer(gl.ARRAY_BUFFER, this._vb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
  }

  /**
   * Blits the HDR texture to the canvas framebuffer.
   */
  public execute(ctx: GLPostEffectPassContext): void {
    const gl = ctx.gl;
    const hdrTexture = ctx.colorTexture;
    const group = ctx.group;
    const bloomTexture = ctx.bloomTexture;
    const hbaoTexture = ctx.hbaoTexture;
    const lightShaftsTexture = ctx.lightShaftsTexture;
    const volumetricFogTexture = ctx.volumetricFogTexture;
    const realTime = ctx.realTime;
    this._hasHbaoTexture = Boolean(hbaoTexture);
    this._hasShaftsTexture = Boolean(lightShaftsTexture);
    this._hasFogTexture = Boolean(volumetricFogTexture);
    const sig = this._getSignature(group);
    if (!this._prog || sig !== this._compiledSignature) {
      this._build(gl, group);
      this._compiledSignature = sig;
    }

    if (!this._prog) return;

    gl.useProgram(this._prog);

    // Remember what the geometry passes left enabled so it can be restored below.
    const wasCullFace = gl.isEnabled(gl.CULL_FACE);
    const wasBlend = gl.isEnabled(gl.BLEND);

    // Disable depth testing and writing
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    // HDR texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, hdrTexture);
    gl.uniform1i(this._uHdrTexture, 0);

    // Bloom
    const bloom = group.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom && bloom.enabled && bloomTexture) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, bloomTexture);
      gl.uniform1i(this._uBloomTexture, 1);
    }

    // HBAO
    const hbao = group.get<HbaoElement>(PostProcessingEffectType.HBAO);
    if (hbao && hbao.enabled && hbaoTexture) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, hbaoTexture);
      gl.uniform1i(this._uHbaoTexture, 2);
    }

    // Light Shafts
    const shafts = group.get<LightShaftsElement>(PostProcessingEffectType.LIGHT_SHAFTS);
    if (shafts && shafts.enabled && lightShaftsTexture) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, lightShaftsTexture);
      if (this._uLightShaftsTexture) gl.uniform1i(this._uLightShaftsTexture, 3);
      if (this._uLightShaftsEnabled) gl.uniform1i(this._uLightShaftsEnabled, 1);
      if (this._uLightShaftsIntensity) gl.uniform1f(this._uLightShaftsIntensity, shafts.intensity);
    } else {
      if (this._uLightShaftsEnabled) gl.uniform1i(this._uLightShaftsEnabled, 0);
    }

    // Volumetric Fog
    const volFog = group.get<VolumetricFogElement>(PostProcessingEffectType.VOLUMETRIC_FOG);
    if (volFog && volFog.enabled && volumetricFogTexture) {
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, volumetricFogTexture);
      if (this._uVolumetricFogTexture) gl.uniform1i(this._uVolumetricFogTexture, 4);
    }

    // Continuous Uniform Updates
    const tm = group.get<ToneMappingElement>(PostProcessingEffectType.TONE_MAPPING);
    const vig = group.get<VignetteElement>(PostProcessingEffectType.VIGNETTE);
    const grain = group.get<GrainElement>(PostProcessingEffectType.GRAIN);
    const grade = group.get<ColorGradingElement>(PostProcessingEffectType.COLOR_GRADING);
    const quant = group.get<QuantizeElement>(PostProcessingEffectType.QUANTIZE);
    const outline = group.get<OutlineElement>(PostProcessingEffectType.OUTLINE);
    const flash = group.get<FlashElement>(PostProcessingEffectType.FLASH);

    if (this._uBloomIntensity) gl.uniform1f(this._uBloomIntensity, bloom ? bloom.intensity : 0.0);
    if (this._uBloomColor) {
      if (bloom) gl.uniform3f(this._uBloomColor, bloom.color.r, bloom.color.g, bloom.color.b);
      else gl.uniform3f(this._uBloomColor, 1.0, 1.0, 1.0);
    }
    if (this._uExposure) gl.uniform1f(this._uExposure, tm && tm.enabled ? tm.exposure : 1.0);
    if (this._uGamma) gl.uniform1f(this._uGamma, tm && tm.enabled ? tm.gamma : 2.2);
    if (this._uInverseGamma) {
      gl.uniform1f(this._uInverseGamma, tm && tm.enabled ? 1.0 / tm.gamma : 1.0);
    }
    if (this._uVignetteOffset) gl.uniform1f(this._uVignetteOffset, vig ? vig.offset : 0.8);
    if (this._uVignetteDarkness) gl.uniform1f(this._uVignetteDarkness, vig ? vig.darkness : 0.5);
    if (this._uVignetteRoundness) gl.uniform1f(this._uVignetteRoundness, vig ? vig.roundness : 2.0);
    if (this._uGrainIntensity) gl.uniform1f(this._uGrainIntensity, grain ? grain.intensity : 0.05);
    if (this._uContrast) gl.uniform1f(this._uContrast, grade ? grade.contrast : 1.0);
    if (this._uSaturation) gl.uniform1f(this._uSaturation, grade ? grade.saturation : 1.0);
    if (this._uTemperature) gl.uniform1f(this._uTemperature, grade ? grade.temperature : 0.0);
    if (this._uTint) gl.uniform1f(this._uTint, grade ? grade.tint : 0.0);
    if (this._uLiftColor) {
      if (grade) gl.uniform3f(this._uLiftColor, grade.lift.r, grade.lift.g, grade.lift.b);
      else gl.uniform3f(this._uLiftColor, 0.0, 0.0, 0.0);
    }
    if (this._uGammaColor) {
      if (grade) gl.uniform3f(this._uGammaColor, grade.gamma.r, grade.gamma.g, grade.gamma.b);
      else gl.uniform3f(this._uGammaColor, 1.0, 1.0, 1.0);
    }
    if (this._uGainColor) {
      if (grade) gl.uniform3f(this._uGainColor, grade.gain.r, grade.gain.g, grade.gain.b);
      else gl.uniform3f(this._uGainColor, 1.0, 1.0, 1.0);
    }
    if (this._uQuantizeSteps) gl.uniform1f(this._uQuantizeSteps, quant ? quant.steps : 8.0);
    if (this._uOutlineThickness) {
      gl.uniform1f(this._uOutlineThickness, outline ? outline.thickness : 1.0);
    }
    if (this._uOutlineSensitivity) {
      gl.uniform1f(this._uOutlineSensitivity, outline ? outline.sensitivity : 1.0);
    }
    if (this._uOutlineColor) {
      if (outline)
        gl.uniform3f(this._uOutlineColor, outline.color.r, outline.color.g, outline.color.b);
      else gl.uniform3f(this._uOutlineColor, 0.0, 0.0, 0.0);
    }
    const lensing = group.get<GravitationalLensingElement>(
      PostProcessingEffectType.GRAVITATIONAL_LENSING,
    );
    if (this._uSingularityScreenPos) {
      const pos = lensing ? lensing.singularityScreenPos : group.singularityScreenPos;
      gl.uniform3f(this._uSingularityScreenPos, pos.x, pos.y, pos.z);
    }
    if (this._uLensingEventHorizon) {
      gl.uniform1f(this._uLensingEventHorizon, lensing ? lensing.eventHorizonRadius : 0.03);
    }
    if (this._uLensingStrength) {
      gl.uniform1f(this._uLensingStrength, lensing ? lensing.strength : 0.25);
    }
    if (this._uLensingSpaghetti) {
      gl.uniform1f(this._uLensingSpaghetti, lensing ? lensing.spaghettification : 0.15);
    }
    if (this._uLensingBeaming) {
      gl.uniform1f(this._uLensingBeaming, lensing ? lensing.relativisticBeaming : 1.2);
    }
    if (this._uLensingRingGlow) {
      gl.uniform1f(this._uLensingRingGlow, lensing ? lensing.ringGlowIntensity : 2.5);
    }
    if (this._uFlashColor) {
      if (flash) gl.uniform3f(this._uFlashColor, flash.color.r, flash.color.g, flash.color.b);
      else gl.uniform3f(this._uFlashColor, 1.0, 1.0, 1.0);
    }
    if (this._uFlashIntensity) gl.uniform1f(this._uFlashIntensity, flash ? flash.intensity : 0.0);

    // Blit to the default (canvas) framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    if (this._uTime !== null) {
      gl.uniform1f(this._uTime, realTime % 100.0);
    }

    if (this._isWebGL2) {
      const gl2 = gl as WebGL2RenderingContext;
      gl2.bindVertexArray(this._vao!);
      gl2.drawArrays(gl2.TRIANGLES, 0, 3);
      gl2.bindVertexArray(null);
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, this._vb!);
      gl.enableVertexAttribArray(this._aPos);
      gl.vertexAttribPointer(this._aPos, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disableVertexAttribArray(this._aPos);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    // Restore state
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    if (wasCullFace) gl.enable(gl.CULL_FACE);
    if (wasBlend) gl.enable(gl.BLEND);
    else gl.disable(gl.BLEND);
    gl.useProgram(null);
  }

  /** Releases GPU resources (contract shape: `destroy(): void`, ADR 0037). */
  public destroy(): void {
    const gl = this._gl;
    if (this._prog) gl.deleteProgram(this._prog);
    if (this._vb) gl.deleteBuffer(this._vb);
    if (this._isWebGL2 && this._vao) {
      (gl as WebGL2RenderingContext).deleteVertexArray(this._vao);
    }
    this._prog = undefined;
    this._vb = undefined;
    this._vao = undefined;
    this._compiledSignature = undefined;
  }
}
