# Showcase 37 — Projekt Raum · Rustic Interior · Living Log

## Zweck

Warme, rustikale Innenraum-Technikdemo (Clustered Forward+ PBR, HBAO, Bloom, Filmic Grading): eine
gemütliche Wohnstube, deren tragendes Licht der **Kamin im Feuerraum** ist. Seit dem Umbau brennt
dort das geteilte `Fire`-Kompositions-Prefab aus `@small-world-machine/vfx-extras` — der erste
Showcase-Einsatz des Prefabs neben 38 und game-app (Rule of Three: 37/38/game-app).

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

### 2026-11-02 — Room-light HUD: dimmers, scenes, fire strength, candles

- **`Hud.ts` (new, shared `ShowcaseDrawer`, key `I`):** scenes (Abend / Kaminabend / Lesen / Nacht,
  `Shift+1…4`), dimmers Pendel (`1`), Stehlampe (`2`), Kamin (`4`) — keys toggle off ↔ last level;
  candles (`3`, Auspusten one-by-one / Anzünden all).
- **`lighting.ts` (new):** `RoomLightState`, `LIGHT_SCENES`, `fireStrengthParams()` — linear ramps
  anchored so `DEFAULT_FIRE_STRENGTH = 0.6` reproduces the authored hearth exactly (scale/flame/glow/
  light = 1, 1950 K); 0 = ember bed only (flame cards off, no sparks), 1 = roaring. Tests in
  `tests/lighting.test.ts`.
- **Dimmers scale light AND shade emission**; the shared candle light scales with lit candles.
- **Candle wisps:** per-candle `FireSmokeEmitter` burst on blow-out (needs new
  `FireSmokeEmitter.emitting`: stop spawning, keep simulating). Look is NOT final — see BACKLOG
  (bead-string rings; hearth-scale `SmokeSpriteMaterial`).
- **QA hook additions:** `lights()`, `applyScene()`, `setFire()`, `blowOutCandle()`, `faceCandles()`.
- **Open (BACKLOG):** black slab covering the hearth mouth in the `faceHearth()` view (geometry, not
  traced yet).

### 2026-11-03 — Commit + console check

- Committed as `60bcf019` (path-scoped, 7 files incl. `FireSmokeEmitter.emitting` + test), pushed with
  `25c7ef16`.
- Console check on the dev server: WEB_GPU, WEB_GL2 and WEB_GL1 each with all four scenes, a candle
  blow-out and fire strength 1 — no errors or warnings (only the engine banner).

### 2026-11-03 — Water glasses on coffee table

- **3 Filled Water Glasses (`apps/showcases/37/showcase.ts`):** Placed organically on the coffee
  table to the left of the candle tray (`[-0.26, 0.12]`, `[-0.36, -0.02]`, `[-0.22, -0.14]`).
- **Glass Tumbler Geometry & Material:** Solid base cylinder (`height: 0.01`), slightly tapered
  outer wall (`openEnded: true`, `radialSegments: 24`, `radiusBottom: 0.026`, `radiusTop: 0.033`,
  `height: 0.095`), and a horizontal `Torus` top rim (`tube: 0.0012`) for specular edge glints.
  Material is `GlassMaterial` (`ior: 1.52`, `roughness: 0.02`, `transmission: 0.98`, `cullMode: NONE`).
- **Water Column & Meniscus:** Each glass filled to distinct realistic levels (78%, 55%, 88%).
  Water cylinder with top cap and horizontal `Torus` meniscus ring (`tube: 0.0009`) at the water line.
  Material uses `GlassMaterial` (`ior: 1.333`, `color: (0.86, 0.94, 0.98)`, `transmission: 0.95`,
  `roughness: 0.02`, `cullMode: NONE`) for physically transparent refraction and highlights.
- **QA Hook Addition:** `faceGlasses()` in `__qaSwm37` re-orients the camera to close-up framing
  above the coffee table for visual verification.
- **Gates:** `npm run lint:fix`, `npm run build:lib`, and full `npm run test` (579 files, 4683 tests) pass cleanly.
