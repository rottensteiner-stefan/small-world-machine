# Fahrplan: OilSlickMaterial an AAA-Niveau annähern

**Kontext:** Aufbauend auf externer Recherche zu Unreal/Godot-Pfützen-Shadern und einem verifizierten Code-Abgleich der `OilSlickMaterial` (`apps/sample-apps/the-whisper/scenes/character-diorama/OilSlickMaterial.ts`) gegen dieses Feature-Set. Ziel: die Lücken schließen, die sich mit vertretbarem Aufwand lohnen — nicht alles um jeden Preis nachbauen.

> **Hinweis (2026-09-26):** Pfad oben ist veraltet — die Datei liegt inzwischen unter
> `apps/sample-apps/the-whisper/scenes/character-diorama/OilSlickMaterial.ts` (App umbenannt/
> verschoben). Phasen 1–3 unten sind laut `.agents/notes/backlog.md` (2026-09-07/08) umgesetzt
> und live verifiziert; Abschnitt 6 (Referenzformeln) bleibt unabhängig davon als
> Kalibrierungs-Nachschlagewerk gültig.

**Nicht Bestandteil dieses Fahrplans** (siehe Abschnitt 4 für die Begründung): Rand-Blending zum Untergrund, Nass-Zone im Boden, generisches Decal-System.

---

## 0. Ausgangslage (verifiziert, nicht vermutet)

| Feature | Status | Beleg |
|---|---|---|
| PBR Metallic/Roughness | Fehlt — handgerolltes Blinn-Phong (`u_specColor`/`u_shininess`) | OilSlickMaterial.ts:137-138, OilSlick.frag.glsl:84 |
| Depth-Fade-Trübung | Fehlt im Material, **aber vollständig vorhanden in `OpenWaterMaterial`** | OpenWater.frag.glsl:26-56 |
| Env-Reflections (Cubemap) | Fehlt im Material, **aber vollständig vorhanden in `StandardMaterial`** | StandardMaterial.ts:215-315 |
| Wellen-Normal-Maps | Fehlt — nur analytisches `noise()` für Farb-Shimmer, keine Normalen-Textur | OilSlick.frag.glsl:96-98 |
| Globaler Wetter-Parameter | Fehlt — `GlobalUniforms`-Block existiert scene-weit, aber kein freier Slot | WebGPURenderer.ts, WebGL2ProgramCache.ts |

Die Pfütze ist ein eigenständiges `Plane`-Mesh ohne jeden Zugriff auf Boden-Textur/-Normale (showcase.ts:1200-1206) — das ist die Wurzel, warum Rand-Blending/Nass-Zone teuer sind.

---

## 1. Phase 1 — Depth-Fade-Trübung (Priorität 1) — ERLEDIGT 2026-09-08

**Kurskorrektur während der Umsetzung:** Ein echter Depth-Buffer-Vergleich (wie bei `OpenWaterMaterial`) bringt hier nichts — die Pfütze ist ein flaches Mesh direkt auf dem Boden, `depthDiff` wäre praktisch überall ~0. Stattdessen wurde die **Farbfassung des tatsächlichen Bodens** (`u_opaqueMap`) mit dem bereits vorhandenen radialen Dicke-Verlauf der Pfütze kombiniert: dünner Rand (hoher `radialFactor`) lässt den echten, dunkel getönten Pflasterstein durchscheinen; dickes Zentrum bleibt Tar-Schwarz. Physikalisch sogar treffender als die ursprünglich geplante Depth-Fade-Methode.

