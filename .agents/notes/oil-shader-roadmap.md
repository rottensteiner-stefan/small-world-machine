# Oil Shader Roadmap (rekonstruiert)

> **Status:** REKONSTRUIERT am 2026-10-10 — das Original dieser Datei ist verloren gegangen; die Inhalte wurden aus den Code-Kommentaren in `apps/sample-apps/the-whisper/scenes/character-diorama/OilSlickMaterial.ts` / `OilSlick.frag.{wgsl,glsl,glsl100}` sowie aus Golden-Baselines (`petroleum-oil__*`) rekonstruiert. Alle Behauptungen sind gegen den aktuellen Zustand geprüft (`[MEASURED]`). Das Dokument wird durch den Kollaborationsplan `.agents/collaborate/oil-puddles.md` (Konsens P1, 2026-10-10) fortgeführt.

## Kontext

Produktives Ziel: eine **sesshafte, viskose Öl-Pfütze** im „Graphic Noir“-Stil (Dishonored × Disco-Elysium × Little-Nightmares) am Boden, nicht eine animierte Flüssigkeit. Der Shader ist App-lokal gebaut (`character-diorama`), transparent, wertet Beleuchtung mit perturbierten Normalen (Meniskus), sammelt per `u_opaqueMap` den echten Boden unter der Pfütze und generiert Splatter-/Kontur-Masken prozedural.

## Phase 1 — `floorVisibility` (transluzenter Film-Rand)

- Zweck: Der dünne Rand der Pfütze soll als **transluzente Öl-Haut über echtem Boden** lesen, statt als flache prozedurale Kante.
- Umsetzung: `u_isTerrain`-Slot als `floorVisibility` umgewidmet; `u_opaqueMap`-Sampling (live-erfasster opaker Farbpuffer, Muster von `LiquidWaveMaterial`/`OpenWaterMaterial`); Tönung des echten Bodens mit dem Farbton der Randfarbe (`edgeHue`-Normalisierung, NICHT rohe Magnitude — sonst Crushing auf Schwarz). `[MEASURED: OilSlickMaterial.ts, OilSlick.frag.*]`
- Sichtbarkeits-Regel: Rand-Overlay erst NACH dem Beleuchten (sonst doppelte Abdunkelung) `[MEASURED: OilSlick.frag.wgsl:168-171]`.

## Phase 2 — Analoge Umgebungsreflexion (kein echter Cubemap)

- Zweck: graziende Glints sollen wie „reflektierte Umgebung“ lesen und sich farblich von der warmen Lampenglanze (`highlightColor`) unterscheiden.
- Umsetzung: konstante, gedimmte analytische Reflexion über Schlick-Fresnel; `envF0 = 0.0204` = Khronos `KHR_materials_ior`-Wert für IOR 1.333 (Öl/Wasser); Tönung kühl-basementsfarben (0.05, 0.06, 0.08); gesteuert über die ungenutzten `u_pad1-3`/`u_reflectivity`-Slots. `[MEASURED: OilSlickMaterial.ts:191-198, OilSlick.frag.wgsl:156-164]`
- Grenze (dokumentiert): keine reale Cubemap/Planar-Reflexion; Szenario hatte keine. → Nachfolger (Kollaborationsplan): echte envMap-/Planar-Route.

## Phase 3 — Dünnfilm-Schimmer (farblich, keine Geometrie)

- Zweck: langsamer wandernder Irideszenz-Schimmer auf der Oberfläche; die Pfütze „bewegt sich nie“, nur der Schimmer driftet.
- Umsetzung: **zwei unabhängig gegeneinander scrollende Noise-Schichten** (gegensätzliche Richtungen/Geschwindigkeiten — Godot-Referenz, siehe `oil.md`), kombiniert zu `swirl`, daraus Dicken-Variation `thickness = 0.5 + swirl*0.5`, dann per `thinFilm(NdotV, thickness, strength)`. `[MEASURED: OilSlick.frag.wgsl:137-148]`
- Bewusst keinerlei Normalen-/Geometrieperturbation („sesshafte Pfütze“) — Meniskus ist die einzige Normalen-Abweichung.

## Abschnitt 6.3 — Dünnschicht-Interferenz (`thinFilm`)

- Umsetzung seit letzter Iteration: **physikalisch motivierte Zwei-Strahl-Approximation** im KHR_materials_iridescence-Stil statt beliebiger phasengeschobener Sinus-Reihen:
  - echte Fresnel-Reflektanz an BEIDEN Interfaces (Luft→Film `r1`, Film→Basis `r2`),
  - Snell-Brechung in den Film (`sinΘ2² = sinΘ1²/IOR²`),
  - optische Weglänge `OPD = 2·IOR·d·cosΘ2`,
  - Per-RGB-Wellenlängen-Phase (650/550/450 nm),
  - klassische Interferenzformel `I = R1 + R2 + 2·√(R1·R2)·cos(phase)`,
  - Kanalmischung auf beides: `mix(luminance, raw, strength)` → **Desaturations-Steuerung als Stil-Regler**.
- Konstanten: `iridescenceIor = 1.3` (KHR-Default), `filmF0 = 0.0169` = ((1.3−1)/(1.3+1))², `baseF0 = 0.0204` (Öl/Wasser, IOR 1.333), `thickness 100–400 nm`.
- **Nicht** implementiert: Belcour & Barla (2017) Spektral-/Airy-Summe — bewusste Entscheidung `[JUDGMENT]`, die Zwei-Strahl-Approximation genügt stilistisch.
- Quelle: https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_iridescence

## Fortsetzung & Lücken (→ `oil-puddles.md`, Konsens P1)

- Hell-gesättigte Cosinus-Palette in `packages/liquid-extras/.../OilSlickMaterial.ts` widerspricht der Style-Vorgabe „Muted Thin-Film“ (v2) — stiller Konflikt, wird im Kollaborationsplan (WP-2, Pfad-A-Reparatur) durch das kanonische gedämpfte Modul ersetzt.
- App-Lokalismus: Der Shader ist `the-whisper`-spezifisch — wird laut Plan als `OilPuddleMaterial` (v1–v6-Presets, Benzin/Diesel) nach `@small-world-machine/liquid-extras` gehoben (WP-3), Reflexion auf echte envMap/Planar-Route (WP-4).
- `oil.md` (Godot-Referenz) ebenfalls verloren und rekonstruiert (siehe `.agents/notes/oil.md`); Verweise im Code zeigen auf beide Dateien.
