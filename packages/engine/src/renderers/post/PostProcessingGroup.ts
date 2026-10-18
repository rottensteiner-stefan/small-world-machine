import type { PostProcessingElement } from "./PostProcessingElement.js";
import {
  ToneMappingElement,
  VignetteElement,
  GrainElement,
  BloomElement,
  ColorGradingElement,
  QuantizeElement,
  HbaoElement,
  TaaElement,
  MotionTrailElement,
  OutlineElement,
  GravitationalLensingElement,
  FlashElement,
  LightShaftsElement,
  VolumetricFogElement,
} from "./elements/index.js";
import { PostProcessingEffectType } from "../../enums/index.js";
import { Vector3D } from "../../math/index.js";
import type { PostProcessingConfig } from "../../interfaces/index.js";

/**
 * A logical grouping of post-processing elements.
 * Currently acts as a "Global Volume", applying its elements to the entire scene.
 * In the future, this can be extended into a spatial BoundingVolume for local overrides.
 */
export class PostProcessingGroup {
  /** If false, the entire post-processing group is bypassed. */
  public enabled: boolean = false;

  /** Currently always true (Global Volume). */
  public isGlobal: boolean = true;

  /** The active shader filter mode (e.g. 0 = clean, 1 = nightvision, 2 = noir, 3 = cyber, 4 = vhs, 5 = underworld, 8 = black hole). */
  public filterMode: number = 0;

  /**
   * Center position of the gravitational lensing / singularity effect in NDC [-1, 1] space.
   * `Z >= -1` indicates in front of the camera (lenses around it); the sentinel `Z = -2`
   * (from `Camera.project`) indicates behind the camera and bypasses lensing.
   * Defaults to (0, 0, 1) = center of screen in front of camera.
   */
  public singularityScreenPos: Vector3D = new Vector3D(0, 0, 1);

  private _elements: Map<PostProcessingEffectType, PostProcessingElement> = new Map();

  constructor() {
    this.add(new ToneMappingElement());
    this.add(new VignetteElement());
    this.add(new GrainElement());
    this.add(new BloomElement());
    this.add(new ColorGradingElement());
    this.add(new QuantizeElement());
    this.add(new HbaoElement());
    this.add(new TaaElement());
    this.add(new MotionTrailElement());
    this.add(new OutlineElement());
    this.add(new GravitationalLensingElement());
    this.add(new FlashElement());
    this.add(new LightShaftsElement());
    this.add(new VolumetricFogElement());
  }

  /**
   * Adds or overwrites a post-processing element in this group.
   * @param element The element to add (e.g. VignetteElement)
   */
  public add(element: PostProcessingElement): this {
    this._elements.set(element.type, element);
    return this;
  }

  /**
   * Get an element by its type.
   * @param type The type
   */
  public get<T extends PostProcessingElement>(type: PostProcessingEffectType): T | undefined {
    return this._elements.get(type) as T;
  }

  /**
   * Removes an element by its type.
   */
  public delete(type: PostProcessingEffectType): boolean {
    return this._elements.delete(type);
  }

  /**
   * Whether any enabled post-processing effect requires the opaque (pre-transparent) depth
   * capture this frame. The renderer uses this single property -- never per-effect ad-hoc OR
   * chains -- to decide whether the opaque depth capture must run (GPU path, see
   * `WebGPURenderer`/`MainRenderPass`). An effect "requires opaque depth" when its GPU
   * implementation reads the captured depth texture (HBAO, light shafts, volumetric fog).
   * Effects without such a consumer (bloom, vignette, grain, grading, ...) never do.
   *
   * Covers ONLY post-processing consumers. The unrelated transparent/refraction capture and the
   * decal depth/normal captures have their own, separate conditions in `MainRenderPass`.
   */
  public get requiresOpaqueDepth(): boolean {
    const hbao = this.get<HbaoElement>(PostProcessingEffectType.HBAO);
    const shafts = this.get<LightShaftsElement>(PostProcessingEffectType.LIGHT_SHAFTS);
    const volFog = this.get<VolumetricFogElement>(PostProcessingEffectType.VOLUMETRIC_FOG);
    return (
      (hbao !== undefined && hbao.enabled) ||
      (shafts !== undefined && shafts.enabled) ||
      (volFog !== undefined && volFog.enabled)
    );
  }

