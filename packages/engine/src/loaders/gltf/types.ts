import type { StageScaleGradient } from "../../core/stage/StageZone.js";

export type TypedArray =
  Int8Array | Uint8Array | Int16Array | Uint16Array | Uint32Array | Float32Array;

/** `KHR_texture_transform` payload of a texture reference. */
export interface GltfTextureTransform {
  offset?: number[];
  rotation?: number;
  scale?: number[];
  texCoord?: number;
}

/** A glTF `textureInfo` reference: texture index plus the optional `KHR_texture_transform`. */
export interface GltfTextureInfo {
  index: number;
  /** UV set; only 0 (`TEXCOORD_0`) is imported. */
  texCoord?: number;
  extensions?: {
    KHR_texture_transform?: GltfTextureTransform;
    [key: string]: unknown;
  };
}

export interface GltfJson {
  asset?: {
    version?: string;
    generator?: string;
    extras?: { swmLightColorSpace?: string };
    [key: string]: unknown;
  };
  buffers?: { uri?: string }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  accessors?: {
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
    normalized?: boolean;
    /** Per-component minimum (raw domain: integers stay integers, floats stay floats). */
    min?: number[];
    /** Per-component maximum (raw domain: integers stay integers, floats stay floats). */
    max?: number[];
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
      SWM_stage_zone?: {
        displayName?: string;
        points: { u: number; v: number; scale?: number }[];
        scaleGradient?: StageScaleGradient;
        useScaleGradient?: boolean;
      };
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
      baseColorTexture?: GltfTextureInfo;
      metallicFactor?: number;
      roughnessFactor?: number;
      metallicRoughnessTexture?: GltfTextureInfo;
    };
    normalTexture?: GltfTextureInfo & { scale?: number };
    occlusionTexture?: GltfTextureInfo & { strength?: number };
    emissiveTexture?: GltfTextureInfo;
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
      KHR_materials_iridescence?: {
        iridescenceFactor?: number;
        iridescenceTexture?: GltfTextureInfo;
        iridescenceIor?: number;
        iridescenceThicknessMinimum?: number;
        iridescenceThicknessMaximum?: number;
        iridescenceThicknessTexture?: GltfTextureInfo;
      };
      KHR_materials_anisotropy?: {
        anisotropyStrength?: number;
        anisotropyRotation?: number;
        anisotropyTexture?: GltfTextureInfo;
      };
      // KHR_materials_unlit: an empty object per spec; presence marks the material unlit.
      KHR_materials_unlit?: Record<string, never>;
      KHR_materials_specular?: {
        specularFactor?: number;
        specularTexture?: GltfTextureInfo;
        specularColorFactor?: number[];
        specularColorTexture?: GltfTextureInfo;
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
      EXT_texture_webp?: {
        source: number;
      };
      [key: string]: unknown;
    };
  }[];
  /** Texture sampler state referenced by `textures[].sampler` (GL enum values, all optional). */
  samplers?: {
    magFilter?: number;
    minFilter?: number;
    wrapS?: number;
    wrapT?: number;
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
