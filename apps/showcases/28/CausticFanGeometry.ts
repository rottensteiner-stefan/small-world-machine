import { AbstractGeometry } from "@small-world-machine/engine";

/**
 * Dynamic 2D planar fan geometry on the laboratory bench surface (XZ plane at y = 0.005),
 * representing the continuous chromatic caustic dispersion wash connecting the prism exit face
 * directly to the detector graticule impact or free-flight trajectory (Plan P2-1).
 *
 * 8 boundary generators (indices 0..7) define 7 contiguous quads corresponding 1:1 to the 7
 * spectral wavelengths (Red, Orange, Yellow, Green, Cyan, Blue, Violet).
 * Total: 16 vertices, 7 quads = 14 triangles = 42 indices.
 */
export class CausticFanGeometry extends AbstractGeometry {
  constructor() {
    super();
    this.generateGeometryData();
  }

  protected override generateGeometryData(): void {
    // 8 boundaries * 2 vertices (exit and end) = 16 vertices
    this._vertices = new Float32Array(16 * 3);
    this._normals = new Float32Array(16 * 3);
    this._uvs = new Float32Array(16 * 2);

    // Initial normals pointing straight up (+Y)
    for (let i = 0; i < 16; i++) {
      this._normals[i * 3 + 1] = 1.0;
    }

    // Fixed UV layout:
    // u across boundaries [0..1]
    // v along length [0 = exit at prism base, 1 = endpoint on detector/bench]
    for (let k = 0; k < 8; k++) {
      const u = k / 7.0;
      const vExit = 2 * k;
      const vEnd = 2 * k + 1;
      this._uvs[vExit * 2] = u;
      this._uvs[vExit * 2 + 1] = 0.0;
      this._uvs[vEnd * 2] = u;
      this._uvs[vEnd * 2 + 1] = 1.0;
    }

    // 7 quads = 14 triangles = 42 indices
    const indices = new Uint16Array(7 * 6);
    let ptr = 0;
    for (let q = 0; q < 7; q++) {
      const v0 = 2 * q; // Left exit
      const v1 = 2 * q + 1; // Left end
      const v2 = 2 * (q + 1); // Right exit
      const v3 = 2 * (q + 1) + 1; // Right end

      // Triangle 1
      indices[ptr++] = v0;
      indices[ptr++] = v1;
      indices[ptr++] = v2;

      // Triangle 2
      indices[ptr++] = v2;
      indices[ptr++] = v1;
      indices[ptr++] = v3;
    }
    this._indices = indices;
  }
}
