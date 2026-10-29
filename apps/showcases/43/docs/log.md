# Showcase 43 — Kanon 1m Studio · Living Log

## Zweck

Kanon-Referenzzelle (P3-E11B, DP-11): eine minimale 1m-Studio-Szene (PBR-Material-Ball auf
neutralem Boden unter hartem Studio-Key-Light) als **entscheidungsrelevanter PBR-/Schatten-Referenzpunkt**
und deterministischer Golden-Kandidat (`scripts/goldens`, Pool-Namespace `st43-*`; Baseline
`.agents/goldens/st43/baseline/`).

## Pools

- `st43-matte` / `st43-satin` / `st43-metal` / `st43-chrome` — nur das Kugel-Material variiert;
  Studio, Licht und Kamera sind fix (statische Szene, kein Uhren-/Animations-Reset nötig).
- Golden-Kontrakt identisch zu Showcase 38/39 (`apps/showcases/43/GoldenCapture.ts`).

## Setup-Entscheidungen

- **Statische Szene**: keine `update()`-Animation, kein Post-Processing — Frame ist byte-identisch
  über Zeit (Determinismus ohne zusätzliche Mechanismen; `renderer.frameInfo` wird trotzdem
  defensiv auf 0 zurückgesetzt, siehe GoldenCapture.ts).
- **Kamerasperre** (`defaultCameraController="none"` + `setInitialCamera`): fixer Inspektions-Frame.
- **1m-Skala**: Kugelradius 0.5 (Durchmesser 1 m), Boden 5×5 m, Kamera ~2-3 m — Skalierungs-Anker.
- **Key-Light** wirft den Referenz-Schatten (Shadow/PBR-Drift-Schutz); 2048-er Shadow-Map, kleine
  Bias — Nahaufnahme-Szene, kein CSM-Bedarf.
- Bewusst **kein IBL/HDRI** (nicht nötig für die Zelle; Umgebungslicht nur `AmbientLight`).

## Golden-Baseline

- Aufnahme (WEB_GL2, 1280×720, 60 Frames): 4/4 Zellen OK; zwei unabhängige Läufe byte-identisch
  (0,0000 %) — Deterministik numerisch verifiziert.

## Einträge

### 2026-10-25 — Interaktives Material- und Licht-Labor (HUD)
- **Zweck-Erweiterung:** Im reinen interaktiven Modus (ohne `?__golden=...`) wird Showcase 43 zu einem interaktiven PBR-Studio aufgewertet, während Golden-Captures strikt unverändert und byte-deterministisch bleiben.
- **Funktionen:**
  - OrbitController für freie Inspektion per Maus/Touch (Key `R` für Kamera-Reset).
  - Material-Presets (Keys `1`-`4`): Matte, Satin, Metal, Chrome.
  - Live-Slider & Tasten für Roughness (`[` / `]`), Metallic (`Shift` + `[` / `]`) und Base-Color-Picker.
  - Licht-Ausrichtung: Key-Light Azimut & Elevation per Slider oder Pfeiltasten (`Shift` = 1° Feinjustierung).
  - IBL-Toggle (Key `E`): Zuschaltung von Image-Based Lighting für realistische Metall-/Chrom-Reflexionen.
  - 1m-Grid-Toggle (Key `G`): Sichtbarmachung des metrischen Maßstabs.
  - Reset-Button & Key `0`: Sofortige Rückkehr zum exakten Golden-Referenzzustand.
- **Architektur:** Zero-GC im Interaktionspfad (Mutation des existierenden `StandardMaterial`, keine Re-Allokationen). Toggle-Button (`⚙`) standardkonform in `.app-footer`.


### 2026-10-29 — Seitenpanel nach `Hud.ts` ausgelagert
- Material-Lab-Panel (Markup, Bindings, Sync) aus `showcase.ts` in `Hud.ts` (`MaterialLabHud`) verschoben, aufgebaut auf dem gemeinsamen `apps/showcases/shared/ShowcaseDrawer.ts`. Material-/Licht-/Studio-Zustand bleibt in `showcase.ts` (Actions + `sync(state)`).
- Entfallen: handgebautes Aside/Header/Close-Button, stopPropagation-Schleife, Footer-Button-Erzeugung, I-Toggle, duplizierte Drawer-CSS. Lokal bleibt nur die Color-Input-Regel.
- IDs unverändert (`#showcase-hud`, `st43*`); Panel startet offen, Golden-Modus baut weiterhin kein Panel. Panel-Toggle jetzt einheitlich I **und** H (H war frei); Footer-Button zeigt das Header-Icon ⚪ statt ⚙.
- 2026-10-29 Hud-Namen: `MaterialLabHud`/`MaterialLabState`/`MaterialLabActions` → `Hud`/`HudState`/`HudActions`; Footer-Button wieder ⚙ (`footerIcon`); Renderer-Badge im Header entfernt.
