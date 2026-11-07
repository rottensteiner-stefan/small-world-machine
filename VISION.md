# The Small World Machine Vision

**Small World Machine** is built on a clear conviction: **Atmosphere, art direction, and game feel beat brute-force hardware specs every single time.**

We are the "Preact of 3D Engines" — lean, agile, and architecturally pure. But Small World Machine is neither a toy nor a compromise for tiny tech demos. It is built to power **real, ambitious, deeply atmospheric games and immersive interactive worlds** — in the spirit of indie masterpieces like *Stray*, *Inside*, or *Journey* — without requiring a $2,000 graphics card or a 50GB download.

---

## 🎨 The Philosophy: Art Direction Over "Spec Chasing"

In modern 3D development, the industry has fallen into an unsustainable trap: chasing 8K photorealism, unoptimized gigabyte textures, and raytracing pipelines that melt expensive GPUs while burning through player batteries and hardware budgets.

We reject that bloat. **Great 3D experiences are made of:**
- **Coherent Art Direction & Lighting Mood:** Warm bounce lights, evocative volumetric fog, cinematic post-processing, and striking silhouettes.
- **Immediate Tactile Game Feel:** Zero-latency input, smooth physics, punchy spatial audio, and robust component-driven behavior state machines.
- **Universal Accessibility:** Running at a locked 60 FPS on everyday laptops, MacBooks, smartphones, and standard web browsers without sounding like a jet engine taking off.
- **Frictionless Creation:** Composing living worlds visually in minutes via **Maker** without installing gigabytes of proprietary desktop software or wrestling with build pipelines.

---

## 🏛️ Architectural North Stars: The Spirit of Godot & PlayCanvas

Small World Machine deliberately avoids the trap of shoehorning multi-gigabyte desktop behemoths into the browser via bloated WebAssembly wrappers. Instead, our design is benchmarked against two of the most pragmatic, developer-focused engines in the industry:

- **Godot's Ergonomics & Composition:** Intuitive scene tree composition, modular behaviors over rigid class hierarchies, human-sized APIs, and a relentless focus on developer velocity and joy.
- **PlayCanvas's Web-Native Mastery:** Built strictly for the browser runtime from day one, offering instant load times, zero-allocation hot paths, and exploiting native WebGL 2 and WebGPU pipelines to the metal.

By synthesizing Godot's composable simplicity with PlayCanvas's high-efficiency web runtime, Small World Machine occupies the ideal sweet spot: a browser-native game engine with heavyweight capabilities and a featherweight footprint.

---

## The Pain Points We Solve

### 1. The Monolithic Engine Tax vs. High-Performance Indie Gaming
**The Problem:** Enterprise 3D engines are massive behemoths. Even a blank scene pulls megabytes of un-treeshakable runtime overhead, while desktop engines demand multi-gigabyte installs and steep licensing models.
**Our Solution:** Small World Machine delivers a complete game engine architecture (Hybrid WebGPU/WebGL 2 PBR renderer, physics, spatial audio, behavior systems, FSMs) in a razor-thin footprint with zero external dependencies in the rendering core. It scales effortlessly from instant playable experiences up to full-featured, narrative 3D titles.

### 2. Real Game Engine Architecture (Not Just a "Renderer")
**The Problem:** Most lightweight web 3D tools are mere rendering libraries. They leave game loops, actor state, physics, spatial sound, and input handling as an exercise for the developer, forcing teams to duct-tape mismatched libraries together or drag heavy DOM reconciliation frameworks into a 60FPS loop.
**Our Solution:** An integrated **Behavior System** (`addBehavior(new HoverBehavior())`), type-safe **Finite State Machines** (`StateMachine`), built-in **Impulse Physics** (SAT collisions, buoyancy, sub-stepping), 3D **Spatial Audio** (HRTF, synthesizers), and an $O(\log n)$ **Octree Interaction Manager**. Everything you need to build rich gameplay exists out of the box with zero runtime friction.

### 3. Developer Experience (DX) & Strict TypeScript
**The Problem:** Legacy 3D codebases carry a decade of dynamic JavaScript debt, loosely patched types, and silent runtime `any` failures.
**Our Solution:** 100% strict TypeScript. No `any`. Explicit access encapsulation (`_privateField`) and clean getters/setters. Autocomplete that never lies, fail-fast lifecycle assertions, and an API designed for developers who take craftsmanship seriously.

