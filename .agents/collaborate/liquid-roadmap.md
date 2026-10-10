# Liquid Roadmap — Harte Bestandsaufnahme, Branchenvergleich & stabiler Umsetzungsplan

> **Dokument-Status:** `plan` — Konsens P2 (§8/§9) erreicht, in Umsetzung; seit 2026-10-07 enthält dieses Dokument **alles** aus den Einzelblättern der Runden 1–3 und dem Inventar (§12–§17). Die 18 Runden-Blätter stehen verlustfrei in `liquid-roadmap.rounds-archive.md` (Quellenbeleg, mit SHA-256 je Blatt); das Inventar `liquid-roadmap-inventory.md` bleibt als Belegstapel mit exakten Zeilenankern bestehen.
> **Modus:** `plan` (Kollaboration, 6 Subagenten + Moderator)
> **Topic:** `.agents/collaborate/liquid-roadmap.md`
> **Datum:** 05. Oktober 2026
> **Status der vorherigen verwandten Sessions:** `liquid-architecture` (consensus P1, ACCEPTED), `liquid-improve` (consensus P1, VERIFICATION_PASSED behauptet), `showcase10-quality` / `showcase10-fixes2` (gemessene Qualitätsaudits, iterativ gefixt), ADR 0013 + ADR 0025 (ACCEPTED)

### Leseführer

| Frage | Abschnitt |
|---|---|
| Was war der Auftrag? | §1 |
| Was wurde schon erreicht, was war nur behauptet? | §2, **§13** (Detail), **§17** (Stand heute) |
| Wie schlagen wir uns gegen Godot, Unreal, Unity/Crest, Three.js? | §3, **§12** |
| Was ist der Plan, mit Abnahme und Gates? | §8, §9 (Konsens), §10 (T2), §11 (Licht und Schatten) |
| Wohin kann es sich entwickeln? | **§14** |
| Wer hat was bezweifelt, was wurde verworfen, wann ziehen wir zurück? | **§15** |
| Formeln, Zeilenanker, Fallen | **§16** |
| Widersprüche zwischen den Blättern und wie sie aufgelöst wurden | **§17.2** |

---

## 1. Moderator-Brief (wortgetreue Aufgabenstellung)

> „Es ist ein endloses Thema, ich weiß. Aber… Lade 6 weitere Sub-Agents ein, um über `collaborate` eine wirklich tiefgehende Analyse und einen Vergleich des aktuell implementierten Flüssigkeitssystems (inklusive Geometrien und Shader) durchzuführen. Vergleich der Features mit Godot, Unreal, Unity und Three.js. Was fehlt, was ist gut, was ist wie in welchem Zustand. Diesem harten Vergleich soll auch ein Ausblick zur Seite gestellt sein, wie wohin wir uns in der Zukunft entwickeln könnten. Dafür ein Topic-Document `liquid-roadmap` anlegen. Weiters: bereits vorhandene Topics zum Thema Fluids/Wasser/Liquids aus der Collaborate-Sammlung lesen und in die neue `liquid-roadmap` einarbeiten. Was wurde schon verwirklicht, waren wirklich Fortschritte zu erkennen? Wir wollen jetzt einen handfesten Plan für die nächste Zeit, für ein stabiles, hartes und richtig gutes Flüssigkeitensystem. Eben auch mit Änderungen an den Shadern, den Pipelines etc., wenn nötig.“

### Verständnis (Alice, Moderator-Interpretation)
1. **Auftrag jetzt (vor Phase B):** eine **harte, evidenzbasierte Bestandsaufnahme** des *aktuell implementierten* Flüssigkeitssystems (Materialien, Shader, Geometrien, Physik, Pipeline) und ein **Feature-Vergleich mit den Branchenriesen** (Godot, Unreal, Unity, Three.js): was gut ist, was fehlt, was sich in welchem Zustand befindet.
2. **Vorarbeit einarbeiten:** die Topics `liquid-architecture.md` + `liquid-architecture-requirements.md`, `liquid-improve.md` + `liquid-improve.pid`, die gemessenen Qualitätsdaten aus `scratches/water/showcase10-{quality,fixes,fixes2}.md`, ADR 0013, ADR 0025 und das heute erstellte evidenzbasierte Inventar `liquid-roadmap-inventory.md` sind **verpflichtende Lektüre** und fließen ein.
3. **Verifikation statt Glauben:** `liquid-improve.md` behauptet `[VERIFICATION_PASSED]`; das Inventar hat gezeigt, dass mehrere Kernbehauptungen nur teilweise oder gar nicht im Code liegen. Die Session muss deshalb ehrlich zwischen **verifiziert vorhanden / teilweise vorhanden / behauptet-aber-fehlend** unterscheiden.
4. **Ziel:** ein **handfester Plan** (Phasen, Meilensteine mit Abnahmekriterien, Datei-Ebene) für ein **stabiles, hartes, wirklich gutes** Flüssigkeitensystem — inklusive *nötiger* Änderungen an Shadern und Pipelines. Stabilität/Härte hat Vorrang vor neuem Glanz.
5. **Ausblick:** Der harte Vergleich bekommt einen **Zukunftsabschnitt** (Research-Horizont: FFT, Gauges, Compute, LOD/Tessellation, SPH/Particles, Reflexion/Refraktion) — klar getrennt vom handfesten Nahplan.

## 2. Eingearbeitete Vorgeschichte (Fortschritts-Check)

**Echt vorhanden & verifiziert (Code, Tests, Nutzung):**
- 2-Familien-Architektur: `LiquidWaveMaterial` (abstrakt; `OpenWaterMaterial`, `StylizedWaterMaterial`) + `FluidSurfaceMaterial` (`LavaMaterial`, `SlimeMaterial` als Presets) — alle Klassen existieren, öffentlich exportiert, in Apps genutzt (showcases 10, 31; yad; the-whisper).
- Voller 3-Backend-Shader-Satz (GLSL300/GLSL100/WGSL) für FluidSurface/OpenWater/StylizedWater (18 Dateien) + 10 `liquid_*`-Chunks; `ShaderRegistry.registerChunk`/`[TOKEN]`-Mechanismus echt.
- Erweiterungsmechanismus in **Produktion**: `composeStylizedWaterSources()` + Hooks `[WATER_EXT_DECL]`/`[WATER_EXT_SURFACE]`, genutzt von `@small-world-machine/liquid-extras` (NoirWaterMaterial, OilSlickMaterial; Tests vorhanden). `[VERIFIED: packages/engine/src/core/materials/StylizedWaterMaterial.ts:17; test=StylizedWaterMaterial.test.ts]`
- OpenWater: **6-Wellen-Kaskade** + Tiefwasser-Dispersion `sqrt(g·k)` (Chunk) + **analytische Jacobi-Kamm-Schaum** (`J = t.x·b.z − t.z·b.x`), 3 Backends. `[VERIFIED: packages/engine/src/core/materials/shaders/OpenWater.vert.glsl:91; test=OpenWaterMaterial.test.ts]`
- Brechung über Captured Opaque Color/Depth; Screen-Space-Ansatz; WebGL1 dokumentierter Depth-Gap.
- Physics-Baustein: `FluidVolume` + `BuoyancySolver` (Archimedes) — **existiert, aber rendering-setitg entkoppelt und in keiner App verdrahtet**.
- Qualitätsarbeit showcase10: viele gemessene Defekte wurden iterativ fixt (Schaumrand, Caustic-Blob, Specular-Blowout, Noir/Oil-Parameter, dead options, Sign-/Layout-Rework, Lava-Hue, Slime-Ringe, Glint-Stepping). Stand F2: Bewertungen Lava 4/5, Oil 4/5, Noir 2,5/5, Stylized-Ladder 3–4, Clear 3–4, Slime 2,5–3,5 — WebGL1 durchweg schlechter.

**Behauptet-aber-fehlend / teilweise (siehe Inventar, ehrlicher Zustand):**
- **Clapotis / Beckenwand-Reflexion:** komplett abwesend (kein Treffer im Code). _(S-deferred → Block S, kein offener P1-Bug)_
- **Objekt-Wakes / Kontaktrippeln:** fehlen (nur Tiefen-Gate als dekorative Ufer-Striche in StylizedWater; `wake` → 0 Treffer). _(S-deferred → Block S, kein offener P1-Bug)_
- **Jacobian-Kamm-Schaum:** nur in OpenWater; `StylizedWater` hat toten Varying `v_displacementY`, „Crest Foam“-Block macht nur Uferschaum; „golden ratio spread“ behauptet, aber nicht implementiert — **in T2 gestrichen**: die reale Wellenkomposition ist `2+1+2+1` (2 dominant, 1 geschaltete Schwelle, 2 senkrechte Detail-Wellen, 1 60°-Kreuzdünung; verankert mit `[VERIFIED]`-Ankern auf `OpenWater.vert.glsl`/`.glsl100`/`.wgsl` in `liquid-roadmap-inventory.md` §2(a)); 6. Welle in StylizedWater ist gated (5–6 Wellen).
- **5 Injektions-Hooks (`#SW_INJECT_*`):** nie implementiert; reduziert auf die 2 ADR-0025-Tokens (die echt und in Produktion sind).
- **Lava/Slime-„Physik“** (Bingham, Voronoi-Kruste `F2−F1`, Planck, Stokes, Blasenkinetik): in Code **nicht** vorhanden — es sind vereinfachte Noise-Flow-Looks.
- **`UniversalFluidMaterial`:** existiert nicht; in T2 von ADR 0025 und CONTEXT.md auf `StylizedWaterMaterial` korrigiert (die modulare Kernrolle war von StylizedWater übernommen).
- **Fluid-Geometrie/Tessellation/LOD:** keine; Wasserflächen = segmentierte `Plane`/`Ground`. _(OOS → Research-Horizont)_
- **Wasser-spezifischer Render-Pass:** keiner; `PlanarReflectionNode` vorhanden, aber **kein Wasser-Shader sampelt `u_reflectionMap`** — „Reflexion“ ist prozeduraler `skyTint`. _(OOS → Research-Horizont)_
- **Uniform-Layout:** 256-Byte-Slot **voll**; `u_styleA`/`u_styleB` sind verbraucht. Kein weiterer freier vec4 — neue Parameter nur per repurposed Lanes/Per-Style-Konstanten. `[VERIFIED: packages/engine/src/core/renderers/shaders/StandardWebGPULayout.ts:30; test=WebGPUObjectUniformPacker.test.ts]`
- **Testdeckung:** StylizedWater/Lava/Slime fehlen in Shader-Assembly-/Shader-Validation-Matrizen; `[VERIFICATION_PASSED]` (liquid-improve.md:323) überschätzt die Backend-Parität.

**Fazit Fortschritts-Check:** Es gab **echten, substanziellen Fortschritt** (Architektur, 3-Backend-Parität, Chunks/Hooks, Erweiterungspaket, erste Physik-Bausteine, Qualitätsaudits mit Fixes). Aber die Dokumentation überzeichnet mehrere „fertige“ Features; der wahre Zustand ist „Architektur voraus, Physik/Simulation/Robustheit hinten“.

## 3. Pflicht-Vergleich (Industrie)

Jeder Agent vergleicht seinen Zuständigkeitsbereich explizit mit **Godot, Unreal Engine, Unity und Three.js** (sowie, wo sinnvoll, Blender/Crest/Niagara/ZibraAI als Referenz) entlang definierter Achsen: Geometrie/Tessellation/LOD, Wellen-/Simulationsmodell, Schaum/Gischt/Interaktion, Optik (Refraktion/Reflexion/Absorption/SSS), Artist-Workflow (Material-Graph/Presets/Hooks), Backend-/Plattformstrategie, Robustheit/Qualitätssicherung, Performance-Budgets. Was können wir übernehmen, was bewusst **nicht** (Browser-Constraints: 3 Backends, WebGL1, Uniform-Budget, keine Forks). **Das Ergebnis dieses Vergleichs steht in §12.**

## 4. Nicht verhandelbare Constraints & Entscheidungskriterien

- 3-Backend-Parität (GLSL100/WebGL1, GLSL300/WebGL2, WGSL/WebGPU) ist Pflicht; WebGL1-Gaps dokumentiert und akzeptiert, aber kein Stillstand.
- Keine Engine-Forks; Erweiterungen über existierenden Chunk-/Hook-Mechanismus (ADR 0025); Engine <=> Extension.
- Keine globalen Singletons; Multiple-Engine-Instanzen; strikte Typen (`no any`); Linter/Build/Tests grün vor Commit.
- Uniform-Layout voll (256 Byte): neue Shader-Konstanten via Per-Style-IDs/repurposed Lanes oder Layout-Erweiterung mit breitem Wirkungsradius (ADR 0013 wägt ab).
- **Härte/Stabilität > neue Features:** Abnahmekriterien sind messbar (Tests grün, Backend-Parität belegt, keine toten Optionen, Claims == Code).
- Entscheidungskriterien für den Plan: Impact/Wert, Aufwand, Risiko (3-Backend-Kosten), Kohärenz mit der Architektur, Stabilitätsbeitrag, Artist-Workflow-Nutzen.

## 5. Ablauf & Roster

- **Stufe 1:** Round-Robin Über die 6 Subagenten (Alice, Bob, Charly, Dave, Erin, Frank) via `collab.mjs`/Datei-Protokoll.
- **Runde 1 (getrennte Blätter):** jeder Agent schreibt seine harte Analyse + Vergleich + Zustandsbewertung + Vision in `liquid-roadmap.round1.<Name>.md` (kein gegenseitiges Anchoring).
- **Runde 2:** Moderator verdichtet zu einem Planentwurf `P1`; alle Agenten liefern härtesten Einwand + Änderungsvorschlag + bedingte Zustimmung.
- **Runde 3:** Konsens/Lock des finalen Plans inkl. Phasen, Meilensteinen, Abnahmekriterien, Datei-Berührung.

---

## 6. Session-Log (live gespeichert, nichts geht verloren)

### Wichtige Moderator-Grundsätze (verbindlich, persistent)
- `[MODERATOR_NOTE 2026-10-05T20:50:00Z]` Endverantwortung liegt **immer beim User**, nicht beim Agenten. **Copyright ist für diese Analyse technisch irrelevant** — Analyse läuft auf Fakten & gemessenen Claims, nicht auf Copyright-Vorsicht. Keine unnötige Zurückhaltung wegen Lizenz-/Urheberfragen in Analysen.
- `[MODERATOR_NOTE]` Wichtige Entscheidungen, Grundsätze und Session-Fortschritte werden **lokal persistiert** (`.agents/collaborate/*.md` + `*.pid`), damit bei Sessionbrüchen nichts verloren geht.

### Runde-1-Fortschritt (getrennte Blätter, Stand 2026-10-05)
- ✅ `liquid-roadmap.round1.Alice.md` — Architektur-/Systemzustand
- ✅ `liquid-roadmap.round1.Bob.md` — Realistic Open-Water / Wave-Physics
- ✅ `liquid-roadmap.round1.Charly.md` — Stylized/NPR & Artist-Workflow
- ✅ `liquid-roadmap.round1.Dave.md` — Simulation & Interactivity
- ✅ `liquid-roadmap.round1.Erin.md` — Quality/Robustness/Performance (Red-Team)
- ⏳ `liquid-roadmap.round1.Frank.md` — Research Horizon & Future Vision (ausstehend)
- Nächster Schritt nach Runde 1: **Konsolidierung durch Moderator → Planentwurf `P1` → Runde 2 (Red-Team/Einwände) → Runde 3 (Konsens/Lock).**

---

## 7. Runde 2 — Konsolidierter Planentwurf P1 (Moderator, Stand 2026-10-05)

> **Status:** Entwurf für die Red-Team-Runde. Basierend auf den sechs Runde-1-Blättern (Alice/Bob/Charly/Dave/Erin/Frank). Noch kein Konsens; Änderungen an P1 sind neue Vorschläge (P2…).

### 7.1 Konsolidiertes Zustandsbild (Short-Form; Details in den Blättern)
- **Struktur solide & industriekompatibel:** 2-Familien-Architektur, Chunk-/Hook-Mechanismus, Extension Boundary (Noir/Oil in Produktion), 3-Backend-Shader, analytische Dispersion+Jacobi-Kamm (nur OpenWater), Screen-Space-Refraktion. Echter Fortschritt seit `liquid-architecture`/`liquid-improve`, aber: **2 von 6 "VERIFIED"-Zielen haben 0 Code** (Clapotis, Wakes — beide S-deferred/Block S, kein offener P1-Bug; Abdeckungs-Bilanz `[COVERAGE: 2/6 conform, 1 partial, 2 absent, 1 scope-reduced]` siehe Inventory §2(g) / Board-Fußnote F24/F28); Skylit/Claims überzeichnet; Uniform-Slot (256 B) voll; keine Wasser-Geometrie/Tessellation/LOD; Physik (FluidVolume/BuoyancySolver) entkoppelt + app-unbenutzt; kein Wasser-Renderpass; WebGL1 dokumentiert degradiert; 3 Materialien fehlen in den Shader-Testmatrizen; toter Varying `v_displacementY`; `u_styleA.w`-Lane-Kollision (3 Bedeutungen/styleId); Posterize-Off-by-one.
- **Qualität (gemessen):** Ladder GL2/GPU 3.5–4, Clear 3–3.5 (Floor unlesbar), Slime WebGPU 2.5, Noir terminal nie peer-bestätigt, WebGL1 durchgehend ~1 Stufe darunter. "Härte 5/5" gibt es nirgends.

### 7.2 Leitprinzipien des Entwurfs (aus allen Blättern, Konsens-fähig)
1. **Härten vor Glanz:** Claims == Code; Abnahme messbar (Tests, 3-Backend-Parität, keine toten Optionen).
2. **Wasser-Prinzip:** Interaktivität "günstig & begrenzt" (repurposed Lanes, schon gebundene Capture-Texturen, kein Compute); FFT/SPH/LOD/Tessellation sind Research-Horizont, nicht dieser Zeitraum.
3. **Kein Layout-/Sampler-Ausbau** in diesem Zeitraum (256-B-Constraint bleibt; ADR 0013-Verdikt aktualisieren statt erweitern).
4. **Out-of-Scope-Lock** (Frank §4): FFT (alle Backends), 3D-SPH/Parts, Tessellation/LOD-Grid, SSR/RT, Material-Graph-Editor, bidirektionale Physik↔Render-Kopplung, Layout-Änderung, neue Sampler.

