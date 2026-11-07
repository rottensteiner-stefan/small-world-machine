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

### Registration policy

- **Opt-in, per app entry point.** The engine never imports this package (lint boundary, ADR 0014/0015/0025), so an app registers it itself, once, before the first glTF load.
- **No app registers it today (2026-10-31), on purpose.** No repo asset uses Draco or KTX2 (69 `.glb`/`.gltf`, no `.ktx2` outside the test fixture), and the Maker only reads its own uncompressed `WorldWriter` output (`scene.gltf`, prefabs). Registering anyway would put the Basis glue in every bundle for nothing.
- **Register when an app starts shipping compressed assets** (e.g. after `gltf-transform ... draco`, see the toolchain guide): add `import "@small-world-machine/gltf-extensions/register";` to that app's entry point. No other change is needed.
- **If it is forgotten**, `GltfLoader` fails fast on a required extension with `Unsupported required extension(s): KHR_draco_mesh_compression ...` and names the import above. A `KHR_texture_basisu` that is only listed in `extensionsUsed` (a PNG/JPEG fallback `source` exists) silently loads the fallback image.
- **The registry is page-global** (ADR 0017): registering affects every engine instance on the page. That is harmless, because the plugins are inert for files that do not use their extension.

## Extensions

| Extension | Behavior |
|---|---|
| `KHR_draco_mesh_compression` | Decodes Draco-compressed triangle meshes (positions, normals, tangents, UV set 0, joints/weights set 0, indices) with the vendored official Draco glTF WebAssembly decoder (`DracoWasmDecoder`, main thread, quantized attributes dequantized by the decoder). Own decoder bytes via `DracoDecoder.setConfig({ wasmBinary })`, or replace decoding entirely via `DracoDecoder.setDecodeHandler`. `COLOR_n` and higher UV/joint sets are not read (the engine's glTF loader has no channel for them); point clouds are rejected. |
| `KHR_texture_basisu` | Transcodes KTX2 textures (Basis Universal, ETC1S or UASTC) with a WebAssembly transcoder (`BasisWasmTranscoder`). Default output is RGBA8. A hardware-compressed target format can be chosen: BC1, BC3, BC7, ASTC, ETC2. BC1 works only for UASTC sources. |

## Related

[ADR 0017](/adr/0017-gltf-extension-plugin-registry), [ADR 0018](/adr/0018-gltf-data-level-extensions-and-ecosystem-package)
