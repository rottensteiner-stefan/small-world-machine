# Showcase 42 — Soft Shadow Lab · Living Log

## Zweck

Deterministische Mikro-Bühne, die in einem Headless-Live-Gate (.agents/scratches/check-swm42.mjs)
visuell **beweist**, dass die WebGPU-only Qualitäts-Knöpfe `quality.shadowSoftness` und
`quality.shadowMaxPcfRadius` (ADR-0035-Override-Lock, GlobalUniforms-Lane `[212, 213]`) die
PCSS-Penumbre real verbreitern — und dass sie auf WebGL2 eine dokumentierte No-Op sind
(Negativkontrolle: WebGL2 hat nur festes 3×3-PCF).

## Query-Knöpfe

- `?rendererType=WEB_GPU` — Backend-Override (AbstractShowcase).
- `?softness=<float>` → `quality.shadowSoftness` (Default 1).
- `?maxRadius=<int>` → `quality.shadowMaxPcfRadius` (Default 4).

## Setup-Entscheidungen

- **Post-Processing deaktiviert** (`postProcessing.enabled=false`): volle Deterministik, keine
  temporale Effekte (TAA), Pixel-Analyse attribuiert Änderungen exklusiv der Schatten-Penumbre.
- **Kamerasperre** (`defaultCameraController="none"` + setInitialCamera): statischer Frame.
- **Kontrast-Extrem**: heller, uniformer Boden vs. dunkle scharfe Box als Caster, sehr schwaches
  Ambient (0.12), starker Spot/Directional (2.6) — tiefe Schatten, große Dynamik.
- **Sun-Richtung 0.45/-0.88/0.3 +Z**: Schatten fällt in die Nahfeld-Kameraansicht.
- QA-Hook `window.__qaSwm42.sample()`: liefert Renderer-Type, Konfig und den echten
  Uniform-Lane-Inhalt der WebGPU (`scratch[212,213]`) → CPU→GPU-Verdrahtung prüfbar.

## Changelog

### 2026-10-21 (0.115.6) — PCSS-Härtung
- **Engine-Increment (c):** `getShadowPCSS` in `pbr_math.wgsl` gehärtet:
  - Penumbra-Breite prinzipiell aus perspektiv-normalisierter Receiver-/Blocker-Tiefendifferenz
    (orthografische Kaskaden = linearer Tiefenraum), entkoppelt vom Acne-`bias`.
  - Deterministische 16-Tap-Sunflower-Blocker-Suche statt fester ±2-Taps — kein run-to-run-Flip.
  - `shadows.md` + ADR 0006 ehrlich aktualisiert: echte Kontakt-Härtung (scharf am Caster) ist
    geometriebedingt noch nicht erreicht (feste Suchscheibe) → Roadmap adaptive Suche/Dünn-Occluder.
- **Gate-Regression (2×):** `SWM42 GATE: OK` mit **bit-identischen** Metriken (changed 4698,
  maxDelta 52.86, meanAbsDelta 21.94, dominantSign „lighter", dominantFraction 0.7746,
  outsideHalo 0) — Determinismus bewiesen; WebGL2 exakt 0 (No-Op). Richtungs-Check auf
  „directionNotNoise >= 0.55" umgestellt (verbreiternde Feder ist inhärent zweiseitig).

### 2026-10-21
- Showcase 42 angelegt (Phase „Showcase-Live-Gate" der Soft-Shadow-Roadmap).
- Registriert in vite.config.ts (Rollup-Input), AbstractShowcase VALID_SHOWCASE_IDS,
  scripts/check-showcases.js.
- Gate `.agents/scratches/check-swm42.mjs` GEMEINSAM MIT dem Zahlen-Dossier, Beweislauf GRÜN
  (`SWM42 GATE: OK`):
  - WEB_GPU: CPU→GPU-Verdrahtung bewiesen (GlobalUniforms-Lane [212,213] = [1,4] → [3,12]);
    5362 geänderte Pixel, meanAbsDelta 27.9, 100 % lokalisiert in der Penumbra-Halo
    (outsideHalo = 0), Richtungskohärenz 98.6 %, ein echter Schatten ist sichtbar (deepShadow≈465k).
  - WEB_GL2-Negativkontrolle: exakt 0 geänderte Pixel → Knöpfe sind bewiesen eine WebGPU-No-Op.
  - Ehrliche Grenze: Das Vorzeichen der Fringe-Verschiebung kann zwischen Läufen kippen
    (Änderungsmenge deterministisch, numerische Kippe der groben PCSS-Implementierung). Das Gate
    prüft signifikant lokalisiert + kohärent, nicht das Vorzeichen. Roadmap Phase 2+ (EVSM/EVSSM,
    MSM, echtes Contact-Hardening) adressiert die Stabilität.
- **Wichtige Neben-Befunde des Gates (Engine-Fixes aus dem Live-Gate):**
  - `structs.wgsl` (Commit 5f71a6ce) hatte einen Syntaxfehler (`shadowSoftness: vec4f` ohne
    Trenn-Komma zu `clusterDims`) → WGSL-Kompilierung brach auf jeder WebGPU; von der
    TS-Layout-Test-Pin nicht erkannt. Live-Gate gefangen + gefixt. Lehre: Nur ein echter
    GPU-Kompilierungslauf verifiziert WGSL-Syntax.
  - WebGPU headless braucht Chromium-Flag `--enable-unsafe-webgpu`, sonst liefert
    `requestAdapter()` null → Engine fällt still auf WebGL2 zurück. Da das Repo-Gate
    `check-showcases.js` dieses Flag nicht setzt, war die bisherige „WEB_GPU"-Abdeckung über alle
    Showcases faktisch blind (stiller GL2-Fallback). Möglicher Folgescope: Flag + Backend-Verifikation
    in `scripts/check-showcases.js` einziehen.
  - Engine-`Plane` startet vertikal (XY, Normal +Z) — Böden brauchen `rotation.x = -Math.PI / 2`
    (Showcase 42 nutzt dieselbe Konvention wie Showcase 39).
