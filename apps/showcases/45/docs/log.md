# Showcase 45 — Fire VFX Lab · Living Log

## Zweck

Labor- und Abnahme-Szene für den Feuer-Plan (`.agents/scratches/fire-plan.md` v2, lokal). Wächst
phasenweise mit: P1 Flammenkörper + Glow, P2 Licht/Flackern, P3/P4 Funken, Rauch, `Fire`-Komposition,
P6 Goldens. Nachtszene vor einer Steinwand, damit Emission, Bloom und Lichtwurf ablesbar sind.

## Inhalt

- Drei Wandfackeln: Blackbody (2000 K), `FlamePalettes.SPECTRAL` (Gespensterblau), `FlamePalettes.WISP` (Irrlichtgrün).
- Kleines Lagerfeuer (3 Cards, 0,5 × 0,8 m, 5 Scheite) und eine Kerze.
- Je Flamme: `FireMaterial` auf `createFlameCardGeometry`, `FlameGlowMaterial` auf einem Billboard-`Plane`, ein `PointLight`.
- Renderer-Wechsel: Alt+1 WebGL1, Alt+2 WebGL2, Alt+3 WebGPU.

## 2026-10-29 · P1: Flammenkörper + Glow

- `packages/vfx-extras/src/fire/`: `FireMaterial` (GLSL300/GLSL100/WGSL), `FlameGlowMaterial`, `createFlameCardGeometry`.
- Gate bestanden: Extras-Pakete registrieren eigene Shader über `getShaderDefinition()` (Präzedenz
  `liquid-extras`); `BlendingMode.ADDITIVE` über `state.blending` wird von WebGL- und WebGPU-Pfad
  bereits ausgewertet, keine Engine-Änderung nötig.
- Flamme: zwei aufwärts scrollende Value-Noise-fBm-Lagen (A verzerrt B), Tropfenmaske, höhenabhängige
  Erosion (Basis geschlossen, Spitze reißt in Zungen), 3-Stopp-Ramp. Edge-Fade nach Blickwinkel
  versteckt seitlich gesehene Cards. Lean über `lean` (Welt-Vektor) entlang `cross(up, n)`.
- Farbe: Standard ist Blackbody aus `temperatureK` (Kern ×1,4, Spitze ×0,65). Optional `palette`
  übersteuert (Nutzerwunsch: gespenstisch blau/grün). Glow analog per `tint`.
- Erste Iteration war ein dünner, überstrahlter Strich; Form verbreitert (halfWidth 0,46),
  Erosion verstärkt, Kanten härter, Standard-Intensität 4 → 2,5.
- Browser-Check alle drei Tiers ohne Konsolenfehler. Beobachtung (nicht Feuer): Die
  Standard-Beleuchtung ist auf WebGL1 deutlich heller als auf WebGL2/WebGPU.
- Abweichung vom Plan: Noise lebt lokal in den Fire-Shadern statt als Engine-Chunk `noise_fbm` —
  aktuell nur ein Konsument, die Rule of Three (ADR 0047) rechtfertigt den geteilten Chunk noch nicht.
- Bekannte Lücken: kein Nebel-Einfluss auf additive Flammen; Licht flackert noch über
  `FlickerBehavior` (Phasenmodell) bis `FireLightBehavior` (P2) kommt.

## 2026-10-29 · P2: Feuerlicht, Flackern, Licht-Budget

- `FireFlickerProfile`: kontinuierliches Profil (Hüllkurve 1,1/2,7 Hz + Mikrozittern 13 Hz), Wertebereich
  0,25–1,15, nie stabile Phase. Eigenes Integer-Hash-Value-Noise statt `Noise` (die Engine-`Noise`
  ist per `Math.random` initialisiert, also nicht reproduzierbar) und statt sin()-Hash (weicht
  zwischen JS-Engines ab) → reine Funktion von (Seed, Zeit), Golden-tauglich.
- `FireLightBehavior` am `PointLight`: Intensität × Profil × Budget-`fade`; Farbtemperatur folgt
  (×0,86 gedimmt … ×1,08 hell) nur wenn `temperatureK` gesetzt ist — Palettenfeuer behalten ihre
  Lichtfarbe. Positions-Jitter über Noise (2,3 Hz) statt Sinus-Summen (sichtbare Periodik).
  `value` wird gelesen, um Flamme (±10 %) und Glow (±20 %) synchron atmen zu lassen.
