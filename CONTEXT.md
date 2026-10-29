# Small World Machine Core Context

The foundational domain model for the Small World Machine 3D engine. It defines the core architectural concepts for the hybrid WebGL/WebGPU rendering and entity logic system.

## Language

**Anime Fluid Family**:
The unified stylized liquid and fluid pipeline within Small World Machine (`StylizedWaterMaterial`) covering toon, Ghibli-soft, painterly sparkle, dredge, and other stylized looks via parameter vectors and compile-time extension hooks.
_Avoid_: Ghibli Water Subsystem, Liquid Fork — Ghibli is one preset on the continuous Anime continuum; non-water fluids (lava, slime, dark oil) reuse the identical shader core.

**App-Manifest (Application Manifest)**:
The single mandatory app boundary file `app.json` (schema: `public/schemas/app.schema.json`, `schemaVersion`-Kette, ADR 0041 §2 / Stufe 1): declares `id`, `version`, `entry`, owned content (`levels`, `characters`, `kits`, `content.languages`) and the `save` declaration. Verified by `assertAppManifest()` + `AppManifestValidation.test.ts`.
_Avoid_: Project File, App Config — the manifest names the app *unit* with stable IDs and never-reused identifiers (ADR 0041), not a loose config blob.

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

**Capture-Frame-Rate (`captureFrameRate`)**:
A deterministic simulation mode (`SmallWorldMachine.captureFrameRate`) in which the main loop advances gameplay and animation by an exact fixed timestep $\Delta t = 1.0 / \text{captureFrameRate}$ per frame, completely decoupled from wall-clock execution duration (analogous to Unity's `Time.captureFramerate` or Godot's `--fixed-fps`). Makes recordings and screenshot baselines reproducible on the same device and driver; temporal effects (fog history, TAA) additionally need a few warm-up `step()` frames to converge.
_Avoid_: Fixed Timestep (ambiguous: physics has an internal fixed sub-step, whereas capture frame rate locks the outer engine step and frame clock for recording).

**Character Rig (Wrapper)**:
The parent `Object3D` node that encapsulates a humanoid model (scaled to 1.80m) to isolate its intrinsic geometry scale from runtime perspective scaling behaviors (such as `StageMovementBehavior`).
_Avoid_: Direct Mesh Scaling on movement behaviors — always wrap in a dedicated Rig object.

