# Rework Prolog-Szene — Koje 42 & Kältekammer K-42 (Figuren-Diorama)

**Dokumenttyp:** Kollaboratives Anforderungs- & Umsetzungsdokument (`collaborate` Modus `plan`)
**Topic-Dateien:** `.agents/collaborate/rework-scene.md` + `.agents/collaborate/rework-scene.pid`
**Stand:** 2026-10-11
**Moderator:** Mensch (Projektverantwortlicher)
**Ziel:** Komplettes Ausstatten & Re-Staging der Szene `apps/sample-apps/the-whisper/scenes/prologue/index.html` (Koje 42 & Kältekammer K‑42) als texturiertes, kit-basiertes **Figuren-Diorama** im Stil der Character-Diorama-Showcase – ohne sichtbar programmatisch erzeugte Objekte, mit steuerbarer Spielerin („Novotny Female“), ohne Laterne, mit neuem, **öffnbarem** Panzertür-Asset.

---

## 0. Verbindliche Spielregeln dieser Session

- **Modus:** `plan` (Ziele finden → kollisionsfreier Umsetzungsplan → Umsetzung & Abnahme, Skill-Abschnitte 1–9 + `implementation-phase.md`).
- **Rundenlimit:** `max_rounds = 15`. Reicht das nicht, **genau einmal** `--extend 5` → 20. Danach ist absoluter, dokumentierter Schluss (`terminated`).
- **Teilnehmer:** 6 Agenten (Roster unten). Aufgaben werden **kollisionsfrei der Reihe nach** verteilt; paralleles Arbeiten nur dort, wo die Ownership-Tabelle Konflikte ausschließt.
- **Peer-Plausibilitäts-Review:** Jede als „fertig“ gemeldete Aufgabe (`[TASK_DONE]`) wird von einem **anderen** Agenten auf Plausibilität geprüft. Findet er Mängel → `[REWORK_REQUEST]` mit Begründung → Nacharbeit. **Endlosschleifen-Vermeidung:** max. **2 Nacharbeits-Zyklen je Aufgabe**; danach Eskalation an den Moderator (`--decide`/`--note`). Ein Reviewer kann dieselbe Aufgabe nicht beliebig oft zurückweisen.
- **Sprachregel (Skill):** Agenten untereinander, Beiträge im Topic-Dokument, Board-Einträge, `[AGREED]`-Begründungen und Abschlussberichte **auf Englisch**. Meldungen an den Moderator auf Deutsch. Protokoll-Token bleiben englisch.
- **Verifikation:** Nach jeder Umsetzungsänderung `npm run lint:fix`, `npm run build:lib`, `npm run test` (Stand v0.89.0: 201/1194 grün; `SDFShaderChunks`/Showcase-Flakes sind bekannte Last-Flakiness). **Ein grüner Build ist keine Laufzeitverifikation** – zusätzlich Dev-Server-Inspektion über `(window as …).__prologue`.
- **Arbeitsweise:** Dies ist ein Langzeit-Rework. Der Moderator rechnet mit vielen Tagen / ~2 Wochen menschlicher Arbeit – es wird Versuch-und-Irrtum geben, insbesondere beim Tripo-Tür-Rework. Keine Eile, keine oberflächlichen „Quick Wins“ auf Kosten der Plausibilität.

---

## 1. Ausgangslage / Ist-Zustand (Fakten aus dem Repo)

### 1.1 Betroffene Dateien
- `apps/sample-apps/the-whisper/scenes/prologue/index.html` (HUD, Kanvas; Titel bereits „Koje 42 & Kältekammer K‑42“)
- `apps/sample-apps/the-whisper/scenes/prologue/prologue.ts` (Story-Controller, Kamera-Timeline, Prozedur-Architektur, Player-Manekin, Deco)
- `apps/sample-apps/the-whisper/scenes/prologue/koje42.level.json` (deklarativer Level-Deskriptor, 12 Props + Licht + 6 Hotspots)
- `apps/sample-apps/the-whisper/scenes/prologue/kaeltekammer.level.json` (deklarativer Level-Deskriptor, 2 Props)
- Diorama-Vorlage: `apps/sample-apps/the-whisper/scenes/character-diorama/showcase.ts`

### 1.2 Kit- & Texture-Inventar (lesen, bevor neue Assets gebaut werden)
- **`bunker`** (11 Props): coffee_grinder, terminal_2100, bunk_bed, metal_stool, kerosene_lantern, combat_boots, metal_desk, wall_shelf_supplies, mess_tin_set, hanging_towels, worn_rug.
- **`flakturm`** (6 Props / 9 Textur-Sets / 6 Decals): bunker_blast_door, **bunker_blast_door_leaf (animierbar! Scharnier-Anker −X-Kante, Ursprung Bodenmitte)**, debris_rubble_pile, bunker_vent_hatch, ceiling_lamp, vent_wall_breach; Texturen: concrete_board, brick_aged, concrete_weathered, concrete_panel_smooth, concrete_damp_efflorescence, steel_corroded, steel_painted, stone_ashlar, travertine; Decals: sign_hausangehoerige, sign_sektor0, sign_koje42, hazard_stripes, guide_stripe_glow, rebar_damage.
- **`industrial`** (4 Props): wall_lamp (Bulkhead-Wandleuchte, `LightBulb`-Socket), barrel_oil_black, barrel_hazard_yellow, barrel_chemical_blue (ADR/GHS-Beschriftung).
- **Prompts für Neuerstellung:** In jedem `meta.json` ist das Feld `description` ein brauchbarer Tripo-Prompt-Seed (z. B. `flakturm/bunker_blast_door_leaf` beschreibt exakt Geometrie, Origin und beabsichtigten Animations-Pivot). Für Figuren/Mannikins: `docs/player_tpose_reference_prompts.md` (T-Pose-Turnaround-Prompts) + `docs/concept-dossier.html`. **Neue Props folgen dem `character-pipeline`-Skill** (Property-Generation: isoliertes Front-Bild → `tripo make … --for game-mobile` → GLB → `meta.json` + `preview.jpg` + Registrierung in `kit.json` → Pflicht-Tests `AssetKitValidation.test.ts`).

