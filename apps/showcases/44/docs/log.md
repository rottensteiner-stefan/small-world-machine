# Showcase 44 — Instancing Measurement Rig · Living Log

## Zweck

Real-Browser-Messstand (nicht "Tour"-Showcase, sondern Messinstrument) für die
Geometrie-Gruppierungs-Instancing-Arbeit A2
(`docs/research/instanced-batching-2026-10-24.md` §7.1(b)). Misst die echten Draw-Calls pro Frame
und die Frame-Zeit einer **Geometrie-Mix-Szene** mit/ohne Auto-Instancing (ADR 0046) auf echter
WebGL2-Hardware — das deterministische Pendant dazu ist
`packages/engine/tests/renderers/WebGL2MainOpaqueInstancing.test.ts`.

## Messprinzip

- **Erzwungen WebGL2** (`rendererType: RendererType.WEB_GL2`): nur der GL-Pfad läuft durch die
  gezählten `gl.draw*`-Entrypoints. Ein WEB_GPU-Kontext hätte 0 gezählte Calls.
- **Geometrie-Mix, eine Materialinstanz:** zwei Cube-Geometrien (1.0 / 1.7) werden in
  alternierender Einfüge-Reihenfolge (`i % 2`) unter EINEM `StandardMaterial` verstreut. Nie gibt es
  ≥2 gleiche Geometrien in Folge → klassisches "consecutive identical objects"-Instancing (ADR 0046)
  kann nichts zusammenfassen; nur A2s Geometrie-Gruppierung erzeugt die zwei instanced Draws.
- **Kein Culling-Confound:** alle Cubes `frustumCulled = false`; fixe erhöhte Kamera; nur
  `AmbientLight` (kein schattenwerfendes Licht → keine Shadow-Draws im Count).
- **Engine-fremde Zählung:** `canvas.getContext("webgl2")` liefert den *gleichen* Kontext-Objekt-
  der Engine → Shadowing von `drawArrays/drawElements/drawArraysInstanced/drawElementsInstanced`.
  Keine Engine-Änderung, kein neuer öffentlicher Parameter.
- **Messfenster:** 30 Frames Warm-up, dann `?frames=N` (default 240) Frames Sammlung; Ergebnis
  landet einmalig als `MEASURE {json}` im Overlay `#__measure` und auf der Konsole
  (Konsument: `scripts/measure-a2-instancing.mjs`).

## URL-Parameter

- `?inst=off` → Auto-Instancing aus (= Per-Object-Baseline/"vorher"; Werksdefault an)
- `?count=N` → Objektzahl (default 1600, 40×40)
- `?frames=N` → gesammelte Frames nach Warm-up (default 240)

## Setup-Entscheidungen

- **Statische Szene**, `defaultCameraController="none"`: konstante Draw-Last über das Messfenster.
- **Kein Post-Processing, kein IBL**: Draw-Count = reine Opaque-Main-Pass-Draws der Objekte.
- Bewusst **kein** `?rendererType=`-Override im Aufruf: der Stand erzwingt selbst WEB_GL2.

## Verifikation

- Deterministischer Test (WebGL2-Parität): naive Reihenfolge = 0 Instancing-Runs (12 Draws),
  A2 = 2 instanced Draws (Ranges [0,6]/[6,12]), `autoInstancing:false` = 12 Per-Object-Draws —
  `WebGL2MainOpaqueInstancing.test.ts`, siehe ADR-§9.1 im Instancing-Report.
- Real-Messung: `npm run build:showcases && npm run preview`, dann
  `node scripts/measure-a2-instancing.mjs` (startet den Preview-Server selbst).

## Einträge

### 2026-10-25 — Rigg eingerichtet, reale Messung (Stand)
- Showcase 44 als dauerhafter Messstand angelegt (index.html, showcase.ts, docs/).
- Registriert: vite.config rollup input, `AbstractShowcase.VALID_SHOWCASE_IDS`, Launcher
  `public/index.html`, `scripts/check-showcases.js` numberedShowcases.
- **Reale Messung (Headless-Chrome/SwiftShader-WebGL2, Preview auf 4173, 1600 Objekte, 240 Frames)**:
  - A2 aktiv: **≈ 2 Draw-Calls/F** (0 per-object, ≈ 2 instanced), 45,2 FPS, 22,1 ms/F
  - Baseline (`inst=off`): **≈ 1600 Draw-Calls/F** (per-object), 42,9 FPS, 23,3 ms/F
  - Draw-Reduktion ≈ 800×; Frame-Zeit-Delta klein (~5 %) weil pixel-/präsentiert-limitiert
    (erwarteter Befund). Werte + Interpretation in
    `docs/research/instanced-batching-2026-10-24.md` §9.1.1 dokumentiert.
- Kein CHANGELOG-Eintrag (internes Perf/Docs-Thema; Changelog kuratiert der IBL-Kampagnen-Session).