**Cluster**:
A single cell of the 3D frustum-aligned grid used to narrow which lights a fragment needs to evaluate, instead of testing every light in the scene.
_Avoid_: Tile (tiled forward+ is a 2D-only variant of this idea that we don't use — our grid is depth-sliced), Cell (used informally in code, but "Cluster" is the term that carries architectural weight across docs/ADRs). Deliberately does NOT claim "Froxel" either, even though the underlying grid math is the same kind of structure — the Froxel volumetric fog subsystem reuses this exact grid layout (Option R, ADR 0031) but represents a distinct consumer accumulating participating medium and scattering rather than light assignment indices.

**Clustered/Tiled Forward+ Lighting**:
The overall technique: culling lights per Cluster so each fragment only evaluates the lights in its own cell's Per-Cell Light List, instead of testing every light in the scene.
_Avoid_: Deferred Lighting — a different, unrelated technique (separates a geometry pass from a lighting pass) that's easy to conflate with this one since both exist to cut per-fragment light cost.

**Content Package / Stabile Text-ID**:
A per-app text resource file `content/<sprache>.json` (ADR 0041 Stufe 4) holding stable, never-reused text IDs (`namespace.path.*`) with non-empty string values; all language packs of an app share identical key sets (mutual key check) and are bound to the manifest via `app.json` `content.languages`. Resolved app-side through `ContentPackage.t(id)` (fail-fast on unknown IDs). Language is an Einstellung (Savegame-Setting), never game content.
_Avoid_: Locale String Table, Hardcoded UI Labels — code references IDs, never content strings, so Lektorat/i18n never ships in code.

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
A JSON-Schema-validated scene description format (`level.schema.json`, `*.level.json`) specifying camera configuration, lighting, post-processing, and placed kit nodes (with socket light mountings and behavior bindings) without imperative scene setup code (ADR 0020). Level files live under `apps/<app>/levels/`, declared by ID in the app manifest (ADR 0041 Stufe 3).
_Avoid_: Scene File (ambiguous with raw glTF `scene.gltf`).

**Ember Bed (Glutbett)**:
The opaque, emissive fuel-bed element under a fire (`EmberBed`, `@small-world-machine/vfx-extras`): a shallow `StandardMaterial` cylinder that breathes with a slow seeded noise envelope (≈0.35 Hz, clamped emissive band, no heartbeat) — the coal bed under a campfire or the charred tip wrap of a torch. Opaque by contract: a transparent glow sticker over the logs would read as fake.
_Avoid_: Coal Shader, Glow Sticker — the fuel bed is a solid emissive volume, not a per-pixel coal simulation (that stays a documented HIGH-tier option).

**Event Bus**:
The typed, per-`SmallWorldMachine`-instance event dispatcher (`app.events`) that replaces DOM `CustomEvent` for engine-internal notifications.
_Avoid_: Global Event Bus, Universal EventBus — rejected under Context Object; this bus is scoped to one engine instance, never a shared global.

**FogVolume / Interior Carving**:
An analytical geometric volume (`FogVolume`: Box, Sphere, Cylinder) placed into the 3D scene graph that injects localized scattering, emission, or negative density into the global Froxel grid or raymarching volume. Negative density values carve out fog from interior spaces (e.g. rooms, vaults, caverns) without requiring complex geometry meshes or stencil cuts ($\text{extinction} = \max(0.0, \text{global} + \sum \text{positive} + \sum \text{negative})$, so carving does not depend on volume order).
_Avoid_: Fog Mesh, Stencil Volume — carving is achieved through continuous analytical SDF evaluation and additive density clamping in shaders, not geometry clipping.

**Dichtemaske / VolumetricTexture (3D-Dichtefeld)**:
A user-authored 3D data texture (`VolumetricTexture`, RGBA8, D3D-style bottom-up) that modulates the volumetric fog per voxel: R = per-voxel density factor (the only mask channel that changes extinction/transmittance), G = per-voxel single-scattering albedo replacing the global (`VolumetricFogElement.scatteringAlbedo`) or per-volume (`FogVolume.albedo`) value in that cell. Bound either to the whole element inside a world-aligned box (`VolumetricFogElement.densityMask`/`maskPosition`/`maskSize`) or to a single `FogVolume.densityMask` (local box), never to the camera-aligned froxel grid. Absent mask slots are bound to a 1×1×1 identity texture, so the unmodulated path stays numerically identical.
_Avoid_: Voxel Map, 3D-Texture-Array (per-volume masks keep their own unique resolution — there is a WebGL2 slot budget of 8 masks and a WebGPU budget of 16, but no packing/atlas).

**Frame-Kontext (`FrameInfo`)**:
The unified per-frame timing and sequence descriptor (`FrameInfo`, accessible via `renderer.frameInfo` and `app.frameInfo`) written exclusively by `SmallWorldMachine.step()`. Encapsulates hit-stop/time-scale-adjusted gameplay time (`time`, `deltaTime`), unscaled wall-clock time (`realTime`, `realDeltaTime`), and a monotonically increasing `frameIndex`. Subsystems, post-processing passes, and compute shaders (such as volumetric fog noise advection and temporal jitter) read from this context instead of querying `performance.now()`.
_Avoid_: Engine Time, Delta Time (loose globals; `FrameInfo` is a structured context object passed per frame to enforce determinism and avoid global singletons).

**Forge / ForgeTool**:
Forge is the dockable window-manager overlay; a ForgeTool is a single mini-app hosted inside it (e.g. Gadget Inspector, Pixler, Material Studio).
_Avoid_: Panel, Plugin — Tool names a specific contract (the `ForgeTool` class), not a generic panel.

**Froxel (Volumetric Fog)**:
A single cell ("frustum voxel") within the 3D camera-frustum grid (on WebGPU the clustered light grid itself: 16 px screen tiles x 24 log-spaced depth slices; WebGL2 raymarches the same medium per pixel instead) that stores participating medium properties (scattering, extinction, phase function parameters) and in-scattered light accumulated along camera rays (ADR 0031).
_Avoid_: Screen-Space God Rays (Stufe 2 / `LightShaftsElement` handles crepuscular rays), Voxel Grid (froxels are frustum-aligned with exponential near-to-far logarithmic slicing, not uniform world-axis AABB voxels).

**HBAO**:
The screen-space ambient occlusion pass actually shipped (`HbaoElement`): a single max-dot-per-direction horizon search, no cosine-weighted integration, no temporal filtering.
_Avoid_: GTAO — an earlier draft was named `GtaoElement`, but that overstates what's implemented. Renamed once the gap was pointed out; the code should never claim the more accurate name it doesn't earn.

**Headless Operation**:
A pure data or transform operation on the shared headless core (`core/*`) that runs identically in the browser UI and the CLI, free of DOM, GL, and browser dependencies.
_Avoid_: CLI Operation — the CLI is only one consumer; the identical operation also powers the web UI. Browser Operation, Standalone Tool Logic.

**Kit Registry**:
The engine subsystem (`KitRegistry`) that discovers, caches, instantiates, and manages procedural kit fallbacks and prop assemblies for declarative level descriptors.
_Avoid_: Asset Manager — `AssetManager` handles low-level glTF/texture downloads and caching; `KitRegistry` resolves higher-level modular kit nodes, sockets, and metadata (ADR 0020).

**Light Coverage**:
The range of Clusters — a screen-space X/Y range plus a depth-slice range — that a single light's bounding sphere can possibly reach.
_Avoid_: Light Bounds, Footprint

**Liquid Extension Hook**:
Compile-time shader injection slots (`[WATER_EXT_DECL]`, `[WATER_EXT_SURFACE]`) allowing extension packages (such as `liquid-extras`) to inject custom procedural looks (e.g. Noir comic-book ink) without modifying or branching engine core shaders (ADR 0025).
_Avoid_: Dynamic Shader Patching, Runtime Shader Interception.

**Maker Mode / ToolHost**:
The merged-app mode lifecycle: every authoring tool is hosted as a Maker Mode module, mounted and unmounted by the ToolHost inside the Maker app shell; a mode is neither a standalone page nor a Forge window.
_Avoid_: ForgeTool (the in-game overlay contract, stays strictly in-game; ADR 0024), Standalone Tool Page (the ADR 0010 §3 decision that ADR 0033 amends), Panel/Plugin (informal).

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

**Savegame (Format)**:
The persisted-runtime-state extension of the level-descriptor context (ADR 0020 / ADR 0041 §1, Stufe 5): scoped to concrete levels/instances via stable never-reused IDs plus minimal state flags — content objects are never serialized, so content updates cannot break saves. Carries an explicit `schemaVersion` + migration chain with fail-fast on unknown versions, forward-tolerant unknown fields, diff/patch semantics at the instance branch (no whole-object replacements), backup-before-migration as default, storage IndexedDB/OPFS.
_Avoid_: Global App State, Save Serialization — a savegame references IDs and flags per instance; it is not a dump of the scene.

**Scene Graph**:
The hierarchical tree of 3D objects that defines spatial relationships, transformations, and rendering order.
_Avoid_: World Map, Entity List

**Skybox (kameragebundener Hintergrund)**:
An `Object3D` with a cube geometry (`Cube`) and `SkyboxMaterial` (`depthWrite: false`, `CullMode.NONE`, `frustumCulled: false`) that surrounds the scene as an infinitely far, camera-centred background. The vertex shaders on all three backends neutralize the cube's world translation by adding the camera view position after the `u_model` transform (the view transform maps the camera position to the origin, so the translation cancels and only the orientation survives) and pin the rendered depth to the far plane (WGSL `.xyww`, GLSL `z = w * 0.99999`). A moving camera can therefore never walk out of the sky and a scene `far` plane closer than the cube never clips it; the sampled cube-map direction stays the unrotated local position, so existing scenes render pixel-identically.
_Avoid_: Physical Sky Mesh

**Semantic Socket**:
A named transform node attached as a child to a specific skeletal bone (`mixamorig:LeftHand`, `mixamorig:RightHand`) with standardized local offsets and rotations to host props (Lanterns, Torches, Weapons) with zero jitter during animation playback.
_Avoid_: Prop Constraint (informal)

**Smoke Plume (Rauchfahne)**:
The world-anchored, dissolving smoke effect above a fire (`FireSmokeEmitter` + `SmokeSpriteMaterial`, `@small-world-machine/vfx-extras`): seeded-deterministic (mulberry32, `dt=0` freeze) billboard puffs with buoyancy + drag + multiplicative growth + color-over-life, rendered through a texturless alpha-blended material where the per-instance alpha is pure **opacity** — the renderer therefore runs `ParticleMeshRenderer({ foldAlphaIntoScale: false })`. The procedural soft edge + dissolution replace hard quad clipping; the industry-standard soft-particle depth fade is a documented HIGH-tier follow-up.
_Avoid_: Video-Smoke, Sprite-Atlas Smoke (procedural, no texture), Size-Folded Alpha (that is the ember contract, see `foldAlphaIntoScale`).

**Soot Decal (Ruß/Asche-Grundierung)**:
The dark grounding mark a real fire leaves (ADR 0053): a box-projected `Decal` (unlit, deterministic procedural texture, coverage in alpha) that renders natively on WEB_GPU/WEB_GL2 and is baked into the floor geometry only on WEB_GL1 (`bakeSceneDecals`, ADR 0029 Phase 5). Static by contract — it has no runtime state, so it never flickers and costs nothing while the scene stands still.
_Avoid_: Dynamic Soot Growth, Second Shadow (the mark is baked/static, not a live simulation).

**State Data**:
The user-defined payload object passed into a Finite State Machine's `onEnter`/`onUpdate`/`onExit` callbacks.
_Avoid_: Context, FSM Context — collides with Context Object, an unrelated DI concept; "State" is already the FSM's node/mode (`idle`, `patrolling`, ...), so State Data is deliberately a third, distinct word rather than overloading either.

**Story-First (The Stray Principle)**:
The foundational design commitment that emotional resonance, lighting atmosphere, worldbuilding, and narrative depth precede and drive all technical features. Technical architecture serves the story, never the reverse.
_Avoid_: Spec-Chasing, Tech-Demo First, 8K-Photorealism

**Streualbedo (`scatteringAlbedo`)**:
The single-scattering albedo parameter ($\omega = \sigma_s / \sigma_t \in [0.0, 1.0]$ on `VolumetricFogElement`) defining the ratio of the scattering coefficient $\sigma_s$ to the total extinction coefficient $\sigma_t = \sigma_s + \sigma_a$. A value of $1.0$ represents purely scattering media (bright mist, steam), while lower values introduce absorption $\sigma_a = (1.0 - \omega) \cdot \sigma_t$ to accurately simulate dark, light-attenuating media (smoke, soot, dust) that darken background geometry without self-illuminating.
_Avoid_: Fog Darkness, Fog Absorption (informal; Streualbedo is the physically-based single-scattering ratio $\sigma_s / \sigma_t$).

**TAA (Simplified)**:
Sub-pixel camera jitter plus an exponential history blend — deliberately without motion-vector reprojection.
_Avoid_: "TAA" unqualified when precision matters — the missing reprojection step is the actual, documented trade-off (visible ghosting under fast movement), not an implementation detail to gloss over.

**Workspace/Project**:
The planned shared project-folder concept of the merged Maker — one project folder per session as the common workspace root from which all tools draw their `assets/` substructure (planned; not yet implemented, today tools bind their own folders).
_Avoid_: Project Folder (generic, not namespaced), Content Folder; over-claiming — this names a future concept, not a shipped one (ADR 0033, F6).

**Zero-Allocation (Hot Path)**:
The design rule that per-frame code (physics step, event dispatch, FSM update) must not allocate new objects, so it never triggers a GC pause.
_Avoid_: Performance Optimization (generic) — this is a specific, named commitment repeated verbatim across the physics, event bus, and FSM docs, not a vague performance goal.

---

## Whack-a-Mole-Doktrin — Begriffsschicht (ADR 0047)

> *(Dieser Block ist bewusst Deutsch — konsistent zu den ADRs und zum committed Doktrin-Kontext
> (D14/Q7). Er erweitert das Glossar um die verbindlichen Doktrin-Begriffe; maßgeblich ist
> [ADR 0047](docs/adr/0047-whack-a-mole-doktrin.md).)*

**Domänenparameter (Domain Parameter)**:
Ein öffentlicher Parameter, dessen Wert eine physikalische/künstlerische Domänengröße direkt
benennt — mit Einheit und/oder gültigem Wertebereich (z. B. `roughness ∈ [0,1]`, `ior ≥ 1`, Masse,
Brennweite, Streu-Albedo). In JSDoc als `@domain <Bedeutung>` markiert; Domänenwerte sind über alle
API-Tiers identisch (ein Tier skaliert seine Budgets, nie die Bedeutung des Parameters).
_Avoid_: Config Knob, Tuning Slider — ein Regler, der keine Domänengröße benennt, ist ein Leaky Knob.

**Abgeleiteter Parameter (Derived Parameter)**:
Ein öffentlicher Parameter, der aus Domänengrößen oder Geometrie-/Texel-Maßen berechnet wird
(z. B. ein Schatten-Offset aus Empfänger-Neigung). In JSDoc als `@derived <Ableitung>` markiert;
Ableitungen laufen in Setup/pre-baked, nie im heißen Loop.
_Avoid_: Magic Offset, Bias — ein „Tuning-Wert", dessen Herkunft nicht dokumentiert ist.

**Eingefrorener Standard (Fixed Parameter / Invariant Standard)**:
Ein bewusst immutabler, benannter Standard (eine nominierte Konstante, kein Regler). In JSDoc als
`@fixed <Einfrier-Grund>` markiert (z. B. EVSM-Warp `c=40`, ein Filament-Standard). Ein Parameter,
der keiner der drei Klassen ehrlich zuzuordnen ist, ist ein Leaky Knob und wird abgeleitet oder
eingefroren.
_Avoid_: Magic Number, Freeze-without-reason — „eingefroren" bedeutet dokumentiert eingefroren.

**Leaky Knob / Dead Knob**:
Leaky Knob = ein Parameter, der keine Domänengröße benennt und nur ein Symptom „tunt"
(Tuning-Knob-Fallacy); Dead Knob = ein öffentlich deklarierter, aber (in der Datei) ungelener
Parameter (z. B. das entfernte `OrbitController.minPhi/maxPhi`). Beides ist eine dokumentierte
Anti-Klassifikation.
_Avoid_: Bias Stack, Phantom Option — ein Knob, den kein Codepfad liest.

**Goldene Invariante (Golden Invariant)**:
Eine mathematische Behauptung über die Engine (Energie-Erhaltung, Monotonie „Schatten schärft mit
Entfernung nie", Skalen-Invarianz, Round-trip-Invertierbarkeit), die als Invariante getestet wird
und eine Registry-ID trägt (`@invariant <ID>`, Seed in ADR 0047).
_Avoid_: Snapshot Test — ein Test gegen einen fixen Wert statt gegen eine überall gültige Relation.

**Metamorphe Relation (Metamorphic Relation)**:
Test-Orakel-Ersatz, wenn kein numerisches Orakel existiert: ein benannter Zusammenhang, der für
beliebige (auch unmodellierte) Szenen gelten muss (z. B. `screenToWorld∘worldToScreen ≈ id`),
kodiert über explizite Loops mit handverlesenen Grenzfällen plus seedeten Zufallsfällen (rein-TS,
deterministisch; PBT/fast-check wird am P5-Gate entschieden).
_Avoid_: PBT-Wenn-Block — Metamorphik ist Interims-Konvention, kein Tooling-Zwang (D11).

**Fail-Closed / Honest Fallback**:
An API-Grenzen wird ungültiger Eingang explizit behandelt (clamp auf gültige Domäne, NaN/Infinity-
Guard, Nenner `> epsilon`, dokumentierte Ablehnung); fehlende **render-kritische** optionale
Capabilities lösen den dokumentierten ehrlichen Fallback aus (ADR-0043-Muster) statt eines NaN-/
kaputten Frames (D13: nicht jede kosmetische Tier-Lücke, nur render-kritische + Datenintegrität).
_Avoid_: NaN Frame, Silent Garbage — „irgendwas anzeigen" statt des dokumentierten Defaults.

**Doctrine Gate / Doctrine-Compliance-Abschnitt**:
Der Pflichtabschnitt „Doctrine Compliance" in jedem neuen ADR (ADR 0047 §Vorlage) und die eine
Review-Checkliste („Doctrine Gate Checklist", architecture.md §6) mit fünf Fragen; KPI-Ledger:
`docs/reference/doctrine-ledger.md` (committed, D15).
_Avoid_: Doctrine Formular, KPI-Meeting — ein Frageformular von einer Seite, kein Prozessbüro; KPIs
werden von `npm run check:doctrine` emittiert und nur an Gates konsumiert.
