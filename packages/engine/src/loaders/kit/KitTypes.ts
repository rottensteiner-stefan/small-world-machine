/**
 * A light configuration attached to a prop socket.
 *
 * `type` is intentionally a string so it can accept both the engine class names used in some kits
 * (e.g. industrial/wall_lamp writes `"PointLight"`) and the lowercase spec form (`"point"`).
 */
export interface KitSocketLightConfig {
  type: string;
  color: string;
  intensity: number;
  distance: number;
}

/** A named attachment point on a kit prop (e.g. `FlameGlow`, `BulbLight`). */
export interface KitSocket {
  name: string;
  position: [number, number, number];
  /** Euler angles in radians (same convention as props). For a decal socket the local +Y axis is the surface normal. Defaults to none. */
  rotation?: [number, number, number];
  recommendedLight?: KitSocketLightConfig;
}

/** Physical box dimensions of a prop. */
export interface KitDimensions {
  width?: number;
  height: number;
  depth?: number;
  radius?: number;
}

/** The `meta.json` spec sheet living next to a kit prop's `model.glb` (ADR 0011). */
export interface PropMeta {
  id: string;
  name: string;
  category: string;
  kit: string;
  version: string;
  description: string;
  triangles: number;
  materials: number;
  textures: string[];
  dimensions: KitDimensions;
  recommendedScale: number;
  sockets?: KitSocket[];
  hazardClass?: string;
  author: string;
  license: string;
}

/** One item entry in a kit's `kit.json` manifest. */
export interface KitManifestItem {
  id: string;
  name: string;
  category: string;
  hazardClass?: string;
  path: string;
  preview: string;
  meta: string;
}

export interface KitTextureItem {
  id: string;
  name: string;
  category: string;
  maps: string[];
}

export interface KitDecalItem {
  id: string;
  name: string;
  /** Albedo (RGBA, alpha = coverage), a PNG in `decals/`. */
  file: string;
  /** Optional tangent-space normal map (PNG in `decals/`). */
  normal?: string;
  /** Optional packed map, engine convention: R = ambient occlusion, G = roughness, B = metallic. */
  orm?: string;
  /** Optional emission map (PNG in `decals/`). */
  emission?: string;
  /** Default box size in metres: [width, height, projection depth]. */
  size?: [number, number, number];
  /** Draw flat albedo without lighting (about half the cost of a lit decal). Defaults to false. */
  unlit?: boolean;
}

/** The `kit.json` manifest (ADR 0011). */
export interface KitManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  items?: KitManifestItem[];
  textures?: KitTextureItem[];
  decals?: KitDecalItem[];
  author: string;
  license: string;
}

/** Type guard validating that unknown data conforms to KitManifest. */
export function isKitManifest(data: unknown): data is KitManifest {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Partial<KitManifest>;
  return typeof d.id === "string" && typeof d.name === "string" && typeof d.version === "string";
}

/** Asserts that unknown data conforms to KitManifest, throwing an informative error otherwise. */
export function assertKitManifest(
  data: unknown,
  context: string = "KitManifest",
): asserts data is KitManifest {
  if (!isKitManifest(data)) {
    throw new Error(
      `[${context}] Invalid kit manifest data structure: expected id, name, and version strings.`,
    );
  }
}

/** Type guard validating that unknown data conforms to PropMeta. */
export function isPropMeta(data: unknown): data is PropMeta {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Partial<PropMeta>;
  return typeof d.id === "string" && typeof d.name === "string" && typeof d.kit === "string";
}

/** Asserts that unknown data conforms to PropMeta, throwing an informative error otherwise. */
export function assertPropMeta(
  data: unknown,
  context: string = "PropMeta",
): asserts data is PropMeta {
  if (!isPropMeta(data)) {
    throw new Error(
      `[${context}] Invalid prop meta data structure: expected id, name, and kit strings.`,
    );
  }
}

/** Overrides that a level instance can exert over a socket's recommended light. */
export interface SocketLightOverride {
  type?: string;
  color?: string;
  intensity?: number;
  distance?: number;
}

/** Overrides a level instance can exert over a prop's automatic socket light mounting. */
export interface KitPropLightOverrides {
  [socketName: string]: SocketLightOverride | false;
}

/** Material PBR overrides applied after a prop loads (level-instance tuning). */
export interface KitMaterialOverride {
  roughness?: number;
  metallic?: number;
  emissiveIntensity?: number;
  emissiveColor?: string;
}

