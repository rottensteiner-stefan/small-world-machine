# BIG MERGE — Umsetzungsplan (Konsens, 4/4)

> **Session:** `big-merge` (`collaborate`, Modus `plan`) · **Status:** CONSENSUS (2026-10-13)
> **Board/Provenance:** `.agents/collaborate/big-merge.board.jsonl` (21 Events, Proposal P1, Findings F1–F6)
> **Abstimmung:** 4/4 AGREE auf P1 (Alice, Bob, Charly, Dave) — alle Kritik-Auflagen F1–F6 sind als **verbindliche Plan-Anforderungen** eingearbeitet.
> **Sprache:** Deutsch (Moderator), präzise Datei/Zeilen-Referenzen; Engineering-Begriffe englisch (Skill-Konvention).
> **Dies ist erst der Plan.** Erst nach Freigabe beginnt die Umsetzung (phasenweise, jeder Meilenstein eigenständig grün).

---

## 1. Ziele & Nicht-Ziele

### Pflichtziele (Phase A, nicht verhandelbar)

- **G1 — Ein Werkzeug:** Alle Autoren-Werkzeuge (Maker, Xtractor, Pixler, Map Generator, Material Studio/PBR-Gen, IBL-Gen, Kit-Inspector, Splatter-Gen) verschmelzen zu **einer Anwendung** („Maker"). Keine separaten App-Roots mehr.
- **G2 — Dual-Interface aus demselben Kern:** Die domain-logische Ebene wird als **framework-agnostischer Headless-Core** (reines TS, ohne harte DOM/GL-Abhängigkeit) extrahiert und von **Web-UI und CLI gemeinsam** konsumiert. Keine doppelte Logik.
- **G3 — Echte, pragmatische CLI (`swm`):** Kommandozeile über `bin` in `@small-world-machine/tools` + Root-npm-Skript-Wrapper, die denselben Kern headless bedient. Die CLI bildet **bewusst nur die sinnvolle Teilmenge** ab (kein TUI, keine Viewport-Features wie Gizmos) — explizit dokumentiert, was und warum nicht abgebildet wird.
- **G4 — Web bleibt die schöne Hauptfläche:** integrierte, keyboard-getriebene Power-User-UX (C8). Alle bisherigen `public/tools/*.html`-URLs funktionieren weiter (als Entry-Aliases, s. §5.2). `attachDevTools`/Forge (In-Game) bleiben unverändert.
- **G5 — Keine Regression, migrationssicher:** `@small-world-machine/tools` bleibt 1-Weg-Abhängigkeit von `@small-world-machine/engine` (ADR 0024). Bestehende Tool-Tests + E2E-Harnesses bleiben grün; historische Log-/CHANGELOG-Einträge bleiben erhalten.
- **G6 — Inkrementell & reviewbar:** Meilensteine M1–M6, jeder einzeln mergebar und grün (lint/build/test/typecheck) — kein Big Bang.

### Nicht-Ziele (bewusst ausgeschlossen)

- Keine interaktive TUI-Spiegelung des Editors.
- **Gamepad-Test** (`gamepad-test.html`) bleibt dauerhaft separat (reines Hardware-Diagnosewerkzeug).
- **Splatter-Seite** bleibt dauerhaft als eigenständige Seite; nur ihr Algorithmus wird als `SplatterCore` für die CLI extrahiert.
- Kein GLB-Container-Writer in Phase A (nur `.gltf` mit Data-URIs; GLB-Packer als Backlog-Item, nicht als ADR).
- Kein neuer nativer Codec (kein `@napi-rs/canvas`/`sharp`) in Phase A; PNG-first-Kontrakt.
- Keine Löschung der Vite-Inputs/`js/tools/*.js`-Ausgaben in dieser Migration (M7 „Input-Deletion" ist explizit **Nicht-Ziel**).
- Keine Änderungen am Engine-Render-Pfad selbst.

---

## 2. Zielarchitektur (D1/D2 — Konsens)

### D1 — Merged-App-Shell: „Maker-Host-Shell" via dediziertem `ToolMode`-Lifecycle

Der Maker wird die **eine Anwendungsshell**. Jedes Werkzeug wird ein **`ToolMode`-Modul**, registriert in einem modusgetriebenen Host:

- **Basisvertrag für Modi ist ein neuer `ToolMode`-Lifecycle** (mount/unmount/state), **nicht** `ForgeTool`. Begründung (Finding F3): Die Konstruktions-Signaturen der Werkzeuge sind nicht einheitlich (`attachDevTools.ts:23-31`: `new MapGenerator()` without deps, `new Pixler(app.events)`, `new Xtractor(app.events)`, `new MaterialStudio()`), und `ForgeTool` ist ein Overlay-über-Game-Canvas-Vertrag (`forge/Forge.ts:39-87`). `ForgeTool` **bleibt strikt in-game**.
- **Gate F3:** In keinem Meilenstein dürfen gleichzeitig `attachDevTools.ts` geändert _und_ Tool-Konstruktor-Signaturen geändert werden — die In-Game-E2E (`forge-tools-e2e.mjs`, `xtractor-forge-e2e.mjs`) hängt an den Forge-Fenstern in `apps/showcases/19/index.html` und berührt `public/tools/*.html` nicht.
- **Undo-Scope: pro Tool & pro Dokument, nie global.** (Maker `UndoStack` ist auf 50 begrenzt, `maker/UndoStack.ts:19,34-46`; Pixler hat Bitmap-Historie `Pixler.ts:933-952`.) Keine globale Undo-Schiene bauen.
- **Ein Projektordner pro Session:** ja — gemeinsamer Workspace-Root; Werkzeuge bekommen Unterstruktur `assets/` analog `ProjectBinding`-Abstraktion. **Domain-Folge: neuer Begriff „Project/Workspace" in CONTEXT.md + ADR-0010-Amendment (§3/§4)** (Finding F6; CONTEXT.md kennt heute keinen Projektbegriff).
- **Gemeinsamer Ingest:** ja — bestehende `common/io`-Schiene (`UniversalIngestRouter`, `UnifiedIngestPanel`) wird die eine Eingangsader.
- **Tastatur-Routing:** ein Keybinding-Kontext-Router mit **Per-Mode-Scopes** (C8). Marker-Ansatz mit `isActiveToolHost`-Muster (heute schon `Xtractor.ts:429`, `Pixler.ts:774`).
- **Xtractor→Pixler-Handoff:** bleibt eventbasiert über `ToolEvents.Pixler.LOAD_BASE64` (`Xtractor.ts:529-534`, `Pixler.ts:449-456`), jetzt app-intern.
- **Ressourcen-/GL-Budget:** Modi werden **lazy je Erst-Entry konstruiert** und **beim Mode-Exit zerstört**; hartes Budget **≤ 2 gleichzeitig lebende 3D-Surfaces** (primärer Editor-Viewport + höchstens eine Sekundär-Vorschau, MaterialStudio-Sandbox XOR Kit-Viewer). IBL-Bake läuft als Subprozess und konkurriert nie ums Fenster-GL. Werkzeuge implementieren heute schon Destroy-on-Unmount (`MaterialStudio.ts:203-211`; `Xtractor.ts:51-55`) — der Wrapper standardisiert nur Bestehendes.

**Abgewogene Alternativen (verworfen):**
- **1B Neutrales „Studio-Host"** (Maker nur Mode): sauberste Marke, aber höchster Re-Skin-Aufwand — für Phase A kein Mehrwert.
- **1C iframe/Tab-Launcher:** schnellste, aber schwächste Vereinfachung (kein geteilter Ingest/Undo/Tastatur; kein G2-Gewinn) — kein guter G6-Heber.
- **1D Forge-Dock als Host:** als **Fallback** vorgehalten, falls die Panel-Verschmelzung für die Vollbild-3D-Tools zu invasiv wird. Primär nicht gewählt, weil Fenster-in-Fenster kein echter Editor-Shell-Look ist und die Modus-Tastaturgeschichte schwächer ist.

### D2 — Headless-Core: „Pure-Ops-Slices" + `core/pipeline/`

**Verschmelzung der Extraktion (Route 2A, gescoped auf die 2D-"Ops-Facade"):** Es werden **nur die reinen Daten-Transform-Slices** extrahiert; die interaktiven State-Machines (Gizmo-Loop, Selektion, Drag) bleiben in `ui/`. Die CLI-wertige Schnittmenge ist Datentransformation (Crop/Slice/Pixelops/ASCII↔Geometrie/PBR-Ableitung/IBL-Bake/Kit-Validierung), nicht Viewport-Feeling (C6).

**Extrahierte Kernmodule (Phase A):**
- `core/sprite/` — aus `Xtractor` (basiert auf `CanvasOps.ts` + `SmartSegmentation.ts`): crop/autocrop/flip/pad (`CanvasOps.ts:99,127,159,256`) + Sprite-Erkennung (`detectSpriteBounds`).
- `core/pixler/` — nur Datenops (floodFill/flip/trim/pan auf RGBA), keine Toolbar-Logik.
- `core/map/` — ASCII↔`GridLevelBuilder` (`engine/geometry/procgen/GridLevelBuilder.ts:62`) → `WorldWriter` (glTF, `engine/.../WorldWriter.ts:40-63`, Data-URI-Buffer `:207`); reine Pixel-Quantize-Pipeline.
- `core/material/` — `MaterialMapPipeline`: alle 7 PBR-Ableitungen aus `common/dsp/TextureFilters.ts` (`:127-350`) + Presets; Modulkern aus `MaterialStudioController.ts:636-663`.
- `core/ibl/` — bereits headless vorhanden: `ibl-gen-core.ts` (browserfrei, deterministisch, Node-Crypto-Vorgänger `ibl-gen-core.ts:4-11`) — **das validierte Template**.
- `core/kit/` — `KitManifestValidator` (existiert, `common/io/KitManifestValidator.ts`), Verzeichnis-/Zip-Walk, Report.
- `core/splatter/` — `SplatterCore` **neues Modul** (seed→ImageData, deterministisch), Port aus Inline-Script `public/tools/splatter-gen.html:563-1259`. Kein Totalabzug vor Port (F: „neu geschrieben, nicht extrahiert").
- `core/pipeline/` + `RasterIO` — gemeinsame Infrastruktur.

**Grenzregeln (verbindlich, werden CI-geprüft):**

1. **Core = reines TS + Engine-Imports only.** Keine `document.`/`window.`/`HTMLElement`/`HTMLCanvasElement`/GL-Typen auf Modulebene (C3 bleibt 1-Weg).
2. **CI-Grep-Gate (Finding F1):** `getContext|document\.|window\.` → **0 Treffer unter `packages/tools/src/core/`** in lint/CI.
3. **RasterIO/ImageCodec-Interface (Finding F5):** Core dekodiert nie selbst. Alle Bilddaten fließen als RGBA-Fixtures durch eine `RasterIO`-Schnittstelle — pngjs-Adapter (Node) + `createImageBitmap`/`Image`-Adapter (Web). Grund: Browser-Dekodierung ≠ pngjs-Dekodierung (Farbräume/Gamma/Premultiplication), sonst bricht „gleicher Kern, gleiches Ergebnis" an der Codec-Grenze (`Xtractor.ts:401-412`, `Pixler.ts:1063-1075` sind Browser-Decode; pngjs liest roh).
4. **Purge `MapGenerator.loadFromImage` (Finding F1):** nutzt noch `ctx.drawImage`+`getImageData` (`MapGenerator.ts:608-615`); reines Downscaling nötig, weil `CanvasOps.scaleImage` nur nearest-neighbor ist (`CanvasOps.ts:228-251`) und semantisch nicht gleichwertig. Vor „Extraktion fertig" auflösen; Web-Panel auf denselben Kernel zeigen.
5. **Determinismus auf RGBA-Fixtures testen, nicht auf PNG-Bytes** (F5); pure Ops sind deterministisch (IEEE-754, pngjs-Encoder deterministisch), die Codec-Grenze nicht.
6. **Canvas/GL nie im Core:** Raster hinter `RasterIO`, GPU-Schritte hinter `gpu/`-Adapter (Browser bzw. Headless-Chrome 3B).
7. **`Maybe`-Namensraum:** `packages/tools/src/core/<tool>/<ops>.ts` + `ui/<tool>/…`; bestehende Barrels re-exportieren kompatibel (G5). Kein `any` (C1).

**Beweisbar headless heute** (Kern extrahierbar ohne Verhaltensänderung): `ibl-gen-core` (Node-Vorgänger), `common/io` (45 Tests), `common/dsp`+`common/image` (reine Buffer-Ops), `ProjectBinding` (`ProjectBinding.ts:20-38` — FS-Access-Handle-Typen für Injektion), `UndoStack`, `MapGenerator`-ASCII (`MapGenerator.ts:466-493`).

---

## 3. Headless-/CLI-Kapitel (D3/D4 — Konsens)

### D3 — Laufzeitstrategie: „Pure-TS first, Browser-Subprozess nur wo erzwungen"

1. **Node-CLI = reines TS über RGBA-Puffer, `pngjs` als einziger Codec.** Begründung + Beleg: `scripts/ibl-bake.ts` ist exakt dieser Split (pure core → pngjs-Encode `:86-90` → ein Headless-Chrome-Aufruf nur für WebGL2 `:126-179` → sha256-Manifest `:225-255`). `makeImageData` hat einen expliziten Node-Fallback (`CanvasOps.ts:9-22`); `common/dsp/TextureFilters.ts` und `common/image/*` sind DOM-frei. **~90 % der Fläche brauchen keine neue Dependency.**
2. **Nur IBL-Bake = Headless-Chrome-Subprozess** (bewährte Flags `--enable-webgl --enable-unsafe-swiftshader --ignore-gpu-blocklist --use-gl=angle --use-angle=swiftshader`; `ibl-bake.ts:136-146`, `capture.js:280-299`). Pro Aufruf wegwerfbarer Browser, sequenziell (`capture.js:302-303`). **Keine Sizing-Auswirkung auf die 1A-Shell**: Die CLI teilt nichts — höchstens ein GL-Kontext in einem frisch gestarteten, sofort beendeten Browser.
3. **PNG-first-I/O (Phase A):** PNG ist ohnehin das kanonische Engine-Texturformat. JPEG/WebP/EXR → Dokumentierter Fallback: Headless-Decode, sonst Fehler mit klarer Meldung. Kein Canvas-Shim, kein neuer nativer Codec in Phase A (`package-lock` enthält heute keinen — `pngjs`-root-devDep, `pixelmatch`/`puppeteer`/`tsx` devDeps).
4. **`.gltf`-only in Phase A:** `WorldWriter` emittiert bereits Data-URI-glTF (`WorldWriter.ts:40-63,207`). GLB-Container-Writer wird **nicht** in die Engine gehoben (C3-Non-Goal) und ist **kein ADR-Inhalt** — als Backlog-Item 💡/📋 notiert. `swm`-Flag `--binary` bleibt reserviert.
5. **Verpackung (Finding F4):** `swm` als `bin` in `@small-world-machine/tools` mit Shebang + tsx-Lauf; **kein kompiliertes Binär**. **`pngjs` muss in `packages/tools/package.json` als Produktions-Dependency** (heute root-devDep; `packages/tools/package.json` listet nur engine/tweakpane/fflate) — sonst funktioniert die veröffentlichte Pipeline nur über Hoisting. **Smoke-Gate:** `swm --help` + ein Kaltstart-Lauf in den Gates (tsx-Runtime-lose Bins werden sonst von keinem Gate erfasst).

**Abgewogene Alternativen:** (3B) Puppeteer-treibt-UI: maximale Wiederverwendung, aber Kopplung an Dev-Server/Browser, schlechte Deterministik/Latenz, testet die UI statt den Core — nur Fallback für „needs-GL/needs-Web-Viewport"-Ops. (3C) Canvas2D-Shim verbatim: Fidelity für Canvas-Codecs, aber neue Native-Prebuilts (`allowScripts`-Churn) — erst wenn ein konkretes Tool es braucht. (3D) esbuild-Binär: Over-Engineering, `tsx` ist der etablierte Repo-Mechanismus (`ibl:bake`).

### D4 — `swm`-Kommandooberfläche

**Ein `swm`-Umbrella, `swm <domain> <verb> [flags]`** (ein Kern = ein Einstiegspunkt; Per-Tool-Binaries abgelehnt: Install-/Alias-/Wartungsbloat, C6). Install-Pfad: `bin` in `@small-world-machine/tools` (dokumentierter Weg) + **Root-npm-Skript-Wrapper `swm`** als Dev-Konvenienz (Muster `ibl:bake`). Use `tsx`-Lauf.

```
swm
├── ingest <path>... --out <dir> [--kind image|pbr-set|gltf|archive|any] [--auto] [--json]
├── sprite
│   ├── auto-detect --sheet <png> --out <dir> [--min-size WxH] [--padding n] [--json]
│   └── crop --sheet <png> --rect x,y,w,h --out <file> [--trim] [--json]
├── map
│   ├── import --ascii <file> --out <out.gltf> [--legend <json>] [--grid-size n] [--wall-height n] [--json]
│   └── export --src <file|png> --out <ascii.txt> [--json]
├── material
│   └── gen --diffuse <png> --out <dir> [--maps height,disp,normal,specular,roughness,ao,edge] [--profile <file|json>] [--norm-strength …] [--json]
├── ibl
│   └── bake --seed <n> --out <dir> [--width W --height H] [--json]
├── kit
│   ├── validate <dir|zip> [--json]
│   └── inspect <dir|zip> [--tree] [--json]
├── scene
│   ├── export --src <scene.gltf> --out <out.gltf> [--json]
│   └── info --src <file> [--json]
└── run --jobs <file.json> [--dry-run] [--json]        # Batch-Manifest (Muster pbr.sh --config)
```

- **Globale Flags:** `--help/-h`, `--version`, `--json` (nur stdout; Logs→stderr), `--quiet/-q`, `--verbose`, `--force/-f`, `--out`.
- **`--json`-Kontrakt:** dokumentiertes Schema pro Kommando (Pfade, `sha256`, `bytes`, Manifest-Link); Konsumenten lesen unter `--json` ausschließlich stdout. **Schemaversion + Exit-Codes (0 ok / 1 Laufzeit / 2 Usage / 3 Eingabe fehlt / 4 nichts getan ohne `--force`) werden versioniert und dokumentiert; Feld-/Code-Änderungen verlangen CHANGELOG-Eintrag** (Finding F4 — es ist ein Externer Automations-Kontrakt).
- **Konfiguration:** Flags-first (C6). Optionales `--config <file.json>` nur für Batch-Jobs und Material-Profile. **`AiConfigStorage` wird nicht wiederverwendet** (ist localStorage-gebunden, `AiConfigStorage.ts:49,72`); Provider-Shape wiederverwenden, aber File/Env-basiert (CLI-brauchbar).
- **Dokumentation:** `packages/tools/docs/cli.md` + Guide-Sektion + `REFERENCES.md` (CLI-Konventionen).

### Explizit NICHT in der CLI (ausgeschlossene Teilmenge, C6)

| Feature | Grund der Ausgrenzung |
| :--- | :--- |
| Gizmos, Viewport-Navigation, Kameraführung | interaktive Transforms haben keine nicht-interaktive Bedeutung; Szenendaten bewegen sich via `scene export`/`map import` |
| Drag & Drop / Paste | ersetzt durch `swm ingest <path>` |
| Modale Tastatur-Flows (Nudging, Snapping-Interaktion) | Editor-Ergonomie, keine Batch-Transform-Frage; `--json` ist das Scripting-Substitut |
| Xtractor AI-Chat (mehrschrittig) | außerhalb der Teilmenge; optionaler `--ai`-One-Shot später, nicht Phase A |
| Undo/Redo, Auto-Save | Zustandssemantik; irrelevant für One-Shot-Ops |
| tweakpane-Panels, Forge-Dock, Fensterposition | reine UI |
| MaterialStudio-Sandbox-Preview (GL-Render) | genau dafür ist die Web-Oberfläche; CLI erzeugt nur Mappen (ggf. Golden-Preview in späterem Meilenstein) |
| Splatter bis Port | kein TS-Core (gekoppelt an D6) |

---

## 4. Migration der Web-Oberfläche & Scope (D5/D6 — Konsens)

### D6 — Verbindlicher Merge-Scope

| Seite | Verdict | Begründung (Evidenz) |
| :-- | :-- | :-- |
| **Maker** (`maker.html`) | **HOST-SHELL** | Standalone-Editor (ADR 0010), wird die eine App. `maker.html:730` |
| **Xtractor** | **FULL MERGE (Mode)** | Dünner Mount (`xtractor.html:43-46`); Logik in `Xtractor.ts`; AI über geteilte `common/ai/`; Crop→Pixler-Handoff wird in-app. |
| **Pixler** | **FULL MERGE (Mode)** | Dünner Mount (`pixler.html:44-49`); eigener Undo-Scope passt zu D1. |
| **Map Generator** | **FULL MERGE (Mode)** | Dünner Mount (`map-gen.html:42-47`); Modul + Tests isoliert; geringstes Risiko. |
| **PBR / Material Studio** (`pbr-gen.html`) | **FULL MERGE (Mode)** — mit Pflicht-Vorarbeit | Die eigentliche Map-Pipeline (Presets/Ableitungen/Zip-Export) ist **inline** in `pbr-gen.html:1031-1639`; der Sandbox ist eine eigene `SmallWorldMachine`-Subklasse (`MaterialStudio.ts:27`). Erst Inline-Algorithmus nach `core/material/` extrahieren, dann Panel; Sandbox über das D1-GL-Budget (≤2 Surfaces) statt zweiter Engine-Instanz. |
| **IBL Gen** | **FULL MERGE (Bake-Mode)** | Dünner Kleber (`ibl-gen.html:135-164`); Core headless vorhanden, Bake bleibt Browser-GL bzw. CLI-Subprozess. |
| **Kit Inspector** | **DEFERRED MODE → CLI-first** (nicht Panel in Phase A) | Der einzige Datenslice ist Manifest-Validierung, die `KitManifestValidator` **schon existiert** → `swm kit validate` zuerst. Der 3D-Inspektions-Viewport ist interaktiv → bleibt `ui/`; nur wenn ein Share-Viewport-Host besteht (an M4-Sandbox anbinden). Seite bleibt unter Entry-Alias-Politik erreichbar; Panel nur bei Spare-Surface-Budget. |
| **Splatter Generator** | **Port `SplatterCore` (neues Code-Modul) + Seite bleibt dauerhaft standalone** | Kein TS-Core; Algorithmen inline (`splatter-gen.html:563-1259`). Port = deterministisches seed→ImageData für `swm splatter`; Seite selbst (Code-Anzeige) ist Wegwerfprodukt → kein Panel in Phase A. |
| **Gamepad Test** | **BLEIBT SEPARAT** | Pure Hardware-Diagnose (`gamepad-test.html:250-256`); Null Asset-Flow; Nicht-Ziel. |
| **attachDevTools / Forge** | **NUR In-Game**, nicht in der Web-App neu aufgestellt | Forge ist Overlay-Fenstermanager (`Forge.ts:9-79`); die vier ForgeTool-Instanzen (`attachDevTools.ts:23-31`) bleiben exakt unverändert — sie werden von `forge-tools-e2e.mjs`/`xtractor-forge-e2e.mjs` (via `apps/showcases/19/index.html`) getestet. |

### D5 — URL-Strategie: **Entry-Aliases (gleiches Dokument, Mode vorausgewählt)** statt Dokument-Swap

- **Finding F2 (verbindlich):** Legacy-Adressen `public/tools/*.html` werden **Entry-Aliases**, die die verschmolzene App mit vorausgewähltem Mode booten, Schema `maker.html#<mode>`. **Kein `location.replace`-Dokumentwechsel** als interne Navigation: ein Dokumentwechsel zerstört Session-/FS-Access-Zustand (gebundener Projektordner `ProjectBinding`, Undo-Stacks, Auto-Save). **Interne Modus-Wechsel = In-App-View-Swap, null Navigation.**
- **Build-Graph-Invarianz bleibt:** Alle `public/tools/*.html` bleiben `vite.config.ts:262-270`-Inputs, `js/tools/*.js`-Ausgabe unverändert, `sync-tools.js` auditieren (Stub-/Alias-Script re-inlinieren → pro Meilenstein prüfen). **M7 „Input-Deletion" bleibt explizit Nicht-Ziel** (spätere, trennbare De-Merge).
- **E2E-Re-Point im selben Meilenstein-Commit:** `xtractor-e2e.mjs` (einziger Harness gegen `public/tools/*.html`, `XTRACTOR_URL` default `…/xtractor.html`, `xtractor-e2e.mjs:20`) auf `maker.html#…` umstellen; dabei den AI-Config-Seed-Schlüssel `smallworldmachine_ai_config` (`xtractor-e2e.mjs:101-106`) im Merge-Namespace erhalten. **Modus-Mount-Marker vor jedem Stub-/Alias-Flip** (E2E muss auf Boot des Code-Split-Modes warten, nicht blind schlafen — `xtractor-e2e.mjs:107-149`). Puppeteer folgt keinem Meta-Refresh — Entry-Alias ist der deterministische Weg.
- **Forge-Wiring unangetastet:** `forge-tools-e2e.mjs`/`xtractor-forge-e2e.mjs` laufen gegen Forge-Fenster im Showcase, nie gegen Tool-Seiten — Regression dort ist für Stub-Tests unsichtbar → Muss im Scope-Gate grün bleiben (F3).

---

## 5. Phasierter Umsetzungsfahrplan (G6)

Für jeden Meilenstein gelten die Gates aus §8. `[OVERLAP]` markiert Koordinationspflicht. **Jeder Meilenstein ist einzeln mergebar und grün.**

| Meilenstein | Scope (eigenständig grün) | Betroffene Dateien/Module | Web/URL & Vite/Sync-Tools | Forge | Docs (C7: append-only) | Rollback | ADR / Domain |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| **M1 — Shell-Bootstrap** | Mode-/Hash-Router + Panel-Host in MakerApp; `ToolMode`-Lifecycle-Vertrag; **keine** Tool-Änderungen, **keine** Seitenänderungen. Legacy-URLs funktionieren unverändert. | `packages/tools/src/maker/` (+Host, +Router, +`ToolMode`), `public/tools/maker.html` (Mode-Launcher) | URLs/Vite/Sync-Tools unverändert | keine | Maker-`log.md`-Eintrag; CONTEXT.md: „Maker-Mode/ToolHost"; `backlog.md` | `git revert` des Shell-Commits — Tools unberührt | **ADR-A-Entwurf** (ersetzt ADR-0010-§3-Festlegung) |
| **M2 — Headless-Core-Extraktion** (reine Code-Umzüge, `[OVERLAP: D2 ↔ M2]`) | Per-Tool-`core/*`-Split **ohne** Verhaltensänderung; Seiten/Forge importieren kompatible Re-Exports weiter. **Inkl. Purge `MapGenerator.loadFromImage` + Grep-Gate (F1) + `RasterIO` (F5).** | `XtractorCore`, `PixlerOps`, `MapDefConverter`, `MaterialMapPipeline` (Extrakt aus `pbr-gen.html`-Inline), `SplatterCore` (neu), `core/pipeline/` + `RasterIO`; `ui/*`-Re-Exports | unverändert (Re-Exports halten Seiten) | keine | CHANGELOG-Eintrag (Release-Zitat-Stil) | revert moves, Exports zurück | **ADR-B-Entwurf** (Grenze core↔CLI) |
| **M3 — Merge Low-Risk: Map, Pixler, Xtractor** | Mount hinter M1-Router; 3 Seiten → Entry-Aliases; E2E-Re-Point **im selben Commit** (inkl. AI-Seed-Key); Marker-Smoke vor Flip (F2). | `map-gen.html`, `pixler.html`, `xtractor.html` → Aliases; Maker-Mode-Module; `MapGenerator/Pixler/Xtractor`-Klassen bleiben (Forge) | Aliases als Vite-Inputs (keine Config-Änderung); Sync-Tools **audit** (Skip-List bei Flash/Overwrite) | keine (& Attach-DevTools unverändert) | `docs/guides/{pixler,xtractor,map-generator}.md` → Supersede-Note (append, nicht umschreiben); `log.md` | 3 Seiten aus HEAD + Mounts reverten | Domain-Tools→Maker-Modes |
| **M4 — Material-Mode + Kit-Validator** | **Größter Einzel-Refactor:** Inline-PBR-Pipeline (~500+ Zeilen) → `MaterialMapPipeline`-Core; Sandbox über GL-Budget (destroy-on-exit); Kit-Inspector-Glue → Validator-Modal; **golden pixel test** (Granit-Fixture, `pbr-gen.html:1212`) gegen Drift. | `MaterialStudioController`, `MaterialMapPipeline`, Kit-Validator; `pbr-gen.html`/`kit-inspector.html` → Aliases | Aliases-as-Inputs; golden compare gate | keine | `material-studio.md` Supersede-Note; `log.md`; CHANGELOG | Seite HEAD; Golden-Gate | ADR-A-Status Promoted |
| **M5 — IBL + Splatter** | IBL-Bake-Mode (Core reuse, GL-Bake isoliert pro Mode); `SplatterCore` → **CLI only**, Seite bleibt standalone (Panel nur falls < S); `swm`-Packaging fixen (pngjs prod-dep, Smoke-Gate F4). | `ibl-gen.html`-Alias; `ibl-gen.ts` bleibt; `src/splatter/` | Aliases-as-Inputs | keine | neue `docs/guides/*` für App+CLI (D4-Inhalte) | revert Alias | ADR-A/B finalisieren |
| **M6 — Finaler Scope & Cleanup** | Gamepad bleibt; nichts aus Vite löschen (Aliases bleiben Inputs — bewusst); `public/index.html`-T-Einträge (T-01..T-09) → **Deep-Links** `maker.html#<mode>` (Wortlaut gehalten); Final-Doc-Pass (CHANGELOG-Release-Eintrag, CONTEXT/REFERENCES, `log.md`); 4 Gates + `swm --help`-Smoke grün; Sync-Tools-Finalaudit. | `public/index.html`, Docs, `sync-tools.js` (Finalaudit) | **bewusst alle 9 Inputs behalten** (M7 = Nicht-Ziel) | unverändert | finaler CHANGELOG-Eintrag, alle `log.md` | kein Rollback nötig | ADR-A/B → IMPLEMENTED |

---

## 6. Risikoregister (Konsens, mit Eigentümer)

| Risiko | L | I | Minderung (Owner) |
| :-- | :-: | :-: | :-- |
| E2E-Regressionen der Tool-URL-Harnesses (`xtractor-e2e`) | H | H | Entry-Aliases halten URLs am Leben; Re-Point im selben Commit; M3/M4-Gate auf Grün; Markersmoke vor Flip (Charly/Alice) |
| In-Game-Forge-Regression unsichtbar für Stub-Tests (`forge-tools-e2e`, `xtractor-forge-e2e`) | M | H | `attachDevTools`/Forge-Wiring unverändert (F3-Gate: kein Attach-DevTools-Edit + kein Konstruktor-Churn im selben Meilenstein) (Dave/Bob) |
| Web↔CLI-Bytedivergenz durch Codec-Grenze (Browser-Decode ≠ pngjs) | H | H | `RasterIO`-Interface im Core (F5); beide Flächen durch eine Adapter-Schiene; Golden-Parity-Tests auf abgeleitete Mappen/Sprite-Erkennung; Determinismus auf RGBA-Fixtures (Bob/Charly) |
| Mehrere GL-Kontexte in einem Fenster (Maker+MaterialStudio+IBL) | M | H | **Budget ≤ 2 Surfaces**, lazy mount/destroy-on-exit; IBL als Subprozess; Kontextverlust-Fail-Fast (Bob/Dave) |
| `pbr-gen.html`-Inline-Refactor (~500+ Zeilen) | M | H | Reine M2-Extraktion zuerst (kein Verhaltenswandel), Pixel-Golden auf Granit-Fixture, Freeze (Bob/Charly) |
| Splatter-Port-Fidelity (Perlin-Seeding/Determinismus) | M | M | `SplatterCore` seed→ImageData + Golden-PNG-Diff; Seite bleibt standalone → keine Web-Regression (Dave/Charly) |
| AI-Provider-Verdrahtung über verschmolzene Flächen | M | M | `common/ai`/`AiConfigStorage` single-instance, DI via Context (C2); keine zweite Config-Storage in der Shell; CLI nutzt File/Env statt localStorage (Dave) |
| **Packaging-Falle:** `swm` läuft lokal per Hoisting, versagt am sauber installierten Artefakt | M | H | `pngjs` → Tools-Prod-Dependency (F4); Clean-Install-Smoke; `swm --help` + ein Shakedown-Run in den Gates (Charly/Dave) |
| `sync-tools.js` mangelt Entry-Aliases (strip/re-inline) | M | M | Pro-Meilenstein-Audit; Skip-List oder canonical-mode Flag (Dave) |
| `--json`/Exit-Codes als Externer Kontrakt kippt Scripting | L | M | Schemaversionierung + CHANGELOG-Pflicht bei Feld-/Code-Änderung; Guide-Doku (F4) (Charly) |

---

## 7. ADR-Entwürfe (Inhalte im Plan; Promotion bei Implementierungsstart)

### ADR-A — „Big Merge": vereinheitlichte Maker-Architektur für Entwicklungswerkzeuge (DRAFT)
- **Kontext/Problem:** 8 eigenständige Tool-Seiten + Forge (ADR 0010 §3, verlängert durch ADR 0024) fragmentieren Asset-/Undo-/AI-Flüsse; Duplikation der Ingest-/UI-Schienen. User-Vorgabe (Moderator): alles in den Maker verschmelzen, dual (Web+CLI) aus einem Kern.
- **Entscheidung (provisorisch, per Konsens):** Maker wird App-Shell; alle Autoren-Werkzeuge werden `ToolMode`-Module über einen **dedizierten** `ToolMode`-Lifecycle (nicht `ForgeTool`); URL-Strategie = Entry-Aliases (`maker.html#<mode>`), Vite-Inputs bleiben; **Forge bleibt In-Game**; ein Projektbegriff `Workspace`; `[AMEND] ADR-0010 §3/§4` (Standalone-Seiten-Entscheidung + Ordner-Persistenz-Semantik) und Erweiterung von ADR 0024 (Paketgrenze bleibt).
- **Alternativen (verworfen):** neutrales „Studio"-Host (1B) — höchster Re-Skin; iframe-Launcher (1C) — keine echte Vereinheitlichung; Forge-Dock-Host (1D) — Fenster-in-Fenster, Fallback.
- **Konsequenzen:** Undo pro Tool/Dokument (nie global); ein Projektordner/Ingest; Legacy-Pages bleiben erreichbar; `attachDevTools`/Forge unverändert.
- **Scope-Clamp:** Keine CLI-Details, keine Per-Tool-Panel-Verhältnisse (Kit/Splatter = Tracking-Entscheidung → Plan/backlog), kein „globaler Undo".

### ADR-B — Headless-Kern & CLI-Grenze (`swm` boundary) (DRAFT)
- **Kontext/Problem:** CLI (G3) braucht denselben Kern (G2), aber Gizmos/DnD/Viewport sind headless-unbildbar (C6 — User-Vorgabe: pragmatische Teilmenge, kein monströses Interface).
- **Entscheidung:** `core/*` ist framework-agnostisch — **keine harte DOM/GL/Browser-Abhängigkeit**; rendering-abhängige Schritte (IBL-Bake) hinter Interface + Headless-Chrome (C11); CLI (`bin` in `@small-world-machine/tools`) ist die bewusste, dokumentierte Teilmenge; explizit NICHT abgebildet: interaktive Gizmo-/Tastatur-/Viewport-Logik.
- **Alternativen (verworfen):** Thin-Controller (dupliziert Logik, verletzt G2); reine Browser-Automation (Latenz/Lebenszyklus, testet UI nicht Core).
- **Konsequenzen:** deterministische Tests (RGBA-Fixtures), `--json`-Ausgabe für Automation (versioniert), Kern wächst, UI bleibt dünn.
- **Scope-Clamp:** Keine Web-Shell-/Panel-Entscheidungen (→ADR-A), keine normative Verb-Liste (lebt in `swm --help`+Guides), **kein GLB-Writer** (→backlog), PNG-first ist Phasen-/D3-Entscheidung — ADR-B hält nur das dauerhafte Prinzip.

---

## 8. Verifikationsstrategie (pro `swm`-Subkommando und pro Modul)

1. **Unit (Core):** vitest auf reinen Modulen — bestehende Kultur (`tests/image/CanvasOps.test.ts`, `tests/ibl-gen-core.test.ts` laufen ohne jsdom); DOM-nahe Core-Stellen mit jsdom-Pragma wie `tests/xtractor/Xtractor.test.ts:1`. **Eat-own-dog:** CLI-Controller importieren denselben Core → Unit-Abdeckung überträgt sich.
2. **E2E (CLI headless):** neue `.mjs`-Harnesses unter `scripts/` im Stil von `xtractor-e2e.mjs` (deterministische Inputs via `pngjs`, CLI-Invoke in-process oder als Child). IBL/GL nutzen den bewährten `ibl-bake.ts`-Pfad + `capture.js`-Flags.
3. **Determinismus:** Pure Ops → **Byte-Gleichheit (sha256) bei identischem RGBA-Fixture**; IBL → Same-Machine-sha256 == gepinntes Manifest (`ibl-bake.ts:225-255`), cross-machine via `pixelmatch` (devDep) mit dokumentierter Toleranz; **nie** Byte-Goldens für GL-Pixel. Web↔CLI-Parity-Goldens auf abgeleitete Mappen/Sprite-Erkennung (F5).
4. **CI-/Repository-Gates (verbindlich pro Meilenstein):**
   - `npm run lint`, `npm run build:lib`, `npm run test`, `npm run typecheck` grün
   - **Grep-Gate F1:** 0 Treffer `getContext|document\.|window\.` unter `packages/tools/src/core/`
   - **Smoke-Gate F4:** `swm --help` + ein Kaltstart-Run; Clean-Install-Smoke (pngjs Prod-Dependency)
   - Nach M3: `swm --json`-Kontrakt-Test (Schema-/Exit-Code-Stabilität)
   - E2E-Harness-Re-Point im jeweiligen Meilenstein-Commit; Markersmoke vor Alias-Flip (F2)

---

## 9. Definition of Done (gesamtes Vorhaben)

- [ ] G1: Eine Anwendung; keine separaten Tool-Roots mehr (Forge/attachDevTools ausgenommen, dürfen).
- [ ] G2: `core/*` wird von Web-UI **und** CLI konsumiert; kein Duplikat; Grep-Gate F1 grün.
- [ ] G3 + G4: `swm`-Teilmenge gemäß §3 funktional, dokumentiert, ausgeschlossene Teilmenge explizit gelistet; Web bleibt schöne Hauptfläche.
- [ ] G5: Bestehende Tests/E2E grün; historische Log-/CHANGELOG-Einträge erhalten; ADR-A/B promotet & implementiert; 1-Weg-Abhängigkeit tools→engine unverändert.
- [ ] G6: M1–M6 einzeln gemergt, jedes grün; Rollback-Pfade pro Meilenstein greifen.
- [ ] Alle Findings F1–F6 als Anforderungen umgesetzt; `swm --json`/Exit-Codes versioniert; Risikoregister abgearbeitet.

**Bewusst außerhalb:** M7-Input-Deletion, GLB-Packer, Canvas-Shim/Codecs, Kit-Panel (erst bei Share-Viewport), TUI, AI-Chat-CLI.

---

## 10. Koordinator-Abschlussblock (Alice — 2026-10-13)

- **Session-Ergebnis:** Einstimmiger Konsens (4/4) auf Proposal P1; alle sechs Entscheidungspunkte D1–D6 sind mit alternativen Wegen debattiert, bewertet und entschieden worden (Dokumentation abgewogener Alternativen in §2–§4). Sechs Major-Findings (F1–F6) aus der Kritik-Runde sind als **verbindliche Plan-Anforderungen** eingearbeitet — darunter die Codec-Barriere `RasterIO` (F5), Entry-Alias-Politik statt Dokument-Swap (F2), dedizierter `ToolMode`-Lifecycle statt ForgeTool-Reuse (F3), Packaging-Korrektur `pngjs`→Prod-Dependency + Smoke-Gate (F4) und der Domain-Begriff `Workspace` (F6).
- **Kernsanktion (Moderator/Briefing §4):** CLI ist bewusst eine pragmatische Teilmenge (§3 „Nicht abgebildet"); Splatter-Page und Gamepad-Test bleiben dauerhaft standalone (Autorisierung).
- **Empfohlener nächster Schritt für die Implementierungs-Session:** Freigabe abwarten, dann **M1 (Shell-Bootstrap mit `ToolMode`-Vertrag)** + parallel **M2-Vorbereitung** (Core-Module mit `RasterIO`, Purge `MapGenerator.loadFromImage`, Grep-Gate) — kleinste, unabhängig grüne Einheiten. Implementierungs-Start bitte als neue `collaborate`-Session (`implement`-Modus, `implementation-phase.md`) mit Abnahme-Gates pro Meilenstein.
