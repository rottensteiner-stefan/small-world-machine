# Showcase 34 — Billboard Grove · Living Log

## Zweck

Technische Miniatur-Demo zu AAA-Forschungsitem #15 (Billboards/Imposter): ein dichtes
`BillboardInstancer`-Grasfeld (ein instanzierter Draw-Call, Y-achsen-lockiert), plus eine Reihe
`ImposterSprite`-Bäume (per `bakeImposter()` vorab gebacken, 8 Winkel) **direkt neben echten 3D-
Vergleichsbäumen**, damit der Geometrie-Swap auf kurze Distanz sichtbar ist.

## Setup-Entscheidungen

- **Post-Processing deaktiviert:** `bakeImposter()` rendert in Offscreen-`RenderTarget`s, die der
  WebGPURenderer immer im Swapchain-Format anlegt; mit Post-Processing liefe der Live-Frame in ein
  `rgba16float`-HDR-Buffer, und der Pipeline-Cache ist nicht nach Target-Format gekeyt → erster
  Render (Bake oder Live) "vergiftet" die Pipelines des jeweils anderen. Der echte Fix gehört in den
  Pipeline-Cache (Key um Target-Format erweitern), nicht in diesen Showcase.
- **Imposter-Bake auf Transparenz (Engine):** `bakeImposter()` clear-te jetzt standardmäßig auf
  durchsichtiges Schwarz statt den Szene-Clear-Color zu übernehmen — vorher backten die Billboard-
  Bäume den himmelblauen Clear-Color als opake Kachel mit hinein und standen als blaue Kartons in
  der Szene.
- **Backend-korrekte Orientierung (Engine):** Render-Target-Zeilen sind auf WebGPU oben-links, auf
  WebGL unten-links (Framebuffer-Origin). Der Bake-Flip wird seither nur auf der WebGPU-Leg
  angewendet; der alte bedingungslose Flip rendert auf WebGL-Tiers Imposter kopfstehend.
- **Bake-Licht = Szenen-Licht:** Der Imposter-Bake erhält exakt dieselben Ambient-/Sun-Werte
  (Farbe/Intensität/Richtung) wie die Live-Szene — keine neutral-graue Default-Beleuchtung, die die
  Billboards wie fremdausgeleuchtete Cut-outs wirken ließe.
- **Gras mit Alpha-Cutout-Tuft-Atlas** (`assets/grass_tuft.webp`, gleiches Asset wie Showcase 10):
  ein `alphaTest` auf einer Vollton-Materialfarbe kann nie etwas ausstechen — grüne Vollton-Quads
  lasen vorher als flache Poster, nicht als Blätter.

## Bekannte Grenzen (honest)

- **Imposter werfen/empfangen keine Schatten** (Sprite/Billboard): die entfernte Reihe ist
  uniform ausgeleuchtet, echte Vergleichsbäume im Vordergrund werfen Schatten → nur als Tech-Demo-
  Tradeoff zu verstehen (bewusst vertagt, Stand 2026-10-22).
- **WEB_GL2 im Headless-Gate:** In der Headless-Puppeteer/Swiftshader-Umgebung liefert
  `?rendererType=WEB_GL2` durchgehend eine leere Canvas (einheitliche Stddev 0.0, keine Console-
  Fehler) — betrifft **alle** Showcases (Stichprobe 1 identisch), ist also Umgebungsartefakt, kein
  Showcase-34-Regress.

## Changelog

### 2026-10-30 — 100 Billboard-Bäume & Interaktives HUD-Panel
- **100 Billboard-Bäume (Grove Scaling):** Baum-Bestand von zuvor 5 auf 100 Bäume erweitert.
  Drei prozedurale Baum-Archetypen (Standard-Eiche, schlanke Birke/Espe, breite Krone) werden
  einmalig beim Start vorab gebacken (`bakeImposter()` mit 8 Blickwinkeln bei 256px). Alle 100
  Bäume teilen diese drei Textur-Sets (minimale GPU-Last & blitzschneller Start).
- **Deterministische Lichtung:** Bäume stehen in Flanken und dichtem Hintergrund mit Mindestabstand
  (1.6 m) fest im 40x40-Bodenbereich. Die ersten 5 Bäume entsprechen exakt der historischen
  Showcase-34-Positionierung.
- **Interaktives HUD-Panel (`Hud.ts` via `ShowcaseDrawer`):**
  - *Vegetation:* Billboard-Bäume umschalten, Schieberegler für Baum-Anzahl (5 bis 100, live ohne Rerender),
    echte 3D-Vergleichsbäume ein-/ausblenden, Grasfeld umschalten, sanftes Wind-Schwanken.
  - *Atmosphäre:* Lichtstimmungen (Sonniger Tag, Goldene Stunde, Morgennebel, Dämmerung mit Sprite-Tinting),
    Horizont-Haze/Fog Toggle & Distanz-Slider, Sonnen-Intensität.
  - *Kamera & Rundflug:* Presets (Lichtung, 3D vs. Billboard Nahvergleich, Vogelperspektive, Im Dickicht)
    inkl. weichem `camera.flyTo(...)` und zuschaltbarem automatischen 360°-Orbit-Rundflug.
  - *Bedienung:* Tastenkürzel `I` / `H` zum Ein-/Ausklappen, Fußzeilen-Button ⚙.