/** Options controlling one `registry.loadProp` call. */
export interface LoadPropOptions {
  /** Absolute placement override. When omitted, the prop keeps identity transform. */
  position?: [number, number, number];
  rotation?: [number, number, number];
  /** Explicit scale override (a scalar or per-axis [x,y,z]). Overrides `recommendedScale`. */
  scale?: number | [number, number, number];
  /** Per-socket light overrides. `false` disables that socket's light entirely. */
  lightOverrides?: KitPropLightOverrides;
  /** Apply `meta.recommendedScale` automatically (default true). */
  applyRecommendedScale?: boolean;
  /** Material-level PBR overrides applied to every material on the prop. */
  materialOverrides?: KitMaterialOverride;
}

/** A loaded kit prop instance with its resolved sockets and lights. */
export interface KitPropInstance {
  /** The loaded glTF root, scaled/placed per options. Add this to a scene. */
  root: import("../../core/Object3D.js").Object3D;
  /** The prop's resolved meta spec. */
  meta: PropMeta;
  /** The socket lights that were mounted (keyed by socket name). */
  lights: Map<string, import("../../core/lights/AbstractLight.js").AbstractLight>;
}

export interface LevelEnvironmentSurface {
  name: string;
  geometry: "cube" | "plane" | "cylinder";
  size?: [number, number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
  material?: {
    textureSet?: string;
    repeat?: [number, number];
    color?: string;
    roughness?: number;
    metallic?: number;
  };
}

export interface LevelPropPlacement {
  id: string;
  kitProp: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
  lightOverrides?: KitPropLightOverrides;
  materialOverrides?: KitMaterialOverride;
}

/**
 * A decal instance in a level (ADR 0029). The kit decal (`kitDecal`) carries the maps and the
 * default size; the placement only carries instance data.
 */
export interface LevelDecalPlacement {
  id: string;
  /** Namespaced kit decal id, e.g. `flakturm/sign_koje42`. */
  kitDecal: string;
  /** Box centre. Local to `parent` when that is set, otherwise level space. */
  position?: [number, number, number];
  /** Euler angles in radians (same convention as props). The decal's up axis (+Y) is the surface normal. */
  rotation?: [number, number, number];
  /** Box size [width, height, projection depth] in metres, overriding the kit decal's default. */
  size?: [number, number, number];
  /** Fade towards grazing surfaces (degrees against the decal's up axis) and towards the box edges (0..0.5). */
  fade?: { angleStart?: number; angleEnd?: number; edge?: number };
  /** Multiplies the decal's alpha, 0..1. Defaults to 1. */
  opacity?: number;
  /** Stacking order of overlapping decals: higher draws later (on top). Defaults to 0. */
  priority?: number;
  /** Free-form labels for game-side filtering (kept in `userData.tags`). */
  tags?: string[];
  /** Id of a prop in the same level: the decal becomes its child and moves with it. */
  parent?: string;
  /** Name of a socket on the `parent` prop (`meta.sockets`): the decal is attached to that socket instead of the prop root, and `position`/`rotation` become offsets local to the socket. Requires `parent`. */
  socket?: string;
}

export interface LevelLightDef {
  name: string;
  type: "spot" | "point" | "directional" | "ambient";
  color?: string;
  intensity?: number;
  distance?: number;
  position?: [number, number, number];
  target?: [number, number, number];
  direction?: [number, number, number];
  angle?: number;
  penumbra?: number;
  decay?: number;
}

export interface LevelHotspotDef {
  id: string;
  name: string;
  position: [number, number, number];
  interactionRadius?: number;
  promptText: string;
  monologueTitle?: string;
  monologueText?: string[];
  action?: string;
}

export interface LevelDescriptor {
  id: string;
  name: string;
  version: string;
  description?: string;
  environment?: {
    surfaces?: LevelEnvironmentSurface[];
  };
  props: LevelPropPlacement[];
  decals?: LevelDecalPlacement[];
  lights?: LevelLightDef[];
  hotspots?: LevelHotspotDef[];
  stageZone?: {
    displayName?: string;
    points: Array<{ u: number; v: number; scale?: number }>;
    projection?: { mode: string; width?: number; height?: number; z?: number; centerY?: number };
  };
}

export interface LevelInstance {
  descriptor: LevelDescriptor;
  root: import("../../core/Object3D.js").Object3D;
  props: Map<string, KitPropInstance>;
  decals: Map<string, import("../../core/objects/Decal.js").Decal>;
  lights: Map<string, import("../../core/lights/AbstractLight.js").AbstractLight>;
  hotspots: LevelHotspotDef[];
}
