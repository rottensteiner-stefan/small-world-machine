# ADR 0022: GPU-Instanzierte VFX-Partikel-Pipeline & `@small-world-machine/vfx-extras`

## Kontext & Problem

Showcase 22 (Akkretionsscheibe um ein supermassives Schwarzes Loch) führte komplexe relativistische Physik und hochdichte Partikelsimulationen ein:
1. **Performance-Flaschenhals bei CPU-Objekten:** 400 separate `Object3D`- oder `RigidBody`-Instanzen mit individuellen Szenengraph-Transformationen und SAT-Kollisionsprüfungen erzeugten 400 Draw Calls und skalierten mit $\mathcal{O}(N^2)$, was Mobilgeräte und schwächere Systeme überlastete.
2. **Astrophysikalische Affektoren & Kraftfelder:** Plummer-Gravitationspotentiale, tangentiale Wirbelbeschleunigung, harmonische Scheiben-Stabilisierung, thermodynamische Plancksche Strahlungskühlung und Fading-Zonen für gravitative Rotverschiebung sind hochgradig nützlich für VFX, gehören aber nicht in den ultra-schlanken Kernkatalog von `@small-world-machine/engine`.
3. **Universelle Shader-Parität:** Post-Processing-Linsenverzerrung (Einstein-Ring, relativistisches Doppler-Beaming, Spaghettisierung) musste dynamisch über Uniforms entkoppelt werden, damit WebGL2 und WebGPU ohne Pipeline-Recompilations identisch rendern.

## Entscheidung

1. **Erstellung des Ökosystem-Pakets `@small-world-machine/vfx-extras` (`packages/vfx-extras/`):**
   - Das Paket hängt ausschließlich von `@small-world-machine/engine` ab und implementiert modulare, allocations-freie Partikel- und Kraftfeldsysteme.
   - Enthält `ParticleSystem`, `ParticleMeshRenderer`, `AccretionDiskEmitter` sowie 10 universelle Affektoren (`PointAttractorAffector`, `VortexAffector`, `PlanarSpringAffector`, `ThermalCoolingAffector`, `FadeOutZoneAffector`, `TurbulenceAffector`, `DragAffector`, `ColorOverLifeAffector`, `SizeOverLifeAffector`, `BouncePlaneAffector`).

2. **GPU-Instanzierungs-Bridge (`ParticleMeshRenderer`):**
   - Synchronisiert kontinuierlich Position, Skalierung und RGBA-Farben der Partikel in die Matrix- und Attribut-Puffer eines `InstancedMesh`.
   - Tausende Partikel werden in **einem einzigen Draw Call** gerendert.
   - Unsichtbare oder tote Partikel kollabieren auf Skalierung 0, wodurch keine CPU-Reallocations im Render-Loop entstehen.

3. **Kern-Erweiterungen mit universellem Mehrwert:**
   - [`Color.blackbody()`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/packages/engine/src/core/colors/Color.ts) und [`Color.fromTemperature()`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/packages/engine/src/core/colors/Color.ts) wandern in den Kern als allgemeine Farb- und Strahlungs-Utilities.
   - [`GravitationalLensingElement`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/packages/engine/src/renderers/post/elements/GravitationalLensingElement.ts) entkoppelt dynamische Linsenparameter (`eh`, `strength`, `spaghettification`, `beaming`, `ringGlow`) synchron in GLSL und WGSL (160-Byte-Puffer).
   - [`FollowCameraBehavior`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/packages/engine/src/core/behaviors/FollowCameraBehavior.ts) bietet weiche Zielverfolgung über das Behavior-System.

4. **Wissenschaftliche & Mathematische Verankerung:**
   - Plummer-Potential ($1911$) zur Vermeidung von Polstellen bei $r \to 0$.
   - Plancksche Strahlung & Farbtemperatur nach Tanner Helland ($2012$).
   - Vollständige Erfassung in [`REFERENCES.md`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/REFERENCES.md).

## Konsequenzen

- **Dramatischer Leistungssprung:** Simulationen mit tausenden Partikeln laufen stabil bei 60 FPS in einem einzigen Draw Call.
- **Volle Renderer-Parität:** WebGL2 und WebGPU verhalten sich bei Post-Processing-Effekten und Instanz-Puffern mathematisch und visuell 1:1 identisch.
- **Modulare Wiederverwendbarkeit:** Entwickler können Partikelsysteme und Affektoren modular zusammenstecken (Feuer, Rauch, Magieeffekte, Raumfahrtsimulationen), ohne den Kern aufzublähen.
