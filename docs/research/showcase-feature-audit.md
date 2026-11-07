# Showcase & App Feature Audit — Wunschliste & Bestand

**Ursprünglich:** 2026-08-20 — Feature-Inventur über alle damaligen Showcases (`apps/showcases/1`
bis `apps/showcases/26`) und die damaligen 4 Apps (`src/apps/disc-wars`, `src/apps/light-cycle-arena`,
`src/apps/neon-labyrinth`, `src/apps/yad`): welche Engine-Features (Materialien, Lichter,
Post-Processing, Geometrie, Physik, Behaviors, Kamera-Strategien) wo genutzt werden, und welche
implementierten Features nirgends gezeigt werden.
**Umbau:** 2026-09-27 — die Inventur wurde gegen den Live-Code verifiziert; die Lückenanalyse ist
unten als pflegbare **Wunschliste** (F1–F9) konsolidiert. Seither geschlossen: `HbaoElement`
(#27/#29/#32), `Line`-Geometrie (#6). Die vollständige historische Feature-Matrix (Stand
2026-08-20) ist im **Referenz-Anhang** am Ende erhalten, inklusive der inzwischen gelöschten Apps.

> **Hinweis:** `docs/research/` ist ein Point-in-time-Bereich. Diese Datei wird zugleich als
> Wunschliste gepflegt; der Abgabestand („erledigt") ist anhand des Live-Codes verifiziert (Stand
> 2026-09-27, per word-boundary-`grep` über `apps/` und `packages/engine/src/`) und muss bei neuer
> Nutzung eines bisher ungezeigten Features aktualisiert werden (✅/🟡/🔍 gemäß Konvention,
> niemals gelöscht). Die historische Matrix im Anhang wird nicht nachgepflegt.

---

## Wunschliste — implementierte, aber nie gezeigte Engine-Features (pflegbar)

