import type { GeometryDataInterface } from "@small-world-machine/engine";
import { ModelGeometry } from "@small-world-machine/engine";

export type DracoAttributeMapping = Record<string, number>;

export interface DecodedDracoAttributes {
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  /** glTF `TANGENT`: 4 components per vertex, `w` = ±1 bitangent handedness. */
  tangents?: Float32Array;
  indices?: Uint16Array | Uint32Array;
  joints?: Float32Array | Uint16Array;
  weights?: Float32Array;
}

export type DracoDecodeHandler = (
  buffer: ArrayBuffer,
  attributeIds: DracoAttributeMapping,
) => Promise<GeometryDataInterface> | GeometryDataInterface;

export interface DracoDecoderConfig {
  /** Alternate `draco_decoder.wasm` bytes to use instead of the vendored copy. */
  wasmBinary?: ArrayBuffer | undefined;
}

/**
 * DracoDecoder manages Draco decompression for glTF primitives. Real Draco bitstreams are decoded
 * with the vendored WebAssembly decoder (`DracoWasmDecoder`, main thread); applications can
 * replace that via `DracoDecoder.setDecodeHandler(handler)` or supply their own .wasm bytes via
 * `DracoDecoder.setConfig({ wasmBinary })`.
 */
export class DracoDecoder {
  private static _config: DracoDecoderConfig = {};
  private static _customHandler: DracoDecodeHandler | null = null;

  /**
   * Configures decoder paths and options.
   */
  public static setConfig(config: DracoDecoderConfig): void {
    this._config = { ...this._config, ...config };
  }

  /**
   * Returns current decoder configuration.
   */
  public static getConfig(): Readonly<DracoDecoderConfig> {
    return this._config;
  }

  /**
   * Sets a custom decoding handler (e.g. wrapping a WebAssembly or Web Worker draco decoder).
   */
  public static setDecodeHandler(handler: DracoDecodeHandler | null): void {
    this._customHandler = handler;
  }

  /**
   * Helper factory to build a GeometryDataInterface from raw typed arrays.
   */
  public static createGeometryData(attributes: DecodedDracoAttributes): GeometryDataInterface {
    return new ModelGeometry(
      attributes.positions,
      attributes.uvs ?? new Float32Array(0),
      attributes.normals ?? new Float32Array(0),
      attributes.indices ?? new Uint16Array(0),
      attributes.joints || attributes.weights || attributes.tangents
        ? {
            joints: attributes.joints,
            weights: attributes.weights,
            tangents: attributes.tangents,
          }
        : undefined,
    ).getGeometryData();
  }

  /**
   * Decodes a Draco compressed buffer into a Small World Machine GeometryDataInterface.
   */
  public static async decode(
    buffer: ArrayBuffer,
    attributeIds: DracoAttributeMapping,
  ): Promise<GeometryDataInterface> {
    if (this._customHandler) {
      return this._customHandler(buffer, attributeIds);
    }

    const view = new DataView(buffer);
    if (buffer.byteLength >= 8) {
      // Check for DRACO magic header: 'DRACO' in ASCII (0x44, 0x52, 0x41, 0x43, 0x4F)
      const isDracoMagic =
        view.getUint8(0) === 0x44 &&
        view.getUint8(1) === 0x52 &&
        view.getUint8(2) === 0x41 &&
        view.getUint8(3) === 0x43 &&
        view.getUint8(4) === 0x4f;

      if (isDracoMagic) {
        // Lazy: DracoWasmDecoder imports this module (createGeometryData), and the wasm glue is
        // only worth loading once a real bitstream shows up.
        const { DracoWasmDecoder } = await import("./DracoWasmDecoder.js");
        const wasmConfig = this._config.wasmBinary
          ? { wasmBinary: this._config.wasmBinary }
          : undefined;
        return DracoWasmDecoder.decode(buffer, attributeIds, wasmConfig);
      }

      // Not a Draco stream: accept packed raw float positions (tests / custom pack formats).
      const floatArray = new Float32Array(buffer);
      if (floatArray.length >= 3) {
        return this.createGeometryData({ positions: floatArray });
      }
    }

    throw new Error(
      "[DracoDecoder] Buffer is neither a Draco bitstream (missing 'DRACO' magic) nor packed float " +
        "positions. Call DracoDecoder.setDecodeHandler(handler) to decode a custom format.",
    );
  }
}
