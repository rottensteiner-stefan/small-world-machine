import { Vector3D } from "@small-world-machine/engine";

/**
 * Showcase 46 — Particle Variant Lab: single source of truth for the selectable effect variants
 * and the curated camera pools, shared by the `Hud` (interactive selection), the showcase itself
 * (lane visibility/emission + camera), and `GoldenCapture` (deterministic browser audits in the
 * style of showcase 45 / `fire45`).
 *
 * A variant is a *focused composition* of the lab's already-built particle lanes; switching a
 * variant never creates or disposes systems (no resource flips), it only changes which lanes are
 * visible/emitting and which camera pool applies.
 */

/** Effect variants the viewer can switch between. Unknown ids (query params) degrade to `overview`. */
export type ParticleVariantId = "overview" | "forge" | "smoke" | "trails" | "weather" | "gpu";

/** Curated camera pools, mirroring the `fire45` pool convention (overview / closeup / budget). */
export type CameraPoolId = "overview" | "closeup" | "budget";

export interface CameraRef {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
}

/** Which lab lanes a variant makes visible and emitting. */
export interface VariantLanes {
  /** Forge sparks (SDF collision, sub-emitter bursts, pooled lights). */
  readonly sparks: boolean;
  /** Soft smoke + procedural 6-way volume light. */
  readonly smoke: boolean;
  /** Ribbon trail behind the tracked tracer. */
  readonly trails: boolean;
  /** Roof-aware rain/ash lane + splashes. */
  readonly weather: boolean;
  /** WebGPU compute lane (only wired when a GPU device is present). */
  readonly gpu: boolean;
  /** The plain lab floor + lights stay in every variant. */
}

export interface ParticleVariant {
  readonly id: ParticleVariantId;
  readonly title: string;
  readonly icon: string;
  readonly hint: string;
  readonly lanes: VariantLanes;
}

export const PARTICLE_VARIANTS: readonly ParticleVariant[] = [
  {
    id: "overview",
    title: "Overview",
    icon: "🧪",
    hint: "All lanes (default)",
    lanes: { sparks: true, smoke: true, trails: true, weather: true, gpu: false },
  },
  {
    id: "forge",
    title: "Forge",
    icon: "⚒️",
    hint: "Sparks · SDF · light pool",
    lanes: { sparks: true, smoke: false, trails: false, weather: false, gpu: false },
  },
  {
    id: "smoke",
    title: "Smoke",
    icon: "💨",
    hint: "Soft smoke · 6-way light",
    lanes: { sparks: false, smoke: true, trails: false, weather: false, gpu: false },
  },
  {
    id: "trails",
    title: "Trails",
    icon: "✨",
    hint: "Ribbon tracers · bursts",
    lanes: { sparks: true, smoke: false, trails: true, weather: false, gpu: false },
  },
  {
    id: "weather",
    title: "Weather",
    icon: "🌧️",
    hint: "Rain · roof · splash",
    lanes: { sparks: false, smoke: false, trails: false, weather: true, gpu: false },
  },
  {
    id: "gpu",
    title: "GPU",
    icon: "⚡",
    hint: "WebGPU compute lane",
    lanes: { sparks: false, smoke: false, trails: false, weather: false, gpu: true },
  },
];

export const VARIANT_BY_ID: Readonly<Record<string, ParticleVariant>> = Object.fromEntries(
  PARTICLE_VARIANTS.map((v) => [v.id, v]),
);

/** Camera pools available to every variant (world lab coordinates). */
export const CAMERA_POOLS: Readonly<Record<CameraPoolId, CameraRef>> = {
  overview: { position: [0, 1.7, 5.8], target: [0, 0.9, 0] },
  closeup: { position: [0, 0.7, 2.5], target: [0, 0.55, 0] },
  budget: { position: [12, 2.6, 6.5], target: [0, 1.0, 0] },
};

export const CAMERA_POOL_IDS: readonly CameraPoolId[] = ["overview", "closeup", "budget"];

/**
 * Per-variant camera overrides: a variant owns its composed framing. An override replaces the
 * base pool camera for the (variant, pool) pair, so e.g. the high-flying ribbon arc of `trails`
 * stays framed even under the audience-facing `closeup` pool (the generic anvil closeup would
 * only capture the band's upper edge). Every other combination uses the untouched base pool.
 */
export const CAMERA_OVERRIDES: Readonly<
  Partial<Record<ParticleVariantId, Partial<Record<CameraPoolId, CameraRef>>>>
> = {
  trails: {
    // Tighter close composition on the ribbon burst corridor (measured world y ~1.5-3.5 over the
    // anvil): closer than the overview, sight line through the mid-burst with the launch base
    // partially visible below. The generic anvil closeup would clip the band's upper edge.
    closeup: { position: [0, 1.0, 2.3], target: [0, 2.3, 0] },
  },
};

/**
 * Resolves the effective camera for a (variant, pool) combination: an explicit per-variant
 * override wins over the base curated pool. Single source of truth for the interactive HUD,
 * the showcase itself and the golden capture path.
 */
export function cameraFor(variantId: ParticleVariantId, pool: CameraPoolId): CameraRef {
  return CAMERA_OVERRIDES[variantId]?.[pool] ?? CAMERA_POOLS[pool];
}

/** Resolves a variant id robustly; unknown values (garbage query params) fall back to `overview`. */
export function resolveVariant(raw: string | undefined | null): ParticleVariant {
  // `find`, not `VARIANT_BY_ID[raw]`: "?variant=toString" must not hit Object.prototype.
  return PARTICLE_VARIANTS.find((v) => v.id === raw) ?? VARIANT_BY_ID["overview"]!;
}

/** Materializes a camera reference (the spec uses tuples to stay allocation-free at module load). */
export function cameraFrom(ref: CameraRef): { position: Vector3D; target: Vector3D } {
  return {
    position: new Vector3D(ref.position[0], ref.position[1], ref.position[2]),
    target: new Vector3D(ref.target[0], ref.target[1], ref.target[2]),
  };
}