| # | Feature | Status (2026-09-27) | Aufwand | Hinweis |
|---|---|---|---|---|
| F1 | **`AreaLight`** — einziger Licht-Typ ohne jede Verwendung (0 Treffer in `apps/`; Klasse existiert unter `packages/engine/src/core/lights/AreaLight.ts`). | 🔍 offen | mittel | Braucht einen eigenen Showcase (flächige Glow-Flächen); Engine-Cap `MAX_AREA_LIGHTS` ist im Quelltext dokumentiert. |
| F2 | **`FluidVolume`** (Auftrieb/Strömung/Widerstand-Physik) — 0 Treffer in `apps/`; nur unit-getestet. | 🔍 offen | mittel | #12 Öl-Pfütze ist ein reiner Shader-Trick, keine echte `FluidVolume`. |
| F3 | **`TaaElement`** (Post-Processing) — 0 Treffer in `apps/` (Basis `HistoryBlendPassGL/GPU`). | 🔍 offen | klein | Kandidat, um den TAA-Trade-off eines echten TAA zu zeigen; auch Vorstufe von W5 in `aaa-engine-techniques.md`. |
| F4 | **`MotionTrailElement`** (Post-Processing) — 0 Treffer in `apps/`. | 🔍 offen | klein | Nicht mit `TrailRendererBehavior` (#23) verwechseln — das ist ein Mesh-Trail, kein Screen-Space-Effekt. |
| F5 | **`OscillatorBehavior`** — 0 Treffer in `apps/`. | 🔍 offen | klein | Trivial zu demonstrieren (z. B. Bühnen-Requisten in Diorama-Showcases). |
| F6 | **`StateMachineBehavior`** (Behavior-Wrapper um FSM) — 0 echte Nutzung; einziger `apps/`-Treffer ist ein „Deliberately not"-Kommentar in `apps/sample-apps/light-cycle-arena/core/CycleAI.ts`; die rohe `StateMachine` wird nur in #15 echt genutzt (#16 importiert sie, aber der Update-Call ist auskommentiert). | 🔍 offen | klein | Guide `docs/guides/state-machines.md` existiert bereits. |
| F7 | **`CameraStrategyType.FIXED`** — einzige der 7 Kamerastrategien ohne Verwendung. | 🔍 offen | klein | Prüfen, ob bewusster Verzicht oder schlicht fehlender Anwendungsfall. |
| F8 | **CCD** (Continuous Collision Detection, nur Kugeln — ADR 0005) — nie bewusst demonstriert; einziger Treffer in `apps/sample-apps/light-cycle-arena/core/ArenaGrid.ts` erklärt explizit den Verzicht. | 🔍 offen | mittel | Zusammen mit F9 ein sinnvoller Physik-Showcase. |
| F9 | **`BoundingType.OBB`** — nie gezeigt (0 Treffer in `apps/`); `Ray`/`Raycaster`-OBB-Unterstützung existiert seit 2026-09-18 (Review MIN-05). | 🔍 offen | klein | Guardian-/Treffer-Test naheliegend; Basis vorhanden. |

**Kein echter Gap, zur Einordnung:** `DepthMaterial` und `SynthSFX` sind absichtlich rein intern
(Shadow-Passes bzw. `AudioSystem`-Implementierungsdetail) — die tauchen zurecht nirgends direkt auf.

---

## Bewusst geschlossen (nicht mehr offen)

- **`HbaoElement`** — aus der Lückenliste entfernt: wird inzwischen in Showcase 27, 29 und 32
  tatsächlich aktiviert und genutzt (verifiziert 2026-09-27).
- **`Line`-Geometrie** — aus der Lückenliste entfernt: wird inzwischen in Showcase 6 direkt
  instanziiert (`apps/showcases/6/showcase.ts`, „Line"-Primitive der Geometrie-Galerie).
- **`Terrain`-Geometrie standalone** — nur indirekt über `TerrainManager` (#4) genutzt; direkte
  `new Terrain(`-Aufrufe existieren nur in der Factory selbst (`packages/engine/src/geometry/Terrain.ts`).
  Bewusst kein eigener Wunschlisten-Punkt (Chunking-Demo deckt das Subsystem ab).

---

## Fester Bestand (umgesetzt, verifiziertes Referenzklima)

> Die 1:1-Matrix der Showcase-Feature-Nutzung ist historisch (Stand 2026-08-20) und im
> Referenz-Anhang erhalten. Nummerierungs-/Struktur-Fakten, die seither unvermeidbar gealtert
> sind und für Interpretationen des Anhangs wichtig bleiben, sind hier amtlich festgehalten —
> abgeglichen gegen den Live-Code (2026-09-27):
>
> - Die Showcase-Kollektion ist von 26 auf **37** angewachsen: `apps/showcases/1` bis `38`
>   (numerierte Ordner, ohne #25).
> - Apps liegen jetzt unter `apps/sample-apps/<app>/`; erhalten: `light-cycle-arena`, `yad` (das Spiel lebt in einem eigenen Repo). Entfernt: `disc-wars`, `neon-labyrinth` (siehe
>   `CHANGELOG.md`).
> - Muster-Befund **bleibt strukturell gültig**: auch heute nutzt nur eine Minderheit der
>   Showcases `RigidBody`+`PhysicsSystem` (historisch 3 von 30: #21, #22, #23); der Rest baut
>   Physik pro Showcase händisch nach — weshalb CCD und `FluidVolume` (F8/F2) keine eigene Bühne
>   bekommen. Ein Voll-Re-Audit der aktuellen 37er-Matrix ist bewusst kein Pflichtthema dieser
>   Datei, sondern wäre ein separates Research-Vorhaben (siehe `.agents/notes/backlog.md`).

---

## Referenz-Anhang — historische Feature-Matrix (Stand 2026-08-20, unverändert)

> Punkt-in-time-Schnappschuss der ursprünglichen Inventur. `disc-wars` und `neon-labyrinth`
> existieren nicht mehr, Apps lagen damals unter `src/apps/<app>/`. Wird nicht nachgepflegt —
> Faktquelle ist der Live-Code bzw. die Wunschliste oben.

| # | Fokus | Materialien | Lichter | Post-FX | Physik | Behaviors/Controller | Kamera | Besonderheit |
|---|---|---|---|---|---|---|---|---|
| 1 | Hello World | Phong, Lambert | Dir(Schatten), Amb | — | — | OrbitController | SMOOTH | einfachster Showcase |
| 2 | FPS + Zufallsboxen | Phong, Wireframe | Dir, Amb | — | — | FPS, Zoom | FPS | `Color.fromHSL` |
| 3 | OBJ-Loading | Phong(OBJ/MTL), Wireframe | Dir, Amb | — | — | Orbit | SMOOTH | UV-Offset-Farbwechsel |
| 4 | Infinite Terrain | TerrainMaterial, Phong | Dir, Amb | — | Octree | WASD | SMOOTH | `TerrainManager`-Chunking |
| 5 | Grid-Taktik | Phong, Wireframe | Dir, Amb | — | — | keine | ISOMETRIC | manuelles Grid-Snap |
| 6 | Geometrie-Galerie | Standard, Wireframe | Amb, Dir | — | Octree | FPS, Zoom | FPS | fast alle 21 Primitive |
| 7 | Skybox (Cubemap) | Skybox, Phong | Amb, Dir | — | — | FPS, Zoom | FPS | Cube-Map-Himmel |
| 8 | Skydome | Phong | Amb, Dir | — | — | FPS, Zoom | FPS | Sphären-Himmel vs. #7 |
| 9 | 2.5D Jump&Run | Phong, Basic | Amb, Dir | — | handgeschrieben (AABB) | keine | STIFF | Pixelart, kein Engine-Physics |
| 10 | Lavaschalen | Basic, World, FluidSurface | Amb, Dir, Point x2 | — | — | FPS, Zoom | FPS | `FluidSurfaceMaterial` |
| 11 | Koordinatensystem | Basic, Wireframe, Sprite | Point, Amb | — | — | Orbit | HYBRID_SYNC | Canvas-Text-Sprites |
| 12 | U-Boot-Frachtraum | Standard, Phong, Glass, OilPuddle(lokal) | Amb, Dir(CSM), Spot x3, Point | Vignette, Grain | Octree | Flicker, Proximity, Pulsating + 3 lokale | FPS | WGSL-Ripple, `GearMath` |
| 13 | PBR + glTF | Skybox, Standard | Amb, Dir x2 | Bloom | — | FPS | FPS | `GltfLoader`, erzwungenes WebGPU |
| 14 | 8x Verhörraum | Standard, Glass | Amb, Spot, Point (x8) | ToneMapping(3), Vignette, Grain, Bloom, `filterMode`(7 Looks) | — | keine | MANUAL | 8 Engine-Instanzen parallel |
| 15 | Springende Bälle | Standard, Skybox | Amb, Dir, Point | — | handgerollt | FPS | FPS | Planar+Dynamic Reflections, FSM, InstancedMesh |
| 16 | PBR-Referenz/IBL | Skybox, Standard(envMap) | Amb, Dir(Schatten), Point | — | — | FPS | FPS | volle IBL; FSM importiert aber inaktiv |
| 17 | ThreadPool (Primzahlen) | Standard | Dir | — | — | keine | — | Worker-Demo |
| 18 | ThreadPool (Terrain) | Standard | Dir | — | — | keine | — | `ModelGeometry` aus rohen Buffern |
| 19 | 1600-Cube-Grid | Standard | Amb, Dir(Schatten) | — | Octree (1600 statisch) | Hover, Draggable, Click | — | Interaktions-Stresstest |
| 20 | Tron-Ästhetik | Basic(HDR), Standard(HDR) | Amb, Dir, Spot | Bloom | — | Bobbing, Rotator, Rainbow, SpringLerp, PathFollower, LookAt, Flicker | SMOOTH+Orbit | CatmullRom-Spline, 7 Behaviors kombiniert |
| 21 | Plinko | Glass, Standard | Amb, Dir | Bloom | RigidBody+PhysicsSystem | Orbit | — | generative Musik aus Kollisionen |
| 22 | Akkretionsscheibe | Standard | Amb, Dir | Bloom + `filterMode:8` | RigidBody+PhysicsSystem (+ manuelle N-Body) | Orbit | HYBRID_SYNC | DeviceCaps-Performance-Tiers |
| 23 | Marble Run | Standard, CustomShader | Amb, Point x3 | unklar | RigidBody+PhysicsSystem (Sensor-Bodies) | Hover, Rotator, Bobbing, EmissivePulse + Marble-/DroneController | manuell | Trail-Drohnen, Pickups |
| 24 | Shader-Galerie | CustomShader x8 (Shadertoy/GLSLSandbox/ComputeToys), Wireframe | Dir x2, Amb | unklar | Raycaster | ExternalShaderUniform, FPS + 3 lokale | FPS | Laufzeit-Vertex-Verformung |
| 25 | Open Water | OpenWaterMaterial | Dir | — | — | Orbit | HYBRID_SYNC | reinste 1-Material-Demo |
| 26 | Retro-Monitor | RetroScreenMaterial | keine | — | — | Orbit | HYBRID_SYNC | `TextTexture` Live-Boot-Screen |
| disc-wars | Disc-Combat (Phase-1-Slice) | Standard, GridWallMaterial(lokal) | Amb, Spot | Bloom | Octree | EmissivePulse | FPS | Shockwave-Shader, `MazeGenerator` |
| light-cycle-arena | Tron-Duell | Standard, Wireframe | Amb | Bloom | bewusst kein PhysicsSystem (ArenaGrid) | GridMovement | ISOMETRIC | Zeitverzerrungs-Mechanik |
| neon-labyrinth | Multi-Floor-Parkour | Standard, Frostglass | Amb, Spot, Point | Bloom | Octree, handgerollt | Rotator, Bobbing, Proximity, SquashStretch + lokale | FPS | Frostglas-Sichtbarkeit, Void-Catch, Hit-Stop |
| yad | Retro-Dungeon-Shooter | Standard, Sprite, FluidSurface | Amb, Dir, Point | Quantize | SpatialHash+Collision+Raycaster | Bobbing, Proximity + EnemyBehavior | FPS+Zoom | `GridLevelBuilder`, TextureArray, 3D-Audio |

**Historisches Befund-Muster:** Nur 3 von 30 (Plinko #21, Akkretionsscheibe #22, Marble Run #23)
nutzten überhaupt `RigidBody`+`PhysicsSystem` — „nur 3 von 30" bezog sich auf die damalige
30er-Gesamtzahl inkl. Apps. Der Rest baute Physik pro Showcase händisch nach (Q&A im Backlog zur
Einordnung).
