import {
  Color,
  FluidSurfaceMaterial,
  GeometryDataInterface,
  Ground,
  LavaMaterial,
  OpenWaterMaterial,
  RampLUT,
  SlimeMaterial,
  StylizedLavaMaterial,
  StylizedLavaMaterialOptions,
  StylizedWaterMaterial,
  Texture,
} from "@small-world-machine/engine";
import { NoirWaterMaterial, OilSlickMaterial } from "@small-world-machine/liquid-extras";
import { PoolKey, POOL_SIZE, WALL_THICKNESS, poolWorldPosition } from "./PoolLayout.js";
import type { BarrelType, PropSpec, Rgb } from "./PoolProps.js";
import type { TilePaletteName } from "./PoolTextures.js";

export type PoolLiquid =
  | OpenWaterMaterial
  | StylizedWaterMaterial
  | StylizedLavaMaterial
  | FluidSurfaceMaterial
  | NoirWaterMaterial;

/** Textures the liquid materials of the gallery sample; loaded once by the showcase. */
export interface PoolAssets {
  lavaTexture: Texture;
  lavaNormalMap: Texture;
  /** Stylized Lava `_MainTex` / `_DistortTex`, sampled at world XZ (repeat wrap). */
  lavaMainMap: Texture;
  lavaDistortMap: Texture;
  slimeTexture: Texture;
  slimeNormalMap: Texture;
}

/** A prop resting on the pool floor: spec, local x, local z. */
type SunkProp = readonly [PropSpec, number, number];
/** A prop bobbing at the surface: spec, local x, local z, bob amplitude, bob frequency. */
type FloatingProp = readonly [PropSpec, number, number, number, number];

export interface PoolLight {
  color: Rgb;
  intensity: number;
  distance: number;
  /** World height above the pool center. */
  y: number;
}

export interface PoolPreset {
  key: PoolKey;
  name: string;
  /** Signboard title and subtitle. */
  sign: readonly [string, string];
  /** `"noir"` is the hand-inked comic tile set, not one of the ceramic palettes. */
  tiles: TilePaletteName | "noir";
  needsTangents: boolean;
  spawnDelay: number;
  createLiquid: (assets: PoolAssets) => PoolLiquid;
  /** Replaces the default vertical `Plane` (rotated flat) with a ready-made horizontal surface. */
  createSurface?: () => GeometryDataInterface;
  sunk?: readonly SunkProp[];
  floating?: readonly FloatingProp[];
  dropper?: PropSpec;
  /** Set for pools whose bodies come from the physics system (FluidVolume) instead of the splash dropper. */
  buoyancyDensity?: number;
  light?: PoolLight;
}

const crate = (color?: Rgb): PropSpec =>
  undefined === color ? { kind: "crate" } : { kind: "crate", color };
const ball = (color: Rgb, radius: number): PropSpec => ({ kind: "ball", color, radius });
const debris = (color: Rgb, radius: number): PropSpec => ({ kind: "debris", color, radius });
const barrel = (type: BarrelType): PropSpec => ({ kind: "barrel", type });

/**
 * Horizontal lava surface with painted vertex colors -- the equivalent of MinionsArt's
 * PolyBrush step. Red is the mask the Stylized Lava shader fades by: 1 across the pool, falling
 * to `RIM_RED` at the walls so the crust cools and the waves settle there.
 */
function createLavaSurface(): GeometryDataInterface {
  const RIM_FADE_WIDTH = 0.45;
  const RIM_RED = 0.15;
  const inner = POOL_SIZE - 2 * WALL_THICKNESS;
  const segments = 32;
  const ground = new Ground({
    width: inner,
    depth: inner,
    widthSegments: segments,
    depthSegments: segments,
  });
  const vertices = ground.getGeometryData().vertices;
  const colors = new Float32Array((vertices.length / 3) * 4);
  for (let i = 0; i < vertices.length / 3; i++) {
    const edgeDistance =
      inner / 2 - Math.max(Math.abs(vertices[i * 3]!), Math.abs(vertices[i * 3 + 2]!));
    const fade = Math.min(1, Math.max(0, edgeDistance / RIM_FADE_WIDTH));
    colors[i * 4] = RIM_RED + (1 - RIM_RED) * fade * fade * (3 - 2 * fade);
    colors[i * 4 + 1] = 1;
    colors[i * 4 + 2] = 1;
    colors[i * 4 + 3] = 1;
  }
  ground.colors = colors;
  return ground.getGeometryData();
}

