# ADR 0018: glTF Data-Level-Extensions & `@small-world-machine/gltf-extensions`-Ökosystem-Paket

## Kontext & Problem

Mit ADR 0017 wurde die `GltfExtensionPlugin`-Registry eingeführt. Diese deckte primär **Szenengraph-/Node-Ebene-Extensions** ab (`readNode`, `applyNode`, `writeNode`, `finalizeWrite`), wie `KHR_lights_punctual`, `SWM_prefab_instance` und `SWM_stage_zone`.

Moderne 3D-Web-Workflows und Indie-Games verlangen jedoch nach datenkomprimierten Formaten:
1. **`KHR_draco_mesh_compression`** (Google Draco Geometrie-Dekompression)
2. **`KHR_texture_basisu`** (Basis Universal / KTX2 GPU-Textur-Transcoding)

Diese Extensions operieren nicht auf Node-Ebene, sondern direkt auf den **Primitiven/Buffern** (`primitive.extensions.KHR_draco_mesh_compression`) und **Textur-Definitionen** (`textureDef.extensions.KHR_texture_basisu`).

Ein direkter Einbau der dazugehörigen WebAssembly-Decoder (`draco_decoder.wasm` ~500 KB, `basis_transcoder.wasm` ~300 KB) in den Kern `@small-world-machine/engine` würde Small World Machines Kern-Philosophie (*"Preact der 3D-Engines"* — ultraleichtgewichtig, Null externe Abhängigkeiten) verletzen.

## Entscheidung

1. **Erweiterung des `GltfExtensionPlugin`-Interfaces um Data-Level-Hooks:**
   - `decodeGeometry?(primitive, ctx, buffers): Promise<GeometryDataInterface | null>`
   - `resolveTexture?(textureDef, ctx, folderPath, buffers, assetManager): Promise<Texture | null>`
2. **Integration in `GltfGeometryParser` und `GltfMaterialParser`:**
   - `GltfGeometryParser.parseGeometry` prüft registrierte Plugins auf `decodeGeometry` und delegiert asynchron, bevor der unkomprimierte Buffer-Accessor-Pfad greift.
   - `GltfMaterialParser.resolveTexture` prüft registrierte Plugins auf `resolveTexture`, bevor der Standard-Image-Pfad greift.
   - `GltfLoader` initialisiert den `GltfReadContext` vor dem Parsen von Materialien und Geometrien und führt `prepareRead` vorab aus.
3. **Auslagerung in das Workspace-Paket `@small-world-machine/gltf-extensions` (`packages/gltf-extensions/`):**
   - Implementiert `khrDracoMeshCompression` mit konfigurierbarem `DracoDecoder`.
   - Implementiert `khrTextureBasisu` mit konfigurierbarem `BasisTranscoder`.
   - Bietet sowohl explizite (`registerGltfExtension(...)`) als auch seiteneffektbasierte Auto-Registrierung (`import "@small-world-machine/gltf-extensions/register"`).
   - Dient als offizielle Referenz-Implementierung und Dokumentations-Leitfaden für Dritt-Entwickler.

## Konsequenzen

- **Kern bleibt schlank:** `@small-world-machine/engine` bleibt frei von großen WASM-Binaries.
- **Vollständige Extensibility:** Third-Party-Entwickler können beliebige Geometrie-Decoder (z. B. Meshopt) oder Textur-Transcoder (z. B. WebP, Basis, DDS) als eigenständige npm-Pakete bereitstellen.
- **Rückwärtskompatibilität:** Alle bestehenden 759 Engine-Tests bleiben unverändert grün.