### 1.3 Bekannte Probleme / Quirks (nicht ignorieren)
- **Panzertür ist bewusst statisch** (Log 139): `flakturm/bunker_blast_door` ist ein massiver, fast würfelförmiger Tripo-Block (~0.92×1.0×0.94 m), dessen Meta (1.8×2.2×0.25 m) unzuverlässig ist; „Öffnen“ wurde als Lichtstrahl-Choreografie erzählt. **Wird per Moderator-Entscheidung ersetzt** (siehe 3.3). Einzelblatt-Vorlage existiert bereits (`bunker_blast_door_leaf`).
- **Kein Decal-System in der Engine:** Decals = transparente Ebenen (Plane + `StandardMaterial`: `diffuseMap=alphaMap`, `transparent=true`, `cullMode=NONE`). An der +X-Wand `Texture.flipX()` (Y-Drehung spiegelt den Stencil). Vorbild: `prologue.ts` `_createDecalPlane`, `_placeSceneDecals`.
- **Level-JSONs MÜSSEN unter `apps/` bleiben:** `packages/engine/tests/loaders/LevelValidation.test.ts` (`findLevelFiles`) scannt nur `repoRoot/apps`.
- **Laden nur via `new URL("./<file>.level.json", import.meta.url)`** – absolute Pfade 404en still (P0-Fix aus Log 139, nicht zurückfallen).
- **Tripo-Metadaten unzuverlässig:** Maße beim Platzieren immer per Bounding-Volume messen (Vorbild `_measureLocalHalfExtents`), nicht auf `meta.json`-Dimensionen bauen.
- **Planet-Manekin ist prozedural** (Cubes): `_buildPlayerCharacter` baut Körper aus Quadern. Wird durch das geriggte **Novotny-Female**-Asset ersetzt (`public/assets/the-whisper/mannequin/player-female/character.glb`, aus der Diorama-Pipeline).
- **Laterne an der Spielerin entfernen:** In dieser Szene gibt es **keine Laterne** (kein Hand-Socket nötig; Licht der Szene kommt aus Raum-Props).
- **Kältekammer ist teils prozedural:** Fächerschrank-Rack (Cubes), herausgezogene Trage, Leichen-Abdeckung, Ammoniak-Rohr, Frost-Partikel, Decals. Nach Scope-Entscheidung 3.2 umbauen.

---

## 2. Gemeinsames Zielbild (Phase A — Pflichtthemen vor Konsens)

> Diese Liste ist der Rahmen für den Zielkonsens (`[CONSENSUS_PROPOSAL]`). Sie wird in Runde 1–3 von allen Agenten geschärft, aber die nicht verhandelbaren Punkte (gekennzeichnet `[FIX]`) stehen fest.

1. **Auftrag** `[FIX]`: Koje 42 **und** Kältekammer K‑42 komplett ausstatten – alle sichtbaren Flächen (Wände, Boden, Decke) mit Textur belegt, alle Möbel/Props aus den Kits, keine sichtbar graue Greybox, keine sichtbar programmatisch erzeugten Objekte.
2. **Optik** `[FIX]` (vage vorgegeben, konkret auszugestalten): Optik im **Figuren-Diorama-Stil** wie `character-diorama` – tonal der Character-Showcase, stimmig zum „Graphic Noir“-Grundton der Whisper-App.
3. **Perspektive** `[FIX]` (Moderator-Entscheidung): Szene als **Figuren-Diorama / 2.5D-Bühne** (Little-Nightmares-artiger Bühnenschnitt, story.md Sicht „2.5D-Theaterbühnen-Schnittmodell“, `docs/guides/2-5d-scenes.md` konsultieren). Dramatische, feste Kamera-Winkel; die Spielerin ist **steuerbar** (WASD/Pfeile), Hotspots + Timeline bleiben funktional.
4. **Kit-First & Modularität** `[FIX]` (modifizierte Moderator-Entscheidung): Architektur bleibt Geometrie, aber **vollständig mit Kit-PBR-Texturen** belegt. Harte Möbel/Props kommen aus Kits. **Alles-Weitere-als-Kit-Asset nur dort, wo es echte Modularität erzeugt** (d. h. der einfache Zusammenbau weiterer Level). Einzelstücke ohne Wiederverwendungs-Zweck dürfen texturierte realistische Geometrie bleiben. Leichte Atmosphäre (Staub/Frost) bleibt dezentes Detail, sofern unsichtbar programmatisch.
5. **Spielerin** `[FIX]`: „Novotny Female“ aus der Diorama-Pipeline übernehmen (`player-female/character.glb`), steuerbar, **ohne** Laterne. Perspektive folgt der 2.5D-Bühne.
6. **Bunkertür** `[FIX]` (Moderator-Entscheidung): via Tripo **neu gebaut**, **öffnbar** (zweiflügelig / je ein animierbares Flügelrichtig mit echtem Scharnier-Anker). Im Prolog **narrativ gesperrt** (von außen zugeworfen), aber die Timeline/Tür „öffnet“ real per Flügel-Animation – **nicht** mehr nur Licht-Choreografie. Für spätere Level öffenbar.
7. **Plausibilität** `[FIX]`: Jede Platzierung (Props, Texturen, Lichter) wird auf nachvollziehbare Plausibilität geprüft – **Props sind keine generischen Objekte**. Konkretes Beispiel (vom Moderator): *Ein Stockbett ist kein normales Bett, die Höhe ist unterschiedlich* – `bunk_bed` hat z. B. `TopBunk`-Socket bei +1.25 m und `BottomBunk` bei +0.35 m; obere/untere Etage, Durchstiegshöhe und Wand-/Deckenabstand müssen das widerspiegeln.
8. **Recherche & Lernen** `[FIX]`: Unklarheiten → Internet-Recherche; ein bisschen modernes Level-Design in 3D-Engines (z. B. Godot) als Referenz aneignen (Phase-0-Aufgabe).
9. **Rundenbudget** `[FIX]`: 15 Runden, einmalige Erweiterung auf 20, dann dokumentierter Schluss.

