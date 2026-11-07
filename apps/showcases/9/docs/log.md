# Showcase 9: 2.5D Jump & Run — Development Log

## 2026-11-01 · 2.5D Run & Jump Camera, Character Rig & Zero-GC Collision

### 1. Context & Motivation
Showcase 9 demonstriert ein 2.5D Jump & Run mit Code-basierter AABB-Physik und Kollision. Eine Überprüfung deckte folgende Mängel auf:
* **Verzerrte Kameraperspektive:** Durch die initiale Player-Position bei `y = 10` und die Kamera-Initialisierung bei `(0, 0, 15)` berechnete die `StiffStrategy` im ersten Frame einen Kugelwinkel von `phi = -33.5°`. Die Kamera blickte dauerhaft von schräg unten in den Himmel, wodurch Blöcke wie schwebende Decken wirkten und der Boden unten abgeschnitten war.
* **Unruhige Vertikalführung:** Bei jedem Sprung ruckelte die Kamera vertikal starr mit dem Spieler mit.
* **Spielfigur als gelber Punkt:** Der Spieler war lediglich eine unbeleuchtete gelbe Kugel ohne Laufrichtung oder Animation.
* **Hot-Path-Allokationen (Zero-GC-Verletzung):** `_getAABB` erzeugte in jedem Frame für jeden Block (40 Blöcke × 2 Pässe) jeweils 2 `Vector3D` und eine `BoundingBox` (~14.400 Allokationen/s im Frame-Loop).
* **Frame-Rate-Abhängigkeit:** Lineare Euler-Lerp-Berechnungen in der Dämpfung führten bei Framerate-Schwankungen zu abweichendem Verhalten.

### 2. Implemented Features & Optimizations
1. **Klassische 2.5D Run & Jump Kameraperspektive (`CameraStrategyType.MANUAL`):**
   * Frontaler Blickwinkel mit dezenten 5° Neigung von oben (`pitch = MathUtils.degToRad(5.0)`).
   * Begehbare Oberseiten der Ziegelblöcke sind räumlich klar lesbar; der Boden ist stabil im unteren Bildschirmdrittel verankert.
   * **Ruhiger Horizont beim Springen:** Die vertikale Zielhöhe `targetAnchorY` bleibt während des Fluges stabil und folgt nur bei echtem Bodenkontakt (`_isGrounded`) sanft auf erhöhte Plattformen.
   * **Sanfter Vorlauf (Lookahead):** 1.5 Einheiten vorausschauende Führung in Blickrichtung; Levelgrenzen geklemmt auf `[4.0, 15.0]`.
2. **3D-Spielfigur:**
   * Gelber Punkt ersetzt durch eine geriggte Mixamo-Spielfigur mit matten PBR-Materialien (`roughness: 0.88`, `metallic: 0.05`).
   * Bündig an Unterkante der 1x1-Kollisionsbox ausgerichtet (`scale: 1.2`, Offset `(0, -0.5, 0)`).
   * **Animation & Steuerung:** Skelettale Lauf- und Idle-Animationen via `AnimationMixer` mit Root-Motion-Stripping (`stripHipsTranslation`).
   * Geschmeidige Blickrichtungs-Drehung (`MathUtils.HALF_PI` für rechts, `-MathUtils.HALF_PI` für links) und dynamische Flugneigung (`rotation.z`).
   * Erweiterte Steuerung: Unterstützung von `A`/`D`/`Pfeiltasten` zum Laufen und `Space`/`W`/`Pfeil Oben` zum Springen.
3. **Zero-GC Kollision:**
   * Statische Block-Begrenzungen werden einmalig während `setupScene()` in `_staticBlockBounds` (`StaticBlockAABB[]`) vorberechnet.
   * Kollisionsabfragen im Frame-Loop arbeiten rein mit Skalarwerten (`pMinX <= b.maxX && pMaxX >= b.minX ...`).
   * Allokationen im Frame-Loop: **exakt 0**.
4. **Frame-Rate-unabhängige Dämpfung:**
   * Alle Dämpfungen auf exakten Exponential-Decay `_expDecay(rate, deltaTime) = 1.0 - Math.exp(-rate * deltaTime)` umgestellt (Kamera, Drehung, Sprungneigung, Animations-Blend).
5. **Honest Fallback:**
   * Fängt Asset-Ladefehler ab und schaltet im Fehlerfall auf einen giftgrünen Fallback-Würfel um, sodass das Spiel 100% spielbar bleibt.

