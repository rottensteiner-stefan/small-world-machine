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
