# 15 — Übergreifende Muster, Judo-Züge und Sanierungsreihenfolge

Verdichtung aus `01`–`14`. Alle Aussagen stützen sich auf die dortigen Agent-Berichte (nicht von mir ausgeführt/verifiziert, außer einzeln im Index vermerkt). Prioritäten sind Vorschläge zur Diskussion, keine beschlossene Planung.

## 1. Verstöße gegen Kernregeln aus CLAUDE.md

### 1.1 „No Global Singletons / mehrere Engine-Instanzen pro Seite"
| Stelle | Datei | Detail |
|---|---|---|
| ShaderRegistry | `renderers/shaders/ShaderRegistry.ts:16, 29-47` | modulglobale `materialShaderProviders`-Map („first wins", keine Warnung), `static instance`; `PostProcessPass.ts:145`, `PostProcessPassGL.ts:125` nutzen `ShaderRegistry.instance` statt `renderer.context.shaderRegistry` |
| Material-Registrierung | `AbstractMaterial.ts:51` | jeder Konstruktor registriert; pinnt erste Instanz je Typ; `CustomShaderMaterial` leakt pro Instanz |
| DeviceCaps-Fassade | `core/DeviceCaps.ts:624-703` | `_sharedDefault`-Singleton, ~80 Z., laut grep nur in Tests genutzt |
| glTF-Extension-Registry | `loaders/gltf/GltfExtensionRegistry.ts:3` | modulglobales Array |
| Draco/Basis | `gltf-extensions/**` | statische Config/Handler/Module-Map |
| Modul-Scratch in GPU-Passes | `DepthPrePassGPU.ts:11-12`, `SpotShadowPassGPU.ts:12-15`, `CascadedShadowPassGPU.ts:10-12` | |
| Occlusion/Scratch | `core/Object3D.ts:12` (`occlusionCulledMap` WeakMap, `_scratchWorldPosition`), `_nextObjectId` | |
| Decal | `core/objects/Decal.ts:8-9` | `_sharedBox`, `_nextSequence` |
| Physik | `StaticCollider._nextColliderId` (ab 10.000.000), `PhysicsSystem._nextInternalId` (ab 100.000.000), `Collision._*Scratch`, `BuoyancySolver._result`, `MathPool` (statisch, ohne Balance-Prüfung), `Curve3D._p1/_p2`, `ConvexHull._scratchNormalMatrix` | |
| Input | `core/input/Input.ts` | Listener global an `window`/`document`, `preventDefault` auf Host-Seite |
| Forge | `ForgeWindow._maxZIndex` | öffentlicher statischer Zähler |
| Engine-Banner | `SmallWorldMachine.ts:241` | `window["__SMALLWORLDMACHINE_BANNER__"]` |
| Showcases/Apps | `23/DroneController.ts:13` (`cornerSpawnIndex`), `14/showcase.ts:35-44` (`SharedState`), feste DOM-IDs (`viennaMapModalContainer`, `terminal-modal-root`, `sponzaTuningHud`, `yad-hud`, `lca-hud-style`) | |
| Tools/DOM | `MaterialStudioController` (62× `getElementById`, seitenweite `querySelectorAll`), Maker (`document.querySelectorAll(".maker-sidebar, …")`), ForgeTheme (`:root`/Scrollbars global), Pixler (`#pixler-pixel-grid`) | |

### 1.2 „Fail Fast / Console-Fehler beheben, nicht wegwarnen" (Memory)
Stille Degradation statt Fehler (Auswahl): Shader-Compile/Link-Fehler (`AbstractWebGLRenderer.createShaderProgram`, `WebGLProgramCache`, `LightShaftsPassGL`, `BloomPassGL`, `PostProcessPassGL`); `KitRegistry` Prop-Ladefehler per `console.warn` (`:285-301`); glTF `extensionsRequired` nie geprüft, unbekannte ComponentTypes → `null`; `FilledPolygon` verwirft Geometrie bei Kollaps; `GltfLoader` `geo === null` übersprungen; `CubeTexture` Fehler → `isLoaded` bleibt false; `Terrain` Längenmismatch → warn + Nullen; `GridLevelBuilder` Wand ohne Textur → Textur 0; Showcases/Prologue/Diorama (`try { await load } catch { console.warn }`, laufen mit `undefined`-Texturen weiter); `Hud`/`Prologue` `void (async()=>…)()` ohne `.catch`; Hull still ignoriert (Raycaster/CCD); `BasisTranscoder._planeToTexture` → `Texture.empty()`; `PoolTextures` `if (!ctx) return Texture.empty()`; Maker `ProjectBinding` Legacy-Filter löscht stillschweigend.

### 1.3 Dateien >1000 Zeilen (Gesetz) und Zerlegbarkeit
| Datei | Zeilen | Zerlegung (Vorschlag) |
|---|---|---|
| `WebGPURenderer.ts` | 2484 | HzbOcclusionSystem, GPURenderTargetCache, GlobalUniformWriter, Post-FX-Kette, Opaque-Capture |
| `WebGL2Renderer.ts` | 1939 | gemeinsamer GL-State/Fog/Billboard in `AbstractWebGLRenderer`, `_renderSubgroup` ~620 Z. |
| `MakerApp.ts` | 1947 | SelectionModel, ViewportPicker, TransformEditing, MakerKeymap |
| `character-diorama/showcase.ts` | 1933 | PlayerRig, DioramaGeometry/Builder/Props |
| `38/showcase.ts` | 1722 | Descriptor-Blöcke + `38/facade/*` |
| `12/showcase.ts` | 1485 | `loadPbrSet`, `build*`-Methoden, 4 Behaviors raus |
| `WebGL1Renderer.ts` | 1397 | gemeinsame Manager-Schicht (−~350 Z.) |
| `Collision.ts` | 1271 | ein Sweep-Kern, ein OBB-SAT-Kern, `CollisionHull.ts` |
| `prologue.ts` | 1281 | TimelineBeat-Tabelle, Hotspots → JSON |
| `14/showcase.ts` | 1180 | textures/room/presets/ui |
| `Pixler.ts` | 1144 | UI-Aufbau, Paletten, Tool-Tabelle |
| `37/showcase.ts` | 1080 | `_build*`-Methoden |
| `ViennaMapModal.ts` | 1013 | Locations-Daten, Templates |
| `flakturm-tunnel/showcase.ts` | 1037 | StageZoneEditor, PlayerRig |
Knapp darunter: `scripts/check-decals.mjs` (967 Z.), `TerminalModal`, `Hud` (yad, 674 Z.). In den letzten 48 h ist keine Datei neu von <1000 auf >1000 gewachsen.

## 2. Querschnittsmuster und Judo-Züge (nach Hebel sortiert)

1. **`BoundingVolume`-Schnittstelle** (`getAabb(out)`, `translate(delta)`, `intersectsRay(ray, out)`, `surfaceNormalAt(point, out)`, `volume()`, `closestPoint()`, `cloneEmpty()/setFromLocal`) + Discriminated Union: entfernt ~10 `BoundingType`-Leitern (Ray, Raycaster, Collision.sweepRayVolume, BuoyancySolver, PhysicsSystem, PhysicsBroadphase, BoundingBox.containsVolume, ContactSolver, SpatialQueries, Object3D.computeBounds, MakerApp ×3, MakerPrefabPipeline), 17× `as unknown as OBB`, Magic-Zahlen `type !== 2 /* OBB */` in `Object3D` (07, 01, 09).
2. **`RigidBodyMath`** (`pointVelocity`, `effectiveInvMass`, `applyImpulseAtPoint` mit Welt-Trägheit): löscht kRot 6×, behebt die nicht rotierte Trägheit, zerlegt `ContactSolver.solve` (≈540 Z.) (07).
3. **`PairTracker`** (enter/stay/exit, Pool, Key): Pool-Leck, doppelte Key-Implementierung, Präzision ≥2^21 (07).
4. **Uniform-Layout als eine Quelle** (`GLOBAL_UNIFORM_OFFSETS`/`GlobalUniformLayout`) statt Magic-Indizes in GLSL, WGSL, TS (UBO-Offsets `2080/2096/672/1696/160/2112`, `gData`-Indizes 112/128/192-211, Binding-Nummern 1/3/11/12) (01, 02).
5. **Post-Effekte:** `packUniforms(out, offset)` + `structuralKey` pro `PostProcessingElement`, WGSL-`override`-Konstanten statt `replace`; `PostProcessingGroup.loadConfig` generisch (−~250 Z.; dreifache Element-Abfrage, Drift zu GL) (02, 03).
6. **`PostEffectPass`-Interface** (`execute(ctx)`, `destroy()`) + `Map<PostProcessingEffectType, …>` im Renderer: `render()`-Orchestrierung (~300 Z.), vier `?.destroy()`-Listen, sechs inline-`import(...)`-Typen; `postProcessing.requiresOpaqueDepth` statt OR-Ketten (02, 01).
7. **Gemeinsame Manager-Schicht für WebGL1/2** (Program/Texture/Buffer) mit GLSL-Strategie (`glsl100`/`glsl300`) — `WebGLBufferManager` kann bereits beide Kontexte; GL1 reimplementiert (01).
8. **Shader-Chunks:** `[GLOBAL_UNIFORMS]`, `[OUTPUT_TRANSFORM]`, `linearizeDepth`, `deriveWaves`, `shadeLight(L, radiance, …)`, gemeinsame Cascade-Auswahl; dreisprachige Duplikate (Glass/Frostglass-PBR-Schleifen, Wellen-Ableitung in 6 Dateien, OilPuddle ×3, Bloom ×3, Cluster-Index-Mathe, pbr_math ×3) (02, 04, 13).
9. **Material-Lanes als typisierte Tabelle pro Material** statt Slot-Wiederverwendung (`u_pad1`, `u_extraParams`, `u_liquidParams`, `u_thresholds`, `u_texOffset`, `u_color.a` …); Basis-`clone()`; `_syncBaseManifestState` einheitlich (04).
10. **Compile/Link-Helper** `compileProgram(gl, vs, fs)` mit throw — `_compileShader` 4× kopiert; Link-Check; Shader-Leak (02, 03, 01).
11. **Revolve-Generator** (`RevolveBuilder`/`LatheGeometry`): 9 Geometrien (~2300 Z.) → <500 Z.; `CylinderSector` löschen; `AbstractGeometry.setBuffers` + `gridIndices` + `gridWireframe`; `rebuild()` oder `readonly`; `addQuad`-Helper statt Winding-Autokorrektur, die Autorenfehler versteckt (06, 13).
12. **`PlayerRig`** (Loader, Clip-Pool, Crossfade, Lantern, Rotation) für the-whisper: −~400 Z., behebt Bug 2/4 (11).
13. **`AbstractShowcase`-Helfer** (`setPerspective`/`cameraOptions`, `loadIbl`, `loadPbrSet`, Skybox via `FollowCameraBehavior`, `postProcessing.configure`, Nav-Generator aus Liste) + `shared/prim.ts`: ~600+ Z. Duplikat in ~20–31 Showcases (12).
14. **Maker:** `commit(label, redo, undo, discard?)` + `snapshotCommand` (Undo-Dreierpaket >25×), Keymap-Tabelle, `PrimitiveCatalog`, `resolveTextureMaps` in `KitRegistry` (Texturauflösung 3×), gemeinsame `OrbitCameraController` mit Pan/Focus (09).
15. **Slider-/Chip-Deskriptor-Tabellen** (Material Studio, Xtractor `parseActionChips` mit 23 Blöcken, Pixler-Tastatur) (10).
16. **`ParticleAffector`-Batch-API** statt pro-Partikel-`apply` (13).
17. **Canvas-/Ingest-Dubletten:** eine Canvas-Bibliothek (dsp vs image), `luminance()`, `createId()`, `matchGlob`, `_buildImageResult`, ein Undo (CanvasUndoHistory für Pixler) (10).
18. **Scripts:** `lib/chromium.mjs`, `lib/showcases.mjs`, `startPreviewServer()`, `parseArgs`-Helper, `sleep` (14).

## 3. Strukturfehler, die mehrfach auftreten
- **Konstruktor-Setter-Falle:** öffentliche Felder, die nach dem Konstruktor wirkungslos sind (alle parametrischen Geometrien, MarchingCubes, FilledPolygon, `AccretionDiskEmitter`-Felder, `NoirWaterMaterial`-Getter liefern Kopien).
- **Konstruktor-Overload „events | options" per Duck-Typing** (Pixler, Xtractor, evtl. MapGenerator/MaterialStudio) → Events in `ForgeToolOptions`.
- **Inline-`import("…")`-Typen** (WebGPURenderer, WebGL2Renderer, PostProcessPass ×10, MainRenderPass, Scene, Object3D, MakerApp, PropertyPanel, Showcases …) → `import type` am Dateikopf.
- **`for…of`/Closures/Array-Literale im Hot-Path** (Behaviors, Cameras, Physik, Renderer, Showcases) vs. Zero-Allocation-Regel.
- **`Math.random()` ohne Seed** (Engine: Audio, Behaviors, Noise; Apps: Showcases, the-whisper) → ein kanonischer `SeededRandom` (4+ PRNG-Kopien: `HeightmapGenerator._mulberry32`, `VoronoiCells.mulberry32`, LCG in `PoolTextures`/`GoldenCapture`, `ibl-gen-core`).
- **Magic Numbers / Magic Strings** statt Enums (`src/enums/`): String-Unions in ~25 Stellen (`GizmoMode`, `ContentAssetType`, `TerrainAlgorithm`, `GridTileType`, `LightingPreset`, `TerminalTab`, `"IDLE"|"WALK"|"RUN"`, `"FALLING"|"BOBBING"|"SINKING"`, `StylizedWaterStyle`, `wireframeMode`, `TrackType`, `InterpolationType`, `CameraStrategy.type` …), `filterMode`-Zahlen (`2`, `8`, `0..7`), Texture-Units/UBO-Offsets/Epsilons.
- **Barrels/Zirkel:** `core ↔ renderers`, `math → physix`, `Vector3D ↔ Matrix4`, `GridLevelBuilder → ../index.js`, `cameras → ./index.js`, `Behavior.ts → ../index.js`, Doppel-Exports in `renderers/index.ts`, `post/index.ts`, `core/showcase/index.ts`, `KitTypes`.
- **Content im Engine-Kern:** `GroomingRat`/`RatGroomingBehavior`, Spiel-Sounddesign in `AudioSystem`/`SynthSFX`, `KitTypes` (Hotspots, `hazardClass`), `AbstractShowcase`, `ForgeTool`, `StageZone`/`StageMovement`, `GearMath`/`Optics`/`Ray2D`, `ToolEvents`, `RampLUT`-Presets, `BillboardInstancer`-Defaults, `AxesHelper`, `Object3D.prefabSource/inspector`.
- **App-Wissen in Packages/Tools:** `MapGenerator`/`MaterialStudioController` kennen App-Pfade (`/apps/sample-apps/yad/...`, `/apps/showcases/10/assets/rock.webp`), `attachDevTools` liest `yad_custom_map`, Ingest kennt `.swf-window`.
- **Deep-Imports** `@small-world-machine/engine/core/...` in ~13 App-Dateien (presentation, yad, light-cycle-arena, flakturm-tunnel, character-diorama, 23) statt Paketwurzel.
- **`scene.update()` doppelt** (Apps rufen es zusätzlich zum Engine-Loop) — 7 Stellen.
- **Listener nie entfernt / kein `destroy`:** Input, Showcases (14+), Maker `ContentDrawer`, Hud, Modals, Editor, Forge-Fenster, `UniversalIngestDropzone`.
- **Sequentielle `await`-Kaskaden** statt `Promise.all` (Texturen/IBL/Audio in ~15 Dateien).

## 4. Widerlegt / korrigiert
- Shader-ID-Kollision `OilPuddleMaterial` (IDs `"OIL_PUDDLE"` vs `"OilPuddleMaterial"`); Klassenname bleibt verwirrend, Provider-Map „first wins".
- Geometrie-Leck in Showcase 12 (Engine gibt Puffer frei; verbleibend Allokations-Churn).
- Zwei frühe Teilberichte hatten zeitweise behauptet, ADR/Tests fehlten — im weiteren Verlauf vorhanden (ADR `docs/adr/0030-volumetric-light-shafts.md`, Tests `LightShaftsMath.test.ts`, `LightShaftsElement.test.ts`); `scripts/check-light-shafts.mjs` aus dem Dossier existiert weiterhin nicht.
- WGSL-Depth-Range AO vs. LightShafts: konsistent (nicht verifiziert).
- Tonemap-disabled = Reinhard ist Absicht (Agent 3).

## 5. Vorgeschlagene Sanierungsreihenfolge

**Welle 0 — Sofort (kleine, isolierte Fixes, hoher Nutzen):**
1. ~~Light Shafts: intensity² + color² (an einer Stelle anwenden), Depth-Threshold linearisieren/relativ + `depthThreshold` als Element-Parameter, GL1-Fade über echten `clipW`, tote Uniforms (`density`, `near/far`, `u_lowResDepthMap`, `shadowNormalBias`, `linearSampler`) bereinigen, `_vaoSrafts`, Link-Check/Shader-Leak (02/03).~~ <!-- ERLEDIGT: intensity²/color² entzerrt, linearisierter/relativer depthThreshold via LightShaftsElement, tote Uniforms & Bindings bereinigt, _vaoShafts gefixt, Compile/Link-Check mit Shader-Freigabe (Bob) -->
2. ~~`Frostglass.frag.wgsl:24-25` Normal-Map-Skalierung entfernen (04). GLSL100 Glass/Frostglass `v_clipPos` (04).~~ <!-- ERLEDIGT: Normal-Map Skalierung aus Frostglass.frag.wgsl entfernt; v_clipPos in base.vert.glsl/base.frag.glsl eingeführt und in Glass/Frostglass glsl100 für Screen-UV genutzt (Bob) -->
3. ~~Doppeltes `scene.update()` in prologue, flakturm-tunnel, Showcases 1/16/17/18 (11, 12, 13).~~ <!-- ERLEDIGT: redundante Aufrufe in Showcases 1/15/16/17/18 und the-whisper Szenen entfernt -->
4. ~~Charakterwechsel-Behavior-Stapel (Tunnel/Diorama) + M-Taste im Prologue (11).~~ <!-- ERLEDIGT: StageMovementBehavior-Bereinigung vor erneutem Anfügen implementiert (Dave) -->
5. ~~Showcase 13 `_time` erhöhen; kaputte `next`/`prev`-Links (12).~~ <!-- ERLEDIGT: _time Inkrementierung in Showcase 13 und bidirektionale Navigation über alle Showcases repariert (Dave) -->
6. ~~`pbr.sh` `eval`/Python-Injection; `sync-tools.js`/`sync-templates.js` löschen; `update-version.js` Fail-Fast + nicht fremde Änderungen stagen (14). `npm run changelog` und `build-demo` bereinigen.~~ <!-- ERLEDIGT: eval/Injection behoben, Sync-Skripte gelöscht, update-version gehärtet und auf Projektdateien beschränkt -->
7. ~~Maker: Projekt-Laden ohne Smart-Spawn/Undo-Spam; Legacy-Namensfilter durch Version/Migration ersetzen; Farb-Edits → Autosave; Marquee ohne Grid; Delta-Snap bei Multi-Select (09).~~ <!-- ERLEDIGT: loadProjectObjects ohne Smart-Spawn/Undo, Schema-Version 2 Migration für Legacy-Objekte, Autosave bei Farb-Edits (Dave) -->
8. ~~`ContactSolver` Pair-State-Leck; Sweep-Austritts-TOI (`tmin < 0 → −1`); Akkumulator verwerfen; Pair-Key (07).~~ <!-- ERLEDIGT: _sweepRayBox fängt tmin < 0 / Initial-Overlap ab; Akkumulator-Rest bei maxSubSteps per Modulo verworfen; pairKey: bigint exportiert und konsolidiert; ContactSolver Pair-State Pool-Leck behoben; OBB.clone _localCenter kopiert -->
9. ~~`TurbulenceAffector`-Zeit, `PointAttractor`-ε², `FadeOutZone`-Größe, `Vortex`-Achse (13). `OilPuddle` Klonen statt Referenz (13).~~ <!-- ERLEDIGT: Affector-Mathe und Zeit-Akkumulation korrigiert, OilPuddle Look-Presets geklont, Deep-Tests auf eps^2 angepasst -->
10. ~~`DynamicReflectionProbe:83`; try/finally bei Probe/Planar-Restore (03).~~ <!-- ERLEDIGT: Parent-Check !this.parent || this.parent === scene.root || this.parent.parent === undefined schützt scene.root; try...finally stellt Sichtbarkeit, Render-Target und MathPool-Vektoren sicher wieder her (Bob) -->
11. ~~WebGPU-Kapazitäten (Instanz-Dummy-Buffer, Lights, Bones) mit Fail-Fast statt Validierungsfehler (02).~~ <!-- ERLEDIGT: ensureDummyBufferSize(instanceCount) übergeben; Fail-Fast für instanceCount < 0, Buffer-Größen, Bone-Kapazität (>2048) und Lights (>64 Point/Spot, >42 Area) in WebGPU, symmetrisch auch in WebGL2 und WebGL1 implementiert (Bob) -->
12. ~~Geometrie-Normalen/Winding: TriStar, Annulus, Tube, CutCylinder <!-- ERLEDIGT: TriStar Seitennormale/Winding, Annulus +Y Winding, Tube unshared Caps & UV-V Mirror, CutCylinder avgH Achse (Charlie) -->, Capsule-UV, Pyramid (06).~~
13. ~~glTF: `byteStride`, BYTE/SHORT, `normalized`, `extensionsRequired` → mindestens Fail-Fast (08). OBJ negative Indizes (08).~~ <!-- ERLEDIGT: glTF byteStride dichte Kopie, BYTE/SHORT/normalized Accessoren, extensionsRequired Fail-Fast und OBJ negative relative Indizes (Dave) -->
14. ~~Xtractor-Chips: nur explizite Syntax; `scaleImage`/Canvas-Größenobergrenzen; `rotateImage`-Winkel (10).~~ <!-- ERLEDIGT: nur explizite [TOKEN]-Syntax, Obergrenzen für scaleImage und Winkelvalidierung in rotateImage (Dave) -->

**Welle 1 — Architektur mit klarem ROI:** `BoundingVolume`-Schnittstelle; `RigidBodyMath` + Welt-Trägheit; `PairTracker`; Uniform-Layout-Quelle; `compileProgram`; Post-Element `packUniforms`; Instanz-Registry für Shader/Extensions (Singletons raus); `PlayerRig`; `AbstractShowcase`-Helfer; Maker `commit`/Keymap/`resolveTextureMaps`; `ParticleAffector`-Batch.

**Welle 2 — Große Refactorings (eigene ADRs):** Renderer-Zerlegung (`WebGPURenderer`, `WebGL2Renderer`, WebGL1-Manager-Schicht); `PostEffectPass`-Interface; Material-Lane-Tabellen + Shader-Chunks; Revolve-Generator; Collision-Kern; Maker-Zerlegung; Prologue-Timeline als Daten.

**Welle 3 — Hygiene:** Dead Code (`thresholdImage`, `hsvToRgb`, `BinaryStreamLoader`, `skybox.vert.wgsl`, `_scratchTransparentMap`, `isStatic`, DeviceCaps-Fassade, `audio`-Option, `ForgeToolOptions.initialState` …), Enums statt String-Unions, Seeds, Barrels/Zirkel, Docs (`maker/docs/log.md`, the-whisper-Log-Titel/Nummerierung, Dossier Showcase 22, App-Docs-Konvention für Showcases), `tsconfig`/ESLint für `scripts/*.ts`, CI (`test:decals`, `lint:wgsl`).

## 6. Offene Verifikation (bevor jemand daran arbeitet)
Folgende Befunde sind vom jeweiligen Agent als „unsicher" markiert und sollten vor einem Fix im Browser/Test bestätigt werden: Doppel-Rotation RMB-Orbit (09 #3); Tetraeder-/Lathe-Winding (13); HZB-Footprint (02 #9); Render-Listen-Cache stale (01 #5); Sheen/Emissive-`specColor` (02 #8); Kit-Inspector-Socket-Toggle (09 #8) und Pan-Mathe (09 #10); `ViennaMapModal`-Standort „AKTUELL" (11); `Frustum.setFromMatrix` bei `ZO_CORRECTION` (07); `BoundingSphere.transform`-Aliasing mit `obj.position` (07); Decals im Showcase 12 (`color.a` im Manifest); Offscreen-Target-Größe bei Light Shafts/Cluster-Cull (02/03); Compressed-Textures ohne Mip-Sampling (01 #23); ETC2-Annahme (13 #14); `AnimationMixer` CUBICSPLINE-Stride (05).
