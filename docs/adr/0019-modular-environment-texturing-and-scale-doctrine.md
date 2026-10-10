# ADR 0019: Modulare Environment-Texturierung & 4-Säulen-Skalierungs-Doktrin

## Kontext & Problem

In 3D-Bunker- und Industrie-Umgebungen (wie in *The Whisper* im Flakturm Arenberg) variieren Raumgrößen von intimen Kammerspielen (z. B. Koje 42, 7×7 m) bis hin zu monumentalen Hallen, Schächten, Munitionsdepots und Schleusen (20×20 m bis >50 m).

Wird eine einzelne PBR-Kacheltextur (z. B. Brettschalungsbeton) naiv über große Flächen gestreckt oder gekachelt, entstehen gravierende Mängel:
1. **Sichtbare Tiling-Muster (*Tiling-Artefakte*):** Periodische Wiederholungen von Flecken, Fugen und Astlöchern zerstören die Immersion.
2. **VRAM-Explosion bei Unikat-Texturen:** Der Versuch, jeden Raum als 1 monolithisches 4K/8K-Unikatbild zu texturieren, überlastet WebGL/WebGPU-Speicherbudgets drastisch.
3. **Mangelnde visuelle Raum-Identität:** Trotz des einheitlichen Beton-/Brutalismus-Themas müssen sich Wohnbereiche, Kanzleien, Kühlräume und Festungsmauern atmosphärisch und haptisch klar voneinander unterscheiden.

## Entscheidung: Das 4-Säulen-Prinzip

Wir etablieren für alle zukünftigen modularen Level- und Raum-Assets in Small World Machine die **4-Säulen-Textur- und Skalierungs-Doktrin**:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│               4-Säulen-Architektur für modulare Umgebungen (Small World Machine)               │
├────────────────────────────┬─────────────────────────────┬─────────────────────────────┤
│ 1. Multizonale PBR-Palette │ 2. Architektonisches Raster │ 3. Duales Decal-System      │
│  • concrete_board          │  • Wandpfeiler (Pilasters)  │  • Makro-Wandbrecher        │
│  • concrete_panel_smooth   │  • Decken-Unterzüge (Beams) │    (Wasserläufe, Salpeter)  │
│  • concrete_damp_efflor.   │  • Feucht-Sockel (Baseboard)│  • Mikro-Stencils & Schilder│
│  • concrete_reinforced     │  • Rohr-/Kabeltrassen       │    (Zonenziffern, Warnung)  │
├────────────────────────────┴─────────────────────────────┴─────────────────────────────┤
│ 4. Engine-Level Varianz: Deterministischer UV-Offset-Jitter per Instanz                 │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1. Multizonale PBR-Materialpaletten (Varianten-System pro Kit)
Jedes Architektur-Kit (z. B. `flakturm`, `industrial`, `subway`) muss mindestens **4 komplementäre PBR-Grundvarianten** definieren:
- **Typ A (Wohn-/Funktionsbereich):** Detaillierte Holzschalung / Ziegel (`concrete_board`, `brick_aged`).
- **Typ B (Großflächen/Hallen):** Glattschalungs-Kassetten mit Ankerlöchern (`concrete_panel_smooth`).
- **Typ C (Tiefebenen/Schächte):** Feuchtbeton mit Salpeter-Ausblühungen & Moos (`concrete_damp_efflorescence`).
- **Typ D (Wehrbauten/Schleusen):** Schwerer, grobkörniger Festungsbeton (`concrete_reinforced_heavy`).

### 2. Architektonisches Baukasten-Raster (*Modular Grid*)
Wände und Decken werden niemals als endlose monolithische Flächen konstruiert, sondern im **Bunker-Raster (3 m / 5 m)** rhythmisiert:
- **Wandpfeiler (*Pilasters*):** Gliedern lange Wandzüge alle 3 bis 5 Meter und unterbrechen Texturfluchten.
- **Sockel-Zone (*Damp Baseboard*):** Der untere Wandabschnitt (0 bis 1 m über Boden) verwendet automatisch feuchteren/dunkleren Beton.
- **Decken-Unterzüge (*Beams*):** Strukturieren Deckenflächen und dienen als natürliche Ankerpunkte für Lampen und Rohre.

### 3. Duale Decal-Hierarchie (Makro vs. Mikro)
- **Makro-Decals (Wandbrecher):** Großflächige transparente Overlays zur asymmetrischen Zerstörung von Gleichförmigkeit (Sickerwasser-Spuren, Salpeterkrusten, Brandschäden, Betonausbrüche mit Bewehrungsstahl).
- **Mikro-Decals (Narrative Details & Zonen):** Lokale Stencils, Raumnummern (`sign_koje42`), Gefahrenstreifen (`hazard_stripes`), Fluchtweg-Leuchtmarkierungen (`guide_stripe_glow`).

### 4. Deterministischer UV-Jitter in der Engine
Beim Instanziieren von Wand- und Bodenelementen wird die `offset`-Eigenschaft der `Texture` deterministisch anhand der Weltposition permutiert (`offset.x = (posX * 0.37) % 1.0`). Dadurch teilen zwei benachbarte Wandelemente desselben Materials niemals denselben Kachelausschnitt.

## Konsequenzen

- **Unendliche Skalierbarkeit:** Räume beliebiger Größe bleiben gestochen scharf und abwechslungsreich.
- **Minimaler VRAM-Footprint:** 4 bis 5 geteilte 2K-PBR-Textursets reichen für ein gesamtes, 5-stöckiges Flakturm-Level.
- **Modulare Wiederverwendbarkeit:** Alle Pfeiler, Träger und Texturen können für Koje 42, Kältekammer K-42, Schleusen und spätere DLC-Schauplätze wiederverwendet werden.
- **Standard für alle Entwickler:** Gilt ab sofort als verbindliche Norm für alle Small-World-Machine-Szenen und -Kits.
