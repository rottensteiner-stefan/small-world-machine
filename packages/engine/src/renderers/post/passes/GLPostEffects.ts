import { PostProcessingEffectType } from "../../../enums/index.js";
import type { ShaderRegistry } from "../../shaders/index.js";
import type {
  BloomElement,
  DepthOfFieldElement,
  HbaoElement,
  LightShaftsElement,
  MotionTrailElement,
  TaaElement,
  VolumetricFogElement,
} from "../elements/index.js";
import type { GLPostEffectPass, GLPostEffectPassContext } from "./GLPostEffectPass.js";
import { AOPassGL } from "./AOPassGL.js";
import { BloomPassGL } from "./BloomPassGL.js";
import { DepthOfFieldPassGL } from "./DepthOfFieldPassGL.js";
import { HistoryBlendPassGL } from "./HistoryBlendPassGL.js";
import { LightShaftsPassGL } from "./LightShaftsPassGL.js";
import { PostProcessPassGL } from "./PostProcessPassGL.js";
import { VolumetricFogPassGL } from "./VolumetricFogPassGL.js";

/**
 * Owns and routes every GL post-processing pass of a renderer behind the execute/destroy contract
 * (GL-typed shape of `PostEffectPass`, ADR 0037). This is the GL counterpart of the GPU post
 * chain: a registry of per-effect passes plus the terminal uber pass, sequenced per frame by
 * `execute(ctx)` and torn down by `destroy()`.
 *
 * Replaces the renderer-owned `_xxxPassGL` fields and their ad-hoc `?.destroy()` lists on the GL
 * renderers (ADR 0038 §4). The renderer only guards the off-screen condition, populates the
 * reusable per-frame context and hands it over; the sequencing below mirrors the previous
 * `flushPostProcess` chains exactly (TAA resolves before downstream effects, chained outputs are
 * rewired through `ctx.colorTexture` and the produced bloom/HBAO/shafts/fog textures reach the
 * uber pass via the context).
 */
export class GLPostEffects {
  private readonly _passes: Map<PostProcessingEffectType, GLPostEffectPass> = new Map();
  private readonly _uberPass: PostProcessPassGL;

  constructor(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    isWebGL2: boolean,
    shaderRegistry: ShaderRegistry,
  ) {
    this._uberPass = new PostProcessPassGL(gl, isWebGL2, shaderRegistry);
    if (isWebGL2) {
      const gl2 = gl as WebGL2RenderingContext;
      this._passes.set(PostProcessingEffectType.TAA, new HistoryBlendPassGL(gl2));
      this._passes.set(PostProcessingEffectType.MOTION_TRAIL, new HistoryBlendPassGL(gl2));
      this._passes.set(PostProcessingEffectType.BLOOM, new BloomPassGL(gl, true));
      this._passes.set(PostProcessingEffectType.HBAO, new AOPassGL(gl2));
      this._passes.set(PostProcessingEffectType.LIGHT_SHAFTS, new LightShaftsPassGL(gl, true));
      this._passes.set(PostProcessingEffectType.VOLUMETRIC_FOG, new VolumetricFogPassGL(gl, true));
      this._passes.set(PostProcessingEffectType.DEPTH_OF_FIELD, new DepthOfFieldPassGL(gl, true));
    } else {
      // WebGL1 legacy fallback: the reduced GL1 chain (no TAA/HBAO/volumetric fog, tilt-shift DoF).
      this._passes.set(PostProcessingEffectType.BLOOM, new BloomPassGL(gl, false));
      this._passes.set(PostProcessingEffectType.LIGHT_SHAFTS, new LightShaftsPassGL(gl, false));
      this._passes.set(PostProcessingEffectType.DEPTH_OF_FIELD, new DepthOfFieldPassGL(gl, false));
    }
  }

