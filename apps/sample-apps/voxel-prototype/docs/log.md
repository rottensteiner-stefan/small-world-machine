# Log — Voxel Prototype (M0–M5 Kandieferung in SWM)

> Entwicklungslog für die Voxel-Kampagne (Dossier-Basis: `.agents/collaborate/minecraft/dossier.md`
> + `docs/log` dieser App). Einträge werden nie gelöscht; neue Einträge oben.

---

## 2026-10-28 — Restpunkte aus dem 7-Tage-Code-Review abgeschlossen (H2, H4, M2, M3, M4, M7, M11, K5, K9)

**Status:** ✅ Alle offenen Review-Punkte aus `.agents/scratches/code-review-7d/E-voxel-whisper.md` (und dem Log-Vermerk vom 2026-10-21) behoben und mit Unit-Tests abgesichert (reine App-Level-Fixes, kein Engine-Change):

- **Kaltstart-Guard (`H2` — `ChunkWorld.hasChunkDataAt` + `VoxelPlayerCollision.update`):** Solange der Chunk unter dem Spieler noch keine generierten Voxel-Daten hat (`rec?.chunk == null`), hält `VoxelPlayerCollision` das Streaming-Zentrum und die Kamerapose aktiv, pausiert aber Gravitation und Sweep (`_velocity = 0`). Der Spieler kann beim Kaltstart oder nach Respawn nicht mehr durch noch ungeladene Chunks fallen.
- **Gamepad-Deduplizierung & radiale Deadzone (`H4` — `VoxelInputActions.ts`):** Analoge Sticks nutzen eine radiale Deadzone (`Math.hypot(x, y) > dz`). Ist `input.gamepadController.getActiveDevice()` in der Engine bereits aktiv, addiert `VoxelInputActions` linken Stick, rechten Stick (bei Pointer-Lock) und Button 0 (Jump) nicht ein zweites Mal auf `getAxis`/`mouse.dx/dy`/`isPressed(SPACE)`, sondern liest aus `navigator.getGamepads()` nur `L2`/`R2`/`L1`/`R1`.
- **System-Modifier-Filter (`M11` — `VoxelInputActions.ts`):** Bei gehaltenem `Meta`, `Ctrl` oder `Alt` (`MetaLeft`/`Right`, `ControlLeft`/`Right`, `AltLeft`/`Right`) sind `F`/`Q`/`E`/`R`, `Digit1..5`, `Space` sowie `Ctrl+LMB` für Spielaktionen gesperrt (`Cmd+R` Reload, `Cmd+F` Suche, `Cmd+1..5` Tab-Wechsel oder `Ctrl+Klick` lösen kein Break/Place/Slot-Wechsel mehr aus).
- **Host-Node- & Delta-Sicherheit bei `_onError`, Eviction und `destroy` (`M2` & `M3` — `ChunkWorld.ts`):** `ChunkRecord.hosted` merkt sich, ob `onMeshReady` bereits ein `Object3D` im Host angelegt hat (bleibt auch über Edit-Remeshes in Phase `"data"`/`"meshing"` erhalten). Eviction, `destroy()` und `_onError()` rufen bei `rec.hosted` zuverlässig `onUnload` auf und sichern `rec.deltas` vor dem Löschen via `_saveDelta(rec)`.
- **Diagonaler Corner-Remesh (`M4` — `ChunkWorld._scheduleRemesh`):** Edits an einer der vier Chunk-Ecken (`lx ∈ {0,15} ∧ lz ∈ {0,15}`) planen neben den beiden axialen Nachbarn auch den einzelnen diagonalen Nachbarn ein (maximal 4 Chunks gesamt, weiterhin `≤ 5`), sodass die AO-Eckspalten naht-exakt bleiben.
- **Seed-Prüfung & Stale-Record-Guard (`M7`, `K5`, `K9`):** `_applyStoredEdits` verwirft gespeicherte Deltas mit fremdem Seed (`data.seed !== this._seed`); `_onData` prüft Objektidentität (`this._chunks.get(key) !== rec`); `App.ts` fragt `heightAt(Math.floor(SPAWN_X), Math.floor(SPAWN_Z))` zellgenau ab.

---

## 2026-10-26 — M6 implementiert: WebGPU-Array-Textur, prozeduraler Himmel, Sonnen-/Mond-Lauf

**Status:** ✅ abgeschlossen (WebGPU und WebGL2 sichtbar deckungsgleich). Anders als M0–M5 mit zwei kleinen Engine-Änderungen, weil das Backlog-Ziel („WebGPU-Array-Texture, Engine-Seite“) genau das verlangt.

- **WebGPU-Blockshader (`voxel/material/shaders/BlockMaterial.wgsl`):** Die Palette ist ein `texture_2d_array` (`u_diffuseMap`), Layer/AO/Licht kommen im Vertex-Color-Attribut (Location 11). Atlas-Bleeding ist damit auch unter WebGPU konstruktiv ausgeschlossen. Beleuchtung 1:1 wie GLSL (Test hält beide synchron). Die dynamischen Werte (Tageslicht, Sonnenrichtung, Lichtfarbe) liegen für beide Tiers in `u_matParam0/1` und werden in place geschrieben.
- **Engine (klein):** `CustomShaderMaterial` nimmt `flags` entgegen und setzt `USE_TEXTURE_ARRAY` selbst, sobald eine `TextureArray` gebunden ist (wie WebGL2 es schon tat). `StandardWebGPULayout` hat neutrale Defaults für `u_specColor`, `u_texOffset/Repeat`, `u_shininess`, `u_isTerrain`, `u_metallic`, `u_roughness`, `u_extraParams/liquidParams/thresholds`. Ohne sie warnte der `UniformPacker` zehnmal pro Objekt und Frame: 28 ms CPU im ersten WebGPU-Lauf, jetzt 60 fps.
- **Himmel (`voxel/environment/SkyMaterial.ts`, `shaders/SkyMaterial.*`):** Würfel um die Kamera (Tiefe an die Far-Plane gepinnt), Verlauf Horizont → Zenit, Sonne mit Glow, Mond gegenüber, funkelnde Sterne nur nachts. GLSL300 und WGSL, drei Lanes, nichts alloziert pro Frame. `DayNightCycle` liefert dazu `getSkySunDirection()` (sinkt nachts unter den Horizont, anders als die Lichtrichtung), `getStarVisibility()`, `getHorizonColor()/getZenithColor()` und `getLightTint()` (weiß / bernstein / mondblau, multipliziert über die gebackenen Lichtwerte).
- **App:** Renderer jetzt `BEST` (WebGPU, sonst WebGL2) statt WebGL2 fix. Dev-Parameter `?time=<0..1>` pinnt die Tageszeit, `?look=<yaw>,<pitch>` dreht die Startansicht, für reproduzierbare Himmelsaufnahmen.
- **Verifiziert:** Sonnenaufgang, Mittag, Sonnenuntergang und Mitternacht auf WebGPU und WebGL2 aufgenommen und gesichtet; beide 60 fps, 0 Konsolenmeldungen. `lint:glsl` deckt jetzt `voxel/environment/shaders` ab.
- **Nicht gemacht:** Wolken, Mondphasen, Nebel zum Horizont, WebGL1 (hat keine Array-Texturen, bräuchte ein 2D-Atlas-Material).

---

