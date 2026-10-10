import { AbstractGeometry } from "@small-world-machine/engine";

/** The five regular convex polyhedra; only the trivalent solids are enumerated here (the
 *  cube already exists in the engine core as `Cube`). */
export type PlatonicSolidType = "tetrahedron" | "octahedron" | "icosahedron" | "dodecahedron";

/**
 * Configuration options for platonic solid geometry.
 */
export interface PlatonicSolidOptions {
  /** Which regular solid to generate. Defaults to "icosahedron". */
  solid?: PlatonicSolidType;
  /** The radius of the circumscribed sphere. Defaults to 1. */
  radius?: number;
  /** Subdivision level (0 = the raw solid, >0 = geodetic refinement). Defaults to 0. */
  detail?: number;
}

const GOLDEN_RATIO: number = (1 + Math.sqrt(5)) / 2;

/** Regular tetrahedron, centered on the origin with edge length 2√2. */
const TETRAHEDRON_VERTICES: readonly number[] = [1, 1, 1, 1, -1, -1, -1, 1, -1, -1, -1, 1];

/** Regular octahedron (axis-aligned). */
const OCTAHEDRON_VERTICES: readonly number[] = [
  1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1,
];

/** Regular icosahedron (golden-ratio construction). */
const ICOSAHEDRON_VERTICES: readonly number[] = [
  -1,
  GOLDEN_RATIO,
  0,
  1,
  GOLDEN_RATIO,
  0,
  -1,
  -GOLDEN_RATIO,
  0,
  1,
  -GOLDEN_RATIO,
  0,
  0,
  -1,
  GOLDEN_RATIO,
  0,
  1,
  GOLDEN_RATIO,
  0,
  -1,
  -GOLDEN_RATIO,
  0,
  1,
  -GOLDEN_RATIO,
  GOLDEN_RATIO,
  0,
  -1,
  GOLDEN_RATIO,
  0,
  1,
  -GOLDEN_RATIO,
  0,
  -1,
  -GOLDEN_RATIO,
  0,
  1,
];

/** Triangular faces of the regular tetrahedron. */
const TETRAHEDRON_FACES: readonly (readonly number[])[] = [
  [0, 2, 1],
  [0, 1, 3],
  [0, 3, 2],
  [1, 2, 3],
];

/** Triangular faces of the regular octahedron. */
const OCTAHEDRON_FACES: readonly (readonly number[])[] = [
  [0, 2, 4],
  [4, 2, 1],
  [1, 2, 5],
  [5, 0, 4],
  [0, 3, 5],
  [5, 3, 1],
  [1, 3, 4],
  [4, 3, 0],
];

/** Triangular faces of the regular icosahedron. */
const ICOSAHEDRON_FACES: readonly (readonly number[])[] = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
];

/**
 * Builds the regular dodecahedron as the polar dual of the icosahedron: each dual vertex is
 * the normalized centroid of an icosahedron face, dual edges join dual vertices whose faces
 * share an edge, and dual faces correspond to the (pentagonal) star of each icosahedron
 * vertex, cyclically ordered around its direction. This never needs a hand-wired pentagon
 * table, and by construction yields V=20, E=30, F=12 with a single edge length.
 */
