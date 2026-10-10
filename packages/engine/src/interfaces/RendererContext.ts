import { DeviceCaps } from "../core/DeviceCaps.js";
import { ShaderRegistry } from "../renderers/shaders/ShaderRegistry.js";
import { AssetManager } from "../loaders/AssetManager.js";

/**
 * Per-engine-instance bundle of DeviceCaps/ShaderRegistry/AssetManager, replacing the process-wide
 * static/singleton access those three used to be the only way to reach -- see
 * .agents/collaborate/god-objects-refactoring.md Phases 0-1.
 */
export interface RendererContext {
  readonly deviceCaps: DeviceCaps;
  readonly shaderRegistry: ShaderRegistry;
  readonly assetManager: AssetManager;
}

/** Builds a context of fresh, independent instances -- one per engine, not process-wide. */
export function createDefaultRendererContext(): RendererContext {
  return {
    deviceCaps: new DeviceCaps(),
    shaderRegistry: new ShaderRegistry(),
    assetManager: new AssetManager(),
  };
}
