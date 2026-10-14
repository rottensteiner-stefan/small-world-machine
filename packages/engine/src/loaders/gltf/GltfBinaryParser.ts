import { GltfJson, GltfData, TypedArray } from "./types.js";

/**
 * Utility parser for glTF 2.0 binary chunks (.glb), Base64 data URIs, and buffer accessors.
 */
export class GltfBinaryParser {
  /**
   * Parses a binary .glb container into its JSON description and binary buffer payload.
   */
  public static parseGlb(arrayBuffer: ArrayBuffer): GltfData {
    const dataView = new DataView(arrayBuffer);

    // Check Magic: "glTF" (0x46546c67)
    const magic = dataView.getUint32(0, true);
    if (magic !== 0x46546c67) throw new Error("Not a valid .glb file.");

    const version = dataView.getUint32(4, true);
    if (version !== 2) throw new Error("Only glTF 2.0 is supported.");

    let json: GltfJson | null = null;
    const buffers: ArrayBuffer[] = [];
    let offset = 12;

    while (offset < arrayBuffer.byteLength) {
      const chunkLength = dataView.getUint32(offset, true);
      const chunkType = dataView.getUint32(offset + 4, true);
      offset += 8;

      if (chunkType === 0x4e4f534a) {
        // JSON chunk
        const jsonContent = new TextDecoder().decode(
          new Uint8Array(arrayBuffer, offset, chunkLength),
        );
        json = JSON.parse(jsonContent) as GltfJson;
      } else if (chunkType === 0x004e4942) {
        // BIN chunk
        buffers.push(arrayBuffer.slice(offset, offset + chunkLength));
      }
      offset += chunkLength;
    }

    if (!json) throw new Error("No JSON chunk found in .glb file.");

    return { json, buffers };
  }

  /**
   * Decodes a Base64-encoded Data URI into an ArrayBuffer.
   */
  public static decodeBase64(uri: string): ArrayBuffer {
    const base64 = uri.split(",")[1]!;
    const binaryStr = atob(base64);
    const buffer = new ArrayBuffer(binaryStr.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < binaryStr.length; i++) view[i] = binaryStr.charCodeAt(i);
    return buffer;
  }

