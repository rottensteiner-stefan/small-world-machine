# Small World Machine Core Context

The foundational domain model for the Small World Machine 3D engine. It defines the core architectural concepts for the hybrid WebGL/WebGPU rendering and entity logic system.

## Language

**Anime Fluid Family**:
The unified stylized liquid and fluid pipeline within Small World Machine (`StylizedWaterMaterial`) covering toon, Ghibli-soft, painterly sparkle, dredge, and other stylized looks via parameter vectors and compile-time extension hooks.
_Avoid_: Ghibli Water Subsystem, Liquid Fork — Ghibli is one preset on the continuous Anime continuum; non-water fluids (lava, slime, dark oil) reuse the identical shader core.

**Asset Kit**:
A self-contained, schema-validated directory of modular 3D environment assets, props, and procedural builders sharing a unified PBR palette, scale rhythm, and metadata bindings (`kit.json`, `meta.json`).
_Avoid_: Asset Pack, Model Bundle (informal; Asset Kit names a strictly schema-validated format, ADR 0011).

**Basis Transcoding**:
The runtime process of converting universal `.basis`/`.ktx2` compressed textures into the client GPU's native hardware block-compression format (BC7, ASTC, ETC2, BC3) via WASM.
_Avoid_: Texture Decompression — decompression implies unpacking to uncompressed RGBA; transcoding translates directly between compressed formats to keep textures compressed in GPU VRAM.

**Behavior**:
An attachable logic component for entities (e.g., Cameras, Meshes) that encapsulates specific functionality or interaction rules.
_Avoid_: Script, Controller (as a standalone manager array)

**Broadphase / Narrowphase**:
Broadphase is the cheap, approximate spatial pass (an Octree query) that narrows a large candidate set down to a few; Narrowphase is the exact, expensive test run only on that narrowed set (e.g. ray-triangle intersection, collision resolution).
_Avoid_: Coarse/Fine pass — this project's docs consistently say Broadphase/Narrowphase across both the physics and interaction systems, the same two-stage principle reused deliberately in both places.

**Camera Strategy**:
The pattern (e.g. STIFF, SMOOTH, FPS, ISOMETRIC) that governs how a camera's transform updates each frame.
_Avoid_: Controller — a Controller is a Behavior that drives input; Strategy is the update math itself, a different layer on the same camera.

**Character Rig (Wrapper)**:
The parent `Object3D` node that encapsulates a humanoid model (scaled to 1.80m) to isolate its intrinsic geometry scale from runtime perspective scaling behaviors (such as `StageMovementBehavior`).
_Avoid_: Direct Mesh Scaling on movement behaviors — always wrap in a dedicated Rig object.

