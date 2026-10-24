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
- `?probe=pole` — Dünn-Occluder-Probe (dünner Pfahl) für die Kontakt-Härtungs-Demonstration
  (Default: Box-Szene).
- Probe-Rig-Overrides (URL, nur für Doku/Kalibrierung): `camX/camY/camZ`, `lookX/lookY/lookZ`,
  `lightX/lightY/lightZ`, `sunI`, `amb`. Fehlende Parameter fallen auf die rig-spezifischen
  Defaults zurück (Pole: kalibriertes Kontrast-Rig; Box: unveränderter (c)-Stand).

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

### 2026-10-21 (0.115.7) — Kontakt-Härtung demonstriert + Live-Gate (Increment d)
- **Probe-Modus `?probe=pole`:** dünner, hoher Zylinder-Caster (Radius 0.12) auf der Bühne; Query-tunbare
  Kamera/ Licht/ Sonnen-Intensität/ Ambient (`camX/Y/Z`, `lookX/Y/Z`, `lightX/Y/Z`, `sunI`, `amb`).
  Die Defaults des Pole-Modus reproduzieren das kalibrierte High-Contrast-Rig (sunI=5, amb=0.08,
  lightY=-0.5, Kamera (0,6.5,12)/(0,1,-1)), Box-Modus-Defaults bleiben byte-identisch zum (c)-Stand.
- **Beweis (Vision + numerisch):** Der gehärtete (c)-PCSS produziert mit dem dünnen Pfahl das echte
  PCSS-Signaturverhalten „scharf am Caster, weich in der Distanz":
  - Kontaktlinie an der Pfahl-Basis: **hart/tief** (gemessen Nahe-Umbra-Kontrast **0.61**).
  - Ferne Zone: **erblasst** in einen breiten, flachen Penumbra-Gradienten (Ferne-Umbra **0.26**).
  - **WebGL2-Negativkontrolle (festes PCF):** Umbra bleibt durchgehend tief (**0.60/0.60**) →
    der Gradient ist echt PCSS-spezifisch, kein Perspektiv-Artefakt.
- **Finding — adaptive Blocker-Suche nicht nötig:** die feste 16-Tap-Sunflower-Scheibe zerstört die
  Härtung für einen dünnen Occluder nicht; die zuvor (0.115.5/0.115.6) als Roadmap postulierte
  adaptive Suche wird damit als unnötig verworfen (Doku ehrlich aktualisiert). Ein **Box-Blocker
  bleibt fundamental uniform weich** (die Scheibe mittelt seine ganze Tiefenspanne) — dokumentierte
  Grenze, KEINE offene Roadmap-Festlegung mehr.
- **Committed Live-Gate `scripts/check-swm42-pole.mjs`:** misst Nahe-/Ferne-Umbra an der Kontaktlinie
  (auto-detektiert), assertet Härtung + GL2-Negativkontrolle + Stärken-Diskriminator. Zwei Läufe:
  **`SWM42 POLE GATE: OK`** (GPU 0.61/0.26, GL2 0.56/0.60). Box-Gate `.agents/scratches/check-swm42.mjs`
  weiterhin **`SWM42 GATE: OK`** (beide Tiers grün).
- **In (d) gefundene + gefixte Bugs (Box-Gate hat sie gefangen):**
  - `softness=0` wurde durch `|| 1` fälschlich zu 1 gemappt (3021:0-Parse) → fix.
  - `this._params = p` vor `super()` → „Must call super constructor" → Seite hing (Hänge-Ursache der
    Calibration-Läufe) → Fix: Zuweisung hinter `super()`.
  - `parseNum()` behandelte **fehlende** Query-Parameter als 0 (`Number(null)`=0, endlich) → Box-Defaults
    wurden zu sunI=0/camY=0 → **schwarze Bühne, Box-Gate rot**. Fix: fehlender Param → Fallback.
    Lehre: Default-Pfade ziehen im Live-Gate gegenprüfen, nicht nur Override-Pfade.
- **Hinweis Framing:** Der Directional-Light-Schatten des Pfahls hat keinen natürlichen Endpunkt
  (läuft bis Frame-/Bühnenrand); die Ferne-Zone ist als die am weitesten entfernte sichtbare Zone
  definiert (unterste Frame-Zeilen). Für die Dokumentations-Frames ist der Schatten unten leicht
  beschnitten — erwartetes Verhalten des Rigs, nicht bloß ein Framing-Fehler.

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

### 2026-10-22 (0.116.0) — EVSM-Probe + Gate (Stage C, ADR 0043)
- **Neuer Query-Knopf `?shadowMode=<pcss|evsm>`** → `quality.shadowMode` (Default `pcss`). EVSM ist
  opt-in (ADR 0043); der Default-Pfad bleibt bytes-identisch (Quelltext-Guards + goldener Lauf).