function buildDodecahedron(): {
  vertices: number[];
  faces: (readonly number[])[];
} {
  const faceCount = ICOSAHEDRON_FACES.length;
  const dualVertices: number[] = [];
  for (const face of ICOSAHEDRON_FACES) {
    const cx =
      (ICOSAHEDRON_VERTICES[face[0]! * 3]! +
        ICOSAHEDRON_VERTICES[face[1]! * 3]! +
        ICOSAHEDRON_VERTICES[face[2]! * 3]!) /
      3;
    const cy =
      (ICOSAHEDRON_VERTICES[face[0]! * 3 + 1]! +
        ICOSAHEDRON_VERTICES[face[1]! * 3 + 1]! +
        ICOSAHEDRON_VERTICES[face[2]! * 3 + 1]!) /
      3;
    const cz =
      (ICOSAHEDRON_VERTICES[face[0]! * 3 + 2]! +
        ICOSAHEDRON_VERTICES[face[1]! * 3 + 2]! +
        ICOSAHEDRON_VERTICES[face[2]! * 3 + 2]!) /
      3;
    const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
    dualVertices.push(cx / len, cy / len, cz / len);
  }

  // Dual edges: every two icosahedron faces sharing an edge become an edge of the dual.
  const edgeToFace = new Map<string, number[]>();
  for (let fi = 0; fi < faceCount; fi++) {
    const face = ICOSAHEDRON_FACES[fi]!;
    for (let e = 0; e < 3; e++) {
      const a = face[e]!;
      const b = face[(e + 1) % 3]!;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const list = edgeToFace.get(key) ?? [];
      list.push(fi);
      edgeToFace.set(key, list);
    }
  }

  const dualEdgeSet = new Set<string>();
  const dualEdges: [number, number][] = [];
  for (const shared of edgeToFace.values()) {
    if (shared.length === 2) {
      const a = shared[0]!;
      const b = shared[1]!;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!dualEdgeSet.has(key)) {
        dualEdgeSet.add(key);
        dualEdges.push([a, b]);
      }
    }
  }

  // Dual faces: the star of each icosahedron vertex becomes a pentagonal face, its vertices
  // ordered by angle around the icosahedron vertex direction in the plane it spans.
  const faces: number[][] = [];
  for (let fi = 0; fi < faceCount; fi++) {
    const around: number[] = [];
    for (let fi2 = 0; fi2 < faceCount; fi2++) {
      if (ICOSAHEDRON_FACES[fi2]!.includes(fi)) around.push(fi2);
    }
    if (around.length !== 5) continue;

    const [vx, vy, vz] = [
      ICOSAHEDRON_VERTICES[fi * 3]!,
      ICOSAHEDRON_VERTICES[fi * 3 + 1]!,
      ICOSAHEDRON_VERTICES[fi * 3 + 2]!,
    ];
    const vLen = Math.sqrt(vx * vx + vy * vy + vz * vz);

    // Orthonormal basis in the plane orthogonal to the vertex direction.
    let ux: number;
    let uy: number;
    let uz: number;
    if (Math.abs(vz) > 0.9) {
      ux = 1;
      uy = 0;
      uz = 0;
    } else {
      ux = vy;
      uy = -vx;
      uz = 0;
    }
    const uLen = Math.sqrt(ux * ux + uy * uy + uz * uz);
    ux /= uLen;
    uy /= uLen;
    uz /= uLen;

    const wx = (vy / vLen) * uz - (vz / vLen) * uy;
    const wy = (vz / vLen) * ux - (vx / vLen) * uz;
    const wz = (vx / vLen) * uy - (vy / vLen) * ux;

    around.sort((a, b) => {
      const [ax, ay, az] = [
        dualVertices[a * 3]!,
        dualVertices[a * 3 + 1]!,
        dualVertices[a * 3 + 2]!,
      ];
      const [bx, by, bz] = [
        dualVertices[b * 3]!,
        dualVertices[b * 3 + 1]!,
        dualVertices[b * 3 + 2]!,
      ];
      const angA = Math.atan2(ax * wx + ay * wy + az * wz, ax * ux + ay * uy + az * uz);
      const angB = Math.atan2(bx * wx + by * wy + bz * wz, bx * ux + by * uy + bz * uz);
      return angA - angB;
    });
    faces.push(around);
  }

  return { vertices: dualVertices, faces };
}

const DODECAHEDRON: { vertices: number[]; faces: readonly (readonly number[])[] } =
  buildDodecahedron();

/**
 * A regular convex polyhedron -- tetrahedron, octahedron, icosahedron, or dodecahedron --
 * optionally refined into a geodetic sphere via subdivision. Vertices are normalized onto
 * the circumscribed sphere of `radius`.
 */
