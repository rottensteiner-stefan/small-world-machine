/**
 * Vegetation species assets (ADR 0059): a baked LOD chain + per-material albedo layers + sidecar.
 *
 * Industry model: Unreal "Foliage Type" / SpeedTree asset — one loadable unit that carries the LOD
 * meshes, their materials and placement metadata. Here: `<stem>.species.json` (one entry per glTF
 * primitive, in primitive order = part order of the engine import, which drops material names),
 * `<stem>_LOD0..N.glb` (LOD0 finest) and the albedo files it lists (bound as an instance-field
 * `albedoArray`, layer = part ordinal via `materialLayers`).
 */
import type { BoundingVolume } from "@small-world-machine/engine/interfaces/BoundingVolume.js";
import type {
  GeometryDataInterface,
  Object3D,
  StandardMaterial,
} from "@small-world-machine/engine";
import {
  GltfLoader,
  GltfMaterialParser,
  TextureArray,
  Vector3D,
} from "@small-world-machine/engine";
import { BoundingBox } from "@small-world-machine/engine/physix/BoundingBox.js";

/** One mesh part of a vegetation prototype (trunk, branches, leaves, ...). */
export interface VegetationPart {
  readonly name: string;
  readonly geometry: GeometryDataInterface;
  readonly material: StandardMaterial;
  /** Local Y offset inside the plant (prototype origin = ground contact point). */
  readonly offsetY: number;
}

/** `<stem>.species.json` sidecar (written by the species bake). */
export interface SpeciesManifest {
  readonly stem: string;
  readonly levels?: number;
  readonly layers: readonly {
    readonly albedo: string;
    /** 1 = foliage (leaf backlight mask), 0 = wood. */
    readonly foliage: number;
    /** true = the albedo carries a cutout alpha (leaf cards). */
    readonly cutout?: boolean;
  }[];
}

/** A loaded species: parts of LOD0 (scene-graph lanes) + merged field geometry per LOD + albedo. */
export interface VegetationSpecies {
  readonly manifest: SpeciesManifest;
  /** LOD0 parts as imported (reference-shared; usable by scene-graph / auto-instancing lanes). */
  readonly lod0Parts: readonly VegetationPart[];
  /** Merged field geometry per level, FINEST FIRST (index = LOD index). */
  readonly lods: readonly GeometryDataInterface[];
  /** Albedo layers (one per part), `flipY: false` (glTF uv convention). */
  readonly albedo: TextureArray;
  /** Suggested field `alphaTest` (0.5 when any layer is a cutout, else 0). */
  readonly alphaTest: number;
}

/** Default cutout threshold of alpha-carrying albedo layers. */
const SPECIES_ALPHA_TEST = 0.5;

/**
 * Loads `<stem>.species.json`, every `<stem>_LOD<n>.glb` (n = 0 .. levels-1, default 4) and the
 * albedo layers from `basePath`. Atomic: any missing file or a part/layer count mismatch throws
 * with a descriptive message (callers fall back explicitly).
 */
export async function loadVegetationSpecies(
  stem: string,
  options: { basePath: string; levels?: number },
): Promise<VegetationSpecies> {
  const base = options.basePath.endsWith("/") ? options.basePath : `${options.basePath}/`;
  const response = await fetch(`${base}${stem}.species.json`);
  if (!response.ok)
    throw new Error(`[VegetationSpecies] ${stem}.species.json HTTP ${response.status}`);
  const manifest = (await response.json()) as SpeciesManifest;
  const levels = options.levels ?? manifest.levels ?? 4;
  const loader = new GltfLoader({ basePath: base });
  const partsPerLevel: VegetationPart[][] = [];
  for (let level = 0; level < levels; level++) {
    const parts = collectVegetationParts(await loader.load(`${stem}_LOD${level}.glb`));
    if (parts.length !== manifest.layers.length) {
      throw new Error(
        `[VegetationSpecies] ${stem}_LOD${level}: ${parts.length} parts vs ${manifest.layers.length} layers`,
      );
    }
    partsPerLevel.push(parts);
  }
  const albedo = await TextureArray.fromUrls(
    manifest.layers.map((l) => `${base}${l.albedo}`),
    { flipY: false },
  );
  return {
    manifest,
    lod0Parts: partsPerLevel[0]!,
    lods: partsPerLevel.map((parts) => mergeVegetationParts(parts, manifest)),
    albedo,
    alphaTest: manifest.layers.some((l) => l.cutout === true) ? SPECIES_ALPHA_TEST : 0,
  };
}

