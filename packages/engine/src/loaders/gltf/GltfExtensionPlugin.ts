import { Object3D } from "../../core/Object3D.js";
import { GltfJson } from "./types.js";
import { GltfDocument, GltfNodeJson } from "./writerTypes.js";
import { GeometryDataInterface } from "../../interfaces/index.js";
import { Texture } from "../../core/textures/Texture.js";
import { AssetManager } from "../AssetManager.js";

/** The raw JSON shape of a single glTF node, as it appears in `GltfJson.nodes[]`. */
export type GltfNodeDef = NonNullable<GltfJson["nodes"]>[number];

/** The raw JSON shape of a single glTF primitive, as it appears in `GltfJson.meshes[].primitives[]`. */
export type GltfPrimitiveDef = NonNullable<
  NonNullable<GltfJson["meshes"]>[number]["primitives"]
>[number];

/** The raw JSON shape of a single glTF texture, as it appears in `GltfJson.textures[]`. */
export type GltfTextureDef = NonNullable<GltfJson["textures"]>[number];

/** The raw JSON shape of a single glTF image, as it appears in `GltfJson.images[]`. */
export type GltfImageDef = NonNullable<GltfJson["images"]>[number];

/** Shared, per-parse state for the read side. `state` lets a plugin carry data from its
 * `prepareRead` pre-pass to its later `readNode`/`applyNode` calls without keeping it on the
 * plugin object itself -- plugin objects are registered once and reused across every load, so
 * they must stay stateless to remain safe for overlapping/concurrent parses. */
export interface GltfReadContext {
  readonly json: GltfJson;
  readonly state: Map<string, unknown>;
}

/** Shared, per-write-call state passed to `writeNode` -- same rationale as `GltfReadContext`.
 * Deliberately has no `doc` field: `writeNode` runs per-node during the recursive tree walk,
 * before the document itself has been assembled -- only `state` (for accumulating root-level
 * data, e.g. `KHR_lights_punctual`'s `lights[]`) is available at that point. */
export interface GltfWriteState {
  readonly state: Map<string, unknown>;
}

/** Passed to `finalizeWrite`, once the whole tree has been written and `doc` actually exists. */
export interface GltfWriteContext extends GltfWriteState {
  readonly doc: GltfDocument;
}

/**
 * A single glTF vendor/community extension's read+write behavior, registered via
 * `registerGltfExtension()` (see `GltfExtensionRegistry.ts`) instead of being hardcoded as an
 * if/else branch inside `GltfLoader`/`WorldWriter` -- see ADR 0017. All hooks are optional; a
 * plugin implements only the ones its extension actually needs (e.g. `SW_prefab_instance` only
 * ever sets a plain field, so it has no `prepareRead`/`finalizeWrite`).
 */
export interface GltfExtensionPlugin {
  /** The glTF extension name this plugin handles, e.g. `"KHR_lights_punctual"`. Also written
   * into the document's `extensionsUsed` array when this plugin's `writeNode` actually emits
   * something for at least one node. */
  readonly name: string;
  /** Optional root-level pre-pass over the whole document, run once before any node is
   * constructed -- e.g. indexing `KHR_lights_punctual.lights[]` by node so `readNode` doesn't
   * need to re-scan the root extension data for every node. */
  prepareRead?(ctx: GltfReadContext): void;
  /** Decide the concrete `Object3D` subclass for a node from this extension's data, e.g. a
   * `PointLight` for `KHR_lights_punctual` or a `StageZoneMarker` for `SW_stage_zone`. Return
   * `undefined` to defer to the next plugin (or the plain `Object3D` fallback) -- plugins are
   * tried in registration order and the first non-`undefined` result wins. */
  readNode?(
    nodeIndex: number,
    nodeDef: GltfNodeDef,
    name: string,
    ctx: GltfReadContext,
  ): Object3D | undefined;
  /** Apply this extension's data as plain fields onto an already-constructed node (e.g.
   * `SW_prefab_instance` setting `obj.prefabSource`) -- called for every node, after its class
   * has already been decided. */
  applyNode?(obj: Object3D, nodeDef: GltfNodeDef, ctx: GltfReadContext): void;
  /** Mutate `node.extensions` for `obj` during `WorldWriter`'s node tree walk, if relevant. */
  writeNode?(obj: Object3D, node: GltfNodeJson, ctx: GltfWriteState): void;
  /** Flush any root-level data accumulated in `ctx.state` during `writeNode` (e.g.
   * `KHR_lights_punctual`'s `lights[]` array) into `ctx.doc.extensions` once, after the whole
   * tree has been written. */
  finalizeWrite?(ctx: GltfWriteContext): void;

  /**
   * Optional hook to decode geometry for a mesh primitive (e.g. `KHR_draco_mesh_compression`).
   * Return decoded `GeometryDataInterface` or `undefined` / `null` to defer to the next plugin
   * or the default accessor parser.
   */
  decodeGeometry?(
    primitive: GltfPrimitiveDef,
    ctx: GltfReadContext,
    buffers: ArrayBuffer[],
  ): Promise<GeometryDataInterface | null | undefined> | GeometryDataInterface | null | undefined;

  /**
   * Optional hook to resolve a texture definition into a Small World Machine `Texture` (e.g. `KHR_texture_basisu`).
   * Return resolved `Texture` or `undefined` / `null` to defer to standard texture resolution.
   */
  resolveTexture?(
    textureDef: GltfTextureDef,
    ctx: GltfReadContext,
    folderPath: string,
    buffers: ArrayBuffer[],
    assetManager: AssetManager,
  ): Promise<Texture | null | undefined> | Texture | null | undefined;
}