export class PlatonicSolid extends AbstractGeometry {
  /** The regular solid being generated. */
  public solid: PlatonicSolidType;
  /** The radius of the circumscribed sphere. */
  public radius: number;
  /** Subdivision level. */
  public detail: number;

  /**
   * Creates a new platonic solid geometry.
   * @param options The configuration options.
   */
  constructor(options: PlatonicSolidOptions = {}) {
    super();
    this.solid = options.solid ?? "icosahedron";
    this.radius = Math.max(0.0001, options.radius ?? 1);
    this.detail = Math.max(0, Math.floor(options.detail ?? 0));
    this.generateGeometryData();
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    let v: number[];
    let faces: readonly (readonly number[])[];

    switch (this.solid) {
      case "tetrahedron":
        v = [...TETRAHEDRON_VERTICES];
        faces = TETRAHEDRON_FACES;
        break;
      case "octahedron":
        v = [...OCTAHEDRON_VERTICES];
        faces = OCTAHEDRON_FACES;
        break;
      case "dodecahedron":
        v = [...DODECAHEDRON.vertices];
        faces = DODECAHEDRON.faces;
        break;
      default:
        v = [...ICOSAHEDRON_VERTICES];
        faces = ICOSAHEDRON_FACES;
        break;
    }

    let faceList: number[][] = faces.map((f) => [...f]);
    for (let d = 0; d < this.detail; d++) {
      const midCache = new Map<string, number>();
      const nextV: number[] = [...v];
      const nextF: number[][] = [];
      for (const f of faceList) {
        const midPoints: number[] = [];
        for (let e = 0; e < 3; e++) {
          const a = f[e]!;
          const b = f[(e + 1) % 3]!;
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          let mi = midCache.get(key);
          if (mi === undefined) {
            const mx = (v[a * 3]! + v[b * 3]!) / 2;
            const my = (v[a * 3 + 1]! + v[b * 3 + 1]!) / 2;
            const mz = (v[a * 3 + 2]! + v[b * 3 + 2]!) / 2;
            nextV.push(mx, my, mz);
            mi = nextV.length / 3 - 1;
            midCache.set(key, mi);
          }
          midPoints.push(mi);
        }
        const a = f[0]!;
        const b = f[1]!;
        const c = f[2]!;
        const ab = midPoints[0]!;
        const bc = midPoints[1]!;
        const ca = midPoints[2]!;
        nextF.push([a, ab, ca]);
        nextF.push([ab, b, bc]);
        nextF.push([ca, bc, c]);
        nextF.push([ab, bc, ca]);
      }
      v = nextV;
      faceList = nextF;
    }

    // Normalize every generated vertex onto the circumscribed sphere of the requested radius.
    for (let i = 0; i < v.length; i += 3) {
      const len = Math.sqrt(v[i]! * v[i]! + v[i + 1]! * v[i + 1]! + v[i + 2]! * v[i + 2]!);
      if (len > 0.000001) {
        v[i] = (v[i]! / len) * this.radius;
        v[i + 1] = (v[i + 1]! / len) * this.radius;
        v[i + 2] = (v[i + 2]! / len) * this.radius;
      }
    }

    const uv: number[] = [];
    const idx: number[] = [];
    for (const f of faceList) {
      // Triangulate polygonal faces as a fan from the first vertex.
      for (let k = 2; k < f.length; k++) {
        idx.push(f[0]!, f[k - 1]!, f[k]!);
      }
    }
    for (let i = 0; i < v.length; i += 3) {
      const vx = v[i]!;
      const vy = v[i + 1]!;
      const vz = v[i + 2]!;
      const u = 0.5 + Math.atan2(vz, vx) / (2 * Math.PI);
      const vCoord = 0.5 - Math.asin(Math.min(1, Math.max(-1, vy / this.radius))) / Math.PI;
      uv.push(u, vCoord);
    }

    this._vertices = new Float32Array(v);
    this._uvs = new Float32Array(uv);
    this._indices = this._createIndexArray(idx.length);
    this._indices.set(idx);
    this.computeNormals();
  }
}