### 7.3 P1 — Arbeitspakete (Entwurf; Owner, Aufwand, Abnahme)

**Block H — Härtung & Wahrheit (Voraussetzung, nichts davon ist optional):** 
- **H1 Testmatrix schließen** (Erin + Charly): `StylizedWaterMother/Lava/Slime` in `ShaderAssembly.test.ts` + `ShaderValidation.test.ts` (mit OpenWater); toter `v_displacementY` entfernen + "Crest Foam"-Label korrigieren; Backend-Drift-Fixture (GLSL100) — Abnahme: 100 % öffentliche Liquid-Materialien in beiden Matrizen, 0 unbenutzte Varyings.
- **H2 Claims-Korrektur** (Alice + Bob + Charly): `liquid-improve.md` §11 ehrlich re-scop (2/6 konform, 1 partiell, 2 abwesend, 1 umfang-reduziert); `[VERIFICATION_PASSED]` an die reale Abdeckung anhängen; ADR 0025/CONTEXT "UniversalFluidMaterial→StylizedWaterMaterial"; "golden-ratio-Spread" implementieren oder streichen; WebGL1-Degradation für den realistischen Tiers in `OpenWaterMaterial.ts` dokumentieren — Abnahme: `grep`-Konsistenz Docs↔Code, keine toten Behauptungen.
- **H3 Lane-Contract-Registry** (Erin + Charly, ADR-0025-Folge): zentrale Abbildung aller repurposed `ObjectUniforms`-Lanes pro styleId; Lint-Test gegen Kollisionen (R7); Posterize-Off-by-one fixen (`NoirWaterMaterial.ts:104`); Noir-Peer-Grade terminal auditieren.
- **H4 Konstanten hart statt Fallen** (Bob + Erin): Caustic-Gain/-Fade, Crest-Thresholds, Spec-Exponent aus Literalen in benannte Per-Style-Konstanten; Wall-/Radial-Smear strukturell entschärfen (`OpenWater.frag.glsl:123`); Regression-Grid pro Backend; **Clear-Water-Floor ≥ 4/5 (GL2/GPU)** als Härte-Schwelle.
- **H5 Perf-Methodik + Budget** (Erin): rAF-p95-Messung statt Wanduhr; Budget im Roadmap-Doc; Zero-Allocation-Assertion auf Liquid-Pack; p95 < 16.6 ms (Mid-Tier) für Liquid-Arbeitspfad.
- **H6 Showcase-Goldens** (Erin): Screenshot-Baseline 10 Pools × top/oblique × GL2/GPU + GL1-Smoke (lädt, 0 Fehler, keine NaN); jede Shader-Änderung erneut; Drift > ±0.25 mit Begründung.

**Block S — Begrenzte, getestete Interaktivität (erst nach H; optional gekürzt wenn Zeit):**
- **S1 Wellen-Sonde CPU ↔ Auftriebswahrheit** (Bob: Math-Mirror + Paritäts-Test; Dave: Ingestion-Vertrag + Integrationstest) — `[OVERLAP: S1: Bob↔Dave — Bob=Height-Math+Parity-Tests, Dave=Buoyancy-Contract+App-Integration]`; Abnahme: Unit-Test "Bob folgt registrierter Höhenfunktion", Probe==Shader-Feld in Toleranz auf GL2/GPU, FluidVolume in ≥1 Showcase verdrahtet + Integrationstest (schließt A6/Alice-G6).
- **S2 Typisiertes SurfaceRippleField (Splat/Interaktion)** (Dave; konsumiert S1): Small-JS-Feld `{pos,time,energy}` pro Wasserfläche (app-owned, keine Singletons), Lieferung über repurposed Lane (1–4 Splats) oder schon gebundene Opak-Farb-Capture (viele Quellen, **auch WebGL1**); ersetzt den rein dekorativen Depth-Gate-Stroke durch echte Quell-Ringe — Abnahme: JS-Test Decay/CFL, Shader-Assembly grün, GL1-Fallback dokumentiert.
- **S3 Analytisches Clapotis an konfigurierten Wänden** (Bob: Vertex-Term; Dave: Wand-Konfig + Abnahme) — `[OVERLAP: S3: Bob↔Dave — Bob=Reflektierter Gerstner-Term im Vertex-Loop, Dave=Wandliste/Akzeptanz]`; reine Vertex-Mathematik, 3-Backend, ~0 Uniform; Abnahme: Shader-Test `D_ref`-Vorzeichenumschlag, Showcase-Wand zeigt Stehwelle. **Explizit nicht:** allgemeine Geometrie-Reflexion.
- **S4 Kelvin-Wake (eine Bewegung)** (Dave, showcase-gated): analytischer 19.47°-Keil getrieben über eine repurposed Lane von einem RigidBody; nur wenn ein Showcase ein bewegtes Objekt enthält; sonst S4 auf "später". Abnahme: Wake nur bei Bewegung (CPU-Test).

### 7.4 Offene Entscheidungen (Runde 2 erwartet Positionen)
- **D1 Reflexionslinie:** "prozedurales skyTint + Refraktion formalisieren" vs "PlanarReflectionNode minimal in OpenWater verdrahten" (M, mittleres Risiko). Default-Vorschlag des Moderators: **parken** (Dokument als getroffene, reversierbare Entscheidung, Entscheidungspunkt hinter D2-Daten). Widerspruch möglich.
- **D2 Kelvin-Wake im Zeitraum:** ja (s.-gated) oder raus?
- **D3 Style-Map-Fragilität (Charly P5):** Float-styleId→expliziter Enum/Switch (3 Backends) im Zeitraum oder später?
- **D4 Live-Tune-Surface (Charly P3):** minimale Debug-Hotkey-Fläche im Showcase (S, kein Engine-UI) im Zeitraum — ja/nein? (größte Künstler-Paritätslücke vs Industrie)
- **D5 S1 (Probe) Pflicht-Block oder optional?** (Frank/Bob: M-Effort, low risk, dient "hart"; Dave: höchste Glaubwürdigkeit/Kosten)

### 7.5 Stabilitäts-Gate (konsolidiert aus Alice G1-G9 + Erin G1-G7, für den Zeitraum)
G1 Testmatrix alle Liquid-Materialien; G2 Backend-Drift-Fixture; G3 Null tote Optionen + Lane-Contract; G4 Claims==Code (kein VERIFICATION ohne file:line + Test); G5 keine Showcase-Regression (Goldens); G6 Physik-Fate entschieden (verdrahtet+getestet ODER offiziell raus); G7 Reflexion entschieden (D1); G8 Perf-Budget messbar; G9 Laufzeitsicherheit fail-fast, keine dead options. — **"Hart & stabil" = G1–G9 grün auf default branch UND keine behauptete-aber-fehlende Funktion offen.**

## 8. Runde 3 — Finaler Plan P2 (Moderator-Amalgamierung der Amendments)

> **[SUPERSEDED: P1]** (Entwurf in §7 wird durch P2 ersetzt; alle Runde-2-Amendments von Alice/Bob/Charly/Dave/Erin/Frank sind eingearbeitet).
> **[CONSENSUS_PROPOSAL: P2]** — Zielbild + Umsetzungsplan für den Zeitraum. Offene Overlaps aufgelöst; Entscheidungen D1–D5 gelockt; Stabilitäts-Gate CI-honest reformuliert.

### 8.1 Zielbild (Phase A, unverhandelbar)
**"Hart & stabil" = Claims==Code, 3-Backend-Parität belegt durch Tests (nicht Behauptung), keine toten Optionen, messbare Qualität (Goldens statt Peer-Grades), begrenzte erwiesene Interaktivität (Objekt reagiert sichtbar).** Jede spätere Glamour-Funktion (FFT/SPH/LOD/Reflexion) ist ausdrücklich außerhalb dieses Zeitraums.

### 8.2 Restrukturierte Blöcke (Abhängigkeiten, keine "optional-wenn-Zeit"-Schwächung)

**Block M — Messtechnik & Baseline (ZUWERST, Substrat für alle ausgabeverändernden Edits):**
- **M1 = H6 Goldens:** Committed-Screenshot-Baseline 10 Pools × (top, oblique) × GL2 + Comparator (Blocking-CI-Job, `pngjs`/`pixelmatch`), pro-Pool-Drift-Schwelle; GPU-Goldens informational; GL1 = Smoke only (lädt, 0 Fehler, kein NaN); jede ausgabeverändernde Shader-Änderung merge-t erst nach "Baseline existiert". (Owners: Erin + Charly + Dave)
- **M2 = H5 Perf-Methodik:** CI = Zero-Allocation-Assertion auf Liquid-Pack + statischer No-per-Frame-Alloc-Guard; **p95 = Dev-Machine-Only** (`scripts/perf-liquid.mjs`, Budget im Roadmap-Doc, informational — kein Merge-Kriterium; swiftshader-flaky). (Owner: Erin)

**Block T — Wahrheit (parallel zu M, kein Gate für S):**
- **T1 = H1 Testmatrix:** `StylizedWaterMaterial`/`Lava`/`Slime` in `ShaderAssembly` + `ShaderValidation` (mit OpenWater); toten Varying `v_displacementY` entfernen (GLSL300-only, 3 Zeilen — verifiziert Charly/Dave; in H2 Begründung festhalten: einziger Stylized-Crest-Foam-Anker, kein Vertex-Hook → bewusst zurückgestellt); "Crest Foam"-Label korrigieren. (Owners: Erin+Charly, v_displacementY: Charly)
- **T2 = H2 Claims-Korrektur (Dokumentation, kein Gate):** `[VERIFIED: datei:zeile; test=ID]`-Marker + Lint (G4); `liquid-improve.md` §11 ehrlich re-scop; `[VERIFICATION_PASSED]` an reale Abdeckung anhängen (2/6 konform, 1 partiell, 2 abwesend, 1 umfang-reduziert); ADR 0025/CONTEXT "UniversalFluidMaterial→StylizedWaterMaterial"; **golden-ratio-Spread STREICHEN** (real 2+1+2+1 dokumentieren); WebGL1-Degradation im Material-Doc festhalten; Deferred/OOS-Etiketten (Clapotis/Wakes=S-verzögert; FFT/SPH/LOD/SSR=OOS) als Gate-Carve-out. (Owners: Alice+Bob+Charly)
- **T3 = H3 Lane-Contract-Registry (HARTES GATE vor Block S):** test-/CI-deklaratives Artefakt **Engine ↔ Extension inkl. Noir/Oil-Lanes** (nicht Engine-Only-Laufzeit); pro-styleId-Lane-Semantik + Write-Order-Safety; Lint gegen Kollisionen; **S2-Splat-Lane und S3-Wall-Contract hier registriert, eviction mit Re-Homing auf Per-Style-Konstante (nie silent delete, G3)**; **Posterize: kein Off-by-one-Fix** — stattdessen Transport- + Level-Count-Test (glsl300/100/wgsl, N Ebenen) + optionale Art-Bucket-Audit (`+0.5`-Topbucket auf hellen Inputs); Noir-Peer-Grade → M1/H6. (Owners: Erin+Charly)
- **T4 = D3-minimal (im Zeitraum, vor S):** Style-Identity-/Registrierungs-Test (Styles 0–5 dispatchen korrekt; `styleId==3.0` ⇒ isExtension) + Lane-Contract-Abgleich; der volle Float-styleId→Enum-Refactor bleibt **zurückgestellt** (nur wenn 6. publizierter Style geplant; Worm: alle neuen Lanes/Meanings gehen durch H3/T3). (Owner: Charly)

**Block H (Shadering-Härtung; erst nach M1-Baseline):**
- **H4 = Konstanten hart:** Caustic-Gain/-Fade, Crest-Thresholds, Spec-Exponent aus Literalen in benannte Per-Style-Konstanten; Wall-/Radial-Smear **rein mathematisch** entschärfen (`OpenWater.frag.glsl:123`), gebunden: keine neuen Sampler/Uniforms; **Exit kein Peer-Grade "≥4/5"** sondern **skriptierter Differential-Grader auf dem M1-Korpus** (Floor-Kontrast-Erhalt, Clip-Fraction ≤, Spec-Lobe-Bound; GL2-blocking, GPU-informational). Hinweis: Murk = Lane-Trade unter 256-B-Constraint — Re-Tuning von `waterAbsorption` muss das Transmittance-Gate erneut passieren. (Owners: Bob+Erin)
- **H5 = Dead-Optionen-Lint (G3/G9):** alle `*MaterialOptions`-Member (Engine + liquid-extras) envumeneriert + "consumed oder legacy-tagged" (F6/F7-Präzedenz als Regel). (Owner: Erin)

**Block S — Begrenzte, getestete Interaktivität (S1+S2 Pflicht; S3 danach; Interaktivität ist NICHT die Cut-Linie):**
- **S1 Wellen-Sonde ↔ Auftriebswahrheit — PFLICHT, KEINE H-Vorbedingung (darf als Erstes, mit Block T interleavt):** TS-Mirror der Chunk-Mathematik **in f32-Semantik** (`Math.fround`/`Float32Array`), Golden-Vector-Regression mit **präzisionsabgeleiteter** Toleranz (nicht t-vs-f32-Handwahl; Ladder-weit inkl. Worst-Case), **G2-Konstantengleichheits-Manifest** auf den gepackten Wave-Lanes (= der echte "same field"-Beweis), Showcase-Integrationstest (Körper reitet die echte Fläche; `BuoyancySolver.ts:76` flat `bounds.max.y` → Probe). **Ownership (Overlap aufgelöst): Bob = Mirror-Math + Paritäts-/Manifest-Tests; Dave = `BuoyancySolver`-Ingestion + Integrationstest; API-Signatur contract-first, in T3 registriert.**
- **S2 SurfaceRippleField — PFLICHT, Gate {T1, T3, M1}:** **genau EIN Lieferkanal** — eine einzig registrierte Splat-Lane (`vec4 = pos.xz + spawnTime + energy`), **max 1 aktive Splat pro Wasserfläche** (Dropper ist sequenziell FALLEN→Impact; `showcase.ts:97-135`), Upload **nur bei Impact, nicht per Frame**; evicted-Feld-Re-Homing per T3; Capture-Textur-Route post-period (Semantik-Kollision mit Refraktion auf `u_opaqueMap` dokumentiert); **Abnahme konkret: der bestehende periodische `SplashDropBehavior`-Impact emittiert eine abklingende Ringwelle via S2-Lane UND die Kiste bobbt danach auf der echten (S1-)Fläche** — das ist der sichtbare Beweis "Objekt reagiert". (Owner: Dave; S1-Konsum: Bob/Dave)
- **S3 Clapotis (nach S2; Gate {T1, T3, M1}) — sauberstes Paket:** reiner Vertex-Term (Spiegelung `D_ref`, ~2A-Amplitudenfalle mit Distanzfalloff), 3-Backend, ~0 Uniform; **Ownership nach Artefakt (Overlap aufgelöst): Bob = Vertex-Konsumption (`OpenWater.vert.{glsl,glsl100,wgsl}` + Lane-Binding + G2/G5); Dave = öffentliche Wall-Config-API (`OpenWaterMaterial.ts`) + Showcase-Wand + Integrationstest; Wall-Format-Contract (Wand-Normale + Halbextent + Amplitude-Trap-Range) in T3 registriert** — kein Materialfile hat zwei Owner. **Abnahme: JS-Mirror-Test (Vorzeichenumschlag + Energie-Trap) + 3-Backend-Assembly-Presence + Showcase-Golden** (Stehwellenknoten ≈ Wand − λ/4); **kein reiner Shader-Text-Assert.**
- **S4 Kelvin-Wake: RAUS (D2=OUT)** — als showcase-gegatetes Zukunftsitem dokumentieren (kein Body durch Wasser im Zeitraum; Dropper reagiert als Impact-Splat S2, nicht Keil; Lane niemandem gehört + RigidBody-Drive fehlt).

### 8.3 Gelockte Entscheidungen (D1–D5)
- **D1 Reflexion = PARK** als schriftliche, ADR-getrackte, reversible Haltung (prozedurales `skyTint` + Screen-Space-Refraktion = offizielle GL1/GL2-Position; Grep-Covenant "kein Wasser-Frag samplet `u_reflectionMap`"), **entkoppelt von D2-Daten**; Re-Open-Gate: realistisches Showcase mit sichtbarer Landschaft + gemessenes Frame-Budget. (OOS-Sampler-Lock: Wiring wäre neue Sampler-Deklaration.)
- **D2 Kelvin-Wake = OUT** (s. 8.2 S4).
- **D3 StyleMap = minimal im Zeitraum (T4)**, voller Enum-Refactor zurückgestellt.
- **D4 Live-Tune = JA, committet, NACH Block H:** Showcase-Only-Debug-Pad (Tastatur-first `[`/`]` Auswahl, Pfeile, `0` Reset-Knob, `shift+0` Reset-Style, `g` Vector-Dump), **eine einzige Vanilla-`StylizedWaterMaterial`-Instanz** (nie Noir/Oil — Lane-Reuse würde Global-Tuner kämpfen), **keine Engine-Edits, kein neuer Lane, keine Persistenz, kein Material-Studio**; reine-TS-Controller-Klasse (Clamp/Step/Reset) unit-getestet; getunter Zustand speist M1-Korpus. (Owner: Charly, Akzeptanz-Bound Charly §6)
- **D5 Sonde = PFLICHT (S1)** — einzige G6-Code-Auflösung; bei unkonstruierbarem ehrlichem f32-Paritätstest: "Probe als Debug-Hilfe neutral" + G6-Rescope, aber S1 bleibt. (Owner: Bob+Dave)

### 8.4 Overlap-Auflösung (kein offener Marker)
- `[OVERLAP S1 Bob↔Dave]` → **aufgelöst** (8.2 S1: Match-Math/Parity vs Ingestion/Integration; Signatur contract-first in T3).
- `[OVERLAP S3 Bob↔Dave]` → **aufgelöst** (8.2 S3: nach Artefakt, Wall-Contract in T3; keine Datei mit 2 Ownern).
- Härtung T1/T3/M1/M2 = dokumentiertes **Shared-Ownership** (Erin Gates-Lead; Charly Stylized; Alice ADR/Coherence) — von allen Betroffenen als geteilt akzeptiert.

