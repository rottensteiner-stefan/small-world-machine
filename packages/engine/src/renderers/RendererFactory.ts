import type { Renderer, EngineOptions, RendererContext } from "../interfaces/index.js";
import { createDefaultRendererContext } from "../interfaces/index.js";
import { RendererType } from "../enums/index.js";
import { WebGL1Renderer } from "./WebGL1/index.js";
import { WebGL2Renderer } from "./WebGL2/index.js";
import { WebGPURenderer } from "./WebGPU/index.js";
import { DeviceFeature } from "../core/DeviceCaps.js";

/**
 * Factory for creating renderer instances.
 */
export class RendererFactory {
  /**
   * Looks up this backend's configured context attributes, if any.
   * `config.renderer` is keyed by a fixed set of backend names, but `type` here can be an
   * arbitrary string (see `RendererType | string` below), so the lookup goes through an
   * index-signature cast rather than the named-key type.
   */
  private static _getBackendAttributes(
    config: EngineOptions | undefined,
    type: RendererType | string,
  ): Record<string, unknown> | undefined {
    const renderer = config?.renderer as
      Record<string, { attributes?: Record<string, unknown> } | undefined> | undefined;
    const backend = renderer?.[type];
    return backend?.attributes ? { ...backend.attributes } : undefined;
  }

  /**
   * Combines the configured backend attributes with the shared `quality.msaa` override.
   * Shared by every fallback hop so each one re-evaluates attributes the same way.
   */
  private static _computeFallbackAttributes(
    config: EngineOptions | undefined,
    type: RendererType,
  ): Record<string, unknown> | undefined {
    let attributes = RendererFactory._getBackendAttributes(config, type);
    if (config?.quality?.msaa !== undefined) {
      attributes = attributes || {};
      if (attributes["antialias"] === undefined) {
        attributes["antialias"] = config.quality.msaa > 0;
      }
    }
    return attributes;
  }

  /**
   * Returns the prioritized list of renderer backends to try, starting with `requestedType`.
   */
  private static _getFallbackCandidates(requestedType: RendererType | string): RendererType[] {
    switch (requestedType) {
      case RendererType.BEST:
      case RendererType.WEB_GPU:
        return [RendererType.WEB_GPU, RendererType.WEB_GL2, RendererType.WEB_GL1];
      case RendererType.WEB_GL2:
        return [RendererType.WEB_GL2, RendererType.WEB_GL1];
      case RendererType.WEB_GL1:
        return [RendererType.WEB_GL1];
      default:
        return [RendererType.WEB_GL2, RendererType.WEB_GL1];
    }
  }

  private static _createRendererInstance(type: RendererType, context: RendererContext): Renderer {
    switch (type) {
      case RendererType.WEB_GPU:
        return new WebGPURenderer(context);
      case RendererType.WEB_GL2:
        return new WebGL2Renderer(context);
      case RendererType.WEB_GL1:
        return new WebGL1Renderer(context);
      default:
        return new WebGL2Renderer(context);
    }
  }

  private static _hasBackendFeature(type: RendererType, context: RendererContext): boolean {
    switch (type) {
      case RendererType.WEB_GPU:
        return context.deviceCaps.hasFeature(DeviceFeature.WEBGPU);
      case RendererType.WEB_GL2:
        return context.deviceCaps.hasFeature(DeviceFeature.WEBGL2);
      case RendererType.WEB_GL1:
        return context.deviceCaps.hasFeature(DeviceFeature.WEBGL1);
      default:
        return true;
    }
  }

  /**
   * Creates a new renderer instance based on the given type, cascading through fallbacks if needed.
   */
  public static async create(
    type: RendererType | string,
    canvas: HTMLCanvasElement,
    config?: EngineOptions,
    context: RendererContext = createDefaultRendererContext(),
  ): Promise<Renderer> {
    context.deviceCaps.init();

    const candidates = RendererFactory._getFallbackCandidates(type);
    let lastError: unknown = undefined;

    for (let i = 0; i < candidates.length; i++) {
      const candidateType = candidates[i]!;
      const isInitialChoice = i === 0;

      if (!RendererFactory._hasBackendFeature(candidateType, context)) {
        if (isInitialChoice) {
          console.warn(
            `[RendererFactory] ${candidateType} is not supported by device caps. Cascading to fallback.`,
          );
        }
        continue;
      }

      const renderer = RendererFactory._createRendererInstance(candidateType, context);
      const attributes = RendererFactory._computeFallbackAttributes(config, candidateType);

      try {
        await renderer.initialize(canvas, attributes, config);
        return renderer;
      } catch (e) {
        lastError = e;
        console.warn(
          `[RendererFactory] ${candidateType} initialization failed${
            i + 1 < candidates.length ? `, falling back to ${candidates[i + 1]}` : ""
          }. Error:`,
          e,
        );
      }
    }

    const errMsg = `[RendererFactory] Failed to initialize renderer for request '${type}' through fallback chain (${candidates.join(
      " -> ",
    )}).`;
    console.error(errMsg, lastError);
    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error(errMsg);
  }
}