**Umgesetzt:**
- Neuer Parameter `floorVisibility` (0-1, Default 0.6) auf `OilSlickMaterial`, gebunden über den freien `u_isTerrain`-Slot.
- `u_opaqueMap`-Textur-Uniform in allen 3 Shader-Varianten ergänzt (GLSL300/GLSL100/WGSL), Layout um `u_opaqueMap` erweitert (bestehende Texturen erhalten via Spread).
- GLSL300/WGSL: echte Screen-Space-UV via `gl_FragCoord`/`i.pos` + `textureSize`/`textureDimensions`.
- GLSL100: mesh-lokale `v_uv` als Screen-Space-Stellvertreter (etablierte Konvention aus `OpenWater.frag.glsl100`/`Glass.frag.glsl100`, keine neue Notlösung).
- Keine Änderung an `postProcessing`/`EngineOptions` nötig — die Farb-Capture (`copyToOpaqueTexture`) läuft auf allen 3 Renderern unconditional, im Gegensatz zur Depth-Capture (die den dokumentierten Constructor-Gotcha hätte auslösen können). Dadurch bleibt der Eingriff vollständig lokal im Material, kein Risiko für die restliche Szene.

**Live-Verifikation (alle 3 Renderer via `?rendererType=`) — zwei Runden:**

*Runde 1 (erste Implementierung):* Erster Eindruck beim Durchklicken wirkte plausibel, wurde aber vorschnell als "deutlich sichtbar" gemeldet. Auf Nachfrage des Nutzers ("zeig mir das mit einem Screenshot") folgte eine strengere quantitative Prüfung (Canvas-Pixel-Readback + Diff gegen ein Kontroll-Frame ohne Parameteränderung), die zeigte: der reale Effekt lag kaum über dem natürlichen Rausch-Pegel der Szene (Lampenflackern, Thin-Film-Shimmer). Ursache: `groundColor * edgeColor * 3.0` multiplizierte mit einer fast-schwarzen Konstante (`edgeColor` ≈ 0.01) und crushte damit jede reale Bodenhelligkeit auf nahe Null, unabhängig von `floorVisibility`.

*Fix 1 (Tönung):* `edgeColor` nur noch als normierter Farbton (auf hellsten Kanal skaliert) verwendet, nicht als absolute Helligkeit -- Boden bleibt hell, wird nur warm/dunkel eingefärbt.

*Zweiter, gravierenderer Bug gefunden bei erneuter Live-Prüfung:* Auch nach Fix 1 blieb der Effekt schwach. Ursache: der getönte Bodenwert wurde in `baseColor` gemischt, die anschließend mit `finalLight` (der Eigenbeleuchtung der Pfütze) multipliziert wird -- der aus `u_opaqueMap` gesampelte Bodenwert ist aber bereits vom Haupt-Opaque-Pass fertig beleuchtet, wurde also ein zweites Mal (unnötig und falsch) verdunkelt, besonders in den ohnehin dunklen Randbereichen der Szene.

*Fix 2 (Reihenfolge):* Die Boden-Überblendung erfolgt jetzt NACH der Lichtberechnung, direkt auf `litOilColor` (analog zum bereits bestehenden Glow-Term, der ebenfalls die Beleuchtung umgeht) -- kein erneutes Abdunkeln eines bereits fertig beleuchteten Werts mehr.

**Ergebnis nach beiden Fixes, erneut live verifiziert:**
- WebGPU, WebGL2: sehr deutlicher, eindeutig sichtbarer Effekt -- der glatte dunkle Rand wird bei `floorVisibility=1.0` zu einer klar erkennbaren, kopfsteinpflaster-texturierten Silhouette.
- WebGL1: ebenfalls ein klar sichtbarer Unterschied, aber anderen Charakters (läuft eher zu einer durchgehend dunkleren Fläche zusammen statt feiner Textur) -- Folge der bekannten Mesh-UV-als-Screen-Stellvertreter-Näherung (kein `gl_FragCoord`/`textureSize()` in GLSL ES 100), die `OpenWaterMaterial` auf diesem Backend bereits hat. Kein Bug, akzeptierte bestehende Einschränkung.
- Keine Compile-/Konsolenfehler auf allen 3 Renderern.

**Lektion:** "Ich hab's mir angeschaut, sieht gut aus" reicht nicht -- erst die pixelgenaue Diff-Messung (auf Nutzer-Nachfrage) deckte auf, dass der erste Fix zwar den Rausch-Pegel knapp überschritt, aber der eigentliche Grund für die Schwäche ein zweiter, unabhängiger Bug war (Beleuchtungs-Reihenfolge). Ohne die Nachfrage wäre das unentdeckt geblieben.

