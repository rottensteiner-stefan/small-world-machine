# Log — YAD

> Entwicklungslog für die YAD App.

---

## 1. Renderer-Override wie bei den Showcases; Smoke-Test prüft YAD unter allen drei Backends (2026-10-13)

- **Anlass:** Im CI-Smoke-Test schlug `yad` als einziger Check außerhalb der WebGPU-Legs fehl (`[WebGPU Device Lost]`, `Instance dropped error in getCompilationInfo`). Ursache: `App` erbt direkt von `SmallWorldMachine` und kannte kein `?rendererType=`; im Runner ohne GPU nahm `yad` deshalb den „besten" Renderer, also WebGPU (Software), und lief in denselben Fehler wie die WebGPU-Legs der Showcases. Per Probe bestätigt: ohne Override läuft `yad` auf WebGPU, mit `WEB_GL1`/`WEB_GL2`/`WEB_GPU` auf dem verlangten Backend.
- **Änderung:** `App` liest `?rendererType=` über `getRendererTypeFromQuery()` (jetzt aus `AbstractShowcase.ts` exportiert), Standardverhalten ohne Parameter unverändert. `scripts/check-showcases.js` prüft `yad` unter WebGL1, WebGL2 und WebGPU (vorher einmal mit dem Standard-Renderer). Mit `SHOWCASE_SKIP_WEBGPU=1` (CI) bleiben GL1 und GL2.
- **Verifikation:** lokal alle drei Backends OK (Metal-GPU). Auf einem echten Runner noch nicht gelaufen; die WebGPU-Software-Fehler selbst (alle WebGPU-Legs im Runner) sind eine Umgebungsgrenze und hier nicht behoben.

## 2. Visuelles Konzept-Dossier erstellt (2026-10-21)

- **Anlass:** Gemäß App-Docs-Konvention (`.agents/notes/app-docs-convention.md`) fehlte für YAD ein detailliertes visuelles Konzept-Dossier.
- **Änderung:** `apps/sample-apps/yad/docs/concept-dossier.html` ausgearbeitet:
  - Hero mit Retro-VGA-320x200-Fokus und Multi-Backend-Unterstützung (WebGPU, WebGL2, WebGL1).
  - Design-Säulen: 90er-Jahre Grid-Crawler, ASCII-LevelBuilder (`level1.txt`), dynamische Lavasimulation (`FluidSurfaceMaterial`), diskrete Panzersteuerung (`GridMovementBehavior`).
  - Textur- & Farb-Bibel: Farbfelder für Blood Red, Molten Lava, Dungeon Brick, Toxic Slime, Castle Slate und CRT Void.
  - Interaktives Level-Architektur-Diagramm mit vollständiger ASCII-Symbollegende (`W`, `G`, `+`, `P`, `E`, `~`, `b`, `l`, `1/2/3`, `O`).
  - Technische Engine-Integrationstabelle (`FPSCameraController`, `BoundingBox`, Textur-Streaming, QuantizeElement).
  - Status & Roadmap (Next Steps: Turn-based Combat, Fog of War, dynamische Item-Pickups).
- **Verifikation:** Standalone im Browser und über Vite unter `http://localhost:5173/apps/sample-apps/yad/docs/concept-dossier.html` geprüft.