  /**
   * Loads configurations into elements from a configuration object.
   */
  public loadConfig(config?: PostProcessingConfig): void {
    if (!config) return;
    if (config.enabled !== undefined) this.enabled = config.enabled;
    if (config.filterMode !== undefined) this.filterMode = config.filterMode;

    const effects = config.effects;
    if (!effects) return;

    if (effects.toneMapping) {
      const tm = this.get<ToneMappingElement>(PostProcessingEffectType.TONE_MAPPING);
      if (tm) {
        if (effects.toneMapping.enabled !== undefined) tm.enabled = effects.toneMapping.enabled;
        if (effects.toneMapping.mode !== undefined) tm.mode = effects.toneMapping.mode;
        if (effects.toneMapping.exposure !== undefined) tm.exposure = effects.toneMapping.exposure;
        if (effects.toneMapping.gamma !== undefined) tm.gamma = effects.toneMapping.gamma;
      }
    }

    if (effects.vignette) {
      const vig = this.get<VignetteElement>(PostProcessingEffectType.VIGNETTE);
      if (vig) {
        if (effects.vignette.enabled !== undefined) vig.enabled = effects.vignette.enabled;
        if (effects.vignette.offset !== undefined) vig.offset = effects.vignette.offset;
        if (effects.vignette.darkness !== undefined) vig.darkness = effects.vignette.darkness;
        if (effects.vignette.roundness !== undefined) vig.roundness = effects.vignette.roundness;
      }
    }

    if (effects.grain) {
      const grain = this.get<GrainElement>(PostProcessingEffectType.GRAIN);
      if (grain) {
        if (effects.grain.enabled !== undefined) grain.enabled = effects.grain.enabled;
        if (effects.grain.intensity !== undefined) grain.intensity = effects.grain.intensity;
      }
    }

    if (effects.bloom) {
      const bloom = this.get<BloomElement>(PostProcessingEffectType.BLOOM);
      if (bloom) {
        if (effects.bloom.enabled !== undefined) bloom.enabled = effects.bloom.enabled;
        if (effects.bloom.threshold !== undefined) bloom.threshold = effects.bloom.threshold;
        if (effects.bloom.softThreshold !== undefined)
          bloom.softThreshold = effects.bloom.softThreshold;
        if (effects.bloom.intensity !== undefined) bloom.intensity = effects.bloom.intensity;
        if (effects.bloom.radius !== undefined) bloom.radius = effects.bloom.radius;
        if (effects.bloom.color !== undefined) {
          const col = effects.bloom.color;
          if (Array.isArray(col)) {
            bloom.color.set(col[0], col[1], col[2]);
          } else if (typeof col === "object" && col !== null) {
            bloom.color.set(col.r, col.g, col.b);
          }
        }
      }
    }

    if (effects.colorGrading) {
      const grade = this.get<ColorGradingElement>(PostProcessingEffectType.COLOR_GRADING);
      if (grade) {
        const cg = effects.colorGrading;
        if (cg.enabled !== undefined) grade.enabled = cg.enabled;
        if (cg.contrast !== undefined) grade.contrast = cg.contrast;
        if (cg.saturation !== undefined) grade.saturation = cg.saturation;
        if (cg.temperature !== undefined) grade.temperature = cg.temperature;
        if (cg.tint !== undefined) grade.tint = cg.tint;
        if (cg.lift !== undefined) {
          const col = cg.lift;
          if (Array.isArray(col)) {
            grade.lift.set(col[0], col[1], col[2]);
          } else if (typeof col === "object" && col !== null) {
            grade.lift.set(col.r, col.g, col.b);
          }
        }
        if (cg.gamma !== undefined) {
          const col = cg.gamma;
          if (Array.isArray(col)) {
            grade.gamma.set(col[0], col[1], col[2]);
          } else if (typeof col === "object" && col !== null) {
            grade.gamma.set(col.r, col.g, col.b);
          }
        }
        if (cg.gain !== undefined) {
          const col = cg.gain;
          if (Array.isArray(col)) {
            grade.gain.set(col[0], col[1], col[2]);
          } else if (typeof col === "object" && col !== null) {
            grade.gain.set(col.r, col.g, col.b);
          }
        }
      }
    }

    if (effects.quantize) {
      const quant = this.get<QuantizeElement>(PostProcessingEffectType.QUANTIZE);
      if (quant) {
        if (effects.quantize.enabled !== undefined) quant.enabled = effects.quantize.enabled;
        if (effects.quantize.steps !== undefined) quant.steps = effects.quantize.steps;
      }
    }

    if (effects.hbao) {
      const hbao = this.get<HbaoElement>(PostProcessingEffectType.HBAO);
      if (hbao) {
        if (effects.hbao.enabled !== undefined) hbao.enabled = effects.hbao.enabled;
        if (effects.hbao.radius !== undefined) hbao.radius = effects.hbao.radius;
        if (effects.hbao.intensity !== undefined) hbao.intensity = effects.hbao.intensity;
      }
    }

    if (effects.taa) {
      const taa = this.get<TaaElement>(PostProcessingEffectType.TAA);
      if (taa) {
        if (effects.taa.enabled !== undefined) taa.enabled = effects.taa.enabled;
        if (effects.taa.feedback !== undefined) taa.feedback = effects.taa.feedback;
      }
    }

    if (effects.motionTrail) {
      const trail = this.get<MotionTrailElement>(PostProcessingEffectType.MOTION_TRAIL);
      if (trail) {
        if (effects.motionTrail.enabled !== undefined) trail.enabled = effects.motionTrail.enabled;
        if (effects.motionTrail.feedback !== undefined)
          trail.feedback = effects.motionTrail.feedback;
      }
    }

    if (effects.gravitationalLensing) {
      const lensing = this.get<GravitationalLensingElement>(
        PostProcessingEffectType.GRAVITATIONAL_LENSING,
      );
      if (lensing) {
        const gl = effects.gravitationalLensing;
        if (gl.enabled !== undefined) lensing.enabled = gl.enabled;
        if (gl.eventHorizonRadius !== undefined) lensing.eventHorizonRadius = gl.eventHorizonRadius;
        if (gl.strength !== undefined) lensing.strength = gl.strength;
        if (gl.spaghettification !== undefined) lensing.spaghettification = gl.spaghettification;
        if (gl.relativisticBeaming !== undefined)
          lensing.relativisticBeaming = gl.relativisticBeaming;
        if (gl.ringGlowIntensity !== undefined) lensing.ringGlowIntensity = gl.ringGlowIntensity;
        if (gl.singularityScreenPos !== undefined) {
          const p = gl.singularityScreenPos;
          if (Array.isArray(p)) {
            lensing.singularityScreenPos.set(p[0], p[1], p[2]);
          } else if (typeof p === "object" && p !== null) {
            lensing.singularityScreenPos.set(p.x, p.y, p.z);
          }
        }
      }
    }

    if (effects.flash) {
      const flash = this.get<FlashElement>(PostProcessingEffectType.FLASH);
      if (flash) {
        if (effects.flash.enabled !== undefined) flash.enabled = effects.flash.enabled;
        if (effects.flash.color !== undefined) {
          const col = effects.flash.color;
          if (Array.isArray(col)) {
            flash.color.set(col[0], col[1], col[2]);
          } else if (typeof col === "object" && col !== null) {
            flash.color.set(col.r, col.g, col.b);
          }
        }
      }
    }

    if (effects.lightShafts) {
      const shafts = this.get<LightShaftsElement>(PostProcessingEffectType.LIGHT_SHAFTS);
      if (shafts) {
        const ls = effects.lightShafts;
        if (ls.enabled !== undefined) shafts.enabled = ls.enabled;
        if (ls.intensity !== undefined) shafts.intensity = ls.intensity;
        if (ls.density !== undefined) shafts.density = ls.density;
        if (ls.asymmetry !== undefined) shafts.asymmetry = ls.asymmetry;
        if (ls.maxDistance !== undefined) shafts.maxDistance = ls.maxDistance;
        if (ls.samples !== undefined) shafts.samples = ls.samples;
        if (ls.decay !== undefined) shafts.decay = ls.decay;
        if (ls.weight !== undefined) shafts.weight = ls.weight;
        if (ls.color !== undefined) {
          const col = ls.color;
          if (Array.isArray(col)) {
            shafts.color.set(col[0], col[1], col[2]);
          } else if (typeof col === "object" && col !== null) {
            shafts.color.set(col.r, col.g, col.b);
          }
        }
      }
    }

    if (effects.volumetricFog) {
      const volFog = this.get<VolumetricFogElement>(PostProcessingEffectType.VOLUMETRIC_FOG);
      if (volFog) {
        const vf = effects.volumetricFog;
        if (vf.enabled !== undefined) volFog.enabled = vf.enabled;
        if (vf.density !== undefined) volFog.density = vf.density;
        if (vf.height !== undefined) volFog.height = vf.height;
        if (vf.heightFalloff !== undefined) volFog.heightFalloff = vf.heightFalloff;
        if (vf.maxDistance !== undefined) volFog.maxDistance = vf.maxDistance;
        if (vf.intensity !== undefined) volFog.intensity = vf.intensity;
        if (vf.asymmetry !== undefined) volFog.asymmetry = vf.asymmetry;
        if (vf.castDirectionalShadow !== undefined)
          volFog.castDirectionalShadow = vf.castDirectionalShadow;
        if (vf.jitter !== undefined) volFog.jitter = vf.jitter;
        if (vf.color !== undefined) {
          const col = vf.color;
          if (Array.isArray(col)) {
            volFog.color.set(col[0], col[1], col[2]);
          } else if (typeof col === "object" && col !== null) {
            volFog.color.set(col.r, col.g, col.b);
          }
        }
      }
    }
  }
}