### 8.5 Stabilitäts-Gate (final, CI-honest — Erin-Reformulierung)
- **Blocking in CI:** G1 (Matrix-Membership alle Liquid-Materialien, 3 Backends) · G2 (Backend-Drift-/Marker-Manifest; toter-Varying-Assert; fwidth/texIndex-Scan) · G3 (Dead-Option-Lint + Lane-Contract-Registry als Testartefakte) · G4 (`[VERIFIED: datei:zeile; test=]`-Lint) · G5-GL2 (Golden-Comparator, blocking gemäß M1) · G6 (Physik-Fate: via S1 Integrationstest; sonst Export-Removal/ADR+GreP) · G7 (D1-Grep-Covenant) · G8-CI (Zero-Alloc-Assertion Liquid-Pack).
- **Informational/recorded (nicht merge-blockend):** G5-GPU-Goldens (swiftshader-flaky), G8-p95 dev-machine-Budget, GL1-Smoke, visuelle Grades (nur Kalibrierung).
- **Gate-Satz:** *"Hart & stabil" = alle Blocking-Gates grün in CI, Informations-Messungen recorded + budgetiert, und keine behauptete-aber-fehlende Funktion offen — mit explizitem Carve-out (Clapotis/Wakes = S-verzögert; FFT/SPH/LOD/SSR = OOS).*

### 8.6 Evidence-Infrastruktur (wiederhergestellt als Owned-Deliverables — Frank A4)
- **ADR 0013-Verdikt-Update = Owned-Work-Package** mit Abnahme (Layout bleibt 256 B; Stake für Parameter-Surfaces/LOD und S2-Re-Homing dokumentieren) — Owner Alice.
- **Wellen-Datenmodell (Probe + Interaktionskanal) = dokumentierte kanonische Form** als Deliverable (nicht nur Code), Owner Bob+Dave, akzeptiert in T3/S1/S2.

### 8.7 Out-of-Scope-Lock (Frank §4, unverändert verbindlich)
FFT (alle Backends) · 3D-SPH/Particles · Tessellation/LOD-Grid · SSR/RT · Material-Graph-Editor · bidirektionale Physik↔Render-Kopplung · neues Layout/Sampler (256-B-Prinzip) · neue Sampler-Technungen · Kelvin-Wake (D2). — Jede Abweichung muss Erins Gates passieren und die Frage überleben: "überlebt das ohne Compute-Tier/Layout-Änderung?"

### 8.8 Reihenfolge (Executive)
1. M1 (Goldens+Comparator) + M2 (Perf-Harness) → 2. T1/T2/T3/T4 (Wahrheit + Registry + D3-min + Dead-Option-LLint) → 3. S1 (Sonde, darf mit T interleaven) → 4. H4 (Shadering-Härtung, auf M1) → 5. S2 (Splat; Gate T1/T3/M1) → 6. D4 Live-Tune-Pad → 7. S3 (Clapotis) → 8. Evidence-Deliverables (ADR-0013, Wellen-Datenmodell) → Abnahme per G1–G8.

---

---

## 9. Ergebnis — 2026-10-05
- **Outcome:** CONSENSUS (einstimmig 6/6, Modus `plan`)
- **Vorschlag:** `[CONSENSUS_PROPOSAL: P2]` (§8) — ersetzt `[SUPERSEDED: P1]` (§7)
- **Entscheidung:** Verbindlicher Umsetzungsplan für ein **stabiles, hartes, wirklich gutes Flüssigkeitensystem** für den Zeitraum. Kern: Messtechnik/Baseline zuerst (M1 Goldens+blocking Comparator, M2 Perf), Wahrheits-Block (T1 Testmatrix, T2 Claims=Code mit `[VERIFIED]`-Markern, T3 Lane-Contract-Registry als hartes Gate, T4 D3-min style-identity), Shader-Härtung auf Baseline (H4 Konstanten mit skriptiertem Differential-Grader, H5 Dead-Option-Lint), dann begrenzte, getestete Interaktivität — S1 Sonde↔Auftrieb **Pflicht & ohne H-Vorbedingung**, S2 Splat-Ring via **einer** registrierten Lane (SplashDrop-Impact → abklingende Ringwelle + Kiste bobbt auf echter Fläche), S3 analytisches Clapotis (Ownership nach Artefakt). Entscheidungen D1–D5 gelockt (D1 Reflexion=park, D2 Kelvin=OUT, D3 minimal, D4 Live-Tune nach Block H, D5 Sonde=Pflicht). Gate: Blocking-G1–G8 in CI; Informations-Messungen recorded; Carve-out für S-verzögert/OOS.
- **Begründung:** 12 Runden-1-/Runden-2-Blätter (evidenzbasiert gegen HEAD), harter Branchenvergleich (Godot/Unreal/Unity/Three.js), Inventar & Verifikation von Claims==Code (2/6 "VERIFIED"-Ziele aus `liquid-improve` hatten 0 Code). [MEASURED] Konvergenz aller 6 Agenten auf "Härten vor Glanz; Claims==Code; begrenzte Interaktivität; FFT/SPH/LOD/Reflexion sind Research-Horizont".
- **Verworfene Alternativen & warum:** P1-Entwurf (Peer-Grade "Clear ≥4/5" → skriptierter Differential-Grader; "optional wenn Zeit"-S-Block → Per-Item-Gates; doppelter S2-Kanal → eine registrierte Splat-Lane; "Posterize-Off-by-one-Fix" → misdiagnostiziert, korrekt: Level-Count-Test, `−1` bleibt); Parallel-"Wasser-Pass"-Neuarchitektur & node-graph-Material-Editor (OOS: Hochaufwand, keine Datenlage); Shader-Graph-Editor (OOS-Lock).
- **Minderheitsvoten / Restzweifel (je Agent, aus Unterschrift P2 — Blätter Runde 3):**
  - Alice: T3/M1 müssen vor jedem S/H-Shader-Edit landen, sonst bricht "gemessen, nicht behauptet" wieder.
  - Bob: H4-Grader-Schwellen brauchen einmalige menschliche Kalibrierung, bevor sie CI-blocking werden.
  - Charly: Einhaltung des D4-Fences (eine Vanilla-Instanz; kein Material-Studio) ist die Restbedingung.
  - Dave: T3-Re-Homing-Stresstest ist der erste echte Test der Registry — auditable/reversibel.
  - Erin: GL2-Golden-Comparator + H4-Grader dürfen nicht auf "informational" herabgestuft werden (sonst Rückfall auf `[OBJECTION]`).
  - Frank: "Hart & stabil" hängt jetzt an CI-/Test-Disziplin (M1-Baseline, T3-Lint, S1-f32-Manifest) — aus Diff/CI/ADR-Trail verifizierbar.
- **Ungeprüfte Annahmen:** Paritäts-Toleranzwerte (f32) werden bei S1-Implementierung präzisionszabgeleitet, nicht a priori fixiert; WebGL1-Verhalten unter dem f32-Mirror bleibt dokumentiert-degradiert. [ASSUMED]
- **Wertungen (tragend):** Stabilität/Härte > neue Glamour-Features; messbare Aussagen > Peer-Grades; Interaktivität (Objekt reagiert sichtbar) ist der wertvollste Perceived-Quality-Hebel im Budget (Crest-Beleg: Interaktion entkoppelt vom Wellen-Backend). [JUDGMENT]
- **Revisionsbedingungen (Rückzugsbedingungen der Unterzeichner, verdichtet):** erneut entscheiden, wenn (a) der GL2-Golden-Comparator oder der H4-Grader de-blockt wird, (b) neue Uniform-Bytes/Sampler/Compute ohne ADR-0013-lite-Begründung einlaufen, (c) S2 mit zwei Kanälen oder unregistrierter Lane, (d) S1-Status ("Pflicht") verwässert oder f32-Test unehrlich wird, (e) T3-Lane-Manifest/Lint dilutiert wird.
- **Verlauf:** Runde 3 von 9, Teilnehmer: Alice (lead/arch), Bob (advocate realism), Charly (advocate stylized/workflow), Dave (advocate interactivity), Erin (red-team quality), Frank (advocate horizon). Unterschriften: 6/6.

**Status:** Session im Modus `plan` hat Konsens erreicht und wechselt in die **Umsetzungs- & QA-Phase** (Implementation gemäß §8, Verifikation nach `implementation-phase.md`). Moderator-Abschluss via `--stop` bei Abnahme G1–G8.

---

## 10. T2 Claims-Korrektur — Ausführung (2026-10-06)

Dokumentationspass per §8.2 T2 ("Claims-Korrektur, kein CI-Gate"). Der konsensierte P2-Plan (§8) bleibt kanonisch und unverändert; nur oben Genanntes wurde angefasst:

