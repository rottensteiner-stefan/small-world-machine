import { Object3D } from "../core/Object3D.js";
import { AbstractMaterial } from "../core/materials/AbstractMaterial.js";
import { StandardMaterial } from "../core/materials/StandardMaterial.js";
import { Matrix4, Vector3D, Quaternion } from "../math/index.js";
import { GeometryDataInterface } from "../interfaces/index.js";
import { getGltfExtensions } from "./gltf/GltfExtensionRegistry.js";
import { GltfWriteContext, GltfWriteState } from "./gltf/GltfExtensionPlugin.js";
import {
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
 * - Geometry export covers `POSITION` only (no normals/uvs/indices) -- enough to prove the
 *   round-trip mechanism end to end; richer attribute export is a later phase once Maker
 *   actually needs textured/lit preview meshes.
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

    if (obj.geometry && obj.material) {
      node.mesh = this._writeMesh(obj.geometry, obj.material);
    }

    if (0 < obj.children.length) {
      node.children = obj.children.map((child) => this._writeNode(child));
    }

    return index;
  }

  private _writeMesh(geo: GeometryDataInterface, mat: AbstractMaterial): number {
    const accessorIndex = this._writePositionAccessor(geo.vertices);
    const materialIndex = this._materials.length;
    this._materials.push(WorldWriter._writeMaterial(mat));

    const meshIndex = this._meshes.length;
    this._meshes.push({
      primitives: [{ attributes: { POSITION: accessorIndex }, material: materialIndex }],
    });
    return meshIndex;
  }

  private _writePositionAccessor(vertices: Float32Array): number {
    const bufferViewIndex = this._bufferViews.length;
    const byteOffset = this._bufferChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    // Copy the bytes out: the source TypedArray is live engine state that may be mutated (or
    // its buffer reused) after `write()` returns, but our accumulated chunks must stay stable
    // until `_writeCombinedBuffer()` concatenates them.
    const bytes = new Uint8Array(vertices.buffer, vertices.byteOffset, vertices.byteLength).slice();
    this._bufferChunks.push(bytes);
    this._bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength });

    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < vertices.length; i += 3) {
      const x = vertices[i]!,
        y = vertices[i + 1]!,
        z = vertices[i + 2]!;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }

    const accessorIndex = this._accessors.length;
    this._accessors.push({
      bufferView: bufferViewIndex,
      componentType: COMPONENT_TYPE_FLOAT,
      count: vertices.length / 3,
      type: "VEC3",
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    });
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
        baseColorFactor: [mat.color.r, mat.color.g, mat.color.b, mat.color.a],
      },
    };
    if (mat instanceof StandardMaterial) {
      json.pbrMetallicRoughness!.metallicFactor = mat.metallic;
      json.pbrMetallicRoughness!.roughnessFactor = mat.roughness;
      if (0 < mat.emissiveColor.r || 0 < mat.emissiveColor.g || 0 < mat.emissiveColor.b) {
        json.emissiveFactor = [mat.emissiveColor.r, mat.emissiveColor.g, mat.emissiveColor.b];
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
