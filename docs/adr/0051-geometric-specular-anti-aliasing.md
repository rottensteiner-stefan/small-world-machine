# ADR 0051: Geometric Specular Anti-Aliasing für PBR

- **Status:** Accepted (2026-10-26, Moderator-Entscheidung „erst Assets, dann Specular AA“)

In Showcase 12, 37 und 38 lag ein Punkt- und Funkelmuster über den Oberflächen. Die Messung (Effekte und
Materialeigenschaften im laufenden Showcase einzeln abgeschaltet) ergab zwei Ursachen:

1. **WebGPU lud Normal-Maps ohne Mipmaps** (Engine-Fehler, Hauptursache auf WebGPU):
   `GPUTextureResourceCache.getNormalTextureView` rief `getTextureView(tex, undefined)` auf, ohne
   Quality-Konfiguration war `quality.mipmapping` falsch und jede Normal-Map hatte nur Mip 0. Bei
   Verkleinerung sprang die Normale pro Pixel. WebGL2 war nicht betroffen. Die Quality-Konfiguration wird
   jetzt durchgereicht (Test in `WebGPUMipmapGeneration.test.ts`).
2. **Kaputte Normal-Maps** (Diffus- und Glanzanteil, alle Tiers): zehn Graustufenbilder unter
   `*_normal.*`, deren Normalen in die Oberfläche zeigen, und elf Maps mit Rauschen pro Texel
   (25–51° Winkel zwischen Nachbar-Texeln, gute Maps liegen bei 3–10°).
3. **Specular-Aliasing:** Normal- und Krümmungsdetail unter Pixelgröße erzeugt einzelne Glanzpixel
   (Kerzenlicht auf dem Couchtisch in 37, Messingschiene in 28), die Bloom zu Tupfen verstärkt.

Der Mipmap-Fehler ist behoben, die Assets sind repariert (siehe unten). Für den dritten Punkt filtert die Engine die Rauheit wie
Filament (`normalFiltering`), Unity HDRP („Geometric Specular AA“) und Godot 4:
**Geometric Specular Anti-Aliasing** nach Tokuyoshi & Kaplanyan 2019. Die Varianz der Shading-Normalen
im Bildschirmraum verbreitert die GGX-Keule. Dazu kommt der Toksvig-Anteil der Normal-Map selbst
(Toksvig 2005, vMF-Form nach Kaplanyan et al. 2016): Gemittelte Mip-Normalen werden kürzer, ihre Länge
`nl` ergibt die Varianz innerhalb des Pixels, die der Bildschirmraum-Filter nicht sieht:

```
toksvig         = (1 − nl²) / (3·nl − nl³) · normalScale²        (nl = |n| / 0.99, ≤ 1)
variance        = 0.15 · (|dN/dx|² + |dN/dy|²) + toksvig
kernelRoughness = min(2 · variance, 0.2)
perceptual'     = (perceptual⁴ + kernelRoughness)^(1/4)
```

## Umsetzung

- `specularAntiAliasing(perceptualRoughness, N)` in den `pbr_math`-Chunks aller drei Tiers. Die
  Lighting-Chunks (`lighting_pbr.wgsl`, `light_calc_pbr.frag.glsl` für WebGL2 und WebGL1) filtern
  `roughness` einmal direkt nach der finalen Shading-Normalen. Alle Glanzterme und die IBL lesen den
  gefilterten Wert, der Diffusanteil bleibt unverändert. Gilt für Standard- und Decal-Material sowie
  Showcase-Shader, die den Chunk einbinden.
- Konstanten fest wie Filament-Default (`@fixed`): Varianz 0,15, Schwelle 0,2. Kein Material- oder
  Qualitätsparameter: Der Filter kostet zwei Ableitungen und wirkt nur, wo Normalen pro Pixel springen.
- WebGL1 aktiviert `OES_standard_derivatives` (Renderer + `#extension` im `base.frag.glsl`). Fehlt die
  Extension, gibt die Funktion die Rauheit unverändert zurück (Tier-Fallback).
- **Asset-Prüfung:** `npm run check:normal-maps` (ImageMagick) meldet Graustufen-Maps, nach innen
  zeigende Normalen und Rauschen pro Texel über 20°. Exit 0/1/2 wie `check:doctrine`.

## Asset-Reparatur

- Graustufen-„Normals“ (12: steampunk, crate, crate_branded, large_rock, porthole, artdeco; 6: large_rock;
  27: artdeco; shared: rusty_brass, scratched_steel) neu aus der `_height`-Karte des Sets erzeugt
  (`TextureFilters.generateNormalMap`, Sobel). scratched_steel hat keine Höhenkarte: Höhe aus der
  Albedo-Helligkeit, schwach. Die `normalScale (1, -1)`-„DirectX-Korrektur“ der Kisten in 12 entfällt.
- Verrauschte Maps (37: wood_floor, wood_beams, wood_wainscot, wall_plaster, wool_rug, fireplace_brick;
  38: sandstone_banded, carved_masonry, torch_wood; 6: fireplace_brick; 10: grass): Normalen
  weichgezeichnet (Box-Blur zweifach, Radius 1–2) und auf 15–22° mittlere Neigung gedämpft.
- Alle reparierten Maps sind verlustfreies WebP (verlustbehaftetes WebP unterabgetastet Farbe 4:2:0 und
  zerstört Normalen); ersetzte PNG/JPG-Dubletten sind entfernt.

## Abgelehnte Alternativen

- **Nur TAA:** glättet zeitliches Flimmern, aber kein statisches Punktmuster, und ist nicht auf jedem
  Tier und in jedem Showcase aktiv.
- **LEAN/vorberechnete Varianz-Mips:** braucht eine eigene Asset-Pipeline-Stufe; die Länge der gemittelten
  Normalen liefert dieselbe Information zur Laufzeit (Toksvig), 8-Bit-Quantisierung ist mit 0,99 abgefangen.
- **Nur die Assets reparieren:** künftige Assets und Krümmung an dünner Geometrie würden wieder funkeln.

## Konsequenzen

- Glanzpunkte auf fein strukturierten oder stark gekrümmten Flächen werden breiter und ruhiger. Glatte
  Flächen ändern sich nicht (Varianz ≈ 0).
- Der Filmkorn-Effekt (Grain) flackert weiterhin zeitlich; das ist sein Zweck.

## Doctrine Compliance

- Neue öffentliche Parameter (Hot-Scope): keine. Zwei Shader-Konstanten, `@fixed` (Filament-Default).
- Geteilte Abstraktion eingeführt/verbreitert? `specularAntiAliasing` im bestehenden `pbr_math`-Chunk,
  ADR-0038-Renderer-Infrastruktur, genutzt von allen PBR-Lighting-Chunks.
- Modeful Objekt? n/a.
- Mathematische Behauptungen: Varianz 0 ⇒ Rauheit unverändert; Quellen-Guard
  `packages/engine/tests/renderers/SpecularAntiAliasing.test.ts` (keine Registry-ID, Literatur-Formel).
- Neue Skalar-Eingänge / tier-gated Capability: `OES_standard_derivatives` auf WebGL1, ehrlicher
  Rückfall ohne Filter (ADR 0043).
- Ausnahmen: keine.