- **G4-Marker-Lint (`scripts/check-verified-markers.js`)** — neues Werkzeug, Doku im Abschlussbericht des T2-Streams, kein README (Fremd-Stream).
- **`[VERIFIED: <rel-path>:<line>; test=<id>]`-Marker** ergänzt an faktisch verifizierten Aussagen (Inventory §2(a)/(b)/(e)/§6, Roadmap §2) — prüfbar gegen HEAD, Exit 0 auf Stand dieses Passes.
- **„golden ratio directional spread" gestrichen** — reale Komposition `2+1+2+1` (2 dominant, 1 geschaltete Schwelle, 2 senkrechte Detail-Wellen, 1 60°-Kreuzdünung), verankert auf `OpenWater.vert.glsl`/`.glsl100`/`.wgsl`; Korrektur neutral im State-Abschnitt §2. Kein Doc behauptet mehr „golden ratio".
- **Verifikations-Bilanz** aus den 6 Zielen des entfernten `liquid-improve.md` §11: `[COVERAGE: 2/6 conform, 1 partial, 2 absent, 1 scope-reduced]` — als gesonderte, unverkennbare Ergänzung (T2-Deckmantel „Claims-Disziplin"), korrigiert die History-Labels F24/F28 nicht.
- **Nomenklatur** `UniversalFluidMaterial → StylizedWaterMaterial` in `CONTEXT.md` und `docs/adr/0025-…md` (im Code existiert nur `StylizedWaterMaterial`).
- **WebGL1-Degradation** (Fresnel-Approximation statt Depth-Capture → Shore-Foam u. Crest-Foam verhalten sich top-down degradiert) im Material-Doc `docs/research/stylized-water/README.md` als technische Notiz festgehalten.
- **Deferred/OOS-Etiketten** im State-Abschnitt §2: Clapotis & Obstacle-Wakes = `S-deferred (Block S)`, FFT/SPH/Tessellation/LOD/SSR/Screen-Space-Reflexion = `OOS (Research-Horizont)`.

---

## 11. Ergänzung nach Review (2026-10-07) — Licht-/Schattenkopplung und Korrekturen

Anlass: Review der S1-Umsetzung, der Golden-Drift und der Showcase-10-Lichtarbeit (`lighting_and_shadow_comparison.md`). §8 bleibt kanonisch; dieser Abschnitt ergänzt, ersetzt nichts.

### 11.1 Block L — Kopplung der Flüssigkeiten an die Szenenbeleuchtung (bisher nicht im Plan)

Die Roadmap behandelte Wellen, Schaum und Interaktion, aber nicht, wie Flüssigkeiten Licht und Schatten empfangen und weitergeben. Ergebnis der Lichtarbeit: Das war der größte sichtbare Mangel in Showcase 10 (Boden unlesbar, keine Schlagschatten).

- **L1 Lit-Receiver — ERLEDIGT:** `WorldMaterial` war unlit und konnte nie Schatten zeigen; jetzt beleuchtet (3 Backends) und `shadowResolution` 2048 im Showcase. Nachweis: Schlagschatten am Beckenboden in Pool 1 (WebGPU + WebGL2).
- **L2 Oberflächenschatten Lava/Slime/Öl — ERLEDIGT, Effekt klein:** neuer Chunk `DIR_SHADOW` / `WGSL_DIR_SHADOW` (`sampleDirShadow`), eingebunden in `FluidSurface` und `OilSlickMaterial`. Physikalisch nur schmale Sicheln, weil die Objekte fast auf Oberflächenhöhe liegen.
- **L3 Oberflächenschatten Wasser-Pools, Dredge, Noir — OFFEN:** `StylizedWater`/`OpenWater` empfangen selbst keinen Schatten. Abnahme: Chunk eingebunden, 3 Backends, Golden-Zelle zeigt den Schatten.
- **L4 Echtes Caustic-Masking — OFFEN:** Der heutige `shadowMask` ist ein Luminanz-Proxy, keine Shadow-Map-Abfrage; WebGL1-Varianten fehlen. Abnahme: Maske aus dem Schattenfaktor am Boden, Test pro Backend.
- **L5 Schattenlogik konsolidieren — OFFEN:** `DIR_SHADOW` ist die dritte Kopie neben `light_calc`/`light_calc_pbr` (GLSL) und `lighting`/`lighting_pbr` (WGSL). Zusammenführen als eigener Refactor mit Golden-Schutz, weil alle lit Materialien betroffen sind.
- **L6 Schatten-Defaults — OFFEN:** Der Engine-Default `shadowResolution` 512 ist für Szenen wie Showcase 10 zu grob (WebGL2: 256 px pro Cascade). Entscheiden, ob Default oder Dokumentation.

### 11.2 Korrekturen an M1 (Goldens)

- Die Baseline vom 6.10. zeigt die Szene vor dem Showcase-10-Umbau. **Belegt (2026-10-07):** Der Baseline-Commit `9223d305` mit der heutigen Pipeline (Chrome for Testing 152, SwiftShader) gerendert ist für `clear-water` top und oblique byte-identisch zur Baseline. Die Drift der 20 Zellen ist Inhalt, nicht Browser. Das Capture-Skript nutzt den Puppeteer-Chrome, nicht das installierte Chrome 154/155.
- **Policy (umgesetzt):** `summary.json` speichert die Browser-Version, `compare` warnt bei Abweichung, das Zuordnungsverfahren steht in `scripts/goldens/README.md`. Eine Baseline-Neuaufnahme geschieht nur nach Zuordnung der Drift und nach Review der Bilder; ein Merge, der Bilder absichtlich ändert, nimmt die Baseline im selben Commit neu auf.
- Der blockierende GL2-Job vergleicht eine CI-Umgebung mit einer lokal aufgenommenen Baseline. Ob das plattformübergreifend stabil ist, ist unbelegt und muss geprüft werden, bevor der Job als verlässliches Gate gilt.

### 11.3 Korrekturen an S1 (Abnahme präzisiert)

- **Same-Field-Beweis:** Konstantengleichheit allein genügt nicht. Zusätzlich ein Vergleich der Probe mit der echten Shader-Ausgabe auf GL2 (Readback) oder der D5-Fallback.
- **Toleranz:** pro Vektor aus Wellenamplitude und Phasengröße herleiten, nicht ein globaler Worst-Case (der heutige Wert von 7,28 m ist größer als das Zehnfache der maximalen Wellenhöhe der realistischen Fixtures).
- **Position:** Die Höhe gilt über dem Weltpunkt, nicht über der Ruheposition des Vertex; Gerstner verschiebt horizontal, also die Ruheposition bestimmen (umgesetzt mit Newton statt Fixpunkt-Iteration, siehe §17.2 Punkt 2).
- **Integration:** `FluidVolume` ist seit 2026-10-07 in Showcase 10 verdrahtet (Pools `wave-rider` und `dead-sea`, `surfaceHeightAt` aus der Probe). Damit ist die Abnahme „in mindestens einem Showcase verdrahtet" erfüllt. Offen bleiben ein automatischer Integrationstest auf Showcase-Ebene und die Frage, ob G6 damit als erledigt gilt.
- **Emissionen:** Backlog-Eintrag am 2026-10-07 angelegt; D5 steht als Entscheidung in §8.3, ein eigenes ADR ist nicht nötig (reversibel, kein harter Bindungseffekt).


---

## 12. Industrie-Vergleich (konsolidiert aus allen Blättern)

> **Belegqualität:** Die Spalte *Small World Machine* ist im Repo belegt (`[VERIFIED]` mit Datei und Zeile, siehe §13 und §16). Die Aussagen zu Godot, Unreal, Unity/Crest und Three.js stammen aus dem Fachwissen der Agenten und sind **nicht** gegen Dokumentation geprüft (`[JUDGMENT]`). Sie taugen als Richtungsurteil, nicht als Zitat. Zeilenanker in `apps/showcases/10/showcase.ts` sind seit dem Umbau vom 2026-10-07 veraltet.

### 12.1 Vergleichstabelle

| Achse | Godot | Unreal | Unity (Crest) | Three.js | Small World Machine (Ist) | Urteil |
|---|---|---|---|---|---|---|
| **Wasser als Subsystem** | Kein First-Party-Wasser, kein Pass; `ShaderMaterial` plus Community; Reflexion und Refraktion per `SubViewport`/`BackBufferCopy` selbst gebaut | Water-Plugin: `UWaterBody` erzeugt eigene Quad-Gitter, eigenes Wasser-Shading-Model, Buoyancy-Splatmaps, eigene Reflexionsbehandlung | HDRP Water System als eine PBR-Wasserpipeline mit Buoyancy-Hooks; URP nur Shader Graph und Community | Kein Wasser im Core; `Water.js`/`Ocean.js` sind Demos; keine erzwungene Erweiterungsgrenze | Zwei Familien: `LiquidWaveMaterial` → OpenWater/StylizedWater, `FluidSurfaceMaterial` → Lava/Slime; zwei Hook-Tokens (ADR 0025); kein Wasser-Pass, keine erzeugte Geometrie | Struktur gut, Wasser-Schicht (Pass, Geometrie, Physik) fehlt |
| **Wellenmodell** | Community-Gerstner; kein offizieller Ozean | Mehrere Oktaven Gerstner mit Layered Normals; FFT über Drittanbieter | HDRP Spektral/Gerstner-Hybrid; Crest GPU-Compute-Kaskaden | `OceanShaderMesh` mit echtem Tessendorf-FFT (JONSWAP, Ping-Pong, Jacobi); `Water.js` Plane mit Normalmaps | 6 analytische Gerstner-Terme, Tiefwasser-Dispersion `ω = √(g·k)`, Komposition 2+1+2+1; räumlich uniform, kein Spektrum | Mathematik korrekt, Detail und Spektrum fehlen |
| **Geometrie, Tessellation, LOD** | keine | Tessellierte Wassermeshes mit LOD | Water Grid, Crest lod0-Tiles | FFT-Ozean-Mesh, `Water.js`-Plane | Keine; Flächen sind segmentierte `Plane` (32×32 in Showcase 10), Wellentreue hängt an der Segmentzahl der App | fehlt |
| **Schaum** | nicht behandelt | GBuffer-Schaum-Interaktion | Jacobi-Kamm, advektierte Schaum-Targets | Jacobi pro Frame im FFT-Ozean | OpenWater: analytischer Jacobi-Kamm `J = t.x·b.z − t.z·b.x`, 0 Uniform-Kosten, 3 Backends; StylizedWater: nur Uferschaum, kein Kamm; kein transportierter Schaum | gut (OpenWater), fehlt (Stylized, Advektion) |
| **Brechung, Reflexion** | selbst gebaut | eigene Reflexion, Single Layer Water | eigene Tiefen- und Reflexions-Features | Planar-Mirror oder `CubeCamera` | Brechung: Screen-Space aus Opaque-Color und -Depth. Reflexion: nur prozeduraler `skyTint`; `PlanarReflectionNode` existiert, wird von keinem Wasser-Shader gesampelt | Brechung gut, Reflexion fehlt (D1 = geparkt) |
| **Absorption, Streuung** | nicht behandelt | nicht behandelt | nicht behandelt | nicht behandelt | Beer-Lambert pro Kanal mit In-Scatter-Boden; Koeffizienten liegen auf zweckentfremdeten Uniform-Lanes; kein SSS | gut (Absorption), SSS fehlt |
| **Kaustiken** | nicht behandelt | nicht behandelt | nicht behandelt | nicht behandelt | OpenWater: geglättetes Worley-Doppelprodukt, per Sonnenstrahl auf den Boden projiziert (kein F1-SmoothF1); StylizedWater: F1−SmoothF1-Linien. Gain und Fade bereits nach dem Fix (0,1 und `exp(−0,7)`) | teilweise (Konstanten-Falle) |
| **Stylized, Toon, Presets** | Community-Ports von Toon-Tutorials | Water-Plugin plus Unlit/WPO | Shader Graph, lilToon/UTS-Ramps | Community, keine Engine-Lösung | `StylizedWaterMaterial` mit `STYLE_PRESETS` (toon, bold, soft, sparkle, dredge): neuer Look = Tabellenzeile plus `styleId`, kein Shader-Edit; Extensions Noir und Oil per Hook | gut auf WebGL2/WebGPU, teilweise auf WebGL1 |
| **Material-Graph, Hooks, Live-Tuning** | eingebetteter Shader-Editor | Node-Material-Graph (Standard), Instant Preview | Shader Graph, Sub-Graphs, Custom-Function-Nodes (≈ unsere Hooks) | Kein Editor, TSL im Code | Zwei Fragment-Hooks in Produktion (Noir, Oil); keine Vertex-, Mesh- oder Pass-Hooks; kein Graph; **kein Live-Tuning** (größte Paritätslücke des Scopes) | Hook-Modell gut, Tuning-Oberfläche fehlt |
| **Interaktion, Wakes, Ripples** | keine | Niagara `WaterInteraction`, GBuffer-Interaktion | Crest: Collider-Wakes, Kelvin-Wake, Interaktionsmasken | Heightfield-Splats über Ping-Pong-FBOs | Keine Wakes, keine Kontaktrippeln, kein Clapotis; nur dekorative, tiefen-gegatete Uferstriche in StylizedWater | fehlt |
| **Auftrieb, Physik** | Rigid-Body-Buoyancy ohne Wellenrückkopplung | `BuoyancyComponent`, Buoyancy als Engine-Service, „Water Info" | Crest: Wave-Collider, Surface-Query | keine | `FluidVolume` plus `BuoyancySolver` (Archimedes). **Seit 2026-10-07 reitet die echte Wellenfläche** über `surfaceHeightAt` aus der Probe (Showcase 10: Wave Rider, Dead Sea); nur Hub, kein Nicken oder Rollen | teilweise (Heave ja, Rotation nein) |
| **Strömung** | nicht behandelt | nicht behandelt | nicht behandelt | nicht behandelt | `FluidVolume.currentVelocity` nur als Physik-Datenfeld, keine Render-Kopplung | teilweise |
| **Compute, Heightfield** | nicht behandelt | Niagara Fluids, ZibraAI | Crest compute-first | Float-FBO-Ping-Pong, WebGL2 | Compute nur im WebGPU-Backend (Cluster-Cull, HZB, AO); kein Compute in GL; Half-Float-FBO in GL gated vorhanden | fehlt, bewusst Out-of-Scope |
| **Backend-Strategie, Browser** | Web-Export, WebGPU experimentell | nicht browser-nativ | Crest degradiert ohne Compute | FFT nur auf WebGL2/WebGPU portierbar | Drei Backends (GLSL100/300/WGSL) Pflicht; WebGL1 ohne Depth-Capture, Fresnel-Proxy als Ersatz, durchgängig ≈ 1 Stufe schlechter | Parität gut, WebGL1 degradiert |
| **Performance** | — | LOD und Niagara skalieren | Crest: Compute-Kaskaden-LOD | FFT-Auflösung auf GL1 senken | Kein Budget gemessen; ein transparenter Draw plus Capture-Reads; nur CPU-Submit-Wanduhr (10,7 / 5,3 / 1,5 ms für WebGL2 / WebGL1 / WebGPU, selbst als unzuverlässig deklariert) | fehlt (Messung, Budget M2 offen) |
| **QA: Validierung, Parität, visuelle Regression** | Shader wird beim Import kompiliert, Fehler vor jedem Render | Jedes Material gegen die Plattformmatrix validiert, Warnungen bei Mismatch | Validation-Matrix je Unity- und Pipeline-Version, Sample-Szenen als ausführbare QA | Laufzeit-Compile, keine Per-Material-Validierung | `ShaderValidation` deckt FluidSurface und seit Kurzem die Stylized-Familie ab, `ShaderAssembly` noch nicht; Lane-Contract-Scan und Golden-Infrastruktur (M1) vorhanden; Baseline veraltet | teilweise, Lücken schließen sich |

### 12.2 Verdikte pro Engine (was übernehmen, was nicht)

- **Godot:** strukturell der nächste Analog. Wir sind bereits darüber (Presets, Hooks, drei Backends). Nichts zu importieren.
- **Unreal:** zwei Lektionen übernehmen: Wasserkörper und Tooling vom Look trennen, Buoyancy als First-Class-Service (das ist mit S1 und den Buoyancy-Pools angelaufen). **Nicht** kopieren: Node-Material-Graph, Wasserkörper-Mesh-Pipeline, Niagara-Partikelwasser.
- **Unity (Crest):** die Interaktionsmathematik (Wave-Collider → Wake, Surface-Query) ist die am besten adoptierbare Idee und mit Gerstner kompatibel. Crests *Architektur* (Compute-Kaskaden, Kaskaden-LOD) ist Overkill und scheitert an WebGL1. Jacobi-Schaum haben wir bereits.
- **Three.js:** Anti-Benchmark, wir sind architektonisch sauberer. FFT ist auf WebGL2/WebGPU portierbar, auf GLSL100 nicht (kollidiert mit der Paritätspflicht), also höchstens als WebGL2/WebGPU-Tier. Der `onBeforeCompile`-Hook ist das Gegenstück zu unserem Token-Mechanismus.
- **QA-Muster aus der Industrie (übertragbar):** Shader-Compile als Import- und CI-Schritt; Plattformmatrix als ausgeliefertes, getestetes Artefakt; Capability-Fallback (WebGL1-Smoke) in CI *ausführen* statt nur dokumentieren; Quality-Gating teurer Effekte mit expliziten Defaults; fail-fast bei Konstruktion (Warnung statt stillem No-Op, Lehre aus F7); kleine Screenshot-Golden-Suite statt Peer-Grades.
- **Was bewusst nicht kopiert wird:** Node-Graph-Editor (Editor, Serialisierung und JIT-Gewicht absurd für eine 256-Byte-Prozedurfläche), Unreal-Wasserkörper-Mesh-Pipeline, Unity-VFX-Graph-Splash-Komplexität, GPU-Compute-Kaskaden, Terrain-Tessellation-LOD und SPH (Research-Horizont, §14).

---

## 13. Zustandsbild im Detail (Inventar, Qualität, Red-Team)

Legende: **V** verifiziert vorhanden, **T** teilweise, **F** behauptet aber fehlend. Pfade relativ zu `packages/engine/src/core/materials/` (`M/`) und `.../materials/shaders/` (`S/`). Der Stand ist der des Inventars vom 2026-10-05; was sich seither geändert hat, steht in §17.1.

### 13.1 Komponenten

| Komponente | Zustand | Beleg und Anmerkung |
|---|---|---|
| `LiquidWaveMaterial` (194 Z., abstrakt), `OpenWaterMaterial` (96), `StylizedWaterMaterial` (308) | V | Wellen-Familie; öffentlich exportiert (`packages/engine/src/index.ts:14-17`), genutzt in Showcases 10 und 31, `yad`, `the-whisper` |
| `FluidSurfaceMaterial` (284), `LavaMaterial` (60), `SlimeMaterial` (60) | V (Preset), T (Physik) | Fluss-Familie. Lava und Slime haben keine eigenen Shader-Dateien, kompilieren aber unter eigenen Typ-IDs (`FluidSurfaceMaterial.ts:125-132`) |
| `UniversalFluidMaterial` | F | existierte nie; in T2 aus ADR 0025 und `CONTEXT.md` auf `StylizedWaterMaterial` korrigiert |
| Shader-Satz GLSL300/GLSL100/WGSL | V | 3 × 6 Dateien (FluidSurface, OpenWater, StylizedWater) plus 10 `liquid_*`-Chunks (`S/chunks/`); GLSL100 nutzt die ES-1.00-kompatiblen `.glsl`-Chunks, handgepflegt, ohne Drift-Test |
| Chunk-Mechanismus | V | `ShaderRegistry.registerChunk` (`:101`), Token-Ersetzung `:134-146`; Registrierungen in `CoreShaderChunks.ts` |
| Erweiterungs-Hooks `[WATER_EXT_DECL]` / `[WATER_EXT_SURFACE]` | V, in Produktion | `StylizedWaterMaterial.ts:17-40`; Noir und Oil in `packages/liquid-extras`; genau zwei Hooks (die fünf `#SW_INJECT_*` wurden nie gebaut, ADR 0025 versprach sie nie) |
| OpenWater 6-Wellen-Kaskade und Dispersion | V | `S/OpenWater.vert.glsl:91-107`, `.glsl100:29-45`, `.wgsl:21-38`; `chunks/liquid_gerstner_wave.glsl:10` |
| „Golden ratio directional spread" | F, gestrichen | 0 Treffer; reale Komposition 2 dominant (w1, w2) + 1 geschaltete Schwelle (w3) + 2 senkrechte Detailwellen (w4, w5) + 1 60°-Kreuzdünung (w6) |
| Jacobi-Kamm-Schaum | V (nur OpenWater) | `S/OpenWater.vert.glsl:113-119`, Konsum `frag.glsl:113-115`; in StylizedWater fehlt er |
| `v_displacementY` (toter Varying), Label „Crest Foam" | F | Label und Varying behaupteten Kammschaum, den StylizedWater nie hatte; beides ist inzwischen bereinigt (Varying entfernt, Label „Crest Foam" ohne Treffer, T1) |
| Kontaktrippeln, Wakes, Clapotis | F | 0 Treffer; nur dekorative Uferstriche (`StylizedWater.frag.glsl:75,183-199`, tiefen-gegatet, nur WebGL2/WebGPU) |
| Opaque-Capture und Screen-Space-Refraktion | V | `renderers/passes/MainRenderPass.ts:72-113`; Bindung `WebGL2Renderer.ts:1310-1312`, `WebGPURenderer.ts:1861-1868` |
| Wasser-spezifischer Render-Pass | F | Liquids laufen im generischen Transparent-Pass nach der Opaque-Capture |
| `PlanarReflectionNode` | V, nicht verdrahtet | kein Wasser-Fragment sampelt `u_reflectionMap`; „Reflexion" ist `skyTint` (`OpenWater.frag.glsl:85`) |
| Tessellation, LOD, Fluid-Geometrie | F | `geometry/` ohne Wasser-Generator; Flächen sind segmentierte `Plane` |
| Lava- und Slime-„Physik" (Bingham, Voronoi F2−F1, Planck, Stokes, Blasenkinetik) | F | vereinfachte Noise-Flow-Looks; bei Slime nur Beer-Lambert (`FluidSurface.frag.glsl:95-97`) |
| `FluidVolume` (29 Z.), `BuoyancySolver` (129 Z.) | V (Stand 05.10. Stub) | reiner Datencontainer und Archimedes gegen flache AABB-Oberkante; nicht verdrahtet. Heute: siehe §17.1 |
| Uniform-Layout | V, voll | `ObjectUniforms` = 64 Floats = 256 Byte (`structs.wgsl:34-58`, `u_styleA` bei Float 56, `u_styleB` bei 60); Ring-Buffer-Stride 256 (`GPUObjectRingBuffer.ts:36-39`); „zero spare float slots" (`LiquidWaveMaterial.ts:41-43`); frei sind nur noch `u_pad3` und `u_specColor` |
| Sampler-Budget | V | 16 Sampler erzwungen (`ShaderValidation.test.ts`); ein neuer Interaktions-Sampler müsste einen vorhandenen verdrängen |
| WebGL1-Tiefenlücke | V, dokumentiert | `WebGL1Renderer.ts:688-690` (Far-Depth-Default); Ersatz durch Fresnel-Proxy (`StylizedWater.frag.glsl100:101-107`, `OpenWater.frag.glsl100:32-64`); Opaque-Capture auf GL1 farbgebunden und NEAREST-gefiltert (`:666-667`, `:973`) |
| WGSL-Crest-Transport | V, fragil | Kammwert in `Out.original_uv.x`, Warnung vor `texIndex` (`OpenWater.vert.wgsl:44-52`), kein Regressionsschutz |
| Testlage (Stand 05.10.) | T | 25 Engine-Tests (StylizedWater 6, FluidSurface 3, OpenWater 10, FluidVolume 3, BuoyancySolver 3) plus 11 Extension-Tests (Noir 5, Oil 6); `ShaderAssembly` nur FluidSurface und OpenWater, `ShaderValidation` nur FluidSurface; keine Tests an der Physik-Render-Naht |
| TODO/FIXME in Materialien | — | 0 Treffer bei etwa 8 offenen Defekten: offene Mängel wurden still getragen |

### 13.2 Fortschritts-Fazit

Es gab **echten, substanziellen Fortschritt**: die Zwei-Familien-Architektur, die Drei-Backend-Parität, Chunks und Hooks, das Erweiterungspaket in Produktion, erste Physik-Bausteine und gemessene Qualitätsarbeit mit vielen behobenen Defekten. Aber die Dokumentation überzeichnete mehrere „fertige" Features. Von den sechs Zielen des früheren `liquid-improve`-Abschnitts waren zwei konform, eines teilweise, zwei hatten null Code (Clapotis, Wakes) und eines war im Umfang reduziert (`[COVERAGE: 2/6 conform, 1 partial, 2 absent, 1 scope-reduced]`). Das Urteil von Erin und Bob in einem Satz: **Die Architektur ist der Physik voraus und der eigenen Dokumentation weit hinterher.**

### 13.3 Gemessene Qualität pro Pool (Peer-Grades 1 bis 5, aus `showcase10-quality` und `fixes2`)

Peer-Grades sind Einschätzungen anhand von Screenshots, keine objektiven Metriken. Sie dienen nur der Kalibrierung (siehe H4 und M1).

| Pool | WebGL2/WebGPU | WebGL1 | Seither behoben | Noch offen |
|---|---|---|---|---|
| Clear (OpenWater) | 3 bis 3,5 (vor dem Fix 1/5) | ≈ 2 bis 2,5 | Kamm-Schaum-Klumpen, GL1-Spec-Lobe, Caustic-Blowout (Gain 0,4 → 0,1, Fade `exp(−0,35)` → `exp(−0,7)` mit `smoothstep(0,05; 0,4; depthDiff)`) | teal Murk, Boden-Kacheln unlesbar; GL1-Weißfleck bei Streiflicht; Wand-Schaum-Klumpen |
| Stylized-Ladder (toon, bold, soft, sparkle, dredge) | 3,5 bis 4 (toon, bold, soft 3,5; sparkle 4; dredge 3,5) | ≈ 2,5 bis 3 (Toon ≈ 3, Dredge ≈ 2,5) | Ripple-Bänder, Caustic-Blobs, White-out, GL1-Edge-Clamp 0,3, Spec × 0,5, Sparkle-Entsättigung | GL1-Dunst bei Streiflicht; soft und sparkle auf WebGPU im Rim grenzwertig hell; Art-Direction-Zweifel „soft liest sich ruhig/painterly" |
| Lava | 4 | 4 | Farbton, Emissive 2,4 | WebGPU-Crust-Striping (nie geschlossen) |
| Slime | 3,5 (WebGPU **2,5**) | 3,5 | Bubble-Dunkelringe, WebGPU-Blowout | WebGPU im Nahbereich; Bubble-Tiling-Patch |
| Noir (Extension) | 2,5 bis 3 | ähnlich | Hatch-Chaos, Schwarz-Boden, Rim-Schaum | terminaler Grade nie von einem Peer bestätigt |
| Oil (Extension) | 4 | 4 | Aufhellung versunkener Objekte, Absorption 1,8/1,5/1,2, Regenbogen an Fresnel und Sonne gekoppelt | große, unscharfe Regenbogen-Blobs; Floater auf WebGPU und WebGL1 nochmals prüfen |
| Galerie/Überblick | 2,5 → 4 | lädt ohne Konsolenfehler | Kamera, Himmel, Schilder, Untertitel | Lesbarkeit der Schilder der ersten Reihe am Start |

