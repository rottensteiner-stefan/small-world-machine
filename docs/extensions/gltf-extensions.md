# glTF Extensions (`@small-world-machine/gltf-extensions`)

`@small-world-machine/gltf-extensions` is an optional ecosystem package that provides the data-level glTF 2.0 extensions `KHR_draco_mesh_compression` and `KHR_texture_basisu`. It depends on `@small-world-machine/engine`.

## Registration

A side-effect import registers both extensions in the `GltfLoader` plugin registry:

```typescript
import "@small-world-machine/gltf-extensions/register";
import { GltfLoader } from "@small-world-machine/engine";

const scene = await new GltfLoader().load("model-compressed.glb");
```

Sub-path imports: `@small-world-machine/gltf-extensions/draco` and `/basisu`. `register` also exports `khrDracoMeshCompression` and `khrTextureBasisu`.

## Extensions

| Extension | Behavior |
|---|---|
| `KHR_draco_mesh_compression` | Decodes Draco-compressed geometry (positions, normals, UVs, indices) with a WebAssembly decoder. The decoder path is configurable via `DracoDecoder` (`decoderPath`). |
| `KHR_texture_basisu` | Transcodes KTX2 textures (Basis Universal, ETC1S or UASTC) with a WebAssembly transcoder (`BasisWasmTranscoder`). Default output is RGBA8. A hardware-compressed target format can be chosen: BC1, BC3, BC7, ASTC, ETC2. BC1 works only for UASTC sources. |

## Related

[ADR 0017](/adr/0017-gltf-extension-plugin-registry), [ADR 0018](/adr/0018-gltf-data-level-extensions-and-ecosystem-package)
