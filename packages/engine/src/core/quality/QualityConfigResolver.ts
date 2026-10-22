import { PerformanceTier } from "../DeviceCaps.js";
import type {
  PostProcessingConfig,
  PostProcessingEffectsConfig,
  QualityConfig,
} from "../../interfaces/index.js";

/**
 * Per-tier target settings for the static quality-tier policy (ADR 0035, Ebene 2).
 *
 * The HIGH tier is intentionally empty: it must reproduce exactly today's desktop behavior,
 * so it never adds or overrides any field. LOW / MEDIUM carry the start values from the
 * mobile research; final numbers are calibrated on the Redmi 13C (see ADR / runbook 03).
 */
interface TierQualityPolicy {
  readonly quality: QualityConfig;
  readonly postProcessing: PostProcessingConfig;
}

const TIER_MATRIX: Readonly<Record<PerformanceTier, TierQualityPolicy>> = {
  [PerformanceTier.LOW]: {
    quality: {
      hdr: false,
      msaa: 0,
      maxAnisotropy: 1,
      maxPixelRatio: 1,
    },
    postProcessing: {
      effects: {
        hbao: { enabled: false },
        volumetricFog: { enabled: false },
        lightShafts: { enabled: false },
        motionTrail: { enabled: false },
        taa: { enabled: false },
        bloom: { enabled: false },
      },
    },
  },
  [PerformanceTier.MEDIUM]: {
    quality: {
      msaa: 2,
      maxAnisotropy: 2,
    },
    postProcessing: {},
  },
  [PerformanceTier.HIGH]: {
    quality: {},
    postProcessing: {},
  },
};

/**
 * Copies only the own defined (non-undefined) properties of `source` onto `target`.
 * Used to overlay explicit user choices on top of a tier policy so that every explicitly
 * set field is the locked axis (ADR 0035, Ebene 3 "generic override-lock"): a value the
 * author set wins against the tier; an unset field stays under tier control.
 */
function mergeDefined<T extends object>(target: T, source: T): T {
  const targetRecord = target as Record<string, unknown>;
  for (const key of Object.keys(source) as string[]) {
    const value = (source as Record<string, unknown>)[key];
    if (value !== undefined) {
      targetRecord[key] = value;
    }
  }
  return target;
}

/**
 * Resolves the effective quality and post-processing configuration for one engine instance
 * from the detected device tier plus the author's explicit overrides.
 *
 * This is the V1 *static* tier resolver (ADR 0035, Ebene 2). It runs exactly once before the
 * renderer is created; after that the configuration is closed. Dynamic render-scale feedback
 * (ADR 0035, Ebene 4) is intentionally out of scope.
 */
export class QualityConfigResolver {
  /**
   * Applies the tier policy for the given tier and overlays the author's explicit overrides.
   * @param tier Detected device tier (from `DeviceCaps.getPerformanceTier()`).
   * @param userQuality Explicit quality overrides (may be undefined).
   * @param userPost Explicit post-processing overrides (may be undefined).
   * @returns Closed quality + post-processing configuration. Fields the author explicitly set
   *   are preserved; unset fields follow the tier policy.
   */
  public static resolve(
    tier: PerformanceTier,
    userQuality?: QualityConfig,
    userPost?: PostProcessingConfig,
  ): { quality: QualityConfig; postProcessing: PostProcessingConfig } {
    // Deep copy: the matrix is module-wide, so results handed to one engine instance must never
    // alias it (a later mutation would change the policy for every instance and resolve()).
    const policy = structuredClone(TIER_MATRIX[tier]);
    const quality = mergeDefined<QualityConfig>(
      { ...policy.quality } as QualityConfig,
      userQuality ?? ({} as QualityConfig),
    );
    const postProcessing = this._resolvePostProcessing(policy.postProcessing, userPost);
    return { quality, postProcessing };
  }

  private static _resolvePostProcessing(
    policyPost: PostProcessingConfig,
    userPost: PostProcessingConfig | undefined,
  ): PostProcessingConfig {
    const resolved: PostProcessingConfig = {};
    mergeDefined(resolved, policyPost);

    if (!userPost) {
      return resolved;
    }

    if (userPost.enabled !== undefined) resolved.enabled = userPost.enabled;
    if (userPost.filterMode !== undefined) resolved.filterMode = userPost.filterMode;

    const resolvedEffects: PostProcessingEffectsConfig = {
      ...((resolved.effects as PostProcessingEffectsConfig | undefined) ?? {}),
    };
    const userEffects = userPost.effects;
    if (userEffects) {
      for (const key of Object.keys(userEffects) as (keyof PostProcessingEffectsConfig)[]) {
        const userEffect = userEffects[key];
        if (userEffect === undefined) {
          continue;
        }
        // Ebene 3 (V1), generic override-lock on the EFFECT as the locked axis: an author who
        // configures an effect at all (e.g. only `hbao.radius`) owns that whole effect object.
        // His object therefore REPLACES the tier value completely (no merge), so the tier can
        // never force `enabled:false` onto an effect the author explicitly touched -- the tier
        // only controls effects the author never mentioned. (ADR 0035 Ebene 3, fixed after
        // claude-device-tier feedback 2026-10-18: the DRAFT semantics could disable HBAO on LOW
        // even when the author had only set its radius.)
        (resolvedEffects[key] as Record<string, unknown>) = {
          ...(userEffect as Record<string, unknown>),
        };
      }
    }
    if (Object.keys(resolvedEffects).length > 0) {
      resolved.effects = resolvedEffects;
    }
    return resolved;
  }
}