### 3. Verification
* `npm run lint:fix`: 0 Fehler, 0 Warnungen.
* `npm run build:showcases` & `npm run build:lib`: Grün.
* `node .agents/scripts/check-showcases.js 9`: WebGL1, WebGL2, WebGPU alle ✅ OK.
* `npm run test`: Alle 499 Test-Suites (3845 Tests) bestanden.

## 2026-11-06 · Procedural Ducking, Crouch-Slide & Jump Squash & Stretch

### 1. Implemented Features
1. **Ducken & Crouch-Slide (`S` / `ArrowDown`):**
   * **Volumenerhaltendes Squash:** Bei gedrückter Taste staucht sich die Figur vertikal auf ~54% Höhe (`duckScaleY`), während sich `scale.x/z` leicht ausdehnt.
   * **Dynamische Hitbox:** Die obere Kante der AABB-Kollisionsbox senkt sich von `py + 0.5` auf `py + 0.04` (Höhe 0.54 statt 1.0), sodass die Figur unter niedrigen Decken durchrutschen kann.
   * **Ceiling Clearance Check:** Befindet sich die Figur unter einem Deckenblock, kann er sich erst wieder aufrichten, wenn der Freiraum über ihm frei ist.
   * **Crouch Slide & Crawl:** Aus dem Sprint/Lauf heraus gleitet die Figur mit Auslauf-Friktion über den Boden (`crouch slide`), mit Pfeiltasten kriecht er mit reduzierter Geschwindigkeit (`2.2`).
2. **Procedural Jump Feedback (Squash & Stretch):**
   * **Launch Stretch:** Im Moment des Absprungs streckt sich das Modell elastisch nach oben (`+42%`).
   * **Airborne Flight:** Beim Aufstieg dynamische Streckung; am Scheitelpunkt neutral; beim Abwärtsflug Vorwärtsneigung und dezente Fallstreckung.
   * **Mid-Air Drop / Fast Fall:** Drücken von `Down` in der Luft löst einen Fast Fall mit Kugel-Tuck aus.
   * **Impact Landing Squash:** Bei der Landung federt die Figur abhängig von der Aufprallgeschwindigkeit elastisch ein (`landing squash`) und schwingt per Exponential-Decay in die Ruhepose zurück.
3. **Zero-GC Konformität:**
   * Alle Berechnungen rein mit Primitiven (`number`, Skalarwerte), keine Allokationen im Frame-Loop.

## 2026-11-07 · Skeletal Jump, Crouch & Crawl Animations

### 1. Context & Motivation
Zur Ergänzung der bisher rein prozeduralen Squash/Stretch- und Dämpfungsverformungen wurden vollwertige skelettale Animationsclips für die Bewegungszustände der Figur integriert.

### 2. Implemented Features
1. **Asset Pipeline & Konvertierung:**
   * Download passender Mixamo-Skelettanimationen (`Jump`, `Crouch_Idle`, `Crouch_Walk_Forward`) aus dem offenen Mixamo-Humanoid-Datensatz.
   * Bereinigung der Armatures via Blender (Mesh Stripping für pure Animationstracks) und Export als kompakte `.glb`-Assets:
     * `apps/showcases/9/assets/jump.glb` (~120 KB)
     * `apps/showcases/9/assets/crouch.glb` (~96 KB)
     * `apps/showcases/9/assets/crawl.glb` (~89 KB)
2. **AnimationMixer Integration:**
   * Laden aller 5 Clips (`idle`, `running`, `jump`, `crouch`, `crawl`) via `Promise.all`.
   * Root-Motion-Stripping (`stripHipsTranslation`) auf allen Clips zur Vermeidung von Translation-Drift gegenüber der AABB-Physik.
   * Frame-Rate-unabhängiges Gewichts-Blending (`_expDecay(14.0, deltaTime)`) über alle 5 Lokomotionszustände (Idle, Jog/Sprint, Airborne Jump, Duck Idle, Duck Crawl).
   * Schritt-Synchronisation mit adaptiver `timeScale` beim Laufen und Kriechen.
3. **Verification:**
   * `npm run typecheck`: Bestanden (0 Fehler).
   * `node .agents/scripts/check-showcases.js 9`: WebGL1, WebGL2 und WebGPU alle ✅ OK.


## 2026-11-07 · CC0 Pixel Textures, Classic 16-bit Platformer Look (unlit)

