# Showcase 38 — Al-Khazneh · Grand Hall · Living Log

## Zweck

PBR-Demonstration der Felsenfassade **Al-Khazneh** (Petra) mit 5 Kamera-Presets: Siq-Canyon,
Plaza, Portico, Inner Sanctum und Rear Shrine. Die Halle ist seit dem Prefab-Umbau von 10
Wandfackeln und einem zentralen Schmiedeeisen-Brazier durchgängig mit dem geteilten
`Fire`-Kompositions-Prefab aus `@small-world-machine/vfx-extras` beleuchtet (neben 37 und
the-whisper — Rule of Three) und besitzt den ersten **Praktikallicht-Budget**-Einsatz einer
Szene.

## Setup-Entscheidungen

- **Prefab-Standardisierung:** Alle 11 Feuer (Portico/Sanctum/Shrine/Seitenräume + Center
  Brazier) werden über `_addFire()` aus EINEM `new Fire({ ... })`-Aufruf aufgebaut; Flame/Glow/
  Praktikallicht sind EINER übergreifenden Budget-Logik unterstellt, die Szenen-Geometrie der
  Fackeln/Brazier bleibt hand-authorisiert.
- **Praktikallicht-Budget (`FireLightBudget`, maxActive 11):** Nur die der Kamera nächsten
  registrierten `lightBehavior`s leuchten als echte Punktlichter — WEB_GL1/2 shaden max. 16, eine
  Halle mit 11 gleichzeitigen Feuern hätte das Hardware-Limit gerissen. Das Budget läuft als
  Camera-Behavior (installiert nach `start()`, damit es den FlyController nicht kapert).
- **Golden-Freeze-kompatibel:** `_applyFlicker()` setzt für den Golden-Capture `flicker = 0` auf
  alle registrierten Feuern (deterministischer, frierbarer Zustand), `update()` treibt die Prefabs
  einmal pro Frame mit der Live-Kamera.
- **QA-Gate (`__qaSwm38`):** `sample()` (registrierte Fires, Licht-Intensitäten, Flame-Times) +
  `applyPreset(i)` für das automatisierte Live-Gate und gezielte Torch/Brazier-Captures.
- **Ruß/Soot:** nur der zentrale Brazier raucht (`smoke: true`), die Wandfackeln tragen Flamme/
  Glow/Embers — die große Halle bleibt crisp.

## Bekannte Grenzen (honest)

- Der unter GL2/SwiftShader-Headless gemessene Leuchtstil fällt auf realer GPU durch Tone
  Mapping/Grading anders aus — die Golden-Baseline ist die verbindliche Referenz.
- Stand 2026-10-30: einziger Changelog-Eintrag ist der Prefab-Umbau — der Log wurde erst mit dem
  Fire-Prefab angelegt (ältere Showcase-Historie liegt in den Git-Commits, u. a. die E10-Bake der
  pbr38-Goldens).

## Changelog

### 2026-10-30 — Hallen-Beleuchtung auf das `Fire`-Prefab + Praktikallicht-Budget

- **Prefab-Umbau (`apps/showcases/38/showcase.ts`):** 10 Wandfackeln + Center-Brazier von
  eigenständigen PointLight/Emissive-Teilen auf den `Fire`-Prefab umgestellt; `_addFire()`
  registriert jedes `lightBehavior` im Budget und hängt world-anchored Parts an den Scene-Root;
  `update()` treibt alle Prefabs einmal pro Frame mit der Live-Kamera; `PointLight`-Import entfernt.
- **Verifikation (live-Gate `check-swm38.mjs`):** ✅ alle 3 Tiers — 11 Fires registriert, keine
  Fehler, Canvas nicht leer, Lichtsumme oszilliert (35.0–38.5), Flame-Clocks steigen (Prefab wird
  wirklich getrieben, kein eingefrorener Zustand).
- **Pixel-Verifikation (Fokus-Shots Preset 4/5):** lodernde gelborange Flammen-Kerne an Fackel-/
  Brazier-Positionen (Spitzen 254,20 0, R≫G>B, kein weißer Clip 0.0 %), dunkle Nicht-Feuer-Flächen,
  großflächige Warmsäume der bedeuchteten Halle — liest als Feuer, kein Bulb-Artefakt.
- **pbr38-Goldens regeneriert:** alte Baseline (Commit `9f5b97c4`, 25.10.) stammt vom
  Vor-Prefab-Stand; gegen den neuen Build weichen alle 5 Zellen ab (2.6–61 %, portico/sanctum/
  shrine am stärksten → die angezündeten Feuern beleuchten die Halle). Neue deterministische
  Baseline committet (zweiter Capture-Lauf byte-identisch, eine Zelle 0.0001 % < 0.5 %-Schwelle).
- **Gates:** `tsc`, `lint:fix`, build, Volllauf, whisper/37-Gates grün.
