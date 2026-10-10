# Stilisiertes Wasser: Qualitätsrunde Showcase 10 und Richtung „soft" (2026-10-03)

Ablage der Analysen und Aufgaben zweier `/collaborate`-Sessions (Blackboard, 4 Agenten + Moderator). Historischer Stand, kein lebender Standard; die Entscheidungen werden mit ADR 0025 (Entwurf unten) verbindlich.

> **Update 2026-10-04:** Die hier geplante Phase B ist inzwischen umgesetzt (v0.96.0, vom Moderator in einer eigenen Session: Architektur A = 2-Familien-System `OpenWaterMaterial` + universeller stilisierter Kern, Paket `@small-world-machine/liquid-extras`). Die Abschnitte zu Phase B und zu offenen Fragen unten beschreiben den Planungsstand vom 2026-10-03 und sind **historisch**. Eine harte Qualitätsanalyse des umgesetzten Showcase 10 (10 Pools, Noten 1 bis 5, Vergleichsbilder, Vorhersagen) und die anschließende Fix-Runde liegen lokal unter `.agents/collaborate/scratches/water/` (git-ignoriert; Einstieg `showcase10-quality.md`, `showcase10-fixes-requirements.md`). Ergebnis der Analyse: Klarwasser 1/5, Stylized 2 bis 3/5, Noir und Öl je 2/5, Lava und Slime je 3/5, Galerie 2,5/5. Gemeinsame Ursache des hellen Flecks war der enge Toon-Specular-Kegel (`nDotH > 0.99`), Ursache der WebGPU-Lava-Streifen die fehlende Wellenverschiebung im Depth-Pre-Pass.

## Inhalt dieses Ordners