  /**
   * Runs the whole GL post chain for the current frame against the given reusable context.
   * Sequencing and per-effect guards mirror the former renderer-local `flushPostProcess`.
   */
  public execute(ctx: GLPostEffectPassContext): void {
    // TAA resolves first, if enabled: everything downstream (Bloom, HBAO, the final uber pass)
    // should react to the temporally-smoothed color, not the raw per-frame jittered one.
    const taa = this._passes.get(PostProcessingEffectType.TAA);
    if (taa) {
      const taaNode = ctx.group.get<TaaElement>(PostProcessingEffectType.TAA);
      if (taaNode && taaNode.enabled) {
        ctx.element = taaNode;
        const resolved = taa.execute(ctx);
        if (resolved) ctx.colorTexture = resolved;
      }
    }

    // Motion Trail: a deliberate ghost/afterimage look, not anti-aliasing -- reuses the same
    // history-blend pass as TAA (its own separate instance/history buffer), chained after TAA
    // so both can be combined if ever wanted, though typically only one is enabled at a time.
    const motionTrail = this._passes.get(PostProcessingEffectType.MOTION_TRAIL);
    if (motionTrail) {
      const trailNode = ctx.group.get<MotionTrailElement>(PostProcessingEffectType.MOTION_TRAIL);
      if (trailNode && trailNode.enabled) {
        ctx.element = trailNode;
        const resolved = motionTrail.execute(ctx);
        if (resolved) ctx.colorTexture = resolved;
      }
    }

    // Depth of field defocuses the resolved HDR radiance before bloom and tone mapping: a lens
    // integrates linear radiance over its aperture, so bright highlights must become bokeh discs
    // first and only then glow. AO / light shafts / volumetric fog are composited later by the
    // uber pass and stay unblurred -- acceptable, they are low-frequency terms.
    const dof = this._passes.get(PostProcessingEffectType.DEPTH_OF_FIELD);
    if (dof) {
      const dofNode = ctx.group.get<DepthOfFieldElement>(PostProcessingEffectType.DEPTH_OF_FIELD);
      if (dofNode && dofNode.enabled) {
        ctx.element = dofNode;
        const defocused = dof.execute(ctx);
        if (defocused) ctx.colorTexture = defocused;
      }
    }

    ctx.bloomTexture = null;
    const bloom = this._passes.get(PostProcessingEffectType.BLOOM);
    if (bloom) {
      const bloomNode = ctx.group.get<BloomElement>(PostProcessingEffectType.BLOOM);
      if (bloomNode && bloomNode.enabled) {
        ctx.element = bloomNode;
        ctx.bloomTexture = bloom.execute(ctx);
      }
    }

    ctx.hbaoTexture = null;
    if (ctx.depthTexture && ctx.projMatrixData) {
      const hbao = this._passes.get(PostProcessingEffectType.HBAO);
      if (hbao) {
        const hbaoNode = ctx.group.get<HbaoElement>(PostProcessingEffectType.HBAO);
        if (hbaoNode && hbaoNode.enabled) {
          ctx.element = hbaoNode;
          ctx.hbaoTexture = hbao.execute(ctx);
        }
      }
    }

    ctx.lightShaftsTexture = null;
    if (ctx.lights?.dLight) {
      const shafts = this._passes.get(PostProcessingEffectType.LIGHT_SHAFTS);
      if (shafts) {
        const shaftsNode = ctx.group.get<LightShaftsElement>(PostProcessingEffectType.LIGHT_SHAFTS);
        if (shaftsNode && shaftsNode.enabled) {
          ctx.element = shaftsNode;
          ctx.lightShaftsTexture = shafts.execute(ctx);
        }
      }
    }

    ctx.volumetricFogTexture = null;
    const volFog = this._passes.get(PostProcessingEffectType.VOLUMETRIC_FOG);
    if (volFog) {
      const volFogNode = ctx.group.get<VolumetricFogElement>(
        PostProcessingEffectType.VOLUMETRIC_FOG,
      );
      if (volFogNode && volFogNode.enabled) {
        ctx.element = volFogNode;
        ctx.volumetricFogTexture = volFog.execute(ctx);
      }
    }

    // Terminal uber pass: reads the whole group (tone mapping, grading, ...) and composites the
    // chained color with any produced bloom/HBAO/shafts/fog before writing to the canvas.
    ctx.element = undefined;
    this._uberPass.execute(ctx);
  }

  /** Releases every owned pass. */
  public destroy(): void {
    for (const pass of this._passes.values()) {
      pass.destroy();
    }
    this._passes.clear();
    this._uberPass.destroy();
  }
}