- `FireLightBudget` an der Kamera: nur die nächsten N Feuer sind echte Lichter, der Rest fällt per
  `isVisible = false` aus der Lichtliste (Intensität 0 würde auf WebGL1/2 trotzdem einen der 16
  Slots belegen). Ein-/Ausblenden über 0,5 s.
- Szene: 10 zusätzliche Wandfackeln (Wand 44 m) → 19 Feuer > 16 GL-Slots; Budget 10. Erste Wahl 8
  ließ in der Startansicht eine sichtbare Fackel (x = 8, Gleichstand mit x = −8) unbeleuchtet — wirkte
  wie ein Bug, daher 10.
- Texturen (Nutzerwunsch): `carved_masonry` (Wand) und `torch_wood` (Schäfte, Scheite) aus
  Showcase 38. Boden zuerst `paved_flagstone` (38) — gefiel nicht; ersetzt durch Steinplatten
  `stone_ashlar` aus dem Flakturm-Kit (`public/assets/kits/flakturm/textures/stone_ashlar/`).
  Alles nach `45/assets/` kopiert, damit der Showcase eigenständig bleibt.
- Browser-Check WebGPU/WebGL2/WebGL1 ohne Konsolenfehler.

## 2026-10-29 · Fixes: Navigation, Kamerabewegung · CURSED, variierte Fackelreihe

- **Keine ◀/▶-Buttons:** `AbstractShowcase` erzeugt sie nur für IDs in `VALID_SHOWCASE_IDS`; 45 fehlte
  dort und in `check-showcases.js` (Smoke-Test). Nachgetragen; `showcaseWiring.test.ts` prüft jetzt
  beide Listen und die Vite-Inputs gegen die vorhandenen Showcase-Ordner.
- **Keine Kamerabewegung:** `AbstractShowcase.start()` installiert den Fly-Controller nur, wenn die
  Kamera noch keine Behaviors hat. Das `FireLightBudget` hing schon in `setupScene()` an der Kamera →
  Controller fiel weg. Budget jetzt erst nach `super.start()`.
- Vier Vergleichsfackeln: Blackbody, SPECTRAL, WISP, CURSED.
- Fackelreihe deterministisch variiert (Integer-Hash je Fackel): 1850–2200 K, Größe ×0,85–1,15,
  Unruhe 0,8–1,25, Flussgeschwindigkeit 0,85–1,2. Licht und Glow übernehmen die Temperatur.

## 2026-10-29 · Showcase-Navigation ohne ID-Listen (Nutzerentscheidung)

- Nutzervorschlag `INVALID_SHOWCASE_IDS` statt `VALID_SHOWCASE_IDS`; Gegenvorschlag angenommen: Die
  ◀/▶-Buttons folgen den ohnehin vorhandenen `prev`/`next`-Attributen (kuratierte Tour, per Test als
  geschlossener Ring erzwungen). Das `showcase-layout`-Plugin schreibt sie als `data-prev`/`data-next`
  an `<header id="info">`, `AbstractShowcase` liest sie aus. `VALID_SHOWCASE_IDS` entfällt.
- Vite-Rollup-Inputs (`showcaseInputs()` in `.agents/scripts/lib/dev-redirects.ts`) und die
  Smoke-Liste in `check-showcases.js` lesen die Showcase-Ordner von der Platte. Ein neuer Showcase
  braucht damit nur noch: Ordner, `prev`/`next` in der Tour-Kette, Galerie-Kachel + Zähler, Tour-Liste
  im Wiring-Test.
- Verhaltensänderung: ◀/▶ springen jetzt in Tour-Reihenfolge statt numerisch.

## 2026-10-29 · Fire-Lab-Panel (HUD) · `FireLightBehavior.flicker`

- Korrektur zum P2-Eintrag: Es waren 15 Feuer, nicht 19 (10 Reihe + 3 Vergleich + Lagerfeuer + Kerze);
  mit `CURSED` jetzt 16.
- Neues Seitenpanel `FireLabHud.ts` (Muster `swm-inspector-drawer` wie 38/44): Live-Readout, Vorher/Nachher-Schalter
  (Flackern, Flamme, Glow, Lichter, Bloom), Zeit (Pause, ×0,1–×2), Farbe (Original/Blackbody/Spectral/Wisp/Cursed),
  Flamme (Temperatur, Intensität, Unruhe, Fluss), Wind (Stärke, Richtung), Licht-Budget (Regler, Markierung
  unbeleuchteter Feuer), Tag/Nacht. Einstellungen skalieren den authored Look jedes Feuers, überschreiben ihn nicht.
