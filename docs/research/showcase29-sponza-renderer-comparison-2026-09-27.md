# Showcase 29 (Sponza Atrium): 3-Renderer-Vergleich & WebGL2-Dunkelheits-Untersuchung

> **Status:** Bug real und vom User in Chrome UND Safari (Desktop) sowie auf einem echten
> Smartphone (Xiaomi Redmi, Modell 23108RN04Y) bestätigt. **Root Cause nicht gefunden**, trotz
> sehr umfangreicher Live-GPU-Untersuchung über zwei Sessions hinweg. Dieses Dokument fasst alles
> zusammen: was geprüft wurde, wie tief, und warum es weiterhin offen ist.
> **Daten:** 2026-09-27 (Erstanalyse) / 2026-09-28 (Tiefen-Untersuchung).
> **Kontext:** Direkt im Anschluss an den Fix des globalen Post-Processing-Y-Flip-Bugs
> (WebGL1/WebGL2, Commit „Perfection is achieved...“) wurden von derselben Kamera-Startposition
> (`position (8.841, 1.226, -0.451)`, `theta -1.506`, `phi 0.04`, `target (7.844, 1.267, -0.516)`)
> je ein Screenshot mit `?rendererType=WEB_GL1`, `WEB_GL2` und `WEB_GPU` gezogen. Rohdaten
> (Screenshots, Crops) liegen im selben Ordner (`.agents/scratches/sponza/`).

---

## 1. Offensichtliche Details (alle drei Renderer)

- **Bildkomposition identisch:** Gleicher Blickwinkel, gleicher Korridor, gleiche Geometrie
  (Säulen, Bogengänge, Lion-Medaillon am Ende des Gangs, Blumentopf unten links). Die
  Kamera-Startposition ist über alle drei Läufe hinweg exakt reproduzierbar.
- **Banner-Anordnung konsistent:** Rot/Grün/Blau-Banner hängen in allen drei Bildern an denselben
  Säulenpositionen — keine Geometrie- oder Asset-Ladeprobleme zwischen den Renderern.
- **Grauer Kreis im Deckenausschnitt:** Alle drei Bilder zeigen einen kleinen, flach schattierten
  grauen Kreis oberhalb des Bogens am Ende des Gangs. Keine fehlerhafte Geometrie, sondern die
  Sonnenscheibe der geladenen Skydome-Textur (`./assets/sky_panorama.webp`), sichtbar durch die
  offene Dachkonstruktion — passt zur Position der `DirectionalLight`
  (`sun.position.set(14, 28, 12)`).
- **HUD/Tuning-Overlay identisch:** Das "Sponza Lighting Lab"-Panel zeigt in allen drei Fällen
  dieselben Default-Werte (Sun Intensity 5.5, Ambient 0.08, HBAO 1.50, Bounce 32, Exposure 1.05,
  Bloom 0.40, Vignette 0.35, God Rays aus) — keine renderer-spezifische Abweichung.
- **Auflösung/Seitenverhältnis:** Alle Screenshots konsistent, keine Renderer-spezifische
  Canvas-Größenabweichung.

## 2. Der auffällige Unterschied: WebGL2 ist deutlich dunkler

Graustufen-Statistik über den 3D-Viewport-Bereich (ohne HUD-Panel):

| Renderer | Mittelwert (0–255) | Median | Std.-Abw. |
|---|---|---|---|
| WebGL1 | 90 | 74 | 54 |
| WebGPU | 56 | 48 | 45 |
| WebGL2 | **35** | **12** | 51 |

WebGL2 ist rund **60 % dunkler** als WebGL1 und knapp **40 % dunkler** als WebGPU (Mittelwert).
Der niedrige Median (12) zeigt: ein großer Bildanteil (Gewölbebögen, Wände abseits des
Lichtstrahls) ist nahezu schwarz, während bei WebGL1/WebGPU dieselben Flächen klar durchgezeichnet
sind. Betrifft nach User-Bestätigung **nicht nur Showcase 29**, sondern Showcases mit aktivem
Post-Processing generell (siehe `.agents/notes/backlog.md`, Eintrag 2026-09-28).

