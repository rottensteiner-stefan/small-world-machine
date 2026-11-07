import type { CustomShaderMaterialOptions } from "../CustomShaderMaterial.js";

/**
 * Interface for all external shader importers.
 * An importer is responsible for parsing external shader source code
 * (like Shadertoy, GLSLSandbox, etc.) and converting it into the
 * engine's native CustomShaderMaterialOptions format.
 */
export interface ShaderImporter {
  /**
   * Parses the external shader source code.
   * @param sourceCode The raw code from the external platform.
   * @returns Options ready to be passed to `new CustomShaderMaterial(...)`.
   */
  parse(sourceCode: string): CustomShaderMaterialOptions;
}
