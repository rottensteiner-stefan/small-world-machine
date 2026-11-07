import type { GeometryDataInterface } from "@small-world-machine/engine";
import DracoGlue from "../../vendor/draco/draco_wasm_wrapper.js?raw";
import dracoWasmUrl from "../../vendor/draco/draco_decoder.wasm?url";
import type { DecodedDracoAttributes, DracoAttributeMapping } from "./DracoDecoder.js";
import { DracoDecoder } from "./DracoDecoder.js";
import type { DracoAttribute, DracoMesh, DracoModule, DracoStatus } from "./dracoTypes.js";

export interface DracoWasmConfig {
  /** Optional alternate .wasm bytes to load instead of the vendored copy. */
  wasmBinary?: ArrayBuffer;
}

const JOINTS_PREFIX = "JOINTS_";

/**
 * Loads the vendored official Draco glTF WebAssembly decoder and uses it to decompress
 * `KHR_draco_mesh_compression` bitstreams on the calling thread. Quantized attributes are
 * dequantized by the decoder itself (`DT_FLOAT32`); only `JOINTS_n` is read as integers.
 * The WASM module is instantiated once per binary and reused across decode calls.
 */
export class DracoWasmDecoder {
  // Cached per binary reference (not globally): several engine instances on one page may each
  // configure their own `wasmBinary`. Weak keys: a binary nobody references anymore (and its
  // module) can be collected; the vendored default has no key object and lives in `_defaultModule`.
  private static readonly _modules = new WeakMap<ArrayBuffer, Promise<DracoModule>>();
  private static _defaultModule: Promise<DracoModule> | undefined;

  public static async getModule(config?: DracoWasmConfig): Promise<DracoModule> {
    const key = config?.wasmBinary;
    let cached = key ? this._modules.get(key) : this._defaultModule;
    if (!cached) {
      cached = this._initModule(config).catch((error: unknown) => {
        // A rejected load must not stay cached, or every retry would re-observe the same failure.
        if (key) this._modules.delete(key);
        else this._defaultModule = undefined;
        throw error;
      });
      if (key) this._modules.set(key, cached);
      else this._defaultModule = cached;
    }
    return cached;
  }

  private static async _initModule(config?: DracoWasmConfig): Promise<DracoModule> {
    // The vendored file is an Emscripten factory with a trailing CJS/AMD export footer (this
    // project is ESM): strip the footer and evaluate the remaining expression. The Node branch only
    // builds lazy loader closures that never run because `wasmBinary` is always supplied.
    const factorySource = DracoGlue.replace(/"object"===typeof exports[\s\S]*$/, "");
    // trusted vendored source
    const factory = new Function(
      "require",
      "__dirname",
      `${factorySource}\n;return DracoDecoderModule;`,
    )(
      (id: string): Record<string, unknown> =>
        id === "fs"
          ? { readFileSync: (): void => void 0, statSync: (): void => void 0 }
          : id === "path"
            ? {
                normalize: (p: string): string => p,
                join: (...parts: string[]): string => parts.join("/"),
              }
            : {},
      "",
    ) as (options: Record<string, unknown>) => Promise<DracoModule>;

    const wasmBinary = config?.wasmBinary ?? (await this._loadVendoredWasm());
    return factory({ wasmBinary });
  }

  private static async _loadVendoredWasm(): Promise<ArrayBuffer> {
    const res = await fetch(dracoWasmUrl);
    if (!res.ok) {
      throw new Error(
        `[DracoWasmDecoder] Failed to load vendored draco_decoder.wasm (${res.status})`,
      );
    }
    return res.arrayBuffer();
  }

