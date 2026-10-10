# Project Backlog

> Lebendes, projektweites Gedächtnis für Ideen, offene Punkte und die Entscheidungen dazu — als
> chronologisches Journal geführt statt als klassisches Ticket-Board. Einträge werden nie
> gelöscht oder umgeschrieben, nur mit neuem Status fortgeschrieben (siehe Legende). Neueste
> Einträge stehen oben, wie bei `CHANGELOG.md`. Bei Sessionstart lohnt ein Blick auf die
> offenen (💡/📋/🔜) Punkte der letzten Einträge, bevor man neu anfängt zu suchen.

## Status-Legende

- 💡 **Idee** — aufgetaucht, aber noch nicht entschieden, ob/wann
- 📋 **Offen** — Entscheidung gefallen ("das sollten wir tun"), aber noch nicht umgesetzt
- 🔜 **Zurückgestellt** — bewusst verschoben, mit Grund/Bedingung
- ✅ **Erledigt** — umgesetzt, mit Commit-Referenz falls vorhanden
- ❌ **Verworfen** — bewusst nicht gemacht, mit Begründung

Ein Eintrag darf über mehrere Log-Daten hinweg seinen Status ändern (z. B. 💡 → 📋 → ✅) — dann
am ursprünglichen Eintrag ein `→ Update YYYY-MM-DD: …` anhängen statt einen Duplikat-Eintrag zu
erzeugen.

---

## 2026-10-10 — Rebrand „Small World" → „Small World Machine" verifiziert & Memory-Updates

- ✅ **Memory-Aufnahme:** Session-Neustart nach Rebrand (0.102.0/0.103.0/0.104.0). Verifikation: keinerlei verbliebene
  „Small World"-Referenzen im Quelltext, Docs, ADRs, Guides, Skills, CI oder `CONTEXT.md`/`REFERENCES.md`
  (Ausnahme: absichtlich konservierte historische CHANGELOG/Backlog-Einträge). Klassen-Präfix `SW_*` → `SWM_*`,
  Engine-Einstieg ist `SmallWorldMachine` (`packages/engine/src/core/SmallWorldMachine.ts`), npm-Scopes
  `@small-world-machine/*`, Remote-URL `rottensteiner-stefan/small-world-machine`, Root-Version 0.104.0.
- ℹ️ **Hinweis:** Der Qdrant/GitLab-Projektwissens-Store (hgcloud) kennt dieses lokale Repo nicht — projektweites
  Memory bleibt in `AGENTS.md`, `CONTEXT.md`, `backlog.md` und den App-`log.md`-Dateien.
- ℹ️ **Offene Punkte (Stand heute)** siehe unten — u.a. S1 Wellen-Sonde (Abnahme), Golden-Baseline-Neuaufnahme,
  WebGPU-Block-Artefakt (Showcase 29, Root Cause offen), Mond-Spiegelung (Showcase 16, GL2), StylizedWater
  Phase B (Freigabe), `bunker_blast_door` (Asset-QS).
- ✅ **Korrektur der Liste oben (2026-10-10, nach Prüfung):** erledigt bzw. veraltet waren S1, Showcase-29-Artefakt
  (auf SwiftShader nicht reproduzierbar, Metal ungeprüft), Mond-Spiegelung (nicht reproduzierbar), WebGL1-`finalLight`
  (seit `5f132f5e` behoben), StylizedWater Phase B (seit v0.96.0) samt Ramp-LUT-Restpunkten, `bunker_blast_door`
  (Doku korrigiert, neues Prop `bunker_blast_door_leaf` gesourct), `stairs_down` (Clip-Timing). Offen bleibt die
  Golden-Baseline-Neuaufnahme (siehe Eintrag unten).
- ✅ **Golden-Baseline neu aufgenommen (2026-10-10):** aus CI-Artefakt `liquid-goldens` (Run 38078644281, HEAD `7c9eff85`,
  Chrome 152, Linux), 16 Pools × 2 Views = 32 Zellen inkl. `dead-sea` und `lava-*`. Gesichtet: noir-graphic/top,
  wave-rider/top, clear-water/oblique; übrige Zellen ungesichtet. Der noir-Look (weiße Wirbel auf Grau) ist jetzt Referenz.

- 📋 **Golden-Baseline: Stand 2026-10-10 (korrigiert die Einträge vom 06.–08.10.):** Die Baseline wurde am 8.10. neu
  aufgenommen (Commit `28767d10`, Chrome 152, 12 Pools × 2 Views = 24 Zellen). Compare auf HEAD (GL2, gleiche
  Browser-Version): **24/24 Zellen über 0,5 %**, nicht nur vier. Top/oblique u. a.: noir-graphic 41,3/8,0 %,
  wave-rider 34,1/10,5 %, clear-water 20,1/6,3 %, bold-anime 14,0/5,7 %, painterly-sparkle 13,5/5,6 %, toon-water
  12,9/4,8 %, dead-sea 9,3/3,8 %, soft-watercolor 9,4/4,9 %, toxic-slime 4,6/2,4 %, dredge 4,0/2,1 %, petroleum-oil
  3,1/2,8 %, molten-lava 3,0/1,7 %. Gesichtet (clear-water, noir-graphic, je top): Baseline = dunkle untexturierte
  Kisten, HEAD = texturierte Holzkisten + Schaum; noir-graphic sichtbar anderer Look. Spricht für Inhalt (459 Dateien
  seit der Baseline, u. a. `3323fd5f`). **Nicht bewiesen:** Gegenprobe (Worktree `28767d10` rendern), 22 Zellen
  ungesehen, Plattformanteil (Baseline = Linux-CI, lokal Mac 0/24), Regression im noir-Look nicht ausgeschlossen.
  `scripts/goldens/config.json` führt 16 Pools (zusätzlich `lava-volcanic/-infernal/-plasma/-toxic`), die Baseline
  nur 12 → voller Compare meldet die 4 als Fehler. Neuaufnahmen liegen in `.agents/scratches/goldens/current/`.
  **Offen (Entscheidung User):** Bilder prüfen, dann Baseline per CI-Artefakt `liquid-goldens` inkl. lava-Pools im
  selben Commit wie die Änderung neu aufnehmen.
- ✅ **S1 Wellen-Sonde und Showcase-29-Artefakt geprüft:** S1 war schon umgesetzt (siehe korrigierter Eintrag unten);
  Showcase-29-Artefakt auf HEAD unter SwiftShader/WebGPU nicht reproduzierbar, Metal-GPU ungeprüft.

## 2026-10-09 — ADR 0027: `ObjectUniforms` auf 512 Byte + improve-noir Abschluss

- ✅ **Umgesetzt (volles Programm):** ADR 0027 (`docs/adr/0027-object-uniforms-512-byte-expansion.md`) — `ObjectUniforms`-Puffer auf 512 Byte erweitert, gekaperte Semantik-Slots (`u_isSkinned`, `u_boneOffset`, `u_pad1..3`, PBR/Env-Slots) in `LiquidWaveMaterial`/`StylizedWaterMaterial` auf semantische `matParam0..2` (UBO/WebGPU-Puffer) entflochten; Shader-Parität GLSL100/GLSL300/WGSL für OpenWater + StylizedWater, `StandardWebGPULayout.ts`, `structs.wgsl`, `GPUObjectRingBuffer`, `GPUPipelineCache`; WebGPU-Tests angepasst.
- ✅ **Showcase 10 (Noir):** Parameter-Inhalt des improve-noir-Konsenses (Wellenprofile, `waterAbsorption`) integriert; Session-Dokumente + Referenzbilder unter `.agents/collaborate/` (`improve-noir.*`, `assets/noir_pool_*.png`).
- ✅ **Beim vollen Verifikations-Programm gefunden & behoben vor dem Commit:** (1) `StylizedWaterMaterial.getRenderManifest()` wies `flags` explizit `undefined` zu → `exactOptionalPropertyTypes`-TS-Fehler (dts-Build); jetzt immer `string[]` wie Standard/Phong. (2) `StylizedWater.frag.glsl100` referenzierte den toten `u_pad3`-Slot (GL1-Fragment-Kompilierfehler → Showcase 10 WEB_GL1 rot); veraltete Zeile entfernt, Parität zu glsl300/wgsl wiederhergestellt.
- ⚠️ **Verifikation:** `lint:fix` 0, `build` 0 TS, `tsc --noEmit` 0, Tests 1504/1504, Showcases 10/12/13/16/31/37/38 grün auf allen Backends. Commit siehe Git-Historie 2026-10-09 (`de563711`).

## 2026-10-09 — GL1-PostFX schwarze Frames (Showcases 31/37/38 Dark-Trim) behoben

- ✅ **Root Cause:** `WebGL1Renderer` hatte kein Pendant zu `WebGL2Renderer._ensurePostProcessFbo()` — die HDR-Post-Ressourcen wurden nur in `setSize()` angelegt. Aktivierte ein Showcase PostFX erst in `setupScene()` (nach Init/`setSize`), existierte der HDR-FBO nie → kein Tonemap-Composite → schwarze Präsentation, obwohl der Backbuffer nachweislich korrekt gerendert wurde (`preserveDrawingBuffer`-Readback).
- ✅ **Fix (`WebGL1Renderer.ts`):** neues privates `_reconcilePostProcess()` erzeugt/entfernt HDR-FBO + Post-Passes passend zum aktuellen `postProcessing.enabled` pro Frame (in `bindMainRenderTarget()`) und in `setSize()` — GL1-Gegenstück zu GL2 `_ensurePostProcessFbo()`. Zusätzlich Color-Target fix auf `UNSIGNED_BYTE`: `HALF_FLOAT_OES` + `EXT_color_buffer_half_float` verwerfen auf ANGLE/Metal **und** SwiftShader trotz `FRAMEBUFFER_COMPLETE` jeden Draw stumm (schwarze Frames); GL1 ist Legacy-Pfad, RGBA8 statt verlorenem HDR-Range ist der robuste Kompromiss (im Code kommentiert).
- ✅ **Verifikation:** Showcases 12/31/37/38 grün auf allen Backends (GL1/GL2/GPU). Echte GPU (ANGLE Metal M4 Pro, `--use-angle=default`): 31 GL1 crop mean ≈ 113 (vorher 4.8/schwarz). Build 0 TS-Fehler, ESLint clean, Tests 1505/1505.
- ℹ️ Diagnose-Proben (GLSTATE/OPAQUE/TRANS, HDR-BUF/FB-DIAG) vollständig entfernt; Diff minimal (eine Datei). Commit `633e4674`.

## 2026-10-07 — Map Generator: Universal IO Input Integration

- ✅ **Map Generator (`public/tools/map-gen.html`, `packages/tools/src/MapGenerator.ts`):** Auf den kanonischen `UniversalIngestDropzone` Standard umgestellt. Unterstützt nun Drag & Drop (inkl. Ghost Overlay), Datei- und Ordnerauswahl, URL-Import-Modal, Zwischenablage-Paste (`Cmd+V`) sowie automatisches Ingest-Routing für ASCII-Dateien (`.map`, `.txt`), JSON Level-Beschreibungen, ZIP-Archive und Bild-/Sprite-Rasterisierung mit Farb-Palette-Matching. Unit-Tests in `packages/tools/tests/MapGenerator.test.ts` abgesichert.

## 2026-10-07 — Liquid-Roadmap: S1 Wellen-Sonde und Golden-Baseline

- ✅ **WebGPU: ersetzte Ressourcen werden wieder zerstört, Ursache gefunden und behoben (2026-10-07).** Commit `242390b7`
  hatte die `destroy()`-Aufrufe für Cluster-Buffer, Instanz-Buffer sowie Depth- und HZB-Textur entfernt, weil sonst „Buffer used in
  submit while destroyed" auftrat (gemessen mit `npm run webgpu:resize-stress`: 2099 Meldungen mit `destroy()`, 0 ohne).
  **Ursache:** `CascadedShadowPassGPU` und `SpotShadowPassGPU` halten je ein eigenes `_shadowCasterBindGroup`, eine Kopie des
  globalen Bind Groups, die nur beim Anlegen der Shadow-Map neu gebaut wurde. Ersetzt der Renderer beim Resize die Cluster-Buffer
  (`_allocateClusterBuffers()`), baute er sein eigenes Bind Group neu, die Kopien der Passes zeigten weiter auf die alten
  Buffer. **Lösung:** `WebGPURenderer.globalResourcesVersion` wird beim Ersetzen hochgezählt, die Passes bauen ihr Bind Group
  bei geänderter Version neu; alle Ersatz-Ressourcen werden über `deferDestroyBuffer()` und `deferDestroyTexture()` nach dem
  `queue.submit()` zerstört. Gegenprobe: Ohne die Versionsprüfung kommen die Fehler zurück, und der neue Test in
  `CascadedShadowPassGPUCulling.test.ts` wird rot. **Abgesichert** durch Tests, jeweils per Gegenprobe rot ohne die Korrektur: `CascadedShadowPassGPUCulling.test.ts` und
  `SpotShadowPassGPUCasterBindGroup.test.ts` (Neuaufbau nur bei geänderter Version, Zeichnen nie mit der veralteten Gruppe),
  `WebGPUClusterBufferReplacement.test.ts` (Zähler und verzögerte Freigabe), dazu das Skript `npm run webgpu:resize-stress`.
  **Prüfung auf vergleichbare Fälle (2026-10-07):** Außer den beiden Shadow-Passes legt kein Pass eine Kopie des globalen
  Bind Groups an (`DepthPrePassGPU` und `ClusterCullPassGPU` lesen `renderer.globalBindGroup` bei jedem Aufruf). Alle anderen
  zwischengespeicherten Gruppen vergleichen die Identität ihrer Quell-Views und bauen bei Abweichung neu: `AOPassGPU`
  (`_builtDepthView`), `BloomPassGPU` (`_builtSourceView`), `HistoryBlendPassGPU` (`_builtCurrentView`), `PostProcessPass`
  (drei Views), die Material-Bind-Groups (`_getMaterialBindGroup`, Identität aller Ressourcen); die HZB-Gruppen werden in
  `setSize()` direkt nach dem Ersetzen neu gebaut; die Buffer von Global-, View- und Licht-Gruppen entstehen einmal beim Start;
  das Ring-Buffer-Bind-Group wird bei jedem Draw über den Getter gelesen. **Latenter IBL-Fall, später reproduziert und
  behoben:** Die Kopien der Shadow-Passes halten auch die IBL-Views (Irradiance, Prefilter, BRDF) der Szene. Wechselt
  `scene.irradianceMap`, `prefilterMap` oder `brdfLUT` und wird die alte Textur zerstört (der Textur-Cache zerstört per
  Referenzzähler sofort), blieb eine Kopie auf einer zerstörten View. Reproduktion: Showcase 16, WebGPU, Objekt mit
  Skybox-Material entfernen → 2415 Validierungsfehler. Korrektur: der Renderer hält die gebundenen IBL-Texturen
  (`retainTexture`/`releaseRetainedTexture`, neu vor alt freigeben) und zählt beim Neuaufbau
  `globalResourcesVersion` hoch (`_rebuildGlobalBindGroupForScene`). Danach 0 Fehler (Varianten Freigeben und Tauschen);
  ohne Versionsbump Fehler (Gegenprobe). Tests: `GPUTextureRetain.test.ts`, `WebGPUSceneIblLifetime.test.ts`.

