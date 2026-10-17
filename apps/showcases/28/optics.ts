import {
  CauchyMaterials,
  Color,
  MathUtils,
  Optics,
  Ray2D,
  Vector2D,
} from "@small-world-machine/engine";

// ----------------------------------------------------------------------------
// Real prism optics: Snell's law at both surfaces of the equilateral-triangle prism, with a
// Cauchy-dispersion refractive index per wavelength, instead of hand-placed decorative angles.
// All 2D math below works in the world XZ plane (a `Vector2D`'s `.y` field stores world Z here,
// since the prism's triangular cross-section and the incident beam both lie in a horizontal
// plane -- see PRISM_RADIUS/PRISM_APEX_ANGLE usage in `computeSpectralRays()`).
// ----------------------------------------------------------------------------

export const PRISM_RADIUS = 1.2; // matches the CentralPrism Cylinder's radiusTop/radiusBottom
// The equilateral-triangle cross-section (Cylinder radialSegments: 3) has a 60-degree interior
// angle at each vertex -- the classic prism "apex angle" A in the θ2 + θ3 = A refraction
// relation, which drives the incidence-angle choice below (not used as a separate runtime value:
// the actual vertex geometry in computeSpectralRays() already encodes it).
// Chosen so every spectral color refracts back out through the far face without hitting total
// internal reflection there (critical angle ~36-38 degrees for the dispersion range below), while
// still landing safely inside the entry face's 120-degree angular span, clear of its edges, across
// the turntable's +-0.12 rad wobble (see update()). Re-tuned from the old 44deg/+-0.25 rad per plan
// P0-2: a numeric range scan over the FULL new wobble window proves all 7 bands stay valid at EVERY
// angle in [-0.12, +0.12] only for NOMINAL in the upper part of the plan's 48-50deg band -- 50deg
// keeps a ~+-0.13 rad symmetric 7/7 margin, so NOMINAL=50deg was chosen (see apps/showcases/28/docs/log.md).
export const NOMINAL_INCIDENCE_ANGLE = MathUtils.degToRad(50);
export const SPECTRAL_RAY_LENGTH = 4.8;

export interface SpectrumBand {
  name: string;
  color: Color;
  wavelengthNm: number;
  /** Per-band emissive gain (CIE-luminosity compensation): the loud yellow/green middle is pulled
   * down and the dim red/blue/violet extremes pushed up so every spectral band reads at comparable
   * brightness on the dark detector (plan P0-3: "even red->violet read"). */
  luminosity: number;
}

export const SPECTRUM: SpectrumBand[] = [
  { name: "Red", color: new Color(1.0, 0.05, 0.05), wavelengthNm: 700, luminosity: 1.15 },
  { name: "Orange", color: new Color(1.0, 0.45, 0.0), wavelengthNm: 620, luminosity: 0.95 },
  { name: "Yellow", color: new Color(1.0, 0.9, 0.05), wavelengthNm: 580, luminosity: 0.7 },
  { name: "Green", color: new Color(0.1, 1.0, 0.2), wavelengthNm: 530, luminosity: 0.6 },
  { name: "Cyan", color: new Color(0.05, 0.9, 1.0), wavelengthNm: 490, luminosity: 0.75 },
  { name: "Blue", color: new Color(0.1, 0.3, 1.0), wavelengthNm: 460, luminosity: 0.95 },
  { name: "Violet", color: new Color(0.7, 0.1, 1.0), wavelengthNm: 400, luminosity: 1.1 },
];

/** Outward normal of edge `a`-`b`, for a convex polygon centred on the origin (true here: the
 * prism's triangular cross-section is centred at world (0, 0) in XZ). */
export function outwardFaceNormal(a: Vector2D, b: Vector2D): Vector2D {
  return new Vector2D((a.x + b.x) / 2, (a.y + b.y) / 2).normalize();
}

export interface SpectralRay {
  name: string;
  color: Color;
  /** Real intersection of the beam with the prism's entry face (world XZ). */
  entryPoint: Vector2D;
  /** Real exit point on the prism's far face (world XZ) -- the start of the free-flight segment. */
  exitPoint: Vector2D;
  /** Start of the free-flight segment. */
  origin: Vector2D;
  direction: Vector2D;
}

