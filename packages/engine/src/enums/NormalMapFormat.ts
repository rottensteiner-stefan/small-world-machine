/**
 * Orientation of the tangent-space normal map's green (V) axis.
 *
 * OPENGL (the engine's default): green points up (+Y). This is the Web/glTF convention and
 * matches the shader's tangent-space read path (N = v_tbn * (rgb*2-1)) with the flat
 * normal pointing toward the viewer. Never mix handedness between the authoring tool and the renderer,
 * or bumps render as dents.
 */
export const NormalMapFormat = {
  /** Green up (+Y). Web/glTF default; the Small World Machine engine's convention. */
  OPENGL: "opengl",
  /** Green down (-Y). Required by some desktop DCC tools and legacy engines. */
  DIRECTX: "directx",
} as const;

/** Type definition for NormalMapFormat. */
export type NormalMapFormat = (typeof NormalMapFormat)[keyof typeof NormalMapFormat];