  /**
   * Decodes a Draco triangle-mesh bitstream into a `GeometryDataInterface`.
   * @param buffer The raw Draco bytes (the `bufferView` slice of the glTF primitive).
   * @param attributeIds glTF semantic -> Draco unique attribute id (from the extension JSON).
   * @param config Optional config -- may supply the .wasm bytes.
   */
  public static async decode(
    buffer: ArrayBuffer,
    attributeIds: DracoAttributeMapping,
    config?: DracoWasmConfig,
  ): Promise<GeometryDataInterface> {
    const module = await this.getModule(config);
    const decoder = new module.Decoder();
    const decoderBuffer = new module.DecoderBuffer();
    let mesh: DracoMesh | undefined;
    let status: DracoStatus | undefined;
    try {
      decoderBuffer.Init(new Int8Array(buffer), buffer.byteLength);
      if (decoder.GetEncodedGeometryType(decoderBuffer) !== module.TRIANGULAR_MESH) {
        throw new Error("[DracoWasmDecoder] Only Draco triangle meshes are supported");
      }

      mesh = new module.Mesh();
      status = decoder.DecodeBufferToMesh(decoderBuffer, mesh);
      if (!status.ok() || mesh.ptr === 0) {
        throw new Error(`[DracoWasmDecoder] Decoding failed: ${status.error_msg()}`);
      }

      const numPoints = mesh.num_points();
      const decoded: DecodedDracoAttributes = {
        positions: this._readAttribute(
          module,
          decoder,
          mesh,
          this._requireId(attributeIds, "POSITION"),
          numPoints,
          Float32Array,
        ),
        indices: this._readIndices(module, decoder, mesh, numPoints),
      };

      const normal = attributeIds["NORMAL"];
      if (normal !== undefined) {
        decoded.normals = this._readAttribute(
          module,
          decoder,
          mesh,
          normal,
          numPoints,
          Float32Array,
        );
      }
      const tangent = attributeIds["TANGENT"];
      if (tangent !== undefined) {
        decoded.tangents = this._readAttribute(
          module,
          decoder,
          mesh,
          tangent,
          numPoints,
          Float32Array,
        );
        if (decoded.tangents.length !== numPoints * 4) {
          throw new Error(
            "[DracoWasmDecoder] TANGENT must have 4 components (xyz + handedness w), got " +
              `${decoded.tangents.length / numPoints}`,
          );
        }
      }
      const uv = attributeIds["TEXCOORD_0"];
      if (uv !== undefined) {
        decoded.uvs = this._readAttribute(module, decoder, mesh, uv, numPoints, Float32Array);
      }
      const joints = attributeIds[`${JOINTS_PREFIX}0`];
      if (joints !== undefined) {
        decoded.joints = this._readAttribute(module, decoder, mesh, joints, numPoints, Uint16Array);
      }
      const weights = attributeIds["WEIGHTS_0"];
      if (weights !== undefined) {
        decoded.weights = this._readAttribute(
          module,
          decoder,
          mesh,
          weights,
          numPoints,
          Float32Array,
        );
      }

      return DracoDecoder.createGeometryData(decoded);
    } finally {
      if (status) module.destroy(status);
      if (mesh) module.destroy(mesh);
      module.destroy(decoderBuffer);
      module.destroy(decoder);
    }
  }

  private static _requireId(attributeIds: DracoAttributeMapping, semantic: string): number {
    const id = attributeIds[semantic];
    if (id === undefined) {
      throw new Error(
        `[DracoWasmDecoder] Primitive declares no Draco attribute id for ${semantic}`,
      );
    }
    return id;
  }

  private static _readAttribute<T extends Float32Array | Uint16Array>(
    module: DracoModule,
    decoder: InstanceType<DracoModule["Decoder"]>,
    mesh: DracoMesh,
    uniqueId: number,
    numPoints: number,
    arrayType: {
      new (buffer: ArrayBuffer, byteOffset: number, length: number): T;
      BYTES_PER_ELEMENT: number;
    },
  ): T {
    const attribute: DracoAttribute = decoder.GetAttributeByUniqueId(mesh, uniqueId);
    // Unknown unique id yields a null wrapper (ptr 0); calling into it would trap the WASM runtime.
    if (!attribute || attribute.ptr === 0) {
      throw new Error(`[DracoWasmDecoder] Draco attribute with unique id ${uniqueId} not found`);
    }
    const numValues = numPoints * attribute.num_components();
    const byteLength = numValues * arrayType.BYTES_PER_ELEMENT;
    const dataType =
      arrayType.BYTES_PER_ELEMENT === Uint16Array.BYTES_PER_ELEMENT
        ? module.DT_UINT16
        : module.DT_FLOAT32;
    const ptr = module._malloc(byteLength);
    try {
      if (!decoder.GetAttributeDataArrayForAllPoints(mesh, attribute, dataType, byteLength, ptr)) {
        throw new Error(`[DracoWasmDecoder] Failed to read attribute with unique id ${uniqueId}`);
      }
      // Heap view is created after the call: _malloc/decode may grow (and so replace) wasm memory.
      return new arrayType(module.HEAPU8.buffer as ArrayBuffer, ptr, numValues).slice() as T;
    } finally {
      module._free(ptr);
    }
  }

  private static _readIndices(
    module: DracoModule,
    decoder: InstanceType<DracoModule["Decoder"]>,
    mesh: DracoMesh,
    numPoints: number,
  ): Uint16Array | Uint32Array {
    const numIndices = mesh.num_faces() * 3;
    const byteLength = numIndices * Uint32Array.BYTES_PER_ELEMENT;
    const ptr = module._malloc(byteLength);
    try {
      if (!decoder.GetTrianglesUInt32Array(mesh, byteLength, ptr)) {
        throw new Error("[DracoWasmDecoder] Failed to read triangle indices");
      }
      const indices = new Uint32Array(module.HEAPU8.buffer as ArrayBuffer, ptr, numIndices).slice();
      return numPoints <= 0xffff ? Uint16Array.from(indices) : indices;
    } finally {
      module._free(ptr);
    }
  }
}