## 2026-10-23 — M5 implementiert: Härtung, AO-kompatibles Greedy-Meshing, Voxel-Eviction & Telemetrie

**Status:** ✅ M5 final abgeschlossen & abgenommen. Forschungsreport: `docs/research/voxel-m5-performance-benchmark.md`. **NUR App-Level, kein Engine-Core-Change** (Dossier-Mandat).

### Was gebaut wurde (alles app-level, `apps/sample-apps/voxel-prototype/`)

- **AO-kompatibles Greedy-Meshing (`voxel/mesh/GreedyMesher.ts`):**
  - 2D-Slice-Merging mit striktem Quad-Key-Matching (`blockId`, Textur-`layer`, `ao0..ao3`, `light`, `transparent`).
  - Merged Nachbar-Quads nur, wenn alle 4 Vertex-AO-Werte und der Lichtfaktor exakt übereinstimmen (`Math.abs < 1e-4`).
  - Reduziert die Dreieckszahlen flacher Plateaus, Decken und Wände um **~60–75 %** ohne Schattierungs-Artefakte oder Textur-Verzerrungen.
  - Vollständige Verdrahtung in `mesh.worker.ts`, `MeshWorkerClient.ts` und `ForegroundMeshClient.ts`.
- **S4 Sparse-Memory- & Voxel-Eviction-Policy (`voxel/ChunkWorld.ts`):**
  - Entkopplung von Render-Präsenz (GPU-Mesh im Frustum) und Daten-Präsenz (CPU `Uint8Array(4096)`).
  - Außerhalb `retainVoxelRadius` werden CPU-Voxel freigegeben (`rec.chunk = null; rec.voxelEvicted = true;`), sobald Nachbarn nicht mehr meshen müssen.
  - Bei Annäherung des Spielers oder Edits werden Voxel-Daten im Hintergrund deterministisch regeneriert und mit `rec.deltas` rehydriert.
- **Echtzeit-Telemetrie & Benchmark-Harness (`App.ts`):**
  - URL-Parameter `?benchmark=1` / `?stats=1` aktiviert erweiterte Telemetrie.
  - `getTelemetry()` auf `window.__voxelM1` liefert Frametime, FPS, Voxel-RAM-Nutzung, Dreieckszahlen und Worker-Meshing-Zeiten.
  - Info-Panel erweitert um FPS, Frametimes und Voxel-RAM (`~X KB`).
- **Edge-Fuzzing & Torture-Tests (`tests/VoxelEdgeFuzz.test.ts`):**
  - Testet ungültige/extreme Koordinaten, 4-Chunk-Nahtkanten-Toggle, High-Speed-AABB-Sweeps und 3D-Schachbrett-Geometrien.
- **Automatisierter Headless-Live-Gate (`.agents/scratches/check-voxel-m5.mjs`):**
  - Prüft Streaming, Greedy-Meshing, Voxel-Eviction und Telemetrie headless über Puppeteer (121 Chunks, ~145 Tris/Chunk, 0 Fehler).

### Verifikation

- `vitest run apps/sample-apps/voxel-prototype`: Alle 22 Testdateien / 145 Tests bestanden.
- Headless Live-Gate `node .agents/scratches/check-voxel-m5.mjs`: `ok: true`, non-blank (stddev 20.78), 0 Console-/Page-Errors.
- `npx tsc --noEmit` & `npm run lint`: 0 Fehler, 0 Warnungen.

---

## 2026-10-23 — M4 implementiert: Spielbare Survival-Schlaufe (Tag/Nacht, Auto-Jump, Fallschaden, Respawn)

**Status:** ✅ M4-Architektur + Survival-Loop grün. Plan: `.agents/scratches/voxel-m4-plan.md`. **NUR App-Level, kein Engine-Core-Change** (Dossier-Mandat).

### Was gebaut wurde (alles app-level, `apps/sample-apps/voxel-prototype/`)

- **Tag-/Nacht-Rhythmus (`voxel/environment/DayNightCycle.ts`):**
  - Kontinuierlicher 24h-Zeitzyklus (Standard: 120s für schnelle Prototype-Loops, konfigurierbar).
  - Berechnet `daylight` (0.15 Nacht-Ambient bis 1.0 Mittag), Sonnenrichtungsvektor `u_sunDirection` und interpolierte Himmelsfarben `clearColor` (Tagblau → Abendrot/Dämmerung → Nacht-Navy).
  - Shader-Uniforms `u_daylight` und `u_sunDirection` in `BlockMaterial`: Fragment faltet dynamisches Sonnenlicht über das gebackene Tageslicht (`v_light * u_daylight`) und passt `ndl` an den rotierenden Sonnenvektor an — **kein Neumeshing / Zero-GC im Frame-Loop**.
- **Auto-Jump / Step-Up 1.0 Block (`voxel/physics/VoxelPlayerCollision.ts`):**
  - Automatische Erkennung (`canStepUp`) bei horizontaler Bewegung gegen 1-Block-Hindernisse: Prüft, ob der Kopfraum über dem Block frei ist (`headroom >= 2 blocks`), und triggert einen sanften Aufstiegsimpuls (`vy = 6.8`), sodass der Spieler ohne Spacebar-Dauerfeuer flüssig über Terrassen und Hügel wandert.
- **Player Rig & Survival-Zustand (`voxel/player/PlayerRig.ts`):**
  - **Health:** 20 HP (10 Herzen).
  - **Fallschaden:** Reines Minecraft-Modell — Messung der Fallhöhe ab Peak `y`. Bei Landung (`onGround == true`): Wenn `fallDistance > 3.0` Blöcke, Schaden = `Math.floor(fallDistance - 3.0)`.
  - **Void-Schutz:** Absturz ins Nichts (`y < -30`) ist sofort tödlich.
  - **Tod & Respawn:** Bei `health <= 0` friert die Bewegung ein, der Cursor wird freigegeben und das Todes-Overlay eingeblendet. Respawn (via Button oder Leertaste) stellt 20 HP wieder her und setzt den Spieler sicher auf dem Spawn-Gipfel ab.
- **HUD & Visuelles Feedback (`index.html` + `App.ts`):**
  - **Hotbar (1–5):** Zentrierte Leiste am unteren Bildschirmrand mit animierter Selektion des aktiven Blocks (synchron mit Tasten 1–5, Mausrad und Gamepad).
  - **Health-Herzen:** 10 Herzen (rot / leer), optischer roter Schadens-Flash über dem Screen.
  - **Tageszeit & Stats:** Anzeige von Phase (sunrise / day / sunset / night), Sonnenstunden und Helligkeit im Info-Panel.
  - **Death-Screen:** „You died!"-Overlay mit Respawn-Button.

### Verifikation

- `vitest run apps/sample-apps/voxel-prototype`: Alle 19 Testdateien / 136 Tests grün (inkl. 4 DayNightCycle-, 4 PlayerRig-, 3 VoxelPlayerCollision-Tests).
- Volle Projekt-Suite: **402 Testdateien / 2933 Tests bestanden**, `npm run lint:fix` 0 Fehler / 0 Warnungen, `npm run build:lib` grün.
- Live-Gate `node .agents/scratches/check-voxel-m4.mjs`: `ok: true`, non-blank (stddev 24.10 / 21.47), 0 Console-/Page-Errors, Day/Night-Transition und kompletter Survival-Damage/Death/Respawn-Kreislauf erfolgreich durchlaufen.
- Regression: `check-voxel-m1.mjs` und `check-voxel-m3.mjs` unverändert `ok: true`.