**Real-Geräte-Bestätigung (2026-09-28):** Vom User explizit gegengecheckt — sichtbar dunkel in
aktuellem Chrome *und* Safari auf dem Mac, UND auf einem echten Android-Smartphone (Xiaomi Redmi
23108RN04Y) im selben WLAN. Damit ist ausgeschlossen, dass es sich um ein Artefakt der
Chrome-DevTools-Automatisierung (Claude-in-Chrome) handelt — das wurde ernsthaft in Erwägung
gezogen und aktiv geprüft, bevor die Untersuchung fortgesetzt wurde.

## 3. Was zuverlässig feststeht (reproduzierbar über mehrere saubere Reloads)

1. **`renderer.postProcessing.enabled = false`** → Szene sofort korrekt hell (identisch zu
   WebGL1/WebGPU). Der Bug hängt eindeutig an der WebGL2-HDR-Post-Processing-Pipeline
   (`_hdrFbo` → `PostProcessPassGL`), nicht an Sponza-eigenem Code, nicht an der Beleuchtung
   selbst, nicht am bereits gefixten Y-Flip.
2. **HBAO deaktiviert** → keine Änderung, weiterhin dunkel.
3. **Bloom deaktiviert** → keine Änderung, weiterhin dunkel.
4. **TAA / Motion Trail** → beide standardmäßig `enabled: false`, scheiden als Ursache aus.
5. Alle Post-Process-Uniforms korrekt gebunden (per Live-Readback aus dem kompilierten Programm
   verifiziert): `u_exposure=1.05`, `u_gamma=2.2`, `#define u_toneMappingMode 3` (ACES Filmic),
   Color-Grading/Grain/Flash-Defaults neutral (`contrast=1, lift=0, gain=1, gammaColor=1`).
6. **Roher HDR-Wert per `gl.readPixels` direkt aus `_hdrFbo.framebuffer`** an einer sichtbar
   dunklen Bildstelle: `(0.156, 0.099, 0.042)` — ein völlig normaler linearer Farbwert, der von
   Hand durch die exakte ACES-Filmic-Formel gerechnet ~(133,101,56)/255 ergeben müsste (normales
   warmes Beige), nicht Schwarz.
7. Kein Scissor-Test-Leck (grep über die gesamte Pass-Pipeline: `SCISSOR` kommt nirgends vor).
8. Keine Shader-Compile-/Link-Fehler (`gl.getShaderInfoLog` leer, `LINK_STATUS` immer `true`).
9. `_hdrFbo`-Größe entspricht exakt der Canvas-Größe (kein Resize-Mismatch,
   `devicePixelRatio`-bedingt oder sonstwie).
10. Keine parallele Session, die währenddessen an den betroffenen Dateien arbeitet (per
    Datei-Zeitstempel-Check ausgeschlossen — anders als beim Showcase-16-Mond-Magnifikations-Bug
    (siehe `.agents/notes/backlog.md`, Eintrag 2026-09-27), wo eine echte Fremd-Session mit
    hineinspielte, war das hier kein Faktor).

## 4. Widersprüchliche, NICHT reproduzierbare Befunde

Das eigentliche Problem dieser Untersuchung: mehrere Ansätze sahen in einzelnen Live-Tests wie
der Fix aus, hielten aber einem sauberen Nachtest (frischer Reload, keine Laufzeit-Manipulation)
nicht stand.

- **`texture()` vs. `texelFetch()`:** Ein Shader-Patch zur Laufzeit (`gl.shaderSource` +
  Recompile), der `texelFetch()` statt der gefilterten `texture()`-Abfrage für den HDR-Sample
  verwendet, zeigte in einem Live-Test ein sofort korrekt helles Bild — bestätigt über eine
  eigens gebaute Debug-Visualisierung (UV-Gradient korrekt, Crosshair-Marker an exakt der
  erwarteten Bildposition, `texelFetch` an derselben Stelle hell, `texture()` an exakt derselben
  Stelle schwarz). **Als echter Source-Fix in `PostProcess.frag.glsl` eingebaut und über einen
  sauberen Reload getestet, hat er NICHT geholfen** — Szene blieb dunkel. Wieder zurückgerollt.
