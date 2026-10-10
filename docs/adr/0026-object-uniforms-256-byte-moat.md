# ADR 0026: `ObjectUniforms` 256-Byte-Slot als MOAT — kein blindes Aufblähen

> Status: ACCEPTED (Moderator im T-Block der Flüssigkeits-Roadmap, 2026-10-06)

## Kontext & Problem

Der `ObjectUniforms`-Uniformblock (`packages/engine/src/renderers/shaders/StandardWebGPULayout.ts`,
gespiegelt in `structs.wgsl`) packt pro Objekt Matrizen, Farben, Materialkennwerte und die
Liquid-Style-Lanes (`u_styleA`, `u_styleB`) in genau **256 Byte** (16 `vec4`). Der Slot ist
**voll**: Die Style-Lanes transportieren bereits per Lane-Reuse (z. B. `u_styleA.w` mit drei
Bedeutungen je Materialtyp — siehe Lane-Contract-Registry, T3).

Warum 256 Byte? GLSL-ES-1.00 (WebGL1) garantiert im **Fragment-Stage nur 16 `vec4`** Uniformdaten
(64 floats = 256 Byte) pro Programm; WebGL1 kennt keine UBOs — jede Location zählt gegen diese
Untergrenze. Da WebGL1 ein erstklassiger, unterstützter Fallback this engine ist, ist 256 Byte das
**harte Budget für alle fragmentkonsumierten Daten**. Es ist also eine selbst auferlegte,
kompatibilitätsgetriebene MOAT, keine GPU-Hardwaregrenze (WebGL2 erlaubt 16-KB-Blöcke, WebGPU
ähnlich).

Verlockender, falscher Reflex: den Block „einfach größer machen“ (Layout-Erweiterung). Das hätte
breiten Wirkungsradius (Renderer, Structs, Pack-Code, Ring-Buffer, alle 3 Backends) und bricht
unter WebGL1 dauerhaft die Fragment-Zusicherung.

## Entscheidung

1. **`ObjectUniforms` = 256-Byte-MOAT, wird nicht erweitert** (eine Erweiterung nur via formelles
   ADR-0013-lite-Review und gegen WebGL1-Beweis).
2. **Neue Parameter wandern NIE blind in den Objekt-Slot**, sondern über genau eine dieser Routen:
   - **(a) LUT-/Parameter-Textur** (WebGL1-sicher, industrieüblich), 
   - **(b) Per-Style-Shader-Spezialisierung** → Kompilierzeit-Konstanten (0 Uniform-Slots; die
     D3-zurückgestellte Richtung Float-`styleId`→Enum löst auch die Lane-Kollision strukturell),
   - **(c) Instanz-Attribute** (z. B. zukünftiger S2-Splat-Kanal statt Lane),
   - **(d) Material-Scope-Blöcke** nur dort, wo WebGL2/WebGPU leben dürfen und WebGL1 gedeckelt
     bleibt.
3. **Lane-Reuse bleibt erlaubt**, ist aber verpflichtend über die Lane-Contract-Registry (T3)
   registriert: neue Bedeutung auf einer bestehenden Lane = `collision`-Carve-Out mit
   `styleId`/`mat.type`-Exklusivität; Eviction = Re-Homing auf Per-Style-Konstante, nie silent
   delete (G3).
4. **Jeder geplante Slot-Wachstum** wird zuerst gegen (a)–(d) geprüft, nicht umgekehrt.

## Konsequenzen

+ WebGL1-Fragment-Garantie bleibt unverändert gültig; kein Renderer-/Struct-/Ring-Buffer-Risiko.
+ Lane-Mehrdeutigkeiten sind test-/CI-transparent (Scanner + T4-Dispatch-Test).
+ Route (a) hat einen ersten Konsumenten: `StylizedWaterMaterial.rampMap` (256×1-`RampLUT`, Flag `USE_RAMP_LUT`, WebGPU-Binding 18) — null Uniform-Lanes, kein Eintrag in der Lane-Registry nötig.
+ S2-Splat-Lane und S3-Wall-Contract sind als `reserved`-Einträge in der Registry deklariert und
  müssen diesen Pass erneut bestehen, bevor sie implementiert werden.
− Parameter dicht am Fragment-Shader sind nicht „einfach da“, sondern brauchen eine der Routen
  (a)–(d) — dokumentierter Aufwand, keine Blockade.
− Float-`styleId`-Enum bleibt bis auf weiteres (D3-deferred), die Lane-Kollision wird verwaltet,
  nicht strukturell eliminiert.

## Verwandte Entscheidungen

ADR 0013 (eine Kern-Pipeline), ADR 0025 (Engine↔Extension), Roadmap P2 (§8.2 T3; §8.5 G3).
