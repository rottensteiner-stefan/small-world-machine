import type { Object3D } from "../core/Object3D.js";
import { Decal } from "../core/objects/Decal.js";
import type { AbstractMaterial } from "../core/materials/AbstractMaterial.js";
import { StandardMaterial } from "../core/materials/surface/StandardMaterial.js";
import { Matrix4, Vector3D, Quaternion } from "../math/index.js";
import type { GeometryDataInterface } from "../interfaces/index.js";
import { getGltfExtensions } from "./gltf/GltfExtensionRegistry.js";
import { GltfMaterialParser } from "./gltf/GltfMaterialParser.js";
import type { GltfWriteContext, GltfWriteState } from "./gltf/GltfExtensionPlugin.js";
import type {
  GltfDocument,
  GltfNodeJson,
  GltfMeshJson,
  GltfMaterialJson,
  GltfAccessorJson,
  GltfBufferViewJson,
} from "./gltf/writerTypes.js";
// Side-effect import: registers the built-in extension plugins (KHR_lights_punctual,
// SWM_prefab_instance, SWM_stage_zone) -- see ADR 0017.
import "./gltf/extensions/index.js";

export type { GltfDocument, GltfNodeJson } from "./gltf/writerTypes.js";

const COMPONENT_TYPE_FLOAT = 5126;
const COMPONENT_TYPE_USHORT = 5123;
const COMPONENT_TYPE_UINT = 5125;

/**
 * Serializes a live `Object3D` tree into a minimal glTF 2.0 JSON document -- the write-side
 * counterpart to `GltfLoader`. See docs/adr/0010-maker-editor-architecture.md for why glTF +
 * an `SWM_*` extension namespace, rather than a bespoke format, and ADR 0017 for how individual
 * extensions (light, prefab, stage zone, ...) plug into this writer via a registry instead of
 * being hardcoded here.
 *
 * Phase 0 scope only:
 * - Node hierarchy and transforms (Euler or quaternion, whichever the object actually has set).
 * - One mesh's material, via native `pbrMetallicRoughness` -- no `SWM_*` extension needed yet
 *   since `StandardMaterial`'s fields map onto it directly.
 * - Geometry export covers `POSITION`, `NORMAL`, `TEXCOORD_0` and the index buffer (a mesh that
 *   comes back without its indices has the wrong triangles and cannot be raycast, which broke
 *   every Maker project on reload). Tangents, vertex colours, skinning data and material textures
 *   are not written yet.
 */
export class WorldWriter {
  private _nodes: GltfNodeJson[] = [];
  private _meshes: GltfMeshJson[] = [];
  private _materials: GltfMaterialJson[] = [];
  private _accessors: GltfAccessorJson[] = [];
  private _bufferViews: GltfBufferViewJson[] = [];
  private _bufferChunks: Uint8Array[] = [];
  private _extensionState: Map<string, unknown> = new Map();

  /**
   * Serializes every child of `root` (not `root` itself -- it plays the same role as
   * `GltfLoader`'s synthetic `"glTF_Root"`, a local container rather than scene content).
   */
  public write(root: Object3D): GltfDocument {
    this._resetState();
    const rootIndices = root.children.map((child) => this._writeNode(child));
    return this._finalize(rootIndices);
  }

  /** Serializes `obj` itself (and its subtree) as the document's sole top-level node -- unlike
   * `write()`, which serializes `root`'s *children*. Used for prefab export: `obj` stays exactly
   * where it is in the live scene graph (never reparented, unlike `Object3D.add()`'s silent
   * detach), so exporting a prefab from a selected object can't disturb the scene being edited. */
  public writeSingle(obj: Object3D): GltfDocument {
    this._resetState();
    return this._finalize([this._writeNode(obj)]);
  }

  private _resetState(): void {
    this._nodes = [];
    this._meshes = [];
    this._materials = [];
    this._accessors = [];
    this._bufferViews = [];
    this._bufferChunks = [];
    this._extensionState = new Map();
  }

