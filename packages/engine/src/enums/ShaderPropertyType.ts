/**
 * Supported data types for shader properties.
 */
export const ShaderPropertyType = {
  /** Single float value. */
  FLOAT: "float",
  /** 2-component vector. */
  VEC2: "vec2",
  /** 3-component vector. */
  VEC3: "vec3",
  /** 4-component vector. */
  VEC4: "vec4",
  /** 4x4 matrix. */
  MAT4: "mat4",
  /** Color value (RGBA). */
  COLOR: "color",
  /** Texture sampler. */
  TEXTURE: "texture",
} as const;

/** Type definition for ShaderPropertyType. */
export type ShaderPropertyType = (typeof ShaderPropertyType)[keyof typeof ShaderPropertyType];
