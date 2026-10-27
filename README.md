# Small World Machine

<img align="right" width="280" alt="Small World Machine" src="public/assets/logo_vector.svg" />

**Small World Machine** is the "Preact of 3D Engines". It is an ultra-lightweight, high-performance, and strict TypeScript 3D game engine for the web. Built for the era of WebGPU and Playable Ads, it provides a modern Physically Based Rendering (PBR) pipeline and a robust Behavior System—delivering the architectural elegance of a real game engine at a fraction of the bundle size of traditional frameworks.

Read our full [Vision & Strategy](VISION.md).

<br clear="right"/>

## 🚀 Features

- **Hybrid PBR Rendering:** High-performance rendering pipeline supporting **WebGPU**, **WebGL 2**, and **WebGL 1** with industry-standard physically based shading (Cook-Torrance BRDF).
- **Linear Lighting Workflow:** All lighting calculations are performed in linear space with automatic sRGB gamma correction for realistic color falloffs and high visual fidelity.
- **Advanced Materials:** Includes standard PBR (Metallic/Roughness), but also physical **Glass/Dielectric** materials with real-time **Screen-Space Refraction**, Index of Refraction (IOR), and Beer's Law for volumetric light absorption.
- **Advanced Camera System:** Unified camera setup where controllers (e.g., `OrbitController`, `FirstPersonController`, `ZoomController`) are standard `Behavior` components attached via `camera.addBehavior()`. Features procedural effects like camera shake and flash.
- **High-Performance Architecture:** Optimized for memory efficiency through **Object Pooling** (`MathPool`), BindGroup & Pipeline Caching (WebGPU), and zero-allocation hot paths to eliminate Garbage Collection pressure.
- **Lighting & Shadows:** Supports Ambient, Directional, Point, Spot, and Area lights. Features robust **Shadow Mapping** (WebGL 2 & WebGPU) with Cascaded Shadow Maps, Hardware Shadow Sampling, and Percentage-Closer (Soft) Filtering (PCSS) for buttery-smooth soft shadows.
- **Clustered Forward+ Lighting:** The camera frustum is divided into a 3D grid of light-culling cells (WebGPU: compute-shader culled; WebGL 2: CPU-culled) so each pixel only evaluates the lights that actually reach it, raising the practical point/spot light budget well past a small fixed cap.
- **Planar & Conformal Reflections:** Real-time planar floor reflections (virtual mirror geometries) and dynamic sphere inversion reflections ($P' = C + V \cdot \frac{R^2}{d^2 - r^2}$) for PBR objects.
- **Component Behaviors & State Machines:** Robust, callback-driven behavior system to attach complex logic (`FlickerBehavior`, `DeviceOrientationController`, `HoverBehavior`, `DraggableBehavior`, etc.) directly to 3D objects, cameras, or materials. Includes a built-in, type-safe, zero-allocation **Finite State Machine (FSM)** framework to cleanly manage game actor lifecycles.
- **Interactions & Gamification:** A built-in `InteractionManager` allowing objects to instantly react to mouse/touch pointer events (`onPointerEnter`, `onPointerClick`, `onPointerDown`, `onPointerMove`, etc.). Pickable elements are queried via highly performant $O(\log n)$ **Octrees** and resolved to exact pixels via the **Möller-Trumbore** intersection algorithm. 
- **Stylized & Cinematic Post-Processing:** ACES Filmic, Reinhard, and Cineon Tone Mapping with parametric Color Grading (lift/gamma/gain, color temperature), plus Bloom, Screen-Space Ambient Occlusion (HBAO), Temporal Anti-Aliasing (TAA with camera jitter + history blend), Motion Trails, and retro/stylized shaders (Phosphor Night Vision, Film Noir, Cyber Glitch, VHS Tracking, Thermal Vision).
- **Scene Graph:** Hierarchical scene management using a clean `Object3D` architecture.
- **2D/2.5D Support:** First-class support for Sprites, Billboard rendering, and Pixel-Perfect Isometric perspectives.
- **Audio System:** Built-in `AudioSystem` with 3D Spatial Audio (HRTF), a procedural Retro Synthesizer (footsteps, lasers, drones, fire), and a built-in Mixer with procedural Reverb.
- **Decoupled Architecture:** Features a high-performance, strictly-typed global `EventBus` injected into all systems (`this.events`), separating Gameloop, Behaviors, and UI without relying on garbage-heavy DOM `CustomEvent` objects.
- **Declarative Level & Kit Pipeline (ADR 0020):** JSON-Schema-validated level descriptors (`level.schema.json`) and modular `KitRegistry` with procedural kit fallback, socket light mounting, and metadata binding.
- **Basis Universal / KTX2 Texture Transcoding:** Native WASM-based transcoding for `KHR_texture_basisu` with automatic runtime negotiation for hardware GPU formats (BC7, ASTC, ETC2, BC3).
- **Procedural Generation & Authoring Tooling:** Includes procedural generation utilities like the `GridLevelBuilder` to generate complete dungeon levels from ASCII maps, plus a comprehensive tool suite (`MakerApp`, `MapGenerator`, `Pixler`, `Xtractor`, `Forge`, `MaterialStudio`).
- **Geometry & Asset Loaders:** Dynamic terrain generation, comprehensive primitive library, and async loaders for glTF 2.0 (with extensions), OBJ models, MTLLib materials, and textures (via unified static factories like `Texture.fromUrl()`).
- **Hardware Telemetry & Feature Detection:** Built-in `DeviceCaps` provides robust detection of WebGPU/WebGL API support, hardware limits (Memory, Cores, Texture Sizes), and experimental browser features (Wasm, Async, Generic Sensors).
- **SPA & Frontend Framework Ready:** Fully compatible with React, Vue, and Angular. Features a robust `engine.destroy()` lifecycle hook that completely frees GPU memory and detaches global event listeners. The engine even auto-destroys if it detects its canvas has been unmounted from the DOM.

### ⚡ Under the Hood (Hardcore Engineering)

- **Zero-Allocation Render Loop:** The critical path is strictly structured to ensure **zero memory allocations** (garbage) during the main render loop. This eliminates unpredictable Garbage Collection (GC) pauses, guaranteeing consistently smooth framerates.
- **Custom Math Engine from Scratch:** We don't rely on massive external math libraries like `glMatrix`. Small World Machine features a bespoke, highly-optimized mathematics library for vectors and matrices, tailored exactly for our right-handed coordinate system.
- **Advanced Rendering & Post-Processing:** Consistent linear space math through the entire pipeline, featuring a highly efficient, unified final pass for Tone-Mapping, Color-Grading, Vignette, and sRGB Gamma Correction.
- **Advanced Materials & Fluid Surfaces (ADR 0013):** Built-in PBR, Retro Screen, and unified liquid shaders (Wave family: `OpenWaterMaterial`/`StylizedWaterMaterial` with Gerstner waves and depth-fade; Flow family: `LavaMaterial`/`SlimeMaterial` with noise flow and emissive glow).
- **WebGPU Compute Shaders:** Real compute-shader usage, not just the graphics pipeline — e.g. the Clustered Forward+ Lighting pass culls every light against the frustum grid on the GPU before the main render pass runs.
- **Automated GPU Memory Management:** No more manual `geometry.dispose()` or `material.dispose()`. The engine utilizes rigorous internal reference counting across all renderers. When you remove an object from the scene, orphaned WebGL/WebGPU resources are safely and automatically garbage-collected.
- **Absolute "Zero Dependency" Philosophy:** No Three.js, no Babylon.js. We built a complete 3D engine—including Frustum Culling (`frustum.intersectsVolume(obj.bounds)`), Scene Graph, and Resource Management—entirely from scratch. This keeps the footprint tiny and performance at the absolute maximum.

## 📦 Installation

This package is private and not published to the NPM registry yet. Clone the repository and install
dependencies locally:

```bash
git clone https://github.com/rottensteiner-stefan/small-world-machine.git
cd small-world-machine
npm install
```

## 🎮 Quick Start

The engine provides a `SmallWorldMachine` base class that handles the render loop and hardware initialization automatically.

### 1. Configuration

You can configure the engine by passing an options object to the constructor. In modern bundlers (like Vite), you can also import a JSON file directly.

```typescript
import config from "./config/small-world-machine.json";

class MyGame extends SmallWorldMachine {
  constructor() {
    // Pass the configuration to the engine
    super(config);
  }
// ...
```

### 2. Implementation Showcase

```typescript
import { SmallWorldMachine, Cube, Color, StandardMaterial, Object3D, OrbitController, Texture } from "@small-world-machine/engine";

class MyGame extends SmallWorldMachine {
  constructor() {
    super(); // Or pass config here
  }
  protected async setupScene(): Promise<void> {
    // 1. Load a texture and create a PBR material
    const albedoTex = await Texture.fromUrl("./assets/textures/diffuse.png");
    const geometry = new Cube({ size: 2 }).getGeometryData();
    const material = new StandardMaterial({
      diffuseMap: albedoTex,
      color: Color.DODGERBLUE,
      metallic: 0.7,
      roughness: 0.2,
    });

    // 2. Wrap in an Object3D and add to scene
    const cube = new Object3D("MyCube");
    cube.geometry = geometry;
    cube.material = material;
    cube.position.set(0, 1, 0);

    this.scene.add(cube);

    // 3. Configure the camera and attach behaviors (controllers)
    this.camera.position.set(5, 5, 5);
    this.camera.target.set(0, 0, 0);

    // Camera controllers are now behaviors!
    this.camera.addBehavior(new OrbitController());
    this.camera.addBehavior(new ZoomController());
  }

  protected override update(deltaTime: number): void {
    // Logic executed every frame
  }
}

// Start the application
const game = new MyGame();
game.start();
```

## 🛠 Development

### Prerequisites

- **Node.js:** We recommend using the version specified in `.nvmrc`. If you use [nvm](https://github.com/nvm-sh/nvm), simply run `nvm use` in the root directory.

### Local Setup

1.  **Install dependencies:**
    ```bash
    npm install
    ```
2.  **Start development server (Vite):**
    ```bash
    npm run dev
    ```
3.  **Build the library:**
    ```bash
    npm run build:lib
    ```

### Optional: Dev Containers (VS Code)

For an isolated development environment, this project includes a **Dev Container** configuration for VS Code.

- When opening the project, VS Code should prompt you to "Reopen in Container".
- This sets up the correct Node.js version and recommended extensions (ESLint, Prettier, etc.) automatically.

## 📂 Project Structure

Small World Machine is organized as a lightweight TypeScript monorepo (`packages/*`, `apps/*`, `public/*`):

### `packages/` — Engine & Extensions
- **`packages/engine`**: Core 3D engine (`@small-world-machine/engine`).
  - `src/core`: Core lifecycle (`SmallWorldMachine`), Scene Graph (`Object3D`, `Scene`), `Input`, `Color`, and `EventBus`.
  - `src/core/behaviors`: Modular behavior components (e.g. `OrbitController`, `HoverBehavior`, `DraggableBehavior`, Proximity Sensors).
  - `src/core/cameras`: Camera projections (Perspective, Orthographic), strategies, and camera effects.
  - `src/core/fsm`: Type-safe, zero-allocation Finite State Machine framework.
  - `src/core/materials`: PBR standard materials, Glass/Dielectric materials, Fluid/Water shaders, and Post-Processing passes.
  - `src/core/lights`: Light types (Ambient, Directional, Point, Spot, Area, Clustered Forward+).
  - `src/geometry`: Geometric primitives (`Cube`, `Sphere`, `Cylinder`, `Plane`, `Ground`) and dynamic terrain logic.
  - `src/math`: Custom SIMD-friendly vector/matrix math, raycasting, bounding boxes, and memory pooling (`MathPool`).
  - `src/loaders`: Asset loading pipeline (glTF 2.0, Declarative Level Descriptors / `KitRegistry`, OBJ/MTL, Textures).
  - `src/physix`: Physics system, colliders, bounding boxes (AABB/OBB), and solvers.
  - `src/renderers`: Hybrid WebGPU, WebGL 2, and WebGL 1 rendering backends.
- **`packages/tools`**: Browser tools (`Maker` with the merged M1/M2 `maker/` suite, `Forge`, `Xtractor`, `Pixler`, `MapGen`, `MaterialStudio`; the M3+ tool merges per ADR 0033 are still open), a headless core (`core/`, ADR 0034 — a `swm` CLI is in progress), and dev/production helpers (`attachDevTools`).
- **`packages/gltf-extensions`**: Extended glTF capabilities including `KHR_texture_basisu` (WASM-based Basis Universal / KTX2 GPU texture transcoding).
- **`packages/geometry-extras`**: Procedural and parametric geometry extensions (`Lathe`, Platonic solids, Filled polygons).
- **`packages/physics-extras`**: Advanced physics solvers, convex hulls, and geometric algorithms.

### `apps/` — Showcases & Sample Games
- **`apps/showcases`**: 39 numbered interactive showcases (1–24, 26–40, #25 is intentionally absent) demonstrating engine features (PBR, IBL, Glass transmission, Post-processing, Clustered lighting, Decals, Spatial audio, etc.), plus the `presentation` app.
- **`apps/sample-apps`**: Production vertical slices and games (*The Whisper — A Viennese Requiem*, *Light Cycle Arena*, etc.).

### `public/` — Assets & Tools
- `public/assets`, `public/resources`: Shared 3D models, textures, sound effects, and asset kits.
- `public/schemas`: JSON Schema (draft 2020-12) validation files for declarative levels (`level.schema.json`) and asset kits.
- `public/tools`: Standalone browser-based creative tools running client-side via File System Access API.

## 🧰 Tools & Authoring Suite

Small World Machine includes a comprehensive suite of standalone, browser-based creative and diagnostic tools (`public/tools/`), running entirely client-side via the File System Access API without external server dependencies or build-step friction:

### 🌟 Maker — World & Scene Editor (`public/tools/maker.html`)
The engine's flagship standalone 3D scene composer and level editor ([User Guide](docs/guides/maker.md)):
- **Direct glTF 2.0 Persistence & Autosave:** Debounced (500ms) write-through directly into standard `scene.gltf` projects with vendor-namespaced `SWM_*` extensions for Small World Machine behaviors, physics, and custom material parameters.
- **High-Speed Keyboard Nudging & Transformation:** Camera-perspective-aware directional nudging ($\leftarrow, \rightarrow, \uparrow, \downarrow$ on XZ ground), elevation adjustments (`Shift` + $\uparrow / \downarrow$, `PageUp`/`PageDown`), and **Snap to Ground** (<kbd>End</kbd> / `⬇ Ground`) to align bounding boxes flush with $Y = 0$.
- **Dynamic Snapping & Grid Stepping:** Enabled by default with instant grid resolution stepping via <kbd>[</kbd> (finer) and <kbd>]</kbd> (coarser) across `0.1m` to `2.0m`, $15^\circ$ angle quantization, and $0.25$ scale steps (Toggle: <kbd>X</kbd>).
- **Multi-Selection & Pivot-Relative Clusters:** 2D screen-space Marquee box selection, Cyan/Amber primary/secondary hierarchy highlights, and pivot-relative multi-object group transformations.
- **Always-on-Top Transform Gizmos:** Translate (<kbd>W</kbd>), Rotate (<kbd>E</kbd>), and Scale (<kbd>R</kbd>) rendered with `depthTest: false` so handles never submerge inside dense meshes.
- **Prefab Pipeline & Isolated 3D Previews:** Author reusable modular prefabs with automated $3/4$-view isolated thumbnail generation (`.thumb.json`).
- **9-Slot Camera Bookmarks:** Fast vantage point recall (<kbd>1</kbd>–<kbd>9</kbd>) and memorization (<kbd>Ctrl+1</kbd>–<kbd>9</kbd> / Right-click).
- **ASCII Map Importer:** Instant conversion of ASCII text tilemaps (`#`, `.`, `D`, `@`, `T`, `P`) into modular 3D dungeons.
- **Atomic Undo/Redo & Soft Delete:** Full history stack (<kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Shift+Z</kbd>) with off-scene trash bin protecting GPU buffer allocations.

> **Status (Big Merge, ADR 0033/0034):** Maker's M1/M2 footprint is on `main` — the
> `packages/tools/src/maker/` suite (`ToolMode`, `ModeHashRouter`, `WorldModeAdapter`, …) and
> `public/tools/maker.html` ship a fused mode launcher in which the **World** editor is live.
> The other tools (Xtractor, Pixler, Map, Material, IBL, Kit) are not yet migrated into that
> launcher — they remain available as standalone pages below. A `swm` CLI on the headless
> `packages/tools/src/core/` is in progress. This is the current state, not a roadmap promise.

### Standalone Development Tools
- **T-01: Procedural Splatter Generator** (`public/tools/splatter-gen.html`): Generate procedural blood, splatters, dirt decals, and impact masks.
- **T-02: PBR Map Generator** (`public/tools/pbr-gen.html`): Generate Normal, Specular, AO, and Height maps from a single diffuse image.
- **T-03: Gamepad Diagnostic Tool** (`public/tools/gamepad-test.html`): Live gamepad input, axis calibration, and haptic feedback testing.
- **T-04: IBL Generator** (`public/tools/ibl-gen.html`): Generate Image-Based Lighting (Irradiance and Radiance) environment maps.
- **T-05: Xtractor** (`public/tools/maker.html#xtractor`): AI Image Workbench to crop, slice, and assemble tile-maps and sprite atlases.
- **T-06: Pixler** (`public/tools/maker.html#pixler`): Retro 2D pixel-art editor to draw, animate, and export sprites.
- **T-07: Map Generator** (`public/tools/maker.html#map`): Visual grid editor to author ASCII layouts for the `GridLevelBuilder`.
- **T-08: Maker** (`public/tools/maker.html`): Standalone 3D scene and world composition environment.
- **T-09: Kit Inspector** (`public/tools/kit-inspector.html`): Inspect modular asset kit metadata, registries, and runtime kit state.

### In-Game Overlay
- **The Forge:** A built-in floating window manager providing runtime inspection, diagnostics, and integrated tooling directly inside your running game (toggleable via configurable shortcut, e.g. `~` or `F12`).

## 📚 Documentation & Guides

This project provides comprehensive developer documentation, engine guides, and production roadmaps:

- **[Vision & Core Philosophy](VISION.md):** The atmospheric indie game philosophy ("The Stray Principle").
- **[Domain Glossary](CONTEXT.md):** Canonical terminology for the engine's core architectural concepts.
- **[Guides](docs/guides/index.md):** Per-subsystem deep-dive guides, including the **[Maker User Guide & Pro Reference](docs/guides/maker.md)** and the **[Commercial Indie Game Roadmap & Publisher Strategy](docs/guides/commercial-indie-roadmap.md)** (Steam/PlayStation/Xbox release strategy, Tauri packaging, publisher pitching).
- **[Architecture Decision Records](docs/adr/index.md):** The "why" behind every hard-to-reverse engine design call.
- **[Research & Technical Studies](docs/research/index.md):** Point-in-time deep dives, audits, and technology comparisons.
- **[AGENTS.md](AGENTS.md):** Workflow conventions and coding standards for AI coding agents working in this repo.
- **Interactive Guides & API Reference:**
  - Build API documentation with TypeDoc:
    ```bash
    npm run docs:api
    ```
  - Start the local VitePress documentation server:
    ```bash
    npm run docs:dev
    ```

## 🤝 Contributors

The majority of the codebase was developed in close collaboration with the three AI models listed in [CONTRIBUTORS.md](CONTRIBUTORS.md) (Google Gemini, Anthropic Claude Code, and DeepSeek). See [CONTRIBUTORS.md](CONTRIBUTORS.md) for details on contributors and roles.

## 📄 License

This project is licensed under the MIT License.

