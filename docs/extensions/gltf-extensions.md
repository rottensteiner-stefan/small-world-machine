# glTF-Erweiterungen (`@small-world-machine/gltf-extensions`)

Das Paket `@small-world-machine/gltf-extensions` implementiert die datenkomprimierenden Erweiterungen des offiziellen Khronos glTF 2.0 Standards (`KHR_draco_mesh_compression` und `KHR_texture_basisu`).

## Installation & Registrierung

```bash
npm install @small-world-machine/gltf-extensions
```

Um alle glTF-Erweiterungen automatisch in der `GltfLoader`-Plugin-Registry zu registrieren, genügt ein einziger Side-Effect-Import vor dem Laden von Modellen:

```typescript
import "@small-world-machine/gltf-extensions/register";
import { GltfLoader } from "@small-world-machine/engine";

const loader = new GltfLoader();
const scene = await loader.load("model-compressed.glb");
```

---

Alternativ lassen sich die Erweiterungen einzeln über die Sub-Pfade `@small-world-machine/gltf-extensions/draco` und `/basisu` einbinden; `register` exportiert zusätzlich `khrDracoMeshCompression` und `khrTextureBasisu`.

---

## Enthaltene Erweiterungen

### 1. `KHR_draco_mesh_compression`
* Dekodiert hochgradig komprimierte Punktwolken und Geometrie-Puffer (Positionen, Normalen, UVs, Indizes) mittels WebAssembly Draco-Dekoder.
* Reduziert die Dateigröße komplexer 3D-Meshes erheblich; der Dekoder-Pfad lässt sich über `DracoDecoder` konfigurieren (`decoderPath`).

### 2. `KHR_texture_basisu`
* Transkodiert KTX2-Texturen (Basis Universal, ETC1S oder UASTC) zur Laufzeit per WebAssembly (`BasisWasmTranscoder`).
* Standard-Ausgabe ist RGBA8 (universeller Fallback). Alternativ lässt sich ein hardware-komprimiertes Zielformat wählen (BC1, BC3, BC7, ASTC, ETC2 – je nach GPU-Unterstützung); BC1 gibt es nur für UASTC-Quellen.
* Komprimierte Formate sparen VRAM und reduzieren Textur-Ladezeiten.