/**
 * Flattens a loaded plant into its mesh-bearing nodes (deterministic DFS order). Each node
 * becomes one {@link VegetationPart} reusing the imported geometry/material references. Only the
 * world-Y offset relative to the root is kept: the asset contract requires upright,
 * vertical-axis-centred plants (base at y=0), so X/Z offsets and part rotation are zero.
 */
export function collectVegetationParts(root: Object3D): VegetationPart[] {
  root.updateMatrixWorld(true);
  const rootY = root.getWorldPosition().y;
  const parts: VegetationPart[] = [];
  const scratch = new Vector3D();

  const visit = (node: Object3D): void => {
    if (node.geometry && node.material) {
      node.getWorldPosition(scratch);
      parts.push({
        name: node.name || "Part",
        geometry: node.geometry,
        material: node.material as StandardMaterial,
        offsetY: scratch.y - rootY,
      });
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
  return parts;
}

/**
 * Merges parts into ONE indexed geometry with each part's `offsetY` baked in (plant base stays at
 * y=0), for the instance-field lane. Colour stream: with a `manifest`, white albedo (the albedo
 * array carries the colour) + the sidecar foliage mask, and `materialLayers` = part ordinal;
 * without, the part material's linear base colour + "green-dominant = foliage" mask. Normals fall
 * back to world-up, uvs to (0, 0). Deterministic part-major order.
 */
export function mergeVegetationParts(
  parts: readonly VegetationPart[],
  manifest?: SpeciesManifest,
): GeometryDataInterface {
  let vertexCount = 0;
  let indexCount = 0;
  for (const part of parts) {
    const geo = part.geometry;
    vertexCount += geo.vertices.length / 3;
    indexCount += geo.indices?.length ?? 0;
  }
  if (vertexCount === 0 || indexCount === 0) {
    throw new Error("[VegetationSpecies] merge needs non-empty indexed geometry.");
  }
  const vertices = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  // Field colour stream: linear albedo of each part's material + foliage mask in alpha (the
  // V1 field draws one merged mesh per bucket, so per-part materials travel per vertex).
  const colors = new Float32Array(vertexCount * 4);
  // Species mode: white albedo (the albedo array carries the colour), layer = part ordinal.
  const species = manifest;
  const materialLayers = species ? new Float32Array(vertexCount) : undefined;
  let vo = 0;
  let io = 0;
  let partIndex = 0;
  for (const part of parts) {
    const geo = part.geometry;
    const partVertexCount = geo.vertices.length / 3;
    for (let v = 0; v < partVertexCount; v++) {
      const dest = (vo + v) * 3;
      vertices[dest] = geo.vertices[v * 3]!;
      vertices[dest + 1] = geo.vertices[v * 3 + 1]! + part.offsetY;
      vertices[dest + 2] = geo.vertices[v * 3 + 2]!;
      if (geo.normals) {
        normals[dest] = geo.normals[v * 3]!;
        normals[dest + 1] = geo.normals[v * 3 + 1]!;
        normals[dest + 2] = geo.normals[v * 3 + 2]!;
      } else {
        normals[dest + 1] = 1;
      }
    }
    if (geo.uvs) {
      uvs.set(geo.uvs, vo * 2);
    }
    const c = part.material.color;
    const r = GltfMaterialParser.engineSRGBToLinear(c.r);
    const g = GltfMaterialParser.engineSRGBToLinear(c.g);
    const b = GltfMaterialParser.engineSRGBToLinear(c.b);
    // Foliage = the green-dominant part (the asset contract carries no material names);
    // species mode takes the mask from the sidecar.
    const layer = species?.layers[partIndex];
    const foliage = layer ? layer.foliage : g > r ? 1 : 0;
    for (let v = 0; v < partVertexCount; v++) {
      const dest = (vo + v) * 4;
      colors[dest] = layer ? 1 : r;
      colors[dest + 1] = layer ? 1 : g;
      colors[dest + 2] = layer ? 1 : b;
      colors[dest + 3] = foliage;
    }
    if (materialLayers) materialLayers.fill(partIndex, vo, vo + partVertexCount);
    partIndex++;
    const partIndices = geo.indices!;
    for (let i = 0; i < partIndices.length; i++) {
      indices[io + i] = partIndices[i]! + vo;
    }
    vo += partVertexCount;
    io += partIndices.length;
  }
  return {
    vertices,
    indices,
    normals,
    uvs,
    colors,
    ...(materialLayers ? { materialLayers } : {}),
    getBoundingVolume: (): BoundingVolume => BoundingBox.fromVertices(vertices),
  };
}