- **Textur-Filter (`texParameteri`):** Mehrfaches Neu-Setzen von
  `gl.texParameteri(..., NEAREST/LINEAR, ...)` auf `_hdrFbo.texture` über die
  Chrome-DevTools-Konsole hat das Bild in mehreren Tests sofort korrekt hell gemacht — auch ein
  reines No-Op-Wiederanwenden desselben bereits gesetzten Werts. In anderen, scheinbar
  identischen Tests (gleicher Ausgangszustand, gleicher Code) **nicht**. Auch ein Poke bei jedem
  einzelnen Frame (fest in `flushPostProcess()` eingebaut, eliminiert jede Timing-Unsicherheit)
  hat NICHT zuverlässig geholfen — bei einem sauberen Reload mit diesem Fix blieb die Szene
  dunkel.
- **UV-Visualisierung:** `fragColor = vec4(uv, 0, 1)` zeigte einen komplett korrekten,
  unauffälligen Farbverlauf (u: 0 links → 1 rechts, v: 0 unten → 1 oben) — keine Hinweise auf
  falsche, verschobene oder NaN-behaftete Koordinaten.
- **Konkurrierende Session:** Zunächst verdächtigt (Muster aus `[[project_and_now_concurrent_sessions]]`),
  aber per Datei-Zeitstempel-Check klar widerlegt — niemand hat während der Kern-Untersuchung an
  den betroffenen Dateien geschrieben.

**Einordnung:** Das Muster — ein Fix wirkt nur manchmal, unabhängig vom konkreten Wert oder
Ansatz, nie zuverlässig aus dem Code selbst heraus reproduzierbar — deutet auf einen genuinen,
aber sehr schwer zu triggernden Zustand hin (z. B. eine Race Condition zwischen
Ressourcen-Erstellung und -Nutzung), nicht auf einen simplen, deterministischen Logikfehler.
JS-seitiges Schließen (readPixels, Shader-Patches, Parameter-Toggles über die DevTools-Konsole)
war für diesen Bug nicht zuverlässig genug, um Ursache und Wirkung sauber zu trennen — jeder
scheinbare "Fix" könnte schlicht Zufall/Timing gewesen sein.

## 5. Ausgeschlossene Hypothesen

- **Doppeltes Tonemapping** (Forward-Pass + Post-Process-Pass) durch den unfertigen
  Gamma-Gating-Umbau in `WebGL2Renderer.updateGlobalUBO()`/`light_calc_pbr.frag.glsl` — das war
  die ursprüngliche Arbeitshypothese vom 2026-09-27 (siehe unten, vorherige Fassung dieses
  Dokuments). Von Hand durchgerechnet (mit den echten, per Readback verifizierten Uniform-Werten)
  ergibt sich aber **kein** plausibler Mechanismus, der in diese Verdunkelungs-Größenordnung
  passt — die Rechnung sagt für die betroffenen Pixel eher eine Aufhellung als eine Verdunkelung
  voraus. Diese Hypothese gilt damit als **widerlegt**, nicht nur unbestätigt.
- **`_hdrFbo` wird nicht erstellt** (Fallback-Pfad ohne echtes Post-Processing) — widerlegt, FBO
  wird zuverlässig erstellt (`console.log`-Instrumentierung im Konstruktor bestätigt).
- **Scissor-Test-Leck** aus dem Schatten-Atlas-Pass — widerlegt, Scissor wird im gesamten
  Pass-System nirgends verwendet.
- **Texture-Filter-Vollständigkeits-Treiberbug** (LINEAR vs. NEAREST) — widerlegt in dieser
  einfachen Form: NEAREST von Anfang an (im Konstruktor) hilft nicht, nur ein *späteres* Reapply
  hilft manchmal, aber nicht zuverlässig — passt nicht zu einer simplen Filter-Kompatibilitäts-
  Erklärung.
- **Browser-Automatisierungs-Artefakt** — widerlegt durch User-Test auf echtem Gerät (Android)
  und in zwei unabhängigen Desktop-Browsern (Chrome, Safari) ohne jede Automatisierung.