  private _finalize(rootIndices: number[]): GltfDocument {
    const doc: GltfDocument = {
      asset: { version: "2.0", generator: "small-world-machine-maker" },
      scene: 0,
      scenes: [{ nodes: rootIndices }],
      nodes: this._nodes,
    };
    if (0 < this._meshes.length) doc.meshes = this._meshes;
    if (0 < this._materials.length) doc.materials = this._materials;
    if (0 < this._accessors.length) doc.accessors = this._accessors;
    if (0 < this._bufferViews.length) doc.bufferViews = this._bufferViews;
    if (0 < this._bufferChunks.length) {
      doc.buffers = [this._writeCombinedBuffer()];
    }

    const writeCtx: GltfWriteContext = { doc, state: this._extensionState };
    for (const plugin of getGltfExtensions()) plugin.finalizeWrite?.(writeCtx);

    const extensionsUsed = WorldWriter._collectExtensionsUsed(doc);
    if (0 < extensionsUsed.length) doc.extensionsUsed = extensionsUsed;

    return doc;
  }

  /** Every extension name actually present in the finished document (root or any node), so
   * `extensionsUsed` accurately reflects what's really there instead of being omitted entirely
   * (as it always was before ADR 0017). */
  private static _collectExtensionsUsed(doc: GltfDocument): string[] {
    const used = new Set<string>();
    for (const node of doc.nodes) {
      if (node.extensions) {
        for (const key of Object.keys(node.extensions)) used.add(key);
      }
    }
    if (doc.extensions) {
      for (const key of Object.keys(doc.extensions)) used.add(key);
    }
    return Array.from(used).sort();
  }

  private _writeNode(obj: Object3D): number {
    // Index reserved before recursing into children so every child's index is always greater
    // than its parent's -- not required by the spec, just keeps the document's node order
    // matching a human's intuitive reading of the hierarchy.
    const index = this._nodes.length;
    const node: GltfNodeJson = {
      name: obj.name,
      translation: [obj.position.x, obj.position.y, obj.position.z],
      rotation: WorldWriter._writeRotation(obj),
      scale: [obj.scale.x, obj.scale.y, obj.scale.z],
    };
    this._nodes.push(node);

    const writeState: GltfWriteState = { state: this._extensionState };
    for (const plugin of getGltfExtensions()) plugin.writeNode?.(obj, node, writeState);

    // A Decal's unit box is shared engine geometry, not scene content: SWM_decal describes it.
    if (obj.geometry && obj.material && !(obj instanceof Decal)) {
      node.mesh = this._writeMesh(obj.geometry, obj.material);
    }

    if (0 < obj.children.length) {
      node.children = obj.children.map((child) => this._writeNode(child));
    }

    return index;
  }

  private _writeMesh(geo: GeometryDataInterface, mat: AbstractMaterial): number {
    const vertexCount = geo.vertices.length / 3;
    const attributes: Record<string, number> = {
      POSITION: this._writeAccessor(geo.vertices, "VEC3", COMPONENT_TYPE_FLOAT, vertexCount, true),
    };
    // Only attributes that line up with the vertex list are written; a half-filled one would
    // shift every later vertex on reload.
    if (geo.normals && geo.normals.length === geo.vertices.length) {
      attributes["NORMAL"] = this._writeAccessor(
        geo.normals,
        "VEC3",
        COMPONENT_TYPE_FLOAT,
        vertexCount,
        false,
      );
    }
    if (geo.uvs && geo.uvs.length === vertexCount * 2) {
      attributes["TEXCOORD_0"] = this._writeAccessor(
        geo.uvs,
        "VEC2",
        COMPONENT_TYPE_FLOAT,
        vertexCount,
        false,
      );
    }
    const primitive: GltfMeshJson["primitives"][number] = { attributes };
    if (geo.indices && 0 < geo.indices.length) {
      primitive.indices = this._writeAccessor(
        geo.indices,
        "SCALAR",
        geo.indices instanceof Uint32Array ? COMPONENT_TYPE_UINT : COMPONENT_TYPE_USHORT,
        geo.indices.length,
        false,
      );
    }
    primitive.material = this._materials.length;
    this._materials.push(WorldWriter._writeMaterial(mat));

    const meshIndex = this._meshes.length;
    this._meshes.push({ primitives: [primitive] });
    return meshIndex;
  }