- **QA-Hook erweitert:** `__qaSwm42.sample()` liefert jetzt `shadowMode` und — auf WebGPU — die
  echten `evsmParams`-Lanes `[216..218]` (Mode-Flag, Varianz-Floor-Multiplikator, LBR-Anteil), sodass
  der Gate die CPU→GPU-Verdrahtung der opt-in-Lane prüfen kann. Auf WebGL2 (ohne globalen
  Scratch-Puffer) bleibt `evsmParams` null.
- **Committed Live-Gate `scripts/check-swm42-evsm.mjs`** (Muster: check-swm42-pole.mjs, aber
  `domcontentloaded` + paintReady statt `networkidle0` — der EVSM-Page-Hang im Diagnose-Lauf war ein
  falscher Navigations-Timeout, nicht EVSM-bedingt). Asserts: (a) fehlerfreier Lauf (keine
  Pipeline-/Kompilier-Fehler), (b) `evsmParams[0]===1` unter `shadowMode=evsm` und `===0` unter dem
  pcss-Default, (c) plausibler Frame. Läufe: **`SWM42 EVSM GATE: OK`** (WebGPU).
- **WebGL2-Befund-Kette (ehrlich dokumentiert, ADR 0043/shadows.md):**
  1. *pcss-Schwarz (B2-Regression, gefixt):* `_bindEvsmShadowUniforms` band im Default einen
     Dummy + ließ Unit 14 „active" → WebGL2/pcss wurde schwarz. Fix: Early-Return solange
     `shadowMode !== "evsm"` (Default bleibt exakt, 2× [121,120,119]).
  2. *Gelb = clearColor-Leak (gefixt):* der Momenten-Pass `gl.clearColor(e^40, e^80, -e^-40, e^-80)`
     restaurierte das Clear nie → `WebGLMainPass`-`clear(COLOR|DEPTH)` füllte den sichtbaren Canvas
     mit clamp(e^40,e^80,-e^-40)→(255,255,0) ≈ exakt das beobachtete Gelb. Fix: clearColor nach dem
     Momenten-Pass restaurieren.
  3. *WebGL2-EVSM-Schwarz — WURZEL GEFUNDEN + GEFIXT (nicht Treiber, sondern echte Engine-Bugs):*
     Nach (1)+(2) blieb `shadowMode=evsm` schwarz; die Diagnose-Kette war korrekt, aber unvollständig:
     Atlas 100 % farClear (kein NaN/Inf), Lit-Pass-Bindung korrekt (Bind-Log), Float32-Simulation der
     EVSM-Mathe liefert `min(p,n)=1.0` (LIT), NEAREST/float-linear ohne Effekt. Der entscheidende
     Shader-/Bind-Instrumentierungs-Befund: `_bindSubgroupTextures()` re-pointete `u_dirEVSMMap`
     NACH der Atlas-Bindung erneut (dynamisch vergebene Low-Unit + 1×1-**weißes** `defaultTexture`)
     → der EVSM-Shader tastete Weiß statt des Atlas ab → `chebyshev≈0` → schwarzer Frame (nur
     schwaches Ambient). Zusätzlich (latent) kollidierte `_EVSM_MAP_UNIT=14` mit `CLUSTER_GRID_UNIT=14`
     (Cluster-Grid-Eviction, `GL_INVALID_OPERATION` pro Draw). Fixes (nur `WebGL2Renderer.ts`):
     `u_dirEVSMMap` aus der Material-Sampler-Schleife ausnehmen (wie IBL-Maps) + Bindung auf der
     pro-Programm exklusiv reservierten Sampler-Einheit statt fester Unit 14. Verifiziert grün:
     WebGL2/evsm `[120,119,118]` (Schatten sichtbar, keine GL-Mismatch-Fehler), WebGL2/pcss-Default
     weiterhin byte-identisch `[121,120,119]`. Die drei Behalte-Fixes (pcss-Early-Return,
     clearColor-Restore, NEAREST-Atlas) bleiben als Engineering-Entscheidungen bestehen.
- **WebGPU-EVSM:** funktional (Momenten-Pass + `textureLoad`-Auswertung, Mode-Flag = 1 auf
  GPU-Lane 216, fehlerfreier Lauf) aber ausgewaschen (flache Kontakt-Tiefe) — Tuning-Thema der
  Default-Lanes (ADR 0043), keine Architektur-Lücke.