## 6. Warum das Problem weiterhin ungelöst ist

Zusammengefasst: Jede einzelne Komponente der Pipeline wurde isoliert geprüft und für sich
genommen korrekt befunden — korrekte rohe HDR-Werte, korrekte Uniforms, korrekte UV-Koordinaten,
korrekt kompilierte Shader, korrekte FBO-Größe, kein Scissor-Leck, keine fremde Session. Und doch
kommt am Ende ein falsches, zu dunkles Bild heraus — und zwar zuverlässig bei jedem normalen
Seitenaufruf (nicht nur gelegentlich). Gleichzeitig ließen sich mehrere unterschiedliche,
naheliegende Fixes (Sampling-Methode wechseln, Textur-Filter neu setzen) in *isolierten*
Live-Tests scheinbar bestätigen, hielten aber bei sauberer, disziplinierter Nachprüfung nicht
stand. Diese Kombination — reproduzierbares Symptom, aber nicht reproduzierbare Fixes — lässt sich
mit den bisher eingesetzten Mitteln (JS-Introspektion über die Browser-Konsole, Live-Shader-
Patches, Screenshots) nicht weiter auflösen. Vermutlich braucht es echte GPU-Frame-Capture-Technik,
die den tatsächlichen Zustand der GPU zum exakten Zeitpunkt des Draw-Calls zeigt, statt ihn
indirekt über JavaScript zu erschließen.

## 7. Empfehlung für die nächste Runde

- Echtes GPU-Frame-Capture-Tool einsetzen: **Spector.js** (Browser-Extension, herstellerunabhängig)
  oder **Xcodes Metal-GPU-Frame-Capture** (macOS-nativ, da sowohl Chrome/ANGLE als auch
  Safari/WebKit hier letztlich über Metal laufen) — damit lässt sich der tatsächliche Inhalt von
  `_hdrFbo` zum exakten Zeitpunkt des Post-Process-Draw-Calls direkt inspizieren, statt ihn
  indirekt über JS zu erschließen.
- Alternativ: eine minimale, isolierte Reproduktion bauen (eigene kleine HTML-Seite: RGBA16F-FBO
  erzeugen, hineinrendern, mit einem Fullscreen-Quad drüberlegen, außerhalb der vollen
  Sponza-Szene). Lässt sich der Bug dort NICHT reproduzieren, ist er an etwas Showcase-29- oder
  Engine-Pipeline-Spezifisches gebunden, und die Suche kann eingegrenzt werden — statt weiter in
  der vollen Szene nach der Nadel im Heuhaufen zu suchen.
- Nicht wieder mit derselben Methode (Live-JS/Shader-Patch-Raten im Browser) neu ansetzen — das
  hat sich über zwei Sessions hinweg als zu unzuverlässig erwiesen, um Ursache und Wirkung sauber
  zu trennen.

## 8. Zusammenfassung

| Aspekt | Befund |
|---|---|
| Framing/Geometrie/Assets | Identisch über alle 3 Renderer |
| Y-Flip (Post-Processing) | Bereits gefixt (Commit `49f1a392`), in allen 3 Renderern korrekt |
| Helligkeit WebGL1 vs. WebGPU | Unterschiedlich, aber moderat (Mittelwert 90 vs. 56) |
| Helligkeit WebGL2 | Deutlicher Ausreißer nach unten (Mittelwert 35, Median 12) |
| Betroffener Umfang | Nicht nur Showcase 29 — alle Showcases mit aktivem Post-Processing unter WebGL2 |
| Real-Geräte-Bestätigung | Ja: Chrome + Safari (Desktop), Android-Smartphone (Xiaomi Redmi) |
| Root Cause | **Nicht gefunden.** Doppeltes Tonemapping als Hypothese durchgerechnet und widerlegt. Mehrere Live-Fixes nicht reproduzierbar. |
| Nächster Schritt | Echtes GPU-Frame-Capture (Spector.js / Xcode Metal-Debugger) statt weiterer JS-Introspektion |

Rohdaten (Screenshots, Crops) liegen unter `.agents/scratches/sponza/`.
