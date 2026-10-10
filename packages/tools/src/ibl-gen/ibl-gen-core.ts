/**
 * Deterministic, browser-free core for the IBL generator tool.
 *
 * This is the headless extraction proof (collaboration P1): everything that can run
 * without WebGL2 lives here as pure functions, so the same input + seed + options
 * always produce the same bytes. The GPU baking pipeline (`IBLBaker` in ibl-gen.js)
 * stays untouched and is driven by the CLI harness; `generateTestEquirect` builds a
 * fresh PRNG from the seed on every call, so equal seeds give equal bytes.
 *
 * This module is browser-safe (no Node-APIs): hashing/manifest assembly that needs
 * a crypto backend lives in the headless CLI (scripts/ibl-bake.ts), not here.
 */

export interface IblGenOptions {
  /** PRNG seed. Same seed -> identical panorama + identical bake input. */
  seed: number;
  /** Equirectangular input width/height in pixels (RGBA8). */
  width: number;
  height: number;
  /** Internal bake resolutions (kept aligned with IBLBaker defaults). */
  envResolution: number;
  irradianceResolution: number;
  prefilterResolution: number;
  prefilterMips: number;
  brdfResolution: number;
}

export interface IblGenDefaults {
  envResolution: number;
  irradianceResolution: number;
  prefilterResolution: number;
  prefilterMips: number;
  brdfResolution: number;
}

export interface IblBakeManifestEntry {
  name: string;
  bytes: number;
  sha256: string;
}

export interface IblBakeManifest {
  tool: "ibl-bake";
  schema: 1;
  seed: number;
  options: Omit<IblGenOptions, "seed">;
  inputSha256: string;
  outputs: IblBakeManifestEntry[];
}

export const IBL_GEN_DEFAULTS: IblGenDefaults = {
  envResolution: 512,
  irradianceResolution: 32,
  prefilterResolution: 128,
  prefilterMips: 5,
  brdfResolution: 512,
};

/** Mulberry32 — deterministic, allocation-free PRNG. The returned closure carries its own state: only creating a new generator restarts the sequence. */
function assertSeed(seed: number, caller: string): void {
  if (!Number.isInteger(seed)) {
    throw new Error(`${caller}: seed must be an integer, got ${seed}`);
  }
}

export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic equirectangular test panorama as RGBA8 pixels.
 * A sky→ground vertical ramp, a bright seeded "sun" hotspot and deterministic
 * grain make the IBL convolution non-trivial while staying byte-reproducible.
 */
export function generateTestEquirect(
  seed: number,
  width: number,
  height: number,
): Uint8ClampedArray {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(`generateTestEquirect: invalid dimensions ${width}x${height}`);
  }
  assertSeed(seed, "generateTestEquirect");
  const rng = createSeededRng(seed);
  const data = new Uint8ClampedArray(width * height * 4);

  const sunU = rng();
  const sunV = rng();
  const sunY = Math.floor(sunV * height * 0.35);
  const sunX = Math.floor(sunU * width);

  for (let y = 0; y < height; y++) {
    const t = y / Math.max(1, height - 1);
    const skyR = Math.floor(90 * (1 - t) + 30 * t);
    const skyG = Math.floor(150 * (1 - t) + 20 * t);
    const skyB = Math.floor(220 * (1 - t) + 10 * t);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const dSun = Math.hypot(x - sunX, y - sunY);
      const sunFactor = Math.max(0, 1 - dSun / (width * 0.06));
      const grain = rng() * 14;
      data[i] = skyR + sunFactor * 165 + grain;
      data[i + 1] = skyG + sunFactor * 120 + grain;
      data[i + 2] = skyB + sunFactor * 60 + grain;
      data[i + 3] = 255;
    }
  }
  return data;
}

export function resolveIblGenOptions(raw: Partial<IblGenOptions>): IblGenOptions {
  const option = (value: number | undefined, fallback: number, name: string): number => {
    const v = value ?? fallback;
    if (!Number.isInteger(v) || v <= 0) {
      throw new Error(`resolveIblGenOptions: ${name} must be a positive integer, got ${v}`);
    }
    return v;
  };
  const seed = raw.seed === undefined ? 0 : raw.seed;
  assertSeed(seed, "resolveIblGenOptions");
  return {
    seed,
    width: option(raw.width, 512, "width"),
    height: option(raw.height, 256, "height"),
    envResolution: option(raw.envResolution, IBL_GEN_DEFAULTS.envResolution, "envResolution"),
    irradianceResolution: option(
      raw.irradianceResolution,
      IBL_GEN_DEFAULTS.irradianceResolution,
      "irradianceResolution",
    ),
    prefilterResolution: option(
      raw.prefilterResolution,
      IBL_GEN_DEFAULTS.prefilterResolution,
      "prefilterResolution",
    ),
    prefilterMips: option(raw.prefilterMips, IBL_GEN_DEFAULTS.prefilterMips, "prefilterMips"),
    brdfResolution: option(raw.brdfResolution, IBL_GEN_DEFAULTS.brdfResolution, "brdfResolution"),
  };
}