---

## 1a. Ursprünglicher Plan (Referenz, so nicht umgesetzt)

**Warum zuerst:** Kein Neubau, reines Copy-Pattern aus einem bereits produktiven Material. Größter visueller Gewinn pro Aufwand.

**Vorgehen:**
1. `OpenWater.frag.glsl` (Zeilen 26-56) als Referenz lesen: Beer-Lambert-Absorption gegen `u_opaqueDepthMap`/`u_opaqueMap`, Foam-Band via `foamDistance`.
2. Gleiches Uniform-Paar (`u_opaqueDepthMap`, `u_opaqueMap`) in `OilSlickMaterial` übernehmen — für alle 3 Renderer-Shader-Varianten (WebGL1/WebGL2/WebGPU-Chunk).
3. WebGL2/WebGPU: Depth-Capture-Bindung genauso verdrahten wie bei `OpenWaterMaterial` (Achtung: **"postProcessing muss über den Constructor gesetzt werden"**-Gotcha für WebGL2-Depth-Capture ist bereits dokumentiert, nicht behoben — hier erneut beachten).
4. WebGL1: gracefully-degradierenden Fallback aus `OpenWaterMaterial` übernehmen (kein echtes Depth-Capture, aber Material bricht nicht) — Beleg WebGL1Renderer.ts:539.
5. Trübungsfarbe/-stärke an den bestehenden "Graphic Noir"-Look der Pfütze anpassen (dunkler, öliger Farbton statt Wasser-Türkis).

**Akzeptanzkriterium:** Am Fassrand sichtbarer Tiefenverlauf der Pfütze (Randbereich heller/durchscheinender als Zentrum), verifiziert per Live-Screenshot-Vergleich in allen 3 Renderern (siehe `sweep-renderer.mjs`).

**Geschätzter Aufwand:** klein (eine Sitzung).

---

## 2. Phase 2 — Env-Reflections über bestehende Cubemap (Priorität 2) — ERLEDIGT 2026-09-08

**Kurskorrektur während der Umsetzung:** Die Diorama-Szene besitzt keine Cubemap/Skybox (verifiziert per `grep` über `character-diorama/showcase.ts` — kein `Skybox`/`CubeTexture`). Der ursprüngliche Plan (`StandardMaterial.envMap`-Cubemap-Pattern kopieren) hätte zuerst ein Asset-Beschaffungsproblem gelöst, analog zu Phase 3. Stattdessen umgesetzt: eine **analytische Fresnel-Reflexion** ohne Cubemap-Textur — eine konstante, gedämpfte Umgebungsfarbe (kühles, feuchtes Kellerlicht statt Himmel), gewichtet mit Schlick-Fresnel und dem Khronos-F0-Wert (siehe Abschnitt 6.1). Erfüllt das Akzeptanzkriterium ohne neues Asset und ohne Änderungen am `StandardWebGPULayout`.

**Umgesetzt:**
- Neue Parameter `envColor` (Default: gedämpftes kühles Blaugrau `(0.05, 0.06, 0.08)`) und `envReflectivity` (Default 0.4) auf `OilSlickMaterial`.
- Wiederverwendung der bereits reservierten `StandardWebGPULayout`-Füllslots `u_pad1`/`u_pad2`/`u_pad3` (envColor r/g/b) und des bereits korrekt benannten `u_reflectivity`-Slots (Stärke) — keine Änderung an `StandardWebGPULayout.ts`/`structs.wgsl` nötig, gleiche "freier Slot"-Konvention wie `u_isTerrain`→`floorVisibility`.
- Fresnel-Term `F0 + (1-F0) * (1-NdotV)^5` mit `F0 = 0.0204` (Khronos `KHR_materials_ior`, IOR=1.333) in allen 3 Shader-Varianten (GLSL300/GLSL100/WGSL) ergänzt, additiv in `litOilColor` eingemischt (gleiche Position wie Specular/Glow).

