import { CoreShaderChunks } from "./CoreShaderChunks.js";
import type { ShaderRegistry } from "./ShaderRegistry.js";

/**
 * Modern Bootstrapper for the ShaderRegistry.
 * Handles global chunk initialization. The renderers hand materials to their registry as they draw them (ADR 0032).
 */
export class ShaderBootstrap {
  private static _bootstrapped: WeakSet<ShaderRegistry> = new WeakSet();

  /**
   * Initializes the given registry by loading standard chunks.
   * @param registry The engine's registry (`RendererContext.shaderRegistry`).
   */
  public static async init(registry: ShaderRegistry): Promise<void> {
    if (this._bootstrapped.has(registry)) {
      return;
    }

    // 1. Load global shader chunks (lights, math, structures)
    CoreShaderChunks.init(registry);

    this._bootstrapped.add(registry);
  }
}
