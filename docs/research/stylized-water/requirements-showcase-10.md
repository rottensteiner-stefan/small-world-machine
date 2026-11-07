# Anforderungsprotokoll: Showcase 10 (Quelle: Moderator)

> **Herkunft:** ursprüngliches `.agents/collaborate/showcase-10.md` — vom `render`-Befehl des Blackboards überschrieben (der Board-Output steht jetzt in `showcase-10.md`). Dieses Archiv ist der verbindliche Wortlaut des Moderators für die Session.

---

Analysiere Showcase 10. Es sollte Referenzen zu den verschiedenen Flüssigkeiten geben.
Mache dir dazu Screenshot von oben, um genau die vier Pools zu sehen.
Es geht im Qualität.

Das stylisierte Wasser ist zu sehr stilisiert.
Der Slim zu flachm, zu langweilig.
Die Lava eine Katastrophe.
Der "klare erchte" Wasser schon besser, aber keine Schaumkrone.

Das klar ist, von einfachen Comic, Grafik Noir etc bis zum wirklich realistischen Flüssigkeit zu kommen. Wellen im Meer. Mit Schaumkronene.
Es wird noch viele Fragen geben. Dann frage mich. Grundsätzlich sollte jeder Stil sehr ähnlich funktionieren, die Berechnungen aber von einfach bis kompliziert sein.

Willst du Beispiele haben? Vergleiche auch mit den Großen wie Godot, Unreal , Unity und Threee.js

Verwende mindestens 4 Subagenten, für jeden Pool oder jeden Themenbereich einen. Für Recherche im Internet und Ausarbeitung.


---

# Ergänzung 2026-10-03: Stilisiertes Wasser (Ghibli-Richtung) — Quelle: Moderator + Alice