---

## 3. Moderator-Entscheidungen (verbindlich, in die Ziele übernommen)

| # | Thema | Entscheidung |
| :-: | :--- | :--- |
| 3.1 | Perspektive | **2.5D-Figuren-Diorama/Bühnen-Schnitt**; Spielerin steuerbar; Hotspots/Timeline bleiben. |
| 3.2 | „Kein Programmatisches“-Scope | Architektur texturiert (Kit-PBR); Möbel/Props aus Kits; Kit-Assets, wo Modularität entsteht; Einzelstücke dürfen texturierte Geometrie sein; dezente Atmosphäre-Partikel erlaubt. |
| 3.3 | Bunkertür | Tripo-Neubau eines öffenbaren Doppelflügel-Assets (bzw. set aus zwei Einzelblättern nach Vorbild `bunker_blast_door_leaf`). Im Prolog narrativ gesperrt, reale Flügel-Animation in der Timeline. |

---

## 4. Roster & kollisionsfreie Aufgabenbereiche (Phase B)

| Agent | Rolle | Eigener Zuständigkeitsbereich (Ownership) | Nicht anfassen (fremde Ownership) | Review-Zuständigkeit |
| :-- | :--- | :--- | :--- | :--- |
| **Alice** | Asset & Prop Lead | Neue Kit-Props (v. a. **Panzertür-Doppelflügel**), `public/assets/kits/*/<prop>/`, `kit.json`-Registrierung, `meta.json`/`preview.jpg`, Tripo-Job-Prompts (in Kit-Stil) | `prologue.ts`-Logik, Level-JSONs | Reviewt T2/T5 |
| **Bob** | Texture & Material Artist | Alle PBR-Textur-Zuordnungen & Material-Overrides, ggf. neue Textur-Sets im exakten Kit-Stil, `public/assets/kits/*/textures/` | Prop-Geometrie, Level-JSONs | Reviewt T1/T6 |
| **Charly** | Level Design & Staging Lead | 2.5D-Bühnen-Schnitt **beider Räume**, Platzierung/Maße/Clearances, Flächen-Katalog (welche Wand bekommt welche Textur), Plausibilität der Anordnung | Lichter-Intensitäten, Engine-Code | Reviewt T4 |
| **Dave** | Lighting & Atmosphere | Licht-Plan **ohne Laterne** (Deckenleuchte, Wandlampen, Kerosin-Leuchte, Türstrahl), Sockets, Flicker/Atmo, Post-FX-Abstimmung zum Noir-Look | Prop-Positionen, Texturen | Reviewt T3 |
| **Erin** | Integration & Engine Lead | `prologue.ts`, beide `*.level.json`, KitRegistry-Aufrufe, **Spielerin-Female-Integration + Steuerung**, **Tür-Animation**, Kamera der 2.5D-Bühne | Asset-Dateien in `public/assets/kits/` | Reviewt T1/T2 |
| **Frank** | QA, Plausibility Review & Documentation | Diff-Perimeter-Wächter, Laufzeit-/Build-Verifikation, `docs/log.md`-Eintrag, Verlaufs-Dokumentation, `[VERIFICATION]`/`[REWORK_REQUEST]`-Logik | Pro-Code-Arbeit erst nach Freigabe | **Primär-Reviewer** (löst Peer-Reviews aus; Reviews führt nach Rotation auch der jeweils andere Agent) |

- **Kollisionsfreiheit:** Jede Aufgabe (`T<n>`) bekommt genau **einen** Owner aus obiger Tabelle. Überschneidungen (z. B. „Tür“ zwischen Alice und Erin, „Textur auf Wand“ zwischen Bob und Charly) werden über die Schnittstelle **level.json / kit.json / meta.json** entkoppelt (`[OVERLAP: …]`-Marker nach Skill).
- **Peer-Review:** Nach `[TASK_DONE]` prüft ein **anderer** Agent (Frank koordiniert) auf Plausibilität, Stil, Maße, Modularität. Ergebnis `[VERIFICATION_PASSED]` oder `[REWORK_REQUEST]`. Max. 2 Rework-Zyklen, dann `[ESCALATION]` → Moderator.

