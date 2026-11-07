/**
 * Types of renderers supported by the engine.
 */
export const RendererType = {
  /** Automatically select the best available renderer. */
  BEST: "BEST",
  /** WebGPU renderer. */
  WEB_GPU: "WEB_GPU",
  /** WebGL 2.0 renderer. */
  WEB_GL2: "WEB_GL2",
  /** WebGL 1.0 renderer. */
  WEB_GL1: "WEB_GL1",
  /** 2D Canvas fallback renderer. */
  CANVAS: "CANVAS",
  /** The renderer type assumed when none is specified. */
  DEFAULT: "BEST",
} as const;

/** Type definition for RendererType. */
export type RendererType = (typeof RendererType)[keyof typeof RendererType];
