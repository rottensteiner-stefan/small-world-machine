/**
 * Headless core of the Small World Machine tools (M2 -- Headless Core Extraction).
 *
 * Pure TypeScript + engine imports only. No DOM access at module scope (Grep-Gate F1:
 * zero hits for the canvas-context / DOM-global access patterns under this directory).
 *
 * Exports are flattened deliberately: `sprite` ops are the only source of
 * `flipRgba`, `pixler` adds its own op names, so no `export *` collision can occur.
 */

export * from "./RasterIO.js";
export * from "./sprite.js";
export {
  computeTrimBounds,
  floodFill,
  mirrorRgba,
  panRgba,
  trimRgba,
  type PixlerTrimOptions,
} from "./pixler.js";
export * from "./map.js";
export * from "./material.js";
export * from "./kit.js";
export * from "./ibl.js";
export * from "./splatter.js";