**Live-Verifikation (alle 3 Renderer via `?rendererType=`):** Pixel-Diff zwischen `envReflectivity=0.4` und `=0`, isoliert auf einen Crop um die Pfütze (um Rauschen durch Fackel-Flicker/Charakter-Idle-Animation/UI außerhalb der Pfütze auszuschließen) und gegen einen Rausch-Pegel-Kontrollwert (gleicher Zustand, nur Zeit vergangen) normiert:
- WebGL1: Signal 0.864 vs. Rauschen 0.490 (≈1.8×)
- WebGL2: Signal 1.043 vs. Rauschen 0.409 (≈2.5×)
- WebGPU: Signal 2.852 vs. Rauschen 1.541 (≈1.9×)

Auf allen 3 Renderern liegt das Signal klar über dem Rausch-Pegel, keine Konsolenfehler. Effekt ist bewusst subtil ("restrained addition, not a mirror finish") — visuell am ehesten als leichte kühle Aufhellung am Pfützenrand bei flachem Blickwinkel erkennbar, nicht als offensichtliche Spiegelung.

**Debug-Vorgehen (für künftige ähnliche Prüfungen):** temporäre `window.__app`-Exposition am Dateiende von `showcase.ts` (nach dem Test wieder entfernt), um per Puppeteer `scene.getObjectByName("OilSlick").material` zu greifen und `envReflectivity` zur Laufzeit umzuschalten, plus Kamera auf einen flachen Blickwinkel direkt über die Pfütze gesetzt (`camera.position`/`camera.target`).

---

## 3. Phase 3 — Zweite Wellen-Normal-Map-Schicht (Priorität 3, bedingt) — ERLEDIGT 2026-09-08 (angepasst)

**Kurskorrektur während der Umsetzung:** Der ursprüngliche Plan (echte Normal-Perturbation, zwei gegenläufig scrollende Normal-Maps) widerspricht dem expliziten Klassenkommentar von `OilSlickMaterial`: "Deliberately has NO vertex displacement or spreading/rippling animation [...] this is a thick, settled pool that never moves; only its thin-film shimmer drifts slowly." Eine echte Normalen-Verformung hätte die Specular-Highlight-Position über die ganze Pfütze zum Wackeln gebracht — genau das bewusst vermiedene "rippling", nicht nur ein Asset-Beschaffungsproblem.

**Umgesetzt (angepasste Technik, gleiches Akzeptanzkriterium):** die "zwei gegenläufig scrollende Schichten"-Idee aus `oil.md`s Godot-Referenz auf die bereits vorhandene Thin-Film-Shimmer-**Farbberechnung** angewendet statt auf die Normale. Die einzelne Noise-Abtastung (`noise(v_worldPos.xz * 4.0 + time * 0.02)`), die die Filmdicke für den Farbschimmer antreibt, wurde durch zwei unabhängig gegenläufig wandernde Noise-Schichten (unterschiedliche Frequenz 4.0/5.5, gegenläufige Richtung/Geschwindigkeit) ersetzt — rein farblich, keine Geometrie-/Normalenänderung. Kein neues Textur-Asset, kein neuer Uniform-Slot nötig (nutzt die bestehende `iridescenceStrength`), in allen 3 Shader-Varianten (GLSL300/GLSL100/WGSL) identisch umgesetzt.

**Live-Verifikation (alle 3 Renderer via `?rendererType=`):** Zwei Screenshots im 3-Sekunden-Abstand, Pixel-Diff isoliert auf den Pfützen-Crop:
- WebGL1: meanDiff 0.264, maxDiff 3.0
- WebGL2: meanDiff 2.119, maxDiff 17.7
- WebGPU: meanDiff 1.716, maxDiff 32.7

Auf allen 3 Renderern messbare, sichtbare Bewegung im Farbschimmer über Zeit, keine Konsolenfehler, keine sichtbaren Render-Fehler.