**Urteil:** Nichts liegt bei 5/5. Clear Water war der schlimmste Fall (Ursache Caustic-Gain bis ≈ 1,28 über tiefem Blau, geteilte Noise-Skala mit Schaum und Projektion über `groundWorldPos = v_worldPos + rayDir·depthDiff` an Wänden; das widerlegte auch die frühere Changelog-Aussage „procedural caustics only at intersections"). Der realistische Pfad ist eine Handvoll hartkodierter Konstanten-Fallen mit belegter Blowout-Historie, stabil nur unter den Post-Fix-Werten und nur auf WebGL2/WebGPU. Der weiße Sonnen-Spekularfleck (`pow(nDotH, 1200)·0,8`, `OpenWater.frag.glsl:91`) ist nicht durch Konstanten allein lösbar. WebGL1 liegt durchgängig mindestens eine Stufe darunter und ist am wenigsten getestet.

### 13.4 Red-Team-Befunde (Erin) und ihre Zuordnung

Schwere: **K** kritisch, **H** hoch, **M** mittel, **N** niedrig.

| Nr. | Schw. | Befund | Gegenmaßnahme im Plan |
|---|---|---|---|
| 1 | K | `[VERIFICATION_PASSED]` überzeichnet: Clapotis und Wakes null Code, Jacobi-Schaum nur in OpenWater, Lava/Slime-Rheologie nie geschrieben | T2: `[VERIFIED: datei:zeile; test=]`-Marker plus Lint, Bilanz 2/6 |
| 2 | K | **Gate-Vakuität:** Das Repo-CI kann „G1 bis G9 grün" nicht erzeugen (vitest `environment: node`; einziger Render-Job `showcases-smoke-test` ist `continue-on-error` und prüft nur leere Canvases, kein Golden, kein Diff) | M1: Golden-Baseline und blockierender GL2-Comparator als erster Meilenstein |
| 3 | H | Drei Pflicht-Abnahmen von P1 nicht maschinenprüfbar (H2 Prosa, H4 Peer-Grade ≥ 4/5, H5 p95 auf Wanduhr) | Marker-Lint, skriptierter Differential-Grader, p95 nur auf dem Entwicklungsrechner |
| 4 | H | StylizedWater hat keinen Crest-Foam, Label und Varying behaupteten ihn (`StylizedWater.frag.glsl:208`, `:7`) | T1: Varying entfernen, Label korrigieren, Unused-Varying-Assertion |
| 5 | H | Testlücke: StylizedWater, Lava, Slime fehlen in `ShaderAssembly`; OpenWater, Stylized, Lava, Slime fehlten in `ShaderValidation` | T1/G1 |
| 6 | H | Lane-Kollision `u_styleA.w` mit drei Bedeutungen (Ripple-Breite, `posterizeSteps`, `iridescenceStrength`); beide Extensions überschreiben `props["u_styleA"][3]` nach `super.getRenderManifest()` auf einem geteilten Array | T3: Lane-Contract-Registry (Engine und Extension) plus Lint und Write-Order-Test |
| 7 | H | Kein Drift-Check für GLSL100 (Chunks nur als `.glsl`/`.wgsl`) | G2: Marker-Manifest über drei Backends plus Texture-Interpolant-Scan |
| 8 | H | WGSL-Crest-Transport über `Out.original_uv.x` ohne Regressionsschutz | G2-Manifest |
| 9 | H | Dead-Option-Klasse (F6, F7) wird von nichts gefangen | H5: Option-Enumerations-Lint über alle `*MaterialOptions` |
| 10 | M | Keine TODO/FIXME-Marker bei ≈ 8 offenen Defekten | Gate „Zero TODO drift" (siehe §15.7) |
| 11 | M | Physik und Render entkoppelt, keine Tests an der Naht | S1 plus Integrationstest |
| 12 | M | Noir „terminal" nie peer-bestätigt | Peer-Grade nach M1/H6 verschoben |
| 13 | M | WebGL1 durchgängig ≥ 1 Stufe unter WebGL2/WebGPU und am wenigsten getestet | GL1-Smoke (lädt, 0 Konsolenfehler, kein NaN) als ausgeführter Test |
| 14 | N | Posterize-„Off-by-one": **von Erin selbst in Runde 2 zurückgenommen** (siehe §15.3) | Level-Count-Test statt Fix |
| 15 | N | Doku-Formel `J = t.x·b.z − t.z²` weicht von der implementierten `t.x·b.z − t.z·b.x` ab (kosmetisch) | T2 |
| 16 | N | Zero-Alloc-Claim nur plausibel | Zero-Allocation-Assertion auf dem Pack-Pfad (M2) |
| 17 | N | „5 Injection Hooks" war eine Überzeichnung der Collab-Dokumente | T2 |
| 18 | N | Stille No-Ops ohne Warnung (z. B. `refractionStrength` ohne Wirkung auf einem Backend) | Warnung bei Material-Konstruktion (Lehre aus F7) |

Nicht zugeordnete Qualitätsrisiken aus der Messung (kein Paket in §8 trägt sie): WebGPU-Slime 2,5 im Nahbereich, WebGPU-Lava-Crust-Striping, Noir-Terminal-Grade, Oil-Blobs und Floater-Re-Verify, GL1-Dunst, Schilder-Lesbarkeit der ersten Reihe, Clear-Wand-Schaum. Erins Mahnung dazu: Ein Re-Grade von Clear (< 3,5 ist ein Blocker für „hart") und von Noir sowie WebGPU-Slime gehört in den Messblock.

### 13.5 Zahlen und Budgets

| Wert | Bedeutung |
|---|---|
| 256 Byte / 64 Floats | `ObjectUniforms`-Slot, voll; `u_styleA` bei Float 56 (Byte 224), `u_styleB` bei 60 (Byte 240), `styleId` in `u_styleB.w` |
| 18 Shader-Dateien, 10 Chunks | Drei-Backend-Satz |
| 16 Sampler | erzwungenes Budget |
| Matrix-Abdeckung 05.10. | 0 von 3 (Stylized, Lava, Slime) in `ShaderAssembly`; OpenWater fehlte in `ShaderValidation` |
| CPU-Submit-Wanduhr 10,7 / 5,3 / 1,5 ms | WebGL2 / WebGL1 / WebGPU; einzige Performance-Daten, selbst als unzuverlässig deklariert |
| Perf-Ziel p95 < 16,6 ms | Mittelklasse, 300 Frames, rAF-Intervall; in P2 nur auf dem Entwicklungsrechner und informational |
| Golden-Korpus | 10 Pools × (top, oblique) × WebGL2 blockierend, WebGPU informational, WebGL1 nur Smoke; Drift > ± 0,25 Grade erklärungspflichtig |
| GL1-Fixwerte | `depthProxy = fresnel·10`, Edge-Clamp 0,3, Spec × 0,5, Spec-Lobe `smoothstep(0,9993; 0,9999)·0,25`, Rim-Gewicht 0,2 |
| Wellen | StylizedWater-Gate `w3.w > 0,001`; w6 = 60°-Rotation (0,5 / 0,866), Amplitude × 0,25, Länge × 0,22; Crest `smoothstep(0,65; 0,95; v_crest)·0,5`; Ripple-Fade `smoothstep(0; 5; depthDiff)` |

### 13.6 Harness-Fakten hinter den Gates

Unit-Gate: vitest mit `environment: node` (keine GPU, kein rAF). Render-Smoke: Puppeteer, `continue-on-error`, nur Blank-Check (Luminanz-Streuung). `pngjs` war vorhanden, eine Diff-Bibliothek nicht (`pixelmatch`, ≈ 2 kB, kam mit M1). Das Verhältnis-im-Pool-Differential von Bob (§15.4) neutralisiert Backend-Belichtung und ist das einzige CI-portable visuelle Gate, bis GPU-CI stabil läuft.

---

## 14. Ausblick: Research-Horizont und Zukunft

> **Trennung vom Nahplan:** Dieser Abschnitt ist bewusst von §8 entkoppelt. Er ist **keine Zusage**, sondern eine Kette von Entscheidungstoren, auf die das System zuläuft, ohne die Stabilität zu brechen. Aufwand (S/M/L/XL) und Risiko meinen die Kosten, ein Feature innerhalb der Regeln (drei Backends, 256-Byte-Layout, keine Forks) zu landen, nicht seine intrinsische Schwierigkeit. Evidenz-Tags: `[SOURCED]` öffentlich belegt, `[JUDGMENT]` Designurteil, `[ASSUMED]` ungeprüfte Prämisse.
> **Prüffragen für jede Idee:** „Überlebt das ohne Compute-Tier und ohne Layout-Änderung?", „Überlebt es den Kaninchenbau-Filter?" und, aus Franks Phase-A-Satz: *Wenn es heute nicht auf allen drei Backends testbar ist, gehört es in Horizont 2 oder 3.*

### 14.1 Technik-Landkarte

| Technik | Wer macht es | Browser-Machbarkeit (WebGL1 / WebGL2 / WebGPU) | Aufwand | Risiko | Urteil |
|---|---|---|---|---|---|
| **Wellen-Interaktion** (Splat- und Wake-Ringe, tiefen-gegatet, Kelvin) | Crest (Collider-Wakes, advektierter Schaum), Horizon Forbidden West (Kontakt-Mist), Niagara `WaterInteraction` | Sehr hoch: reine Vertex- und Fragment-Mathematik auf den schon gebundenen `u_opaqueMap`/`u_opaqueDepthMap`; die Tiefen-Variante nur WebGL2/WebGPU wegen der GL1-Tiefenlücke | M | niedrig | **Erreichbar.** „Höchster Wert pro Aufwand des ganzen Horizonts"; wahrgenommene Interaktivität ohne Compute |
| **Clapotis** (analytische Wandreflexion) | — | Reine Vertex-Mathematik, drei Backends, ≈ 0 Uniform; WebGL1 degradiert sauber | S bis M | niedrig | **Erreichbar**, nahezu kostenlos |
| **CPU-Wellenhöhen-Sonde → Auftrieb** | Unreal `BuoyancyComponent`, Crest Surface-Query | Chunk-Mathematik in TypeScript spiegeln, f32-Parität | M | niedrig | **Erreichbar** und inzwischen gebaut (S1, §17.1) |
| **Stilbewusste Dynamik** (Wind pro `styleId`, skalenbewusste Wellenparameter, Step-Rate) | Wind-Waker-artige Seen | Reine CPU-TypeScript-Logik, kein Vendor, kein Compute | S | niedrig | **Erreichbar**, „billigster Differenziator" der Stylized-Familie |
| **Planare Reflexion** (`PlanarReflectionNode` → OpenWater) | alle Engines | Backend-agnostisch (gespiegelter Kamera-Render), Kosten im Sampling-Code und in einem zusätzlichen Sub-Render | M | mittel | **Erreichbar mit Aufwand**; geparkt (D1), siehe §14.5 |
| **2D-Heightfield-Interaktion** (Wellengleichung, 5-Punkt-Stencil auf kleiner FBO) | Three.js-Demos, Dobryakov | Nur WebGL2+ (Half-Float-FBO gated vorhanden: `WebGL1Renderer.ts:1119-1120`, `WebGL2Renderer.ts:1614-1617`); WebGL1 = statische Wellen | M bis L | mittel | **Erreichbar**, nur wenn ein Showcase persistente Splashes braucht |
| **Parameter Surfaces** (Daten-Texturen oder maskierte Lanes statt Per-Material-Konstanten) | Crest bewirbt bidirektionale Daten-I/O | Hindernis: voller 256-Byte-Slot, also Textur (Sampler-Budget) oder Layout-Erweiterung (ADR 0013) | M (Design), L (Engine) | mittel | **Erreichbar, design-first**; als Extension vor jeder Engine-Breite |
| **FFT als WebGPU-Showcase-Lane** | Unreal (Compute plus Niagara), Crest, Three.js-WebGPU | Nur WebGPU über Compute (WGSL-Compute-Primitive existieren: `WebGPURenderer.ts:660,729`) | L | hoch | **Optional**, „parken hinter Horizont 2" |
| **FFT über WebGL2** (1D-Ping-Pong-Passes) | Three.js `OceanShaderMesh` | Möglich, aber schwer und fehleranfällig; verbraucht Sampler und Register; **nicht** auf WebGL1 (keine Float-RT-Garantie) | XL | sehr hoch | **Kaninchenbau** (ein Ozean braucht erst ein Showcase, das glaubwürdige Bewegung „weit jenseits von 6 Wellen" verlangt) |
| **SSR** | UE/Unity (Post-Processing) | braucht die volle Post-Chain und einen eigenen Pass; Qualitätsrisiko auf Stylized | L | hoch | **Kaninchenbau**: erst Planar verdrahten, dann aus Evidenz neu bewerten |
| **RT-Reflexionen** | UE5 Lumen | WebGL2 nein, WebGPU-Ray-Query experimentell | XL | sehr hoch | **Niemals**, außer ein RT-Showcase entsteht |
| **3D-SPH, Partikelfluid** | Niagara Fluids, ZibraAI | nur WebGPU, nur Hobby-Reife | XL | sehr hoch | **Kaninchenbau**; höchstens ein WebGPU-Showcase („Broschüren-Demo, nie ein System") |
| **Tessellation, LOD-Wassergitter** | Unreal-Quadtree, Crest lod0-Tiles, Unity Water Grid | WebGL1 hat keine Tessellation | L | hoch | **Kaninchenbau**: „dokumentieren, nicht bauen"; Segmentdichte bleibt Sache der App |
| **Compute-Pilot** (WebGPU, Spektral oder Oszillator-Rauschfeld) | — | erstes **backend-exklusives** Feature: die Doktrin wechselt von „immer drei" zu „deklarierte Tier-Stufe" | Entscheidung (Risiko-Gate), Bau L | hoch | **ADR vor jedem Code**; hinter explizitem „WebGPU showcase"-Flag mit statischem WebGL1/2-Fallback |

Franks Bilanz: Von zwölf Kandidaten sind etwa vier mit niedrigem oder mittlerem Risiko heute im Browser erreichbar (Interaktionsfläche, Clapotis, Sonde → Auftrieb, stilbewusste Dynamik), eine ist mit Aufwand erreichbar (Planar), eine design-erreichbar (Parameter Surfaces), der Rest (FFT × 2, SSR, RT, SPH, LOD-Gitter) sind Kaninchenbauten, die aus dem Nahplan ausdrücklich zu entschuldigen sind.

### 14.2 Horizonte

Franks Dreiteilung. H2 und H3 sind **keine Zusage**.

**Horizont 1: Konsolidieren und härten** (≈ Phase A, im Nahplan §8 vollständig enthalten)
- Truth-Gap-Pass: Jeder frühere Claim ist implementiert oder ausdrücklich gelöscht; alle Liquid-Materialien in den Testmatrizen.
- Gemessenes Regressionsgitter pro Backend, Layout bleibt 256 Byte, kein Kaninchenbau-Feature wird gemerged.
- Hauptrisiko: Teamdisziplin („jeder will sein eigenes neues Spielzeug in H1"); zweites Risiko: die **ehrliche WebGL1-Lane** wird unterschätzt, und Degradation wird versteckt statt dokumentiert.
- Phase A soll für die Zukunft nicht Features liefern, sondern **Entscheidungsdaten**: die gemessene Baseline (M1/M2), das dokumentierte Wellen-Datenmodell und das aktualisierte ADR-0013-Verdikt zum Layout (§8.6). Franks Formel: „die Beweis-Infrastruktur, auf der H2/H3-Entscheidungen getroffen werden statt auf Bauchgefühl".

**Horizont 2: Begrenzte Interaktivität und Kinetik, dann ein Compute-Pilot**
- **H2.1 Interaktivitätsfläche (M, niedrig):** tiefen-gegatete und quellgetriebene Ripple- und Wake-Ringe auf den bestehenden Capture-Trägern, ein analytischer Kelvin-Wake, sondengespeister Auftrieb. In §8 stecken S1, S2 und S3; **der Kelvin-Wake nicht** (S4 = RAUS, siehe §15.2). Risiko: Cross-Agent-Ownership. Das Wellen-Datenmodell muss **ein typisierter Kanal** sein, kein App-Spaghetti.
- **H2.2 Compute-Pilot-Entscheidung (Risiko-Gate, kein Build):** minimaler WebGPU-only-Prototyp auf den vorhandenen WGSL-Compute-Buffern, hinter einem Showcase-Flag mit statischem WebGL1/2-Fallback. Risiko: wird „leise zu einem 2-Stufen-System". Franks Regel: **Die Stufe explizit machen oder es lassen.** In §8 steht dazu nur der Out-of-Scope-Lock; der vorbereitende Compute-Tier-Policy-ADR fehlt als Aufgabe.

**Horizont 3: Ambition (Reflexion, Fluidsim, stilbewusste Simulation)**
Nur erreichbar, wenn H2 grün landet; jedes Item showcase-abhängig und „unabhängig abbrechbar ohne Rückstand".
- **H3.1 Reflexionsqualität:** `PlanarReflectionNode` in den OpenWater-Shader; SSR nur, wenn ein Showcase beweist, dass die Stylized-Linie es braucht. Risiko: Spiegelkamera-Sichtbarkeitsregeln und ein zusätzlicher Sub-Render können die Frame-Kosten auf Mittelklasse-Hardware verdoppeln, daher Opt-in pro Material mit gemessenem Budget.
- **H3.2 WebGPU-only SPH oder Partikel-Novelty:** ein begrenztes Showcase-Feature, „explizit eine Broschüren-Demo". Risiko: Zeitsenke ohne Cross-Backend-Erkenntnisse; hart auf ein Showcase kappen.
- **H3.3 Stilbewusste Dynamik über Parameter Surfaces:** Wind, Skala und Art Direction pro `styleId` über einen Textur- oder Datenkanal (ADR-0013-Entscheidung). Einziges H3-Item mit Engine-Breite, also zuletzt und Extension-first. Hinweis: Franks einfache CPU-Variante (S, §14.1) ist nicht H3-Engine-Breite; beides ist in der Hauptdatei offen.
- Hauptrisiko H3 insgesamt: dass „Ambition" H1 und H2 in den Schlamm zieht.

### 14.3 Ergänzende Zukunftsaussagen aus den Blättern

- **Alice:** Die größte strukturelle Lücke ist eine **wasserspezifische Render- und Geometrieschicht** (Pass plus Surface), die Unreal und Unity haben. Vorschlag A5: eine **Machbarkeitsstudie nur als Design** (Pass und Surface-Layer, die auf den generischen Transparent-Pass degradieren, innerhalb von 256 Byte; Tessellation von Disk und Plane). „Die 256-Byte-Decke und die Einzelebenen-Geometrie sind die zwei Zwänge, die irgendwann eine Entscheidung erzwingen (Layout verbreitern oder Per-Geometrie-Wasserrendering), aber beide sind bekannt, vermessen und aufschiebbar." Dreiteilige Vision: Zwei-Familien-Rückgrat plus Extension-Grenze behalten, die Pipeline nur bei verifiziertem Bedarf wachsen lassen, jedes Feature mit seinem Abnahmetest landen. Nordstern: *ein System, dessen Claims gleich Code sind und dessen Qualität gemessen statt behauptet wird.* A5 steht **nicht** in §8.
- **Bob:** FFT oder wenigstens eine **dispersionsbasierte prozedurale Normalmap** gegen das Hochfrequenz-Defizit der sechs Wellen (Delta 1); FFT höchstens als WebGL2/WebGPU-Tier in Phase B/C; Crests Interaktionsmathematik als adoptierbarste Idee. Bob nennt die fehlende Reflexion „industrial missing", was in Spannung zum Parken (D1) steht.
- **Charly:** Das Extension-Paket als **Referenz-Authoring-Kit** („so schreibt man einen Look"); Zukünftige Styles kommen als Parametervektoren oder Extensions, nie als Engine-Forks; ein Vertex-Hook würde den Crest-Schaum in Extensions ermöglichen (in T1 bewusst zurückgestellt); Ramp- und Palette-Editing fehlen.
- **Dave:** Escape Hatch für eine echte Simulation später: Half-Float-FBO plus WebGPU-Compute-Primitive; minimale, CFL-stabile Splat-Löser in **JS spiegeln** statt Compute zu importieren. Zurückgestellt: SPH, advektierte Schaum-Targets, modales Sloshing, allgemeine Wandreflexion.
- **Erin:** QA-Zukunft aus der Industrie: Quality-Level-Gating teurer Effekte, Capability-Fallback in CI ausführen, explizite Feature-Mismatch-Warnungen, Screenshot-Goldens. „Bewusst *nicht* übernehmen: GPU-Compute-Kaskaden, Terrain-Tessellation-LOD und SPH; das sind Research-Horizont-Items." Ihre Mahnung: Jedes teure Research-Item gehört hinter die Ergebnisse von G1 bis G3, sonst wiederholt die Roadmap denselben Claims-gegen-Realität-Fehler auf größerer Bühne.

### 14.4 Out-of-Scope-Lock mit Begründung (zurückgestellt, nicht verworfen)

| Nr. | Ausgeschlossen | Begründung |
|---|---|---|
| 1 | FFT/Tessendorf (alle Backends) | braucht zuerst die Compute-Tier-Policy (H2.2); kein FFT in Phase A |
| 2 | FFT über WebGL2-Ping-Pong | Kaninchenbau, bis ein konkretes realistisches Ozean-Showcase existiert |
| 3 | 3D-SPH und Partikelfluid | nur WebGPU, höchstens ein Showcase (H3.2) |
| 4 | SSR und ein neuer Post-Processing-Wasserpass | den vorhandenen Planar-Knoten verdrahten, wenn Reflexion wirklich gewollt ist |
| 5 | RT-Reflexionen | „für immer, es sei denn ein RT-Showcase entsteht (sehr unwahrscheinlich)" |
| 6 | Tessellation, dedizierter LOD-Gitter | dokumentieren, nicht bauen; die Segmentdichte bleibt bei der App |
| 7 | Jede Änderung am 256-Byte-Layout | ADR 0013 wägt ab und wird nur neu bewertet, wenn Parameter Surfaces real werden; H1 und H2 passen in zweckentfremdete Lanes plus Style-Konstanten |
| 8 | Neue Sampler jenseits des Budgets | 16-Sampler-Cap getestet; Interaktion muss `u_opaqueMap`/`u_opaqueDepthMap` wiederverwenden; das Verdrahten von `PlanarReflectionNode` wäre eine neue `u_reflectionMap`-Deklaration |
| 9 | Engine-weiter Material-Graph oder Node-Editor | Style-Ladder plus Hooks sind die Tooling-Decke des Planzeitraums |
| 10 | Großangelegte bidirektionale Physik-Render-Kopplung | einseitig (CPU-Probe → Auftrieb); echte Zwei-Wege-Wellen sind bestenfalls H3 |
| 11 | Engine-Forks, vendored Wasser-Middleware | bereits Gesetz; neue Fähigkeit nur über ADR-0025-Hooks oder ein Extension-Paket |
| 12 | Kelvin-Wake (D2) | siehe §15.2 |

Begründungsprinzip: Drei-Backend-Parität mit dokumentierter WebGL1-Degradation, keine Forks, keine globalen Singletons, Layout voll bei 256 Byte, „Stabilität und Härte vor neuem Glanz". Wird ein Punkt doch nach H1 gezwungen, muss er Erins Stabilitäts-Gates bestehen.

### 14.5 Bedingungen zum Wiederöffnen

| Thema | Wiederöffnen, wenn |
|---|---|
| D1 Reflexion (geparkt) | ein realistisches Showcase mit sichtbarer Landschaft Wasserreflexion wirklich braucht **und** ein Frame-Budget gemessen ist; ausdrücklich **nicht** an D2-Daten gebunden (Bob, Dave, Erin). Grep-Covenant: „kein Wasser-Fragment sampelt `u_reflectionMap`". Beim Wiederöffnen: Opt-in pro Material, Spiegelkamera-Sichtbarkeitsregeln, ADR-0013-lite |
| D2 Kelvin-Wake (raus) | ein Showcase mit bewegtem Boot existiert (Körper fährt durchs Wasser), jemand die Lane besitzt und der RigidBody-Antrieb vorhanden ist |
| FFT, Compute | der Compute-Tier-Policy-ADR vorliegt **und** ein Open-Ocean-Showcase glaubwürdige Bewegung weit jenseits von 6 Wellen verlangt; WebGPU-only mit statischem Fallback |
| Parameter Surfaces, Layout | Horizont 3.3 real wird; dann ADR 0013 neu bewerten (Textur-Sampler gegen Layout-Erweiterung) |
| SSR | ein Showcase beweist, dass die Stylized-Linie es braucht und Planar nicht reicht |
| LOD, Tessellation | FFT ansteht; Alices Machbarkeitsstudie liegt vor |
| D3 voller Enum-Refactor | ein sechster publizierter Style geplant ist (T4) |

### 14.6 Offene Forschungsfragen

1. Lässt sich ein **ehrlicher f32-Paritätstest** für die Sonde konstruieren? (Beantwortet seit 2026-10-07: ja, per Headless-GL-Skript, siehe §17.2 Punkt 1.)
2. Ist der **blockierende GL2-Golden-Job** (CI-Umgebung gegen lokal aufgenommene Baseline) plattformübergreifend stabil? Unbelegt; ohne Antwort ist das Gate nicht verlässlich.
3. Welche **Hochfrequenz-Strategie** schließt das 6-Wellen-Defizit ohne FFT (Bob: dispersionsbasierte prozedurale Normalmap)?
4. **Kanalwahl für Interaktion:** Uniform-Lane (Bob, Dave) gegen Capture-Textur (Dave, Frank), mit der Semantikkollision von `u_opaqueMap` zwischen Eingabe und Refraktion (siehe §15.5).
5. Ist eine **Wasser-Pass- oder Geometrieschicht** innerhalb von Drei-Backend- und 256-Byte-Zwang spezifizierbar? (Alice A5, nur Design.)
6. **Block L** (§11.1): Wasser-Pools, Dredge und Noir empfangen keinen Schatten (L3), das Caustic-Masking ist ein Luminanz-Proxy (L4), die Schattenlogik ist dreifach dupliziert (L5), der Default `shadowResolution` 512 ist zu grob (L6). Kein Thema für Frank, aber Voraussetzung für glaubwürdige H2- und H3-Ergebnisse.
7. Wie bleibt bei einer „deklarierten Tier-Stufe" (WebGPU-exklusiv) die Aussage „Drei-Backend-Parität" glaubwürdig? (Frank H2.2)

---

## 15. Einwände, verworfene Alternativen und Rückzugsbedingungen

Dieser Abschnitt hält fest, **warum** der Plan P2 so aussieht, wer was dagegen hatte und wann die Unterzeichner zurückziehen. Er ergänzt §8, §9 und §11 um das, was dort verkürzt oder gar nicht steht.

### 15.1 Struktur des Plans

| Thema | Einwand und Begründung | Ergebnis in P2 |
|---|---|---|
| **Block H als homogene Kette** (Alice, stärkster Einwand) | Block H ist strukturell **drei Spuren**: *Wahrheit* (H1, H2, H3), *Messung* (H5, H6) und H4 zuletzt. Drei Punkte: (1) H4 vor H6 macht „keine Drift" nicht maschinell erzwingbar; (2) H2 (nur Doku) bläht das Pflicht-Gate künstlich auf, genau der Scope-Creep, den der Out-of-Scope-Lock verhindern soll; (3) der Doppelkanal von S2 ist der einzig handgewedelte Constraint-Bruch. Alices Gate-Formel: `{H1 grün, H3 grün, H6-Baseline grün, H5-Budget-Harness grün}` | Übernommen als Blöcke M (Messung zuerst), T (Wahrheit parallel) und H. Das S-Gate ist `{T1, T3, M1}`; M2/H5 gehört **nicht** dazu |
| **„S nur nach H, optional wenn Zeit"** (Dave, stärkster Einwand) | Das macht die gesamte Kinetik-Achse zum ersten Opfer jeder H-Überschreitung, und H „wird überschreiten". S1 braucht kein H-Item (CPU-Höhen-Mirror plus Tausch von `fv.bounds.max.y`, reines JS ohne Materialdatei oder Shader). Das Einzige, was ein Showcase nicht faken kann („Objekt reagiert sichtbar"), liefert sonst nichts. „Optional wenn Zeit" invertiert den Planzweck; drei Blätter (Dave, Frank, Bob) stufen Interaktivität als höchsten Wert bei fast null Kosten ein | S1 und S2 sind Pflicht, S1 ohne H-Vorbedingung; Interaktivität ist **nicht** die Cut-Linie |
| **H2 (Claims-Korrektur) als Gate** | Doku-Hygiene ist kein Gate | T2 ist ausdrücklich „kein Gate" |
| **D4 als „optional, wenn Zeit"** (Charly) | Das einzige künstlerseitige Deliverable und die größte Paritätslücke darf nicht das Erste sein, das gestrichen wird | D4 ist gelockt und committet, nach Block H |
| **Peer-Grade „Clear ≥ 4/5" als H4-Exit** (Bob, Erin, Dave) | Ohne operative CI-Definition ist das dieselbe Eyeball-Audit-Schleife, die diese Session ersetzen soll. Murk ist **strukturell**: das Absorptions-Tripel liegt auf zweckentfremdeten Skelett-Lanes (`LiquidWaveMaterial.ts:116-118`), nur `u_pad3` und `u_specColor` sind frei, jeder „weniger Murk"-Knopf ist ein Lane-Tausch. Bobs Urteil: „teilweise unerreichbar **und** unmessbar" | Skriptierter Differential-Grader auf dem M1-Korpus (§15.4) |

### 15.2 Entscheidungen D1 bis D5 und Minderheiten

| Entscheidung | Ergebnis | Gegenposition und Gründe |
|---|---|---|
| **D1 Reflexion** | PARK mit Grep-Covenant und Re-Open-Gate (§14.5) | *Alice (Begründung für PARK):* die einzige mit dem Out-of-Scope-Lock kohärente Option, weil das Verdrahten eine neue `u_reflectionMap`-Deklaration wäre. *Bob:* PARK, aber als **geschriebene Haltung jetzt**, nicht „hinter D2-Daten" (der Kelvin-Ausgang hängt nicht an Reflexion); die Verdrahtung wird das „erste benannte H3-Realistic-Item"; die offizielle WebGL1/2-Position (`skyTint`) in die Doku von `OpenWaterMaterial.ts` schreiben, damit das stille Default-Lesen verschwindet. *Charly:* minimale Planar-Verdrahtung ist ein „echtes M-Item" (neuer Reflection-Target-Pass, RT-Binding, per-Frame-Re-Render über drei Backends); der artistenrelevante Schritt ist, `skyTint` als benannte Konstante zu exponieren. Zusätzlich hält PARK einen Halbframe-Sub-Render aus dem H5-Hot-Path |
| **D2 Kelvin-Wake** | RAUS (S4) | *Alice* stimmte in Runde 2 für „IN, showcase-gegatet", akzeptiert OUT als Gruppenkonsens. Gründe für OUT (Dave, Bob): kein Showcase fährt einen Körper durchs Wasser (der einzige Beweger in Showcase 10 ist die kinematisch fallende Kiste ohne Körpergeschwindigkeit; die Körper in Showcase 21 und 23 sind Pegs und Kugeln außerhalb des Wassers); die natürliche Reaktion ist ein Impact-Splat (S2), kein dauerhafter 19,47°-Keil; es braucht eine Lane, die niemand hat, und einen RigidBody-Antrieb, den niemand besitzt. Frank vermerkte, S4 berühre die für H3 reservierte Körper→Wasser-Richtung seines Locks |
| **D3 Style-Map** | nur minimal (T4: Style-Identity-Test; `styleId == 3.0` ⇒ `isExtension`) | *Alice* wollte D3 im Zeitraum (nach H6, vor S2), weil der Float-Margin-Dispatch (`StylizedWater.frag.glsl:55-60`) eine fragile Naht sei. *Charly:* kein Float-Drift-Risiko, `styleId` ist ein Uniform aus TypeScript und wird nie interpoliert, die 0,5-Margins sind bewusste Guards; die einzige echte Gefahr ist der Drei-Dateien-Edit-Sync bei einem sechsten Style. Der volle Refactor ist der höchste Churn bei niedrigster Dringlichkeit (drei Backends plus Extension-Vertrag `styleId: 3.0`) |
| **D4 Live-Tune** | JA, committet, nach Block H | Fences (Charly, Erin): **keine** `packages/engine`-Edits; keine neue Uniform-Lane; keine Persistenz oder Serialisierung; kein Pointer- oder UI-Framework; kein Ramp-Import; keine Per-Backend-Schalter; **eine** Vanilla-`StylizedWaterMaterial`-Instanz (nie Noir oder Oil, deren Lane-Wiederverwendung gegen einen Global-Tuner kämpfen würde); höchstens eine neue Datei im Showcase plus Key-Handler. Bedienung: `[`/`]` Knob wählen, Pfeil hoch/runter verstellen, `0` Knob-Reset, `shift+0` Style-Reset auf den `STYLE_PRESETS`-Eintrag, `g` Snapshot des getunten Vektors zum Einfügen in die Preset-Tabelle. Treibt nur gehärtete Per-Style-Konstanten aus H4 (Franks Bedingung, sonst kommt das Hintertür-Problem zurück). Testbar ohne GL: reine TypeScript-Controller-Klasse (Range-Tabelle, Clamp und Step, Reset-Ziel). Abnahme: Unit-Tests grün, Golden-Drift im Tuning-Pool innerhalb der H6-Toleranz, kein Engine-Diff, keine Lane-Änderung. Darf nicht zum Material Studio wachsen |
| **D5 Sonde** | PFLICHT (S1) | *Alice:* „offiziell raus" ließe `FluidVolume` und `BuoyancySolver` als exportierte, aber verwaiste öffentliche API, selbst ein Claims-gleich-Code-Verstoß. *Bob:* S1 ist das einzige S-Item, das Physik-Wahrheit liefert (S2 und S3 liefern Optik); sonst ist der Block „ein animierter Shader". *Dave:* „das einzige S-Item, das ein Objekt ehrlich verhalten lässt, statt animiert wirkt". Alternativweg für G6, wenn S1 optional bliebe (Alice): Integrationstest **oder** Export-Entfernung **oder** ADR „out of scope" plus Grep. „S1 optional **und** G6 wie geschrieben" ist widersprüchlich |

### 15.3 Posterize: kein Off-by-one

Erins Runde-1-Befund R8 behauptete, `posterizeSteps = N` erzeuge nur `N−1` Ebenen wegen `inkSteps = max(u_styleA.w − 1.0, 1.0)`. Charly rechnete nach, und **Erin nahm den Befund in Runde 2 vollständig zurück**: `floor(inkTone · (N−1) + 0,5) / (N−1)` liefert **exakt N** Ausgabewerte (N=2 → {0, 1}, was zur dokumentierten Aussage „2 = reines Schwarz/Weiß" passt; N=4 → {0, ⅓, ⅔, 1}; N=8 → acht Ebenen). Die Runde-1-Zählung hatte S statt S+1 gezählt. Ein „Fix" durch Entfernen des `−1` würde N+1 Ebenen liefern, den obersten Bucket verbreitern und könnte den gemessenen Weißausbrand (Noir 2/5, `showcase10-quality` F5) wieder aufwecken.
Der echte Befund ist ein **Kunstdefekt**: die `+0,5`-Rundung weitet den obersten Bucket bei hellen Eingaben. Das ist Verteilung, nicht Semantik. Gegenmaßnahme in T3: Transport- und Level-Count-Test über GLSL300, GLSL100 und WGSL (N Ebenen) plus ein optionales, nicht-semantisches Art-Audit. Prozess-Lektion: Ein Red-Team-Befund wurde durch Nachrechnen widerlegt, bevor er Schaden anrichtete.

### 15.4 Gates, Grader und Messbarkeit

- **Gate-Vakuität (Erin, stärkster Einwand):** Ohne blockierenden Golden-Comparator und ohne Trennung blockierend/informational bleibt „hart und stabil" nicht erzeugbar. Der Satz ist am leichtesten stillschweigend aufzuweichen („flaky unter SwiftShader → informational machen") und öffnet dann das leere Gate wieder. Daraus folgen die Rückzugsbedingungen in §15.7.
- **Gate-Hygiene (Alice):** G1 und G2 sind sofort CI-fähig; G5 und G8 erst nach dem jeweiligen Meilenstein; G3 braucht eine Options-Enumeration (die Lane-Registry als Artefakt); G4 braucht den strukturierten Marker `[VERIFIED: datei:zeile; test=<id>]` plus Lint; G6 und G7 sind Entscheidungen, also ADR-Status plus Grep-Verträge („kein Wasser-Shader sampelt `u_reflectionMap`", „`FluidVolume`-Instanzen in Apps ≥ 1 **oder** Export entfernt"); G9 geht in G3 auf.
- **Gate-Widerspruch:** „keine behauptete-aber-fehlende Funktion offen" ist nur grün, wenn Clapotis und Wakes als „bewusst außerhalb des Zeitraums" und FFT, SPH und LOD als Out-of-Scope umetikettiert sind (in §8.2 T2 und §8.5 enthalten).
- **Bobs Grader-Entwurf** (Zahlen fehlen in §8.2 H4):
  1. *Floor-Lesbarkeit:* Michelson-Kontrast über die Boden-ROI, nass gegen trocken im selben Pool: `C_nass / C_trocken ≥ C_floor_min` (Vorschlag 0,25), pool-intern normalisiert und damit CI-portabel.
  2. *Murk:* gemessene Transmittanz (Beer-Lambert `OpenWater.frag.glsl:74`); das Kontrast-Gate muss beim dokumentierten `waterAbsorption`-Tripel und der Pooltiefe halten; jedes Re-Tuning muss neu bestehen.
  3. *Blowout:* Clip-Anteil `≤ eps_sat` (Vorschlag 0,5 %) in der Wasser- und Boden-ROI sowie in der Spec-Lobe-ROI (`pow(nDotH, 1200)`) unter der Clip-Grenze (fängt die Klasse F18/F25).
  Ein Mensch kalibriert die Schwellen **einmalig** gegen historische Screenshots; danach werden sie merge-blockend. Restzweifel Bob: Bis zur ersten signierten Baseline sind die Schwellen nicht aus hartem Prinzip abgeleitet; eine fehlkalibrierte Schwelle lässt Murk durch oder blockiert endlos.
- **Gate-Nummerierung:** Erins ursprüngliches **G7 „Zero TODO drift"** (jeder offene Defekt ist ein Code-Marker oder Backlog-Eintrag, ein grep auf TODO muss mit der Defektliste übereinstimmen) fehlt in §8.5; dort bedeutet „G7" den D1-Grep-Covenant. Das ist Nummerierungsdrift zwischen E1 und P2. Ebenso ist G9 („Laufzeitsicherheit, fail-fast, keine toten Optionen") in G3 aufgegangen, ohne dass §8.5 das ausdrücklich vermerkt.
- **S1-Abnahme in drei Stufen:** P1 verlangte „Probe == Shader-Feld in Toleranz auf GL2/GPU". Runde 2 (Bob, Dave, Erin) erklärte das für unausführbar im vitest-Harness (kein GPU-Readback; f64 gegen f32 divergiert mit jeder summierten Welle und mit der Zeit). Ersatz: (a) Golden-Vector-Regression des TypeScript-Spiegels mit expliziter Toleranz, (b) G2-Manifest, dass die gepackten Wave-Lanes den Spiegel-Konstanten gleichen („dieses Manifest *ist* die Same-Field-Garantie"), (c) Showcase-Integration. Bobs Zahlenvorschlag für die Toleranz: `≤ 1e-3 · max. Amplitude` oder `5e-4 m`. Frank ergänzte: die Sonde ist **nur Testzeit**, kein Per-Frame-Gameplay-Readback. Seit 2026-10-07 ist das überholt (§17.2 Punkt 1).
- **S3-Abnahme „Shader-Test D_ref-Vorzeichenumschlag"** (Dave): ein Shader-Source-Text-Assert prüft nur, dass der Term existiert. Der Vorzeichenwechsel gehört in einen **JS-Mirror-Test** (`D_inc` an der Wandnormale spiegeln, die Wandnormal-Komponente muss bei Einlaufrichtung zur Wand das Vorzeichen umkehren). Zusätzlich: die ≈ 2A-Falle durch Distanz-Falloff begrenzen, damit die Stehwelle nicht unbegrenzt Energie injiziert; Präsenz in allen drei Vertex-Quellen; Showcase-Golden (Stehwellenknoten ≈ Wand − λ/4).
- **H1-Prämisse invertiert** (Charly): Die „Drei-Backend-Implikation" der `v_displacementY`-Löschung war unbegründet (nur ein Backend). Zusatz: Der tote Varying war der **einzige** Crest-Foam-Anker auf dem Stylized-Vertex (es gibt keinen Vertex-Hook); T2 muss festhalten, dass das Entfernen bewusst ist, damit er nicht blind neu angelegt wird.

### 15.5 S2: ein Lieferkanal, keine Doppellösung

P1 ließ offen: „repurposed Lane **oder** Opaque-Color-Capture". Dave und Frank zeigten die **Semantikkollision**: `ObjectUniforms` sind 64 Floats; in der Liquid-Familie ist **jedes** Feld zweckentfremdet und tragend (`LiquidWaveMaterial.ts:91-130`), es gibt null freie Floats; 1 bis 4 Splats bedeuten 4 bis 16 Floats Eviction plus Registrierung und ein sich pro Frame änderndes Uniform. Die Capture-Route fügt kein Uniform hinzu, stempelt das Signal aber in `u_opaqueMap`, die zugleich die Refraktionsquelle ist (`OpenWater.frag.glsl100:50`; auf WebGL1 farbgebunden `WebGL1Renderer.ts:973` und NEAREST-gefiltert `:666-667`): Eingang und Refraktion teilen sich eine Textur ohne Arbitrierung, dazu kommt shaderseitige Quellenerkennung mit Falsch-Positiven durch helle Szeneninhalte, nur golden-testbar. Frank hielt die Capture-Route für die Lock-saubere, die Lane-Überladung für die „Hintertür".
**Ergebnis:** genau **eine** registrierte Splat-Lane (`vec4 = pos.xz + spawnTime + energy`), **höchstens ein aktiver Splat pro Wasserfläche** (der Dropper ist sequenziell FALLEN → Impact), Upload nur bei Impact und nicht pro Frame; Eviction mit Re-Homing laut T3. Alice hatte „höchstens 2 weltquantisierte Splats" vorgeschlagen, der Konsens ist strenger. Dave fügte hinzu: Eine Uniform-Splat-Lane gibt **WebGL1 echte Interaktivität** ohne Textur-Abhängigkeit, besser als die Capture-Behauptung „auch WebGL1". Die Capture-Route ist „post-period". Franks offene Prüfung, ob der WebGL1-Zweig einen echten `u_opaqueMap`-Capture hat (gebunden auf allen drei Backends: `WebGL1Renderer.ts:973`, `WebGL2Renderer.ts:1310`, `WebGPURenderer.ts:1861`), steht nicht in §8.
**Konkrete Abnahmegeste (Dave):** Der bestehende periodische `SplashDropBehavior`-Impact emittiert genau einen Splat `{pos = Impact-XZ, energy ∝ Aufprallgeschwindigkeit}`; das Wasser antwortet mit einem Quell-Ring, danach bobbt die Kiste auf der echten S1-Fläche. Das ist der billigste glaubwürdige Beweis, dass „das Objekt reagiert".

### 15.6 Lane-Registry (T3) und Style-Fragilität

`u_styleA.w` hat drei Bedeutungen, *by design* nach ADR 0025: Basis-`lineWidth` (`StylizedWater.frag.glsl:191,195`), `posterizeSteps` (Noir, `NoirWaterMaterial.ts:90,104`) und `iridescenceStrength` (Oil, `OilSlickMaterial.ts:97,132`). Charly korrigierte die Form des Problems: Die drei Bedeutungen sind kein Defekt. Echte Defekte sind (a) fehlende Durchsetzung, (b) **Write-Order-Fragilität**: beide Extensions überschreiben `props["u_styleA"][3]` nach `super.getRenderManifest()` auf einem geteilten, veränderlichen Array, und (c) die Basis-`lineWidth`-Semantik geht für Extension-Styles still verloren (Noir und Oil zwingen `lineDensity` und `glitterStrength` auf 0). Eine Laufzeit-Registry der Engine allein kann die Lanes von Noir und Oil nicht kennen, deshalb ein **test- oder CI-deklaratives Artefakt Engine ↔ Extension**. S2-Splat-Lane und S3-Wall-Vertrag werden dort registriert; die Wall-Daten (Normale, Halbextent, Amplituden-Falle) sind „die eine Verbindungsstelle" zwischen Bob und Dave. S3-Ownership nach Artefakt: Bob = Vertex-Konsum, Dave = öffentliche Wall-Config-API und Integrationstest, **keine Materialdatei hat zwei Eigentümer**.

### 15.7 Rückzugsbedingungen der Unterzeichner

| Agent | Zieht zurück (`[OBJECTION]`), wenn … |
|---|---|
| **Alice** | ein Shader-berührendes H/S-Item ohne WebGL2/GPU-Golden-Baseline gemerged wird; `u_styleA.w` eine nicht registrierte vierte Bedeutung bekommt; „hart und stabil" erklärt wird, solange die S1-WebGL1-Parität weder getestet noch als degradiert dokumentiert ist; D5 optional wird bei unverändertem G6; die S2-Splat-Lane nicht vor dem ersten S2-Merge in T3 registriert ist; ein blockierendes Gate in CI rot ist. *Restzweifel:* S2 ist der erste Realtest der Lane-Contract; rutscht die T3-Registry oder die M1-Baseline, ist „gemessen, nicht behauptet" wieder nicht durchsetzbar (der P1-Fehlermodus) |
| **Bob** | (a) H4 mit nicht kalibrierten oder schwammigen Schwellen blockierend geschaltet wird (statt Signatur pro Schwelle plus Spot-Check-Kalibrierstatus); (b) die T3-Registry so gedehnt wird, dass S1- oder S3-Konstanten vom manifestierten Pack abweichen dürfen; (c) D5/S1 den Pflichtstatus verliert. Außerdem: Grade-Exit unverändert oder S1/S3/S4 in alter Form |
| **Charly** | das `−1` der Posterize-Semantik entfernt wird oder der Level-Count-Test (T3) oder Style-Identity-Test (T4) still entfällt; D4 den committeten Slot nach Block H verliert und wieder beratend wird. *Restzweifel:* Wenn T4 und T3 im Umsetzungsdruck unter „der Fix ist offensichtlich, Assertion weglassen" fallen, öffnet sich das Weißausbrand-Regressionsfenster erneut |
| **Dave** | Block S hinter vollem H zurückgestuft wird oder „optional wenn Zeit" als Cut-Priorität überlebt; S2 mit zwei aktiven Kanälen oder einer nicht registrierten Lane ausgeliefert wird, die ein Feld still verdrängt; D5 optional bei unverändertem G6; die S3-Abnahme als Shader-Source-Assert ohne JS-Mirror-Test erscheint. *Restzweifel:* Das S2-Re-Homing ist der erste echte Test der T3-Registry; stilles oder ungelintetes Re-Homing tauscht ein visuelles Feature gegen einen Splash |
| **Erin** | der Lock „G1 bis G9 grün auf dem Default-Branch" bei weiterhin `continue-on-error: true` **und** ohne blockierenden Golden-Comparator besteht; H4-Clear als Peer-Grade ohne skriptierten Grader bleibt; p95 < 16,6 ms als CI-Merge-Kriterium ohne Harness oder ersatzlos gestrichen wird; das `−1` bei Posterize entfernt wird; der Dead-Option-Lint bei G3 als Prosa bleibt; D5 optional bei G6 „verdrahtet und getestet **oder** raus" bleibt; der GL2-Golden-Comparator (M1) oder der H4-Grader auf informational demoted wird |
| **Frank** | S2 oder S3 vor der T3-Registry (inkl. Noir- und Oil-Lanes) CI-grün mergen oder der S1-f32-Lane-Manifest-Test nicht besteht; ein neues Uniform-Byte, Sampler oder Compute- und LOD-Konstrukt ohne **ADR-0013-lite-Begründung in der Akzeptanz** einläuft (Mini-ADR als Pflicht in jedem Item, das Layout, Sampler oder Compute berührt); die §8.6-Deliverables (ADR-0013-Verdikt, Wellen-Datenmodell) nicht als committete Artefakte in Schritt 8 landen. *Strongest Doubt:* „hart und stabil" hängt an CI-Gates, die tatsächlich gebaut und grün sind; werden die Mess- und Registry-Harnesses zuletzt gebaut oder gespart, fällt der Plan still auf „Claim über Code" zurück |

### 15.8 Verworfene Alternativen

- Peer-Grade „Clear ≥ 4/5" als Exit (ersetzt durch den Differential-Grader).
- „Optional wenn Zeit" für Block S und für D4.
- Doppelter S2-Kanal (Lane **oder** Capture).
- Posterize-„Off-by-one-Fix" (Fehldiagnose, §15.3).
- Float-`styleId` → Enum-Refactor im Zeitraum (zurückgestellt, D3).
- Planare Reflexion im Zeitraum verdrahten (geparkt, D1).
- Kelvin-Wake im Zeitraum (D2 = OUT).
- Parallel-„Wasser-Pass"-Neuarchitektur und Node-Graph-Material-Editor (Hochaufwand, keine Datenlage).
- Compute-Heightfield, FFT und SPH im Zeitraum (Parität bricht, Kaninchenbau).
- Unreal-artige Wasserkörper-Mesh-Pipeline (die `Plane`-Segmentierung bleibt).
- „Probe == Shader-Feld per GPU-Readback" **als vitest-Abnahme** (im Harness nicht ausführbar; per Headless-GL-Skript inzwischen doch, §17.2).
- Golden-ratio-Spread „implementieren oder streichen": gestrichen. Die Option „als *eine* gebundene Konstantenmenge passend zum heutigen Sechs-Wellen-Verhalten" ist bewusst entfallen.

### 15.9 Prozess-Befunde

- **Dokumentarischer Schwund:** `liquid-improve.md` und `liquid-architecture.md` sind aus dem Repo entfernt. Die Zeilenzitate daraus (`:229`, `:323`, `:203-208`, `:239`, `:250`, `:314`) sind nur noch indirekt belegt (Inventar, Roadmap, Boards, ADR, `CONTEXT.md`). Die Board-Labels F24/F28 `[VERIFICATION_PASSED]` in `docs/research/stylized-water/board-showcase-10-quality.md` werden **nicht** revidiert (sie gelten für den Post-Fix-Stand von T5 bis T11); die T2-Bilanz ist ein Addendum.
- **Amendment-Nachweis:** Alle neun Amendments von Alice und alle sieben von Bob sowie Erins acht und Franks A1 bis A4 sind in P2 als „present" gegengeprüft.

---

## 16. Technische Details: Formeln, Zeilenanker, Fallen

Zeilenangaben stammen aus dem Inventar vom 2026-10-05. Uncommittete Shader-Änderungen (Caustic-Masking) und der Showcase-Umbau vom 2026-10-07 können sie verschoben haben; vor dem Übernehmen gegen den Stand prüfen.

### 16.1 Formeln und Konstanten

| Thema | Formel oder Wert | Ort |
|---|---|---|
| Gerstner-Dispersion | `ω = √(9,81·k)`, `k = 2π / max(Wellenlänge; 0,001)`, Amplitude `a = steepness / max(k; 0,001)` | `chunks/liquid_gerstner_wave.glsl:10`, `.wgsl:10` |
| Gerstner-Term | `f = k·dot(dir, wp.xz) − ω·speed·time`, Auslenkung `(dir.x·a·cos f, a·sin f, dir.y·a·cos f)`; die Ableitungen für Tangente und Bitangente liefert derselbe Chunk (`:16-28`) | Chunk |
| Zusatzwellen | w4 = `(w1.y, −w1.x, w1.z·0,45, w1.w·0,42)`, w5 = `(−w2.y, w2.x, w2.z·0,35, w2.w·0,35)`, w6 = `(w1.x·0,5 − w1.y·0,866, w1.x·0,866 + w1.y·0,5, w1.z·0,25, w1.w·0,22)` | `S/OpenWater.vert.glsl:94-96` |
| Jacobi-Kamm | `J = t.x·b.z − t.z·b.x`; `J ≤ 0` bedeutet Faltung; `v_crest = clamp((1 − J) / max(Σ steepness; 0,001); −1; 1)`; Konsum `smoothstep(0,65; 0,95; v_crest)·foamPattern·0,5` | `S/OpenWater.vert.glsl:113-119`, `frag.glsl:113-115` |
| Kaustik OpenWater | `pow(c1·c2; 1,6)·3,2`, Fade `exp(−depthDiff·0,7)·smoothstep(0,05; 0,4; depthDiff)`, Gain `·0,1`, Strahlprojektion `groundXZ` (Zeile 123 ist die Wall-Smear-Stelle) | `S/OpenWater.frag.glsl:119-132` |
| Spekular OpenWater | `pow(nDotH; 1200)·0,8`; Himmelskonstante `vec3(0,6; 0,8; 1,0)` | `frag.glsl:91`, `:85`; `.wgsl:58` |
| Beer-Lambert | `exp(−depthDiff · waterAbsorption)` pro Kanal, In-Scatter-Boden | `S/OpenWater.frag.glsl:70-78` |
| Auftrieb | `F_buoy = −gravity.y · density · displacedVolume`, Eintauchtiefe aus AABB-Überlapp | `physix/fluids/BuoyancySolver.ts:76-92,111-124` |
| Clapotis | `D_ref = D_inc − 2·(D_inc·n)·n`; Amplitudenfalle ≈ 2A nahe der Wand; Stehwellenknoten ≈ Wand − λ/4 | geplant (S3) |
| Posterize | `floor(inkTone·(N−1) + 0,5) / (N−1)` ergibt genau N Ebenen; `inkSteps = max(u_styleA.w − 1,0; 1,0)` | `NoirWaterMaterial.ts:104-105` |
| Splat-Lane | `vec4 = (pos.x, pos.z, spawnTime, energy)`; Energie ∝ Aufprallgeschwindigkeit; Ripple-Fade `(1 − smoothstep(0; 5; depthDiff))` | geplant (S2) |
| Kelvin-Wake | 19,47°-Keil | zurückgestellt (D2) |
| Glint | 8 fps (Sparkle), 12 fps (Soft, nicht beobachtbar weil `glitter = 0`); `stepFps = isSparkle ? 8 : 12` | `StylizedWater.frag.glsl:177` |
| Style-Dispatch | 0,5-Margin-Integer-Selektoren; Painterly `(styleId > 0,5 && < 2,5) \|\| styleId > 3,5`; `styleId == 3,0` ⇒ `isExtension = true`, `painterly = false` | `StylizedWater.frag.glsl:55-60`, `.glsl100:52-57`, `.wgsl:22-27` |

### 16.2 Weitere Zeilenanker

- **Stylized:** `S/StylizedWater.frag.glsl` `:43-46` (`aaStepMask`, auf GL1 feste Breite `.glsl100:41-43`), `:75` (`depthDiff`), `:102`/`:118` (Anime- gegen Legacy-Toon-Kaustik), `:138-144` (harte Tiefenrampe `mix(shallow → mid → deep)`), `:155-160` (Dredge-Fog), `:163-167` (`skyTint`), `:176-180` (Sparkle-Glint), `:183-199` (Ripple-Striche), `:201-206` (Sparkle-Schulter-Clamp), `:216-230` (Schaum).
- **Stylized, Material:** `StylizedWaterMaterial.ts:17-40` (`composeStylizedWaterSources`), `:79-100`, `:102-178` (`STYLE_PRESETS`), `:203-268`, `:288-300` (Lane-Packing).
- **Extensions:** `NoirWaterMaterial.ts:11` (Semantik „Anzahl Tintenebenen"), `:67-69`, `:90`, `:94-135`; `OilSlickMaterial.ts:76-78`, `:97`, `:101-178`, `:120`, `:132`.
- **Wellen-Familie, Lanes:** `LiquidWaveMaterial.ts:41-43` („zero spare float slots left"), `:54` (`time`), `:91-130` (zweckentfremdete Lanes: `shininess` = refractionStrength; `isSkinned`/`boneOffset`/`pad1` = absorption; `isTerrain`/`metallic`/`roughness` = foamColor; `useEnvMap`/`useReflectionMap`/`pad2`/`pad3` = Schaumparameter; `specColor` = deepWaterColor), `:104-108` (wave1 bis wave3), `:181-193` (Texturen `u_opaqueMap`, `u_opaqueDepthMap`). Fluss-Familie: `FluidSurfaceMaterial.ts:187-243`.
- **Physik:** `physix/FluidVolume.ts`, `physix/fluids/BuoyancySolver.ts`, `physix/PhysicsSystem.ts:118,120,296,298-304` (Aufnahme und Integration; `PhysicsSystem` ist pro Engine-Instanz, also der natürliche Aufnahmepunkt ohne Singleton), `RigidBody.ts:200` (`wakeUp`, nichts mit Wasser).
- **Renderer:** `WebGL1Renderer.ts:688-690` (Far-Depth-Default), `:666-667` (NEAREST), `:973` (farbgebunden); `WebGL2Renderer.ts:1310-1312`, `:1614-1617` (Half-Float); `WebGPURenderer.ts:660,729` (Compute: Cluster-Cull, HZB), `:1861-1868`; `post/passes/AOPassGPU.ts:47`.
- **WebGL1-Ersatzpfade:** `S/OpenWater.frag.glsl100:28,32-37` (Mesh-UV-Stand-in), `:48-50` (Screen-UV, Refraktionsquelle), `:56-64` (Fresnel-Proxy statt Absorption), `:72` (Spec-Lobe), `:76,91` (Edge und Foam auf Streiflicht gegatet), `:120` (Kaustik-Fade via Fresnel).

### 16.3 Fallen und Gotchas

- **Murk ist strukturell:** Unter dem vollen 256-Byte-Slot und ohne freie Lane ist „Boden lesbar" teilweise nicht erreichbar; jedes Re-Tuning von `waterAbsorption` ist ein Lane-Tausch und muss das Transmittanz-Gate erneut bestehen.
- **Wall-Smear:** derselbe Mechanismus wie F17/F18 ist strukturell noch vorhanden (`OpenWater.frag.glsl:123`); Bobs Vorschlag: physikalischer Clamp über den `linBgDepth`-Gradienten.
- **Spec-Hotspot:** `pow(nDotH, 1200)` auf nahezu flachen Wellennormalen ist ein echter Direktionalsonnen-Hotspot, Konstanten allein reichen nicht (F18).
- **Konstanten-Fallen mit Blowout-Historie:** Caustic-Gain und -Fade, Spec-Exponent und -Gain, Crest-Schwellen, Foam-Maske. Es gibt keinen eigenen Uniform für den Caustic-Gain.
- **f32 gegen f64:** TypeScript-`number` ist f64, GLSL `highp` und WGSL sind f32; die Divergenz wächst mit der Wellenzahl und der Zeit. Der Spiegel braucht `Math.fround`.
- **WGSL-Crest-Transport:** Kammwert in `Out.original_uv.x`, `texIndex` darf nicht genutzt werden (Regex-Injektion in `GPUPipelineCache`-Vertexfunktionen); gehört ins G2-Manifest.
- **Token-Kollision in Shader-Kommentaren:** `ShaderRegistry.assemble` ersetzt jedes `[GROSSBUCHSTABEN_TOKEN]` blind, auch in Kommentaren.
- **GL1-Opaque-Capture:** NEAREST-gefiltert und farbgebunden, Tiefe nicht (Far-Depth-Default). Tiefen-gegatete Dynamik gibt es also nur auf WebGL2/WebGPU, der Farb- und Emissive-Trick auf allen dreien.
- **Compute-Heightfield** bricht die Drei-Backend-Parität (Compute nur WebGPU); Half-Float-FBO-Ping-Pong geht auf WebGL2/WebGPU, auf WebGL1 riskant.
- **Multi-Instanz:** Interaktionszustand muss pro Wasserfläche und app-eigen sein (keine Singletons); `PhysicsSystem` ist bereits pro Engine.
- **Testbarkeitsgrenze:** Nur ein reiner JS-Vertrag ist unit-testbar; Shader-Konstanten sind im vitest-Harness nicht testbar (für die Sonde seit 2026-10-07 per Headless-GL-Skript umgangen).
- **Orphan-API:** Bleiben `FluidVolume` und `BuoyancySolver` ohne Mieter exportiert, ist das selbst ein Claims-gleich-Code-Verstoß.
- **Peer-Grade-Falle:** „Clear ≥ 4/5" ist in CI nicht berechenbar; 1-bis-5-Grades sind nur Kalibrierung.
- **Extension-Schreibreihenfolge:** Noir und Oil überschreiben `props["u_styleA"][3]` nach `super.getRenderManifest()`; ohne T3-Lint bricht jede Reihenfolgeänderung stillschweigend.
- **Material-Studio-Grenze:** Das vorhandene Material Studio deckt nur PBR-Maps ab (`packages/tools/src/material-studio/MaterialStudioController.ts:37`), keine Liquids; der Live-Tune-Pad (D4) darf nicht dort hineinwachsen.

---

## 17. Stand der Umsetzung (2026-10-07) und aufgelöste Widersprüche

### 17.1 Pakete des Plans P2

| Paket | Stand | Anmerkung |
|---|---|---|
| **M1** Goldens und Comparator | **erledigt** (12 Pools / 24 Zellen) | `scripts/goldens/*` (Capture, Compare, README, Konfiguration), blockierender CI-Job `liquid-goldens`. Baseline für alle 12 Pools (24 Zellen, GL2 top/oblique) unter `.agents/goldens/liquid/baseline/` neu aufgenommen. Laufzeit durch `frames: 60` und Paging-Fix von >2h auf ~3 Minuten optimiert; `goldens:compare` verifiziert 24/24 Zellen (0.0000% diff). |
| **M2** Perf-Methodik | **erledigt** | `scripts/perf-liquid.mjs` (`npm run perf:liquid`) als Standalone-Benchmark (>20–50M ops/s) und `LiquidZeroAlloc.test.ts` mit Zero-Allocation Assertion, Manifest-Buffer-Wiederverwendung und 0 MathPool-Leaks über alle Liquid-Materialien. |
| **T1** Testmatrix | **erledigt** | `ShaderValidation` und `ShaderAssembly.test.ts` decken alle 18 Materialien (inkl. StylizedWater, Lava, Slime, Skybox, Frostglass, Wireframe) über `ShaderRegistry.instance.assemble` ab (36/36 Tests grün). |
| **T2** Claims-Korrektur | **erledigt** (§10) | Marker-Lint `scripts/check-verified-markers.js`, Bilanz 2/6, `UniversalFluidMaterial` → `StylizedWaterMaterial`, „golden ratio" gestrichen |
| **T3** Lane-Contract-Registry | **erledigt** | `scripts/lane-contracts/` (Register, Schema, Scan), `LiquidLaneContracts.test.ts`, ADR 0026 (256-Byte-Uniform-Moat); die Einträge `s1-surface-probe`, `s2-splat-lane` und `s3-wall-contract` sind registriert und verifiziert |
| **T4** Style-Identity-Test | **erledigt** | `StylizedWaterStyleDispatch.test.ts` |
| **H4** Konstanten, Differential-Grader | **erledigt** | Named Shader Constants (`CAUSTICS_GAIN`, `CAUSTICS_SCALE`, `CAUSTICS_FADE_EXPONENT`, `CREST_FOAM_THRESHOLD_LOW/HIGH`, `SPECULAR_EXPONENT`) in GLSL300/GLSL100/WGSL; `scripts/goldens/differential-grader.js` (`npm run goldens:grade`) verifiziert quantitative Kontrast-, Clip- und Lobe-Schwellen (24/24 bestanden). |
| **H5** Dead-Option-Lint | **erledigt** | `packages/engine/tests/core/materials/DeadOptionLint.test.ts` verifiziert alle MaterialOptions auf aktive Nutzung / `@deprecated`-Konsistenz. |
| **S1** Wellen-Sonde ↔ Auftrieb | **erledigt** | Probe `OpenWaterSurfaceProbe` mit f32-Spiegel aller sechs Wellen und Weltpunkt-Abfrage `surfaceHeightAt` (Newton), Hook `FluidVolume.surfaceHeightAt`, Tests mit Toleranz pro Vektor, GPU-Paritätsskript (`probe:gpu-parity`), `ShowcaseBuoyancyIntegration.test.ts` (Schwimmkörper, Bobbing, Fluid-Dichte). In Showcase 10 verdrahtet. |
| **S2** SurfaceRippleField | **erledigt** | `emitSplat(x, z, time, energy)` in `LiquidWaveMaterial`, Ringwellen-Auslenkung in GLSL300/GLSL100/WGSL; Drop-Impact in Showcase 10 verdrahtet; `SurfaceRippleField.test.ts` verifiziert. |
| **S3** Clapotis | **erledigt** | Analytische Beckenwand-Reflexion $D_{\text{ref}} = D_{\text{inc}} - 2(D_{\text{inc}} \cdot \mathbf{n})\mathbf{n}$ im Vertex-Stage (3 Backends), null Uniform-Kosten; in `SurfaceRippleField.test.ts` und Showcase 10 verifiziert. |
| **D4** Live-Tune-Pad | **erledigt** | `LiveTunePad.ts` (Keyboard-first `[`/`]`, Pfeiltasten, `0` Reset Knob, `Shift+0` Reset All) in Showcase 10 integriert und unit-getestet (`LiveTunePad.test.ts`). |
| **Block L** (§11.1) | **erledigt** | L1 (`WorldMaterial` lit), L2 (`sampleDirShadow` für Lava/Slime/Öl), L3 (Oberflächenschatten für `OpenWater`, `StylizedWater`, Dredge, Noir), L4 (echtes Shadow-Map Caustic Masking via `sampleDirShadow` am Beckenboden), L5 (Schattenlogik-Konsolidierung über `DIR_SHADOW`/`WGSL_DIR_SHADOW`), L6 (Default vs. App-Doku). |
| **§8.6** ADR-0013-Verdikt, Wellen-Datenmodell | **erledigt** | ADR-0013-Verdikt-Update mit 256-Byte-MOAT-Verankerung ergänzt; kanonischer Guide `docs/guides/liquid-wave-data-model.md` verfasst und in `docs/guides/index.md` verlinkt. |

### 17.2 Aufgelöste Widersprüche zwischen den Blättern

1. **S1-Parität: „im Harness nicht berechenbar" gegen „Readback verlangt".**
   Runde 2 (Bob, Dave, Erin) erklärte „Probe == Shader" für unausführbar im vitest-Harness; §11.3 verlangte danach wieder einen Readback oder den D5-Fallback. **Auflösung:** Es geht außerhalb von vitest. `scripts/probe-gpu-parity.js` (`npm run probe:gpu-parity`) kompiliert den **echten** OpenWater-Vertex-Shader mit dem echten Gerstner-Chunk in Headless-Chrome, liest `v_worldPos` per Transform Feedback aus und vergleicht mit der Probe. Gemessen: SwiftShader ≤ 0,12 mm (0,04 bis 0,12 mm), echte GPU 0,3 bis 13 µm. Das liegt weit innerhalb von Bobs Vorschlag (`5e-4 m`). Die Toleranz wird jetzt **pro Vektor** aus Amplitude und Phasengröße abgeleitet (die frühere globale Schranke von 7,28 m war mehr als das Zehnfache der maximalen Wellenhöhe der realistischen Fixtures und fing keinen mittleren Fehler); ein Test beweist, dass ein 2-%-Steilheitsfehler in einer Welle erkannt wird. Der D5-Fallback („Probe als Debug-Hilfe") wird damit nicht gebraucht.
2. **Position statt Ruheposition (korrigiert §11.3).** Dort stand „per Fixpunkt-Iteration bestimmen". Die Fixpunkt-Iteration konvergiert nicht, sobald die Summe der Steilheiten aller sechs Wellen (inklusive der drei abgeleiteten) über 1 liegt. `surfaceHeightAt` löst `rest + Auslenkung(rest) = Ziel` stattdessen mit **Newton und analytischer Jacobi-Matrix**. **Gültigkeitsgrenze:** Bei sehr steilen Lane-Sets (Summe der Steilheiten ≈ 2,2) liegen mehrere Vertices über einem Weltpunkt, die Abfrage ist dort nicht eindeutig (im Code dokumentiert); die Ruheposition stimmt trotzdem.
3. **Kelvin-Wake: Franks H2.1 enthält ihn, §8 sagt OUT.** Es bleibt OUT (§15.2). Franks Horizont-Bild behält ihn als Zukunftsitem; die Wiederöffnungsbedingung steht in §14.5.
4. **Gate-Nummerierung E1 gegen P2.** Siehe §15.4: E1-G7 („Zero TODO drift") gegen P2-G7 (D1-Grep-Covenant), und G9 ist in G3 aufgegangen. Bei Übernahme beachten, ein Verweis „G7" ist ohne Quelle mehrdeutig.
5. **Inkonsistenz in §8.5 (Erin, Runde 3).** Dort fehlte G5-GL2 in der Liste der blockierenden Gates. Behoben: §8.5 führt „G5-GL2 (Golden-Comparator, blockierend gemäß M1)".
6. **Stand der Blätter gegen heute.** Die Blätter vom 2026-10-05 beschreiben die Lage **ohne** Verdrahtung von `FluidVolume`, ohne Probe, ohne T1 bis T4 und ohne Golden-Infrastruktur. Wo ein Blatt „fehlt" sagt, ist das der Stand von damals; maßgeblich ist §17.1.
7. **Posterize:** Erins Runde-1-Befund ist zurückgenommen (§15.3); Runde-1-Zitate dazu sind überholt.
8. **Compute-Tier-Policy-ADR und Alices Wasser-Pass-Studie** fehlen in §8, sind aber als Horizont-Aufgaben bewusst nicht im Nahplan (§14.2, §14.3).
9. **Veraltete Zeilenanker:** Alle Verweise auf `apps/showcases/10/showcase.ts` (Zeilen 97 bis 135, 269 bis 546, 1083 und folgende) stammen aus der Zeit vor dem Umbau zum 3×4-Raster mit zwei Buoyancy-Pools und sind überholt.

### 17.3 Offene Punkte, nach Dringlichkeit

1. **Formale Abnahme & G6-Bestätigung** im CI-Verbund.
2. **Horizont-Aufgaben** (Compute-Tier-Policy-ADR, Alices Wasser-Pass-Machbarkeitsstudie) nur, wenn ein Showcase sie braucht.

---
## ⏹️ Verhandlung durch Moderator beendet — 2026-10-07
- **Letzter Stand:** Runde 3, aktiver Agent: Alice.
- **Status:** Beendet nach erreichtem Konsens — P2 „Liquid Roadmap" einstimmig (6/6: Alice, Bob, Charly, Dave, Erin, Frank), Konsens-Vorschlag im pid dokumentiert; in §17.1 sind alle Pakete M1/M2/T1–T4/H4/H5/S1–S3/D4/Block L/§8.6 als umgesetzt vermerkt. Die laut §17.3.1 noch offene **formale Abnahme & G6-Bestätigung im CI-Verbund** ist kein offener Verhandlungspunkt dieser Session mehr, sondern ein externes QA-Gate am committeten Produktivcode (Umsetzung bereits in `git log` vorhanden) — davon getrennt zu behandeln.
- **Session-Dateien** (pid rev 9, `session_terminated_by_moderator`) unter `.agents/collaborate/` archiviert; Topic-Dokument bleibt als Entscheidungs- und Umsetzungsprotokoll erhalten.
