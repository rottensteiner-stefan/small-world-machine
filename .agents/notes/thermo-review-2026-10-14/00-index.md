# Thermonukleares Code-Review der gesamten Codebasis — 2026-10-14

Stand: HEAD `ff3f3ab6` (Working Tree sauber). Vorgänger: `../thermo-nuclear-code-quality-review-2026-09-27.md`.

## Methode und Vertrauensgrad

- 15 Sub-Agents (Sonnet 5.5), jeder mit einem überschneidungsfreien Slice, Auftrag: **jede Datei des Slices vollständig mit dem Read-Tool lesen**, nur lesen (nichts geändert/committet), Tests und Binär-Assets ausgenommen. Standards: `.agents/skills/thermo-nuclear-code-quality-review-revised/SKILL.md`, `CLAUDE.md`, `coding-guide`.
- Vorläufer-Läufe (Diff-Review der Light-Shafts-Arbeit; drei Breit-Läufe mit Stichproben) sind in diese Berichte eingearbeitet, soweit sie Eigenes lieferten. Ein erster Breitlauf hatte „nur überflogen" gemeldet; das war eine Vorgabe im Prompt, kein technisches Limit. Der zweite Durchlauf (diese Berichte) hat alles vollständig gelesen.
- **Nicht von mir verifiziert:** Alle Befunde stammen aus den Agent-Berichten. Ausgeführt wurde nichts (kein Build, keine Tests, kein Browser). Zwei Verdachtsfälle wurden bereits widerlegt (siehe unten). Befunde mit „(?)" / „(unsicher)" sind vom jeweiligen Agent als nicht verifiziert markiert.
- Kontext: `typecheck`, `lint`, `npm run test` (277 Dateien, 1848 Tests) waren zu Beginn grün (selbst ausgeführt). `build:lib` und `lint:wgsl` nicht geprüft.
- Zeilennummern beziehen sich auf HEAD `ff3f3ab6`.

## Abdeckung (Slices)

