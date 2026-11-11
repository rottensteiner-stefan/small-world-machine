/**
 * Grass clump varieties + procedural clump geometry for the ground cover (ADR 0059 step 1b).
 *
 * Industry model: Unreal Engine "Landscape Grass Type" / "Grass Variety" (one entry per mesh with
 * density, scale range, cull distance), here with a procedural mesh: one instance = a CLUMP of
 * real curved, tapered blades (no alpha texture) plus optional flower heads. Clumps raise the
 * blade density without multiplying record/cull cost.
 */
import {
  BoundingBox,
  GltfMaterialParser,
  type BoundingVolume,
  type GeometryDataInterface,
} from "@small-world-machine/engine";

export type Rgb = readonly [number, number, number];

/** One ground-cover variety (UE "Grass Variety" analogue). */
export interface GrassVariety {
  /** @domain Stable id (field/prototype naming, debugging). */
  readonly id: string;
  /** @domain Share of the system density (clumps per m²) this variety takes; shares need not sum to 1. */
  readonly share: number;
  /** @domain Blades per clump in the near / far bucket (far = prefix of the same layout, no pop). */
  readonly blades: number;
  readonly bladesFar: number;
  /** @domain Clump footprint radius, blade height (m, scale 1), blade half-width (m). */
  readonly radius: number;
  readonly height: number;
  readonly width: number;
  /** @domain Outward lean as a fraction of the blade height, [min, max]. */
  readonly lean: readonly [number, number];
  /** @domain sRGB blade colour at the base / tip. */
  readonly base: Rgb;
  readonly tip: Rgb;
  /** @domain Optional flower head on every stem (petal fan + centre, tilted toward a random azimuth). */
  readonly flower?: {
    readonly petals: number;
    readonly size: number;
    readonly petal: Rgb;
    readonly centre: Rgb;
  };
}

/** Foliage-mask alpha of blade base / tip (leaf-backlight transmission weighting). */
const COVER_ALPHA_BASE = 1;
const COVER_ALPHA_TIP = 0.85;

/** Temperate meadow preset: five grasses + two flowers (the showcase 51 set). */
export const MEADOW_GRASS_VARIETIES: readonly GrassVariety[] = [
  {
    id: "fine",
    share: 0.32,
    blades: 16,
    bladesFar: 6,
    radius: 0.2,
    height: 0.42,
    width: 0.01,
    lean: [0.15, 0.45],
    base: [0.3, 0.47, 0.22],
    tip: [0.42, 0.56, 0.26],
  },
  {
    id: "meadow",
    share: 0.26,
    blades: 12,
    bladesFar: 5,
    radius: 0.25,
    height: 0.78,
    width: 0.012,
    lean: [0.2, 0.5],
    base: [0.28, 0.45, 0.2],
    tip: [0.46, 0.6, 0.28],
  },
  {
    id: "broad",
    share: 0.14,
    blades: 7,
    bladesFar: 4,
    radius: 0.2,
    height: 0.45,
    width: 0.03,
    lean: [0.3, 0.65],
    base: [0.24, 0.42, 0.18],
    tip: [0.36, 0.55, 0.24],
  },
  {
    id: "straw",
    share: 0.14,
    blades: 10,
    bladesFar: 4,
    radius: 0.22,
    height: 0.62,
    width: 0.011,
    lean: [0.2, 0.55],
    base: [0.42, 0.44, 0.24],
    tip: [0.72, 0.66, 0.4],
  },
  {
    id: "tuft",
    share: 0.14,
    blades: 22,
    bladesFar: 7,
    radius: 0.11,
    height: 0.26,
    width: 0.009,
    lean: [0.1, 0.35],
    base: [0.2, 0.36, 0.15],
    tip: [0.32, 0.48, 0.2],
  },
  {
    id: "buttercup",
    share: 0.05,
    blades: 3,
    bladesFar: 3,
    radius: 0.14,
    height: 0.62,
    width: 0.005,
    lean: [0.05, 0.25],
    base: [0.25, 0.42, 0.18],
    tip: [0.32, 0.5, 0.22],
    flower: { petals: 5, size: 0.05, petal: [0.96, 0.82, 0.12], centre: [0.85, 0.65, 0.1] },
  },
  {
    id: "daisy",
    share: 0.04,
    blades: 3,
    bladesFar: 3,
    radius: 0.14,
    height: 0.5,
    width: 0.005,
    lean: [0.05, 0.25],
    base: [0.25, 0.42, 0.18],
    tip: [0.32, 0.5, 0.22],
    flower: { petals: 10, size: 0.045, petal: [0.95, 0.95, 0.92], centre: [0.95, 0.8, 0.15] },
  },
];

/**
 * Builds one clump of `spec`: `bladeCount` curved, tapered blades inside `spec.radius` (5 verts /
 * 3 tris each: base pair, bent mid pair, tip), plus a petal fan + centre on each stem tip for
 * flower varieties. The layout comes from a per-variety FIXED-seed hash (`varietyIndex`), so the
 * far bucket is an exact prefix of the near bucket (surviving blades never move at the switch).
 * Normals are world-up (ground-hugging shading); the colour stream carries linear albedo +
 * foliage mask. Flower discs are tilted 35-65 deg toward a random azimuth (a level disc is
 * edge-on from eye height); field draws are double-sided.
 */