- **Verifikation:** `npm run typecheck`, `npm run lint` und Puppeteer-Gate `npm run test:showcases 34`
  erfolgreich auf allen drei Grafik-Backends (WEB_GPU, WEB_GL1, WEB_GL2).

### 2026-10-22 (Folge) — Sprite-Shader Fog + Grünflächen-Überlauf + Imposter-Erdung
- **Engine-Feature (Sprite-Shader Fog):** `Sprite.frag.{wgsl,glsl,glsl100}` wenden jetzt denselben
  Szenen-Fog an wie die lit-PBR-Shader (`[WGSL_FOG_CALC]`/`[FOG_DEFS]`+`[FOG_CALC]`, inkl.
  Höhen-Falloff). Camera-facing Sprites/Imposter vernebeln damit konsistent mit Boden & Bäumen —
  die zuvor dokumentierte „Horizont-Haze"-Inkonsistenz ist beseitigt. Achtung (Substitutions-
  Falle): `assemble()` ersetzt `[LIKE_THIS]`-Tokens auch in **Kommentaren** — Fog-Chunk-Marker in
  Kommentaren erzeugen Doppel-Injektion (einmal nur Kommentar-abgewandelt, einmal echt).
- **Engine-Feature (`bakeImposter.groundAtBottom`, opt-in):** bake-framet den vertikalen Ortho-
  Frustum standardmäßig symmetrisch um den Bounding-Sphere-Center, wodurch bei bodenstehenden
  Objekten (Bäumen) ein sichtbarer Leerraum unter dem Stamm entstand („schwebende Billboards",
  ca. 12 % Bildhöhe). Mit `groundAtBottom: true` wird die Welt-Y-Basislinie des Objekts an der
  Unterkante der Bake verankert; Standard (= zentriert) bleibt unverändert. Export
  `computeImposterVerticalFrame()` für Tests.
- **Showcase 34:** Scene-Fog (Horizont-Haze, LINEAR) hinzugefügt — bewusst dezent, damit die
  Grünband hinter der Rückreihe lesbar bleibt; Rückreihe nach vorn gezogen (z ∈ [-14, -11], klar
  innerhalb der Floor-Kante −20) **und** über `groundAtBottom` + Pflanzposition (`y = sy/2`)
  geerdet → keine Bäume/Gräser mehr über dem Floor-Rand, kein Schweben.
- **Engine-Fix, fremd (WebGL2Renderer):** verwaiste, offene Brace eines halben
  `releaseObjectResources`-Refactors repariert (Body an HEAD-Stand zurück, neues
  `releaseRenderTarget` intakt) — ohne Fix kein Parse des Moduls möglich.
- **Unit-Tests:** `SpriteFog.test.ts` (Assemble-Fog auf allen 3 Backends, Parität des Fog-Calc-
  Chunks) und `ImposterBaker.test.ts` (Grounding-Vertrag: untere Kante = minY − Margin, Span
  erhalten, Sockel-Fraktion 0.08/2.2; Standard-Framing unverändert symmetrisch).
- **Verifikation:** `npm run lint`/`build`/`test` grün (2909 Tests); Live-Gate
  `scripts/check-showcases.js 34` ✅ WEB_GL1 + WEB_GL2 + WEB_GPU; Screenshots
  `.agents/scratches/screenshots/` (Vision-Check: Bäume geerdet & mit Grün hinter dem Stamm,
  konsistenter Distanz-Haze, kein Überlauf über die Floorkante).

### 2026-10-22 — Transparenz-Fix + ästhetische Überarbeitung
- **Engine-Fehler gefixt (`bakeImposter`):** Bake-Clear standardmäßig durchsichtig (statt
  Szene-Clear-Color) + Option `clearColor`; Caller-Clear wird gesichert/wiederhergestellt (auch bei
  Fehlern). Der Showcase-Bug "Billboards mit himmelblauem Hintergrund" war ein Engine-Defekt (der
  Bake übernahm den Szenen-Clear des Showcases), nicht ein Showcase-Fehler.
- **Engine-Fehler gefixt (Imposter-Orientierung):** vertikaler Pre-Flip nur noch auf WebGPU —
  Imposter standen auf WebGL-Tiers kopf.
- **Unit-Tests:** Bake-transparent-Default/`clearColor`/Save-Restore, Restore bei Wurf
  (`finally`), Backend-Flip (via Vorzeichen von VP[5]); weiterhin Testsuite-grün.
- **Showcase 34:** Bake auf 256px (statt 128), Bake-Licht deckungsgleich zur Szene, leicht
  variierte Imposter-Skalen (keine Klon-Reihe), Gras auf Alpha-Tuft-Atlas umgestellt.
- **Verifikation:** `npm run lint`/`build:lib`/`test` grün; Live-Gate `scripts/check-showcases.js
  34` ✅ WEB_GL1 + WEB_GPU (WEB_GL1: Imposter korrekt orientiert **und** transparent, Gras als
  einzelne Halme; WEB_GL2 wie oben Umgebungsartefakt). Screenshots: `.agents/scratches/screenshots/`.
