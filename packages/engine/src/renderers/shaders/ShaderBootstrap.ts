import { CoreShaderChunks } from "./CoreShaderChunks.js";
import { ShaderRegistry } from "./ShaderRegistry.js";

/**
 * Modern Bootstrapper for the ShaderRegistry.
 * Handles global chunk initialization. Core materials register themselves automatically.
 */
export class ShaderBootstrap {
  private static _bootstrapped: WeakSet<ShaderRegistry> = new WeakSet();

  /**
   * Initializes the given registry by loading standard chunks. Defaults to the process-wide
   * default registry for backward compatibility.
   */
  public static async init(registry: ShaderRegistry = ShaderRegistry.instance): Promise<void> {
    if (this._bootstrapped.has(registry)) {
      return;
    }

    // 1. Load global shader chunks (lights, math, structures)
    // This MUST be done first so that self-registering materials find their chunks.
    CoreShaderChunks.init(registry);

    this._bootstrapped.add(registry);
  }
}