/** One Stylized Lava pool: the same Astro-Kat base configuration, only ramp, flow and spill color differ. */
function stylizedLavaPool(
  key: PoolKey,
  name: string,
  sign: readonly [string, string],
  spill: Rgb,
  createRamp: (() => RampLUT) | undefined,
  tuning: () => StylizedLavaMaterialOptions,
): PoolPreset {
  return {
    key,
    name,
    sign,
    tiles: "basalt",
    needsTangents: false,
    spawnDelay: 4.5,
    createLiquid: (assets: PoolAssets): StylizedLavaMaterial => {
      const ramp = createRamp?.();
      return new StylizedLavaMaterial({
        mainMap: assets.lavaMainMap,
        distortMap: assets.lavaDistortMap,
        // Astro Kat's wave height (0.28) is scaled for a lake; 0.07 keeps the surface inside the pool.
        waveHeight: 0.07,
        // Ramp colors are already HDR-hot: dial the Astro Kat brightness down to keep detail.
        ...(undefined === ramp
          ? {}
          : {
              rampMap: ramp.texture,
              brightnessUnderLava: 0.9,
              brightnessTopLava: 2.2,
              tintOffset: 0.85,
            }),
        ...tuning(),
      });
    },
    createSurface: createLavaSurface,
    sunk: [
      [crate([0.3, 0.12, 0.06]), -0.8, -0.5],
      [debris(spill, 0.38), 0.8, 0.6],
    ],
    floating: [
      [debris([0.18, 0.12, 0.1], 0.42), -1.2, 1.1, 0.07, 1.2],
      [ball(spill, 0.32), 1.0, -1.0, 0.06, 1.5],
    ],
    dropper: debris([0.15, 0.1, 0.08], 0.4),
  };
}