---

## 5. Phasen- & Rundenplan (15 → max. 20)

| Phase | Runden | Inhalt | Ausgang |
| :-- | :-- | :--- | :--- |
| **Phase 0** | R1 | **Recherche & Lernen** (Internet): 2.5D-Leveldesign (Little Nightmares, Godot-Praxis), Bunker-Interior-Referenzen, Prop-Maßtabellen (Stockbett, Türflügel, Lampen-Höhen), Tripo-Workflow für animierbare Doppeltür. Ergebnis: Referenz-/Maßblatt je Agent. | `[RESEARCH]`-Blöcke im Topic |
| **Phase A** | R2–R3 | Zielbild (Abschnitt 2) schärfen, Plausibilitäts-Doktrin präzisieren, **Task-Katalog T1…Tn finalisieren**, `[CONSENSUS_PROPOSAL: P1]` → Unterschriften → **Konsens** | `consensus.reached: true` |
| **Phase B** | R4–R13 | Aufgaben **der Reihe nach kollisionsfrei** abarbeiten (Task-Katalog unten), je fertiger Aufgabe Peer-Plausibilitäts-Review + ggf. 1–2 Rework-Zyklen; zwischenzeitlich Laufzeit-Verifikation | Tasks `[TASK_DONE]` + je `[VERIFICATION_PASSED]` |
| **Phase Abnahme** | R14–R15 | Finale Review-Runde (Komplett-Durchlauf beider Räume), Behebung letzter Restpunkte, `[ABNAHME_ERTEILT]`, `--stop` | `status: terminated` |
| **Nur einmalig** | – | Reicht das Rundenbudget nicht: **genau einmal** `--extend 5` → 20. Danach absolute dokumentierte Schlussrunde, keine weitere Verlängerung. | `terminated` |

---

## 6. Task-Katalog (Kandidaten; Finale Verteilung in Phase A, kollisionsfrei)

| Task | Owner | Inhalt (Kurz) | Kollision |
| :-- | :-- | :--- | :--- |
| **T1** – Panzertür-Asset | Alice (Erin Review) | Tripo-Neubau Doppelblatt (Vorbild/Prompt: `flakturm/bunker_blast_door_leaf` meta), `meta.json`+`preview.jpg`+`kit.json`, Maße per Bounding-Volume verifizieren. **VERBINDLICH: 4-Tier-Polycount-Doktrin (ADR 0011 §1.1)** — Tier 3 (1–2.5 m): **6.000–10.000 Tris** via `face_limit`, Texturbudget 1024/2048, **Ziel-GLB ~1,0–1,2 MB**, Texturen extern als Kit-PBR-Sets (keine eingebetteten Multi-MB-JPEG/PNG, Ist-Zustand des Leafs = 9,6 MB → Reduktion um ~90 %) | `[OVERLAP: Tür-Anim: Erin]` |
| **T1b** – Tür-Animation | Erin | Zwei Flügel rotieren um Scharnierachse; Timeline-Beat „Tür öffnet/schließt“ = reale Flügel-Animation, narrativ gesperrt von außen; für spätere Level öffenbar | `[OVERLAP: Tür-Asset: Alice]` |
| **T2** – Koje-42-Staging | Charly | 2.5D-Schnitt, Platzierung aller Props aus `koje42.level.json`, Clearances (Stockbett: TopBunk/BottomBunk), Türschwenk, Arbeitsplatz, Regal, Teppich; keine schwebenden/versunkenen Objekte | `[OVERLAP: Textur-Zuordnung: Bob]` |
| **T3** – Kältekammer-Staging | Charly/Dave | Fächerschrank, Wannen, Leichen-Figur, Rohre, Kalt-Decals; **Modularitäts-Test**: Fächermodul als wiederholbares Kit-Prop (zur Wiederverwendung in weiteren Sektor-0-Leveln), sonst texturierte Geometrie | `[OVERLAP: Atmo/Licht: Dave]` |
| **T4** – Texture & Material | Bob | Flächen-Katalog beider Räume (jede Wand/Boden/Decke), aktuelle Sets für Fehlflächen, neue Sets nur im exakten Stil der bestehenden Kits (bei Bedarf Tripo/Gemini + Style-Konformitäts-Check) | `[OVERLAP: Staging: Charly]` |
| **T5** – Lighting & Atmosphere | Dave | Raum-Lichtplan ohne Laterne, Sockets (`FlameGlow`, `BulbLight`, `LightBulb`), Flicker, Türstrahl, Noir-Tonwert; Atmosphäre-Partikel dezidieren (erlaubt, aber unsichtbar-prozedural) | `[OVERLAP: Kältekammer: Charly]` |
| **T6** – Spielerin Novotny Female | Erin | Rig aus Diorama (`player-female/character.glb`) mit Integration nach `character-pipeline` (GltfLoader-Clamps, Rig-Wrapper, `StageMovementBehavior`/Tastensteuerung), **ohne Laterne**, Kamera 2.5D folgt | – |
| **T7** – QA & Freigaben | Frank (+ rotierend) | Diff-Perimeter, `[VERIFICATION]` je Task, Plausibilitäts-Audit, Verifikation (`lint/build/test` + Dev-Inspektion `__prologue`), `docs/log.md` | – |