---

## 2026-10-21 — Code-Review-Fixes: abgewandte Flächen & Diagonalgeschwindigkeit

**Status:** ✅ Zwei Befunde aus dem 7-Tage-Review (`.agents/scratches/code-review-7d/E-voxel-whisper.md`) behoben.

- **Block-Shader (`BlockMaterial.frag.glsl`):** Der M3-Umbau hatte `ndl` als reinen Faktor vor das
  Ambient gesetzt (`... * ndl * lightFactor`); Flächen mit `ndl == 0` (-X, -Y, -Z) wurden dadurch
  schwarz. Wieder `(ambient + (1 - ambient) * ndl)` wie in M0–M2. Regressionstest:
  `tests/BlockMaterialShader.test.ts`.
- **Bewegung (`VoxelInputActions.ts`):** Achsen wurden einzeln geklemmt, W+D lief damit
  √2-mal so schnell. Jetzt Klemmung auf die Einheitsscheibe (Analogsticks behalten ihren Betrag).
  Der Test pinnte vorher den Fehler (`{x: 1, z: -1}`) und prüft jetzt `|move| == 1`.
- **Offen aus dem Review (nicht angefasst):** Spieler fällt beim Kaltstart durch ungeladene Chunks,
  Gamepad evtl. doppelt gezählt, Modifier-Filter (Cmd+R/F/1..5), Chunk-Mesh-Lecks bei `_onError`.
  → Update 2026-10-28: ✅ Alle vier Punkte (plus M3/M4/M7/K5/K9) behoben, siehe Eintrag 2026-10-28 oben.

---

## 2026-10-21 — Fix Texturausrichtung (flipY & 90°-Seitenlage) + Semantisches Action-Input-System (Trackpad-First)

**Status:** ✅ Texturen aufrecht & korrekt gerichtet; Action-Mapping mit macOS-Touchpad/Gamepad-Support integriert.

### Was gebaut wurde

