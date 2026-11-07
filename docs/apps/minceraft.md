# Minceraft — Voxel Sandbox

> **Genre:** Chunk-gestreamte Voxel-Sandbox  
> **Rendering:** Hybrid WebGL2 / WebGPU mit Texture-Arrays, gebackenem Tageslicht und Ambient Occlusion  
> **Repository:** [github.com/rottensteiner-stefan/minceraft](https://github.com/rottensteiner-stefan/minceraft){target="_blank"}  
> **Lizenz:** MIT (Open Source)

---

## 🧱 Überblick

**Minceraft** ist eine unendliche, prozedural generierte Voxel-Welt, die vollständig als eigenständiges Projekt auf der Small World Machine aufsetzt.

Das Projekt löst die klassischen Herausforderungen von Voxel-Engines im Webbrowser:
1. **Speichereffizienz:** Kompakte Byte-Darstellung im Arbeitsspeicher.
2. **Hintergrund-Meshing:** Auslagerung des rechenintensiven Mesh-Baus in Web Worker.
3. **Nahtlose Chunks:** Fehlerfreie Geometrie und Normalen an Chunk-Grenzen.
4. **Physik & Sweep:** Präzise Kollisionserkennung ohne externe Physik-Bibliotheken.
5. **Persistenz:** Lokale Speicherung von Weltveränderungen im Browser.

```text
    [ Minceraft Application ]
          │          │
          │          ▼ (Task-Queue)
          │   [ Web Worker Pool ]
          │          │ (VoxelMeshData)
          ▼          ▼
     [@small-world-machine/engine]
```

---

## ⚡ Kernfeatures & Architektur

* **Multi-Worker Meshing Pool:** Ein Pool dedizierter Vite-Modul-Worker (`MeshWorkerPoolClient`) verarbeitet Greedy- und Naive-Meshing parallel im Hintergrund, sodass die Framerate des Haupt-Threads unberührt bleibt.
* **Gebackenes Vertex-Licht & Ambient Occlusion:** Schnelle Auswertung von Sonnen-/Tageslichtausbreitung und weichen Eckschatten (`MesherAo.ts`, `MesherLight.ts`) direkt auf den Vertices ohne teure dynamische Schattenkarten.
* **Custom PBR Block-Shader:** Texture-Array-Sampling (`sampler2DArray` in GLSL 300 / WGSL) mit dynamischem Tag-Nacht-Zyklus (`DayNightCycle.ts`).
* **AABB Sweep Kollisionsphysik:** Kontinuierliche Box-Voxel-Sweep-Kollision (`VoxelSweep.ts`, `VoxelPlayerCollision.ts`) für flüssige Spielerbewegung mit Gravitation und Bodenhaftung.
* **OPFS & IndexedDB Deltaspeicherung:** Robuste Speicherung geänderter Blöcke über das Origin Private File System (`OpfsChunkDeltaStore`) mit automatischem Fallback auf IndexedDB.

---

## 📦 Standalone-Konsum

Minceraft bindet die Engine als URL-Abhängigkeit ein:

```json
{
  "dependencies": {
    "@small-world-machine/engine": "https://github.com/rottensteiner-stefan/small-world-machine/releases/download/packages-0.122.0/small-world-machine-engine-0.122.0.tgz"
  }
}
```

Der Quellcode und alle Tests sind im Repository [rottensteiner-stefan/minceraft](https://github.com/rottensteiner-stefan/minceraft){target="_blank"} verfügbar.
