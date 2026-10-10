import type { EngineOptions, KitSocket } from "@small-world-machine/engine";
import type { ValidationReport } from "../common/io/index.js";

export interface KitMountResult {
  ok: boolean;
  report: ValidationReport;
  /** Kit id used to address the mounted source (`manifest.id`). */
  kitId: string;
  /** Display name from the validated manifest. */
  name: string;
}

export type LightingPreset = "studio" | "bunker" | "cold";

export interface KitInspectorOptions extends EngineOptions {
  canvasId: string;
  basePath?: string;
  onAssetLoaded?: ((info: InspectedAssetInfo) => void) | undefined;
  onLoadingStateChange?: ((loading: boolean, message?: string) => void) | undefined;
  onError?: ((err: Error) => void) | undefined;
}

export interface InspectedAssetInfo {
  type: "prop" | "texture" | "decal";
  id: string;
  kitId: string;
  name: string;
  category: string;
  description: string;
  author: string;
  license: string;
  version: string;
  previewUrl: string;
  triangles?: number | undefined;
  materialsCount?: number | undefined;
  dimensions?: { width: number; height: number; depth: number } | undefined;
  recommendedScale?: number | undefined;
  sockets?: KitSocket[] | undefined;
  textureMaps?: string[] | undefined;
  decalFile?: string | undefined;
}

export interface CameraFrame {
  target: { x: number; y: number; z: number };
  distance: number;
  yaw?: number;
  pitch?: number;
}
