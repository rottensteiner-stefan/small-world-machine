# Showcase 37 — Projekt Raum · Rustic Interior · Living Log

## Zweck

Warme, rustikale Innenraum-Technikdemo (Clustered Forward+ PBR, HBAO, Bloom, Filmic Grading): eine
gemütliche Wohnstube, deren tragendes Licht der **Kamin im Feuerraum** ist. Seit dem Umbau brennt
dort das geteilte `Fire`-Kompositions-Prefab aus `@small-world-machine/vfx-extras` — der erste
Showcase-Einsatz des Prefabs neben 38 und the-whisper (Rule of Three: 37/38/the-whisper).

## Setup-Entscheidungen

- **Prefab statt Einzel-Schichten:** Flamme, Glow, Praktikallicht, Embers, Glutbett und Ruß-Decals
  kommen aus EINEM `new Fire({ preset: "campfire", ... })`; die Szene treibt es einmal pro Frame aus
  ihrem `update()` (`fire.update(deltaTime, camera.position)`).
- **Szenen-Licht bleibt Szenen-Licht:** Das Kamin-Licht (`fireplaceLight`) wird der Szene injiziert
  und über `light:` an das Prefab übergeben — `preserveLightColor` hält dessen autorische Farbe,
  das Prefab übernimmt nur Antrieb (Flackern + Positions-Jitter). Der `__qaSwm37`-Hook liest live
  `_fireplaceLight.intensity`, damit das automatisierte Gate die Lebendigkeit (Oszillation)
  nachweisen kann.
- **Sealed firebox → kein Rauch:** `data: { ..., smoke: false }`. Ohne sichtbaren Kaminzug clippt
  die Rauchfahne in die Esse und das distance-6-Feuerlicht bläst die Puffs zu einer hellen Wand
  über die Öffnung auf (per Pixel-Probe gemessen). Flamme/Glow/Embers/Glutbett/Ruß tragen das
  Feuer; Rauch bleibt eine Showcase-45-Demonstration.
- **WEB_GL1-Ruß:** Das Soot-Decal ist dort (ADR 0029) in die Boden-Geometrie gebacken
  (`bakeSceneDecals`), nach dem die Szene vollständig existiert.

## Bekannte Grenzen (honest)

- Raumhöhe/Szenenmaßstab sind für die Kamera-Perspektive des Wohnzimmers gebaut; der Feuerraum ist
  ein von Hand platzierter Architektur-Ausschnitt, kein prozeduraler Kamin.
- Stand 2026-10-30: einziger Changelog-Eintrag ist der Prefab-Umbau — der Log wurde erst mit dem
  Fire-Prefab angelegt (Prozess-Umstellung, ältere Showcase-Historie liegt in den Git-Commits).

## Changelog

### 2026-10-30 — Kamin-Feuer auf das `Fire`-Kompositions-Prefab

- **Prefab-Integration (`apps/showcases/37/showcase.ts`):** Feuerraum (Boden/Rückwand/Seiten +
  5 Holzscheite) erhält ein `HearthFire`-Campfire-Prefab inkl. Embers, Glutbett und Ruß-Decals;
  Licht (`fireplaceLight`, distance 6) wird injiziert + preserved. Treiben liegt exklusiv im
  Szene-`update` (kein Doppel-Treiben).
- **QA-Gate (`__qaSwm37`):** `sample()` (Kerze/Feuer/Flamme) + `faceHearth()` (Kamera in die
  Feuermündung) für das automatisierte Live-Gate und die Art-Pass-Captures.
- **live-Gate (`.agents/scratches/check-swm37.mjs`):** ✅ alle 3 Tiers (WEB_GL2/WEB_GPU/WEB_GL1) —
  keine Fehler, Canvas nicht leer, QA-Schleife nachgewiesen oszillierend (Kerzenlicht 0.46–0.60,
  Kaminlicht 0.92–1.71, Flamme 2.79–3.36), Hearth-Capture gerendert.
- **Pixel-Verifikation:** Flamme liest als Feuer (Kern 188–223 R, R≫G>B), glühendes Glutbett,
  dunkle Innenwände, warm beleuchtete Rückwand mit physikalischem Falloff — kein „Glühbirnen"-
  Artefakt, keine Überstrahlung (0.0 % weiße Pixel).
- **Gates:** `tsc`, `lint:fix`, Volllauf grün.