### 4. Hybrid WebGPU & WebGL Without Lock-In
**The Problem:** The transition to WebGPU has fractured many ecosystems into incompatible node graphs and experimental shader dialects.
**Our Solution:** Designed hybrid from day one. Modern WebGPU compute shaders (e.g. Clustered Forward+ Light Culling) deliver maximum efficiency when available, with a rock-solid, zero-cost fallback cascade across WebGL 2 and WebGL 1. Shaders use static parameter specialization without proprietary visual scripting lock-in, paired with native WASM-powered GPU texture transcoding (Basis Universal / KTX2).

### 5. Open Standards & The Declarative Level & Kit Pipeline
**The Problem:** Proprietary asset silos, unvalidated level formats, and closed marketplace ecosystems lock creators in, while monolithic asset repos cause agonizing clone times.
**Our Solution:** Universal open standards (`.glb`, glTF 2.0 PBR, `level.schema.json`, `kit.json`). Creators can author schema-validated declarative level descriptors (`*.level.json`) with modular `KitRegistry` procedural fallbacks and socket light mounting (ADR 0020), as well as import, snap, and assemble models from the global CC0/CC-BY ecosystem (Kenney, Poly Haven, Sketchfab, Blender) or AI generation tools (Tripo3D, Meshy) in seconds.

### 6. Visual Scene Authoring via Maker
**The Problem:** Authoring 3D scenes purely in code is tedious, while traditional desktop editors isolate developers behind heavy installers and separate build steps.
**Our Solution:** **Maker** (`public/tools/maker.html`) — a dedicated, zero-install, in-browser 3D world editor. Powered by the native File System Access API, Maker offers camera-cardinal keyboard transformation, dynamic grid stepping, marquee selection, isolated 3D prefab rendering, and continuous glTF 2.0 autosave with non-destructive `SWM_*` extensions. You design visually, save directly to your repository, and run immediately in engine.

---

## ⚡ The Grundgesetz: Our Architectural Tenets

1. **Atmosphäre vor Pixelzählen (Atmosphere > Spec Chasing):** Reiches Licht, durchdachte Farbpaletten, stilisierte Post-Processing-Effekte und markante Silhouetten schaffen zeitlose Spiele. Wir brauchen keine 8K-Brute-Force, um echte Emotionen zu wecken.
2. **Schlanke Modularität:** Keine aufgeblasenen Allround-Monsterklassen. Alles ist ein präziser, komponierbarer Baustein (`Behavior`, `SceneNode`).
3. **Schnelle Iteration:** Null Sekunden Build-Overhead, sofortiges visuelles und auditives Feedback direkt im Browser. Was du schreibst, läuft sofort bei 60 FPS.
4. **Ehrliche Abstraktionen:** Wenn ein Feature gebraucht wird, existiert eine intuitive High-Level-API (wie unser `camera.flyTo(...)`), darunter ein glasklares, verlässliches Fundament ohne undurchsichtige Magie.
5. **Browser-Nativität:** Von Grund auf für WebGL 2 und WebGPU in modernem, striktem TypeScript gebaut – keine C++-Desktop-Altlasten, die krampfhaft per WASM in den Browser gepresst wurden.
6. **Zero-GC & Hot-Path-Disziplin:** Allokationsfreie Frame-Loops (`update(deltaTime)`), Strukturierung über TypedArrays und speicherschonendes Pooling für kompromisslos flüssige Frameraten.
7. **Leichtgewichtiger Footprint:** Schnelle Ladezeiten und schlanke Bundles statt hunderter Megabyte Engine-Ballast.
8. **Offene Standards & Tooling:** Volle Unterstützung von glTF 2.0 PBR, schema-validierten Leveln und integrierten Standalone-Werkzeugen (**Maker**, **The Forge**, Shader-/Textur-Generatoren), die direkt im Browser arbeiten.
9. **Pragmatismus vor Dogmatismus:** Es gibt keinen illusorischen 100%-Purismus-Anspruch. Wir folgen diesen Prinzipien so weit wie architektonisch sinnvoll und technisch zielführend — das exzellente, spielbare Ergebnis und die Entwicklerfreude haben stets Vorrang vor akademischer Perfektion.

Small World Machine ist die Engine für Entwickler und Digital Artists, die faszinierende, atmosphärische und wahrhaft denkwürdige 3D-Welten für das offene Web erschaffen wollen.