---

## 7. Plausibilitäts-Doktrin (verbindlich für jede Platzierung)

1. **Maße statt Optik raten:** Jedes Prop vor Platzierung vermessen (Kit-`meta.json` **und** Bounding-Volume). `recommendedScale` als Startpunkt, nicht als Dogma.
2. **Props sind keine generischen Objekte:** Funktion/Höhe/Typ beachten. Beispiele (nicht abschließend):
   - **Stockbett** ≠ normales Bett: `bunk_bed` = 1.1×1.8×2.1 m, `TopBunk` bei +1.25 m, `BottomBunk` +0.35 m – Deckenlicht/Kabel/Regale müssen die obere Etage respektieren.
   - **Türflügel:** Schwenkradius der Doppeltür muss in der 2.5D-Bühne frei bleiben (keine Props im Öffnungsbogen, wenn die Tür sich öffnet).
   - **Leuchten:** Höhe/Reichweite (`distance`, `intensity`) zum Raum (7×7 m Koje) plausibel; Laternen-Socket auf Möbeloberflächen, nicht schwebend.
   - **Kältekammer:** Wannen-Einbauhöhen, Rohrverläufe an Decke, Faulgas-Nähe zur Lüftung – nachvollziehbare Technik.
3. **Kein sichtbares programmatisches Eigenleben:** Keine nackten Greybox-Cubes; keine Texturierungslücken; Partikel nur als dezente, nicht-prozedural wirkende Atmosphäre.
4. **Licht-Plausibilität:** Jede Lichtquelle hat eine sichtbare Quelle in einem Prop/Möbel (kein Licht aus dem Nichts – außer narrativ gewolltem Ambient).
5. **Stil-Konformität:** Texturen/Materialien entsprechen exakt den bestehenden Kits (Bunker/Flakturm/Industrial). Neue Assets sehen aus wie „von dieser Serie“ – Abgleichen gegen `preview.jpg` der Kits + `concept-dossier.html`.

---

## 8. Recherche- & Lernaufträge (Phase 0, dezentral je Agent)

- Godot/o. ä. Level-Design: 2.5D-/Cutaway-Staging-, Spielbarkeits- und Platzierungs-Praktiken → kurze, belegte Notizen (`[SOURCED]`-Tags).
- Bunker-/Flakturm-/Kältekammer-Interieur-Referenzen (Arenbergpark) für Material- und Deko-Plausibilität.
- Prop-Maßtabellen (Stockbetten, Schwerpanzertüren, Industrieleuchten) als Anker für Platzierungen.
- Tripo3D-Workflow für **animierbare** Türmodelle (getrennte Flügel, saubere Origin/Hinge, Gunst-Beschriftung) + PBR-Stil-Abgleich mit bestehenden Kit-Props.
- Jede Recherche: Quellen im Topic-Dokument mit Kurzbegründung; unklare Punkte dürfen zur erneuten Recherche markiert werden.

---

## 9. Rundenlimit & Abbruch-Doktrin

- `max_rounds = 15` (PID-Feld). **Einmalig** `--extend 5` → 20 erlaubt; danach keine weitere Erweiterung.
- Bei erreichtem Limit ohne Abschluss: `status: deadlock` → Zusammenfassung der offenen Punkte → Moderator beendet mit `--stop`/`--decide`. Der Abschluss-Block hält Outcome und offene Restpunkte fest – **dokumentierter Schluss**.
- Endlosschleifen: max. 2 `[REWORK_REQUEST]` je Task; danach `[ESCALATION]` an den Moderator.

---

## 10. Definition of Done / Abnahme-Kriterien

1. **100 % Textur-Bedeckung:** Alle sichtbaren Wände, Böden, Decken beider Räume tragen Kit-PBR-Texturen – keine graue Greybox, keine leeren Flächen.
2. **Kein sichtbar Programmatisches** außerhalb der ausdrücklich erlaubten Ausnahmen (dezente Atmosphäre-Partikel, Engine-Standard-Decals als transparente Ebenen).
3. **Kit-First:** Möbel/Props aus `bunker`/`flakturm`/`industrial`; neue Assets mit `meta.json`/`preview.jpg`/`kit.json`-Registrierung; `AssetKitValidation.test.ts` grün.
4. **Spielerin:** „Novotny Female“, steuerbar (WASD/Pfeile), 2.5D-Diorama-Perspektive, Hotspots/Timeline funktional, **keine Laterne**.
5. **Panzertür:** Tripo-Neubau, öffenbar (zwei Flügel, echte Scharnierachse), narrativ gesperrt, Timeline nutzt reale Flügel-Animation.
6. **Plausibilität:** Maße/Clearances dokumentiert und eingehalten; keine schwebenden/versunkenen/überlappenden Props; Lichtquellen haben sichtbare Quellen.
7. **Verifikation:** `npm run lint:fix` + `npm run build:lib` + `npm run test` grün; Dev-Server-Inspektion der Szene via `__prologue`.
8. **Dokumentation:** `apps/sample-apps/the-whisper/docs/log.md`-Eintrag (append, unten); Verlauf + Outcome im Topic-Dokument; `--stop` mit Abschluss-Block.

