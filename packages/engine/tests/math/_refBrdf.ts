// Pure-TS reference implementation of the engine's Cook-Torrance microfacet BRDF. Every formula
// mirrors packages/engine/src/renderers/shaders/source/web_gl2/chunks/pbr_math.frag.glsl 1:1
// (D_GGX, G_SchlickGGX, F_Schlick), so the radiometric contract tests below assert properties of
// the exact function the shaders evaluate, not of an idealized BRDF.
//
// Guard clauses return 0 for dot products <= 0 (a direction below the surface contributes no
// reflected radiance). No `any`, strict types.

/** GGX NDF (engine `D_GGX`): perceptual roughness in, alpha = roughness^2. */
export function dGgx(dotNH: number, roughness: number): number {
  const a = roughness * roughness;
  const a2 = a * a;
  const denom = dotNH * dotNH * (a2 - 1.0) + 1.0;
  return a2 / (Math.PI * denom * denom);
}

/** Smith/Schlick-GGX geometric shadowing (engine `G_SchlickGGX`), k = (r+1)^2 / 8. */
export function gSchlickGgx(dotNL: number, dotNV: number, roughness: number): number {
  if (dotNL <= 0 || dotNV <= 0) {
    return 0;
  }
  const r = roughness + 1.0;
  const k = (r * r) / 8.0;
  const gl = dotNL / (dotNL * (1.0 - k) + k);
  const gv = dotNV / (dotNV * (1.0 - k) + k);
  return gl * gv;
}

/** Schlick Fresnel (engine `F_Schlick`). */
export function fSchlick(cosTheta: number, f0: number): number {
  const x = Math.min(Math.max(1.0 - cosTheta, 0.0), 1.0);
  const x2 = x * x;
  return f0 + (1.0 - f0) * (x2 * x2 * x);
}

/**
 * Cook-Torrance specular lobe D*G*F / (4 NdotL NdotV), evaluated on the same dot products the
 * shaders pass. Zero whenever NdotL or NdotV is <= 0.
 */
export function cookTorranceSpecular(
  dotNL: number,
  dotNV: number,
  dotNH: number,
  dotVH: number,
  roughness: number,
  f0: number,
): number {
  if (dotNL <= 0 || dotNV <= 0) {
    return 0;
  }
  const d = dGgx(dotNH, roughness);
  const g = gSchlickGgx(dotNL, dotNV, roughness);
  const f = fSchlick(dotVH, f0);
  return (d * g * f) / (4.0 * dotNL * dotNV);
}

/** Lambert diffuse lobe with Fresnel energy weighting (engine `kD = (1-F)(1-metallic)`). */
export function lambertDiffuse(dotVH: number, albedo: number, f0: number, metallic: number): number {
  const f = fSchlick(dotVH, f0);
  const kD = (1.0 - f) * (1.0 - metallic);
  return (albedo * kD) / Math.PI;
}

/** Normalize a 3-vector (plain number tuples; test-only math). */
export function normalize3(v: readonly [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-12) {
    return [0, 0, 1];
  }
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Dot product of two 3-vectors. */
export function dot3(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Deterministic seeded LCG (reproducible sweeps without external dependencies). */
export function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Smith masking term, single axis (engine `G_SchlickGGX` factor with k = (r+1)^2 / 8). */
export function g1Smith(dotNX: number, roughness: number): number {
  if (dotNX <= 0) {
    return 0;
  }
  const r = roughness + 1.0;
  const k = (r * r) / 8.0;
  return dotNX / (dotNX * (1.0 - k) + k);
}

/**
 * GGX VNDF half-vector sample (Heitz 2018, "Sampling the GGX Distribution of Visible Normals",
 * as used by Filament and three.js IBL prefiltering). `view` must be unit-length with view[2] > 0
 * in a frame whose +Z is the surface normal. Deterministic via two uniform draws.
 */
export function sampleGGXVNDF(
  roughness: number,
  view: readonly [number, number, number],
  u1: number,
  u2: number,
): [number, number, number] {
  const alpha = Math.max(roughness * roughness, 0.000001);
  const vhx = alpha * view[0];
  const vhy = alpha * view[1];
  const vh = normalize3([vhx, vhy, view[2]]);
  const lensq = vh[0] * vh[0] + vh[1] * vh[1];
  const t1: [number, number, number] =
    lensq > 1e-12
      ? [-vh[1] / Math.sqrt(lensq), vh[0] / Math.sqrt(lensq), 0]
      : [1, 0, 0];
  const t2 = normalize3([
    vh[1] * t1[2] - vh[2] * t1[1],
    vh[2] * t1[0] - vh[0] * t1[2],
    vh[0] * t1[1] - vh[1] * t1[0],
  ]);
  // Parameterization of the projected area (Heitz section 4.2/4.3).
  const r = Math.sqrt(Math.min(Math.max(u1, 0), 1));
  const phi = 2 * Math.PI * u2;
  const t1c = r * Math.cos(phi);
  const t2cRaw = r * Math.sin(phi);
  const s = 0.5 * (1 + vh[2]);
  const t2c = (1 - s) * Math.sqrt(Math.max(0, 1 - t1c * t1c)) + s * t2cRaw;
  const nhz = Math.sqrt(Math.max(0, 1 - t1c * t1c - t2c * t2c));
  return normalize3([
    alpha * (t1c * t1[0] + t2c * t2[0] + nhz * vh[0]),
    alpha * (t1c * t1[1] + t2c * t2[1] + nhz * vh[1]),
    Math.max(0, t1c * t1[2] + t2c * t2[2] + nhz * vh[2]),
  ]);
}

export interface AlbedoEstimate {
  mean: number;
  standardError: number;
}

/**
 * Unbiased Monte-Carlo estimate of the specular directional albedo
 *   E_spec(V) = ∫_Ω f_s(L, V) (N·L) dω_L
 * with H ~ VNDF(V, alpha) and L = reflect(V, H) (the standard split-sum estimator of the GGX+Smith
 * lobes; the D·G1(V)·(H·V)/cos(V) factors cancel against the VNDF PDF, leaving weights G1(L)·F(H·L)).
 * Zero-variance in the ideal limit, finite but small variance on a dielectric near saturation --
 * callers bound `mean <= 1` with a margin derived from the returned standard error.
 */
export function specularAlbedoVNDF(
  roughness: number,
  f0: number,
  view: readonly [number, number, number],
  samples: number,
  seed: number,
): AlbedoEstimate {
  const rng = makeLcg(seed);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < samples; i++) {
    const h = sampleGGXVNDF(roughness, view, rng(), rng());
    const hv = Math.max(dot3(view, h), 0);
    const l: [number, number, number] = [
      2 * hv * h[0] - view[0],
      2 * hv * h[1] - view[1],
      2 * hv * h[2] - view[2],
    ];
    const dotNL = l[2]; // N = +Z
    if (dotNL <= 0) {
      continue;
    }
    const weight = g1Smith(dotNL, roughness) * fSchlick(hv, f0);
    sum += weight;
    sumSq += weight * weight;
  }
  const mean = sum / samples;
  const variance = Math.max(sumSq / samples - mean * mean, 0);
  return { mean, standardError: Math.sqrt(variance / samples) };
}