/** Build order is gallery order: row 0 water, row 1 stylized water, row 2 exotic fluids, row 3 stylized lava. */
export const POOL_PRESETS: readonly PoolPreset[] = [
  {
    key: "clear-water",
    name: "ClearWaterPool",
    sign: ["Clear Water", "PBR Ocean • Gerstner & Foam"],
    tiles: "pool",
    needsTangents: true,
    spawnDelay: 3.0,
    createLiquid: (): OpenWaterMaterial =>
      new OpenWaterMaterial({
        waterColor: new Color(0.05, 0.45, 0.6),
        deepWaterColor: new Color(0.0, 0.12, 0.22),
        edgeColor: new Color(0.85, 0.98, 1.0),
        edgeSoftness: 0.8,
        foamDistance: 0.75,
        speed: 0.9,
        wave1: [1.0, 0.35, 0.07, 2.8],
        wave2: [0.3, 0.95, 0.05, 1.8],
        wave3: [-0.5, 0.6, 0.035, 1.1],
        refractionStrength: 0.035,
        waterAbsorption: [0.18, 0.045, 0.015],
        foamColor: new Color(1.0, 1.0, 1.0),
        foamCutoff: 0.45,
        foamNoiseScale: 4.5,
        foamNoiseSpeed: 0.7,
      }),
    sunk: [
      [crate([0.55, 0.38, 0.22]), -1.0, -0.6],
      [ball([0.85, 0.72, 0.15], 0.35), 0.9, 0.5],
    ],
    floating: [
      [ball([0.9, 0.2, 0.15], 0.35), -1.3, 1.2, 0.12, 1.8],
      [barrel("chemical"), 1.2, -1.1, 0.09, 2.2],
    ],
    dropper: crate([0.55, 0.38, 0.22]),
  },
  {
    key: "toon-water",
    name: "ToonWaterPool",
    sign: ["Classic Toon Water", "Cel Shader • Stepped Foam Bands"],
    tiles: "pool",
    needsTangents: true,
    spawnDelay: 4.5,
    createLiquid: (): StylizedWaterMaterial =>
      new StylizedWaterMaterial({
        style: "toon",
        shallowWaterColor: new Color(0.1, 0.65, 0.85),
        deepWaterColor: new Color(0.02, 0.16, 0.3),
        edgeColor: new Color(0.9, 1.0, 1.0),
        edgeSoftness: 0.2,
        foamDistance: 1.0,
        speed: 1.0,
        wave1: [1.0, 0.4, 0.08, 3.2],
        wave2: [0.3, 0.9, 0.06, 2.0],
        wave3: [-0.4, 0.6, 0.04, 1.3],
      }),
    sunk: [
      [crate([0.2, 0.55, 0.7]), -0.8, -0.7],
      [ball([0.95, 0.85, 0.1], 0.32), 1.0, 0.6],
    ],
    floating: [
      [ball([0.95, 0.85, 0.05], 0.38), -1.2, 1.1, 0.14, 2.0], // Yellow duck proxy
      [debris([0.9, 0.25, 0.2], 0.35), 1.1, -1.0, 0.1, 2.5],
    ],
    dropper: crate([0.85, 0.35, 0.2]),
  },
  {
    key: "bold-anime",
    name: "BoldAnimePool",
    sign: ["Bold Anime Water", "High-Contrast • Saturated Waves"],
    tiles: "pool",
    needsTangents: true,
    spawnDelay: 5.0,
    createLiquid: (): StylizedWaterMaterial =>
      new StylizedWaterMaterial({
        style: "bold",
        shallowWaterColor: new Color(0.08, 0.55, 0.8),
        deepWaterColor: new Color(0.01, 0.12, 0.25),
        edgeColor: new Color(0.95, 1.0, 1.0),
        edgeSoftness: 0.35,
        foamDistance: 1.2,
        speed: 1.1,
        wave1: [1.0, 0.45, 0.09, 3.5],
        wave2: [0.4, 0.85, 0.065, 2.2],
        wave3: [-0.5, 0.55, 0.045, 1.4],
      }),
    sunk: [
      [crate([0.35, 0.35, 0.4]), -0.9, -0.6],
      [debris([0.85, 0.2, 0.6], 0.35), 0.9, 0.5],
    ],
    floating: [
      [ball([0.1, 0.75, 0.9], 0.35), -1.1, 1.2, 0.13, 2.1],
      [debris([0.95, 0.65, 0.1], 0.4), 1.2, -0.9, 0.11, 2.6],
    ],
    dropper: crate([0.2, 0.6, 0.8]),
  },
  {
    key: "soft-watercolor",
    name: "SoftWatercolorPool",
    sign: ["Soft Anime Watercolor", "Smooth-Min Voronoi Caustics"],
    tiles: "pool",
    needsTangents: true,
    spawnDelay: 3.5,
    createLiquid: (): StylizedWaterMaterial =>
      new StylizedWaterMaterial({
        style: "soft",
        shallowWaterColor: new Color(0.18, 0.76, 0.82),
        deepWaterColor: new Color(0.02, 0.22, 0.35),
        edgeColor: new Color(0.9, 0.98, 1.0),
        edgeSoftness: 0.9,
        causticStrength: 0.65,
        foamDistance: 0.85,
        speed: 0.85,
        wave1: [0.8, 0.3, 0.06, 2.5],
        wave2: [0.2, 0.8, 0.045, 1.6],
        wave3: [-0.3, 0.5, 0.03, 1.0],
      }),
    sunk: [
      [crate([0.6, 0.5, 0.38]), -1.0, -0.5],
      [ball([0.25, 0.65, 0.45], 0.32), 0.8, 0.6],
    ],
    floating: [
      [ball([0.3, 0.75, 0.5], 0.36), -1.2, 1.0, 0.08, 1.5], // Mossy stone orb
      [debris([0.85, 0.8, 0.65], 0.35), 1.0, -1.2, 0.07, 1.9],
    ],
    dropper: crate([0.65, 0.55, 0.42]),
  },
  {
    key: "painterly-sparkle",
    name: "PainterlySparklePool",
    sign: ["Painterly Sparkle", "12 FPS Astroid Star Glints"],
    tiles: "pool",
    needsTangents: true,
    spawnDelay: 4.0,
    createLiquid: (): StylizedWaterMaterial =>
      new StylizedWaterMaterial({
        style: "sparkle",
        shallowWaterColor: new Color(0.0, 0.88, 0.94), // Vibrant electric turquoise / aqua-cyan
        deepWaterColor: new Color(0.01, 0.17, 0.26), // Deep oceanic petrol-teal / sapphire navy
        edgeColor: new Color(0.91, 1.0, 1.0), // Luminous aqua-white shimmer
        edgeSoftness: 0.45,
        glitterStrength: 1.35,
        causticStrength: 1.25,
        refractionStrength: 0.038,
        waterAbsorption: [0.38, 0.075, 0.018],
        rampSoftness: 0.6,
        washAmount: 0.22,
        foamColor: new Color(0.96, 1.0, 1.0),
        foamDistance: 0.75,
        foamNoiseScale: 4.2,
        foamNoiseSpeed: 0.65,
        speed: 0.85,
        wave1: [0.9, 0.35, 0.065, 3.0],
        wave2: [0.35, 0.85, 0.045, 1.9],
        wave3: [-0.4, 0.55, 0.025, 1.2],
      }),
    sunk: [
      [ball([0.28, 0.52, 0.68], 0.42), -1.1, -0.7], // Smooth river stone (teal-slate)
      [ball([0.38, 0.65, 0.8], 0.36), -0.4, -0.9], // River pebble (azure-grey)
      [ball([0.2, 0.42, 0.58], 0.46), 0.4, -0.5], // River rock (deep cyan)
      [ball([0.45, 0.72, 0.88], 0.32), 1.1, -0.8], // River pebble (light aqua)
      [debris([0.95, 0.88, 0.4], 0.38), -0.6, 0.6], // Sunlit crystal prism
      [ball([0.32, 0.58, 0.74], 0.38), 0.8, 0.7], // River stone
    ],
    floating: [
      [debris([1.0, 0.92, 0.3], 0.4), -1.1, 1.1, 0.1, 2.2], // Golden star
      [ball([0.95, 0.4, 0.7], 0.34), 1.2, -0.9, 0.09, 2.0],
    ],
    dropper: crate([0.9, 0.8, 0.3]),
  },
  {
    key: "dredge",
    name: "DredgePool",
    sign: ["Dredge Abyssal Fog", "Eerie Murk • Jade Subsurface"],
    tiles: "murk",
    needsTangents: true,
    spawnDelay: 5.5,
    createLiquid: (): StylizedWaterMaterial =>
      new StylizedWaterMaterial({
        style: "dredge",
        shallowWaterColor: new Color(0.08, 0.28, 0.24),
        deepWaterColor: new Color(0.01, 0.05, 0.05),
        edgeColor: new Color(0.4, 0.6, 0.55),
        edgeSoftness: 0.8,
        foamDistance: 0.7,
        speed: 0.6,
        wave1: [0.6, 0.2, 0.05, 2.0],
        wave2: [0.15, 0.7, 0.035, 1.3],
        wave3: [-0.2, 0.4, 0.025, 0.9],
      }),
    sunk: [
      [crate([0.15, 0.18, 0.17]), -0.9, -0.5],
      [debris([0.12, 0.25, 0.2], 0.4), 0.8, 0.5],
    ],
    floating: [
      [barrel("oil"), -1.2, 1.0, 0.08, 1.4],
      [debris([0.2, 0.35, 0.3], 0.35), 1.1, -1.0, 0.06, 1.7],
    ],
    dropper: crate([0.2, 0.22, 0.2]),
  },
  {
    key: "noir-graphic",
    name: "NoirGraphicPool",
    sign: ["Noir Graphic Novel", "Monochrome Ink • Posterized Tones"],
    tiles: "noir",
    needsTangents: true,
    spawnDelay: 4.2,
    createLiquid: (): NoirWaterMaterial => {
      const { x, z } = poolWorldPosition("noir-graphic");
      return new NoirWaterMaterial({
        posterizeSteps: 4,
        rippleCenter: [x - 1.1, z + 1.1],
        rippleCenter2: [x + 1.1, z - 0.9],
        rippleCenter3: [x + 0.3, z + 0.2],
      });
    },
    sunk: [
      [crate(), -0.9, -0.6],
      [ball([0.92, 0.92, 0.92], 0.32), 0.9, 0.5],
    ],
    // The first two floaters and the dropper drive the three ripple centers (see Showcase10.update).
    floating: [
      [ball([0.96, 0.96, 0.96], 0.36), -1.1, 1.1, 0.1, 1.8],
      [crate(), 1.1, -0.9, 0.09, 2.2],
    ],
    dropper: ball([0.95, 0.95, 0.95], 0.35),
  },
  {
    key: "molten-lava",
    name: "MoltenLavaPool",
    sign: ["Molten Lava", "Viscous Magma • Emissive Crust Glow"],
    tiles: "basalt",
    needsTangents: false,
    spawnDelay: 4.0,
    createLiquid: (assets: PoolAssets): LavaMaterial =>
      new LavaMaterial({
        noiseMap: assets.lavaTexture,
        normalMap: assets.lavaNormalMap,
        color: new Color(1.0, 0.3, 0.02),
        edgeColor: new Color(0.2, 0.07, 0.04), // Lighter crust so the plates read against the glow
        emissiveStrength: 2.4,
        emissiveColor: new Color(1.0, 0.2, 0.03), // Orange-red hue, less yellow when overexposed
        emissivePulse: 0.85,
        transitionSoftness: 0.35,
        normalStrength: 2.0,
        waveAmplitude: 0.09,
        shade: 0.9,
        viscosity: 14.0,
      }),
    sunk: [
      [crate([0.55, 0.16, 0.06]), -0.8, -0.5], // Heat-tinted (lit by the magma)
      [debris([1.0, 0.45, 0.08], 0.38), 0.8, 0.6],
    ],
    floating: [
      [debris([0.3, 0.14, 0.09], 0.42), -1.2, 1.1, 0.07, 1.2], // Charred rock, rim-lit by the lava
      [ball([0.85, 0.35, 0.05], 0.32), 1.0, -1.0, 0.06, 1.5],
    ],
    dropper: debris([0.15, 0.09, 0.08], 0.4),
    // Low over the surface: the orange light bleeds onto the frame and floaters
    light: { color: [1.0, 0.45, 0.1], intensity: 8.5, distance: 14, y: 0.45 },
  },
  // South terrace: stylized NPR lava, one pool per RampLUT preset.
  stylizedLavaPool(
    "lava-volcanic",
    "LavaVolcanicPool",
    ["Stylized Volcano", "NPR Lava • Thermal Ramp"],
    [1.0, 0.45, 0.05],
    undefined, // The faithful MinionsArt reference: Astro Kat settings, two-color lerp, no ramp.
    () => ({}),
  ),
  stylizedLavaPool(
    "lava-infernal",
    "LavaInfernalPool",
    ["Stylized Inferno", "Crimson Flow • Thermal Ramp"],
    [0.95, 0.2, 0.03],
    () => RampLUT.presets.infernal(),
    () => ({
      // Counter-flowing variant of the Astro Kat settings
      speedMainX: -1.43,
      speedDistortX: -0.91,
      fissureColor: new Color(1.0, 0.6, 0.15),
      shoreColor: new Color(0.95, 0.15, 0.0),
    }),
  ),
  stylizedLavaPool(
    "lava-plasma",
    "LavaPlasmaPool",
    ["Stylized Plasma", "Cyan Magma • Thermal Ramp"],
    [0.1, 0.7, 0.95],
    () => RampLUT.presets.plasmaCyan(),
    () => ({
      speedMainX: 1.04,
      speedMainY: -1.43,
      speedDistortX: -0.91,
      speedDistortY: 1.17,
      fissureColor: new Color(0.55, 0.95, 1.0),
      shoreColor: new Color(0.1, 0.65, 1.0),
    }),
  ),
  stylizedLavaPool(
    "lava-toxic",
    "LavaToxicPool",
    ["Stylized Toxic Lava", "Neon Acid Flow • Thermal Ramp"],
    [0.55, 0.9, 0.15],
    () => RampLUT.presets.toxicSlime(),
    () => ({
      speedMainX: -0.8,
      speedMainY: -1.0,
      speedDistortX: 0.5,
      speedDistortY: 0.65,
      fissureColor: new Color(0.85, 1.0, 0.3),
      shoreColor: new Color(0.4, 0.9, 0.1),
    }),
  ),
  {
    key: "toxic-slime",
    name: "ToxicSlimePool",
    sign: ["Toxic Slime", "Bioluminescent Acid • Bubbles"],
    tiles: "toxic",
    needsTangents: false,
    spawnDelay: 5.0,
    createLiquid: (assets: PoolAssets): SlimeMaterial =>
      new SlimeMaterial({
        noiseMap: assets.slimeTexture,
        normalMap: assets.slimeNormalMap,
        color: new Color(0.15, 0.95, 0.25),
        edgeColor: new Color(0.1, 0.42, 0.07), // Dark contact colour: a bright edge colour summed with glow and shade clipped to white at the walls
        emissiveStrength: 0.35,
        rimStrength: 0.15,
        specularStrength: 0.3, // Soft bright bubble highlights instead of dark outlines
        specularPower: 160.0,
        shade: 0.6,
        absorption: 2.2,
        normalStrength: 1.5,
        viscosity: 10.0,
      }),
    sunk: [
      [crate([0.18, 0.35, 0.15]), -0.9, -0.6],
      [ball([0.8, 0.9, 0.1], 0.3), 0.9, 0.5],
    ],
    floating: [
      [barrel("hazard"), -1.1, 1.1, 0.08, 1.4], // Toxic yellow hazard barrel
      [ball([0.2, 0.9, 0.3], 0.35), 1.0, -1.1, 0.07, 1.7],
    ],
    dropper: barrel("hazard"),
    light: { color: [0.2, 1.0, 0.3], intensity: 6.5, distance: 14, y: 0.55 },
  },
  {
    key: "petroleum-oil",
    name: "PetroleumOilPool",
    sign: ["Petroleum Dark Oil", "Dark Hydrocarbon • Oil Slick Sheen"],
    tiles: "graphite",
    needsTangents: true,
    spawnDelay: 6.0,
    // Colours, specular and sheen come from the OilSlickMaterial defaults; nothing is overridden.
    createLiquid: (): OilSlickMaterial => new OilSlickMaterial(),
    sunk: [
      [{ kind: "pipe", color: [0.2, 0.22, 0.24] }, -0.8, -0.6],
      [{ kind: "gear", color: [0.18, 0.19, 0.21] }, 0.9, 0.6],
    ],
    floating: [
      [barrel("oil"), -1.1, 1.0, 0.04, 1.0], // Black steel industrial oil drum
      [
        { kind: "buoy", bodyColor: [0.2, 0.15, 0.08], mastColor: [0.2, 0.08, 0.05] },
        1.1,
        -1.0,
        0.05,
        1.2,
      ], // Oil-stained, rusted buoy
    ],
    dropper: barrel("oil"),
  },
  // Buoyancy pools: rigid bodies ride the REAL wave surface (FluidVolume + OpenWaterSurfaceProbe).
  {
    // A swell large enough to see the bodies heave with it
    key: "wave-rider",
    name: "WaveRiderPool",
    sign: ["Wave Rider", "Bodies ride the real wave surface"],
    tiles: "pool",
    needsTangents: true,
    spawnDelay: 0,
    buoyancyDensity: 1.0,
    createLiquid: (): OpenWaterMaterial =>
      new OpenWaterMaterial({
        waterColor: new Color(0.04, 0.42, 0.58),
        deepWaterColor: new Color(0.0, 0.1, 0.2),
        edgeColor: new Color(0.85, 0.98, 1.0),
        edgeSoftness: 0.8,
        foamDistance: 0.75,
        speed: 0.8,
        wave1: [1.0, 0.3, 0.3, 4.5],
        wave2: [0.3, 1.0, 0.2, 3.0],
        wave3: [-0.6, 0.5, 0.12, 2.2],
        refractionStrength: 0.03,
        waterAbsorption: [1.5, 0.8, 0.5],
        foamColor: new Color(1.0, 1.0, 1.0),
        foamCutoff: 0.45,
        foamNoiseScale: 4.5,
        foamNoiseSpeed: 0.7,
      }),
  },
  {
    // The same bodies in brine of density 1.24 sit visibly higher
    key: "dead-sea",
    name: "DeadSeaPool",
    sign: ["Dead Sea", "Denser brine • Floats higher"],
    tiles: "salt",
    needsTangents: true,
    spawnDelay: 0,
    buoyancyDensity: 1.24,
    createLiquid: (): OpenWaterMaterial =>
      new OpenWaterMaterial({
        waterColor: new Color(0.3, 0.72, 0.7),
        deepWaterColor: new Color(0.05, 0.32, 0.36),
        edgeColor: new Color(0.95, 0.98, 0.92),
        edgeSoftness: 0.9,
        foamDistance: 0.5,
        speed: 0.5,
        wave1: [1.0, 0.25, 0.12, 5.0],
        wave2: [0.3, 1.0, 0.09, 3.2],
        wave3: [-0.5, 0.6, 0.06, 2.4],
        refractionStrength: 0.02,
        waterAbsorption: [0.35, 0.1, 0.06],
        foamColor: new Color(0.97, 0.97, 0.93),
        foamCutoff: 0.55,
        foamNoiseScale: 3.5,
        foamNoiseSpeed: 0.4,
      }),
  },
];