> Diese Ergänzung **erweitert und verbessert** das Bestehende. Nicht alles, was wir haben, ist schlecht
> (siehe „Bestand, der bleiben soll"). Neue Informationen aus Video und Produktseite fließen ein.

## Vorgaben des Moderators (wörtlich sinngemäß, verbindlich)

1. **Fokus: stilisiertes Wasser — konkret der typische Ghibli-Look** (handgemalt, weich, farbig, ruhig). Das bleibt im Hinterkopf bei jeder Entscheidung.
2. Es soll **Varianten** geben. Welche genau, ist offen und wird in dieser Session erarbeitet.
3. **Ein Teil der Varianten wird als Extension ausgeliefert, ein Teil als Teil der Engine.** Die Aufteilung (Kriterien + erste konkrete Zuordnung) entscheiden die Agenten **jetzt gemeinsam** — als Grundsatzentscheidung für die Zukunft (ggf. ADR).
4. Vier Agenten arbeiten gleichzeitig. Alle Agenten-Kommunikation auf Englisch.
5. Qualität steht im Mittelpunkt; Kommunikation mit dem Moderator auf Deutsch, Rückfragen ausdrücklich erwünscht.

## Quellen

- **Video** (Tutorial, ca. 25 min, Blender 2.90): <https://www.youtube.com/watch?v=mbCibu2isB8> — „procedural caustics and sparkle shader". Lokal ausgewertet: Transkript `.agents/scratches/caustics/transcript.txt`, Original-Untertitel `video.en-orig.vtt`, Video `video.mp4`, Schlüsselbilder `frames/` (alles git-ignoriert, nur lokal). Auto-Untertitel: Zahlenwerte sind aus dem Gesprochenen entnommen, nicht jede ist durch ein Bild belegt.
- **Produktseite** (Blender-`.blend`, Pay-what-you-want ab 0 $, ca. 323 Bewertungen): <https://kdedene.gumroad.com/l/wTxJK>. Die `.blend` selbst wurde **nicht** heruntergeladen (Checkout-Schritt; Moderator hat nur das Video freigegeben). Falls die Node-Werte wichtig werden: Moderator bitten, die Datei bereitzustellen.
- Lizenz/Attribution: Techniken sind allgemein (Voronoi, Domain-Warping); trotzdem Quelle in `REFERENCES.md` eintragen (Skill `maintain-references`) — Aufgabe von Alice am Ende.

## Erkenntnisse aus dem Video (Alice)

### 1. Kaustik-Muster: Differenz statt Schwelle
- Zwei 2D-Voronoi-Texturen, Skalierung 20: `F1` und `Smooth F1`. Muster = **F1 − SmoothF1**, danach Color Ramp.
- Zellmitte: beide Werte ≈ gleich → ≈ 0 (dunkel). Zellgrenze: mehrere Zellpunkte ähnlich nah → SmoothF1 sinkt, Differenz steigt → **helle Linien entlang der Zellgrenzen**. Ergibt von Natur aus das Kaustik-Netz, ohne harte Schwelle.
- `Smoothness` steuert die Zellform: 1.0 sehr rund, 0.5 eckiger, niedrig fast scharfkantig; im Video gewählt 0.6. Die Rampe steuert Linienbreite/Härte.
- Beide Terme lassen sich in **einer** Zellschleife berechnen (2D: 9 Nachbarzellen; 3D: 27).

### 2. Bewegung: Domain-Warping
- Vor der Voronoi-Textur wird der Koordinatenvektor mit einem Rauschen (Musgrave, **Detail 0.02 → 0.005 → 0.002, praktisch eine Oktave**) verzerrt; die Verzerrung wird animiert, indem die Z-Koordinate des Rauschens mit der Zeit läuft (`frame/500`).
- **Zwei Schichten**: grob/langsam (`/500`) und fein/schneller (Skalierung 50 bzw. 150, `/2000`).
- **3D-Variante** (Strömung/Fluss): Voronoi 3D, Z läuft mit der Zeit (brodelnd/auflösend), X wandert zusätzlich (`frame/1000`) → Flusseindruck. 2D = ruhiges Wasser, 3D = bewegtes Wasser.

### 3. Zwei Ebenen: Licht + Schatten, kein echtes Licht
- **Oben:** Kaustik-Linien als Emission (hell/bläulich, Strength ~2), Alpha aus der invertierten Rampe, Blend Alpha, kein Schatten.
- **Unten:** dasselbe Muster als farbiger **Schatten** auf dem Boden (hell- auf dunkelblau), per **Soft-Light** mit Stein-Textur gemischt. Beide Ebenen mit gleicher Animation, leicht versetzt → Tiefe ohne Lichtberechnung.
- Farbverwaltung auf **Standard** statt Filmic, damit die Farben satt bleiben (bei uns: Tonemapping/Entsättigung beachten).

### 4. Glitzer-Sterne (Sparkle)
- Sterntextur im **Bildschirmraum** (Window-Koordinaten) → immer zur Kamera gedreht; Skalierung 1.5 × 0.75 (Seitenverhältnis).
- **Gestufte Zeit** (Zeichentrick-Look): `ceil(Zeit)` quantisiert die Bewegung auf **8 fps** (`frame/3`; 12 fps = `/2`, 6 fps = `/4`).
- **Maske:** sphärischer Gradient in Bildmitte → Sterne nur im Zentrum.
- **Funkeln:** Rauschen (Skalierung 10, Z-Animation `frame/100`) per Multiply/Overlay auf den Stern-Alpha.

## Bestand, der bleiben soll (nicht alles ist schlecht)

Stand v0.95.2 (siehe `CHANGELOG.md` 0.95.0–0.95.2, Board `showcase-10`, Findings F4–F7, F15, F16, F20):
- `StylizedWaterMaterial` / `LiquidWaveMaterial`: Gerstner-Wellen, Depth-Sampling, Beer-Lambert-Absorption, Screen-Space-Refraktion, Fresnel, Kanten-Schaum (Shore-Foam, Worley). **Gute Basis.**
- `aaStepMask` (AA-Schwellen mit Softness), `style: "flat" | "toon" | "bold"`, `causticStrength`, `specularStrength` — der Stil-Parameter-Vektor existiert bereits (ADR 0013: ein Kern, Presets, keine Forks).
- Drei Backends (GLSL300 / GLSL100 / WGSL) synchron; WebGL2 hat seit 0.95.1 Opaque-Depth ohne Post-Chain.
- Bekannte Grenzen: kein freier Uniform-Slot mehr (StandardWebGPULayout voll, F11 → Strengths laufen über Alpha-Kanäle), WGSL-Gotchas (`return o;` im Kommentar, `[BRACKET_TOKEN]` in Kommentaren), GLSL100 ohne `fwidth`.
- Aktuelle Kaustik: Produkt zweier Worley-Noises mit harter(AA-)Schwelle (`aaStepMask(0.42, n1*n2)`) — **das Video liefert einen besseren Ansatz (F1 − SmoothF1 + Domain-Warp)**, der die bisherige Lösung erweitert, nicht verwirft.

## Ideen (Alice, alle zu prüfen — `[ASSUMED]` bis belegt)

1. **Kaustik-Chunk** `liquid_caustics` (F1 − SmoothF1, einstellbare Smoothness, Rampe, 2D/3D-Modus, ein bis zwei Warp-Schichten). Eigener Shared-Chunk, von StylizedWater (und ggf. OpenWater) nutzbar.
2. **Licht/Schatten-Paar**: dasselbe Muster einmal additiv (Licht) und einmal gefärbt multiplikativ/soft-light (Boden-Schatten) → Tiefe billig.
3. **Sparkle/Glitter-Modul**: Screen-Space-Sterne oder prozedurale Glints, **gestufte Zeit** (6/8/12 fps wählbar), Zentrum-Maske, Funkel-Rauschen. Gestufte Zeit generell als Stil-Parameter („Handgezeichnet-Takt") auch für Wellen/Schaum.
4. **Ghibli-Look (Hypothese, muss belegt werden):** handgemalt-weich statt hartkantig; wenige, ruhige Farbflächen mit weichen Verläufen; helle Wellen-Strichlinien/Ripple-Konturen; weiche Schaumsäume; Himmel/Wolken-Spiegelung als Gemälde; warmes Glitzern der Sonne; Pastell-Blau/Türkis/Grün. `[ASSUMED]` — Recherche: Referenzanalyse aus öffentlichen Quellen (Making-of, Stylized-Water-Tutorials, Art-of-Büchern nur beschreibend), **keine** Bildkopien/Charaktere.
5. **Stil-Varianten als Parameter-Vektor** auf einem Kern (ADR 0013), nicht als Forks. Kandidaten (offen!): *Flat/Comic*, *Toon-Noir*, *Ghibli-Soft* (Fokus), *Painterly-Sparkle*, *Semi-Real*. Welche in die Engine gehören und welche Extension werden, entscheiden wir hier.
6. **Billige Pfade:** Domain-Warp mit 1–2 Value/Simplex-Samples ohne Textur; optional gebackene Kaustik-Textur als Fallback für WebGL1/GLSL100; Kosten pro Variante budgetieren (Samples/ALU), analog Dave's Budgetregeln.

## Auftrag dieser Session (Phase A, gemeinsam, 4 Agenten parallel)

1. **Alle** lesen: dieses Dokument, `showcase-10.md`/Board `showcase-10` (F4–F7, F15, F16, F20–F28), ADR 0013, den Code der Stylized/OpenWater/FluidSurface-Shader, Transkript + Frames.
2. Jeder bearbeitet **seinen Teilbereich** (siehe Board-Tasks) mit Recherche (Web, Quellen belegen) und Findings; Prototypen nur unter `.agents/scratches/ghibli/`, **kein Eingriff in `packages/` oder `apps/`** in Phase A.
3. **Gemeinsame Grundsatzentscheidung** (Proposal): (a) Kriterien „Engine vs. Extension", (b) erste konkrete Aufteilung der Varianten, (c) Variantenliste mit Fokus Ghibli-Soft, (d) Paketierung/API (Parameter-Vektor, Chunks, Extension-Mechanismus), (e) Budgets pro Variante, (f) Verifikationsplan (Referenzbilder, Pixel-Diff, 3 Backends). Offene Fragen → an den Moderator.
4. Erst nach Konsens: Umsetzungsplan mit überschneidungsfreien Zuständigkeiten (Phase B).

## Nachtrag: .blend-Datei analysiert (Alice, 2026-10-03)

Moderator hat `caustics_blend.blend`, `stars_1.jpg`, `water_rocks_1.jpg` nach `.agents/scratches/caustics/` gelegt. Ohne Blender per Python-Parser ausgelesen (`blend_dump.txt` dort). Bestätigt das Video; Detailwerte siehe Board `showcase-10-ghibli` (Alice-Finding zu T1): Kaustik-Linie ist ein **schmales hartes Band** der Rampe (0.057 → 0.074) auf F1 − SmoothF1 (Smoothness 0.55, Scale 20, 3D bei der Fluss-Variante), Emission-Stärke 2.0, 2 Musgrave-Warps (Detail 0.02/0.005, Z-Driver frame/500, frame/2000), Sterne mit gestufter Zeit (frame/3), Zentrum-Maske (Spherical-Gradient) und Twinkle-Rauschen (Scale 10, Detail 2). Lizenz der Datei unbekannt → keine Texturen/Werte 1:1 übernehmen.
