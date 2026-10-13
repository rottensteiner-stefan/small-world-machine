import type { SwmDecalPayload } from "../kit/DecalShell.js";

/**
 * Minimal glTF 2.0 JSON document shape `WorldWriter` produces -- deliberately not the full spec,
 * only the subset exercised by the World Format's round-trip (node hierarchy, one mesh's
 * material, lights, and the `SWM_*` vendor extensions). Kept in its own module (rather than
 * defined inline in `WorldWriter.ts`) so `GltfExtensionPlugin` implementations can reference
 * these types without an import cycle back through `WorldWriter.ts` itself. See
 * docs/adr/0010-maker-editor-architecture.md and docs/adr/0017-gltf-extension-plugin-registry.md.
 */
export interface GltfDocument {
  asset: { version: "2.0"; generator: string };
  scene: number;
  scenes: { nodes: number[] }[];
  nodes: GltfNodeJson[];
  meshes?: GltfMeshJson[];
  materials?: GltfMaterialJson[];
  accessors?: GltfAccessorJson[];
  bufferViews?: GltfBufferViewJson[];
  buffers?: { uri: string; byteLength: number }[];
  extensionsUsed?: string[];
  extensions?: { KHR_lights_punctual?: { lights: GltfLightJson[] } };
}

export interface GltfNodeJson {
  name: string;
  translation: number[];
  rotation: number[];
  scale: number[];
  children?: number[];
  mesh?: number;
  extensions?: {
    KHR_lights_punctual?: { light: number };
    SWM_lights_ambient?: { color: number[]; intensity: number };
    SWM_prefab_instance?: { source: string };
    SWM_decal?: SwmDecalPayload;
    SWM_stage_zone?: { displayName?: string; points: { u: number; v: number; scale: number }[] };
  };
}

export interface GltfMeshJson {
  primitives: { attributes: Record<string, number>; indices?: number; material?: number }[];
}

export interface GltfMaterialJson {
  pbrMetallicRoughness?: {
    baseColorFactor?: number[];
    metallicFactor?: number;
    roughnessFactor?: number;
  };
  emissiveFactor?: number[];
  alphaMode?: "OPAQUE" | "BLEND";
}

export interface GltfAccessorJson {
  bufferView: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
}

export interface GltfBufferViewJson {
  buffer: number;
  byteOffset: number;
  byteLength: number;
}

export interface GltfLightJson {
  type: "point" | "directional" | "spot";
  color?: number[];
  intensity?: number;
  range?: number;
  /** Spot only (KHR_lights_punctual): cone angles in radians. */
  spot?: { innerConeAngle: number; outerConeAngle: number };
  /** Engine-specific light fields that KHR_lights_punctual has no slot for (direction, shadows, decay). */
  extras?: Record<string, unknown>;
}