/**
 * Traces each spectral band through the triangular prism using real Snell's-law refraction at
 * both surfaces, instead of hand-placed decorative fan angles. `prismRotation` must be the
 * prism's actual, *current* `rotation.y` (base rotation plus the turntable's live wobble --
 * see `update()`, which calls this every frame). Assumes the prism is centred at world XZ
 * (0, 0) and the incident beam travels along +X at z = 0 (matching the SpotLight/incident-beam
 * objects in `setupScene()`).
 *
 * Returns one entry per `SPECTRUM` band, in the same order -- `undefined` where that color
 * undergoes total internal reflection at the far face for the given `prismRotation` (a real,
 * unavoidable outcome here: the turntable's +-0.25 rad wobble swings the entry incidence angle
 * across a wider range than this prism's flint-glass dispersion can refract out cleanly the
 * whole time -- see docs/adr note in update()). Callers must handle holes, not assume 7 rays.
 */
export function computeSpectralRays(prismRotation: number): (SpectralRay | undefined)[] {
  // Local vertex k sits at world angle (k * 120deg) before the prism's own rotation is applied
  // (matches Cylinder's own (radius*sin(theta), radius*cos(theta)) vertex generation).
  const vertices = [0, 1, 2].map((k) => {
    const theta = (k * 2 * Math.PI) / 3 + prismRotation;
    return new Vector2D(PRISM_RADIUS * Math.sin(theta), PRISM_RADIUS * Math.cos(theta));
  });

  const faces: [Vector2D, Vector2D][] = [
    [vertices[0]!, vertices[1]!],
    [vertices[1]!, vertices[2]!],
    [vertices[2]!, vertices[0]!],
  ];

  // The incident laser beam travels from the optical rail (-10, 0) along +X at z = 0.
  // Test all 3 polygon edges to find which face faces the incoming beam and gets struck.
  const incidentOrigin = new Vector2D(-10, 0);
  const incidentDir = new Vector2D(1, 0);
  const incidentRay = new Ray2D(incidentOrigin, incidentDir);

  let bestEntryHit: Vector2D | undefined;
  let bestEntryFaceIdx = -1;
  let bestEntryNormal: Vector2D | undefined;
  let minT = Infinity;

  for (let i = 0; i < 3; i++) {
    const face = faces[i]!;
    const hit = incidentRay.intersectSegment(face[0], face[1]);
    if (!hit) continue;
    const normal = outwardFaceNormal(face[0], face[1]);
    // Beam strikes the exterior face only when outward normal opposes beam direction
    if (normal.x * incidentDir.x + normal.y * incidentDir.y >= 0) continue;
    const t = hit.x - incidentOrigin.x;
    if (t < minT) {
      minT = t;
      bestEntryHit = hit;
      bestEntryFaceIdx = i;
      bestEntryNormal = normal;
    }
  }

  if (!bestEntryHit || bestEntryFaceIdx === -1) {
    return SPECTRUM.map(() => undefined);
  }

  const otherFaceIndices = [0, 1, 2].filter((i) => i !== bestEntryFaceIdx);
  const otherFaces = otherFaceIndices.map((i) => faces[i]!);

  const rays: (SpectralRay | undefined)[] = [];
  for (const band of SPECTRUM) {
    // Real, dense-flint-glass Cauchy dispersion -- consistent with this showcase's own
    // "n = 1.65 flint glass" comment on the prism material (real n ranges ~1.629 red to ~1.688
    // violet with this preset).
    const n = Optics.cauchyIndex(band.wavelengthNm, CauchyMaterials.FLINT_GLASS);
    const internalDir = Optics.refract(incidentDir, bestEntryNormal!, 1.0, n);
    if (!internalDir) {
      rays.push(undefined);
      continue;
    }

    let exitPoint: Vector2D | undefined;
    let exitFace: [Vector2D, Vector2D] | undefined;
    const internalRay = new Ray2D(bestEntryHit, internalDir);
    for (const face of otherFaces) {
      const hit = internalRay.intersectSegment(face[0], face[1]);
      if (hit) {
        exitPoint = hit;
        exitFace = face;
        break;
      }
    }
    if (!exitPoint || !exitFace) {
      rays.push(undefined);
      continue;
    }

    const exitNormalOutward = outwardFaceNormal(exitFace[0], exitFace[1]);
    const exitNormalAgainstIncident = new Vector2D(-exitNormalOutward.x, -exitNormalOutward.y);
    const exitDir = Optics.refract(internalDir, exitNormalAgainstIncident, n, 1.0);
    if (!exitDir) {
      // Total internal reflection at the far face -- this color has no exit ray right now.
      rays.push(undefined);
      continue;
    }

    rays.push({
      name: band.name,
      color: band.color,
      entryPoint: bestEntryHit,
      exitPoint,
      origin: exitPoint,
      direction: exitDir,
    });
  }
  return rays;
}
