/**
 * Types of materials.
 */
export const MaterialType = {
  /** Material for open water rendering with Gerstner waves. */
  OPEN_WATER: "OpenWaterMaterial",
  /** Specialized stylized water material with toon foam and caustics projection. */
  STYLIZED_WATER: "StylizedWaterMaterial",
  /** Unlit basic material. */
  BASIC: "BasicMaterial",
  /** Lambertian diffuse material. */
  LAMBERT: "LambertMaterial",
  /** Phong specular material. */
  PHONG: "PhongMaterial",
  /** Material for skyboxes. */
  SKYBOX: "SkyboxMaterial",
  /** Box-projected decal that is lit on top of the opaque image (see `Decal`). */
  DECAL: "DecalMaterial",
  /** Specialized terrain material. */
  TERRAIN: "TerrainMaterial",
  /** Physically based rendering material. */
  STANDARD: "StandardMaterial",
  /** Material for wireframe rendering. */
  WIREFRAME: "WireframeMaterial",
  /** Material for sprites. */
  SPRITE: "SpriteMaterial",
  /** Special triplanar mapping material for seamless tiling. */
  WORLD: "WorldMaterial",
  /** Specialized material for fluid surfaces with depth fade. */
  FLUID_SURFACE: "FluidSurfaceMaterial",
  /** Opaque, emissive flowing lava preset on FluidSurfaceMaterial. */
  LAVA: "LavaMaterial",
  /** Specialized stylized NPR lava material with subtractive fissures and thermal LUT. */
  STYLIZED_LAVA: "StylizedLavaMaterial",
  /** Translucent, low-emissive flowing slime preset on FluidSurfaceMaterial. */
  SLIME: "SlimeMaterial",
  /** Depth material for shadow mapping. */
  DEPTH: "DepthMaterial",
  /** EVSM moment-writing material for the exponentially warped variance map (ADR 0007). */
  EVSM: "EvsmMomentMaterial",
  /** Physically based rendering material with transmission/refraction. */
  GLASS: "GlassMaterial",
  /** Heavy blurred transmission material for Neon Labyrinth. */
  FROSTGLASS: "FrostglassMaterial",
  /** Specialized screen shader with retro TV and early film effects. */
  RETRO_SCREEN: "RetroScreenMaterial",
} as const;

/** Type definition for MaterialType. */
export type MaterialType = (typeof MaterialType)[keyof typeof MaterialType];
