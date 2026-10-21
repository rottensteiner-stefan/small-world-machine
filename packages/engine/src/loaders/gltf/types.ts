export type TypedArray =
  Int8Array | Uint8Array | Int16Array | Uint16Array | Uint32Array | Float32Array;

export interface GltfJson {
  asset?: { version?: string; generator?: string; [key: string]: unknown };
  buffers?: { uri?: string }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  accessors?: {
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
    normalized?: boolean;
    sparse?: {
      count: number;
      indices: { bufferView: number; byteOffset?: number; componentType: number };
      values: { bufferView: number; byteOffset?: number };
    };
  }[];
  meshes?: {
    name?: string;
    primitives: {
      attributes: { [key: string]: number };
      indices?: number;
      material?: number;
      mode?: number;
      extensions?: {
        KHR_draco_mesh_compression?: {
          bufferView: number;
          attributes: { [name: string]: number };
        };
        KHR_materials_variants?: {
          mappings?: {
            material: number;
            variants: number[];
          }[];
        };
        [key: string]: unknown;
      };
    }[];
  }[];
  skins?: {
    inverseBindMatrices?: number;
    skeleton?: number;
    joints: number[];
    name?: string;
  }[];
  animations?: {
    name?: string;
    channels: {
      sampler: number;
      target: {
        node?: number;
        path: "translation" | "rotation" | "scale" | "weights";
      };
    }[];
    samplers: {
      input: number;
      output: number;
      interpolation?: "LINEAR" | "STEP" | "CUBICSPLINE";
    }[];
  }[];
  nodes?: {
    name?: string;
    children?: number[];
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    mesh?: number;
    skin?: number;
    extensions?: {
      KHR_lights_punctual?: { light: number };
      SWM_prefab_instance?: { source: string };
      SWM_lights_ambient?: { color?: number[]; intensity?: number };
      SWM_stage_zone?: { displayName?: string; points: { u: number; v: number; scale?: number }[] };
      [key: string]: unknown;
    };
  }[];
  scenes?: { nodes?: number[] }[];
  scene?: number;
  extensionsRequired?: string[];
  extensionsUsed?: string[];
  /** Root-level `extensions` */
  extensions?: {
    KHR_lights_punctual?: {
      lights: {
        type: "point" | "directional" | "spot";
        color?: number[];
        intensity?: number;
        range?: number;
        spot?: { innerConeAngle?: number; outerConeAngle?: number };
        extras?: Record<string, unknown>;
        name?: string;
      }[];
    };
    KHR_materials_variants?: {
      variants?: {
        name: string;
      }[];
    };
    [key: string]: unknown;
  };
  materials?: {
    pbrMetallicRoughness?: {
      baseColorFactor?: number[];
      baseColorTexture?: { index: number };
      metallicFactor?: number;
      roughnessFactor?: number;
      metallicRoughnessTexture?: { index: number };
    };
    normalTexture?: { index: number; scale?: number };
    occlusionTexture?: { index: number; strength?: number };
    emissiveTexture?: { index: number };
    emissiveFactor?: number[];
    alphaMode?: "OPAQUE" | "MASK" | "BLEND";
    alphaCutoff?: number;
    doubleSided?: boolean;
    extensions?: {
      KHR_materials_emissive_strength?: {
        emissiveStrength?: number;
      };
      KHR_materials_clearcoat?: {
        clearcoatFactor?: number;
        clearcoatTexture?: { index: number };
        clearcoatRoughnessFactor?: number;
        clearcoatRoughnessTexture?: { index: number };
        clearcoatNormalTexture?: { index: number; scale?: number };
      };
      KHR_materials_sheen?: {
        sheenColorFactor?: number[];
        sheenColorTexture?: { index: number };
        sheenRoughnessFactor?: number;
        sheenRoughnessTexture?: { index: number };
      };
      KHR_materials_transmission?: {
        transmissionFactor?: number;
        transmissionTexture?: { index: number };
      };
      KHR_materials_volume?: {
        thicknessFactor?: number;
        thicknessTexture?: { index: number };
        attenuationDistance?: number;
        attenuationColor?: number[];
      };
      KHR_materials_ior?: {
        ior?: number;
      };
      [key: string]: unknown;
    };
  }[];
  textures?: {
    source?: number;
    sampler?: number;
    extensions?: {
      KHR_texture_basisu?: {
        source: number;
      };
      [key: string]: unknown;
    };
  }[];
  images?: {
    uri?: string;
    bufferView?: number;
    mimeType?: string;
    extensions?: { [key: string]: unknown };
  }[];
}

export interface GltfData {
  json: GltfJson;
  buffers: ArrayBuffer[];
}
