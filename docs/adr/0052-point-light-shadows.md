---
status: accepted
---

# 0052: Punktlicht-Schatten als sechs Würfelseiten im Spot-Schatten-Array

- **Status:** Accepted (human-approved 2026-10-29)
- **Date:** 2026-10-29
- **Anlass:** Feuer-Plan (Fackeln, Lagerfeuer, Kerze) und externes Review: Ohne Schatten wirkt Feuerlicht wie ein Glühen, der Positions-Jitter von `FireLightBehavior` bewegt nichts Sichtbares. ADR 0031 hält fest, dass Punktlichter „keine Shadow-Maps“ haben und das eine eigene Entscheidung braucht — das ist sie.

## Entscheidung

Bis zu **zwei** schattenwerfende Punktlichter pro Frame (WebGPU, WebGL2). Jedes bekommt **sechs perspektivische 90°-Würfelseiten**, gespeichert als **zusätzliche Layer des bestehenden Spot-Schatten-Arrays** (heute 4 Layer → 4 Spot + 12 Würfelseiten). Jede Würfelseite ist technisch ein Spot-Schatten: gleicher Pass-Code, gleiche Vergleichs-Abtastung (`texture_depth_2d_array` + `sampler_comparison` bzw. `sampler2DArrayShadow`), gleiches PCF/PCSS, gleiche Linien-Caster (ADR 0045). Im Fragment-Shader wählt die Hauptachse von `fragPos − lightPos` die Seite; Layer = `4 + 6 · slot + face`.

- **Auswahl:** unter allen Punktlichtern mit `castShadow = true` die zwei, deren Reichweitenkugel der Kamera am nächsten liegt; Lichter, deren ganze Reichweite hinter der Kamera liegt, zuletzt (gleiche Regel wie `FireLightBudget`). Spots behalten ihre Slots 0–3 unverändert.
- **Datenpfad:** kein neues Feld im `PointLight`-Struct (beide Tiers voll). Stattdessen eine Seitentabelle wie `spotShadowInfo`: `pointShadowInfo[2] = [bias, normalBias, lightIndex, castShadow]` plus 12 Seiten-Matrizen. WebGPU: an `GlobalUniforms` angehängt (wie `evsmParams`). WebGL2: lose Uniforms wie die Spot-Daten, Lichtraum-Position im **Fragment**-Shader aus der Weltposition (12 Varyings wären zu viel).
- **Kein neuer Textur-Slot:** Der Hauptgrund für diese Form. WebGL2 hat alle 16 Units belegt (ADR 0006, Units 11–15 reserviert); ein Würfel-Sampler bräuchte eine neue Unit. WebGPU braucht keine neue Bindung, nur 12 zusätzliche View-Slots.
- **Tiers:** WebGL1 bleibt ohne Schatten (hat gar keine Shadow-Maps) — ehrlicher Fallback, wie bei Spots. Leistungsstufe: LOW 0, MEDIUM 1, HIGH 2 schattenwerfende Punktlichter; Auflösung pro Licht (`shadowResolution`, Default für Punktlichter 256).
- **Kosten begrenzen:** Pro Würfelseite Caster-Culling gegen das Seiten-Frustum ∩ Lichtreichweite; Seiten, deren Frustum das Kamera-Frustum nicht schneidet, werden übersprungen (ein Fackellicht an der Wand braucht oft nur 3–4 Seiten). Kein Time-Slicing: Der Jitter des Feuerlichts soll Schatten bewegen, ein Seitenversatz zwischen Frames wäre sichtbar.
- **Nebel:** Froxel- und Raymarch-Nebel nutzen die Seiten in einem zweiten Schritt (gleiche Abtastfunktion), nicht in der ersten Stufe.

## Abgelehnte Alternativen

- **Echte Cube-Depth-Textur (`texture_depth_cube`, `samplerCubeShadow`):** sauberste Abtastung ohne Seitenwahl, aber neue Textur-Unit auf WebGL2 (nicht verfügbar) und eigener Pass-Typ. Seitenwahl im Shader kostet eine Handvoll ALU.
- **Dual-Paraboloid (2 Seiten statt 6):** billiger, aber die Projektion ist pro Vertex nichtlinear — grobe Geometrie (Wände, Holzscheite aus wenigen Dreiecken) erzeugt sichtbar verbogene Schatten. Unreal und Unity setzen für Punktlichter auf Würfel.
- **Ein schattiertes Spotlight nach unten als Ersatz (Fake):** kein Rundum-Schatten, wirkt bei Wandfackeln falsch.
- **Time-Slicing der Seiten:** spart Zeit, aber bewegtes Feuerlicht würde zwischen Seiten springen.

## Konsequenzen

- Spot-Schatten-Array wächst von 4 auf 16 Layer (bei 512² ~16 MB depth32float; Atlas wird wie bisher bei Leerlauf freigegeben und nach dem größten Caster dimensioniert — Punktlichter mit kleinerer Auflösung teilen sich die Layergröße, deshalb Default 256 und Seiten-Atlas nur bei Bedarf).
- Bis zu 12 zusätzliche Depth-Passes pro Frame auf HIGH; gemessen und per Leistungsstufe begrenzt.
- `GlobalUniformLayout`-Tests, `VIEW_SLOT_COUNT` (9 → 21) und die Lit-Shader-Schleifen beider Tiers ändern sich; der Default ohne schattenwerfende Punktlichter bleibt bytes-identisch (Guard-Test wie bei ADR 0043).

## Umsetzungsplan

0. **Gemeinsamer Kern** `core/lights/PointLightShadow.ts`: Layer-Layout (`pointShadowLayer`), Seiten-Matrizen (`writePointShadowFaceMatrices`, GL-Clip-Space), Seitenwahl-Referenz (`cubeFaceForDirection`, Shader müssen exakt folgen), Lichtauswahl (`selectShadowedPointLights`); Tests `tests/core/PointLightShadow.test.ts`.
1. **WebGPU:** `SpotShadowPassGPU` um Würfelseiten erweitern (Auswahl, 12 View-Slots, Seiten-Culling), `pointShadowInfo`/Matrizen anhängen, Seitenwahl + `getShadowPCF` in `lighting.wgsl`, `lighting_pbr.wgsl`, `glass_pbr_loops.wgsl`.
2. **WebGL2:** `WebGL2SpotShadowArray` auf 16 Layer, Würfelseiten in `renderShadowMaps`, lose Uniforms, Seitenwahl + 3×3-PCF in `light_calc*.frag.glsl` (Fragment-seitig).
3. **Tests:** Seitenwahl (alle sechs Achsen + Kanten), Auswahl/Rangfolge inkl. „Licht hinter der Kamera“, Uniform-Layout, Byte-Identität ohne Punktschatten, Quell-Parität WGSL/GLSL.
4. **Golden:** Showcase 39 (Altar-/Kohlebecken-Punktlichter) und Showcase 45 (Fackel an der Wand, Lagerfeuer mit Holzscheiten) auf WebGPU und WebGL2 mit Toleranz; Live-Check ohne Konsolenfehler.
5. **Konsumenten:** `FireLightBehavior` setzt nichts automatisch — Lichter werden per `castShadow` markiert; Showcase 45 bekommt einen Schalter „Schatten“ im Panel.
6. **Doku:** `docs/guides/shadows.md`, ADR-Index, CHANGELOG; ADR 0031 bekommt einen Verweis.
