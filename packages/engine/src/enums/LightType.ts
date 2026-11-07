/**
 * Types of lights in the scene.
 */
export const LightType = {
  /** Ambient light. */
  AMBIENT: "AmbientLight",
  /** Area light. */
  AREA: "AreaLight",
  /** Directional light. */
  DIRECTIONAL: "DirectionalLight",
  /** Point light. */
  POINT: "PointLight",
  /** Spot light. */
  SPOT: "SpotLight",
} as const;

/** Type definition for LightType. */
export type LightType = (typeof LightType)[keyof typeof LightType];
