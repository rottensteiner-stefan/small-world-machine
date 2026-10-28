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

export const LEVEL_SCHEMA_VERSION = 1;

export type LevelMigrationStep = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Sequential migration chain `(fromVersion -> step returning fromVersion + 1)` for
 * `LevelDescriptor` (ADR 0041 §4 / §7 Stufe 2). Empty at `schemaVersion = 1`.
 */
export const LEVEL_MIGRATIONS: ReadonlyMap<number, LevelMigrationStep> = new Map();

export interface LevelDescriptor {
  $schema?: string;
  id: string;
  name: string;
  version: string;
  /** Format version of the level descriptor (`public/schemas/level.schema.json`, ADR 0041). */
  schemaVersion?: number;
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

/**
 * Validates and migrates a `LevelDescriptor` to `LEVEL_SCHEMA_VERSION` along `LEVEL_MIGRATIONS`.
 * Unversioned descriptors in memory (`schemaVersion === undefined`) default to version 1;
 * unknown or future `schemaVersion` values fail fast (ADR 0041 §4).
 */
export function migrateLevelDescriptor(
  descriptor: LevelDescriptor,
  context: string = "KitRegistry",
): LevelDescriptor {
  const rawVersion = descriptor.schemaVersion ?? LEVEL_SCHEMA_VERSION;
  if (
    typeof rawVersion !== "number" ||
    !Number.isInteger(rawVersion) ||
    rawVersion < 1 ||
    rawVersion > LEVEL_SCHEMA_VERSION
  ) {
    throw new Error(
      `[${context}] Unsupported level schemaVersion '${String(descriptor.schemaVersion)}' in level '${descriptor.id || "<unknown>"}' (supported: 1..${LEVEL_SCHEMA_VERSION}).`,
    );
  }
  let currentVersion = rawVersion;
  let current: Record<string, unknown> = { ...descriptor, schemaVersion: currentVersion };
  while (currentVersion < LEVEL_SCHEMA_VERSION) {
    const step = LEVEL_MIGRATIONS.get(currentVersion);
    if (!step) {
      throw new Error(
        `[${context}] Missing level migration step from schemaVersion ${currentVersion} in level '${descriptor.id || "<unknown>"}'.`,
      );
    }
    current = step(current);
    currentVersion += 1;
    current["schemaVersion"] = currentVersion;
  }
  return current as unknown as LevelDescriptor;
}

export const APP_SCHEMA_VERSION = 1;

export interface AppKitDependency {
  id: string;
  version: string;
}

/**
 * Application manifest (`app.json`, `public/schemas/app.schema.json` — ADR 0041 §2 / §7 Stufe 1).
 */
export interface AppManifest {
  $schema?: string;
  id: string;
  name: string;
  version: string;
  schemaVersion: number;
  description?: string;
  engine?: string;
  entry: string;
  levels: string[];
  characters: string[];
  kits: AppKitDependency[];
  code?: {
    module: string;
  };
  save?: {
    schemaVersion: number;
  };
}

/**
 * Validates that unknown data conforms to `AppManifest` and fails fast on an unsupported
 * `schemaVersion` (ADR 0041 §2 / §4).
 */
export function assertAppManifest(
  data: unknown,
  context: string = "AppManifest",
): asserts data is AppManifest {
  if (typeof data !== "object" || data === null) {
    throw new Error(`[${context}] Invalid app manifest: expected an object.`);
  }
  const d = data as Partial<AppManifest>;
  if (
    typeof d.id !== "string" ||
    d.id.length === 0 ||
    typeof d.name !== "string" ||
    d.name.length === 0 ||
    typeof d.version !== "string" ||
    typeof d.entry !== "string" ||
    d.entry.length === 0 ||
    !Array.isArray(d.levels) ||
    !Array.isArray(d.characters) ||
    !Array.isArray(d.kits)
  ) {
    throw new Error(
      `[${context}] Invalid app manifest structure: expected id, name, version, entry, levels, characters, and kits.`,
    );
  }
  if (
    typeof d.schemaVersion !== "number" ||
    !Number.isInteger(d.schemaVersion) ||
    d.schemaVersion !== APP_SCHEMA_VERSION
  ) {
    throw new Error(
      `[${context}] Unsupported app.json schemaVersion '${String(d.schemaVersion)}' in app '${d.id}' (supported: ${APP_SCHEMA_VERSION}).`,
    );
  }
}

export interface LevelInstance {
  descriptor: LevelDescriptor;
  root: import("../../core/Object3D.js").Object3D;
  props: Map<string, KitPropInstance>;
  decals: Map<string, import("../../core/objects/Decal.js").Decal>;
  lights: Map<string, import("../../core/lights/AbstractLight.js").AbstractLight>;
  hotspots: LevelHotspotDef[];
}
