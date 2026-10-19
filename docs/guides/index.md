# Guides

Practical, in-depth guides for each subsystem and tool of the Small World Machine engine. For the design decisions behind them, see [Architecture Decision Records (ADRs)](/adr/); for vocabulary, see [`CONTEXT.md`](https://github.com/rottensteiner-stefan/small-world-machine/blob/main/CONTEXT.md) in the repo root.

## Getting Started

| Guide | Description |
|---|---|
| [Installation & Setup](./getting-started.md) | Set up the project, launch your first scene. |
| [Commercial Indie Roadmap](./commercial-indie-roadmap.md) | Strategic roadmap from prototype to a Steam/PlayStation/Xbox release. |

## Core Concepts

| Guide | Description |
|---|---|
| [Architecture & Overview](./architecture.md) | Overall architecture and code showcases. |
| [Materials & Shaders](./materials.md) | PBR material system and shader fundamentals. |
| [Liquid Simulation & Waves](./liquid-wave-data-model.md) | Wave data model, Gerstner cascade, splats, clapotis, and buoyancy probing. |
| [Shadows](./shadows.md) | Shadow mapping, CSM, PCSS. |
| [Decals](./decals.md) | Box-projected decals, orientation rules, normal buffer, cost. |
| [Volumetric Fog](./volumetric-fog.md) | Froxel-based true 3D volume fog (WebGPU, Stufe 3), additive composite. |
| [Depth of Field](./depth-of-field.md) | Thin-lens bokeh depth of field (WebGPU/WebGL2 gather, WebGL1 tilt-shift). |
| [Adding a New Material](./adding-materials.md) | Step-by-step recipe for new materials across all renderers. |
| [Shader Importers](./shader-importers.md) | WGSL/GLSL chunk assembly. |
| [Configuration & Setup](./configuration.md) | `EngineOptions` and engine setup. |
| [Coordinate System & Camera Strategies](./coordinate-system.md) | Right-handed coordinate system, camera strategies. |
| [2.5D Scenes & Backgrounds](./2-5d-scenes.md) | Perspective matching, movement zones, camera strategy trade-offs. |
| [Gamification & Interactions](./interactions.md) | `InteractionManager`, pointer events, octree picking. |
| [Physics & Rigid Bodies](./physics.md) | Collision detection, solvers, constraints/joints. |
| [Audio System](./audio.md) | 3D audio, mixer, procedural synthesizer. |
| [State Machines (FSM)](./state-machines.md) | Zero-allocation finite state machine framework. |
| [EventBus & Game Loop](./eventbus.md) | Central event dispatch and render loop. |
| [Modular Ecosystem & Layering](./extensions.md) | Core engine vs. ecosystem package boundaries (see also [Extensions](/extensions/)). |
| [Building Your Own Game](./custom-game.md) | End-to-end guide for a new project built on the engine. |

## Tools & Editors

| Guide | Description |
|---|---|
| [Tooling Overview](./toolchain.md) | Recommended external tool chain. |
| [Maker (3D World Editor)](./maker.md) | Complete professional guide & reference. |
| [The Forge (In-Game Window Manager)](./forge.md) | In-game diagnostics and tooling overlay. |
| [Material Studio](./material-studio.md) | PBR map generator. |
| [Pixler (Pixel Art Editor)](./pixler.md) | Retro 2D sprite editor. |
| [Xtractor (Sprite Extractor)](./xtractor.md) | Image cropping & slicing for tile/sprite atlases. |
| [Map Generator (ASCII Grid Levels)](./map-generator.md) | Visual grid editor for `GridLevelBuilder` layouts. |

## Standalone Reference Material

Standalone HTML explainer pieces linked to from one of the guides above or from a `.agents/skills/` recipe (not part of the VitePress page tree): see `.agents/notes/reference/` in the repo.
