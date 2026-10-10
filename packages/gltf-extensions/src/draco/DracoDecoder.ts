import { GeometryDataInterface, ModelGeometry } from "@small-world-machine/engine";

export type DracoAttributeMapping = Record<string, number>;

export interface DecodedDracoAttributes {
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  indices?: Uint16Array | Uint32Array;
  joints?: Float32Array | Uint16Array;
  weights?: Float32Array;
}

export type DracoDecodeHandler = (
  buffer: ArrayBuffer,
  attributeIds: DracoAttributeMapping,
) => Promise<GeometryDataInterface> | GeometryDataInterface;

export interface DracoDecoderConfig {
  decoderPath?: string;
  workerLimit?: number;
}

/**
 * DracoDecoder manages Draco decompression for glTF primitives.
 * Third-party applications or WASM wrappers (e.g. draco3d) can register
 * a custom decode handler via `DracoDecoder.setDecodeHandler(handler)`
 * or configure WASM worker paths via `DracoDecoder.setConfig(config)`.
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
      attributes.joints || attributes.weights
        ? {
            joints: attributes.joints,
            weights: attributes.weights,
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

    // Default built-in parsing for standard buffer structures / uncompressed container wrappers
    const view = new DataView(buffer);
    if (buffer.byteLength >= 8) {
      // Check for DRACO magic header: 'DRACO' in ASCII (0x44, 0x52, 0x41, 0x43, 0x4F)
      const isDracoMagic =
        view.getUint8(0) === 0x44 &&
        view.getUint8(1) === 0x52 &&
        view.getUint8(2) === 0x41 &&
        view.getUint8(3) === 0x43 &&
        view.getUint8(4) === 0x4f;

      if (!isDracoMagic) {
        // If not a raw Draco bitstream, try decoding as packed raw float buffers (useful for testing & custom pack formats)
        const floatArray = new Float32Array(buffer);
        if (floatArray.length >= 3) {
          return this.createGeometryData({
            positions: floatArray,
          });
        }
      }
    }

    throw new Error(
      "[DracoDecoder] No WASM or custom decode handler registered to decompress Draco bitstream. " +
        "Call DracoDecoder.setDecodeHandler(handler) or install draco3d decoder.",
    );
  }
}
