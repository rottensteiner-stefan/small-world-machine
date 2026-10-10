import { BlendingMode, CullMode, ShaderPropertyType } from "../../enums/index.js";

/**
 * Metadata for a shader property.
 */
export interface ShaderPropertyMetadata {
  type: ShaderPropertyType;
  defaultValue?: unknown;
}

/**
 * Defines the requirements of a shader.
 */
export interface ShaderLayout {
  /** Map of uniform names to their metadata. */
  uniforms: Record<string, ShaderPropertyMetadata>;
  /**
   * Explicit order of uniforms in the buffer for automated packing.
   * If provided, the renderer can automatically pack data into buffers.
   */
  uniformLayout?: string[];
  /** Map of texture names to their metadata. */
  textures: Record<string, ShaderPropertyMetadata>;
}

/**
 * Defines a shader for all supported APIs.
 */
export interface ShaderDefinition {
  /** Unique ID of the shader. */
  id: string;
  /** Shader sources for different APIs. */
  sources: {
    wgsl?: string;
    glsl300?: { vs: string; fs: string };
    glsl100?: { vs: string; fs: string };
  };
  /** The data layout expected by this shader. */
  layout: ShaderLayout;
  /** Optional default state for the GPU pipeline. */
  defaultState?: {
    culling?: CullMode;
    blending?: BlendingMode;
    depthWrite?: boolean;
    depthTest?: boolean;
    transparent?: boolean;
  };
}
