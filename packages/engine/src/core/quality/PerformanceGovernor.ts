import type { DynamicResolutionConfig } from "../../interfaces/index.js";

export type PerformanceBottleneck = "none" | "gpu" | "cpu";

const DEFAULT_TARGET_FPS = 60;
const DEFAULT_MIN_SCALE = 0.5;
const DEFAULT_MAX_SCALE = 1.0;
const DEFAULT_STEP = 0.1;
const DEFAULT_COOLDOWN_MS = 1500;
const DEFAULT_WARMUP_FRAMES = 12;
const EMA_ALPHA = 0.1;
const MAX_SAMPLE_FRAME_MS = 250;
const DOWNGRADE_BUDGET_FACTOR = 1.15;
const UPGRADE_BUDGET_FACTOR = 0.82;
const CPU_BOUND_RATIO = 0.85;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function snapScale(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Runtime frame-time governor and dynamic resolution scaler (ADR 0035, Phase 4).
 *
 * Uses an exponential moving average of wall-clock frame durations combined with a CPU-time
 * guard: resolution is only lowered when frame budgets are missed AND CPU work is not already
 * saturating the budget. Wide hysteresis thresholds and a wall-clock cooldown prevent
 * per-frame render-target thrashing. Zero allocations per frame.
 */
export class PerformanceGovernor {
  /** @domain Whether dynamic render scaling is active. */
  public enabled: boolean = false;
  /** @domain Target frame rate in Hz used to derive the millisecond frame budget. */
  public readonly targetFps: number;
  /** @domain Minimum dynamic render scale factor in [0.25, 1.0]. */
  public readonly minScale: number;
  /** @domain Maximum dynamic render scale factor in [minScale, 1.0]. */
  public readonly maxScale: number;
  /** @domain Discrete scale step applied when stepping resolution down or up. */
  public readonly step: number;
  /** @domain Minimum cooldown in milliseconds between consecutive resolution transitions. */
  public readonly cooldownMs: number;
  /** @domain Number of valid frame samples required before the first scale transition. */
  public readonly warmupFrames: number;

  private _renderScale: number;
  private _emaFrameMs: number = 0;
  private _emaCpuMs: number = 0;
  private _sampleCount: number = 0;
  private _lastChangeMs: number = -Infinity;
  private _lastBottleneck: PerformanceBottleneck = "none";

  constructor(config: DynamicResolutionConfig = {}) {
    this.enabled = config.enabled === true;
    const rawFps = config.targetFps ?? DEFAULT_TARGET_FPS;
    this.targetFps = Number.isFinite(rawFps) && rawFps > 0 ? rawFps : DEFAULT_TARGET_FPS;

    const rawMin = config.minScale ?? DEFAULT_MIN_SCALE;
    const rawMax = config.maxScale ?? DEFAULT_MAX_SCALE;
    this.maxScale = Number.isFinite(rawMax) ? clamp(rawMax, 0.25, 1.0) : DEFAULT_MAX_SCALE;
    this.minScale = Number.isFinite(rawMin)
      ? clamp(rawMin, 0.25, this.maxScale)
      : Math.min(DEFAULT_MIN_SCALE, this.maxScale);

    const rawStep = config.step ?? DEFAULT_STEP;
    this.step = Number.isFinite(rawStep) && rawStep > 0 ? clamp(rawStep, 0.01, 0.5) : DEFAULT_STEP;

    const rawCooldown = config.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.cooldownMs =
      Number.isFinite(rawCooldown) && rawCooldown >= 0 ? rawCooldown : DEFAULT_COOLDOWN_MS;

    const rawWarmup = config.warmupFrames ?? DEFAULT_WARMUP_FRAMES;
    this.warmupFrames =
      Number.isFinite(rawWarmup) && rawWarmup >= 1 ? Math.floor(rawWarmup) : DEFAULT_WARMUP_FRAMES;

    this._renderScale = snapScale(this.maxScale);
  }

  /** @derived Current render scale factor clamped to [minScale, maxScale]. */
  public get renderScale(): number {
    return this._renderScale;
  }

  /** @derived Exponentially smoothed wall-clock frame duration in milliseconds. */
  public get emaFrameMs(): number {
    return this._emaFrameMs;
  }

  /** @derived Exponentially smoothed CPU step duration in milliseconds. */
  public get emaCpuMs(): number {
    return this._emaCpuMs;
  }

  /** @derived Number of valid frames observed since creation or last reset. */
  public get sampleCount(): number {
    return this._sampleCount;
  }

  /** @derived Bottleneck classification from the most recent frame evaluation. */
  public get lastBottleneck(): PerformanceBottleneck {
    return this._lastBottleneck;
  }

  /** Resets smoothed timings, sample count, and restores `renderScale` to `maxScale`. */
  public reset(): void {
    this._renderScale = snapScale(this.maxScale);
    this._emaFrameMs = 0;
    this._emaCpuMs = 0;
    this._sampleCount = 0;
    this._lastChangeMs = -Infinity;
    this._lastBottleneck = "none";
  }

  /**
   * Records one real-time frame measurement and returns the updated `renderScale` if a step
   * transition occurred, or `null` when no resize is needed.
   */
  public recordFrame(frameTimeMs: number, cpuTimeMs: number, nowMs: number): number | null {
    if (!this.enabled) return null;
    if (
      !Number.isFinite(frameTimeMs) ||
      !Number.isFinite(cpuTimeMs) ||
      !Number.isFinite(nowMs) ||
      frameTimeMs <= 0 ||
      frameTimeMs > MAX_SAMPLE_FRAME_MS
    ) {
      // Ignore tab switches, breakpoints, and zero-delta resume frames so they do not tank scale.
      return null;
    }

    const clampedCpuMs = Math.max(0, Math.min(cpuTimeMs, frameTimeMs));
    if (this._sampleCount === 0) {
      this._emaFrameMs = frameTimeMs;
      this._emaCpuMs = clampedCpuMs;
    } else {
      this._emaFrameMs += EMA_ALPHA * (frameTimeMs - this._emaFrameMs);
      this._emaCpuMs += EMA_ALPHA * (clampedCpuMs - this._emaCpuMs);
    }
    this._sampleCount++;

    if (this._sampleCount < this.warmupFrames) {
      return null;
    }

    const targetFrameMs = 1000.0 / this.targetFps;
    if (nowMs - this._lastChangeMs < this.cooldownMs) {
      return null;
    }

    if (this._emaFrameMs > targetFrameMs * DOWNGRADE_BUDGET_FACTOR) {
      if (this._emaCpuMs > targetFrameMs * CPU_BOUND_RATIO) {
        // ADR 0035 Phase 4: CPU-bound scenes must not downscale GPU resolution pointlessly.
        this._lastBottleneck = "cpu";
        return null;
      }
      this._lastBottleneck = "gpu";
      if (this._renderScale > this.minScale) {
        const next = snapScale(Math.max(this.minScale, this._renderScale - this.step));
        if (next < this._renderScale) {
          this._renderScale = next;
          this._lastChangeMs = nowMs;
          return next;
        }
      }
      return null;
    }

    this._lastBottleneck = "none";
    if (
      this._emaFrameMs < targetFrameMs * UPGRADE_BUDGET_FACTOR &&
      this._renderScale < this.maxScale
    ) {
      const next = snapScale(Math.min(this.maxScale, this._renderScale + this.step));
      if (next > this._renderScale) {
        this._renderScale = next;
        this._lastChangeMs = nowMs;
        return next;
      }
    }

    return null;
  }
}