| Datei | Inhalt |
| :--- | :--- |
| [`requirements-showcase-10.md`](./requirements-showcase-10.md) | Wortlaut des Moderators (Originalauftrag + Ergänzung „Stilisiertes Wasser", Erkenntnisse aus Video und `.blend`) |
| [`board-showcase-10-quality.md`](./board-showcase-10-quality.md) | Session 1 (Qualitätsrunde, T1–T11, Findings F1–F28): vollständiger Board-Export. Umgesetzt in v0.95.0 bis v0.95.2 |
| [`board-showcase-10-ghibli.md`](./board-showcase-10-ghibli.md) | Session 2 (Richtung stilisiertes Wasser / Ghibli, T1–T4, Findings F1–F44, Proposal P1 mit Stimmen): vollständiger Board-Export |
| [`adr-0025-draft.md`](./adr-0025-draft.md) | ADR-Entwurf „Wasser-Looks: Engine vs. Extension" (Dave). **Nicht akzeptiert, nicht in `docs/adr/`** |

Skizzen, Prototypen und das heruntergeladene Quellmaterial liegen lokal (git-ignoriert) unter `.agents/scratches/ghibli/` und `.agents/scratches/caustics/`.

## Session 1 (Qualitätsrunde): Ergebnis

Vier Pools in Showcase 10 (Klarwasser, Stylized, Slime, Lava) überarbeitet, ohne die zwei Shader-Kerne zu forken (ADR 0013). Releases: **0.95.0** (Schaumkronen über Jacobian-Varying, StylizedWater entschärft, FluidSurface-Substanz, neue Lava-/Slime-Looks, WebGL1-Schaum-Fix, WebGPU-Crest-Metrik-Fix), **0.95.1** (WebGL2-Opaque-Depth-Capture ohne Post-Chain), **0.95.2** (Review-Kleinigkeiten). Details: `CHANGELOG.md`, Board-Export oben. Bekannte Restpunkte: Farb-Capture-Gating (bewusst offen), Fallback-Depth-Formate und andere GPUs unverifiziert, Crest-Schaum unter WebGL1 als runde Klumpen (Geschmack), Lava-Puls subtil (Geschmack).

## Session 2 (Richtung stilisiertes Wasser): Analysen

### Quellen
- Tutorial-Video „procedural caustics and sparkle shader" (Blender 2.90, ca. 25 min, Autor Kristof Dedene) und die zugehörige Gumroad-Seite (Blender-`.blend`, Pay-what-you-want). Auswertung aus Transkript, Schlüsselbildern und dem per Python ausgelesenen Node-Baum der `.blend` (Parser `blender-asset-tracer`, ohne Blender).
- **Lizenz der `.blend` und ihrer Texturen unbekannt:** keine 1:1-Übernahme von `stars_1.jpg`, `water_rocks_1.jpg` oder Node-Werten; in `REFERENCES.md` nur „inspired by" (offen, Aufgabe von B8).
- Referenz-Looks des Moderators: Film *Spirited Away*, Spiel *Dredge*. „Ghibli" ist eine Marke: nur intern in Doku/Kommentaren, öffentliche Style-IDs sind neutral (`soft`, `sparkle`).

### Befunde im Überblick (je Agent, vollständig im Board-Export)

**Kaustik (Bob, T1; F9–F16).** Technik des Videos: Differenz **F1 − SmoothF1** (Voronoi) ergibt helle Linien an den Zellgrenzen; im `.blend` ein schmales hartes Band der Farbrampe (0.057 → 0.074, Smoothness 0.55, Scale 20), Emission 2.0, zwei animierte Domain-Warps (Musgrave, Detail 0.02/0.005, Z-Treiber `frame/500` und `frame/2000`), Fluss-Variante mit 3D-Voronoi. Empfehlung für uns: eine 3×3-Schleife mit `d1 = min(d)` und `S = Σ exp(−d/k)`, `v = d1 + k·log(S)` (Smooth-Min nach Inigo Quilez), analytischer 2-Schicht-Warp, optional kreisende Feature-Punkte als Fluss; Licht/Schatten-Paar (Schatten multipliziert die **refraktierte Bodenfarbe**). Kosten ca. 18 `sin` + 9 `exp` + 1 `log` gegenüber 36 `sin` heute; Flow-Modus +18 Trigonometrie. Korrekturen: Rampenbreite durch `k` normieren (`v/k`), `soft` braucht eine ca. 10× breitere Rampe als das Video, `k ≥ 0.1` und relative Form `exp(−(d−d1)/k)` wegen `mediump` in GLSL100. Behauptung „alte Kaustik = Blobs" nur an CPU-Nachbildung gemessen (V0-Baseline entscheidet).

**Ghibli-Look (Charly, T2; F1–F8, F17, F42).** Öffentliche Quellen beschreiben die Optik kaum; Merkmalsliste ist `[JUDGMENT]`. Zwei Teil-Looks: (A) offenes Wasser mit Verläufen, dünnen Strich-/Ripple-Linien, Himmelstönung, warmen Glitzern (= Fokus `soft`), (B) Kaustik-Netz + Sterne (= `sparkle`, allgemeiner Anime-Pool-Look). Farbe weich, Striche klar, nicht pastell: mittlere Helligkeit, getönte Dunkelheiten (nie Schwarz). Shader-Begriffe: 4–5-Stufen-Tiefenrampe (`rampSoftness`), `washAmount`, Linien (`lineDensity`/`lineWidth`), `foamSoftness`, `skyTint`/`cloudAmount`, warme Glitzer, `stepRate` (6/8/12 fps, nur Fragment-Marken). Variantenleiter als Parametervektoren auf einem Kern: `flat`, `toon` (unverändert), `bold` (Alias), `soft` (neu), `sparkle` (neu); Noir nur als Sample. *Dredge*-Stimmung (laut GDC-Zusammenfassung: Sinuswellen, Wellenmaske, kurzer Nebel, harte Kanten aus Low-Poly-Content) ist ein **Preset** von `soft`/`sparkle`, setzt aber ein Nebelpaar (`fogTint`/`fogDensity`) voraus, denn StylizedWater und OpenWater haben **keinen Nebel**; Erin bezweifelt „nur Preset", Entscheidung bei H1.

**Glitzer und Red-Team (Erin, T4; F18–F30, F43).** Das Video-Sparkle ist ein bildschirmfestes Overlay einer eigenen Sterntextur mit gestufter Zeit (`ceil(frame/3)`, 8 fps) und Zentrum-Maske, kein Wasser-Effekt; nicht 1:1 portieren. Empfohlen: Chunk `waterGlint` (Hash-Zelle + Sonnen-/Normalen-Gate, ca. 50 ALU, kein Sampler, kein `fwidth`), `glitterAmount` steuert den Gate-Kosinus (0.99 → 0.93), Sternradius ≤ 0.3 Zellgröße. `stepRate` nur für Marken, nie für Gerstner-Geometrie oder Refraktion. Risikoregister R1–R8 (Look-Regression, kein freier Uniform-Slot, WebGL1-Depth, Aliasing ohne `fwidth`, Tonemap-Entsättigung, Performance, Stepped-Time gegen Refraktion, Hash-Präzision), Verifikationsplan V0–V8 mit Freigabepunkten H1–H4.

**Architektur und Paketierung (Dave, T3; F31–F40).** Extensions im Repo (glTF-Plugins, Ökosystem-Pakete) bringen heute keine Shader mit; `MaterialType` ist ein geschlossenes Enum, Shader-Registrierung ist first-wins pro Typ. Korrektur zu F11 der ersten Session: `ObjectUniforms` hat 224 Byte im ≥ 256-Byte-Slot, **zwei freie `vec4`** (`u_styleA`, `u_styleB`) passen ohne Stride-Änderung (Obergrenze 8 Floats, `styleB.w` = `styleId`). Minimale Engine-Hooks: zwei `vec4`-Slots, Tokens `[WATER_EXT_DECL]`/`[WATER_EXT_SURFACE]` mit leeren Default-Chunks in allen drei Sprachen plus `composeStylizedWaterSources(ext?)`, protected Konstruktor-Typparameter, ESLint-Regel (Engine importiert keine Extension-Pakete). Budgets in Sin-Hash-Einheiten (aus Quelltext gezählt, nicht gemessen): `flat` ~36, `toon` 72, `soft` ~63 (+9 durch Flow), `sparkle` ~70, Extension bis 1,5× `toon`.

### Entscheidungen des Moderators (verbindlich)
1. Referenzen: *Spirited Away*, *Dredge*. Fokus: stilisiertes Wasser, Ghibli-Richtung.
2. `toon` bleibt unverändert und pixelgleich; **kein** Löschen des alten Kaustik-Pfads (weitere Beispiele folgen).
3. Extension-Paket: `@small-world-machine/liquid-extras`.
4. Erste Extension: Noir-Paket (ohne Assets, Beweis des Hook-Mechanismus). `sparkle` gehört in die **Engine**.
5. „Ghibli" nur intern; öffentliche IDs `soft`/`sparkle`.

### Konsens: Proposal P1 (5/5 AGREE) und Zusatzbedingungen
Kriterien: **Engine** = prozedural, asset-frei, Parität in GLSL300/GLSL100/WGSL, im Budget, und (braucht Engine-Interna oder gemeinsame Mathematik oder Stufe der Leiter); **Extension** = additiv über Hooks und (Nischen-Art-Direction, Assets/Lizenzen, Kosten über Engine-Budget, schnellere Iteration); im Zweifel zuerst Extension. Verbindliche Zusätze: eine feste 8-Lane-Tabelle mit `styleId` (`styleId == 0` = alter Toon-Pfad), Nullwerte für neue Slots, Struct-Größentest ≤ 256 Byte plus Nicht-Wasser-WebGPU-Szene (V1b), Toon nach **jedem** Shader-Schritt neu aufnehmen (V1c), Hook-Prüfung beim Zusammenbau (kein `return o;`, keine Bracket-Token, eindeutige Typ-Strings), V0-Baseline aller drei Backends bei identischer Canvas-Größe **vor** jeder Shader-Änderung. Rückzugsbedingungen der Stimmen sind Checkpunkte (u. a.: alte Kaustik ist schon ein Netz; Struct-Änderung verändert Pixel anderer Materialien; kombinierter GLSL100-Shader kompiliert/linkt nicht oder Toon-Frametime steigt; H1-Stills zeigen weiteren Ad-hoc-Term für `soft`).

## Aufgaben: Phase B (Planungsstand 2026-10-03, historisch; umgesetzt in v0.96.0)

Jede Aufgabe hat eigene Dateien; Reihenfolge B0 → B1 → (B2 ‖ B3 ‖ B4 ‖ B5) → B6 → (B7 ‖ B8).

| Schritt | Wer | Inhalt |
| :--- | :--- | :--- |
| B0 | Erin | Baseline aller drei Backends (Toon, OpenWater, Nicht-Wasser-WebGPU-Szene) vor jeder Shader-Änderung; nur Test-/Scratch-Dateien |
| B1 | Dave | `u_styleA`/`u_styleB` + `styleId`-Lane in Struct/Layout/`UniformPacker`, Struct-Größentest, Hook-Tokens + `composeStylizedWaterSources`, Compose-Prüfung, ESLint-Regel |
| B2 | Bob | Chunk `liquid_caustics` (GLSL300/GLSL100/WGSL), noch ohne Einbau |
| B3 | Charly | Chunks Rampe, Wash, Schaumweichheit, gestufte Zeit, Nebelpaar; Presets `soft`, `sparkle` (inkl. Dredge-Stimmung) |
| B4 | Erin | Chunk `liquid_glint` |
| B5 | Dave | Paket `@small-world-machine/liquid-extras` mit Noir-Paket |
| B6 | Charly (Review: Bob, Erin) | Einbau in `StylizedWater.frag.*`; Toon bleibt über `styleId == 0` pixelgleich |
| B7 | Erin | Verifikation V1–V8 und mit dem Moderator H1 (Leiter und Stimmung), H2 (Standbilder), H3 (Bewegung 8 fps vs. glatt), H4 (Toon-Regression, 3-Backend-Kontaktkarte) |
| B8 | Alice | ADR 0025, Guides, `REFERENCES.md`, `CONTEXT.md`, Changelog, Release |

## Offene Fragen und Verifikationsstand
- **Stand 2026-10-03 (historisch): Nichts davon war in der Engine kompiliert oder gerendert.** Alle Budgets und die „passt in 256 Byte"-Aussage stammen aus Quelltext-Lektüre, die Looks aus CPU-Nachbildungen und Palettenseiten.
- Offen: Freigabe Phase B; GLSL100-Präzision (`highp`/`mediump`) — Erin (F29) und Bob widersprechen sich, V0/Kompilierung klärt es; ob die Dredge-Stimmung ein Preset reicht (H1); Aufräumen der lokalen Download-Dateien (Video, `.blend`, `venv`).

## WebGL1-Degradation Stylized/OpenWater (technische Notiz, T2 2026-10-06)

**Dokumentierte, akzeptierte Degradation — kein Defekt, kein Disclaimer.** WebGL1 hat keinen realen Opaque-Depth-Capture-Pfad (`WebGL1Renderer.copyToOpaqueDepthTexture` ist ein No-op-Bind des Default-Far-Depth). Die Wasser-Shader ersetzen die Tiefe daher durch eine **Fresnel-Approximation** (nur streifender Blick hat „Deepness"), explizit kommentiert im Code:

- `OpenWater.frag.glsl100` Z. 88–91: „No depth buffer on WebGL1 … turned the whole pool into a white blob field. Fresnel is the only 'far shore' proxy … shore foam now fades in only at grazing angles".
- `StylizedWater.frag.glsl100` Z. 184–185: „No depth buffer on WebGL1: grazing angle proxy" für `foamBlend`.

Sichtbare Konsequenz im GL1-Tier (gemessen in Session 1, Board F16/F22): **Shore-Foam wirkt top-down flächendeckend bzw. wird über Fresnel quasi ausgeblendet**, und **Crest-Foam/Kräusel lesen als runde Flocken statt linearer Streifen** — von Erin als akzeptiert protokolliert („acceptable, noted", F22). Das ist eine technische Eigenschaft der GL1-Fallback-Ebene, keine offene P1-Arbeit. Anker: `[VERIFIED: packages/engine/src/core/materials/shaders/OpenWater.frag.glsl100:88; test=OpenWaterMaterial.test.ts]` und `[VERIFIED: packages/engine/src/core/materials/shaders/StylizedWater.frag.glsl100:184; test=StylizedWaterMaterial.test.ts]`.
