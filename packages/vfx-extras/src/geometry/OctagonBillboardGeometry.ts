import { BoundingSphere, Vector3D, type GeometryDataInterface } from "@small-world-machine/engine";

/**
 * Options for {@link createOctagonBillboardGeometry}.
 */
export interface OctagonBillboardGeometryOptions {
  /**
   * Outer diameter (width and height) of the octagon in local units.
   * @domain [0.001, Infinity) — defaults to 1.0 (spanning [-0.5, 0.5]).
   */
  size?: number;
}

/**
 * Builds an 8-vertex, 6-triangle (triangle-fan) octagon billboard geometry in the XY plane facing
 * `+Z`, with UVs mapped linearly to `[0, 1]^2`. Trims the four transparent corners of a unit quad
 * to reduce fragment overdraw on soft radial sprites (`EmberSpriteMaterial`, `SmokeSpriteMaterial`)
 * while keeping the `R = 0.5` inscribed circle intact.
 *
 * @param options Optional size configuration.
 * @returns Shared `GeometryDataInterface` suitable for `InstancedMesh` / `ParticleMeshRenderer`.
 */
export function createOctagonBillboardGeometry(
  options: OctagonBillboardGeometryOptions = {},
): GeometryDataInterface {
  const size = options.size ?? 1.0;
  const half = size * 0.5;
  // Regular octagon inscribed in theunit circle of radius `half`: 8 vertices at angles k * pi / 4
  // rotated by pi / 8 so flat edges sit parallel to the X and Y axes.
  const vertices = new Float32Array(8 * 3);
  const normals = new Float32Array(8 * 3);
  const uvs = new Float32Array(8 * 2);
  const tangents = new Float32Array(8 * 4);

  const step = Math.PI * 0.25;
  const offset = Math.PI * 0.125;

  for (let i = 0; i < 8; i++) {
    const angle = offset + i * step;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const vx = c * half;
    const vy = s * half;

    const v3 = i * 3;
    vertices[v3] = vx;
    vertices[v3 + 1] = vy;
    vertices[v3 + 2] = 0;

    normals[v3] = 0;
    normals[v3 + 1] = 0;
    normals[v3 + 2] = 1;

    const v2 = i * 2;
    uvs[v2] = c * 0.5 + 0.5;
    uvs[v2 + 1] = s * 0.5 + 0.5;

    const v4 = i * 4;
    tangents[v4] = 1;
    tangents[v4 + 1] = 0;
    tangents[v4 + 2] = 0;
    tangents[v4 + 3] = 1;
  }

  // CCW triangle fan from vertex 0: 6 triangles (18 indices) facing +Z.
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 6, 0, 6, 7]);

  // Perimeter wireframe edges (8 segments = 16 indices).
  const wireframeIndices = new Uint16Array([0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 0]);

  return {
    vertices,
    normals,
    uvs,
    tangents,
    indices,
    wireframeIndices,
    getBoundingVolume: () => new BoundingSphere(new Vector3D(0, 0, 0), half),
  };
}