### 1. Implemented Features
1. **CC0 Tileset-Quelle:** Texturen aus `TilesAlpha.png` eines CC0-16-bit-Plattformer-Tilesets (ATeshGames, OpenGameArt) — Lizenz verifiziert (CC0), Quelle in `REFERENCES.md` eingetragen.
2. **Assets (100×100, lossless WebP, opak, NEAREST):**
   * `grass.webp` — flach-grüne Oberfläche, Speckles aus echten Quellpixeln der soliden Graszeilen synthetisiert.
   * `dirt.webp` — nahtloses Dirt-Band, Innen-Fenster mit Basis-farbenen Kanten.
   * `turnblock.webp` — gelbe Turnblock-Fläche, per Connected-Component-Analyse zum Quadrat rekonstruiert (2px schwarzer Rahmen, Augen erhalten).
   * `stone.webp` — graue Steinfläche mit Bevel-Highlight, quadratisch gerahmt.
3. **Boden-Komposition:** Typ-1-Boden = Dirt-Körper (`0.85`) + Gras-Deckel (`0.15`) nur auf freiliegenden Oberseiten (Kollision bleibt 1×1; Deckel ist Child-Slab wegen Ein-Material-pro-Object3D-Grenze).
4. **Unlit-Pfad:** Alle Blöcke von `PhongMaterial` auf `BasicMaterial` (unlit, flach, lichtunabhängig) umgestellt — authentischer Flach-Look, auf allen 3 Renderer-Tiers identisch (Muster aus Showcase 10/49).
5. `index.html`-Beschreibung um CC0-Pixel-Textur-Hinweis ergänzt.

### 2. Known Limitations (dokumentiert, nicht gefixt)
* Ein Material pro `Object3D` + volle UVs pro Face: Turn/Stone-Blöcke zeigen das Face-Pattern auch auf Ober-/Unterseite (bei 5°-Neigung sichtbar). Optionale Folge-Option: 2-teilige Top-Slab-Variante (glatter Deckel) — Design-Entscheidung, noch offen.
* Gras-Deckel hat keine Zickzack-Kante (nur Silhouette Gras-auf-Dirt); Scallop-Detail der Vorlage geht in der Voxel-Komposition verloren.

### 3. Verification
* `npm run typecheck`: Bestanden (0 Fehler).
* `npm run lint:fix`: 0 Fehler.
* `npm run build:showcases`: Grün.
* `node .agents/scripts/check-showcases.js 9`: WebGL1, WebGL2, WebGPU alle ✅ OK (Screenshots non-blank, keine Console-Errors).
* In-Game-Screenshot (WebGL2) per Vision-Check: Pixel-Grasboden, Turnblocks & Steinblöcke klar erkennbar, keine kaputten Faces.
## 2026-11-07 · Turn/Stone Top-Slab Refinement

### 1. Implemented Features
* Behebt die im Textur-Meilenstein dokumentierte Einschränkung: Turn/Stone-Blöcke bestehen jetzt wie der Boden aus Textur-Körper (`0.85`) + Top-Slab (`0.15`) — die Oberseiten sind sauber einfarbig statt Face-Pattern.
* Top-Slabs sind flach-unlit (`BasicMaterial` mit Farbe, kein Textur-Asset, kein LFS-Add): Turn = Face-Gelb (`247,226,107`), Stone = Mittelgrau (`157,157,157`).
* Gemeinsamer Kompositions-Helfer `createBlockWithSlab` für Ground/Turn/Stone (3 semantische Konsumenten); Top-Slab nur bei freiliegender Oberseite (keine verdeckten Draws).
* Kollision, Level-Map und Physik unverändert (Komposition rein visuell, Gesamthöhe bleibt 1×1).

### 2. Known Limitations (Rest, dokumentiert)
* Unterseiten freischwebender Deko-Blöcke zeigen weiterhin das Face-Pattern (bei 5°-Kamera praktisch nie sichtbar; Gegenstück wäre eine Bottom-Slab — nicht umgesetzt, kein ausreichender Mehrwert).

### 3. Verification
* `npm run typecheck`, `npm run lint:fix`, `npm run build:showcases`: Grün.
* `npm run test`: 547 Test-Files / 4419 Tests bestanden.
* `node .agents/scripts/check-showcases.js 9`: WebGL1, WebGL2, WebGPU alle ✅ OK.
* In-Game-Screenshot (WebGL2) per Vision-Check: Oberseiten sauber einfarbig (kein Face-Pattern), Front-Faces mit Augen/Muster korrekt, keine Slabs/Lücken/Nahtfehler.

