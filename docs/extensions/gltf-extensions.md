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

## Enthaltene Erweiterungen

### 1. `KHR_draco_mesh_compression`
* Dekodiert hochgradig komprimierte Punktwolken und Geometrie-Puffer (Positionen, Normalen, UVs, Indizes) mittels WebAssembly Draco-Dekoder.
* Reduziert die Dateigröße komplexer 3D-Meshes um bis zu 80–90%.

### 2. `KHR_texture_basisu`
* Dekodiert und transkodiert universelle Basis Universal (KTX2 / `.basis`) GPU-Texturformate zur Laufzeit.
* Unterstützt Hardware-beschleunigte Textur-Dekompression direkt im VRAM:
  * **BC7 / BC3 (DXT5):** Desktop WebGL / WebGPU
  * **ASTC:** Mobile (iOS / Android)
  * **ETC2:** WebGL2 Standard
* Spart erhebliche Mengen an VRAM und eliminiert Textur-Lade-Ruckler.