  /**
   * Extracts a typed array slice from glTF accessors and buffer views.
   */
  public static getBufferData(
    accessor: NonNullable<GltfJson["accessors"]>[number] | undefined,
    json: GltfJson,
    buffers: ArrayBuffer[],
  ): TypedArray | null {
    if (accessor === undefined || accessor.bufferView === undefined || !json.bufferViews)
      return null;
    const bufferView = json.bufferViews[accessor.bufferView];
    if (!bufferView) return null;
    const buffer = buffers[bufferView.buffer];

    if (!buffer) {
      return null;
    }

    const accessorByteOffset = accessor.byteOffset || 0;
    const viewByteOffset = bufferView.byteOffset || 0;
    const byteOffset = viewByteOffset + accessorByteOffset;
    const numComponents = this.getComponentCount(accessor.type);
    const count = accessor.count * numComponents;

    let bytesPerElement: number;
    let ctor: new (buffer: ArrayBuffer, byteOffset: number, length: number) => TypedArray;

    switch (accessor.componentType) {
      case 5120:
        bytesPerElement = 1;
        ctor = Int8Array;
        break;
      case 5121:
        bytesPerElement = 1;
        ctor = Uint8Array;
        break;
      case 5122:
        bytesPerElement = 2;
        ctor = Int16Array;
        break;
      case 5123:
        bytesPerElement = 2;
        ctor = Uint16Array;
        break;
      case 5125:
        bytesPerElement = 4;
        ctor = Uint32Array;
        break;
      case 5126:
        bytesPerElement = 4;
        ctor = Float32Array;
        break;
      default:
        return null;
    }

    const elementByteSize = numComponents * bytesPerElement;
    const stride =
      bufferView.byteStride !== undefined && bufferView.byteStride !== 0
        ? bufferView.byteStride
        : elementByteSize;

    if (stride < elementByteSize) {
      throw new Error(
        `[GltfBinaryParser] Invalid byteStride ${stride} < element size ${elementByteSize}`,
      );
    }

    const requiredBytes = accessor.count > 0 ? (accessor.count - 1) * stride + elementByteSize : 0;

    if (byteOffset + requiredBytes > buffer.byteLength) {
      throw new Error(
        `[GltfBinaryParser] Accessor ${accessor.bufferView} (componentType ${accessor.componentType}, ` +
          `count ${accessor.count}) exceeds buffer: ${byteOffset + requiredBytes} > ${buffer.byteLength} bytes`,
      );
    }

    if (
      bufferView.byteLength !== undefined &&
      accessorByteOffset + requiredBytes > bufferView.byteLength
    ) {
      throw new Error(
        `[GltfBinaryParser] Accessor ${accessor.bufferView} exceeds bufferView byteLength: ` +
          `${accessorByteOffset + requiredBytes} > ${bufferView.byteLength} bytes`,
      );
    }

    if (accessor.normalized) {
      const result = new Float32Array(count);
      const view = new DataView(buffer, byteOffset, requiredBytes);
      for (let i = 0; i < accessor.count; i++) {
        const elemOffset = i * stride;
        for (let c = 0; c < numComponents; c++) {
          const compOffset = elemOffset + c * bytesPerElement;
          const outIdx = i * numComponents + c;
          switch (accessor.componentType) {
            case 5120:
              result[outIdx] = Math.max(view.getInt8(compOffset) / 127.0, -1.0);
              break;
            case 5121:
              result[outIdx] = view.getUint8(compOffset) / 255.0;
              break;
            case 5122:
              result[outIdx] = Math.max(view.getInt16(compOffset, true) / 32767.0, -1.0);
              break;
            case 5123:
              result[outIdx] = view.getUint16(compOffset, true) / 65535.0;
              break;
            case 5125:
              result[outIdx] = view.getUint32(compOffset, true) / 4294967295.0;
              break;
            case 5126:
              result[outIdx] = view.getFloat32(compOffset, true);
              break;
          }
        }
      }
      return result;
    }

    if (stride === elementByteSize) {
      if (byteOffset % bytesPerElement === 0) {
        return new ctor(buffer, byteOffset, count);
      }
      const unalignedSlice = buffer.slice(byteOffset, byteOffset + requiredBytes);
      return new ctor(unalignedSlice, 0, count);
    }

    // Interleaved accessor: unpack from strided layout into dense typed array
    const output = new (ctor as unknown as new (length: number) => TypedArray)(count);
    const view = new DataView(buffer, byteOffset, requiredBytes);
    for (let i = 0; i < accessor.count; i++) {
      const elemOffset = i * stride;
      for (let c = 0; c < numComponents; c++) {
        const compOffset = elemOffset + c * bytesPerElement;
        const outIdx = i * numComponents + c;
        switch (accessor.componentType) {
          case 5120:
            (output as Int8Array)[outIdx] = view.getInt8(compOffset);
            break;
          case 5121:
            (output as Uint8Array)[outIdx] = view.getUint8(compOffset);
            break;
          case 5122:
            (output as Int16Array)[outIdx] = view.getInt16(compOffset, true);
            break;
          case 5123:
            (output as Uint16Array)[outIdx] = view.getUint16(compOffset, true);
            break;
          case 5125:
            (output as Uint32Array)[outIdx] = view.getUint32(compOffset, true);
            break;
          case 5126:
            (output as Float32Array)[outIdx] = view.getFloat32(compOffset, true);
            break;
        }
      }
    }
    return output;
  }

  /**
   * Returns the number of scalar components for a glTF accessor type name.
   */
  public static getComponentCount(type: string): number {
    switch (type) {
      case "SCALAR":
        return 1;
      case "VEC2":
        return 2;
      case "VEC3":
        return 3;
      case "VEC4":
        return 4;
      case "MAT2":
        return 4;
      case "MAT3":
        return 9;
      case "MAT4":
        return 16;
      default:
        throw new Error(`[GltfBinaryParser] Unsupported accessor type "${type}".`);
    }
  }
}
