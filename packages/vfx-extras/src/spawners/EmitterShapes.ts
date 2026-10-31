import type { Vector3D } from "@small-world-machine/engine";

/**
 * Pure, zero-allocation geometric spawn samplers that write into caller-owned `Vector3D`
 * scratch instances. Position/velocity results are in world space (right-handed: +X right,
 * +Y up, +Z backward). Every function takes a seeded `rng: () => number` so a fixed seed
 * reproduces a bit-identical layout (golden-capture discipline), and draws only from `rng`.
 */

/**
 * Samples a position uniformly inside the sphere volume (radius respects `∛u` so the interior is
 * uniformly dense, not center-heavy). Writes into `out` (caller-owned scratch).
 * @param out Caller-owned scratch receiving the position.
 * @param rng Seeded uniform random source in [0, 1).
 * @param center @domain Sphere center in world space.
 * @param radius @domain Sphere radius in meters; non-negative.
 */
export function sampleSphere(
  out: Vector3D,
  rng: () => number,
  center: Vector3D,
  radius: number,
): void {
  const r = radius * Math.cbrt(rng());
  const theta = rng() * 6.283185307179586;
  const z = rng() * 2 - 1;
  const s = Math.sqrt(Math.max(0, 1 - z * z));
  out.x = center.x + r * s * Math.cos(theta);
  out.y = center.y + r * z;
  out.z = center.z + r * s * Math.sin(theta);
}

/**
 * Samples a position uniformly on the sphere shell (fixed radius). Writes into `out`.
 * @param out Caller-owned scratch receiving the position.
 * @param rng Seeded uniform random source in [0, 1).
 * @param center @domain Sphere center in world space.
 * @param radius @domain Shell radius in meters; non-negative.
 */
export function sampleSphereShell(
  out: Vector3D,
  rng: () => number,
  center: Vector3D,
  radius: number,
): void {
  const theta = rng() * 6.283185307179586;
  const z = rng() * 2 - 1;
  const s = Math.sqrt(Math.max(0, 1 - z * z));
  out.x = center.x + radius * s * Math.cos(theta);
  out.y = center.y + radius * z;
  out.z = center.z + radius * s * Math.sin(theta);
}

/**
 * Samples a directional burst from a cone: position on the base disc (radius `baseRadius`) at
 * `origin`, velocity within the cone opening `halfAngle` around `axisDir` scaled by `speed`.
 * Writes into both `out` and `outVel` (caller-owned scratches).
 * @param out Caller-owned scratch receiving the position.
 * @param outVel Caller-owned scratch receiving the velocity (world space).
 * @param rng Seeded uniform random source in [0, 1).
 * @param origin @domain Cone apex in world space.
 * @param axisDir @domain Cone axis direction (does not need to be normalized).
 * @param halfAngle @domain Cone opening half-angle in radians, clamped to [0, π/2].
 * @param speed @domain Radial speed magnitude in meters/second; non-negative.
 * @param baseRadius @domain Emitter disc radius at the apex, in meters; defaults to 0.
 */
export function sampleCone(
  out: Vector3D,
  outVel: Vector3D,
  rng: () => number,
  origin: Vector3D,
  axisDir: Vector3D,
  halfAngle: number,
  speed: number,
  baseRadius: number = 0,
): void {
  const ax = axisDir.x;
  const ay = axisDir.y;
  const az = axisDir.z;
  const axisLen = Math.hypot(ax, ay, az);
  const nx = axisLen > 0 ? ax / axisLen : 0;
  const ny = axisLen > 0 ? ay / axisLen : 1;
  const nz = axisLen > 0 ? az / axisLen : 0;

  // Orthonormal basis around the axis (right-handed).
  let hx = 0;
  let hy = 1;
  const hz = 0;
  if (Math.abs(ny) > 0.9999) {
    hx = 1;
    hy = 0;
  }
  let rx = ny * hz - nz * hy;
  let ry = nz * hx - nx * hz;
  let rz = nx * hy - ny * hx;
  const rl = Math.hypot(rx, ry, rz);
  rx = rl > 0 ? rx / rl : 1;
  ry = rl > 0 ? ry / rl : 0;
  rz = rl > 0 ? rz / rl : 0;
  const ux = ry * nz - rz * ny;
  const uy = rz * nx - rx * nz;
  const uz = rx * ny - ry * nx;

  // Position: uniform disc at the apex (∛-free uniform disc via sqrt(u)).
  const theta = rng() * 6.283185307179586;
  const discR = baseRadius * Math.sqrt(rng());
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  out.x = origin.x + (rx * cosT + ux * sinT) * discR;
  out.y = origin.y + (ry * cosT + uy * sinT) * discR;
  out.z = origin.z + (rz * cosT + uz * sinT) * discR;

  // Velocity: direction uniformly distributed in solid angle on the spherical cap [0, halfAngle].
  // Archimedes' hat-box theorem: cos(theta) is uniform in [cos(alpha), 1].
  const clampedAngle = Math.max(0, Math.min(halfAngle, Math.PI));
  const cosAlpha = Math.cos(clampedAngle);
  const cosTheta = 1 - rng() * (1 - cosAlpha);
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const thetaV = rng() * 6.283185307179586;
  const cv = Math.cos(thetaV);
  const sv = Math.sin(thetaV);
  const px = rx * cv + ux * sv;
  const py = ry * cv + uy * sv;
  const pz = rz * cv + uz * sv;
  outVel.x = (nx * cosTheta + px * sinTheta) * speed;
  outVel.y = (ny * cosTheta + py * sinTheta) * speed;
  outVel.z = (nz * cosTheta + pz * sinTheta) * speed;
}

/**
 * Samples a position uniformly inside an axis-aligned box. Writes into `out`.
 * @param out Caller-owned scratch receiving the position.
 * @param rng Seeded uniform random source in [0, 1).
 * @param min @domain Box minimum corner in world space.
 * @param max @domain Box maximum corner in world space.
 */
export function sampleBox(out: Vector3D, rng: () => number, min: Vector3D, max: Vector3D): void {
  out.x = min.x + (max.x - min.x) * rng();
  out.y = min.y + (max.y - min.y) * rng();
  out.z = min.z + (max.z - min.z) * rng();
}

/**
 * Samples a position on a horizontal ring / annulus in the XZ plane (+Y is world up), centered on
 * `center`. `thickness = 0` yields the exact ring radius. Writes into `out`.
 * @param out Caller-owned scratch receiving the position.
 * @param rng Seeded uniform random source in [0, 1).
 * @param center @domain Ring center in world space.
 * @param radius @domain Ring radius in meters; non-negative.
 * @param thickness @domain Annulus band width in meters, clamped to `>= 0`; defaults to 0.
 */
export function sampleRing(
  out: Vector3D,
  rng: () => number,
  center: Vector3D,
  radius: number,
  thickness: number = 0,
): void {
  const half = Math.max(0, thickness) * 0.5;
  const rMin = Math.max(0, radius - half);
  const rMax = Math.max(0, radius + half);
  const rr = Math.sqrt(rMin * rMin + rng() * (rMax * rMax - rMin * rMin));
  const theta = rng() * 6.283185307179586;
  out.x = center.x + rr * Math.cos(theta);
  out.y = center.y;
  out.z = center.z + rr * Math.sin(theta);
}
