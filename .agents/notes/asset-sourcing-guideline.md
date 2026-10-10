# Asset-Sourcing & Textur-Doktrin für Small World Machine & The Whisper

## 1. Grundsatz: Open Sources & Tripo3D API („Handvoll-Regel“)

- **Pragmatismus vor Neuerfindung:** Wann immer 3D-Meshes oder Basismaterialien benötigt werden, dürfen und sollen freie, hochwertige Quellen im Internet angezapft werden (Poly Haven, ambientCG, Kenney, Sketchfab CC0/CC-BY, OpenGameArt).
- **Die „Handvoll“-Regel (3–5 Varianten testen):** Bevor ein Modell von Grund auf selbst modelliert oder eine endgültige Entscheidung getroffen wird, werden stets **3 bis 5 Kandidaten/Varianten** ausprobiert, verglichen und auf Stilkonsistenz, Polycount und Textur-Mapping geprüft.
- **Tripo3D API & AI-Ingest:** Steht jederzeit zur Verfügung, um schnell maßgeschneiderte Low-Poly-Props (`.glb` mit optimiertem PBR-Atlas) nach 2D-Konzeptvorlagen zu generieren.
- **Benutzerverantwortung:** Die Verantwortung für Inhalte, Prompts, Lizenzen und Quellen liegt vollständig beim Benutzer. Im Code und den Entwickler-Tools gibt es keine bevormundenden Sperren oder künstliche Copyright-Prüfungen.

---

## 2. Textur-Strategie: Fertige Packages vs. Eigene Erstellung

| Textur-Typ | Empfohlene Quelle | Begründung & Workflow |
| :--- | :--- | :--- |
| **Generische Oberflächen** *(Beton, Asphalt, Mauerwerk, Schotter, rostiges Blech, Holzbretter)* | **CC0-Packages** (*ambientCG, Poly Haven*) | Physikalisch kalibrierte PBR-Karten (Normal, Roughness, AO) ohne KI-Artefakte; spart hunderte Stunden Modellier- und Bäckerei-Zeit. |
| **Grafische Noir-Stilisierung** *(Tusche-Schraffuren, handgezeichnete Fugen, Comic-Inking)* | **Shader-Ebene / Custom Layer** | Der Engine-eigene `OutlinePass` und Custom Post-Processing legen den einheitlichen Graphic-Noir-Look konsistent über alle PBR-Materialien. |
| **Story-kritische Key-Props** *(Františeks Kaffeedose, Amts-Terminal, Blausäure-Decals, Wiener Straßenschilder)* | **Gezielt selbst erstellen** *(KI-Generierung + CAD/SVG + PBR-Finish)* | Narrative Einzigartigkeit und historische/österreichische Details erfordern maßgeschneiderte Typografie und Abnutzungsmuster. |

---

## 3. Empfohlene Textur- & Modell-Bibliotheken

1. **ambientCG (Lennart Demes):** >1.800 CC0 PBR-Materialien, perfekt für Bunker-Beton, feuchte Tunnelwände, Ziegel, Schlamm, Fliesen und rostige Industriemetalle.
2. **Poly Haven:** Höchste Material-Qualität mit 100% sauber kalibrierten Normal- und Roughness-Maps.
3. **Kenney Assets:** Exzellent für UI-Symbole, kleine Requisiten und modulare Prototyping-Elemente.
4. **Tripo3D CLI / API:** Für schnelle 3D-Geometrie-Generierung aus isolierten 2D-Artwork-Referenzen.

---

## 4. Die 4-Säulen-Skalierungs-Doktrin für modulare Räume (ADR 0019)

Um bei unterschiedlich großen Räumen (von der 7×7m Koje 42 bis zur 50m Halle) Tiling-Muster zu verhindern und maximale visuelle Vielfalt zu garantieren:

1. **Multizonale PBR-Paletten:** Mindestens 4 PBR-Grundvarianten pro Architektur-Kit (Holzschalungs-Beton, Glattbeton-Kassetten, Feucht-/Salpeterbeton, schwerer Festungsbeton).
2. **Bunker Modular Grid (3m / 5m):** Gliederung langer Wände durch Wandpfeiler (*Pilasters*), Deckenunterzüge (*Beams*) und eine dunklere Sockelzone (*Damp Baseboard*).
3. **Duales Decal-System:**
   - *Makro-Decals:* Großflächige Sickerwasser-Läufe, Salpeterkrusten, Brandschäden und Mauerausbrüche (`rebar_damage`).
   - *Mikro-Decals:* Lokale Ziffern, Sektor-Stencils, Gefahrenstreifen (`hazard_stripes`) und Leuchtmarkierungen (`guide_stripe_glow`).
4. **Deterministischer UV-Jitter:** Automatischer instanzbasierter UV-Offset (`texture.offset.set((x * 0.37) % 1.0, (z * 0.37) % 1.0)`), damit benachbarte Wandelemente desselben Materials niemals dieselben Texturmerkmale an gleicher Stelle teilen.

---

## 5. Die 4-Tier Polycount- und Geometriebudget-Doktrin (ADR 0011 §1.1)

Um sub-pixeligen GPU Quad-Overdraw zu vermeiden und schnelle Ladezeiten im Web zu garantieren, werden alle 3D-Assets nach ihrer physischen Bounding-Box ($L_\text{max}$) in vier strikte Polycount-Budgets eingeteilt:

- **Tier 1 — Clutter & Kleinteile ($\le 0{,}35\,\text{m}$):** $800 – 1.500$ Tris (Teller, Besteck, Tassen, Schalter, Notizen).
- **Tier 2 — Medium Props ($0{,}35 – 1{,}0\,\text{m}$):** $2.500 – 4.500$ Tris (Stiefel, Lampen, Hocker, Eimer, Handtücher).
- **Tier 3 — Möbel & Großobjekte ($1{,}0 – 2{,}5\,\text{m}$):** $6.000 – 10.000$ Tris (Tische, Betten, Schränke, Fässer, Terminals).
- **Tier 4 — Hero & Architektur ($> 2{,}5\,\text{m}$):** $10.000 – 16.000$ Tris (Tore, Mauerdurchbrüche, Schutthaufen, Fahrzeuge).

*Budgets werden stets Upstream bei der Modellerstellung / im Tripo-Export (`face_limit`) bzw. Remeshing mit UV-Bake festgelegt.*
