import { ShaderDefinition } from "../renderers/shaders/index.js";

/**
 * Interface for components that provide their own shader definitions.
 * Typically implemented by Material classes.
 */
export interface ShaderProvider {
  /**
   * Returns the shader definition for this component.
   * @returns The shader definition.
   */
  getShaderDefinition(): ShaderDefinition;
}