---

## 11. Diff-Perimeter (welche Dateien Agenten ändern dürfen)

- `apps/sample-apps/the-whisper/scenes/prologue/prologue.ts`
- `apps/sample-apps/the-whisper/scenes/prologue/koje42.level.json`, `kaeltekammer.level.json` (**in `apps/` belassen!**)
- `apps/sample-apps/the-whisper/scenes/prologue/index.html` (nur HUD-Anpassungen, falls nötig)
- `public/assets/kits/bunker|flakturm|industrial/<prop>/…` (neue/veränderte Props: `model.glb`, `meta.json`, `preview.jpg`)
- `public/assets/kits/*/kit.json`, ggf. `public/assets/kits/index.json` (nur bei neuem Kit)
- `public/assets/kits/*/textures/…` (neue Textur-Sets)
- `apps/sample-apps/the-whisper/docs/log.md` (append)
- **Nicht** anfassen ohne Abstimmung: Engine-Pakete (`packages/engine`, `packages/liquid-extras`), Testsuiten (außer neue Kit-Validierung).

---

## 12. Risiken & offene Entscheidungen (in Phase A aufzulösen)

- **Tripo-Tür-Rework** ist iterativ (Moderator erwartet mehrere Versuche). Fallback: bestehendes `bunker_blast_door_leaf` für die Animation nachbauen/verfeinern, falls Neusourcing scheitert.
- **Skalierung/Quirks** von Tripo-Props: Maße per Bounding-Volume, nie blind der Meta vertrauen.
- **Performance-Budget** (viele Props/Texturen in kleinen Räumen): LOD/Polygon-Disziplin; bei WebGL-Fallback Rendering-Kosten prüfen.
- **Grenze „texturierte Geometrie vs. Kit-Prop“** (3.2): Pro Fall entscheiden mit Begründung `[JUDGMENT]`, Ziel Modularität für spätere Level („einfacher Zusammenbau weiterer Levels“).
- **2.5D-Bühnen-Perspektive vs. Spielbarkeit:** Bühnen-Schnitt darf Steuerung/Hotspots nicht brechen; Kamera-Ziele pro Phase bleiben sinnvoll.

---

<!-- Für Phase A (ab Runde 2): hier das gemeinsame Zielbild verabschieden und den konsensfähigen, nummerierten
[CONSENSUS_PROPOSAL: P<n>] formulieren. Alle Agenten unterschreiben mit [AGREED: <Name> P<n>] samt stärkstem
Restzweifel und Revisionsbedingung (Skill §6). Atomare PID-Schreibvorgänge über collab.mjs oder manual-writing.md. -->

## Round 1: Alice (Asset & Prop Lead) — 2026-10-11

**Phase 0 — Research & Lernen, Alice scope: prop inventory reality-check + Tripo door workflow + dimension anchors.**

