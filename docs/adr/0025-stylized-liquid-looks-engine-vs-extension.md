# ADR 0025: Stilisierte Flüssigkeits-Looks — Engine-Kern vs. Extension-Paket

> Status: ACCEPTED (Dave / Bob / Charly / Erin / Alice, 2026-10-03)

## Kontext & Problem

ADR 0013 etablierte „ein Kernmechanismus, Looks als Presets“ für Flüssigkeiten. Um das Stilspektrum von realistischen Meeren über Anime-/Ghibli-Wasser bis hin zu Comic-Lava und exotischen Zukunftsstilen abzudecken, fehlte ein klares Kriterium für die Grenze zwischen Engine-Kern und Ökosystem-Erweiterungen sowie ein Mechanismus für Shader-Hooks.

Belegte Randbedingungen:
- `StandardWebGPULayout` / `ObjectUniforms` hatte 224 Byte belegt; durch die Ausnutzung des $\ge 256$-Byte-Slots passen genau **zwei freie `vec4`** (`u_styleA`, `u_styleB`) hinein.
- Die Engine darf keine Apps oder Extension-Pakete importieren (ADR 0014/0015/0021).
- Es darf keine globalen Singletons oder Laufzeit-Registrierungs-Overheads geben.

## Entscheidung

### 1. Hybrid-Architektur (2-Familien-System + Modulare Chunks & Hooks)

1. **2-Familien-System:**
   - `OpenWaterMaterial`: Spezialisiert auf realistisches PBR-Wasser und Ozeane.
   - `StylizedWaterMaterial`: Ein modularer Kern für alle stilisierten Flüssigkeiten (Anime, Toon, Magma, Slime, Noir).
2. **Nomenklatur & Presets:**
   - **`Anime`** ist die offizielle Stilfamilie.
   - *Ghibli-Soft*, *Painterly-Sparkle*, *Toon Classic*, *Noir* und *Dredge* sind reine **Parameter-Vektoren** auf dem Kern.
3. **Modulare Chunks & Injection Hooks:**
   - Kern-Chunks: `liquid_caustics` ($F_1-\text{Smooth}F_1$ Voronoi-Zellnetz) und `liquid_glint` (Stern-Glitzer mit gestufter Framerate).
   - Shader-Hooks: `[WATER_EXT_DECL]`, `[WATER_EXT_SURFACE]` für Compile-Time-Erweiterbarkeit via `composeStylizedWaterSources()`.
4. **Extension-Paket `@small-world-machine/liquid-extras`:**
   - Beherbergt spezialisierte Art-Direction-Packs (wie `NoirWaterMaterial`), ohne den Engine-Kern zu forken.

## Konsequenzen

+ Bestehende Szenen (`styleId == 0`) bleiben 100 % pixelidentisch rückwärtskompatibel.
+ Exotische Zukunftstile können über Compile-Time-Hooks angedockt werden (0 ALU / 0 Uniform-Kosten für Standardstile).
+ Klare, per ESLint erzwungene Grenze zwischen Engine und Extensions.