## 2026-11-07 · Original Block Faces & Local Character Override

### 1. Implemented Features
* **Eigene Block-Faces (Original-Pixel-Art, 20×20-Raster ×5 → 100×100, lossless WebP):** `smileblock.webp` (himmelblauer Smiley-Block: Bevel-Rahmen, runde Augen mit Glanzpunkt, Lächeln, Wangen) ersetzt den Turnblock; `stonebrick.webp` (versetzte Steinziegel mit Bevel) ersetzt den Stein. Top-Slabs in den neuen Grundfarben. Gras/Dirt bleiben aus dem CC0-Set.
* **Spielfigur entkoppelt:** Standard-Modell `assets/character.glb` (eigene Dino-Figur, Tripo3D + Mixamo). Optionaler lokaler Override (nur Dev, git-ignored): `assets/local/character.glb` + optional `character.json` (`scale`, `offsetY`), aufgelöst zur Build-Zeit per `import.meta.glob` — ohne Ordner keine Anfrage, kein Log.
* Basis-Skalierung für Squash/Stretch kommt aus der Platzierung (`_characterBaseScale`) statt fest `1.2`.

### 2. Verification
* `npm run typecheck`, eslint, prettier: Grün. `npm test`: 547 Test-Files / 4419 Tests bestanden.
* `npm run build:showcases` + `node .agents/scripts/check-showcases.js 9`: WebGL1, WebGL2, WebGPU alle ✅ OK.

## 2026-11-07 · Kenney CC0 Pixel Textures

### 1. Implemented Features
* **Neue Block-Texturen aus Kenney „Pixel Platformer" (v1.2) + „Pixel Platformer Blocks" (CC0):** `ground-top.webp` (Gras-Kante, `tile_0022` Zeilen 3–17 → passt zur 0.85-Body-Höhe), `ground.webp` (Erd-Füllung, `tile_0122`), `block-exclaim.webp` (Ausrufezeichen-Block, `tile_0010`), `block-brick.webp` (grauer Ziegel, `Rock/tile_0017`). 18-px-Tiles ×4 nearest-neighbour, transparente Ecken auf Outline-Farbe geflattet, lossless WebP.
* Ersetzt `grass.webp`, `dirt.webp` (CC0-Set ATeshGames) sowie die eigenen `smileblock.webp`/`stonebrick.webp`.
* **Komposition vereinfacht:** freiliegender Boden = Gras-Kanten-Body (0.85) + flacher Gras-Slab (`#36E377`, 0.15); verdeckter Boden jetzt volle Höhe (vorher 0.85 → 0.15-Lücke zwischen gestapelten Blöcken); Ausrufezeichen- und Ziegelblock als volle Würfel ohne Slab (Bevel-Tiles wirken auch oben als Block). `createBlockWithSlab` → `addBlockPart`.
* Original-ZIPs liegen per ADR 0058 außerhalb von git (Drive-Backup); Quelle, Lizenz und sha256 in `REFERENCES.md`.

### 2. Known Limitations
* `brick-1..3.webp` in `assets/` sind weiterhin unreferenziert (nicht angefasst).

## 2026-11-07 · Little Dino Character & Clip Normalization

### 1. Implemented Features
* **Neue Standard-Spielfigur `assets/character.glb`:** eigener kleiner Dino (Gemini-Konzept → Tripo3D → Mixamo-Auto-Rig, 28 Joints ohne Finger/Daumen, 780 KB). Ersetzt den grünen Fallback-Würfel auf Pages; `DEFAULT_CHARACTER_PLACEMENT` (`scale 1.2`, `offsetY -0.5`) passt unverändert, da das Modell auf 1.0 Einheiten Höhe mit Füßen bei `y = 0` normalisiert ist.
* **FBX-Konvertierung repariert:** FBX2glTF lieferte das Modell in Zentimeter-Einheiten (0.009 hoch) und mit einem konstanten 90°-Yaw + Versatz zwischen Bind-Space und Joint-Ruhepose (Tripo-Knoten mit `eInheritRrSs`). Skalierung in Positionen, Joint-Translationen und Inverse-Bind-Matrizen eingebacken (statt Root-Scale → sonst falsch skalierte Normalen, dunkles Shading); Yaw in das Mesh gefaltet, sodass Bind-Pose = Ruhepose (Bedingung für die Mixamo-Clips, die nur Rotationen setzen).
* **`jump.glb`, `crouch.glb`, `crawl.glb` normalisiert (Bugfix, betraf jede Figur):** Die Blender-exportierten Clips trugen Translation- und Scale-Spuren aller Knochen in Zentimetern sowie eine `Armature`-Spur (Rx 90°, Scale 0.01). Beim Ducken/Kriechen/Springen wurde das Mesh dadurch auf Bildschirmgröße zerrissen. Jetzt nur noch Rotationsspuren der `mixamorig:`-Knochen; die Armature-Korrektur ist in die Hips-Rotation gefaltet — gleiche Konvention wie `idle.glb`/`running.glb` (FBX2glTF).

