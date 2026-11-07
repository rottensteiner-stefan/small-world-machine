import { ModelGeometry } from "@small-world-machine/engine";

/**
 * Options for {@link createFlameCardGeometry}.
 */
export interface FlameCardGeometryOptions {
  /** Number of vertical cards rotated evenly around +Y. Defaults to 2 (X-shaped torch flame). */
  cards?: number;
  /** Card width in meters. Defaults to 0.15. */
  width?: number;
  /** Card height in meters. Defaults to 0.45. */
  height?: number;
}

/**
 * Builds crossed vertical flame cards standing on the origin (base at y = 0). Each card's +u runs
 * along `cross(+Y, normal)`, the axis `FireMaterial` projects its lean onto, and v runs base to tip.
 */
export function createFlameCardGeometry(options: FlameCardGeometryOptions = {}): ModelGeometry {
  const cards = Math.max(1, Math.floor(options.cards ?? 2));
  const halfWidth = (options.width ?? 0.15) / 2;
  const height = options.height ?? 0.45;

  const vertices: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let card = 0; card < cards; card++) {
    const angle = (card * Math.PI) / cards;
    const nx = Math.sin(angle);
    const nz = Math.cos(angle);
    const tx = nz * halfWidth;
    const tz = -nx * halfWidth;
    const base = card * 4;

    vertices.push(-tx, 0, -tz, tx, 0, tz, tx, height, tz, -tx, height, -tz);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    for (let corner = 0; corner < 4; corner++) {
      normals.push(nx, 0, nz);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  return new ModelGeometry(vertices, uvs, normals, indices);
}