- ✅ **Showcase 10: 3×4-Raster mit zwei neuen Buoyancy-Pools (`wave-rider`, `dead-sea`), schließt die Abnahme
  „`FluidVolume` in einem Showcase verdrahtet" (G6).** Ein Raster (`POOL_CELLS`) ist die einzige Quelle für Pool-Positionen,
  Wiesen-Ausschnitte, Schilder und Golden-Kameras. Beide Pools nutzen `OpenWaterMaterial` und je ein `FluidVolume`, dessen
  `surfaceHeightAt` die Probe (`surfaceHeightAt`, Weltpunkt) mit der Showcase-Uhr aufruft; drei Körper mit 35/50/75 %
  Eintauchtiefe (Pokéball, zwei Kisten) reiten die Fläche, ein weiches Heimat-Federverhalten hält sie im Becken.
  Dead Sea hat Dichte 1,24, dort liegen dieselben Körper sichtbar höher. Golden-Modus setzt `physics.clear()` und die
  Körper zurück (sonst war die Aufnahme nicht reproduzierbar; zwei frische Captures sind jetzt byte-identisch).
  **Offen:** nur Hub-Bewegung, kein Nicken/Rollen (Auftrieb greift am Schwerpunkt an); Nachlauf von rund 10 cm bei 35 cm
  Seegang gemessen (mit der ersten, steileren Einstellung); `goldens/config.json` hat jetzt 12 Pools, die Baseline kennt die
  zwei neuen Zellen nicht, und alle Positionen haben sich verschoben, also ist eine Neuaufnahme nötig.