1. **Texturausrichtung („Human Convention First" & Entzerrung):**
   - **Kopfstehen behoben:** [`BlockTextureFactory.ts`](file:///Users/srottensteiner/PhpstormProjects/rottensteiner-stefan/small-world-machine/apps/sample-apps/voxel-prototype/voxel/BlockTextureFactory.ts) decodiert Bitmaps nun mit `{ imageOrientation: "flipY" }` analog zum Engine-Standard `flipY: true`. Dadurch landet Zeile 0 des Atlas (grünes Gras) zuverlässig bei $V=1$ (Oberkante des 3D-Blocks) und Zeile 15 (Erde) bei $V=0$ (Boden).
   - **90°-Kippen der Seitenflächen behoben:** In [`NaiveMesher.ts`](file:///Users/srottensteiner/PhpstormProjects/rottensteiner-stefan/small-world-machine/apps/sample-apps/voxel-prototype/voxel/mesh/NaiveMesher.ts) wurden explizite `uvCorners` im `FaceTemplate` hinterlegt. Auf allen vier vertikalen Seitenflächen (`+X`, `-X`, `+Z`, `-Z`) zeigt $V$ nun strikt vertikal nach oben, ohne dass 3D-Vertexpositionen verändert oder Naht-Invarianzen gebrochen werden.
   - Neuer Regressionstest in [`NaiveMesher.test.ts`](file:///Users/srottensteiner/PhpstormProjects/rottensteiner-stefan/small-world-machine/apps/sample-apps/voxel-prototype/tests/NaiveMesher.test.ts) sichert $V=1$ für obere Vertices und $V=0$ für untere Vertices auf allen Seitenflächen ab.

2. **Semantisches Action-Input-System (Trackpad-First, Gamepad-Ready):**
   - Neuer Modul [`VoxelInputActions.ts`](file:///Users/srottensteiner/PhpstormProjects/rottensteiner-stefan/small-world-machine/apps/sample-apps/voxel-prototype/voxel/input/VoxelInputActions.ts): Übersetzt rohe Hardware-Inputs in semantische Aktionen (`move`, `look`, `jump`, `breakBlock`, `placeBlock`, `selectedSlot`, `cycleSlot`).
   - **macOS-Touchpad-Komfort:**
     - `breakBlock`: Reagiert auf `LMB` **sowie** Tastatur `F` oder `Q` (flüssiges Abbauen ohne Mausklick).
     - `placeBlock`: Reagiert auf `RMB` **sowie** Tastatur `E` oder `R` (eliminiert den fehleranfälligen 2-Finger-Klick im Pointer-Lock).
     - `cycleSlot`: Mausrad-Events werden mit 120 ms Cooldown debounced, um Momentum-Inertia-Spam beim 2-Finger-Wischen zu verhindern.
     - `jump`: Leertaste führt bei Bodenkontakt einen Sprungimpuls aus.
   - **Gamepad-Integration:** Unterstützt Standard-Gamepads via HTML5 Gamepad API (Analogstick-Bewegung/Look, L2/R2 für Place/Break, L1/R1 für Slot-Cycle, A/✕ für Jump).
   - Wiring in [`App.ts`](file:///Users/srottensteiner/PhpstormProjects/rottensteiner-stefan/small-world-machine/apps/sample-apps/voxel-prototype/App.ts), [`VoxelPlayerCollision.ts`](file:///Users/srottensteiner/PhpstormProjects/rottensteiner-stefan/small-world-machine/apps/sample-apps/voxel-prototype/voxel/physics/VoxelPlayerCollision.ts) und [`VoxelBlockEditor.ts`](file:///Users/srottensteiner/PhpstormProjects/rottensteiner-stefan/small-world-machine/apps/sample-apps/voxel-prototype/voxel/physics/VoxelBlockEditor.ts).
   - Neuer Unit-Test [`VoxelInputActions.test.ts`](file:///Users/srottensteiner/PhpstormProjects/rottensteiner-stefan/small-world-machine/apps/sample-apps/voxel-prototype/tests/VoxelInputActions.test.ts) sichert alle Bindings und Kanten-Trigger ab.

### Verifikation

- `vitest run apps/sample-apps/voxel-prototype`: Alle 15 Testdateien / 124 Tests grün.
- `npm run lint:fix`: 0 Fehler, 0 Warnungen.
- `npm run build:lib`: Grün.

## 2026-10-20 — M3 implementiert: Persistenz (Edit-Deltas) + gebackenes Tageslicht/Schattierung

**Status:** ✅ M3-Architektur + Kern grün (Gates unten, inkl. M1+M2-Regression). Plan:
`.agents/scratches/voxel-m3-plan.md` (FREIGEGEBEN 2026-10-20, Entscheide D1–D5 fixiert). **NUR
App-Level, kein Engine-Core-Change** (Dossier-Mandat). Reihenfolge laut Freigabe: ① Delta-Store →
② ChunkWorld-Tracking → ③ Licht → ④ Gates.

### Was gebaut wurde (alles app-level, `apps/sample-apps/voxel-prototype/`)

- **Delta-Store (D1/D2, interface-first):** `voxel/store/ChunkDeltaCodec.ts` (reine, versionierte
  V1-Serialisierung: Header `version|seed|count` + `(x,y,z,id)`-Tupel; byte-deterministisch,
  „last-write-wins" je Zelle, fremde Versionen/korrupte Payloads → sauber ignorieren statt
  Fehler). `ChunkDeltaStore.ts` = **Interface** (`getSeed/setSeed/loadChunkDelta/
  saveChunkDelta/clearChunkDelta/clearAll/flush/close`) + Memory-Treiber für Node-Tests und das
  headless Gate. `IndexedDbChunkDeltaStore.ts` = einziger aktueller Produkt-Treiber (D2: OPFS/
  andere Backends später hinter demselben Interface); typsichere Promise-Kapselung ohne `any`,
  Fail-fast auf IDB-Fehlern.
- **ChunkWorld-Delta-Tracking (D3/D3b):** `setBlock` vermerkt die editierte Zelle im
  Geänderte-Zellen-Set des Chunk-Records (getrennt von der Remesh-Logik); **Save-on-Evict**
  (Streaming-Schleife + destroy) serialisiert NUR die abweichenden Zellen und speichert sie
  Feuer-und-vergiss (in-flight-Tracking); `persistAll()`/`flushStore()` = Durability-Barriere für
  den pagehide/visibilitychange-Pfad. **Load-Apply im `_onData`-Pfad:** der Record bleibt bis zum
  Abschluss des Store-Reads in „generating", damit die Streaming-Schleife nie eine uneditierte
  Säule vorzeitig mesht — der Worker erhält und mesht die **zusammengesetzten** Ziel-Voxels
  (generiert + Deltas), bleibt also einzige Mesh-Quelle („meshing never on main" hält).
  **Renn-Guard:** ein neuerer lokaler Edit während eines laufenden Loads gewinnt gegen ältere
  gespeicherte Daten (per Gated-Store-Test deterministisch gepinnt). Seed wird lazy + einmalig
  persisiert (D3b) → „Browser-Neustart → exakt dieselbe Welt".
- **Licht (D4/D5):** `voxel/light/daylight.ts` (pure, golden-gepinnte Funktionen). Tageslicht-
  Höhenregel `daylightFactorAt(y, surfaceY)` (Oberfläche=1.0, pro Block runter −0.16, globaler
  Floor 0.1) — **rein koordinaten-abhängig → naht-exakt per Konstruktion**, kein
  Ecken-Spalten-Protokoll nötig (im Gegensatz zu AO). × billigster Punktflood `floodSealedness`
  (12 Einzelachsen-Proben im Air-Ring der Face-Außenseite; versiegelte Hohlräume ×0.7, jede
  Offenheit → 1.0; harter Cutoff, auf Heightfield-Terrain inert — nur echte versiegelte Volumen
  dunkeln, D5-Scope-Cut dokumentiert). Der Mesher bäckt das Ergebnis in `colors.b`; Shader
  multipliziert `albedo · mix(ambient,1,ao) · ndl · lightFactor` (exakte Formel golden gepinnt;
  D4 = worker-gebaut wie AO, ein globaler Tageszeit-Multiplikator als Shader-Uniform kommt
  bewusst erst M4). AO-Kanal `.g` unverändert (M2-Regression in `MesherLight.test.ts` gepinnt).
- **App-Wiring:** `IndexedDbChunkDeltaStore` in `ChunkWorld` injiziert (graceful degrade — ohne
  Browser-Storage läuft die App weiter, nur ohne Persistenz); Auto-Flush bei pagehide/
  visibilitychange; Overlay-Zeile „Δ saved (session)" (Anzahl/KB); QA-Hook erweitert um
  `getLightFactor` / `forcePersist` / `getStoredSeed`.

### Verifikation (M3-Gate)

- `tsc --noEmit`, `npm run lint:fix`, `npm run build:lib`, volle Suite **352 Dateien / 2505 Tests
  grün** (inkl. 27 neuer M3-Tests: ChunkDeltaStore 9, ChunkWorldDeltas 6, MesherLight 12);
  `npm run build:showcases` ok.
- `check-voxel-m1.mjs` + `check-voxel-m2.mjs` **Regression grün** (je `ok:true`, Worker-Beweis
  unangetastet).
- `check-voxel-m3.mjs` (NEU): statisch grounded/Worker-Beweis/0 Errors/nicht-blank; **Persistenz-
  Beweis** — QA-Edit → `forcePersist` → `page.reload()` → dieselbe Zelle liest weiter den
  editierten Wert (1 Zelle = **13 Bytes**, KB-Bereich wörtlich), Seed=777 im Store; **Licht-
  Beweis** — Oberflächen-Zelle `getLightFactor`=1.0, Untergrund-Zelle=0.36 (<1.0),
  Chunk-Grenz-Oberflächen-Zelle=1.0 (kein Schatten-Leak; Höhenregel-Parität über Rim). Vision
  (Gemini-Brücke): persistierter Block eindeutig sichtbar, Shading plausibel (oben hell/unten
  dunkler, keine flachen Schwarzlöcher), **keine Naht-Artefakte an Chunk-Grenzen**, AO-Look
  erhalten.

### Bewusste Scope-Entscheidungen (Dossier-Disziplin)

- **Kein volles MC-Licht** (kein Torch-Gradient-Cast/Occlusion), **kein Tag/Nacht-Rhythmus** als
  Mechanik (erst M4, als Uniform-Multiplikator ÜBER der gebackenen Struktur, ohne Neumeshing),
  **kein OPFS-Treiber** (hinter dem Interface nachrüstbar), kein Multi-Worker-Pool, kein
  WebGPU-Material, **Terrain-Generator unverändert**.
- **Punktflood = billigster harter Cutoff** (D5): minimale Grenz-Unschärfe bei fehlenden
  Nachbardaten („open"-Lesung an Welträndern) ist akzeptierter Trade-off, kein exaktes Fluten.
- Bekannte Vorbestehende Grenze (nicht M3): schwarzer Himmel (kein Skybox-/Atmosphären-Pass,
  M0-Ära) — unverändert, kein M3-Regress. Persistenz bei abruptem Prozess-Kill über
  `pagehide` ist „best effort" (Fire-and-Forget); der explizite Flush-Pfad (`forcePersist`/
  `persistAll`) ist die harte Durability-Garantie.

### Nächste Schritte (M4/M5)

Tag/Nacht als Spielmechanik (Uniform-Multiplikator), weiterer Store-Treiber (OPFS) optional,
Anvil-Import nur falls echte MC-Saves, Multi-Worker-Pool (M5).

## 2026-10-20 — M2 implementiert: Break/Place, 1-Chunk-Remesh, gebäcktes AO, CC0-Atlas, Wasser-Rendern

**Status:** ✅ M2-Architektur + Kern grün (Gates unten, inkl. M1-Regression). Plan:
`.agents/scratches/voxel-m2-plan.md`. **NUR App-Level, kein Engine-Core-Change** (Dossier-Mandat).
Reihenfolge laut FREIGABE 2026-10-19: ① Atlas/Sourcing → ② Raycast/Editor → ③ AO → ④ Tests/Gates.

### Was gebaut wurde (alles app-level, `apps/sample-apps/voxel-prototype/`)

- **CC0-Textur-Atlas als eingebettete Pixelgitter (FREIGABE: „CC0-Nachzeichnungen sind gut genug"):**
  `voxel/palette/AtlasPixels.ts` (8 Layer als Hex-RGBA-Gitter, `ATLAS_SOURCES`-Provenienz),
  `BlockTextureFactory` auf die Gitter umgestellt (Fail-Fast-Layer-Sync), Registry-Append
  `BLOCK_TEX_LAYER` (GRASS_TOP..WATER) + `BLOCK_AIR..BLOCK_WATER=5`; gras-bottom→DIRT, side
  GRASS_SIDE; Holz + Wasser registriert. **Wasser-Tile = reine Nah-Dither-Rauschfläche** (3 dicht
  benachbarte Blautöne, alpha 0x9c) ohne Funken/Geometrie — nach 5 Vision-Iterationen (isolierte
  helle Pixel wirkten als „Grid/Checker"); Provenienz im Dossier. Quelle: OGA „16×16 Block
  Texture Set" (CC0, ARoachIFoundOnMyPillow), blocks_2.zip als Primärquelle; Wasser =
  projekteigene In-Stil-Nachzeichnung (CC0 by construction).
- **`voxel/physics/VoxelRaycast.ts`** — parametrische DDA von der Kamera gegen
  `SweepWorld`-artige `isSolidCell`; Rückgabe Zelle/Enter-Flacenormale/Setz-Zelle, maxDist,
  lückenlos & deterministisch (Start-in-Block, Kanten-Treffer, Out-of-Range).
- **`voxel/physics/VoxelBlockEditor.ts`** — Kamera-Behavior, LMB/RMB-Kantenflanken-Edge-Detection,
  `world.setBlock`; **Zifferntasten 1..5** wählen die Hand (Erde/Stein/Holz/Wasser/Gras) —
  Wasser ist damit platzierbar (D3). Setz-Schutz gegen die Spieler-AABB (kein Klemm-Edit).
- **`voxel/ChunkWorld.setBlock` + `_scheduleRemesh`** — **lokaler 1-Chunk-Remesh (D1, max 5)**:
  eigene Chunk + ≤4 horizontale Nachbarn, deren Rim die editierte Zelle enthält. Phase-Regel
  „ready→data" / „meshing→dirty" mit Stale-Discard (`_onMeshReady`-Guard) —
  **„exakt EIN gültiges Mesh gewinnt"**, per `ChunkWorldEdits.test.ts` gepinnt. **Kein
  3×3-Blick** (M5), kein Out-of-Band-Dispatch. Worker bleibt einzige Mesh-Quelle.
- **AO (D5, MC-treu)** — `vertexOcclusionFactors` in `NaiveMesher`: occ∈{0..3} →
  `aoFactor = 1 − occ/3` in `colors.g` (Layer bleibt `.r`), Stichproben in der AUSSEREN
  Face-Schicht (block + Normal — kein Own-Plane, sonst verdunkelt sich jede geteilte Kante
  flachen Geländes). **Naht-Exaktheit über Ecken-Spalten (D2):** `neighborCorners`-Protokoll
  (4×16 B pp/pn/np/nn), `ChunkWorld._tryMesh` gated auf ALLE 8 horizontalen Nachbarn (Axiale +
  Diagonale) — das ist `minNeighborsToMesh`, sonst helles „AO-Leck" am 4-Chunk-Eckscheitel.
  **Debug-Verlauf:** Die ursprünglichen Test-Assertions (ao-Index 3, exaktes 2/3) waren
  Test-Bugs — der Mesher konsumiert die Spalte korrekt am **Emissions-Index 2** (Probe:
  with-ao [1,1,0.667,1], pos [15,6,15]); beide Meshes ohne/über die Spalte byte-determinierbar.
- **Wasser-Rendern (D3)** — Pass 1.5 im Mesher: Face nur gegen **AIR** (kein Wasser-Wasser-/
  Wasser-Solid-Face → kein Z-Fighting), kein AO (ao=1,1,1,1); Material `transparent: true` +
  `depthWrite:true` (Alpha-Sort-Artefakte an seltenen Überlagerungen akzeptiert); `TextureArray`
  upload via `gl.RGBA` (Alpha bleibt, verifiziert). Wasser nicht `collidable` → kein Schwimmen.
  Shader draht `v_ao` (AO-Faltung) + `tex.a`-Alpha.
- **`App.ts`/`index.html`** — Editor an Kamera, CSS-Crosshair (D4, kein Wireframe-Highlight),
  Hints (LMB break · RMB place · 1–5 Handwahl), Stats „hand/edits", QA-Hook erweitert um
  `getWorldBlock`/`setBlock`/`getHand`.

### Verifikation (Gates)

- `npx tsc --noEmit` ✅ (root, voxel-Bereich) · `npm run lint:fix` ✅ · `npm run build:lib` ✅ ·
  `npm run test` ✅ **346 Dateien / 2467 Tests** (volle Suite; neue M2-Tests: VoxelRaycast,
  ChunkWorldEdits inkl. Stale-Invariante, MesherAo inkl. Corner-Column-Byte-Identität,
  MesherWaterFaces, AtlasPalette) · `npm run build:showcases` ✅.
- **M1-Regression:** `check-voxel-m1.mjs` `ok: true` (ready 121→132, Worker-Messung wächst,
  Chunk-Übergang, 0 Errors/nicht-blank) · **M2-Live-Gate `check-voxel-m2.mjs` `ok: true`:**
  statisch grounded/ready=121/Worker, **Break via QA-Hook** `setBlock(20,10,19,0)` → Lese
  zurück air, edits 0→1, `ready` erholt sich auf 121, Spieler bleibt grounded, Mesh-Zeit wächst
  (Remesh auf dem Worker, 40.1→40.4 ms) · **Place** solid=3/roof=4/water=5, edits→4,
  `settled=true` · 0 Console-/Page-Errors, Canvas nicht-blank (stddev 48.0).
- **Recherche Steuerung** (User, 2026-10-20): `docs/minecraft-controls.md` + Verlinkung im
  Dossier — daraus in M2 umgesetzt: Break (LMB), Place (RMB), Hand-Wahl (Digit1..5);
  MMB-Pick-Block + Trackpad-/Gamepad-Feinheiten (Scroll-Debounce, unadjustedMovement,
  PS/Switch-Mapping) → offene Punkte für M4.

### Nächste Schritte

M3: Tages-/Nacht-Licht + Persistenz · M4: Schritt/Auto-Jump, Inventar, Gamepad-Eingabe ·
M5: Greedy-Mesher + 3×3-Blick · WebGPU-Material (bind-group-Array-Texture).

---


**Status:** ✅ Dokumentiert in [`docs/minecraft-controls.md`](file:///Users/srottensteiner/PhpstormProjects/rottensteiner-stefan/small-world-machine/apps/sample-apps/voxel-prototype/docs/minecraft-controls.md) und im [`concept-dossier.html`](file:///Users/srottensteiner/PhpstormProjects/rottensteiner-stefan/small-world-machine/apps/sample-apps/voxel-prototype/docs/concept-dossier.html) verlinkt.

### Inhalte & Erkenntnisse
- **Vollständige Standardbelegung (Java Edition):** Bewegung (WASD, Sprinten, Ducken/Kanten-Sperre, Creative-Fly), Mausaktionen (LMB Attack/Destroy, RMB Use/Place, MMB Pick Block, Wheel Hotbar), Inventar/Hotbar (1–9, E, Q, Swap F), Funktionstasten (F1–F11, F3-Subbefehle A/B/G/H/C).
- **PlayStation 4 / PlayStation 5 Controller (DualShock 4 & DualSense):**
  - Vollständiges Mapping der Bedrock-Standardbelegung (L-Stick Bewegung, L3 Sprint, R-Stick Kamera, R3 Sneak, R2 Attack/Break, L2 Use/Place, L1/R1 Hotbar-Cycling, ✕ Sprung/Flug, △ Inventar, ▢ Crafting, D-Pad F5/Drop/Chat).
  - Gegenüberstellung Tastatur/Maus ↔ Controller.
  - Besonderheiten: Analoge Trigger-Schwellenwerte, Stick-Deadzone (15%), HTML5 Gamepad API Referenzcode (`standard`-Mapping).
- **Nintendo Switch (Joy-Con & Pro Controller):**
  - Bedrock-Standardbelegung: ZR (Abbauen/Attack), ZL (Platzieren/Use), L/R (Hotbar), A (Sprung/Flug), B (Sneak/Abbrechen), X (Inventar), Y (Crafting), D-Pad (Drop, Chat, Emotes), +/- Tasten.
  - Nintendo-Besonderheiten: A/B und X/Y Vertauschung ggü. Xbox/PS, rein digitale ZL/ZR-Schalter (kein analoger Achsenweg), keine Gameplay-Touch-Gesten im Handheld-Modus (rein physische Eingabe) und Notwendigkeit höherer Stick-Deadzones (Joy-Con Drift).
- **macOS-Plattformbesonderheiten & Tastenkonflikte:**
  - `fn`-Zwang für F-Tasten auf Mac-Tastaturen (oder Systemeinstellung umschalten).
  - Gefährlicher Shortcut `Cmd+Q` (beendet Applikation/Browser) vs. `Q` (Item droppen).
  - `Control + Klick` (macOS-OS-Rechtsklick) kollidiert mit Standard `Control` für Sprinten.
  - Vollbild: `F11` vs. `Control + Command + F` (F11 ruft oft Mission Control auf).
- **Trackpad- & Apple Magic Mouse-Verhalten:**
  - Mac-Trackpads haben keinen nativen Mittelklick (Pick Block) → erfordert Tastatur-Rebind (z. B. `R` oder `B`).
  - Zwei-Finger-Klick als Rechtsklick (Platzieren).
  - Scrollrad-Dämpfung: Browser-`wheel`-Events liefern kontinuierliche Sub-Pixel-Trägheitswerte; für Hotbar-Slots ist ein Schwellenwert-Akkumulator/Debounce erforderlich.
  - Pointer Lock mit `{ unadjustedMovement: true }` zur Umgehung der aggressiven macOS-Mausbeschleunigungskurve.
- **Konsequenzen für M2:** Saubere Trennung von Break (LMB/R2/ZR mit Hold-Akkumulator), Place (RMB/L2/ZL mit Kontextmenü-Unterdrückung), Pick Block (MMB + Keyboard-Fallback `R`/`B`) und optionale Gamepad-Unterstützung im FPS-Behavior.

**Status:** ✅ M1-Architektur + Kern grün (Gates unten). Plan: `.agents/scratches/voxel-m1-plan.md`.
**Feature-Entscheid (User-Approval 2026-10-19, im Plan dokumentiert):** dedizierter
**Vite-Module-Worker** statt Engine-`ThreadPool` — dessen `fn.toString()`-Blob-Modell (KEINE
Imports) kann keinen Multi-File-Mesher hosten, ThreadPool-Erweiterung = Engine-Change = Verstoß
gegen das No-Engine-Change-Mandat. Divergenz als begründet dokumentiert (E1-A im Plan).

### Was gebaut wurde (alles app-level, `apps/sample-apps/voxel-prototype/`)

- **`voxel/TerrainGenerator.ts`** — deterministischer, geseedeter Wert-Noise-fbm-Höhenfeldfeld
  (rein als Funktion der Weltkoordinaten + Seed → nahtfrei über Chunk-Grenzen, byte-identisch auf
  Main + Worker), fester Block-Stack (Gras/Dirt/Stein), `heightAt()` für den Spawn.
- **`voxel/ChunkWorld.ts`** — reiner Streaming-/Lebenszyklus-Kern (Requested→Data→Meshing→Ready→
  Unload, `minNeighborsToMesh=4` horizontal, **Hysterese** `unloadRadius > generateRadius`
  [Konstruktor-Invariante], Frame-Budget `maxTasksPerTick`, Stats), Kollisions-Abfrage
  `getWorldBlock`/`isSolidAt` (Registrär-`collidable`, nicht Opazität), Callbacks
  `onMeshReady`/`onUnload` (Host-Glue injiziert). Kein Object3D/DOM/Engine-Import → node-testbar.
- **`voxel/mesh/NaiveMesher.ts`** — Refactor auf reine Funktion `buildMesh(input)` + geteilte
  `FACES`; **Naht-System** `RIM_INDEX_ORDER`, `FaceDir`, `faceDirForOffset`, `buildNeighborRim`,
  `descriptorFromRegistry`, `MeshBlockDescriptorEntry {id,opaque,collidable,layers[top,bottom,side]}`;
  `NaiveMesher`-Klasse bleibt als dünner M0-kompatibler Wrapper.
- **`voxel/worker/`** — `MeshWorkerProtocol.ts` (typisierte Transfer-Nachrichten, `MeshClient`-
  Interface), `mesh.worker.ts` (dedizierter Modul-Worker, NIEMALS Main: Welt-Gen + Mesh-Bau,
  `performance.now()`-Mesh-Zeit), `MeshWorkerClient.ts` (`new Worker(new URL(..., import.meta.url),
  {type:"module"})`), `ForegroundMeshClient.ts` (synchroner Test-/Fallback-Double, gleiche Pure-
  Code-Pfade).
- **`voxel/physics/VoxelSweep.ts`** — **treuer, SIMPLIFIZIERTER Luanti-Port**
  (`collisionMoveSimple` + `axisAlignedCollision`, Quelle
  `.agents/collaborate/minecraft/sources/charly-voxel-gameplay-luanti-collision.cpp`, LGPL-2.1+):
  Per-Achsen-Sweep, früheste-Achse-gewinnt, Snap + Achsen-Null (bouncy=0), 1e-5-Drunkaste,
  **Bodenerkennung = Luanti-Final-Touches-Kontaktscan** (`|top−feet| < 0.05`). Bei der Verifikation
  **einen echten Port-Bug gefunden & behoben**: die finale `result.position = origin`-Clobber-Zeile
  konnte jeden Nicht-Kollisions-Frame auf die Startposition zurücksetzen (→ im no-collision-Pfad
  wird `origin` nie synchronisiert). Bodenerkennung als begründete Divergenz dokumentiert (Luantis
  Mid-Loop-Klausel `accel_f.Y==0` ist unter unserem Gravitation-in-`accel`-Modell toter Code).
- **`voxel/physics/VoxelPlayerCollision.ts`** — app-seitiger FPS-Behavior (Kamera-gehostet, §4.4 E2):
  WASD in der Engine-eigenen Bewegungsmathematik (FPSController-Parität), Maus-Look via
  `pendingDx/pendingDy`, Schwerkraft + Sweep, Streaming-Fokus zentriert im Behavior (frische
  Spielerposition), Kamera-Auge = Körper + `eyeHeight`. Adapter-Seam zwischen `SweepWorld`
  (`isSolidCell`) und `ChunkWorld` (`isSolidAt`).
- **`voxel/ChunkWorldHost.ts`** — Host-Glue: Worker-`VoxelMeshData` → `Object3D` (Lokal→Welt
  `(cx·16,0,cz·16)`, Bounds, FrustumCulled, One-Chunk-One-Draw), Eviction, Triangle-Zähler.
- **`App.ts` (Umbau)** — M0-Orbit-Rig ersetzt durch echten FPS-Spieler auf generiertem Terrain
  (Spawn via `heightAt`+1), Streaming um Spieler, Stats-Overlay mit **Mesh-Beweis** (mesh last/
  total, „dedicated worker"), FPS-Strategie + Pointer-Lock.
- **`index.html`** — Titel M1, Bedienhinweis (click to capture · WASD).

### Verifikation (Gates)

- `npm run lint:fix` ✅ · `npm run build:lib` ✅ · `npm run test` ✅ **340 Dateien / 2419 Tests**
  (inkl. 10 neuer Sweep-, 5 Seam-, 7 Terrain-, 5 ChunkWorld-Tests).
- **Worker-Build-Beweis:** gezielter Vite-Build des Voxel-Eintrags → `new Worker(new URL(...))`
  wird als **eigener Chunk** (`assets/mesh.worker-*.js`) emittiert, App-Bundle referenziert ihn.
- **Sweep-Testdeckung:** Bodenstand (feet exakt auf Block-Oberkante), Sturz + exaktes Landen
  (keine Überpenetration), **kein Tunneln bei |vy|=5000** (Speed-Clamp-Grenze), Wand-Sliden
  (kein laterales Durchdringen, grounded bleibt), Decken-Stopp, leere Welt = reine Integration,
  Input-Vektoren nie mutiert, Luanti-0.05-Kontaktband.
- **Verhaltens-Beweis (Unit-pinned):** Wandlauf-Test zeigt Stopp exakt bei `max.x == Wandfläche`
  (origin.x==2.7), Füße bleiben auf y=1 — das M1-Gate „Spieler STEHT auf Terrain" ist
  testseitig abgesichert.
- **Live-Gate `check-voxel-m1.mjs` (headless, SwiftShader, WEBGL2) — `ok: true`:** Spieler
  grounded auf Spawn-Oberfläche (feet 20.5/11/20.5 = heightAt+1), Mesh-Zeit `meshMsTotal`
  26.5→28.6 ms wächst (Worker-Messung, nur Dedicated-Worker meldet >0), W-Lauf über
  Chunk-Grenze z=16 (5.17 m, Flat-Korridor seed 777 per Probe verifiziert), **Streaming-Fokus
  migriert (1,1)→(1,0)**, Chunks ready 121→132, Canvas nicht-blank (stddev 41.7), **0 Console-/
  Page-Errors**, Overlay zeigt „dedicated worker".
- **Vision-Bestätigung (Gemini-Brücke, M0-Präzedenz):** generiertes Terrain sichtbar (Gras-
  Kappe/Braun/Dirt), **keine Seams/Cracks/fehlende Faces/schwarze Löcher an Chunk-Grenzen**,
  flaches Licht — Nahtfreiheit hält im echten Render. (Schwarzer Himmel = kein Skybox in M1,
  erwartet.)

### Bewusste Scope-Cuts (M1, im Plan dokumentiert)

- Naive Face-Culling (Greedy = M5, AO = M2), **kein Step-Up/Auto-Jump** (→ M4), kein
  Block-Editing (M2), keine Persistenz (M3), kein WebGPU-Material, **kein Worker-Pool** (M5),
  kein Bounce/Päraktiven-Split in Sweep (Luanti-Parabola-Deferred, mit Jump-Feature).

### Nächste Schritte

M2: Break/Place + 1-Chunk-Remesh + Minecraft-Look (gebäcktes AO) · Textur-Atlas-Entscheid
(user 2026-10-19: **CC0-Nachzeichnungen sind gut genug** — Backlog-Eintrag).

---

## 2026-10-19 — M0-Härtung: Live-Gate deckt 2 realer Mesher-Bugs auf (Black-Screen)

**Status:** ✅ M0-Gate final grün — Browser-Live-Verifikation (headless Puppeteer + SwiftShader,
WEBGL2) hat den Prototypen erst nach einem Heißsporn-Fix zum Zeichnen gebracht. Die Debug-Session
zeigt: **alle Engine-vermuteten Ursachen waren Rot-Schips** (UBO, Buffer-Upload, VAO, Programm,
Draw-State, Windung/Culling waren jeweils nachweislich korrekt) — der Fehler lag ausschließlich in
unserem `NaiveMesher`.

### Root-Cause (Bug #1 — der Black-Screen)

In `NaiveMesher.build()` Pass 2 wurden alle 4 Quad-Ecken in **denselben** Positions-Slot
(`base = vi*3`, im Corner-Loop überschrieben) geschrieben. Resultat: pro Face blieb nur die letzte
Ecke übrig, 3 von 4 Vertices blieben `(0,0,0)` → **jedes Dreieck war flächen-degeneriert** → nichts
wurde gerastert, ohne jeden GL-Fehler. Genau deshalb blieb auch ein hartkodierter
Fest-NDC-Quit + Flach-Magenta-Fragment unsichtbar (es leitete `gl_Position` aus `a_position` ab —
das waren lauter Nullen). Die bestehenden Unit-Tests prüften nur Zählungen + die statische
`FACES`-Winding, nie die **emittierten** Positionsdaten → der Bug schlüpfte durch.

### Folge-Fix (Bug #2 — falsche Face-Geometrie)

Die `FACES`-Templates legen Quads teils in die Nachbarzelle (z.B. -X-Face von Block z=5 mit
`TB=[0,0,-1]` → Ecke z=4; negative Achsen ohne Outward-Plane-Versatz). Neu gefasst unter klarer
Konvention „Block (x,y,z) belegt `[x,x+1]³`, Face liegt exakt auf der eigenen Grenzebene“, mit
explizitem `displacement` pro Face; `cross(TA,TB) === Normal` bleibt per Konstruktion erfüllt.

### Shader-Härtung (strikte Compiler)

- `#version 300 es` muss in **Zeile 1** stehen (nicht nach Kommentaren) — ANGLE/SwiftShader
  behandeln das sonst als GLSL-ES-1.00 (Fehler „storage qualifier supported in ES 3.00 and above
  only“). Engine-Konvention übernommen.
- Interpolations-Qualifier vor Storage-Qualifier: **`flat out` / `flat in`** (nicht `out flat`) —
  ES-3.00-Spezifikation, von SwiftShader hart durchgesetzt.
- `index.html`: `data:,`-Favicon gegen den unvermeidlichen `/favicon.ico`-404 im Headless-Test.

### Härtung des Testnetzes (Regression)

2 neue Tests in `tests/NaiveMesher.test.ts`, die **emittierte** Vertices prüfen: jede Face hat 4
distinkte, reelle Voxel-Ecken (`∈[5,6]`, kein `(0,0,0)`-Rest) und jedes emittierte Dreieck windet
gegen die Outward-Normale (kein Degenerieren/Inversion). Beide hätten Bug #1 & #2 sofort gefangen.

### Gate nach Fix (final grün)

- `npm run lint:fix` ✅ · `npm run build:lib` ✅ · `npm run test` ✅ **2322/2322** (327 Dateien,
  inkl. der 2 neuen Regressionstests).
- Live-Gate `node .agents/scratches/check-voxel-m0.mjs`: `ok: true`, `blank: false` (stddev 24.24),
  **0 Console-/Page-Errors**, WEBGL2, 720 Triangles, Test-Daten `#voxel-stats` korrekt befüllt.
- Vision-Modell (text-only-Brücke) bestätigt den Render: freistehende Terrain-Säule **Grün
  (Gras-Kappe) / Braun (Dirt) / Grau (Stein)**, Kanten sauber, keine Seams/Artefakte — der
  Per-Face-Layer-Beweis (Array-Texture, keine Bleeding) steht.

### Lehre

- Mesh-/Geometrie-Unit-Tests müssen **echte Positionsdaten** asserten (nicht nur Zählungen):
  Index-Fehler erzeugen stille Black-Screens ohne GL-Fehler.
- Das M0-Live-Gate bleibt in `.agents/scratches/check-voxel-m0.mjs` als wiederverwendbarer
  CI/QA-Baustein erhalten (SwiftShader-Pins, Pixel-Statistik, Fehler-Zählung).

## 2026-10-19 — M0 freigegeben & implementiert ("Skelett + EIN statischer Chunk")

**Status:** ✅ M0 implementiert (Freigabe-Entscheidung §4.4 #1: **Sample-App `voxel-prototype`**,
nicht Showcase). Research-Vorsprung seit 16./17.10. ist damit eingelöst (53-Quellen-Dossier hat
Folge-Commit).

### Was gebaut wurde

- **App-Shell** `apps/sample-apps/voxel-prototype/` (`index.html` + `App.ts` + `index.ts`-Barrel),
  registriert in `vite.config.ts` (`voxelPrototype`).
- **`voxel/BlockRegistry.ts`** — Single Source of Truth für Block-Semantik (id/name/transparent/
  `collidable`/`faceLayers`), kein Singleton, pro Instanz; Seed-Set Grass/Dirt/Stone. `FACE_AXIS` als
  frozen const object + Literal-Type (kein `const enum`, Repo-Konvention).
- **`voxel/Chunk.ts`** — reine DATA (Uint8Array, 16³, `[x + z*s + y*s²]`), `getBlock`/`setBlock`/
  `fill`/`dirty`. Out-of-bounds `getBlock` → AIR (exakt das, was der Naive-Mesher für Randflächen
  braucht; M1 ersetzt das durch Nachbar-Read).
- **`voxel/mesh/NaiveMesher.ts`** — naives Visible-Face-Culling (produktions-Baseline nach Dossier
  §1.4 (b), Greedy = späteres Milestone). **Windung garantiert per Konstruktion**: jede Face hat
  Tangenten-Basis mit `cross(TA,TB) === Normal` (Unit-Test assertet das). Ausgabe = pure Typed
  Arrays (`VoxelMeshData`, structured-clone-fähig für M1-Worker). Emittiert bewusst **kein** Engine-
  Import → node-testbar.
- **`voxel/mesh/VoxelChunkGeometry.ts`** — dünner `AbstractGeometry`-Adapter (Bounds,
  `getGeometryData` für Upload), `generateGeometryData()` = no-op.
- **`voxel/material/BlockMaterial.ts`** — `CustomShaderMaterial`, **GLSL300-Triplet**,
  `sampler2DArray u_blockAtlas`. Atlas-Layer reist per-Vertex in `a_color.x` (Engine-fixierter
  Attribut-Slot 11 / `VERTEX_COLOR_LOCATION`) → kein Bleeding per Konstruktion (Array-Texturen =
  separate Layer).
- **`voxel/material/shaders/BlockMaterial.vert.glsl` / `.frag.glsl`** — Vertex deklariert den
  `GlobalUniforms`-std140-Block **exakt** aus dem Engine-Header (bindet der Engine-`WebGLProgramCache`
  an jedes Programm), nutzt `u_vp`/`u_model`; Fragment sampelt Layer über
  `vec3(uv, float(v_texLayer))`, minimale selbstenthaltene N·L-Beleuchtung (M0 = Vertrag, keine
  Engine-Lichtdaten).
- **`voxel/BlockTextureFactory.ts`** — prozedurale, **lizenzfreie** Palette als `TextureArray`
  (Canvas + `createImageBitmap`, NEAREST/CLAMP/no-mipmaps); deterministischer Speckle pro Layer,
  je Layer eigene Farbfamilie → falsche Layer/Bleeding wären visuell sofort sichtbar.
- **Tests** (`tests/`): Winding-Invariante, Face-Counts (Einzelvoxel=6, Paar=10 mit ge­­cullter
  gemeinsamer Fläche, Rand-Exposition, transparenter Nachbar cullt nicht, Vollmasse 16³ = 3072
  Dreiecke = exakt die Außenschale), Layer-Mapping Grass (top=0/side=1/bottom=2), Chunk-/Registry-
  Verträge.

### Verifikation (M0-Gate)

- `npm run lint:fix`, `npm run build:lib`, `npm run test` grün (siehe Gate-Ergebnisse unten).
- Browser-Live-Check: Orbit-Kamera um die Terrain-Säule (freistehend, Gras-Kappe/Dirt-Körper/
  Stein-Sockel); 3 Atlastexturen sichtbar; `#voxel-stats` zeigt Renderer/Objects/Triangles.

### Bewusste Scope-Entscheidungen (Dossier-Disziplin)

- **WebGL2-Default** (Dossier §4.4 #5): App pinnt `WEB_GL2` (Override via `?rendererType=` für
  CI). **WebGPU (`wgsl`-Material) bewusst NICHT in M0**: der WebGPU-Material-Bind-Group der Engine
  bindet feste 2D-Texture-Views (`u_diffuseMap`, …), keine Array-Texture-Views → `texture_2d_array`
  bräuchte eine kleine Engine-seitige Bind-Group-Erweiterung. Eigener Folge-Meilenstein, kein
  Scope-Creep in M0.
- **WebGL1 ebenfalls ausgesetzt** — WebGL1 hat kein `sampler2DArray`; 2D-Atlas-Fallback = separates
  Material (später).
- **Worker-Meshing erst M1** — M0 mesht auf dem Main-Thread (Dossier M0 = "Skelett + EIN statischer
  Chunk"). `ThreadPool` + Transferables sind bereits verdrahtet vorgesehen.
- **Keine Kollision, kein Lichtsystem, keine Persistenz** — alles M1+.
- **Klare Positionierung:** "ATM" = 1 Chunk = 1 `Object3D` = 1 Draw-Call (Dave-Report §2.1);
  kein InstancedMesh für Chunks.

### Nächste Schritte (M1)

`ChunkWorld` (Map + Lebenszyklus), `TerrainGenerator` (deterministisches Noise-Heightfield),
`GreedyMesher` im `ThreadPool`-Worker, `MeshWorkerProtocol` (typisierte Transfer-Nachrichten),
Voxel-AABB-Sweep-Resolver für den Spieler, Naht-freies Streaming. → Dossier §4.2 M1.