### 2026-10-22 (Interaktives Soft Shadow Lab HUD)
- **Tuning-HUD (`#shadowLabHud`) + Toggle-Button (`.swm-inspector-btn`, Taste `I`):**
  - **1. Probe Geometry (Tasten `1`–`3`):** Umschaltbar zwischen `1 · Box` (2,2 m-Würfel), `2 · Pole` (5 m-Mast für Contact-Hardening) und `3 · Step Rig` (Mast + 3 Querbalken auf 0,45 m / 1,65 m / 3,1 m Höhe + schwebende Kugel). Dazu ein `Caster Lift Y`-Slider (`0.0 – 2.5 m`), der den Caster live vom Boden abhebt und sofort zeigt, wie unter PCSS der scharfe Kontaktschatten mit wachsender Blocker-Distanz weich wird.
  - **2. Shadow Technique:** Live-Umschalter `PCSS (Contact)` vs. `EVSM (Moments)` sowie Slider für `Penumbra Softness` (`0.0 – 5.0`) und `Max PCF Radius` (`1 – 16 px`), inkl. transparentem WebGL2-Hinweis im Default-PCF-Modus.
  - **3. Sun & Shadow Bias:** Live-Steuerung für `Sun Elevation`, `Sun Azimuth`, `Sun Intensity`, `Ambient Fill`, `Depth Bias` und `Normal Bias` (demonstriert Shadow Acne vs. Peter-Panning).
  - **4. Camera & GPU Readout:** Kamera-Presets (`Overview`, `Contact Base`, `Far Penumbra`), freie Maus-Orbit/Wheel-Zoom-Steuerung auf dem Canvas sowie Live-Telemetrie aus `__qaSwm42.sample()`.
  - **Gate-Kompatibilität:** Öffnet in interaktiven Browser-Sessions automatisch, bleibt in Headless-/Gate-Läufen (`navigator.webdriver` oder `?softness=`/`?maxRadius=`) eingeklappt und lässt die initiale Kameramatrix bis zur ersten Maus-Interaktion unangetastet.
- **EVSM Anti-Peter-Panning & Anti-Light-Bleed (WebGPU + WebGL2, ADR 0043):**
  - **Ursache:** Rohes Mitteln von Far-Plane-Clear-Texeln (`e^{40}`) über dünne Caster (`?probe=pole`) sprengte das positive Moment, zog das negative Momenten-Mittel `m1_neg` über `nw` sobald `α < e^{-40 Δd}` (Peter-Panning an der Basis + Kontakt-Bleed), kontaminierte `occluderDepth = log(tight.x)` auf `0.97` außerhalb der innersten 2 Pixel und übersprang im regulären 3×3-Wide-Filter (`{-R, 0, +R}`) den 5-Texel-Pole (`R=12 ≡ R=16`). Zusätzlich erzwang `cullFace(FRONT)` im WebGL2-EVSM-Pass `z_backface == z_floor` (`d → 0`) direkt an der Pole-Basis (`baseGapRows = 0.129`).
  - **Lösung:** (1) Receiver-Horizon-Clamping (`rawTap.x >= pw ? rMoment : rawTap`), (2) 3×3 Tight-Slice (`radius = 1`) + geschertes 25-Tap-N-Rooks-Wide-Lattice `(4·wx + wy, 4·wy - wx)` (lückenlose 1-Texel-Abdeckung über `[-10, +10]`), (3) Blocker-Only-`occluderDepth` mit `smoothstep(0.0015, 0.012, gap)`, (4) `cullFace(BACK)` in `WebGL2Renderer._renderEvsmMoments` + Skalierung nur des synthetischen Varianz-Floors (`max(rawVar, floorVar * 0.06)`).
  - **Messwerte (`?probe=pole&shadowMode=evsm`):** WebGPU: `baseGapRows = 0.609` ab Pixel 1 (exakt wie PCSS `0.609`), `nearUmbraContrast = 0.589`, `farUmbraContrast = 0.375` (`spread = 0.214`). WebGL2: `baseGapRows = 0.607` ab Pixel 1, `nearUmbraContrast = 0.588`, `farUmbraContrast = 0.380` (`spread = 0.208`). `SWM42 EVSM GATE: OK`.

### 2026-10-24 (WebGL2-PCSS = WebGPU-PCSS)
- **Befund:** WebGL2 hatte PCSS nur im Nicht-PBR-Chunk (Lambert/Phong/Terrain/World, alte Bias-gekoppelte Formel, Cap fest 4). Standard/Decal (also alles in diesem Showcase) liefen auf festem 3×3-PCF; `shadowSoftness`/`shadowMaxPcfRadius` wirkten auf WebGL2 gar nicht.
- **Umsetzung:** `evalPCSSDir` in `base_fragment_header.frag.glsl` portiert `getShadowPCSS` (`pbr_math.wgsl`) auf den Kaskaden-Atlas (zellgeklemmte Taps, Zell-Texelzahl statt Layer-Größe), neuer Uniform `u_shadowSoftness`. Beide Licht-Chunks nutzen sie für Haupt- und Blend-Sample.
- **HUD:** Der WebGL2-Hinweis „Softness-Slider WebGPU-only“ ist entfernt, die Slider wirken auf beiden Tiers.
- **Pole-Gate neu:** Negativkontrolle ist `softness=0` auf WebGL2 statt „WebGL2 = festes PCF“. Messwerte: WebGPU soft3 nah `0.61` / fern `0.34`, WebGL2 soft3 `0.56` / `0.34`, Kontrolle `0.56` / `0.60`. `SWM42 POLE GATE: OK`, `SWM42 EVSM GATE: OK`.