- ✅ **S1 Wellen-Sonde CPU ↔ Auftriebswahrheit** (Roadmap §8.2 Block S, D5 = Pflicht). Korrektur 2026-10-10: Der frühere
  Eintrag („nicht committet, 3 Abnahmepunkte offen") war veraltet; alles ist committet (`ad9eb8db`, `5481d826`).
  `OpenWaterSurfaceProbe` (f32-Spiegel aller 6 Wellen), `FluidVolume.surfaceHeightAt`, Sampling im `BuoyancySolver`.
  Abnahme: (1) Probe == echter Shader: `npm run probe:gpu-parity` (`scripts/probe-gpu-parity.js`, Headless-Chrome,
  Transform Feedback auf dem echten Vertex-Shader; SwiftShader ≤ 0,12 mm, echte GPU 0,3–13 µm; braucht Dev-Server, läuft
  nicht in vitest/CI) plus Golden-Vector-Regression mit Per-Vektor-Toleranz und G2-Konstanten-Manifest;
  (2) Showcase 10 (Pools `wave-rider`, `dead-sea`) verdrahtet, Integrationstest `ShowcaseBuoyancyIntegration.test.ts`;
  (3) Weltpunkt-Abfrage per Newton mit analytischer Jacobi-Matrix (Gerstner horizontal invertiert), getestet.
  D5-Fallback nicht nötig. **Offen:** Paritätsskript nicht in CI; bei sehr steilen Lane-Sets (Σ Steilheit ≈ 2,2)
  ist die Weltpunkt-Abfrage mehrdeutig (im Code dokumentiert); G6-Bestätigung im CI-Verbund.
- 📋 **Golden-Baseline M1 ist veraltet — Drift ist Inhalt, nicht Chrome:** Die Baseline (6.10., 12:19) zeigt die Szene
  vor dem Showcase-10-Umbau (Kachelraster, Texturen, lit `WorldMaterial`, Schatten, Pokéball-Kugeln). Nachweis
  (2026-10-07): Der Baseline-Commit `9223d305`, mit der heutigen Pipeline gerendert (Chrome for Testing 152,
  SwiftShader), ist für `clear-water` top und oblique byte-identisch zur Baseline. Das Capture-Skript nutzt den
  Puppeteer-Chrome, nicht das installierte Chrome 154/155. Erledigt: `summary.json` speichert die Browser-Version,
  `compare` warnt bei Abweichung, Vorgehen steht in `scripts/goldens/README.md`. **Offen:** die Baseline im selben
  Commit wie die gewollte Bildänderung neu aufnehmen, nach Durchsicht der Bilder (Entscheidung beim User).

---

## 2026-09-29 — Asset-First-Refactor Koje 42/Kältekammer

- ✅ **Prozeduralen Greybox-Fallback in der Whisper-Pro-Log-Szene entfernt** (−197 Zeilen in
  `prologue.ts`). Koje 42 wird ausschließlich über `koje42.level.json` + echte Kit-glTF-Props
  bestückt; neue deklarative `kaeltekammer.level.json` (Schutt + kalte Deckenleuchte).
- ✅ **Runtime-Bug behoben:** Level-Deskriptoren liefen über den Absolutpfad `/scenes/prologue/…`
  in Dev+Build ins Leere (stille 404 → Koje stand ohne Kit-Möbel). Fix: Vite-`new URL("./…",
  import.meta.url)`; die Level-Dateien bleiben damit korrekt unter `apps/…/scenes/prologue/`
  (LevelValidation-Test erzwingt diesen Ort). Fail-Fast statt stummem Greybox.
- 📋 **(Asset-QS) `flakturm/bunker_blast_door` dimensional inkonsistent:** rendert bei
  recommendedScale als ~0.92×1.0×0.94m-Block, Meta.json behauptet 1.8×2.2×0.25m (Tripo3D-Quirk,
  per Bounding-Volume + Vertex-Normalen gemessen). In der Szene als statische Panzertür verarbeitet
  (Vorderfläche bündig, Überlauf-Tiefe in den nicht-modellierten Flur). Für eine **animierbare**
  Tür später: Asset neu skalieren/re-exportieren oder ein schlankes Einzeltürblatt sourcen.
  - *Statuskorrektur 2026-10-10:* Befund bestätigt (GLB-Bounds 0.0092×0.0100×0.0094 × Node-Scale 100 ≈ 0.92×1.0×0.94m).
    `meta.json`-Dimensionen auf die gemessenen Werte korrigiert (war 1.8×2.2×0.25); Szene (`prologue.ts`) nutzt
    bereits die gemessenen Maße. Offen bleibt nur das schlanke Türblatt für eine animierbare Tür (Tripo, Rückfrage).
  - *Nachtrag 2026-10-10:* Schlankes Türblatt gesourct: neues Kit-Prop `flakturm/bunker_blast_door_leaf`
    (`public/assets/kits/flakturm/props/bunker_blast_door_leaf/`, 1 Tripo-Text-to-Model-Generierung, v3.1, 11.3k Tris).
    Roh-Bounds 0.42×1.0×0.96 (Tripo normiert auf 1 m Höhe, fast quadratisch) → per Node-TRS auf 1.6×2.0×0.25 m skaliert,
    Breite entlang X gedreht, Ursprung unten mittig, Radseite +Z, Scharnier-Kante -X. Alter Block bleibt unverändert.
- 💡 **Nächste Asset-Pipeline-Ideen aus dieser Runde (unbewertet):** Kit-Prop für Leichen-
  Schubladen-Wandschrank (ersetzt das prozedurale 3×3-Rack in K-42), ggf. Decken-Prop für die
  Kältekammer-Kaltleuchte konsolidieren (aktuell Kit-`ceiling_lamp` mit kaltem Light-Override).

## 2026-09-29 — Content Drawer im Maker & PBR-Pipeline als Werkzeug-Rüstung

- ✅ **UE5-Style Content Drawer & Asset Browser für den Maker eingebaut.** Dockbarer Bottom-Drawer
  (`Ctrl/Cmd+Space`), Ordnerbaum + Live-Asset-Raster, Sofortsuche, Typ-Filter, nativer HTML5-Drag &
  Drop direkt auf den 3D-Viewport mit Raycast-Platzierung, Doppelklick-/Pin-UX. Abgedeckt sind Kit-
  Props, PBR-Materials, Decals, Primitives, Lights und Prefabs. Ref: `packages/tools/src/maker/ContentDrawer.ts`
  (Commit in 0.88.0).
- ✅ **`pbr.sh` zum vollwertigen CLI ausgebaut** (`--json`/`--config`, Param-Overrides, `--maps`,
  `--resize`, `--quality`, `--help`); obsolete `generate-petra-textures.js` und
  `extract-webgpu-error.js` entfernt. `stone.conf` nachgeschärft; Flakturm: neues `travertine`-PBR-Set,
  `brick_aged` mit besserem AO regeneriert.
- 💡 **Naheliegender nächster Schritt aus der Asset-Pipeline-Runde:** Content-Drawer-Prefabs an die
  bestehende Prefab-Persistenz (glTF) koppeln und den Drawer bei Bedarf später um Kit-Import/
  Weiterbearbeitung (Kit-Customizer) erweitern — noch nicht entschieden, nur vorgemerkt.

## 2026-09-28 — Smartphone-Performance als Thema vorgemerkt

- 💡 **Mobile/Smartphone-Performance & Quality-Tiers.** User hat mehrere Showcases (nicht nur
  Showcase 29 „Sponza Atrium" — generell betroffen) von einem Xiaomi Redmi (Modell 23108RN04Y,
  aktuelle Software) im selben WLAN aus aufgerufen (dazu die lokale `mkcert`-Root-CA per LAN auf
  dem Handy als vertrauenswürdig installiert, damit die selbstsignierte Dev-Server-HTTPS-
  Verbindung ohne Warnung läuft — siehe `https://<Mac-LAN-IP>:5173/...`). Ergebnis durchgängig:
  läuft, aber **sehr zähflüssig**. Wahrscheinlichste Ursache ist nicht der Speicher, sondern die
  GPU-Last: viele Showcases fahren HBAO + Bloom + Schatten-Kaskaden + ACES-Tonemapping gleichzeitig
  auf voller Auflösung, ohne jede Qualitätsreduktion — das ist schon auf Desktop-Mittelklasse-GPUs
  spürbar (Showcase 29 war nur das erste konkret genannte Beispiel). Die Engine hat aktuell **keine
  Mobile-/Quality-Preset-Stufe** (kein dynamisches Downscaling, keine automatische
  Post-Processing-Reduktion je nach Device/GPU-Klasse) — das betrifft also potenziell alle
  Showcases mit aktivem Post-Processing gleichermaßen, nicht nur einen einzelnen. Naheliegender
  Hebel, falls "Smartphone" als eigenes Ziel verfolgt wird: ein generischer Quality-Tier-
  Mechanismus (z. B. automatische Pixel-Ratio-/Post-Processing-Reduktion unterhalb einer
  bestimmten Device-Klasse), nicht ein Showcase-29-spezifischer Fix. Auf User-Wunsch fürs Erste
  nur als Notiz vorgemerkt, keine Entscheidung getroffen.

## 2026-09-27 — Showcase 16 Spiegelungs-Fixes + offener Mond-Magnifikations-Bug (GL2)

- ✅ **Cubemap-Hemisphären-Bug in `DynamicReflectionProbe` gefunden und gefixt** (Auslöser: User
  bemerkte in Showcase 15, dass GL2 den Schachbrettboden in beiden Kugel-Hemisphären spiegelte,
  GPU nur in der unteren, dafür bis zum Rand). Root Cause: `DynamicReflectionProbe._FACE_DIRECTIONS`
  ist eine einzige, renderer-agnostische Tabelle für die 6 Cube-Face-Up-Vektoren, geschrieben für
  die Top-Left-Origin-Konvention (WebGPU/D3D/Metal) — WebGL2/WebGL1 brauchen für FBO-basiertes
  Cube-Face-Rendering negierte Up-Vektoren (klassische OpenGL-Konvention, exakt spiegelverkehrt
  zu three.js' `CubeCamera`-Referenz), was hier fehlte. Fix: neue `_FACE_DIRECTIONS_GL`-Tabelle,
  Auswahl über `renderer.type` (`WEB_GL1`/`WEB_GL2` → GL-Tabelle, sonst unverändert). Live in allen
  3 Renderern von Showcase 15 UND 16 verifiziert und vom User bestätigt ("Jetzt ist es auf allen 3
  Renderern gleich").
- ✅ **Showcase 16 Skybox zu dunkel — neue, hellere IBL-Assets gebacken.** `env.webp` (Mittelwert
  RGB 46/56/69) durch neu generierte, deutlich hellere Variante ersetzt (Mittelwert 75/113/139,
  p95 208 statt 157) — Gemini-Bild-Gen (`gemini-3.1-flash-image`, Referenzbild = altes Original)
  für ein neues Äquirektangular-Panorama im selben Nebel/Sternenfeld-Stil, gebacken über die
  bestehende `public/tools/ibl-gen.html`-Pipeline (Browser-Automation, Blob-Abgriff via lokalem
  Python-Empfangsserver statt Downloads-Ordner — Chrome-Downloads liefen ins Leere/anderswohin),
  `cwebp -lossless` für den finalen WebP-Export. Ersetzt: `env.webp`, `irradiance.webp`,
  `brdf_lut.webp`, `prefilter/mip0-4.webp`. Live in allen 3 Renderern verifiziert: sichtbar
  hellerer, farbigerer Himmel/Boden bei gleicher Ästhetik.
- ✅ **Echter, unabhängiger Bug gefunden+gefixt: Schatten-Kaskaden-Auswahl für Offscreen-Kameras.**
  Die Cascade-Auswahl in `light_calc_pbr.frag.glsl`/`light_calc.frag.glsl` wählt den CSM-Split
  über die Distanz zur AKTUELLEN Kamera (`u_viewPos`) — korrekt für die Hauptkamera, aber die
  Kaskaden selbst werden nur einmal pro Frame relativ zur Hauptkamera gefittet
  (`Scene.updateLights()`). Eine Reflection-Probe/Planar-Reflection sitzt an einer ganz anderen
  Position, bekommt aber dieselbe (falsche) Kaskade zugewiesen. Fix: neuer
  `AbstractWebGLRenderer.isOffscreenRenderTarget`-Getter (WebGL1+WebGL2 implementiert), genutzt in
  `WebGLShadowPass` (überspringt den redundanten Cascade-Atlas-Rebuild für Offscreen-Renders) und
  `WebGL2Renderer.renderBatch()` (deaktiviert Directional-Shadow-Sampling explizit für
  Offscreen-Targets, fällt in den bestehenden "Shadow aus"-Uniform-Pfad). Kompiliert/lint/Tests
  grün (1180/1180), keine Regression in der Hauptkamera-Ansicht.
- ✅ **Korrektur 2026-10-10 — nicht mehr reproduzierbar (Eintrag unten bleibt als Historie).** Showcase 16 per Vite-Dev-Server +
  headless Chrome (SwiftShader, `?rendererType=WEB_GL2` vs `WEB_GPU`) geprüft: WebGPU und WebGL2 zeigen identische, normale
  Mond-Spiegelungen (kleine Flecken, kein riesiger schwarzer Fleck). 20 Frames à ~0,9 s nach 30 s Warm-up auf GL2: kein einziger
  Frame mit dunklem Bereich (Schwarzanteil 0 %). Schwarze Flecken (Cube-Face-förmig, auf allen 3 Kugeln gleichzeitig) traten nur
  in den ersten Sekunden auf: `DynamicReflectionProbe` aktualisiert 1 Face/Frame, noch nicht gerenderte Faces sind schwarz
  (unter SwiftShader mit niedriger FPS sichtbar lang). Das ist Warm-up, kein Moon-/Renderer-Bug; vermutlich haben die späteren
  Fixes (Face-Orientierung GL, Offscreen-Shadow) das ursprüngliche Symptom bereits behoben. Kein Code-Fix nötig. Optional:
  beim ersten `updateReflection` alle 6 Faces rendern, um das Warm-up-Schwarz zu vermeiden.
- 📋 **Offen — Mond-Spiegelung in Showcase 16 zeigt in WebGL2 (nicht WebGPU) einen riesigen,
  komplett schwarzen Fleck**, wenn ein naher Orbit-Mond auf einer der 3 großen Spiegelkugeln
  reflektiert wird. **Per kontrolliertem Vergleich bei identischem `_time`-Wert (deterministische
  Mond-Orbit-Phase, kein Zufalls-Timing) bestätigt: echter GL2-spezifischer Renderer-Bug**, keine
  korrekte Nahfeld-Vergrößerungs-Optik (GPU zeigt an derselben Stelle/Zeit einen normal großen
  dunklen Fleck, GL2 einen die halbe Kugel bedeckenden). Ausgeschlossen als Ursache (alle live per
  gezieltem Ein-/Ausblenden bzw. Konsolen-Instrumentierung getestet): orbitierendes Point Light
  (Ausblenden ändert nichts), Directional-Shadow-Berechnung (der Fix oben behebt dieses Symptom
  NICHT), LOD/Mipmap-Sampling von `u_envMap` (LOD hart auf 0 gezwungen → kein Unterschied). Ein
  letzter Check (`renderTarget.isLoaded === false`, leere `_renderTargetCubeFbos`-Map beim direkten
  GL-Readback von Probe1s Cube-Textur) deutete auf einen möglichen FBO-Ladefehler hin, ließ sich
  aber nicht mehr sauber verifizieren, weil eine parallel laufende zweite Session währenddessen
  live an genau denselben Dateien (`WebGL2Renderer.ts`, `ClusterGrid.ts`, `cluster_cull.wgsl`,
  Tonemapping-Kette) arbeitete — echtes Konfundierungsrisiko für die letzten Testrunden, siehe
  [[project_and_now_concurrent_sessions]]-Präzedenzfall (dort And-Now-Branch, hier derselbe
  Effekt auf dem geteilten Vite-Dev-Server). Nächster Schritt bräuchte entweder einen Zeitpunkt
  ohne parallele Fremd-Edits an diesen Dateien, oder echtes GPU-Frame-Capture-Tooling (Spector.js
  o.ä.), um den tatsächlichen Cube-Face-Textur-Inhalt direkt zu inspizieren statt indirekt über
  Bildschirm-Sampling zu schließen. Auf User-Wunsch hier gestoppt und dokumentiert statt
  weiter auf Verdacht zu fixen.

---

## 2026-09-27 — Thermo-Nuclear Code Quality Review (Formel- & Performance-Audit)

- 📋 **Thermo-Nuclear Review durchgeführt** (`.agents/notes/thermo-nuclear-code-quality-review-2026-09-27.md`).
  Umfassendes Audit über Math, Physix, Shaders, WebGL/WebGPU-Pipelines und Zero-Allocation-Hot-Paths.
  Identifizierte Kern-Handlungsfelder:
  1. **Mathematische/Physikalische Formelfehler (P0/P1):** Invertierte Normalenmatrix `Matrix3.getNormalMatrix` ($(M^{-1})^T$), invertierte Drehrichtung `GearMath.getMeshingRotation`, `Matrix4.lookAt` X-Singularität, `sphereCast` Box-Normalenfehler, Rotations-Render-Interpolation für Quaternions, unphysikalische Masse-Skalierung bei `BuoyancySolver`.
  2. **Shader- & Beleuchtungs-Bugs (P0/P1):** Doppelte Negierung der Sonnenrichtung in WebGL2 (`light_calc*.frag.glsl`), WebGPU HBAO-Normalen auf $(0,0,-1)$ fixiert, invertierter Glas-Spotlight-Konus, WebGPU CSM Fallback auf Cascade 0.
  3. **Hot-Path & Runtime-Performance (P0/P1):** Vector-Leak im `ContactSolver` (3 geleckte Vektoren pro Substep), `acquireTextures` Objektliteral-Flut pro Draw-Call (>2400 Allokationen/Frame), `GPUBindGroup`-Recreation in Shadow-Passes, 4-fache redundante Szenentraversierung pro Frame, fehlende WebGL2-Hardware-VAOs in `Mesh.ts`.

---

## 2026-09-27 — ADR 0024: Entwicklungswerkzeuge als eigenes Ökosystem-Paket

- 📋 **`@small-world-machine/tools`-Paket beschlossen** (`docs/adr/0024-tools-ecosystem-package.md`).
  Auslöser: User-Frage, ob es Sinn ergibt, die Tools (Maker, MaterialStudio, Pixler, Xtractor,
  MapGenerator, Forge) aus `@small-world-machine/engine` auszulagern, da eine ausgelieferte App sie zur
  Laufzeit nie braucht. Bundle-Größe war bereits über dynamische `import()` + unvollständigen
  Barrel-Export gelöst — das eigentliche Problem ist Paket-/Abhängigkeitsgraph-Klarheit und die
  bereits bekannte Lücke, dass `small-world-machine/tools` kein sauber auflösbarer Package-Export ist.
  Kernknoten: `SmallWorldMachine.ts` importiert selbst hartkodiert 5 Tools dynamisch für die
  `enableInspector`-Verdrahtung — ein reiner Umzug hätte das in eine verbotene Kern→Tools-
  Abhängigkeit verwandelt (spiegelbildlich zu ADR 0021s Ein-Weg-Regel). Entscheidung: diese
  Verdrahtung ersatzlos aus dem Kern raus, stattdessen `attachDevTools(app)` aus dem neuen Paket,
  das Apps selbst aufrufen — bewusster Breaking Change für jede App, die sich bisher allein auf
  `enableInspector: true` verlassen hat. Im Kern bleiben `ForgeTool` (Schnittstelle),
  `GridLevelBuilder` und `IBLShaders`/`ibl-gen` (echte Laufzeit-Features, keine Dev-Tools).
  → Update 2026-09-27: ✅ **Umgesetzt.** Neues Paket `packages/tools/` (`git mv`, Historie
  erhalten): `maker/` (19 Dateien + `docs/`), `material-studio/`, `MaterialStudio.ts`,
  `Pixler.ts`, `Xtractor.ts`, `MapGenerator.ts`, `common/` (TextureFilters/CanvasOperations),
  `forge/{Forge,ForgeWindow,ForgeTheme}.ts` — ~25 Dateien von tiefen Relativimporten auf flaches
  `@small-world-machine/engine` umgestellt (Konvention wie `geometry-extras`). `SmallWorldMachine.ts` verliert
  `forge`-Property, den kompletten `enableInspector`-Block und `_onKeyDown` (war ausschließlich
  Forge-Toggle) samt `destroy()`-Cleanup; `EngineOptions.enableInspector` entfernt.
  `attachDevTools(app)` repliziert die alte Verdrahtung 1:1 (Forge + 4 Tool-Fenster, YAD-Map-
  Restore, Alt+Ctrl/Meta+G-Toggle inkl. Pointer-Lock-Kopplung), gibt `{ forge, detach() }` zurück.
  Breaking Change traf mehr Stellen als angenommen: 12 Showcases + 1 Sample-App nutzten
  `enableInspector: true`, alle auf `attachDevTools(app)` migriert. `tweakpane` +
  `@kitschpatrol/tweakpane-plugin-camerakit` von `engine/package.json` nach `tools/package.json`
  verschoben (einziger Konsument `PropertyPanel.ts` ist mitgewandert). Vier `public/tools/*.html`-
  Importpfade + 6 Guide-Docs (waren durch die alte Einschränkung überholt) aktualisiert. Verifiziert
  (unabhängig nachgeprüft): `tsc --noEmit` sauber, volle Testsuite 190/190 Dateien 1092/1092 Tests
  grün (unverändert zur Zahl vor der Migration), `npm run docs:build` sauber, `npm run build:lib`
  sauber (931 kB Hauptbundle, Tool-Code nicht mehr enthalten), voller `vite build` erfolgreich mit
  weiterhin sauber lazy-gesplitteten Tool-Chunks.

---

## 2026-09-27 — MAJ-10: MaterialStudio.ts + MakerApp.ts modularisiert

- ✅ **`MaterialStudio.ts`** 2189 → 218 Zeilen. Neu unter `packages/engine/src/tools/material-studio/`:
  `materialStudioStyles.ts` (CSS-String), `MaterialStudioUiBuilder.ts` (DOM-Aufbau),
  `MaterialStudioController.ts` (PBR-Orchestrierung + Event-Wiring, bewusst EINE Klasse statt
  zwei — beide Verantwortlichkeiten teilen sich denselben mutablen State und riefen sich
  gegenseitig auf, eine erzwungene Trennung wäre nur Getter/Setter-Weiterreichung gewesen).
  `MaterialStudioApp` unverändert (harter externer Vertrag: `public/tools/pbr-gen.html`,
  `SmallWorldMachine.ts`). tsc/eslint sauber, 92 Tests grün.
- ✅ **`MakerApp.ts`** 2175 → 1698 Zeilen (−22%). Neu: `MakerPrefabPipeline.ts`,
  `MakerImportAndZoneTools.ts`, `MakerToolbarBuilder.ts`. Bleibt bewusst über 1000 Zeilen —
  Selection/Gizmo-Drag/Pointer-Picking/undo-gestützte Szenenbearbeitung teilen sich durchgängig
  `_undo`/`_selection`/`_propertyPanel`/`_project`, echte Unterschreitung bräuchte ein
  gemeinsames `EditorContext`-Objekt (eigene, größere Entscheidung). tsc/eslint sauber, 60 Tests
  grün, volle Suite (190 Dateien/1092 Tests) danach nochmal gegengeprüft.
- Beide Extraktionen per Fork durchgeführt und von mir unabhängig nachverifiziert (tsc + volle
  Testsuite). `docs/research/codebase-review-2026-09-18-thermo-nuclear.md` MAJ-10 aktualisiert:
  als "teilweise behoben" markiert, mit Begründung für die verbleibende Ausnahme; die 4
  ursprünglich mitgenannten, aber nie als Roadmap-Punkt getrackten Dateien
  (`character-diorama/showcase.ts`, `prologue.ts`, `ViennaMapModal.ts`, `Pixler.ts`) bleiben
  unverändert über 1000 Zeilen, ausdrücklich als Scope-Fakt vermerkt, nicht als Regression.
  → Update 2026-09-27: ✅ Review gegengeprüft (alle Fixes intakt, auch nach dem `packages/tools/`-
  Umzug) — Report-Datei gelöscht, Index-Eintrag in `docs/research/index.md` entfernt. Einziger
  offener Rest bleibt genau der oben genannte: die 4 nie getrackten Dateien über 1000 Zeilen.

---

## 2026-09-26 — Doku-Restrukturierung: AGENTS.md/.agents/docs vereinheitlicht

- ✅ **AGENTS.md an Repo-Root verschoben** (`.agents/AGENTS.md` → `AGENTS.md`), `CLAUDE.md`/`GEMINI.md`
  verweisen beide korrekt darauf. AGENTS.md um vollständige Skill-Liste (alle 9 statt 6) und eine
  neue "Further Documentation"-Sektion ergänzt (Pointer auf `CONTEXT.md`, `docs/adr/`,
  `docs/guides/`, `docs/research/`), damit auch Nicht-Claude-Code-Agenten (Gemini CLI, generische
  AGENTS.md-Konsumenten ohne Skill-Tool) die relevanten Standards finden, ohne dass sie bei jedem
  Request mitgeschickt werden müssen.
- ✅ **`.agents/notes/` von veralteten Snapshots befreit**, echte "living" Standards
  (`backlog.md`, `asset-sourcing-guideline.md`, `app-docs-convention.md`) bleiben. Abgeschlossene
  Prüfberichte wanderten ins bereits etablierte `docs/research/`-Archiv (mit Cross-Links):
  `thermo-nuclear-codebase-review.md` → `docs/research/codebase-review-2026-09-18-thermo-nuclear.md`,
  `plan-0-from-phase-1.md` → `docs/research/plan-0-level-descriptors-2026-09-18.md` (mit
  Vermerk "abgelöst durch ADR 0020").
- ✅ **`docs/guides/index.md` und `docs/apps/index.md` neu angelegt** (fehlten bisher komplett,
  obwohl 24 bzw. 4 Dateien im Ordner lagen und schon eigene VitePress-Sidebar-Einträge hatten) —
  analog zum bestehenden Muster von `docs/adr/index.md`/`docs/research/index.md`.
- ✅ **`session-state.md` hierher gefaltet** (dieser Eintrag) statt als eigene, seit 2026-09-04
  stehengebliebene Datei weiterzuführen — ihr einziger Inhalt war ohnehin ein Commit-Rückblick
  auf die damalige Review-Aufräum-Initiative (`6931b847`…`2f20a63e`, siehe `git log`) plus ein
  Regelwerk, das inzwischen 1:1 in `AGENTS.md` steht.
- ✅ **`docs/research/research.txt`** (loses Prompt-Fragment zu einem nie begonnenen
  "Disc Wars"-Recherche-Auftrag) wurde im Zuge dieser Aufräumaktion entfernt (parallel zur
  Session, nicht von diesem Agent-Lauf selbst gelöscht, aber bestätigt konsistent mit der
  Empfehlung oben).
- ✅ **`docs/research/`-Reviewberichte einzeln gegen den Live-Code verifiziert** (User-Anfrage
  2026-09-26) und alles wirklich Erledigte entfernt: `codebase-review-2026-08-22.md` (alle 15
  Findings bestätigt gefixt/bewusst verworfen), `diorama-environment-architecture.md` (alle 3
  Maßnahmen umgesetzt, u. a. Lampen jetzt `wall_lamp.glb` statt Custom-Geometrie),
  `projekt-raum.md` (vollständig umgesetzt als `apps/showcases/37/`), `xdp-game-networking.md`
  (auf User-Wunsch entfernt, unabhängig vom Reference-Charakter). Bewusst NICHT gelöscht:
  `aaa-engine-techniques.md` (am 2026-09-27 zur **pflegbaren Wunschliste** umgebaut: fester Bestand der
  umgesetzten Punkte verifiziert — u. a. #14 HZB inzwischen gebaut via ADR 0008 — und offene Punkte
  konsolidiert: volumetrischer Nebel Stufe B als nächstes großes Vorhaben, volles GTAO, LOD, Billboards,
  volles TAA), `codebase-review-2026-09-18-thermo-nuclear.md` (2 offene Punkte: MakerApp-/
  MaterialStudio-Modularisierung, MAJ-10), `showcase-feature-audit.md` (veraltete Inventur statt
  Erledigt/Offen-Ticket, mit Stale-Hinweis versehen statt gelöscht), `oil-puddle-shader-technique.md`
  (Referenzformeln-Abschnitt dauerhaft gültig, Pfad-Hinweis ergänzt), `plan-0-level-descriptors-2026-09-18.md`
  (historische Q&A-Herleitung zu ADR 0020, mit Abgelöst-Vermerk verschoben statt gelöscht).
  → **Update 2026-09-27:** `showcase-feature-audit.md` analog zu `aaa-engine-techniques.md`
  zur **pflegbaren Wunschliste** umgebaut: ehemalige Lückenliste gegen den Live-Code verifiziert
  (word-boundary-grep über `apps/` + `packages/engine/src/`) und als Wunschliste F1–F9
  konsolidiert (AreaLight, FluidVolume, TaaElement, MotionTrailElement, OscillatorBehavior,
  StateMachineBehavior, CameraStrategyType.FIXED, CCD, OBB — alle weiterhin 0 Treffer in `apps/`);
  `HbaoElement` (#27/29/32) und `Line` (#6) inzwischen geschlossen; historische Feature-Matrix
  bleibt als Referenz-Anhang erhalten. `docs/research/index.md`-Eintrag entsprechend aktualisiert.
  → **Update selbes Datum zum obigen Eintrag (`codebase-review-2026-09-18-thermo-nuclear.md`,
  „bewusst NICHT gelöscht"):** Die Angaben im Backlog sind überholt — die Datei wurde im
  Verlauf des 2026-09-27 doch entfernt (paralleler Workstream): ihre einzigen beiden offenen
  Punkte (MakerApp-Modularisierung, MAJ-10) sind an diesem Tag umgesetzt worden
  (`MaterialStudio.ts`/`MakerApp.ts` modularisiert), wodurch das Review-File ohne offene Inhalte
  war. VitePress-Sidebar-Link in `docs/.vitepress/config.mts` entsprechend entfernt
  (Konsistenz-Nachtrag in derselben Session).

---

## 2026-09-13 — Echtes IBL für 6 Showcases + gefundener AO-Uniform-Bug (WebGL1+WebGL2)

- ✅ **Auslöser:** Showcase 15s Spiegelkugeln (`metallic:1.0, roughness:0.02`) wirkten "kaputt
  dunkel". Untersuchung ergab zunächst: keine echte IBL (Irradiance/Prefilter/BRDF-LUT), nur
  flaches `u_ambientColor`. Vorhandene Bake-Pipeline (`public/tools/ibl-gen.html` +
  `packages/engine/src/tools/ibl-gen.ts`, `IBLBaker`) wird bislang nur von Showcase 16 korrekt
  genutzt — 13/27/28/30/36 setzen `irradianceMap`/`prefilterMap` fälschlich auf die rohe,
  unkonvolvierte Skybox (kein `brdfLUT`).
- ✅ **Zwei neue Equirect-Panoramen per Gemini generiert** (`.agents/scratches/`, git-ignored):
  ein "Nebula"-Motiv (für die 5 Showcases mit gemeinsamer Skybox, 13/15/27/28/36) und ein
  "Vienna Ruins Sky"-Motiv (nur Showcase 30, eigene Skybox). Erster Versuch für Vienna zeigte
  sichtbare Kachel-Wiederholung der Referenz — mit präziserem Prompt ("kein Tiling, erfinde
  durchgehende Skyline") im zweiten Anlauf sauber gelöst.
  → Lektion: [[feedback_multipanel_image_gen]]-artig — ein Referenzbild kann das Modell zum
  wörtlichen Kacheln verleiten, wenn der Prompt "seamless 360°" nicht explizit "keine Wiederholung,
  erfinde Neues" dazuschreibt.
- ✅ **Baking über die bestehende `ibl-gen.html`-UI automatisiert** statt neu gebaut: Datei-Upload
  + Klick über `claude-in-chrome`-Automatisierung, echter Browser-Download (`ibl_maps.zip`, nach
  expliziter Nutzerfreigabe) statt direktem JS-Datenkanal (der blockt Base64-Bild-Rückgaben als
  Sicherheitsmaßnahme). PNG→WebP-Konvertierung lokal via `cwebp -lossless`. Alle 6
  `apps/showcases/{13,15,27,28,30,36}/assets/ibl/` befüllt, alle 6 `showcase.ts` auf das
  Showcase-16-Muster verdrahtet (Skybox bleibt unverändert sichtbar, nur die unsichtbaren
  IBL-Maps sind neu).
- ✅ **Echter Bug gefunden und gefixt, nicht nur IBL-Lücke:** `StandardMaterial.getRenderManifest()`
  schreibt AO nur in `u_extraParams.x` (das WGSL/WebGPU korrekt liest). Die GLSL-Shader
  (`Standard.frag.glsl` für WebGL2, `Standard.frag.glsl100` für WebGL1) lasen AO aber aus einem
  eigenen, nie befüllten `uniform float u_ao` — Default 0.0, multipliziert die GESAMTE
  Ambient-Formel (`ambient = (...) * ao`) auf beiden GLSL-Renderern permanent auf Null.
  Vermutlich ein alter Refactor-Rest (AO wurde mal in `u_extraParams` gebündelt, WGSL wurde
  angepasst, die beiden GLSL-Dateien nicht). Betraf **jede** WebGL1/WebGL2-Szene mit spürbarem
  Ambient-Anteil, nicht nur IBL — nur durch dieses konkrete, ambient-lastige Szenario extrem
  auffällig geworden. Fix: `u_ao`-Uniform entfernt, beide Shader lesen jetzt `u_extraParams.x`.
  Live in allen 3 Renderern verifiziert (dramatische, korrekte Verbesserung: Spiegelkugeln zeigen
  jetzt eine echte Umgebungsreflexion statt Schwarz).
- 📋 **Nicht in diesem Schritt:** kein IBL für WebGL1 (bleibt architektonisch ohne echten
  IBL-Pfad, nur der jetzt reparierte flache/`u_envMap`-Fallback-Pfad profitiert mit). Der
  unabhängige `USE_IBL`-Flag-Bug (`WebGL2Renderer.ts` prüft nur `irradianceMap||prefilterMap`,
  ignoriert `brdfLUT`) betraf unseren Fall nicht (wir setzen immer alle drei) und wurde nicht
  angefasst. Kein ADR geschrieben (nicht verlangt, nur angeboten).

---

## 2026-09-12 — ADR 0016 Phase 2.3+2.4: Hintergrundbild-Import + Klick-zum-Zeichnen — ADR 0016 KOMPLETT

- ✅ **Dritter + vierter Maker-UI-Teilschritt, damit ist ADR 0016 vollständig umgesetzt.**
  - **2.3:** `BackgroundPlane` (neuer `Object3D`-Marker-Subtyp, `instanceof`-erkennbar) +
    `BackgroundImportPanel` (Datei-Picker + Drag&Drop aufs Viewport). Höhe wird immer aus Breite
    + Bild-Seitenverhältnis abgeleitet, nie frei eingebbar — Bild kann nie gestreckt werden.
    `StageProjectionResolver` erweitert: fällt auf eine `BackgroundPlane` zurück, wenn kein
    `StageMovementBehavior` mit `"flat-plane"` existiert (z.B. eine brandneue Szene) — und bekam
    dabei `fromWorld`/`planeOrigin`/`planeNormal` ergänzt (nicht nur `toWorld`), damit ein
    Maus-Ray überhaupt gegen die Projektionsebene geschnitten werden kann.
  - **2.4:** Klick-zum-Zeichnen (`Z` togglet einen exklusiven Modus, Linksklick platziert Punkte
    per Ray/Ebenen-Schnitt gegen die aufgelöste Projektion, `Enter` schließt ab min. 3 Punkten zu
    einem echten `StageZoneMarker` — genau EIN Undo-Command über `addObject()`, `Escape` bricht
    verwerfend ab) + Viewport-Punkt-Ziehen (Handle greifen, Ray/Ebenen-Schnitt pro
    Pointer-Move, genau ein Undo-Command bei Loslassen — exakt das `_finishGizmoDrag`-Muster).
  - **Kleine Zusatz-Aufräumarbeit unterwegs (User-Hinweis):** ~11-fach wiederholter
    `"INPUT"/"TEXTAREA"[/"SELECT"] === active.tagName`-Block in `_onMakerKeyDown` zu einem
    `_isEditingField()`-Helper vereinheitlicht (dabei sogar strenger gemacht: jetzt überall
    inklusive SELECT-Guard, vorher nur an einer Stelle). Bewusst NICHT das `Keys`-Enum für
    `"Enter"`/`"Escape"` verwendet — das Enum ist explizit für `event.code` (Spiel-Input-Polling),
    diese Funktion vergleicht durchgängig gegen `event.key`; nur 2 von ~20 Vergleichen umzustellen
    wäre inkonsistenter als der Ist-Zustand gewesen.
  - Live in Maker Ende-zu-Ende verifiziert: echtes Flakturm-Hintergrundbild importiert (Aspect
    exakt 1376/768 = 1.7917 reproduziert), 4 Punkte per synthetischem Klick gesetzt, Enter erzeugt
    echten `StageZoneMarker` im Szenengraph, Punkt-Ziehen aktualisiert u/v live und committet
    genau einen Undo-Schritt, Undo stellt den Originalwert exakt wieder her. Keine Konsolenfehler.
  - **Vom User live in der Browser-Tab-Gruppe entdeckter Bug (nicht durch eigene Verifikation
    gefunden):** importiertes Hintergrundbild stand auf dem Kopf. Ursache: `createImageBitmap(file)`
    dekodiert top-down, aber `Texture.fromUrl(..., {flipY:true})` (das `flakturm-tunnel` selbst
    für exakt dasselbe Bild nutzt) geht über `AssetManager.loadImage()`, das mit
    `createImageBitmap(blob, {imageOrientation:"flipY"})` dekodiert — `TextureOptions.flipY`
    wird vom `Texture`-Konstruktor selbst nie ausgewertet, nur von `fromUrl`s Vorverarbeitung.
    `_importBackgroundImage` nutzte `Texture.fromImage(bitmap)` mit einem plain
    `createImageBitmap(file)` ohne diese Option — gefixt durch denselben
    `{colorSpaceConversion:"none", imageOrientation:"flipY"}`-Aufruf. Live mit demselben
    Flakturm-Bild nachverifiziert: steht jetzt korrekt.
  - **Bewusste Scope-Grenze:** kein echter Datei-Speichern/Laden-Roundtrip live getestet (braucht
    einen realen, vom User gewählten Projektordner über die File-System-Access-API — im
    Sandbox-Browser nicht automatisierbar). Die eigentliche Serialisierung (`SW_stage_zone`) ist
    bereits in Phase 1 über echte Roundtrip-Unit-Tests (4- und 6-Punkte-Fixtures) abgedeckt.
  - Verifiziert: `tsc`/`eslint`/`vitest` (752/752) grün, `npm run build` grün.
  - **ADR 0016 ist damit vollständig umgesetzt** (Phase 0/1/2). Phase 3 (Fluchtpunkt-Werkzeug,
    Snapping) und Phase 4 (KI-Chat-Panel) bleiben wie im ADR selbst festgehalten explizit
    außerhalb des Umfangs — spätere, separate Schritte.

## 2026-09-12 — ADR 0016 Phase 2.2: PropertyPanel-Punktlisten-Editor für Zonen

- ✅ **Zweiter Maker-UI-Teilschritt.** Neuer hartkodierter Sonderfallblock in `PropertyPanel.ts`
  (strukturell parallel zum Material-/Behaviors-Folder-Muster, da variable-Länge-Listen im
  generischen `Inspectable`-Schema kein Vorbild haben): "Zone Points (N)"-Folder mit einem
  aufklappbaren Unter-Folder pro Punkt (U/V/Scale-Felder + "🗑 Remove Point", ausgeblendet bei
  `points.length <= 3`), "+ Add Point"-Button am Ende. Undo-Granularität: jede einzelne
  Feldänderung/Add/Delete ist ihr eigener `UndoCommand` — konsistent mit jedem anderen Zahlenfeld
  in diesem Panel (nicht mit dem Gizmo-Drag-"ein Command pro Drag"-Muster).
  - Kleiner, aber notwendiger Zusatzfund: Punkt-Edits mutieren `zone.points` direkt, nicht ein
    Feld auf dem `StageZoneMarker` selbst — die generische `onPropertyChanged`-Identitätsprüfung
    in `_createFieldBinding` (`host === this._currentObj`) hätte für Punkt-Edits nie gefeuert,
    was Autosave stillschweigend übersprungen hätte. Eigene `_notifyZoneChanged()`-Methode löst
    das gezielt.
  - Live in Maker verifiziert: Punkte-Folder korrekt gerendert, U/V/Scale-Werte korrekt, "Add
    Point" fügt den erwarteten Mittelpunkt der letzten beiden Punkte hinzu, Undo (Ctrl+Z) stellt
    den vorherigen Zustand korrekt wieder her, keine Konsolenfehler.
  - Verifiziert: `tsc`/`eslint`/`vitest` (752/752) grün, `npm run build` grün.
  - **Nächster Schritt:** 2.3 (Hintergrundbild-Import), 2.4 (Klick-zum-Zeichnen).

## 2026-09-12 — ADR 0016 Phase 2.1: StageZoneGizmoManager (Anzeige + Auswahl in Maker)

- ✅ **Erster Maker-UI-Teilschritt.** Neuer `StageZoneGizmoManager` (direktes Vorbild
  `LightGizmoManager`) zeigt jede `StageZoneMarker`-Zone als Outline (`Polyline`-Geometrie, neu) +
  halbtransparente Füllfläche (`PolygonFan`-Geometrie, neu — dieselbe Fächer-Triangulation wie
  `StageZone.getScaleAt`) + Punkt-Handles (Octahedron). Neuer `StageProjectionResolver` findet
  eine `"flat-plane"`-Projektion aus einem `StageMovementBehavior` in der Szene, damit Zonen
  überhaupt irgendwo in 3D platziert werden können (Ergebnis wird wie bei `_liveLights`/
  `_liveMarkers` nur bei Hierarchie-Änderung neu aufgelöst, nicht pro Frame). Vollständig in
  `MakerApp` verdrahtet: Picking, Hierarchy-Panel-Sichtbarkeit, Thumbnail-Capture-Ausblendung.
  - **Echter, vorbestehender Engine-Bug gefunden + gefixt beim Live-Verifizieren:**
    `BasicMaterial.getRenderManifest()` synct nie `state.blending` aus `this.transparent` (anders
    als `StandardMaterial`/`PhongMaterial`/`SpriteMaterial`, die das explizit selbst tun) —
    `transparent = true` hatte auf `BasicMaterial` schlicht keine Wirkung, unabhängig vom
    Renderer (WebGL1/2 UND WebGPU keyen ihr Blend-State auf `state.blending`, nicht
    `state.transparent`). Kein bestehender Code verließ sich auf das kaputte Verhalten (geprüft).
    Gefixt nach demselben Muster wie `StandardMaterial`.
  - Live in Maker verifiziert (Test-Zone per Konsole injiziert, da das Zeichenwerkzeug erst in
    2.4 kommt): Outline/Füllfläche/Handles rendern korrekt, Klick auf Füllfläche selektiert die
    `StageZoneMarker` (nicht die rohe Mesh), Property-Panel zeigt automatisch generiertes Schema
    inkl. "Display Name" (`zone.name`), Transform-Gizmo hängt sich korrekt an.
  - Verifiziert: `tsc`/`eslint`/`vitest` (752/752) grün.
  - **Nächster Schritt:** 2.2 (PropertyPanel-Punktlisten-Editor), 2.3 (Hintergrundbild-Import),
    2.4 (Klick-zum-Zeichnen).

## 2026-09-12 — ADR 0016 Phase 1 + neue ADR 0017: glTF-Extension-Registry, SW_stage_zone

- ✅ **Zweite Umsetzungsphase von ADR 0016.** Statt `SW_stage_zone` als dritten hartkodierten
  if/else-Zweig neben `KHR_lights_punctual`/`SW_prefab_instance` in `GltfLoader`/`WorldWriter`
  einzubauen (User-Wunsch, während der Recherche aufgekommen — proprietäre glTF-Extensions
  können sich als De-facto-Standard durchsetzen, ohne je `KHR_`/offiziell zu werden, z.B.
  `EXT_mesh_gpu_instancing`): neuer genereller `GltfExtensionPlugin`-Mechanismus
  (`registerGltfExtension()`), die zwei bestehenden Extensions dorthin migriert (verhaltens-
  identisch, alle 29 vorherigen Loader-Tests unverändert grün), `SW_stage_zone` als dritter,
  sauberer Registry-Eintrag. Neue ADR 0017 dokumentiert die Entscheidung inkl. der verworfenen
  Alternative "eigenes `@small-world-machine/gltf-extensions`-Package für diese drei" (Zirkelabhängigkeit
  — sie sind Default-Verhalten und brauchen zwingend Engine-Typen; ein externes Package bleibt
  aber der richtige Ort für spätere, echt optionale Community-Extensions).
  - `StageZoneMarker` (aus Phase 0) ist jetzt über `SW_stage_zone` roundtrip-fähig — 4-Punkte- UND
    6-Punkte-Fixture getestet, `extensionsUsed` wird jetzt korrekt befüllt (Nebenfund: fehlte
    bisher komplett, auch für die zwei alten Extensions).
  - Beim Umsetzen fiel eine Abweichung von ADR 0016s eigener Behauptung auf ("beide Szenen passen
    exakt in flat-plane") — `character-diorama` mappt tatsächlich v→Weltraum-Z (Boden), nicht
    v→Y (Wand), passt nicht in `"flat-plane"`. Läuft daher über `projection:{mode:"custom"}`
    weiter mit seiner bestehenden Closure — funktional unverändert, aber (noch) nicht
    Maker-roundtrip-fähig. ADR 0016 mit Status-Notiz korrigiert, nicht stillschweigend übergangen.
  - Verifiziert: `tsc`/`eslint`/`vitest` (752/752) grün, `npm run build` grün.
  - **Nächster Schritt:** Phase 2 (Maker-UI: Zonen zeichnen/bearbeiten, Hintergrundbild-Import).

## 2026-09-12 — ADR 0016 Phase 0: StageZone/StageMovementBehavior verallgemeinert

- ✅ **Erste Umsetzungsphase von ADR 0016** (Flakturm-Tunnel im Maker editierbar machen).
  `StageZone.points` von starrem 4-Tupel auf `StagePoint2D[]` (min. 3) verallgemeinert;
  `getScaleAt` läuft jetzt über einen Fächer aus `n-2` Dreiecken (bei n=4 byte-identisch zum
  alten Zwei-Dreiecks-Code); `getLocalAxes(u,v)` bekam einen Positions-Parameter (von der
  Recherche als notwendig erkannt, nicht explizit im ADR — der Gradient ist nur pro
  Fächer-Dreieck konstant, ab n>3 ohne Abfragepunkt nicht wohldefiniert) und nutzt für n=4
  weiterhin exakt die alte Eckenpaar-Formel (keine Verhaltensänderung für zone_a/b/c), für n≠4
  einen neuen Skalierungs-Gradienten (hergeleitet, mit Entartungsfall-Fallback).
  `StageZoneMarker extends Object3D` (neue Datei) gibt Zonen erstmals eine Szenengraph-Präsenz
  (Komposition, nicht `StageZone extends Object3D` — Details/Begründung im Plan). `uvToWorld`
  von `StageMovementBehaviorOptions` zu `StageProjection`-Tagged-Union (`"flat-plane"` |
  `"custom"`) gemacht; `flakturm-tunnel` läuft jetzt über `"flat-plane"`, `character-diorama`
  bleibt `"custom"` (seine Formel mappt v→Weltraum-Z statt v→Y, passt nicht ins
  flat-plane-Schema). `static inspector` für `StageMovementBehavior` ergänzt.
  - Verifiziert: `tsc`/`eslint`/`vitest` (750/750, 6 neue Tests) grün, `npm run build` grün,
    Flakturm-Tunnel live im Browser geprüft (Position/Skalierung unverändert korrekt).
  - **Nächster Schritt:** Phase 1 (glTF-Format: Extension-Registry + `SW_stage_zone`).

## 2026-09-12 — Nachlauf zur Workspaces-Migration: Hub-Seite, Docs-Port, absolute Pfade, v0.78.00

- ✅ **`public/index.html` neu gegliedert** in 4 klar getrennte Abschnitte (User-Vorgabe: Einstieg,
  Showcases, Tools, Apps) statt Apps und Showcases in einem gemeinsamen Grid zu vermischen. Der
  seit langem sinnlos gewordene Untertitel "System Initialization // Engine Diagnostics" ersetzt
  durch "Showcase & Development Hub". Live im Browser geprüft (alle 4 Abschnitte sichtbar, keine
  Konsolenfehler).
- ✅ **Portkonflikt `docs:dev` vs. Haupt-Dev-Server behoben.** VitePress bindet standardmäßig auch
  auf 5173 und hatte beim Start den Haupt-Engine-Server (HTTPS-Multiplexer) stillschweigend
  verdrängt — derselbe Fehlerklasse-Vorfall wie schon einmal früher in dieser Session, diesmal aber
  dauerhaft behoben statt nur einmalig durch Kill+Neustart: `docs:dev`-Script fest auf
  `--port 5174` gesetzt. Beide Server danach parallel verifiziert (5173 HTTPS grün, 5174 HTTP grün).
- ✅ **Alle hartkodierten `file:///Users/...`-Pfade entfernt** (User-Korrektur: "dürfen niemals
  vorkommen") — 131 in `apps/and-now/docs/log.md` (inkl. eines eigenen frisch geschriebenen
  Log-Eintrags), 8 in `CHANGELOG.md`, 2 in `.agents/skills/character-pipeline/SKILL.md`. Nur das
  absolute Maschinen-Präfix entfernt, historischer Pfadinhalt in alten Einträgen bewusst
  unangetastet gelassen (Unterscheidung: Pfad-*Leck* immer fixen, historischen Pfad-*Inhalt* nicht
  rückwirkend umschreiben). Als Feedback-Memory gespeichert, damit das künftig nicht wieder passiert.
- ✅ **Version-Bump auf 0.78.00**, Changelog-Eintrag (Quote: Robert Frost, "Good fences make good
  neighbors" — passend zur Engine/Apps-Grenzregel), Tag `v0.78.00`, Commit + Push.

## 2026-09-12 — npm-Workspaces-Monorepo: `packages/engine` + `apps/*` eingeführt

- ✅ **Strukturelle Weichenstellung umgesetzt** (User: "wichtige Weichen für die Zukunft legen und
  nicht in einem Monat alles umbauen"), ausgelöst durch die Frage, wie die Flakturm-Tunnel-Szene im
  Maker editierbar werden soll (braucht ADR-0016-Code, siehe unten). Entscheidung per
  AskUserQuestion: npm-Workspaces statt neues Repository oder reine Lint-Regel; erst Struktur, dann
  Maker-Arbeit.
  - `src/` aufgelöst: Engine-Code (core, environment, behaviors, geometry, math, physix, renderers,
    audio, enums, interfaces, loaders, utils, tools, global.d.ts, presentation.ts) →
    `packages/engine/src/`, eigenes Package `@small-world-machine/engine` mit
    `exports: {".": "./src/index.ts", "./*": "./src/*"}` (Apps importieren nur noch per
    Package-Name, nie mehr über relative Pfade, die den Package-Root verlassen).
  - Die drei Apps (`and-now`, `yad`, `light-cycle-arena`) → `apps/*`, je eigenes Package
    (`@small-world-machine/and-now` usw.), `dependencies: {"@small-world-machine/engine": "*"}`.
  - Bonus (User-Idee mid-flight): `showcases/yad/` und `showcases/light-cycle-arena/` (HTML +
    Assets) ebenfalls nach `apps/yad/` bzw. `apps/light-cycle-arena/` verschoben, damit sie wie
    `and-now` konsistent bei ihrem eigenen App-Package liegen statt in den generischen
    Engine-Showcases.
  - Neue ESLint-Grenzregel (`no-restricted-imports` in einem eigenen Config-Block nur für
    `packages/engine/**`, NICHT `import/no-restricted-paths`): verbietet jeden Import aus `apps/`
    in die Engine. **Wichtiger Lernpunkt:** `import/no-restricted-paths` hätte einen TS-Resolver
    gebraucht, um unsere `.js`-Importspezifizierer (mappen via `moduleResolution: "Bundler"` auf
    `.ts`-Dateien) aufzulösen — probeweise mit `eslint-import-resolver-typescript` installiert,
    dabei sofort 2018 neue `import/extensions`-Fehler repo-weit ausgelöst (ein Resolver macht diese
    Regel strenger: erwartet dann die tatsächliche `.ts`-Endung statt der geschriebenen `.js`).
    Wieder deinstalliert, stattdessen die Core-ESLint-Regel `no-restricted-imports` mit reiner
    String-Muster-Prüfung auf dem geschriebenen Importpfad verwendet — braucht keine Auflösung,
    funktioniert zuverlässig (mit echtem Verstoß getestet, schlägt korrekt fehl).
  - 42 `showcases/*.ts`-Dateien hatten ebenfalls relative Importe auf das alte `src/` (nicht nur die
    3 Apps) — per Skript korrigiert (`../` -Tiefe unverändert, nur `packages/engine/` vor `src/`
    eingefügt). `vite.config.ts`, `vite.lib.config.ts` (jetzt bei `packages/engine/`, `outDir`
    korrigiert), `tsconfig.json`/neues `tsconfig.base.json`, `typedoc.json`,
    `scripts/update-version.js`, `.husky/pre-commit`, `scripts/check-showcases.js` (yad-URL jetzt
    `apps/yad/...`), `public/index.html`-Links, mehrere `public/tools/*.html`-Inline-Importe — alle
    nachgezogen.
  - ADR 0014/0015 und `.agents/notes/app-docs-convention.md`/`AGENTS.md` bekamen "Update"-Notizen
    zur neuen Struktur, ohne die historische Begründung zu überschreiben.
  - Verifiziert: `npx tsc --noEmit` grün, `npx eslint .` grün (inkl. Grenzregel-Test), `npx vitest
    run` 744/744 grün (4 Testdateien mit hartkodierten `src/`-Pfaden gefixt), `npm run build`
    (Showcases + Lib) grün, `git status` bestätigt saubere Renames (781 R, keine verlorenen
    Dateien). Live im Browser geprüft: Flakturm-Tunnel, YAD, Light Cycle Arena, Maker-Editor,
    Showcase 1 — alle ohne Konsolenfehler.
  - **Noch offen (nächster Schritt, separat):** ADR-0016-Code (StagePoint2D-Verallgemeinerung,
    `SW_stage_zone`-glTF-Extension, Maker-UI), damit die Flakturm-Szene tatsächlich im Maker
    geöffnet/bearbeitet/gespeichert werden kann — das war das ursprüngliche Ziel, das zu dieser
    Strukturfrage geführt hat.
  - Noch NICHT umgesetzt (User hat nur diese Struktur besprochen, nicht zusätzlich beauftragt):
    "Showcases (1-36) ebenfalls auslagern" — als eigene Idee mid-flight genannt, bewusst auf einen
    späteren, separaten Schritt verschoben.
  - → **Update selbes Datum:** User wies zu Recht darauf hin, dass `docs/` dadurch punktuell
    veraltet ist (v. a. Pfad-Beispiele). Sweep über alle `docs/**/*.md` durchgeführt: aktive
    Referenzdokumente (ADR 0007/0009/0010/0014/0015, Guides adding-materials/custom-game/
    extensions/forge/map-generator/xtractor, research/oil-puddle-shader-technique) auf
    `packages/engine/src/...`/`apps/...` aktualisiert. Datierte Audit-Snapshots
    (`research/codebase-review-2026-08-22.md`, `research/showcase-feature-audit.md`,
    Teile von `research/aaa-engine-techniques.md` zu bereits gelöschten Apps) bewusst NICHT
    umgeschrieben — bekamen stattdessen eine kurze Hinweis-Notiz, konsistent mit der bereits
    etablierten Praxis dieser Session (Status-Notiz statt Verlust der historischen Genauigkeit).
    `docs/public/api/` (272 committete TypeDoc-generierte HTML-Dateien) nicht von Hand editiert,
    sondern per `npm run docs:api` neu generiert — Quell-Links zeigen jetzt korrekt auf
    `packages/engine/src/...`.

## 2026-09-11 — And Now?: Flakturm-Tunnel — Figur unlit, Treppe-Runter-Clip weiterhin kurz

- ✅ **„Figur könnte etwas mehr Licht vertragen" — echter Root Cause gefunden, kein reiner
  Geschmacks-Tweak.** `_loadCharacter()`s `applyMaterialToHierarchy()` ersetzte JEDES Material der
  Figur durch `BasicMaterial` — ein komplett **unlit** Material (`fragColor = u_color * texColor`,
  keine einzige Lichtberechnung im Shader). Damit hatten `AmbientLight`, `DirectionalLight` und
  sogar die eigene Laternen-`PointLight` der Figur **null Wirkung** auf die Figur, egal wie man an
  den Licht-Intensitäten dreht — sie zeigte immer nur ihre rohe Textur-Farbe. Der gemalte
  Hintergrund ist bewusst genauso `BasicMaterial` (richtig so, 2D-Kunst braucht keine 3D-Beleuchtung),
  aber die Figur hätte ein lit Material gebraucht.
  - **Fix:** `BasicMaterial` → `StandardMaterial` für die Figur (genau wie im Character Diorama
    beim selben Modell), `roughness: 0.92`, `metallic: 0.02` für einen matten Stoff-/Haut-Look ohne
    unerwünschten Glanz. Live geprüft: sichtbar mehr Licht/Textur auf dem Mantel, Stimmung bleibt
    dunkel-atmosphärisch, keine Glanz-Artefakte, Bein-Sichtbarkeits-Fix weiterhin unberührt.
  - `tsc` grün.
- 📋 **„Treppe runter wirkt kurz/zuckend" — Speed-Fix behebt das NICHT, weiterhin offen.**
  Wichtige Klarstellung: Bewegungsgeschwindigkeit und Animations-Abspielgeschwindigkeit sind im
  Code komplett getrennt (`_mixer.update(deltaTime)` läuft immer in Echtzeit). Der `stairs_down`-
  Clip ist weiterhin nur **0.375s** lang (siehe 2026-09-10-Eintrag) und zyklisiert entsprechend oft,
  unabhängig vom `speed`-Wert der Bewegung. Braucht einen eigenen Blick auf den Animations-Clip
  selbst (verlängern/neu einspielen), nicht an der Bewegungslogik.

Status: Material-Fix umgesetzt, `tsc` grün, noch **nicht committed**. `stairs_down`-Clip-Länge
weiterhin offen.

> **Statuskorrektur 2026-10-10:** `stairs_down`-Clip-Länge ist code-seitig behoben — Clip-Datei
> (0.375s, verifiziert per GLB-Dump) bleibt unverändert, aber `_playAnimation()` setzt jetzt
> `action.timeScale` über `resolveClipTimeScale()` (`flakturm-tunnel/clipTiming.ts`, Ziel-Zyklus
> 1.0s → timeScale 0.375). Test: `tests/ClipTiming.test.ts`. Ziel-Zyklus 1.0s ist ein Schätzwert,
> visuell abnehmen. Nicht committed.

---

## 2026-09-10 — And Now?: Szene-2-Review (Flakturm-Tunnel Bewegung & Animation)

User-Kritik am Flakturm-Tunnel (5 vage Punkte), gegengecheckt per Live-Simulation im Browser
(direkter Zugriff auf `_movementBehavior`/`_loop` statt echter Tastatureingabe, um Distanzen und
Zeiten exakt zu messen). Ergebnis: zwei Punkte sind klar code-/daten-bestätigt, zwei sind eher
Content-/Kalibrierungsfragen als Bugs, einer bleibt offen für den gemeinsamen Blick.

- ✅ **„Figur ist viel zu schnell" — bestätigt, mit Zahlen, und angepasst.** Bei reinem Gehen
  (kein Shift/Run) legte die Figur in 2 simulierten Sekunden ~0.137 von 1.0 normierten
  Stage-Einheiten zurück (grob eine ganze Zonenbreite); die komplette Treppe (`zone_c`, ~13
  Stufen) wurde im GEH-Tempo (nicht einmal Rennen) in ca. 1.3 Sekunden erklommen.
  `StageMovementBehavior`s `speed` (Datei `flakturm-tunnel/showcase.ts`) ist der einzige Hebel
  dafür. → Update 2026-09-10: User hat `0.15` → `0.06` → `0.09` live durchgetestet (bei `0.06`
  gemessen: komplette Treppe jetzt ~2.9s statt ~1.3s); **`0.09` als aktueller Wert bestätigt** —
  Nutzer berichtet, bei diesem Tempo werden erstmals echte Beinbewegungen erkennbar statt reinem
  Zucken. Damit erledigt, außer weiteres Feintuning wird gewünscht.
- 📋 **„Keine sichtbare Treppenanimation" — die Animation IST korrekt aktiv, aber vermutlich zu
  kurz sichtbar.** `_resolveDesiredAnimation()` wählt `stairs_up`/`stairs_down` zuverlässig,
  live verifiziert (ganze Treppe durchgehend `stairs_up` aktiv). Die wahrscheinlichste Erklärung
  fürs "nicht wahrnehmbar": Bei ~1.3s Gesamt-Treppenzeit und einer 1.33s-Clip-Länge sieht man
  praktisch keinen vollen Zyklus, bevor man oben ist — hängt direkt am Tempo-Punkt oben.
  💡 Zusatzfund: `stairs_down` ist mit **0.375s** Cliplänge auffällig kurz gegenüber `stairs_up`
  (1.33s) und allen anderen Clips (0.67–1.08s) — das würde beim Runtergehen selbst bei normalem
  Tempo wie hektisches Zucken aussehen, unabhängig vom Geschwindigkeits-Fix. Asset-seitig prüfen.
- 💡 **„Grenzen der Bewegungsflächen werden nicht eingehalten" — Clamping-Code selbst ist korrekt,
  vermutlich Diskrepanz zwischen gezeichneter Zone und gemaltem Hintergrund.**
  `StageMovementBehavior._resolveMove()` klemmt Bewegung nachweislich hart auf die definierten
  Zonen-Polygone (live getestet: an `zone_c`s oberster Ecke lässt sich die Figur trotz gehaltener
  Taste keinen Millimeter weiterbewegen). Wenn die Figur im Spielgefühl trotzdem über den
  gemalten Boden hinausläuft, liegt das vermutlich an zu großzügig gezogenen Zonen-Polygonen
  (`DEFAULT_ZONE_POINTS` in `flakturm-tunnel/showcase.ts`) relativ zur Hintergrundkunst, nicht an
  der Kollisionslogik. Braucht visuellen Abgleich Zone-Overlay vs. Kunst (Bühnen-Editor via
  Taste `[E]` zeigt die Polygone) statt Code-Fix.
- 💡 **„Figur am oberen Treppenende zu klein" — ist absichtliche erzwungene Perspektive, evtl. zu
  aggressiv kalibriert.** `zone_c`s oberster Punkt hat `scale: 0.5`, `zone_b`s tiefster Punkt
  sogar `scale: 0.3` (Faktor 2–3.3× kleiner als normal) — kein Bug, sondern bewusst gesetzte
  Tiefenwirkungs-Werte. Eventuell zu stark; gemeinsam am Bühnen-Editor neu austarieren statt
  einseitig „reparieren".
- ✅ **„Keine wirklich menschlichen Animationen, eher ein Zucken" — größtenteils durch den
  Tempo-Fix behoben.** Geprüft und verworfen als Ursache: (a) `_playAnimation()` restartet
  denselben Clip nicht wiederholt (der `name === activeAnimation`-Guard greift korrekt); (b) die
  ungefilterte `mixamorig:Hips`-Translation-Spur (anders als im Diorama, das sie explizit
  herausfiltert) ist zwar ein echter Unterschied zwischen den beiden Szenen, aber mit ~4cm
  Welt-Raum-Amplitude (Y) vermutlich zu klein, um allein "Zucken" zu erklären. → Update
  2026-09-10: Bestätigt — nach dem Tempo-Fix auf `0.09` berichtet der Nutzer erstmals erkennbare
  Beinbewegungen. Der extrem kurze `stairs_down`-Clip (0.375s, siehe oben) bleibt als separater,
  ungeprüfter Rest-Verdacht für Zucken speziell beim Treppe-Runtergehen stehen.
  > Statuskorrektur 2026-10-10: Rest-Verdacht `stairs_down` per timeScale entschärft (siehe
  > Eintrag 2026-09-11). Treppenanimation (`stairs_up`, 1.33s) bei Tempo 0.09 bereits ok; Zonen-
  > Clamping und „Figur oben klein“ bleiben Design-/Kalibrierfragen (Bühnen-Editor), nicht angefasst.
- ✅ **„Beim seitlichen Laufen/Rücken-zur-Kamera fehlt ein Bein" — geklärt (reine geometrische
  Selbstverdeckung, kein Mesh-/Rig-/Culling-Bug) UND im Flakturm-Tunnel per Start-Rotations-Nudge
  entschärft.** Bewusst chronologisch dokumentiert statt überschrieben, weil sich der Stand
  mehrfach geändert hat:
  1. Ursprünglich (2026-09-10) in zwei Szenen anhand eigener, sehr dunkel gerenderter Screenshots
     "bestätigt" (Flakturm-Tunnel `idle_torch` von hinten, dann Character Diorama gegengecheckt).
  2. User widersprach anhand `img_6.png` (per Pointer-Lock gedreht, heller): beide Beine sichtbar
     → Befund als "Fehlschluss durch Dunkelheit" zurückgezogen.
  3. Vereinbartes Protokoll: für reine Sichtbarkeits-Fragen Szene testweise aufhellen
     (Licht-Intensität × 5) statt raten.
  4. User meldete live (ohne Zoom, normale Ansicht): bei großer Figur trotzdem kein linkes Bein
     sichtbar — und lieferte `img_7.png` als Beleg (`idle_torch`, `t=2.97s`, `HINTEN 180°`).
  5. **Systematische Abtastung mit aufgehellter Szene bei exakt `rotation.y = π`** (derselbe
     Blickwinkel), 4 Zeitpunkte über den kompletten 6.33s-`idle_torch`-Loop verteilt (t≈0, 3.8s,
     4.8s, 5.8s): **bei allen 4 Stichproben fehlt das linke Bein sichtbar**, konsistent. Der
     frühere "beide Beine sichtbar"-Fund (Schritt 1) war offenbar ein einzelner,
     nicht-repräsentativer Frame, keine verlässliche Momentaufnahme des überwiegenden Zustands.
  6. **3/4-Rücken-Winkel systematisch nachgezogen** (Character Diorama, Kamera per Orbit ~58° aus
     der direkten Rückansicht gedreht, Figur-Rotation unverändert bei Standard `-0.5`), wieder
     5 Zeitpunkte über den vollen 6.33s-Loop verteilt (t≈0, 1.5s, 3s, 4.5s, 6s): **bei allen 5
     Stichproben sind beide Beine klar sichtbar**, kein einziger Aussetzer.
  7. User vermutete danach einen versteckten Engine-Hack/Fix im Showcase-Code (Frustum-/
     Occlusion-Culling, Tiefenberechnung — Anlass: jüngere Engine-Eingriffe in genau diesem
     Bereich). Gezielt gegengeprüft statt geraten: `flakturm-tunnel/showcase.ts` selbst enthält
     keine Leg-/Culling-Sonderlogik (grep negativ). Frustum-Culling für den Charakter hart auf
     "immer sichtbar" erzwungen (`inFrustum = true` auf jedem Kind-Objekt, jeden Frame) — Bein
     bleibt trotzdem unsichtbar, also kein Frustum-Cull-Bug. HZB-Occlusion-Culling ist für diese
     Szene gar nicht aktiviert (`config.enableOcclusionCulling` nicht gesetzt) — kommt als Ursache
     also gar nicht in Frage. Fuß-Bones direkt über die echte Kamera-View-Projection-Matrix in
     Bildschirmkoordinaten projiziert: linker und rechter Fuß liegen bei `rotation.y = π` nur
     ~16px auseinander (bei 1512px Canvas-Breite), rechter Fuß geometrisch näher an der Kamera —
     ausreichend, um sich bei normaler Tiefenprüfung (Z-Buffer) gegenseitig zu überdecken.
  8. **User hat den 6×-vergrößerten, aufgehellten, Culling-erzwungenen Screenshot direkt
     gegengecheckt und bestätigt: nur ein Bein sichtbar, links vom Stiefel nichts.** Damit
     stimmen Technik-Befund und Nutzer-Beobachtung jetzt überein.
  **Zwischenstand (von beiden Seiten bestätigt):** Kein Mantel-/Mesh-Problem, kein Culling-Bug,
  kein versteckter Engine-Hack — reine geometrische Selbstverdeckung: Nur wenn die Kamera exakt in
  einer Linie mit dem Beinstand steht, liegt ein Bein optisch hinter dem anderen.
  9. **Wichtige Korrektur der Einschätzung "fällt im normalen Spielgefühl kaum auf":** Kamera-Setup
     beider Szenen verglichen. Character Diorama: `HYBRID_SYNC`-Strategie + `OrbitController`,
     Kamera vom Spieler frei orbit-/pan-/zoombar (Zoom = Dolly am Radius, kein FOV-Wechsel) — die
     kritische Achse lässt sich praktisch immer umgehen. Flakturm-Tunnel: **keine Strategie
     gesetzt, kein OrbitController, Kamera wird in `setupScene()` einmalig positioniert und nie
     wieder verändert** — komplett fix für die ganze Session. Zusätzlich nutzt `_uvToWorld()` dort
     bewusst `z: BACKGROUND_Z` (immer 0) — die Bühnentiefe wird nur über Skalierung vorgetäuscht,
     nicht über echte Z-Bewegung (dokumentierte Vereinfachung fürs 2.5D-System). Die Figur startet
     zudem laut `startFacing: "back"` **exakt** in der kritischen Blickrichtung. Damit ist der
     Effekt im Flakturm-Tunnel kein seltener Rand-Fall, sondern **bei jedem einzelnen
     Szenenstart garantiert exakt gleich sichtbar** — anders als im Diorama.
  10. User hat das im echten Spiel (kein Zoom-Trick, eigener Browser-Zoom) an der Standard-
      Startposition nachgestellt: `img_9.png`/`img_10.png` zeigen eindeutig, sauber beleuchtet
      genug: **linkes Bein komplett nicht vorhanden**, keine Verblassung, kein Schatten-Rest.
      Deckt sich exakt mit dem technischen Befund — bestätigt an der echten Default-Ansicht.
  11. **Fix umgesetzt:** `StageMovementBehavior` bekommt eine neue, rein kosmetische Option
      `startFacingNudge` (zusätzliche Radiant nur auf die initiale Blickrichtung, rührt nichts an
      der Bewegungs-/Rotationslogik an). In `flakturm-tunnel/showcase.ts` auf `0.14` (~8°) gesetzt
      — die Start-Ausrichtung weicht jetzt absichtlich leicht von der exakten Kamera-Achse ab.
      Live verifiziert (aufgehellt, 4×-Vergrößerung, Bewegung deaktiviert): beide Beine an der
      neuen Standard-Startposition klar getrennt sichtbar. `npx tsc --noEmit` grün.
  💡 **Lektion (bestätigt, jetzt mit Nachdruck):** eine einzelne Stichprobe — egal wie hell oder
  wie genau positioniert — beweist bei einer über Zeit laufenden Animation nichts. Mehrere
  Zeitpunkte über den vollen Loop abtasten, bevor irgendetwas als "bestätigt" oder "widerlegt"
  gilt. Das gilt für mich genauso wie für einen einzelnen User-Screenshot. Und: die Kamera-
  Beweglichkeit einer Szene ist Teil der Bug-Bewertung, nicht nur die reine Geometrie — derselbe
  geometrische Effekt kann in einer Szene irrelevant und in einer anderen garantiert sichtbar sein.

Status: Speed-Fix (`0.09`) und `startFacingNudge`-Fix (`0.14` rad in `flakturm-tunnel/showcase.ts`,
neue Option in `StageMovementBehavior`) umgesetzt, `tsc` grün, noch **nicht committed/gepusht**.
Zonen-Grenzen- und Skalierungs-Punkte weiterhin offen für gemeinsamen Blick im Bühnen-Editor.

---

## 2026-09-09/10 — And Now?: Laternen-Griff-Bug (Diorama & Flakturm-Tunnel)

Nutzer-gemeldeter Bug: Laterne hängt bei manchen Figuren/Ansichten nicht in der Hand. Drei
unabhängige Ursachen gefunden und gefixt, vollständige Herleitung in
[`src/apps/and-now/docs/log.md`](../../src/apps/and-now/docs/log.md) Einträge 101–103.

- ✅ **Yoshi (Easter-Egg-Charakter) hielt die Laterne nicht.** Ursprünglich fälschlich als
  kaputtes Auto-Rig diagnostiziert (Messung im Bind-Pose-Frame vor Animations-Blend); echter
  Bone-Dump nach korrektem Posieren zeigte, dass sein Hand-Bone sauber funktioniert. Nutzt jetzt
  denselben generischen Bone-Tracking-Pfad wie Männlich/Weiblich, kein Sonderfall mehr nötig.
- ✅ **`character-diorama`: Laterne am falschen Parent-Objekt.** `_lanternGroup` hing an
  `_dioramaRoot` statt am echten `scene`-Root; da der Sync-Code immer eine Welt-Position setzt,
  driftete die Laterne, sobald `_dioramaRoot` rotiert wurde (z. B. durch die Turntable-Funktion)
  — unsichtbar in der Standardansicht, daher zunächst übersehen. Eine Zeile Fix, über
  360°-Rotations-Sweep verifiziert.
  💡 **Lektion für künftige Sessions:** ein "gefixt"-Befund, der nur am Standard-Kamerawinkel
  geprüft wurde, ist kein vollständiger Beweis, wenn das betroffene Objekt an einem rotierbaren
  Parent hängt — explizit die Rotation durchspielen.
- ✅ **`character-diorama`/`flakturm-tunnel`: männliche/weibliche Figur bereits korrekt**, keine
  Änderung nötig.

Status: `npx tsc --noEmit` grün, live in beiden Szenen für alle drei Figuren nutzerbestätigt.

---

## 2026-09-08 — Showcase-29-Debug-Session (WebGPU-Artefakt & WebGL2-Cluster-Fix)

Entstanden während der Jagd nach grün/blauen Block-Artefakten auf den Sponza-Vorhängen
(Showcase 29, WebGPU) und der Überprüfung des parallel laufenden WebGL2-Cluster-Lighting-Fixes.

- 📋 **WebGPU: grün/blaues Block-Artefakt — Root Cause weiterhin offen.** Metallic-/
  Roughness-Texturinhalt erscheint roh als Vorhang-Farbe. Live ausgeschlossen: Per-Frame-Textur-
  Churn in `GPUTextureResourceCache.acquireTextures` (separater, echter Bug — ✅ siehe unten),
  Mipmap-Generierung (deaktiviert → Block bleibt), Cross-Textur-Upload-Race (vollständig
  serialisierte Uploads mit `device.queue.onSubmittedWorkDone()`-Barrieren zwischen allen 74
  Texturen → Block bleibt unverändert, **diese Richtung nicht nochmal versuchen**), Aliasing im
  Texture-View-Cache (1:1-Zuordnung verifiziert). Bindgroup-Instrumentierung zeigt zur Draw-Zeit
  durchgehend korrekte Texturreferenzen. Dokumentiert als Kommentar im Klassendoc von
  `GPUTextureResourceCache.ts`.
  💡 Idee dazu: echtes GPU-Capture-Tool ranziehen (Chrome WebGPU-Tracing, Dawn-Debug-Layer /
  RenderDoc-artiges Tooling) — JS-Konsolen-Instrumentierung ist an ihrer Grenze.
  🔎 **2026-10-10 Re-Check auf HEAD:** Showcase 29 per Vite + headless Chrome (WebGPU-Kontext bestätigt, SwiftShader/Vulkan, 25 s Laufzeit, 1280x800) — Vorhänge rot/grün/blau korrekt (Sponza-Original), kein Block-Artefakt, keine Dawn-/Uncaptured-Errors in der Konsole. Auf aktuellem HEAD (nach ADR 0027 u.a.) **nicht reproduzierbar** (SwiftShader; echte GPU/Metal auf Nutzer-Maschine nicht verifiziert). Bei erneutem Auftreten bitte melden.

- ✅ **WebGPU-Textur-Lifecycle: zwei echte Bugs gefixt.** `acquireTextures` mergte Manifeste
  fälschlich statt sie zusammenzuführen (spurious release+recreate über Passes hinweg);
  `DepthPrePassGPU` nutzte ein nie aktualisiertes, geteiltes `DepthMaterial` ohne echtes
  Alpha-Cutout pro Objekt. Live verifiziert: GPU-Textur-View wird jetzt einmalig erstellt und
  bleibt stabil (vorher: neu bei jedem Frame). Commit `94d317ad` «Nothing is lost, nothing is
  created, everything is transformed.»

- ✅ **WebGL2-Cluster-Lighting: Unit-14-Kollision gefixt.** Cluster-Grid teilte sich Unit 14 mit
  `_RAW_DEPTH_UNIT` (PCSS-Rohtiefe) — stille Daten-Korruption bei gleichzeitig aktivem
  Directional-PCSS-Schatten + Cluster-Lighting. `CLUSTER_GRID_UNIT`/`CLUSTER_INDEX_UNIT` auf
  15/16 verschoben, `WebGLClusterCullPass` bekam dieselbe Bounds-Absicherung wie der bestehende
  Schatten-Code (Warnung statt Korruption). Live verifiziert. Commit `eef5804e` «Nothing can be
  truly correct until it holds together as a whole.»
  📋 **Grundproblem bleibt:** Auf dieser Maschine ist `MAX_TEXTURE_IMAGE_UNITS` real nur 16 (das
  garantierte Minimum). Schatten (6) + PCSS-Rohtiefe (1) + Cluster (2) = 9 reservierte Einheiten
  (Bereich 8–16) passen nicht mehr in 0–15 → Cluster-Index-Textur bleibt unbelegt →
  Punkt-/Spot-Lichter (Laternen, GI-Bounce) rendern auf 16-Unit-Hardware nicht mehr über das
  Cluster-System (Boden bleibt dunkel). Keine Regression (vorher still korrupt, jetzt sauber
  degradiert), aber ungelöst.
  💡 Idee dazu: eine weitere Einheit einsparen — z. B. Schatten-Dummy-Fallback (Unit 13)
  eliminieren, oder PCSS-Rohtiefe-Read über denselben Sampler wie die Vergleichs-Shadow-Map
  lösen statt einer eigenen Unit.

- ❌ **Showcase 29 — HUD als 300-Zeilen-`innerHTML`/CSS-Template-String direkt in `showcase.ts`
  refactoren.** Funktioniert, Wartbarkeits-Geschmackssache, aber bewusst nicht angefasst —
  reine Stilfrage, kein Fehler.

- 💡 **Showcase 29 — globaler Albedo-Boost** (`obj.material.color = new Color(1.18, 1.1,
  0.98)`) wird pauschal auf *jedes* Sponza-Material angewendet, unabhängig von dessen eigener
  Helligkeit. Bei aktivem ACES-Tonemapping legitim, aber Risiko für Ausbrennen/Clipping auf
  bereits hellen Flächen (z. B. Travertin-Wände). Nur beobachtet, nicht verifiziert oder
  angepasst.

- 📋 **Verifikations-Lücke:** Für den WebGL2-Fix wurde nur der schmale
  `tests/renderers/WebGL2ClusterBindings.test.ts` ausgeführt (grün) — nicht die volle Suite
  (`npm run test`) oder `npm run build:lib`.

- 📋 **Verifikations-Lücke:** Showcase-29-Minifixes (Docstring, God-Ray-Update-Skip) nur per
  `tsc --noEmit` geprüft, nicht live im Browser re-verifiziert nach der Unit-14-Änderung.

- ✅ **Showcase 29 — Docstring korrigiert** (God Rays sind jetzt standardmäßig aus, war nicht
  dokumentiert) und **God-Ray-Flicker-Loop übersprungen, wenn Gruppe unsichtbar** (unnötige
  Arbeit pro Frame). Beides Teil von Commit `eef5804e`.

- ✅ **AO/PostProcess HBAO — WGSL-NaN-Guards nachgezogen.** Die zu Sessionbeginn bereits im
  Working Tree liegenden GLSL-NaN-Guards (`AO.frag.glsl`, `PostProcess.frag.glsl`) waren
  korrekt und vollständig; hart geprüft zeigte sich aber, dass die WGSL-Portierung
  (`AO.frag.wgsl`, `PostProcess.frag.wgsl`) unvollständig war — `isnan()`/`isinf()` existieren
  praktisch nicht mehr als WGSL-Builtins (aus der Spec entfernt, deshalb sonst nirgends im
  Projekt verwendet), daher wurden zwei der drei Guards beim Portieren schlicht weggelassen.
  `max()`/`clamp()` haben in WGSL bei NaN-Eingabe laut Spec undefiniertes Verhalten — der exakt
  selbe Bug, den GLSL verhindert, konnte auf WebGPU also weiterhin unbehandelt auftreten.
  Fix: portabler NaN-Check via Selbstungleichheit (`x != x`) an den fehlenden Stellen ergänzt;
  `Inf` brauchte keinen Extra-Check, da IEEE754-Ordnung dafür wohldefiniert ist und das
  bestehende `clamp()` es schon korrekt abfängt. Live auf WebGPU und WebGL2 verifiziert (HBAO
  aktiv, keine Artefakte, Konsole sauber). Commit `705fe005` «The same law applies everywhere,
  whether or not anyone is watching to enforce it.»

- ✅ **Flakturm-Tunnel — Zone C (Treppe) linke Kante lag neben statt auf der gemalten Treppe.**
  Ausgangspunkt: User-Hypothese, dass ein sauber gezogener Wegbereich unter dieser (rollwinkel-
  freien) Kamera entweder aus 2 waagerechten + 2 Fluchtlinien-Kanten bestehen sollte (flacher
  Boden, z. B. Zone A/B) oder — bei einem im Raum gedrehten Rechteck wie einer schräg
  wegführenden Treppe — aus zwei eigenen Fluchtlinien-Paaren, die auf zwei unterschiedliche
  Fluchtpunkte zulaufen. Beides an den echten Zonen-Daten nachgerechnet: Zone A/B passen zum
  ersten Fall, Zone C (Treppe) korrekt zum zweiten. Die rechte Kante (Handlauf-Seite, P1→P2)
  stimmte fast exakt mit der echten Bild-Kante überein; die linke Kante (P0→P3) aber nicht —
  nachgemessen direkt im Hintergrundbild (`public/assets/and-now/flakturm_bg.webp`, Punkte A-D
  annotiert), lag P3 bei `u=0.278` sichtbar links neben der gemalten Stufenkante, im
  Schattenbereich daneben statt darauf. Fix: `P3` in `DEFAULT_ZONE_POINTS.zone_c` auf
  `u=0.305` korrigiert (v unverändert, P0/P1/P2 unverändert, da bereits korrekt). Vorher/Nachher
  visuell gegen die echte Kante verifiziert (annotiertes Bild) — Zone folgt jetzt durchgehend
  der Stufenkante statt sie zu schneiden.
  → Diese Erkenntnis (Fluchtlinien-Check pro Zonen-Kante) gehört eigentlich auch als Ergänzung
  ins neue Docs-Kapitel `docs/guides/2-5d-scenes.md` §4/§5 — noch nicht nachgezogen.
  → Update 2026-09-12: nachgezogen (§4 allgemeine Regel, §5 Schritt 7 + beide Bilder).

- ✅ **Flakturm-Tunnel — Status-HUD folgte der Figur über die Bühne** (per `worldToScreen` auf
  Kopfposition), was sie z.B. weit oben auf der Treppe teils verdeckte, wo sie ohnehin schon
  klein ist. Jetzt fix am oberen Bildschirmrand (CSS `position: fixed`), unabhängig von der
  Figurenposition. HUD zusätzlich um Live-`(u,v)`-Position und aktuelle `Skalierung` erweitert
  (dieselben Werte, die bisher nur per Konsole während der Zonen-Verifikation auslesbar waren).

- ✅ **Character-Diorama — Figur konnte sich nicht wirklich bewegen**, nur auf der Stelle drehen
  (Pfeiltasten) und Animationen abspielen (Zahlen-Tasten/Buttons), ohne dass die Position je
  aktualisiert wurde (`_playerRig.position` wurde nur einmal beim Laden gesetzt). Jetzt echte
  `StageMovementBehavior`+`StageZone`-Bewegung über den ganzen begehbaren Boden (±1.9 Welteinheiten,
  Marge zu den Wänden bei ±2.1), `scale: 1.0` durchgehend (echte 3D-Tiefe über die frei orbitende
  Kamera, keine erzwungene Perspektive nötig — siehe `docs/guides/2-5d-scenes.md` §3 "Doesn't
  apply"-Fall). Bestehende Pfeiltasten-Drehung blieb erhalten, aber jetzt hinter SHIFT verschoben
  (`SHIFT`+Pfeil = drehen, sonst WASD/Pfeil = laufen), sonst hätten sich beide Systeme jeden Frame
  um `rotation.y` gestritten — dieselbe Konvention wie im Flakturm-Tunnel
  (`MANUAL_ROTATE_SPEED`). Position bleibt beim Charakterwechsel (Taste `C`) erhalten statt auf
  die Ursprungspose zurückzuspringen. Live verifiziert (manuelles Frame-Pumping): Laufen, exaktes
  Klemmen am Zonenrand (v=1.0 → z=1.9), und SHIFT-Drehung ohne Bewegungs-Konflikt.

- 📋 **Großes Vorhaben angestoßen (User-Wunsch 2026-09-12):** Maker-Editor um einen 2.5D-
  Bühnen-Authoring-Modus erweitern — Hintergrundbild importieren, Fluchtpunkte interaktiv
  bestimmen/vorberechnen (reine Schnittpunkt-Geometrie aus 2 Referenzlinien), optionales Snapping
  auf Fluchtlinien/gleiche Tiefe/waagerecht, ein szenen-bewusstes KI-Chat-Panel, neues Speicher-
  format. **ADR 0016 geschrieben** (`docs/adr/0016-2-5d-stage-zones-as-a-gltf-extension.md`):
  `SW_stage_zone`/`SW_stage_vanishing_point`-glTF-Extensions statt Parallel-Format. Auf User-
  Wunsch dabei gleich verallgemeinert: `StageZone.points` von fixem 4-Tupel auf beliebiges
  Vieleck (`StagePoint2D[]`) erweitert — Punkt-in-Polygon/Randklemmung funktionierten dafür
  schon, `getScaleAt` verallgemeinert sich zu einem Fächer aus n-2 Dreiecken (Spezialfall n=4 =
  exakt heutiges Verhalten, keine Migration nötig), `getLocalAxes()`s feste Vorwärts-Achse pro
  Zone wird durch den lokalen Gradienten des Skalierungsfelds ersetzt (funktioniert auch bei
  unregelmäßigen/konkaven Formen, keine "welche Ecke ist gegenüber"-Konvention nötig). Reiner
  Entwurf, noch keine Code-Umsetzung — nächster Schritt wäre Phase 0 (Engine-Vorarbeit) laut ADR.

- ✅ **Alle 16 ADRs auf Aktualität geprüft** (3 parallele Audit-Agenten, je gegen den echten Code
  verifiziert, nicht nur gegen den ADR-Text). Ergebnis:
  - 12/16 weiterhin exakt akkurat (0001-0007, 0010, 0012, 0013, 0015, 0016).
  - **0008** (HZB Occlusion Culling): zitierte ein inzwischen entferntes Feld
    (`FrustumCuller.lastVisibleObjects`, tot/nie korrekt genutzt) und behauptete fälschlich,
    `enableInspector: true` sei Showcase-Standard (ist `false`). Update-Vermerk ergänzt, ohne die
    historische Begründung zu löschen.
  - **0009** (Charakter-Pipeline & Mixamo): Laternen-Anbindung war komplett überholt (beschrieb
    Scene-Graph-Kind mit festem Versatz; tatsächlich seit dieser Session reines
    Weltraum-Positions-Tracking). Update-Vermerk ergänzt.
  - **0011** (Modulare Asset-Kits): Phase 2 (Out-of-Tree-Repo/LFS/CDN) und Phase 3
    (Katalog-Loader/CLI) nie umgesetzt — Assets liegen weiterhin direkt im Haupt-Repo, exakt das
    Anti-Pattern, das Phase 2 verhindern sollte. Status-Vermerke pro Phase ergänzt, `kit.json`/
    `preview.jpg`-Abweichung notiert, `GadgetInspector`-Zitat auf `Maker` korrigiert.
  - **0014** (Domänen-Schichtung): `BillboardInstancer` lag noch flach unter `src/core/`,
    `RatGroomingBehavior`/`GroomingRat` noch unter `src/core/behaviors/creatures/` statt am
    eigenen Top-Level `src/behaviors/creatures/`. **Auf User-Entscheidung hin tatsächlich
    verschoben** (Code an ADR angepasst, nicht umgekehrt): `src/core/BillboardInstancer.ts` →
    `src/core/objects/BillboardInstancer.ts`; `src/core/behaviors/creatures/*` → neues
    Top-Level-`src/behaviors/creatures/*` (neuer `src/behaviors/index.ts`-Barrel, in `src/index.ts`
    verdrahtet). Alle Imports (Barrel-Exporte, direkte Importe, 2 Test-Dateien mitverschoben)
    nachgezogen. Verifiziert: `tsc --noEmit` sauber, `eslint` sauber, volle Testsuite 744/744 grün.
  - Keine echten Konsolidierungs-Kandidaten gefunden (0004/0007 schon sauber verlinkt, 0013/0016
    geprüft und als oberflächliche statt echte Überschneidung verworfen).

- ✅ **Asset Kit Inspector (T-09) implementiert (2026-09-28):** Neues vollwertiges Entwickler- und
  Inspektionswerkzeug unter `public/tools/kit-inspector.html` und `@small-world-machine/tools/kit-inspector`:
  - Interaktives Durchsuchen aller modularen Kits (`bunker`, `flakturm`, `industrial`), Props, PBR-
    Texturen und Decals über `KitRegistry` und `public/assets/kits/index.json`.
  - 3D-Viewport mit Orbit-Steuerung (L-Drag Rotate, R-Drag/Wheel Pan & Zoom, `[F]` Focus/Reset,
    `[R]` Turntable Auto-Rotate, `[W]` Wireframe-Toggle, `[S]` Sockets-Gizmos, `[G]` Grid-Boden).
  - Drei Licht-Presets: Studio Neutral, Bunker Kerosin (Amber), Flakturm Kalt (Cyan/Frost).
  - PBR-Textursätze werden live auf einer PBR-Vorschaukugel mit allen Kanälen gerendert; Decals als
    transparente Quads.
  - Sockets-Visualisierung aus `meta.json` inkl. aktiver dynamischer PointLights am Modell.
  - Metadaten-Inspektor mit Tris-Anzahl, Maßen ($B \times H \times T$), Rec-Scale und 1-Klick
    Level-JSON-Export (`koje42.level.json`-kompatibel).
  - In `vite.config.ts`, `public/index.html` (als T-09 Tool) und `packages/tools` registriert; 4 neue
    Unit-Tests in `KitInspector.test.ts` (100% grün, 200 Testdateien, 1.184 Tests bestanden).

- 📋 **WebGL2: Opaque-Capture ohne vollen Post-Stack (2026-10-03, aus Showcase-10-Abnahme):**
  `StylizedWater` (und `FluidSurface`-Absorption) brauchen `u_opaqueMap`/`u_opaqueDepthMap`. Der
  WebGL2-Renderer erfasst sie nur bei `postProcessing.enabled` (WebGL2Renderer ~l.463), WebGPU immer.
  Folge in Showcase 10 unter WebGL2: Stylized-Pool flach navy ohne Kaustik/Boden, Slime-Absorption inert.
  Vorbestehend (HEAD-Shader identisch), kein T6-Fehler. Postprocessing erzwingen ist keine Lösung
  (Standard-Stack wäscht die Szene blass-grau aus). Entscheidung des Users: eigene Engine-Aufgabe
  (Opaque-/Depth-Capture auf GL2 unabhängig vom Post-Chain), nicht Teil des Showcase-10-Plans.

- ✅ **WebGL2: Opaque-Depth-Capture ohne Post-Stack erledigt (2026-10-03, v0.95.1):** Der oben als 📋
  geführte Punkt ist gelöst. Nur `copyToOpaqueDepthTexture` brach ohne Post-Processing ab (der Farb-Capture
  lief schon); jetzt Blit vom Default-Framebuffer mit Format-Probing, gegated über
  `requiresOpaqueDepth()` (Null-Kosten für Szenen ohne `u_opaqueDepthMap`-Materialien). Offen/unverifiziert:
  Fallback-Formate D24/D32F/D16 und andere GPUs/MSAA, Context Loss; Review-Kleinigkeiten (Farb-Capture
  weiterhin unbedingt, unbegrenzte Error-Drain-Schleife, sticky `_opaqueDepthUnsupported`,
  `mat.type` vs. `manifest.shaderId` im Gate).

- 📋 **Stilisiertes Wasser (Richtung `soft`/`sparkle`, Referenzen Spirited Away + Dredge), Phase B wartet auf Freigabe (2026-10-03):**
  Analysen, Board-Exporte, ADR-0025-Entwurf und Aufgabenplan B0–B8 liegen in
  `docs/research/stylized-water/` (Einstieg: `README.md`). Proposal P1 einstimmig (5/5), Entscheidungen des
  Moderators: `toon` unverändert (kein Löschen des alten Kaustik-Pfads), Paket `@small-world-machine/liquid-extras`
  mit Noir-Paket als erste Extension, `sparkle` in der Engine, „Ghibli" nur intern. Erster Schritt der
  Umsetzung: V0-Baseline aller drei Backends vor jeder Shader-Änderung. Nichts davon ist in der Engine
  gerendert; Budgets sind aus Quelltext geschätzt.
  - ✅ **Status-Klärung (2026-10-10):** Phase B ist seit v0.96.0 (2026-10-04) umgesetzt (ADR 0025 akzeptiert,
    `liquid-extras`, `soft`/`sparkle`, `u_styleA/B`+`styleId`; danach ADR 0027, Ramp LUT 0.99.0). Der Titel „wartet auf
    Freigabe" ist veraltet. Echt offen nur: Ramp-LUT-Gewicht 0.6 (Endfarben 79–89 %, Designfrage), Flag an nur auf
    1 von 5 Pools verifiziert, `quality.disableTextures` färbt Rampe weiß, WebGL1-Rampe per Fresnel statt Tiefe,
    Golden-Neuaufnahme (CI/Moderator).
  - ✅ **Ramp-LUT-Restpunkte erledigt (2026-10-10, nicht committet):** (1) `RAMP_LUT_WEIGHT` 0.6 → 1.0 in GLSL100/GLSL300/WGSL,
    LUT-Endfarben jetzt voll erreicht; ohne Rampe unverändert (Toggle-Off-Frame == Kontrolle, 0,0000 % Diff auf allen Backends).
    Kein Golden-Pool bindet eine Rampe → **keine Golden-Zelle ändert sich visuell durch Punkt 1**, Baseline unberührt.
    (2) `USE_RAMP_LUT` auf allen 5 StylizedWater-Pools (toon-water, bold-anime, soft-watercolor, painterly-sparkle, dredge) ×
    WebGL1/WebGL2/WebGPU geprüft: 8/8 Checks je Pool/Backend grün (`.agents/scratches/ramp-lut-verify.mjs`, Ausgabe
    `.agents/scratches/ramp-lut-v2/`, Screenshots gesichtet). (3) `quality.disableTextures`: Renderer streichen das Flag über
    `resolveManifestFlags()` (`renderers/shaders/RenderManifest.ts`, in WebGL1/WebGL2/WebGPU-Renderer) → alter Tiefe→Farbe-Mix
    statt weißem Wasser. (4) WebGL1 bleibt bei Fresnel-Indizierung, begründet: kein Tiefen-Input (`WEBGL_depth_texture` ungenutzt,
    `copyToOpaqueDepthTexture` ist No-op), im Shader steht keine Wassertiefe pro Pixel zur Verfügung; Dokumentation im Shader,
    Guide und Test statt Hack.

- ✅ **Entscheidung: Copyright ist im ganzen Projekt irrelevant (2026-10-05, Moderator-Vorgabe, auf alles ausgeweitet):**
  Der User trägt am Ende die Verantwortung für das, was er in seine lokalen Tools füttert, nicht der Agent.
  Gilt für das ganze Projekt, nicht nur für einzelne Tools (Xtractor, PBR-Gen, Pixler, Ingest-Dropzone sind
  nur Beispiele): Engine, Tools, Apps, Pipelines. Dort gehören keine Copyright-Hinweise, Consent-Dialoge,
  Inhaltsfilter oder „darfst du das nutzen?"-Rückfragen hin, auch nicht für SVG, URLs oder Clipboard-Bilder.
  Gilt für die Gestaltung der Software, nicht für Texte oder Bilder, die der Agent selbst erzeugt.


## 2026-10-07 — Headless WebGPU/WebGL2 in CI/Containern

- ✅ **Headless-WebGPU/WebGL2-Fakt gespeichert (2026-10-07):** Chrome headless mit `--enable-unsafe-webgpu`, `--enable-features=Vulkan` und dem SwiftShader/Vulkan-Software-Backend kann WebGPU **und** WebGL2 vollständig headless in CI-/Container-Umgebungen betreiben — kein Xvfb/Display nötig. Relevant für echte GPU-Pipeline-Tests (WebGL2-+WebGPU-Pfad) in CI. Abgelegt in `.agents/notes/headless-webgpu-ci.md`.

## 2026-10-07 — Collaborate: `next`-Session „Ramp LUT für StylizedWater“ (ADR 0026, Route a) abgeschlossen

- ✅ **Umgesetzt und released als 0.99.0 (`5e374b0e`, Tag `v0.99.0`):** `StylizedWaterMaterial.rampMap` nimmt eine 256×1-`RampLUT` (`bakeRamp` + Texture) statt der festen Tiefe→Farbe-Mischung; Flag `USE_RAMP_LUT` in GLSL100/GLSL300/WGSL, WebGPU-Binding 18, 0 Uniform-Lanes. Ohne Rampe unveränderte Ausgabe.
- ✅ **Belege:** GL2-Goldens mit Flag aus 24/24 byte-identisch zu `pre-p2`; Flag an (Rot/Blau-Extreme, Farbflip, Aus-Schalter, Re-Bake) auf WebGL1/WebGL2/WebGPU 8/8, nur toon-water/top. Tests, `tsc`, Lane-Scan grün. Session `next.md`: Konsens P2 (Alice/Bob/Charly), `[ABNAHME_ERTEILT: Charly]`, pid `terminated`.
- ⚠️ **Bekannte Grenzen:** konstantes Gewicht 0.6 ⇒ Endfarben der LUT werden nur zu ca. 79–89 % erreicht (Designfrage, ggf. neuer Vorschlag); Flag an nur auf einem der fünf StylizedWater-Pools geprüft; `quality.disableTextures` färbt eine gebundene Rampe weiß; WebGL1 indiziert die Rampe per Fresnel statt Tiefe.
- 📋 **Offen:** Die committete Golden-Baseline ist auf HEAD schon unabhängig davon rot (toon-water, bold-anime, painterly-sparkle, wave-rider, je top > 0,5 %) — Neuaufnahme ist Moderator-Entscheidung. WebGL1 hat einen alten Shader-Fehler (`finalLight` undeclared, Link-Fehler), nicht StylizedWater.
  - ✅ **Korrektur 2026-10-10 — nicht mehr reproduzierbar (Eintrag oben bleibt als Historie):** GL1-Smoke (`capture.js --matrix gl1`, frischer Build) 32/32 Zellen OK, 0 Konsolenfehler. Der `finalLight`-Fehler war Lambert.frag.glsl100 ohne `[LIGHT_CALC]`, behoben 2026-10-08 (5f132f5e), abgesichert durch `Glsl100LightCalc.test.ts`. Kein Code-Fix nötig.
- ℹ️ Session `liquid-roadmap` ist ebenfalls `terminated` (siehe deren Abschluss-Block); ihr einziger offener Punkt (formale Abnahme/G6 im CI-Verbund) ist ein externes CI-Gate, keine Session-Arbeit.

## 2026-10-08 — Engine-vs-AI-Vergleich Showcase 10 auf 12 Pools erweitert

- ✅ **Vergleichs-Galerie `.agents/scratches/compare/` (index.html + index.md) auf 12 Pools erweitert** (vorher 10): neue Pools
  `wave-rider` (OpenWater, echte Gerstner-Auftriebsfahrt) und `dead-sea` (OpenWater, Brinen-Dichte 1.24). Die alten
  `*__top.png` vom 06.–07.10. drifteten gegen die committete GL2-Baseline um 3,4–20,5 % (veraltete Engine), deshalb neu
  aufgenommen.
- ✅ **Neue Engine-Screenshots via Golden-Capture-Pipeline, WebGPU-Matrix:** `node scripts/goldens/capture.js --matrix gpu
  --view top --frames 600 --out <dir>` → 12/12 ok (Chrome 152, SwiftShader/Vulkan-Software-WebGPU). Manifest/summary im
  Ordner auf `WEB_GPU` aktualisiert. Hinweis: Tripo-Key `TRIPO_API_KEY` ist in der Shell-Umgebung vorhanden; der
  Erzeuge-Bild-Endpunkt ist `POST https://api.tripo3d.ai/v2/openapi/task` mit `{"type":"text_to_image","prompt":...}`,
  Ausgabe ist **immer quadratisch 768×768** unter `output.generated_image` (Sign-URL) — 16:9-Referenzen (1376×768) werden
  per zentriertem Vertikal-Crop nach Skalierung erzeugt (Margen-Prompt nötig, damit der zentrale Pool den Schnitt übersteht).

## 2026-10-08 — Build-Fehler TS6059 (liquid-extras außerhalb engine-rootDir) behoben

- 🔴→✅ **Ursache:** `packages/engine/vite.lib.config.ts` → `vite-plugin-dts` (unplugin-dts) kompiliert beim Lib-Build ein
  tsc-Programm aus `packages/engine/tsconfig.json`, das `tests/**/*` + `rootDir:"./"` inkludiert.
  `DeadOptionLint.test.ts:33` importiert `../liquid-extras/src` (außerhalb packages/engine) → TS6059-Flut im
  `npm run build`-Output (Build lief trotzdem exit 0). Root-Typecheck war davon nie betroffen (Repo-Root rootDir).
- ✅ **Fix (minimal):** dts-Plugin auf `include: ["src/**"]` begrenzt — Lib-Build emittiert nur Typen der öffentlichen
  Fläche, Tests fallen aus dessen tsc-Programm (keine TS6059 mehr, keine nutzlosen `dist/tests/*.d.ts`). Tests bleiben
  durch `npm run typecheck` (Repo-weit) und vitest abgedeckt. Verifiziert: kompletter `npm run build` (exit 0, 0 TS6059),
  `lint:fix` grün, `npx tsc --noEmit` exit 0, volle Suite 1505/1505 grün.

## 2026-10-08 — "Synthetische Augen": vision-image.mjs (Bilder für text-only Modelle)

- ✅ **`../skills/vision-image/vision-image.mjs` angelegt:** Bild → externe Vision-API → Text-Beschreibung als stdin, damit das text-only
  Modell (Deepseek V4 Flash auf lokalem Spark, einziger aktiver opencode-Provider) "sehen" kann. **Standard: Gemini**
  (`gemini-3.8-flash`, env `GEMINI_API_KEY` — verifiziert funktionierend); `--provider openai` ist opt-in (`gpt-4o-mini`,
  `OPENAI_API_KEY` in dieser Shell aktuell 401/ungültig). Nutzung: `node .agents/vision-image.mjs <bild> [--prompt ...]`.
- ✅ **Angewandt auf improve-noir (Ist/Soll):** Soll `noir_pool_ki_soll.png` = Comic-Noir-Pool mit weißer Kugel + Ripples,
  rein monochrom, harte Posterization, reines Weiß nur an Kanten/Kamm, inkl. AI-Artefakte (wackelnde Fliesenlinien,
  schwarze Fliesen ohne Logik, mehrdeutige Schatten). Engine-Ist `noir_pool_engine_ist.png` = "close", aber Unterschied:
  mechanische diagonale Stripes + weiches Kugel-Shading statt dynamischer Comic-Ink-Schraffur/posterisierter Steps.
