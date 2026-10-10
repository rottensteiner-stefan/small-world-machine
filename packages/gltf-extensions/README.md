# @small-world-machine/gltf-extensions

> Official community & advanced data-level glTF extensions for the **Small World Machine 3D Engine**. Also serves as the **canonical reference implementation & tutorial** for third-party developers extending glTF loading and serialization in Small World Machine.

---

## 📦 Overview

Small World Machine features a decoupled, modular **glTF Extension Plugin Architecture** ([ADR 0017](https://github.com/rottensteiner-stefan/small-world-machine/blob/main/docs/adr/0017-gltf-extension-plugin-registry.md)). This package provides plugins for industry-standard compression and transcode formats:

1. **`KHR_draco_mesh_compression`**: Google Draco 3D geometry decompression.
2. **`KHR_texture_basisu`**: Basis Universal & KTX2 supercompressed textures.

By isolating heavy WebAssembly decoders from the core engine (`@small-world-machine/engine`), the engine maintains its ultra-lightweight, zero-dependency philosophy while allowing projects to opt into heavy compression pipelines on demand.

---

## 🚀 Installation & Usage

### 1. Zero-Boilerplate Auto-Registration

Import the side-effect register module at your application entry point:

```typescript
import "@small-world-machine/gltf-extensions/register";
import { GltfLoader } from "@small-world-machine/engine";

// GltfLoader now automatically decodes Draco meshes and Basis textures!
const loader = new GltfLoader();
const scene = await loader.load("assets/models/compressed-model.glb");
```

### 2. Explicit / Selective Registration

If you only need a specific extension or want full control over registration order:

```typescript
import { registerGltfExtension, GltfLoader } from "@small-world-machine/engine";
import { khrDracoMeshCompression, DracoDecoder } from "@small-world-machine/gltf-extensions/draco";
import { khrTextureBasisu, BasisTranscoder } from "@small-world-machine/gltf-extensions/basisu";

// Optional: configure WebAssembly worker paths
DracoDecoder.setConfig({ decoderPath: "/draco/" });
BasisTranscoder.setConfig({ transcoderPath: "/basis/" });

// Register plugins
registerGltfExtension(khrDracoMeshCompression);
registerGltfExtension(khrTextureBasisu);
```

---

## 🛠️ Developer Guide: Writing Your Own glTF Extension

Small World Machine's [`GltfExtensionPlugin`](https://github.com/rottensteiner-stefan/small-world-machine/blob/main/packages/engine/src/loaders/gltf/GltfExtensionPlugin.ts) interface lets you intercept reading and writing at every stage of the pipeline without modifying engine internals.

### The `GltfExtensionPlugin` Interface

```typescript
import {
  GltfExtensionPlugin,
  GltfReadContext,
  GltfWriteState,
  GltfWriteContext,
  GltfNodeDef,
  GltfPrimitiveDef,
  GltfTextureDef,
  Object3D,
  GeometryDataInterface,
  Texture,
  AssetManager,
} from "@small-world-machine/engine";

export interface GltfExtensionPlugin {
  /** The unique glTF extension identifier, e.g. "MY_vendor_extension" */
  readonly name: string;

  /** Optional document-level pre-pass (e.g. building index maps) */
  prepareRead?(ctx: GltfReadContext): void;

  /** Instantiate a custom Object3D subclass (e.g. Light, SoundNode, Marker) */
  readNode?(nodeIndex: number, nodeDef: GltfNodeDef, name: string, ctx: GltfReadContext): Object3D | undefined;

  /** Mutate properties on an already-instantiated Object3D */
  applyNode?(obj: Object3D, nodeDef: GltfNodeDef, ctx: GltfReadContext): void;

  /** Serialize custom properties during scene graph export (WorldWriter) */
  writeNode?(obj: Object3D, node: GltfNodeJson, ctx: GltfWriteState): void;

  /** Flush accumulated document-level data into glTF root extensions */
  finalizeWrite?(ctx: GltfWriteContext): void;

  /** Data Hook: Decode mesh primitives (e.g. Draco, Meshopt) */
  decodeGeometry?(
    primitive: GltfPrimitiveDef,
    ctx: GltfReadContext,
    buffers: ArrayBuffer[],
  ): Promise<GeometryDataInterface | null | undefined> | GeometryDataInterface | null | undefined;

  /** Data Hook: Resolve textures (e.g. Basis Universal, WebP, DDS) */
  resolveTexture?(
    textureDef: GltfTextureDef,
    ctx: GltfReadContext,
    folderPath: string,
    buffers: ArrayBuffer[],
    assetManager: AssetManager,
  ): Promise<Texture | null | undefined> | Texture | null | undefined;
}
```

---

### Example A: Creating a Node-Level Extension (`KHR_audio_emitter`)

To attach spatial audio sources directly in glTF scenes:

```typescript
import { GltfExtensionPlugin, Object3D, registerGltfExtension } from "@small-world-machine/engine";

export const khrAudioEmitter: GltfExtensionPlugin = {
  name: "KHR_audio_emitter",

  readNode(nodeIndex, nodeDef, name, ctx) {
    const audioExt = nodeDef.extensions?.KHR_audio_emitter as { clip: string; volume?: number } | undefined;
    if (!audioExt) return undefined; // Defer to standard Object3D creation

    const soundNode = new Object3D(name);
    // Attach audio metadata or playback behavior
    (soundNode as any).audioClip = audioExt.clip;
    (soundNode as any).volume = audioExt.volume ?? 1.0;
    return soundNode;
  },

  writeNode(obj, node) {
    if ((obj as any).audioClip) {
      node.extensions = {
        ...node.extensions,
        KHR_audio_emitter: {
          clip: (obj as any).audioClip,
          volume: (obj as any).volume ?? 1.0,
        },
      };
    }
  },
};

// Register for automatic loading & writing
registerGltfExtension(khrAudioEmitter);
```

---

### Example B: Creating a Data-Level Extension (`EXT_meshopt_compression`)

To decompress custom binary payloads during mesh parsing:

```typescript
import { GltfExtensionPlugin, ModelGeometry, registerGltfExtension } from "@small-world-machine/engine";

export const extMeshoptCompression: GltfExtensionPlugin = {
  name: "EXT_meshopt_compression",

  async decodeGeometry(primitive, ctx, buffers) {
    const meshoptDef = primitive.extensions?.EXT_meshopt_compression as { bufferView: number } | undefined;
    if (!meshoptDef || !ctx.json.bufferViews) return null;

    const bv = ctx.json.bufferViews[meshoptDef.bufferView];
    if (!bv) return null;

    const rawBuffer = buffers[bv.buffer]!.slice(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);

    // Call your custom WASM decompressor
    const decodedPositions = await myMeshoptDecoder(rawBuffer);

    return new ModelGeometry(decodedPositions).getGeometryData();
  },
};

registerGltfExtension(extMeshoptCompression);
```

---

## 🧪 Testing Your Extension

Use Vitest with `GltfLoader` to verify end-to-end decoding:

```typescript
import { describe, it, expect } from "vitest";
import { GltfLoader, registerGltfExtension } from "@small-world-machine/engine";
import { myCustomExtension } from "./MyCustomExtension.js";

describe("MyCustomExtension", () => {
  it("parses custom glTF data correctly", async () => {
    registerGltfExtension(myCustomExtension);

    const loader = new GltfLoader();
    const scene = await loader.load("test-scene.gltf");
    expect(scene.getObjectByName("CustomNode")).toBeDefined();
  });
});
```

---

## 📄 License

MIT © Stefan Rottensteiner // Small World Machine
