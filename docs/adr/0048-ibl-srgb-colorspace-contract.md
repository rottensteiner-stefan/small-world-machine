# ADR 0048: Gebackene IBL-Dateien sind sRGB-kodiert

- **Status:** Accepted (2026-10-25, Moderator-Entscheidung zum S5-Gate P2 D5 / ESCALATE-2)

Die gebackenen IBL-Würfel (`env`, `irradiance`, `prefilter/mipN`) sind 8-Bit-WebP. Die Engine las
`irradiance` und `prefilter` roh, `env` (als `u_envMap`) dagegen mit `sRGBToLinear`. Wir legen fest:
**Alle 8-Bit-IBL-Dateien sind sRGB-kodiert** (`c^(1/2.2)`, invers zu `sRGBToLinear`), wie Albedo und
wie three.js/glTF für 8-Bit-Umgebungen. Die Engine dekodiert jeden Sample dieser Würfel; `brdf_lut`
bleibt lineare Daten. 8 Bit sRGB lösen dunkle Töne feiner auf als 8 Bit linear.

## Abgelehnte Alternativen

- **Linear:** Engine hätte so bleiben können, aber 8 Bit linear bandet in dunklen Bereichen, und
  `env` wäre weiter anders kodiert als `irradiance`/`prefilter`.
- **Status quo dokumentieren:** ließe zwei Kodierungen im selben Asset-Satz stehen.

## Umsetzung

- WGSL `lighting_pbr.wgsl` und GLSL `light_calc_pbr.frag.glsl`: `sRGBToLinear` um jeden
  `u_irradianceMap`-/`u_prefilterMap`-Sample (Diffus, Spekular, Clearcoat). Guard:
  `IblColorspaceContract.test.ts`.
- `ibl-gen` (`IBLShaders.equirectangularFragmentShader`) dekodiert das Eingangs-Panorama mit
  `pow(2.2)`, faltet linear und exportiert sRGB. Die Option `--linear` (`scripts/ibl-bake.ts`,
  Harness, `exportCubemapToCross`) ist entfernt.
- **Kein Neu-Backen nötig** für die mit dem Tool-Default gebackenen Sätze (13, 15, 16, 27, 28, 30, 36):
  Das alte Tool faltete die rohen Panorama-Bytes und kodierte beim Export mit `1/2.2`. Bezogen auf
  `env.webp` (den sichtbaren Himmel) sind `irradiance`/`prefilter` damit bereits korrekt
  sRGB-kodierte Faltungen des dekodierten Himmels. Ein Test-Bake bestätigt den neuen Weg: Panorama →
  `env` helligkeitsgleich (Mittel 93,5 → 93,2), `irradiance` energiegleich zum linearen Himmel.

## Konsequenzen

- Showcases ohne Post-Processing (15, 16) werden im IBL-Anteil dunkler und satter (Bildmittel −7 bis
  −10 %).
- **Offene Lücke:** Mit aktivem Post-Processing schreiben beide Renderer `gamma = 1.0` in die globale
  Lane (Ausgabe-Kodierung übernimmt der Post-Pass). `sRGBToLinear` nutzt dieselbe Lane und wird dann
  zur Identität, für IBL wie für Albedo, Emissive und `env`. Diese Showcases ändern sich durch dieses
  ADR deshalb nicht. Dekodier- und Ausgabe-Gamma zu trennen ist der nächste Schritt.
- Showcase 37 ist noch `--linear` gebacken. Seine Dateien werden zusammen mit dem
  Post-Processing-Fix auf sRGB umgerechnet (pro Pixel `c^(1/2.2)`, keine neue Faltung); vorher würde
  die Umrechnung die Szene unter dem Identitäts-Decode sichtbar aufhellen.
- Der Nebel-Ambient (`froxel_inject.wgsl`, `VolumetricFog.frag.glsl`) liest `u_irradianceMap` noch
  roh. Er läuft nur mit Post-Processing, wo der Decode heute ohnehin Identität ist; er wird mit dem
  Post-Processing-Fix dekodiert.

## Doctrine Compliance

- Neue öffentliche Parameter (Hot-Scope): keine neuen; die Tool-Option `--linear` entfällt.
- Geteilte Abstraktion eingeführt/verbreitert? n/a (nutzt das bestehende `sRGBToLinear`).
- Modeful Objekt? n/a.
- Mathematische Behauptungen: Kodier-Vertrag `c^(1/2.2)` ↔ `sRGBToLinear`; Quellen-Guard
  `packages/engine/tests/renderers/IblColorspaceContract.test.ts` (keine Registry-ID, reine
  Konvention, keine Invariante).
- Neue Skalar-Eingänge / tier-gated Capability: n/a.
- Ausnahmen: keine.