### 2. Verification
* `npm run build:showcases` + `node .agents/scripts/check-showcases.js 9`: WebGL1, WebGL2, WebGPU alle ✅ OK (Standardpfad ohne `assets/local/` getestet).
* Puppeteer-Sequenz Idle → Laufen → Sprung → Ducken/Slide mit Dino und lokaler Override-Figur: keine Konsolenfehler, keine Mesh-Explosion mehr.

### 3. Known Limitations
* Der Dino wirkt im Spiel dunkler (Orange → Braun) als im Konzept, da die Textur selbst gedeckt ist und die matte PBR-Einstellung (`roughness 0.88`) greift.

## 2026-11-07 · Mixamo Duck Motions: Crouch, Crouch-Walk, Crawl & Slide

### 1. Implemented Features
* **Vier neue Mixamo-Clips, auf den Dino retargeted:** `crouch.glb` (Crouch Idle, ersetzt den alten Clip), `crouch-walk.glb` (Crouch Walk Forward), `crawl.glb` (Crawling, ersetzt den alten Clip), `slide.glb` (Running Slide). FBX2glTF-Konvention wie `idle.glb`/`running.glb` (nur Rotationen + Hips-Translation, die beim Laden entfernt wird).
* **Tabellengetriebene Lokomotion:** `LOCOMOTION_CLIPS` (Zustand, URL, Hüft-Absenkung) ersetzt fünf Einzel-Actions; Laden per `Promise.all`, Blending in einer Zero-GC-Indexschleife.
* **Zustandswahl:** Luft → `jump`; Slide → `slide`; geduckt in Bewegung → `crawl` unter niedriger Decke (Kopfzone blockiert), sonst `crouchWalk`; geduckt im Stand → `crouch`; sonst `run`/`idle`. Gehgeschwindigkeit skaliert `timeScale` (`|v| / 2.2`).
* **Crouch-Slide als eigener Zustand:** Ducken aus vollem Lauf (`|v| > 3.2`, am Boden) startet `_isSliding`: Richtungseingaben werden ignoriert, Schwung zerfällt exponentiell (`rate 1.1`) bis Kriechtempo, dann Übergang in Crouch-Walk/Crawl. Der Slide-Clip startet bei Eintritt neu und hält die tiefe Endpose.
* **Hüft-Absenkung statt Hips-Translation:** Da die Hips-Translation entfernt wird, senkt `_duckDrop` (geglättet, Anteil der Figurenhöhe aus der Hips-Spur gemessen: crouch 0.145, crouchWalk 0.067, crawl 0.122, slide 0.11) das ganze Modell ab — Füße bleiben am Boden, unabhängig von der Figurengröße. Die prozedurale Duck-Stauchung ist für geriggte Figuren auf `0.15`/`0.05` reduziert, der Ducken-Neigungswinkel entfällt; der Fallback-Würfel behält beides.

### 2. Verification
* `npm run typecheck`, eslint, prettier: Grün. `vitest run apps/showcases`: 14 Files / 255 Tests bestanden.
* `npm run build:showcases` + `node .agents/scripts/check-showcases.js 9`: WebGL1, WebGL2, WebGPU alle ✅ OK.
* Puppeteer-Sequenz mit Dino (Standardpfad): Ducken, Crouch-Walk, Sprint → Slide → Kriechen → Aufstehen; keine Konsolenfehler, Füße am Boden.

### 3. Known Limitations
* Die Clips sind auf die Dino-Proportionen retargeted; andere Figuren (lokaler Override) übernehmen sie unverändert.