**Formel-Upgrade nachgezogen (2026-09-08):** siehe Abschnitt 6.3a — die `thinFilm()`-Funktion nutzt jetzt eine echte, physikalisch hergeleitete Zwei-Strahl-Interferenzformel statt willkürlich phasenverschobener Sinus-Kurven.

---

## 4. Bewusst zurückgestellt

| Feature | Warum nicht jetzt |
|---|---|
| Rand-Blending zum Untergrund | Bräuchte entweder einen Decal-Ansatz oder geteiltes Boden-Material — die Pfütze ist architektonisch isoliert (eigenes `Plane`-Mesh). Kein Shader-Tweak, sondern eine Architektur-Änderung. |
| Nass-Zone im Boden | Direkt an obigen Punkt gekoppelt, gleiches Problem. |
| Generisches Decal-System | Kein einziger Decal-Codepfad existiert in der gesamten Engine (`grep` leer). Neue Pass-Klasse + Shader-Chunk + Render-Order-Eingriff über alle 3 Renderer — das ist ein neues Subsystem, kein Pfützen-Fix. Lohnt sich nur, wenn Decals als wiederkehrendes Feature gewollt sind (Kratzer, Blutspritzer, Schmutzflecken anderswo), nicht isoliert für eine Pfütze. |
| Globaler Wetter-/Wachstumsparameter | Für eine einzelne statische Diorama-Pfütze aktuell kein Bedarf; würde `GlobalUniforms`-Layout in allen 3 Renderern gleichzeitig anfassen (std140-Alignment-Risiko). Erst relevant, wenn ein echtes Wettersystem geplant ist. |

---

## 5. Reihenfolge & Zeitschätzung

1. Phase 1 (Depth-Fade) — 1 Sitzung
2. Phase 2 (Env-Reflection) — 1 Sitzung
3. Phase 3 (Wellen-Normal-Map) — 1-2 Sitzungen, abhängig von Asset-Beschaffung

Nach jeder Phase: Live-Verifikation in allen 3 Renderern per Browser-Screenshot-Vergleich, kein Abschluss allein durch Build/Test-Grün.

---

## 6. Offizielle Referenzformeln (Khronos glTF Material Extensions)

Ergänzung vom 2026-09-08: `oil.md` fasst externe Engine-Recherche (UE5/Unity/Godot) zusammen; die Khronos-glTF-Spezifikation liefert für dieselben Effekte den formalen, physikalisch hergeleiteten Referenzwert. Kein 1:1-Implementierungsplan, sondern Zielformeln, gegen die sich bestehende Ad-hoc-Werte in `OilSlickMaterial` prüfen/kalibrieren lassen.

### 6.1 `KHR_materials_ior` — Fresnel-Basiswert (F0)

**F0 = ((IOR − 1) / (IOR + 1))²**

Default-IOR 1.5 → F0 = 0.04 (entspricht "Specular = 0.5" in Unreal-Konvention, da `F0 = 0.08 × Specular`). Für Wasser-IOR 1.333: F0 ≈ 0.0204 → Specular-Slider ≈ 0.25 — deckt sich exakt mit dem in `oil.md` Abschnitt 1 notierten Wert. Bestätigt, dass die dortige Recherchezahl korrekt kalibriert war; für Phase 2 (Env-Reflections) direkt als Fresnel-Basiswert übernehmen statt neu zu schätzen.

### 6.2 `KHR_materials_volume` — Trübung/Tiefenverlauf (Beer-Lambert)

**T(x) = c^(x/d)**, äquivalent zum Extinktionskoeffizienten **σₜ = −ln(c) / d**

- `attenuationColor` (c): Farbe, in die weißes Licht nach Durchqueren der `attenuationDistance` verfärbt wird.
- `attenuationDistance` (d): mittlere Weglänge bis zur nächsten Streuung.
- `thicknessFactor`: Volumendicke unter der Oberfläche.

