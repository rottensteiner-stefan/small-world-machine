/** Subset of the Emscripten `DracoDecoderModule` API (Draco glTF decoder build) used by `DracoWasmDecoder`. */
export interface DracoStatus {
  ok(): boolean;
  error_msg(): string;
}

export interface DracoAttribute {
  /** Emscripten wrapper pointer; 0 = null attribute (unknown unique id). */
  ptr: number;
  num_components(): number;
}

export interface DracoMesh {
  ptr: number;
  num_faces(): number;
  num_points(): number;
}

export interface DracoDecoderBuffer {
  Init(data: Int8Array, byteLength: number): void;
}

export interface DracoDecoderInstance {
  GetEncodedGeometryType(buffer: DracoDecoderBuffer): number;
  DecodeBufferToMesh(buffer: DracoDecoderBuffer, mesh: DracoMesh): DracoStatus;
  GetAttributeByUniqueId(mesh: DracoMesh, uniqueId: number): DracoAttribute;
  GetAttributeDataArrayForAllPoints(
    mesh: DracoMesh,
    attribute: DracoAttribute,
    dataType: number,
    byteLength: number,
    ptr: number,
  ): boolean;
  GetTrianglesUInt32Array(mesh: DracoMesh, byteLength: number, ptr: number): boolean;
}

export interface DracoModule {
  Decoder: new () => DracoDecoderInstance;
  DecoderBuffer: new () => DracoDecoderBuffer;
  Mesh: new () => DracoMesh;
  TRIANGULAR_MESH: number;
  DT_FLOAT32: number;
  DT_UINT16: number;
  HEAPU8: Uint8Array;
  _malloc(byteLength: number): number;
  _free(ptr: number): void;
  destroy(object: object): void;
}