### 1. Measured project facts (`meta.json`, tooling-basierte Source) — `[MEASURED]`
- `bunker/bunk_bed`: 1.1 × 1.8 × 2.1 m; sockets `TopBunk` at **+1.25**, `BottomBunk` at **+0.35**. Deck-to-deck gap = 0.9 m — validates the moderator's "bunk bed is not a normal bed" constraint.
- `flakturm/bunker_blast_door_leaf`: 1.6 × 2.0 × 0.25 m; origin at bottom centre; wheel faces +Z; **hinge knuckles on the −X edge**; explicitly intended for rotation around that edge. This is the in-kit working reference for the Tripo door rebuild.
- `flakturm/bunker_blast_door` (current static block): 0.92 × 1.0 × 0.94 m, `recommendedScale 1.0`; meta is unreliable (measure via bounding volume, never trust dims).
- `industrial/wall_lamp`: 0.42 × 1.0 × 0.55 m; `LightBulb` socket at (0, 0, +0.18); recommendedScale 0.38. Mounting ~2.2–2.5 m (diorama uses 2.35), ceiling lamp ~3.0 m.
- `bunker/kerosene_lantern`: 0.18 × 0.36 × 0.18 m; `FlameGlow` socket (0, 0.16, 0) — desk surface, not hand.
- `industrial` barrels: radius ≈ 0.34, height ≈ 1.0, recommendedScale 0.82 — small-batch modular kit items.
- Scene geometry: Koje floor currently 5.0 × 3.5 world units while level.json description claims "7×7m Wohnkoje" — **reconcile real room dimensions with the description** (open item for Charly's staging, §1.1 of the doc).

### 2. Door rework — design proposal `[JUDGMENT]`
- Rebuild via Tripo as **two separate single-leaf assets** (or one GLB with two top-level leaves), each following the existing `bunker_blast_door_leaf` convention: origin at bottom-centre of the full doorway, hinge anchor on the outer leaf edge (X = ±door-width/2), wheel/lock on one leaf only, sliding dogs on the other. Do NOT bake scale/hinge into meta — measure after import.
- **Prompt seed source:** `bunker_blast_door` + `bunker_blast_door_leaf` `description` fields are the style/prompt templates; `steel_corroded` / `steel_painted` PBR sets the material language; `preview.jpg` of kit props = the "same series" check every new asset must pass (compare against `concept-dossier.html` too).
- **BOM:** 2 leaf GLBs + 1 frame/lintel kit prop, each with `meta.json` + `preview.jpg` + `kit.json` registration; `AssetKitValidation.test.ts` must stay green.
- **Scene behaviour:** narratively locked (external bars), but the prop must animate (leaf rotation around ±X hinge) — Erin to define the exact animation/integration contract in T1b.

### 3. Dimension anchors for placement — `[ASSUMED]` + `[JUDGMENT]`
- Real-world double bunks: typical lower-deck clearance ≈ 0.3 m floor→mattress, deck-to-deck ≈ 0.75–0.9 m, upper guard rail ≈ 0.3 m — consistent with our sockets (+0.35 / +1.25). Ceiling lamp @ y≈3.08 vs. top-berth occupant eyebrow height: check interplay (Charly/Dave).
- Door swing arc (2 × ~0.8 m leaf radius, 90°) must stay clear of props — hard placement constraint for the 2.5D stage.
- Bulkhead lamp cabling must run plausibly (wall-following conduit), not float.

### 4. Modularity stance (my role) — `[JUDGMENT]`
- Kältekammer drawer/rack module + pipe segments are the prime **repeatable-module** candidates (future Sektor-0 vaults reuse them). Recommend making them real kit props — this is exactly the moderator's scope rule 3.2 ("kit assets where modularity is gained"); ad-hoc single-use dressing stays textured geometry.

### 5. Research transparency — `[JUDGMENT]`
- Generic web hits for door/bunk dimensions were low-signal; the strongest, most reliable references are **project-internal** (`docs/guides/2-5d-scenes.md` peepshow-box principle, diorama scene, story.md, kit metas). Recommend targeted follow-up searches (lighting ergonomics, Flakturm imagery) inside later rounds instead of a broad sweep.

**Kickoff note for Phase A:** propose the diorama's wall-lamps/barrels/crate styling as the shared "series family" target for every new asset; new props must pass a series-fidelity check against kit previews + concept-dossier before approval. No blocker for Phase B planning.

## Round 1: Bob (Texture & Material Artist) — 2026-10-11

**Phase 0 — Research & Lernen, Bob scope: surface→texture inventory, gap analysis, kit-style constitution.**

### 1. Current surface→texture state (source: `prologue.ts` `_applyKitTextures`) — `[MEASURED]`
- **Koje 42:** all walls + ceiling + floor already receive kit PBR sets. `BackWall`/`Ceiling`/`RightWall`/`LeftWallTop` share **one** `concreteWallMat` instance (texturing one re-textures all four); `Floor` gets `concrete_board`; `LeftWallBack`/`LeftWallFront`/`DoorLintel` get `brick_aged`. Per-surface texture clones only adjust `repeat` (tiling density), they do not change the base set.
- **Kältekammer:** only `MorgueFloor` + `MorgueBackWall` exist as geometry and carry `concrete_damp_efflorescence`; the vault has **no side walls and no ceiling** in the current build (open void) — texture coverage there is structurally incomplete, not just unmapped.
- **Material language in use:** `steel_corroded` / `steel_painted` (metalness channel) for the door/tray parts; everything else non-metallic clay/concrete.

### 2. Gap analysis — `[JUDGMENT]`
- **Unused kit sets are a free, modular resource:** `concrete_weathered`, `concrete_panel_smooth`, `stone_ashlar`, `travertine` exist in the flakturm kit but are referenced by **zero** app scenes today. Candidates without any new asset work: `concrete_panel_smooth` for a Kältekammer corridor/ceiling, `concrete_weathered` for the cutaway exterior faces of the 2.5D stage, `stone_ashlar`/`travertine` for Flakturm plinth/vault framing. This directly serves the moderator's scope rule (3.2): reuse before new assets.
- **Creating a new texture set should be the last resort.** Only if a required surface has no matching existing kit family (e.g. a believable aged wood floor or painted-steel ceiling rail) do we generate one — then **strictly in the existing kit style** and registered under `public/assets/kits/<kit>/textures/<name>/` (albedo, normal, roughness, ao, + metalness where metallic).
- **Tiling discipline (lessons from the diorama "zebra" incident, .agents/notes + diorama showcase):** decide a per-surface repeat budget (≈ one texture per 1–1.5 m² of wall/floor footprint) rather than stretching one tile over a whole wall; pair with real `normalScale`/roughness values to avoid flat, AI-clean plastic reads.

### 3. Kit-style constitution (serie fidelity fingerprint) — `[JUDGMENT]`
Every texture rework or new set must pass the same "series family" check Alice proposed for props, applied to materials:
- **Palette:** cold grey-green/chalky concrete, weathered olive/steel, amber accents — matches `concrete_board`/`steel_painted` family reads.
- **Albedo ≈ neutral:** flat unshaded diffuse without baked chiaroscuro (consistent with the character-pipeline rule "pure unshaded flat albedo, no baked shadows"); all shading/tone lives in normal/roughness/ao + engine lights.
- **Weathering language:** restrained — stains, efflorescence, rust streaks, scratches that stay readable at game distance, never "texture-porn"; anti-slop filter (deslop) applies.
- **QC:** compare against kit `preview.jpg` files + `concept-dossier.html` before approval; a new set that does not read as "part of this series" is rejected.

### 4. Proposed Phase-A artifact (my ownership) — `[JUDGMENT]`
Create a **Flächenkatalog-Matrix** (surface → texture set → tile repeat → source) for both rooms. It depends on Charly's final 2.5D staging (which walls/ceilings exist in the cutaway), so it is produced **after** Charly's R2–3 staging definition, and it is the verifiable proof of "100 % texture coverage" from the DoD (doc §10.1). Until staging is fixed, surface definitions are frozen candidates, not commitments.

### 5. Research transparency — `[JUDGMENT]`
Same conclusion as Alice: project-internal sources (`docs/guides/adding-materials.md`, core material guide, kit texture sets, diorama showcase) outperform generic web search for tone and constraints; worth one targeted sweep for aged-bunker-floor material references if a new floor set is needed in Phase B.

**Kickoff note for Phase A:** I second Alice's series-fidelity proposal and extend it to materials. No blocker for Phase B planning.

## Round 1: Charly (Level Design & Staging Lead) — 2026-10-11

**Phase 0 — Research & Lernen, Charly scope: 2.5D staging foundation, room-dimension truth, staging→playability contract.**

### 1. Staging precedent reality-check — `[SOURCED]` + `[JUDGMENT]`
- The project has two deliberate 2.5D families (docs/guides/2-5d-scenes.md):
  - **flakturm-tunnel** = pre-rendered 16×9 background + single 3D character + fixed camera + forced-perspective `StageZone` scales (0.3–1.0). Real 3D depth is *fake*.
  - **character-diorama** = real 3D stage, free orbit, scale 1.0 throughout, no forced perspective.
- **Our rework is NEITHER.** Per moderator decision 3.1 it is a real-3D stage (textured walls/floor/ceiling + kit props) framed like a **peepshow-box / side-cut theater set** (story.md's "side-cut theater"), with composed/dramatic camera targets — not a painted backdrop, and not a free orbit. Consequence: scale-1.0 real geometry everywhere (diorama rule), camera stays timeline/fixed-framed (existing `_targetCameraPos/Look` pattern), and the cutaway is achieved by *staging* (what geometry exists, what faces the hero view), not by image trickery. This avoids the entire painted-perspective-matching problem class (§3 of the guide) — the strongest argument for staying real-3D.

### 2. Room-dimension truth must be fixed — `[MEASURED]` + `[JUDGMENT]`
- Current clash: `koje42.level.json` claims "7×7m Wohnkoje", actual floor geometry is **5.0 × 3.5 m** (world units), ceiling ≈ 3.2 m. A 7×7 m room with one bunk reads cavernous and un-plausible; a 5 × 3.5 m bunker cell reads correct. **Decision for Phase A:** lock the real plan at ~5.0 × 3.5 m (ceiling 3.2), and **fix the level.json description text** to match reality (moderator/QA-ability: invisible text somewhere is exactly the kind of plausibility leak we must avoid).
- Ceiling 3.2 m − bunk top 1.8 m = 1.4 m standing/sitting headroom above top berth — plausible ✔. Door cutout ~1.5 m for the new **2 × 0.8 m** double-leaf door + lintel band at 1.98–2.42 m — geometrically consistent ✔.

### 3. Cutaway staging sketch (frozen candidates, not commitments) — `[JUDGMENT]`
- **Koje 42:** anchor the hero view on the existing camera side (+Z looking −Z): foreground work-plane vignette (desk, lantern, stool), midground (bunk, shelf, rug), boundary layer (door wall left, vent breach right). The 2.5D "cut" manifests as the staged sectioned volumes (decide in B whether right wall is a cutaway stub, not a full box).
- **Kältekammer:** currently only floor + back wall. For a legible theater cut, add **minimal side-wall stubs + a ceiling segment** framing the drawer-rack / tray zone; keep the cut open toward the camera. This is new geometry → **`[OVERLAP: Kältekammer-Geometrie: Charly ↔ Erin]`** and **`[OVERLAP: Flächenkatalog: Charly ↔ Bob]`** (Bob's surface catalog depends on which surfaces exist). Resolve in Phase A by interface, see §6.
- **Playability contract:** the walkable-area clamp MUST equal the real room bounds (current Koje clamps x∈[−2.1,2.1], z∈[−1.1,1.2]; Kältekammer x∈[−2.8,2.8], z∈[−10.5,−7.5]). After staging, Charly defines the definitive walkable rect (diorama-consistent scale 1.0), Erin implements it in `_handlePlayerMovement` — **`[OVERLAP: Walkable-Rect: Charly ↔ Erin]`**. No player object may visually leave the readable framing.

### 4. Plausibility checks flagged for later placement (my review scope) — `[JUDGMENT]`
- Bunk top vs. ceiling lamp/cables; desk lit-workplane orientation toward lamp; door swing arc (2 × 0.8 m radius) clear of props; vent breach low on wall consistent with "escape shaft"; bed/rug/chair clearances; no floating/sunk/overlapping props (DoD §10.6).

### 5. Research transparency — `[JUDGMENT]`
- Web query for engine-side 2.5D layout guidelines returned **no usable results** this round; the authoritative basis is the project's own 2.5D guide + in-repo precedents + standard 2.5D/adventure staging practice. If the moderator wants an explicit external study (Godot-docs level design), that becomes a dedicated Phase-B research task — do not block Phase A on it.

**Kickoff note for Phase A:** after Round 2, once Bob/Erin freeze surface & geometry ownership, I deliver the definitive stage geometry + walkable rect + hero-camera framing as the staging baseline. No blocker for Phase B planning.