export function buildGrassClumpGeometry(
  spec: GrassVariety,
  varietyIndex: number,
  bladeCount: number,
): GeometryDataInterface {
  const toLinear = (c: Rgb): number[] => [
    GltfMaterialParser.engineSRGBToLinear(c[0]),
    GltfMaterialParser.engineSRGBToLinear(c[1]),
    GltfMaterialParser.engineSRGBToLinear(c[2]),
  ];
  const base = toLinear(spec.base);
  const tip = toLinear(spec.tip);
  const flower = spec.flower;
  const petal = flower ? toLinear(flower.petal) : tip;
  const centre = flower ? toLinear(flower.centre) : tip;
  let state = (0x51c0ffee + varietyIndex * 0x9e3779b9) | 0;
  const rand = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const headVerts = flower ? flower.petals * 2 + 1 : 0;
  const vertsPerBlade = 5 + headVerts;
  const trisPerBlade = 3 + (flower ? flower.petals : 0);
  const vertexCount = bladeCount * vertsPerBlade;
  const vertices = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Float32Array(vertexCount * 4);
  const indices = new Uint32Array(bladeCount * trisPerBlade * 3);
  let io = 0;
  const put = (
    v: number,
    x: number,
    y: number,
    z: number,
    rgb: readonly number[],
    mask: number,
  ): void => {
    vertices.set([x, y, z], v * 3);
    normals[v * 3 + 1] = 1;
    colors.set([rgb[0]!, rgb[1]!, rgb[2]!, mask], v * 4);
  };
  for (let b = 0; b < bladeCount; b++) {
    const r = spec.radius * Math.sqrt(rand());
    const a = rand() * Math.PI * 2;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const facing = rand() * Math.PI;
    const fx = Math.cos(facing);
    const fz = Math.sin(facing);
    const h = spec.height * (0.6 + 0.4 * rand());
    const lean = spec.lean[0] + (spec.lean[1] - spec.lean[0]) * rand();
    const lx = (r > 1e-4 ? cx / r : 1) * lean * h;
    const lz = (r > 1e-4 ? cz / r : 0) * lean * h;
    const w = spec.width * (0.8 + 0.4 * rand());
    const hue = 0.85 + 0.3 * rand();
    const first = b * vertsPerBlade;
    const rings: readonly (readonly number[])[] = [
      [cx, 0, cz, w, 0],
      [cx + lx * 0.3, h * 0.55, cz + lz * 0.3, w * 0.75, 0.55],
      [cx + lx, h, cz + lz, 0, 1],
    ];
    let v = first;
    for (let ring = 0; ring < 3; ring++) {
      const [x, y, z, hw, t] = rings[ring]!;
      const count = ring === 2 ? 1 : 2;
      for (let side = 0; side < count; side++) {
        const sgn = count === 1 ? 0 : side === 0 ? -1 : 1;
        const rgb = [0, 1, 2].map((c) => (base[c]! + (tip[c]! - base[c]!) * t!) * hue);
        put(
          v,
          x! + fx * hw! * sgn,
          y!,
          z! + fz * hw! * sgn,
          rgb,
          COVER_ALPHA_BASE + (COVER_ALPHA_TIP - COVER_ALPHA_BASE) * t!,
        );
        uvs.set([0.5 + 0.5 * sgn, t!], v * 2);
        v++;
      }
    }
    indices.set(
      [
        first,
        first + 1,
        first + 2,
        first + 1,
        first + 3,
        first + 2,
        first + 2,
        first + 3,
        first + 4,
      ],
      io,
    );
    io += 9;
    if (flower) {
      // Petal fan around the stem tip, the disc tilted 35-65 deg up toward a random azimuth
      // (a level disc is edge-on from eye height and vanishes). Field draws are double-sided.
      const hx = cx + lx;
      const hy = h;
      const hz = cz + lz;
      const az = rand() * Math.PI * 2;
      const tilt = 0.6 + 0.5 * rand();
      // Disc basis: e1 = azimuth direction tilted up, e2 = horizontal perpendicular.
      const e1x = Math.cos(az) * Math.cos(tilt);
      const e1y = Math.sin(tilt);
      const e1z = Math.sin(az) * Math.cos(tilt);
      const e2x = -Math.sin(az);
      const e2z = Math.cos(az);
      const discPut = (vi: number, u: number, w2: number): void =>
        put(
          vi,
          hx + (u * e1x + w2 * e2x) * flower.size,
          hy + u * e1y * flower.size,
          hz + (u * e1z + w2 * e2z) * flower.size,
          petal,
          0.5,
        );
      const c0 = first + 5;
      put(c0, hx, hy, hz, centre, 0.5);
      const spin = rand() * Math.PI * 2;
      for (let k = 0; k < flower.petals; k++) {
        const a0 = spin + (k / flower.petals) * Math.PI * 2;
        const a1 = a0 + ((Math.PI * 2) / flower.petals) * 0.75;
        const p0 = c0 + 1 + k * 2;
        discPut(p0, Math.cos(a0), Math.sin(a0));
        discPut(p0 + 1, Math.cos(a1), Math.sin(a1));
        indices.set([c0, p0, p0 + 1], io);
        io += 3;
      }
    }
  }
  return {
    vertices,
    indices,
    normals,
    uvs,
    colors,
    getBoundingVolume: (): BoundingVolume => BoundingBox.fromVertices(vertices),
  };
}