Das ist die formal korrekte Fassung dessen, was Phase 1 mit dem `floorVisibility`-Screen-Space-Blend approximiert hat (siehe Kurskorrektur in Abschnitt 1 — für ein flaches Mesh ohne echte Tiefeninformation war der pragmatische Ansatz richtig). Relevant als Zielformel, falls die Pfütze je um echte volumetrische Tiefe erweitert wird (z. B. ein Krater/eine Senke statt eines flachen Planes).

### 6.3 `KHR_materials_iridescence` — Dünnschicht-Interferenz ("offizieller Ölfilm-Effekt")

Basiert auf Belcour & Barla, *"A Practical Extension to Microfacet Theory for the Modeling of Varying Iridescence"* (2017). Modelliert Fresnel-Reflexion an zwei Grenzflächen (Luft→Film, Film→Basis); die Farbverschiebung ergibt sich aus der optischen Weglängendifferenz zwischen den beiden reflektierten Strahlen (destruktive Interferenz bei Vielfachen von λ/2), spektral integriert und nach RGB über den XYZ-Farbraum konvertiert.

Parameter:
- `iridescenceFactor` (0–1): Effektstärke.
- `iridescenceIor` (Default 1.3): Brechungsindex des Dünnfilms.
- `iridescenceThicknessMinimum`/`Maximum` (Default 100–400 nm): Filmdicke, steuert den Farbton der Interferenz.

Das ist die physikalisch korrekte Zielformel für den in Phase 3 erwähnten Farb-Shimmer — ein möglicher Ersatz (oder eine Fundierung) für die aktuelle analytische `noise()`-Farbverschiebung in `OilSlick.frag.glsl:96-98`, falls der klassische Regenbogen-Ölfilm-Look gewünscht ist statt reinem stilisiertem Shimmer.

#### 6.3a Umgesetzt (2026-09-08): vereinfachte Zwei-Strahl-Näherung statt vollem Spektral-/Airy-Sum-Modell

Die volle Belcour-&-Barla-Formel (spektrale Integration über XYZ-Sensitivitätsfunktionen, Airy-Summe für Mehrfachreflexionen) wäre für den stilisierten Look deutlich zu aufwändig. Stattdessen umgesetzt: die klassische **Zwei-Strahl-Interferenzformel** `I(λ) = R1 + R2 + 2·√(R1·R2)·cos(phase(λ))`, mit echten Schlick-Fresnel-Termen an beiden Grenzflächen (R1 = Luft→Film mit `iridescenceIor=1.3`, R2 = Film→Basis mit dem Phase-2-`envF0`-Wert 0.0204) und einer Phasenberechnung aus der optischen Weglänge (`2 · iridescenceIor · thicknessNm · cosTheta2`) für drei Referenzwellenlängen (650/550/450 nm für R/G/B). Ersetzt die alte `thinFilm()`-Funktion 1:1 (gleiche Signatur `thinFilm(cosTheta, thicknessNorm, strength)`), keine Änderung an den Aufrufstellen nötig, in allen 3 Shader-Varianten identisch.

**Live-Verifikation:** Bei extrem flachem Testwinkel lief die Pfütze zunächst komplett weiß/ausgewaschen — kein Formel-Bug, sondern physikalisch korrektes Verhalten: bei echtem Streiflicht geht `R1` (Schlick) gegen 1.0 für alle Wellenlängen gleichermaßen, der achromatische Anteil überdeckt dann die farbige Interferenz-Modulation (reale Dünnschichten "weißen" bei extremem Streiflicht ebenfalls aus). Mit einem moderateren Testwinkel zeigte sich auf allen 3 Renderern (WebGL1/WebGL2/WebGPU) ein echter, physikalisch plausibler Farbverlauf (warmes Orange nahe Normaleneinfall → kühlerer Farbton zum Rand) bei `iridescenceStrength=1.0` (testweise hochgesetzt, Default bleibt 0.3), keine Konsolenfehler. Mit Default-Kamera/-Parametern sieht die Szene weiterhin unverändert normal aus.

**Quellen:**
- [KHR_materials_ior](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_ior)
- [KHR_materials_volume](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_volume)
- [KHR_materials_iridescence](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_iridescence)