| # | Datei | Slice | Zeilen (ca.) | Vollständig gelesen |
|---|---|---|---|---|
| 01 | `01-renderers-webgl.md` | renderers/WebGL1, WebGL2, core/*.ts (Top-Level) | 7.300 | ja |
| 02 | `02-renderers-webgpu-shaders.md` | renderers/WebGPU, passes, shaders, imposter, Top-Level | 10.600 | ja |
| 03 | `03-post-decals-culling-lights.md` | renderers/post, core/decals, culling, lights, reflection, sky | 7.253 (65 Dateien) | ja (vollständiger Bericht) |
| 04 | `04-core-materials.md` | core/materials | 8.600 | ja |
| 05 | `05-core-rest.md` | core/behaviors, cameras, input, textures, controllers, animation, colors, showcase, stage, text, objects, helpers, threading, fsm, events, sprites, forge | 8.400 | ja |
| 06 | `06-geometry.md` | engine/geometry | 8.400 | ja |
| 07 | `07-physix-math.md` | engine/physix, math | 9.900 | ja |
| 08 | `08-loaders-audio-utils.md` | loaders, audio, utils, interfaces, enums, behaviors, environment | 7.600 | ja |
| 09 | `09-tools-maker-kit-inspector.md` | tools/maker, kit-inspector | 7.800 | ja |
| 10 | `10-tools-common-and-others.md` | tools/common, material-studio, xtractor, ibl-gen, forge, Pixler, Xtractor, MapGenerator | 11.300 | ja |
| 11 | `11-apps-whisper-yad-lca.md` | sample-apps the-whisper, yad, light-cycle-arena | 9.300 | ja |
| 12 | `12-showcases.md` | showcases 1–38 + presentation + decal-probe | ca. 21.800 | ja |
| 13 | `13-extras-packages.md` | geometry-/liquid-/vfx-/gltf-/physics-extras | 6.400 | ja |
| 14 | `14-scripts-and-config.md` | scripts/**, package.json, tsconfig, eslint, vite, Makefile | 6.600 | ja |
| 15 | `15-cross-cutting-and-roadmap.md` | Übergreifende Muster, Singleton-Liste, Judo-Züge, Sanierungsreihenfolge | — | — |

Nicht gelesen (bewusst): Binär-Assets, `Sponza.gltf`/`.bin`, vendored `basis_transcoder.js/.wasm`, Tests, Golden-PNGs, Lizenztexte.

## Widerlegte / korrigierte Verdachtsfälle

- **Shader-ID-Kollision `OilPuddleMaterial`: widerlegt.** App-Klasse in `apps/showcases/12/assets/OilPuddleMaterial.ts` nutzt Typ und Shader-ID `"OIL_PUDDLE"` (`:188,216`), `liquid-extras` nutzt `"OilPuddleMaterial"`. Offen bleibt: gleicher Klassenname, und `registerMaterialShaderProvider` ist „first wins" ohne Warnung (siehe 04/13/15).
- **Geometrie-Leck `TeleportSpawnerBehavior` (Showcase 12): im Kern widerlegt.** `Object3D.remove` → `Scene._pendingRemovals` → Renderer `_releaseObjectResources` → `GPUGeometryCache.releaseGeometryFor` gibt Puffer frei. Übrig bleibt Allokations-Churn (neue Sphere pro Spawn).
- **Showcase 10 als „Zerlegungsvorbild": nur halb berechtigt** (Daten/Layout/Props gut getrennt, aber `showcase.ts` 817 Zeilen God-Class mit Sonderfällen pro Preset-Key).

## Top-Befunde auf einen Blick

Details und Fundstellen in den Teildokumenten; priorisierte Sanierungsreihenfolge in `15-cross-cutting-and-roadmap.md`.

**Korrektheit / sichtbar falsch**
1. Light Shafts: intensity² (alle Backends), color² (nur WebGPU), Depth-Threshold 0.05 auf nichtlinearer Tiefe (03).
2. `Frostglass.frag.wgsl:24-25` skaliert Normal-Map mit Pulse-Lane (04).
3. GLSL100 Glass/Frostglass: Mesh-UV als Screen-UV (04).
4. Fog/Tonemapping/Farbraum/Alpha-Test je Shader und Backend uneinheitlich (04, 02).
5. Physik: nicht rotierte Trägheit, Sweeps mit Austritts-TOI, Pair-Key-Präzision, Akkumulator ohne Verwerfen, Pair-State-Leck (07).
6. glTF-Loader: `byteStride`, BYTE/SHORT, `normalized`, `extensionsRequired` ignoriert → still falsche Geometrie (08).
7. Geometrie: falsche Normalen/Winding in TriStar, Annulus, Tube, CutCylinder, Capsule-UV, Pyramid (06).
8. WebGL2-Shadow-Pass ignoriert Skinning/Instancing (01).
9. DynamicReflectionProbe: `parent instanceof Scene` immer false (03).
10. Maker: Projekt-Laden verschiebt Objekte + Autosave schreibt zurück; Legacy-Namensfilter löscht User-Objekte (09).
11. Doppeltes `scene.update()` pro Frame in prologue, flakturm-tunnel, Showcases 1/16/17/18 (11, 12).
12. `TurbulenceAffector`: Zeit läuft mit Partikelzahl (13).

**Sicherheit / Datenintegrität**
- `pbr.sh` `eval` + Python-Triple-Quote-Injection (14); `sync-tools.js` destruktiv (14); `update-version.js` staged bei jedem Commit (14).
- `innerHTML` mit Kit-Daten in `ContentDrawer` (09); ungeprüfte Ingest-Größen (10).

**Architektur**
- Globale Singletons (Mehrinstanz-Regel), Content im Engine-Kern, God-Dateien (>1000 Z.), dreisprachige Shader-Duplikate, Magic-Number-Layouts (15).