**Cluster**:
A single cell of the 3D frustum-aligned grid used to narrow which lights a fragment needs to evaluate, instead of testing every light in the scene.
_Avoid_: Tile (tiled forward+ is a 2D-only variant of this idea that we don't use — our grid is depth-sliced), Cell (used informally in code, but "Cluster" is the term that carries architectural weight across docs/ADRs). Deliberately does NOT claim "Froxel" either, even though the underlying grid math is the same kind of structure — the Froxel volumetric fog subsystem reuses this exact grid layout (Option R, ADR 0031) but represents a distinct consumer accumulating participating medium and scattering rather than light assignment indices.

**Clustered/Tiled Forward+ Lighting**:
The overall technique: culling lights per Cluster so each fragment only evaluates the lights in its own cell's Per-Cell Light List, instead of testing every light in the scene.
_Avoid_: Deferred Lighting — a different, unrelated technique (separates a geometry pass from a lighting pass) that's easy to conflate with this one since both exist to cut per-fragment light cost.

**Context Object**:
An explicit dependency container passed through constructors or lifecycle methods to avoid global state.
_Avoid_: Global Singleton, Universal EventBus

**Culling**:
Cheaply discarding candidates before expensive work runs on the survivors. This engine has two unrelated cullings — visibility culling (`FrustumCuller`, discards whole objects) and light culling (builds a Cluster's Per-Cell Light List, discards lights) — always name which one is meant.
_Avoid_: using "culling" bare when the subsystem isn't already obvious from context — say "visibility culling" or "light culling".

**Decal**:
A lit surface layer projected from a Decal-Box onto the opaque geometry behind it, drawn in its own sub-pass between opaque and transparent (ADR 0029).
_Avoid_: Sticker, Overlay — a Decal is a projection volume, not a mesh laid onto a surface. Does not land on transparents.

**Decal-Box**:
The unit-cube volume of a Decal in its local space; its local -Y axis is the projection direction, and it bounds size, depth, and fade.
_Avoid_: Projector (the Decal itself is the projector; the box is only its volume).

**Declarative Level Descriptor**:
A JSON-Schema-validated scene description format (`level.schema.json`, `*.level.json`) specifying camera configuration, lighting, post-processing, and placed kit nodes (with socket light mountings and behavior bindings) without imperative scene setup code (ADR 0020).
_Avoid_: Scene File (ambiguous with raw glTF `scene.gltf`).

**Event Bus**:
The typed, per-`SmallWorldMachine`-instance event dispatcher (`app.events`) that replaces DOM `CustomEvent` for engine-internal notifications.
_Avoid_: Global Event Bus, Universal EventBus — rejected under Context Object; this bus is scoped to one engine instance, never a shared global.

**FogVolume / Interior Carving**:
An analytical geometric volume (`FogVolume`: Box, Sphere, Cylinder) placed into the 3D scene graph that injects localized scattering, emission, or negative density into the global Froxel grid or raymarching volume. Negative density values carve out fog from interior spaces (e.g. rooms, vaults, caverns) without requiring complex geometry meshes or stencil cuts ($\text{extinction} = \max(0.0, \text{extinction} + \text{volDensity})$).
_Avoid_: Fog Mesh, Stencil Volume — carving is achieved through continuous analytical SDF evaluation and additive density clamping in shaders, not geometry clipping.

**Forge / ForgeTool**:
Forge is the dockable window-manager overlay; a ForgeTool is a single mini-app hosted inside it (e.g. Gadget Inspector, Pixler, Material Studio).
_Avoid_: Panel, Plugin — Tool names a specific contract (the `ForgeTool` class), not a generic panel.

**Froxel (Volumetric Fog)**:
A single cell ("frustum voxel") within the 3D camera-frustum grid ($160 \times 90 \times 64$ in WebGPU, or screen-depth tiles in WebGL2) that stores participating medium properties (scattering, extinction, phase function parameters) and in-scattered light accumulated along camera rays (ADR 0031).
_Avoid_: Screen-Space God Rays (Stufe 2 / `LightShaftsElement` handles crepuscular rays), Voxel Grid (froxels are frustum-aligned with exponential near-to-far logarithmic slicing, not uniform world-axis AABB voxels).

**HBAO**:
The screen-space ambient occlusion pass actually shipped (`HbaoElement`): a single max-dot-per-direction horizon search, no cosine-weighted integration, no temporal filtering.
_Avoid_: GTAO — an earlier draft was named `GtaoElement`, but that overstates what's implemented. Renamed once the gap was pointed out; the code should never claim the more accurate name it doesn't earn.

**Kit Registry**:
The engine subsystem (`KitRegistry`) that discovers, caches, instantiates, and manages procedural kit fallbacks and prop assemblies for declarative level descriptors.
_Avoid_: Asset Manager — `AssetManager` handles low-level glTF/texture downloads and caching; `KitRegistry` resolves higher-level modular kit nodes, sockets, and metadata (ADR 0020).

**Light Coverage**:
The range of Clusters — a screen-space X/Y range plus a depth-slice range — that a single light's bounding sphere can possibly reach.
_Avoid_: Light Bounds, Footprint

**Liquid Extension Hook**:
Compile-time shader injection slots (`[WATER_EXT_DECL]`, `[WATER_EXT_SURFACE]`) allowing extension packages (such as `liquid-extras`) to inject custom procedural looks (e.g. Noir comic-book ink) without modifying or branching engine core shaders (ADR 0025).
_Avoid_: Dynamic Shader Patching, Runtime Shader Interception.

**Mannequin (Asset Root)**:
The canonical folder structure (`public/assets/<app>/mannequin/<character>/` and `raw/mannequin/`) organizing game-ready rigged characters and shared mocap pools per character namespace rather than by asset type.
_Avoid_: Asset Type Root (e.g. splitting into `/models/` and `/textures/` across different folders).

**Material**:
A rendering definition that encapsulates both the visual properties (e.g., color, shininess) and the underlying shader logic for WebGL/WebGPU.
_Avoid_: Shader Program (Material is the higher-level abstraction)

**MathPool**:
The shared pool of scratch vectors/matrices that hot-path code borrows from and returns, instead of allocating its own.
_Avoid_: Temp Vector, Scratch Buffer — informal; MathPool is the one canonical, engine-wide facility for this.

**MotionTrail**:
A deliberate ghost/afterimage post-processing effect, reusing TAA's exact history-blend mechanism with no camera jitter and a much higher feedback value.
_Avoid_: confusing it with TAA — same underlying machinery (`HistoryBlendPass`), opposite intent: TAA hides its own feedback artifact, MotionTrail maximizes it on purpose.

**Normal-Buffer**:
The thin world-space, octahedral-encoded normal target written as a second render target by the main pass (shading normal, incl. normal map), switched on automatically when a Decal is visible (ADR 0028).
_Avoid_: G-Buffer — there is no albedo/material data and no deferred lighting.

**Normal Sentinel**:
The value (-2, -2) in the Normal-Buffer that marks "no normal here" (sky, untouched pixels); it lies outside the valid octahedral range.
_Avoid_: Null normal, empty normal.

**NormalTargetMode**:
The per-pipeline variant that says how a draw treats the Normal-Buffer: `none` (no target), `write`, `masked` (attached but write-masked, e.g. transparents, skybox), `blend` (alpha-blended, used by Decals).
_Avoid_: Normal pass mode — it selects a pipeline variant, not a render pass.

**Per-Cell Light List**:
The stored data a Cluster reads at lookup time: an offset+count into a flat list of light indices. The read-side counterpart to Light Coverage, which is the write-side view (from a light's perspective, which cells it reaches).
_Avoid_: Light Grid (ambiguous with "Cluster grid", the whole 3D structure, rather than one cell's list)

**Post-Processing (Pipeline)**:
The fixed, hardcoded effect order (Bloom -> HBAO -> Light Shafts -> Tonemapping -> Vignette -> Grain -> Quantize -> Flash) that every enabled effect runs through. Light Shafts in-scattering composites additively before Tonemapping so crepuscular beams contribute naturally to HDR exposure and contrast curves. Flash is deliberately last so it reads as a true full-screen overlay over everything else, not a color adjustment blended into the scene.
_Avoid_: treating `PostProcessingEffectsConfig`'s object shape as an ordered list — enabling effects doesn't reorder them; the sequence itself is not configurable.

**Scene Graph**:
The hierarchical tree of 3D objects that defines spatial relationships, transformations, and rendering order.
_Avoid_: World Map, Entity List

**Semantic Socket**:
A named transform node attached as a child to a specific skeletal bone (`mixamorig:LeftHand`, `mixamorig:RightHand`) with standardized local offsets and rotations to host props (Lanterns, Torches, Weapons) with zero jitter during animation playback.
_Avoid_: Prop Constraint (informal)

**State Data**:
The user-defined payload object passed into a Finite State Machine's `onEnter`/`onUpdate`/`onExit` callbacks.
_Avoid_: Context, FSM Context — collides with Context Object, an unrelated DI concept; "State" is already the FSM's node/mode (`idle`, `patrolling`, ...), so State Data is deliberately a third, distinct word rather than overloading either.

**Story-First (The Stray Principle)**:
The foundational design commitment that emotional resonance, lighting atmosphere, worldbuilding, and narrative depth precede and drive all technical features. Technical architecture serves the story, never the reverse.
_Avoid_: Spec-Chasing, Tech-Demo First, 8K-Photorealism

**TAA (Simplified)**:
Sub-pixel camera jitter plus an exponential history blend — deliberately without motion-vector reprojection.
_Avoid_: "TAA" unqualified when precision matters — the missing reprojection step is the actual, documented trade-off (visible ghosting under fast movement), not an implementation detail to gloss over.

**Zero-Allocation (Hot Path)**:
The design rule that per-frame code (physics step, event dispatch, FSM update) must not allocate new objects, so it never triggers a GC pause.
_Avoid_: Performance Optimization (generic) — this is a specific, named commitment repeated verbatim across the physics, event bus, and FSM docs, not a vague performance goal.