  /** Appends `data` to the shared buffer (4-byte aligned, as glTF requires of every buffer view) and returns the new accessor's index. */
  private _writeAccessor(
    data: Float32Array | Uint16Array | Uint32Array,
    type: string,
    componentType: number,
    count: number,
    withBounds: boolean,
  ): number {
    const bufferViewIndex = this._bufferViews.length;
    const byteOffset = this._bufferChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    // Copy the bytes out: the source TypedArray is live engine state that may be mutated (or
    // its buffer reused) after `write()` returns, but our accumulated chunks must stay stable
    // until `_writeCombinedBuffer()` concatenates them.
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
    const padded = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4);
    padded.set(bytes);
    this._bufferChunks.push(padded);
    this._bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength });

    const accessor: GltfAccessorJson = {
      bufferView: bufferViewIndex,
      componentType,
      count,
      type,
    };
    if (withBounds) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < data.length; i += 3) {
        for (let axis = 0; axis < 3; axis++) {
          const v = data[i + axis]!;
          min[axis] = Math.min(min[axis]!, v);
          max[axis] = Math.max(max[axis]!, v);
        }
      }
      accessor.min = min;
      accessor.max = max;
    }
    const accessorIndex = this._accessors.length;
    this._accessors.push(accessor);
    return accessorIndex;
  }

  private _writeCombinedBuffer(): { uri: string; byteLength: number } {
    const totalLength = this._bufferChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of this._bufferChunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      uri: `data:application/octet-stream;base64,${WorldWriter._encodeBase64(combined)}`,
      byteLength: totalLength,
    };
  }

  private static _writeMaterial(mat: AbstractMaterial): GltfMaterialJson {
    const json: GltfMaterialJson = {
      pbrMetallicRoughness: {
        // baseColorFactor is glTF-LINEAR while Material.color is sRGB-authored; encode it back
        // to linear on write so the loader's single encode round-trips the authored value (S5
        // EP-4). Alpha is never color-converted.
        baseColorFactor: [
          GltfMaterialParser.engineSRGBToLinear(mat.color.r),
          GltfMaterialParser.engineSRGBToLinear(mat.color.g),
          GltfMaterialParser.engineSRGBToLinear(mat.color.b),
          mat.color.a,
        ],
      },
    };
    if (mat instanceof StandardMaterial) {
      json.pbrMetallicRoughness!.metallicFactor = mat.metallic;
      json.pbrMetallicRoughness!.roughnessFactor = mat.roughness;
      if (0 < mat.emissiveColor.r || 0 < mat.emissiveColor.g || 0 < mat.emissiveColor.b) {
        json.emissiveFactor = [
          GltfMaterialParser.engineSRGBToLinear(mat.emissiveColor.r),
          GltfMaterialParser.engineSRGBToLinear(mat.emissiveColor.g),
          GltfMaterialParser.engineSRGBToLinear(mat.emissiveColor.b),
        ];
      }
    }
    if (mat.transparent) json.alphaMode = "BLEND";
    return json;
  }

  /**
   * glTF node `rotation` is always a quaternion. If the object's authoritative rotation is
   * already a quaternion (set by `GltfLoader` itself for imported quaternion-rotated nodes,
   * e.g. skinned rig bones), write it directly. Otherwise derive one from the Euler angles via
   * a scale-free rotation matrix -- `Quaternion.setFromRotationMatrix()` assumes an orthonormal
   * basis, so composing with the object's actual (possibly non-uniform) scale would distort it.
   */
  private static _writeRotation(obj: Object3D): number[] {
    if (obj.quaternion) {
      return [obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w];
    }
    const rotMatrix = new Matrix4().compose(
      new Vector3D(0, 0, 0),
      obj.rotation,
      new Vector3D(1, 1, 1),
    );
    const q = new Quaternion().setFromRotationMatrix(rotMatrix);
    return [q.x, q.y, q.z, q.w];
  }

  private static _encodeBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
  }
}
