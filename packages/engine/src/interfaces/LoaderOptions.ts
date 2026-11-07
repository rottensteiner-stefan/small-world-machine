import type { Object3D } from "../core/Object3D.js";
import type { StandardMaterial } from "../core/materials/surface/StandardMaterial.js";
import type { AssetManager } from "../loaders/AssetManager.js";

/**
 * Common configuration options for all resource loaders.
 */
export interface LoaderOptions {
  /** The base path to prepend to all resource URLs. Defaults to "". */
  basePath?: string;
  /**
   * The `AssetManager` instance to fetch/cache resources through. Defaults to a fresh, private
   * instance (not the deprecated process-wide singleton) -- pass `RendererContext.assetManager`
   * to share a cache/baseUrl/headers with the rest of an engine instance.
   */
  assetManager?: AssetManager;
}

/**
 * Specialized configuration options for image loaders.
 */
export interface ImageLoaderOptions extends LoaderOptions {
  /** Whether the image should be flipped vertically during loading/decoding. */
  flipY?: boolean;
}

/**
 * Specialized configuration options for glTF/GLB loaders.
 */
export interface GltfLoaderOptions extends LoaderOptions {
  /** Optional transformation function applied to node names during glTF hierarchy parsing. */
  nodeNameTransform?: (name: string) => string;
  /** Whether to normalize numeric Mixamo rig prefixes (e.g. "mixamorig1:" -> "mixamorig:"). Defaults to false. */
  normalizeMixamoRig?: boolean;
  /** Lifecycle hook invoked after each Object3D/Bone node is parsed and transformed. */
  onNodeParsed?: (object: Object3D, rawDef: Record<string, unknown>) => void;
  /** Lifecycle hook invoked after each material is constructed from glTF PBR definitions. */
  onMaterialParsed?: (material: StandardMaterial, rawDef: Record<string, unknown>) => void;
  /** Lifecycle hook invoked after the complete scene hierarchy and animations have been parsed. */
  onParsed?: (root: Object3D) => void;
  /** Maximum metallic factor (or [min, max] range) applied to parsed PBR materials. */
  clampMetallic?: number | [number, number];
  /** Maximum roughness factor (or [min, max] range) applied to parsed PBR materials. */
  clampRoughness?: number | [number, number];
  /** Default metallic factor used when a material does not explicitly define one. */
  defaultMetallic?: number;
  /** Default roughness factor used when a material does not explicitly define one. */
  defaultRoughness?: number;
  /** Initial material variant name or index to activate upon loading (KHR_materials_variants). */
  variant?: string | number;
}