- `FireLightBehavior.flicker` (0..1, Bibliothek): 0 = ruhiges Licht für den A/B-Vergleich. Temperatur-Abbildung
  stückweise linear, damit Basisintensität exakt Basistemperatur ergibt.
- Zeitlupe/Pause erreichen auch das Licht: Die Behaviors laufen mit `isActive = false` und werden in
  `update()` mit skalierter Zeit über `time`/`apply()` getrieben.
- Tastenkürzel layoutneutral (deutsches Mac-Layout hat kein `=`, `[ ]` nur mit Alt): Symbole über
  `event.key` (`+ - , .`), Buchstaben/Ziffern über `event.code`. Tempo: T (Zyklus).
- Wind kippt jede Flamme starr um ihre Basis. `FireMaterial.lean` verschiebt die Flamme innerhalb jeder Card
  und spaltet gekreuzte Cards (die Card quer zum Wind kann sich nicht neigen) — sichtbar als zwei Zungen.
  Saubere Lösung: Vertex-Scherung in Weltkoordinaten, geplant mit der getragenen Fackel (P4).
- Fallstrick vermieden: Lichter bekommen eine Kopie der Palettenfarbe, sonst schriebe `FireLightBehavior`
  beim Umschalten auf Blackbody in die globale `FlamePalettes`-Konstante.
- Bekannt: Das Panel überdeckt den ▶-Button (gleiches Verhalten wie Showcase 44).

## 2026-10-29 · Flammenspitzen enden nicht mehr auf einer Linie (Nutzer-Feedback)

- Befund (Nutzer, Nahaufnahme Lagerfeuer): Alle Zungen enden auf derselben Höhe. Ursache: Die Tropfenmaske lief
  erst bei `y = 1` auf null, schmale Zungen in Kartenmitte reichten bis an den oberen Quad-Rand und wurden dort
  hart abgeschnitten.
- Fix (alle drei Shader): Form verjüngt sich bis `y = 0,95`, und jede Spalte brennt bei einer eigenen, langsam
  wandernden Höhe aus (`tip = 0,68 + 0,27 · noise(x, t)`, weicher Auslauf über 0,2). Erste Variante (0,6–0,92)
  machte die Flamme sichtbar kürzer und wurde nach oben verschoben.

## 2026-10-29 · Panel auf gemeinsamen `ShowcaseDrawer`, Datei `Hud.ts`

- Nutzerentscheidung: Jeder Showcase mit Panel bekommt `Hud.ts`; das kopierte Grundgerüst wandert nach
  `apps/showcases/shared/ShowcaseDrawer.ts`. 45 ist die Referenz: `FireLabHud.ts` → `Hud.ts` (git mv), Drawer,
  Event-Abschirmung, Footer-Button und I/H kommen aus dem Baustein; Slider-Wertlabels heißen jetzt `sl_<key>_val`.
- Browser-Check: I/H, Farbtasten, Regler, ein Footer-Button, keine Konsolenfehler.

## 2026-10-29 · P3: Glut/Funken-Schicht (Review-Punkt 1 — Partikel-Fundament)

- Umsetzung als Kollege-Übergabe (fire-session am 5h-Limit): nach Review-Grobplan „P3 zuerst, minimal“ —
  bewusst NICHT der volle P0-Umfang (kein Flipbook, kein voller `ParticleEmitter`, kein Custom-Shader).
- `FireEmberEmitter` (`packages/vfx-extras/src/fire/`): Welt-verankerte Glutspritzer auf der bestehenden
  `ParticleSystem`-SoA-Kette. Deterministisch (Integer-mulberry32, Provenienz in Kommentar, Engine-`SeededRandom`
  ist nicht Teil der Public API); Parameter aus der Flammengröße abgeleitet, Wahl über `options`.
  Pipeline: `GravityAffector` (Standard (0, −1,4, 0) — Glut senkt sich, kein pures 9,81) + `DragAffector`
  + `ColorOverLifeAffector` (heißes Orange → Ascherot, Alpha → 0). Der Alpha-Fade wird im Renderer in die
  Instanzgröße gefaltet → sanftes Erglühen statt harter Clip; daher bewusst KEIN `SizeOverLifeAffector`
  (der überschreibt `sizes` mit dem Roh-Scale und würde die Zufalls-Partikelgröße zerstören).
- Rendering-Architektur (Engine-Doktrin, alle Tiers):
  - `EmberSpriteMaterial`: `StandardMaterial` + `state.blending = ADDITIVE` + `skipDepthPrePass` (idempotent pro
    `getRenderManifest`-Call, da `_syncBaseManifestState` den State neu ableitet). Kein Emissiv: Emissiv wird
    flach addiert (`lighting_pbr.wgsl:339-340`) und male eine helle Quad-Silhouette; Instanzfarbe dagegen ist
    engine-garantiert als finale Multiplikation (`Standard.frag.glsl:133` / WGSL `tint`).
  - Radiale Glutsprite mit Falloff in **RGB** (nicht Alpha): additive `ONE,ONE`-Blending ignoriert Alpha.
  - `ParticleMeshRenderer` erweitert: `ParticleBillboardMode = "none" | "yaw" | "spherical"` + `sync(cameraPosition?)`.
    CPU-Look-at pro Instanz (Präzedenz `BillboardInstancer`), weil die Engine-`isSprite`-Pfade auf instanziierten
    Draws nicht laufen. Default `none` — bestehende Nutzer/Tests byte-identisch.
  - `GravityAffector` (`affectors/`): generischer Konstante-Beschleunigungs-Affektor, addiert auf `accelerations`.
- Tests (`FireEmber.test.ts`, 13): Determinismus (gleicher/differenter Seed), dt=0-Einfrieren, exakte Emissionsrate,
  Pool-Cap + finite Matrizen, Abkühlen/Ausfaden, Finitheit unter Drag+Gravity, Yaw-/Spherical-Billboard-Richtung
  (Spalten-2-Direktion, skalenunabhängig normalisiert), Dead-Slot-Kollaps auf Null-Matrizen, additiver Material-Vertrag.
- Buddies für spätere Integration: `ParticleBillboardMode` bekommt mit dem getragenen Feuer/anderen
  Billboard-Nutzern die nötige Konsumentenzahl (ADR 0047 Rule of Three).
- Showcase 45: Glut-Schicht für alle 16 Feuer; HUD-Schalter „Glut / Funken“ (Kürzel `H` — `E` ist die Flug-Aufwärts-Taste
  des `FlyController`), Teil des Vorher/Nachher-Blocks. Pause/Zeitlupe frieren die Funken ein; `enabled` + `isVisible`
  für sofortige A/B-Umschaltung.
- Bewusst NICHT in P3: Rauch-Schicht, Welt-Scherung (2b), Golden-Render-Gate (5), ADR/Guide (7) — nächste Schritte.
- Gates: `tsc`, ESLint, 80/80 vfx-extras-Tests, volle Suite grün (1 spurious Timeout in `lintAssets`, isoliert grün),
  `build:lib`, `check:doctrine` sauber.
- 2026-10-29 Hud-Namen: `FireLabHud`/`FireLabSettings`/`defaultFireLabSettings` → `Hud`/`HudState`/`defaultHudState`; Panel-Toggle nur noch `I` (`toggleKeys`), weil `H` seit der Glut-Schicht die Glut schaltet und vorher vom Drawer verschluckt wurde.

## 2026-10-29 · Punktlicht-Schatten (ADR 0052) · Wind über Welt-Scherung

- Schalter „Punktlicht-Schatten“ (X), Default an; die Engine wählt die nächsten zwei Feuer
  (`quality.maxShadowedPointLights`). Boden/Wand empfangen, Schäfte, Scheite, Kerze und eine Kiste werfen.
- Sichtprüfung WebGPU + WebGL2: Kontaktschatten direkt an den Holzscheiten (kein Ablösen nach dem
  Bias-Fix `d6890462`), Kistenschatten an der Wand, Kerze wirft einen Schattenteller um den Fuß
  (physikalisch korrekt, Licht 4,5 cm über dem Docht). WebGL1 ohne Schatten, ohne Fehler.
- Beobachtung: Lagerfeuer und Kerze liegen ~4,4 m von der Startkamera; welches Feuer den zweiten
  Schatten-Slot bekommt, kann mit dem Licht-Jitter wechseln (Hinweis für Goldens an antigravity).
- Wind: statt starrem Kippen jetzt `FireMaterial.lean` (Welt-Scherung von antigravity, `3b26b206`);
  Spitzenversatz = 0,55 × Flammenhöhe × Windstärke. Basis bleibt am Brennstoff, keine Kartenspaltung.
