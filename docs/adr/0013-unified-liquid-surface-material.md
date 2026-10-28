# Vereinheitlichtes Flüssigkeits-Material: Ein Kernmechanismus, Presets fürs Aussehen

> **Stand-Hinweis (2026-10-21):** Status: Akzeptiert, umgesetzt (`LiquidWaveMaterial`, `FluidSurfaceMaterial`, `LavaMaterial`, `SlimeMaterial` unter `core/materials/liquid/`). Die im Text genannte Klasse `LiquidSurfaceMaterial` existiert nicht; gemeint sind `LiquidWaveMaterial`/`FluidSurfaceMaterial`. Die `LaneContractRegistry` ist kein Code, sondern `.agents/scripts/lane-contracts/lane-contracts.json` mit `scan.js`. Die Aufteilung in Engine-Kern und `liquid-extras` regelt ADR 0025.

## Kontext & Problem

`OpenWaterMaterial` (realistisches PBR-Wasser) und `StylizedWaterMaterial` (Toon-Wasser) sind zwei
unabhängige Klassen mit zwei unabhängigen Shader-Stacks, aber ihre Vertex-Shader implementieren
nahezu wortgleich dieselbe Gerstner-Wellen-Verschiebungsschleife (`OpenWater.vert.wgsl` vs.
`StylizedWater.vert.wgsl` unterscheiden sich nur in der Wellenzahl — 5 vs. 3 — und einer
Null-Wellenlängen-Absicherung), und ihre Fragment-Shader implementieren mit nahezu identischem
Code denselben Worley-Noise-Kanten-/Überschneidungs-Schaum
(`foamCutoff`/`foamNoiseScale`/`foamNoiseSpeed`/`foamDistance`/`foamColor`). `FluidSurfaceMaterial`
beansprucht bereits ein breiteres Mandat — sein eigener Doc-Kommentar sagt "für Wasser, Lava oder
Schleim" —, aber nichts in der Codebasis nutzt es tatsächlich für Lava oder Schleim, sodass diese
Verallgemeinerung unbestätigt ist. Ein vierter Shader-Satz, `Liquid.*.wgsl`/`Liquid.*.glsl`,
existiert auf der Festplatte, wird aber von null TypeScript-Materialien importiert — totes Gewicht
aus einem früheren, abgebrochenen Versuch derselben Verallgemeinerung.

Wir wollen Lava und Schleim als ausgelieferte Materialien hinzufügen, ohne eine vierte (und
fünfte) Kopie derselben Wellen-/Schaum-Mathematik, und wir brauchen eine dokumentierte Regel dafür,
wie künftige flüssigkeitsartige Materialien aussehen sollten.

Wir haben uns angesehen, wie Godot und Unity das aufteilen:
- **Godot** liefert überhaupt kein Wasser-/Lava-Material aus — nur generische Shading-
  Infrastruktur (`ShaderMaterial`, `SubViewport` für Reflexion/Refraktion). Jede Flüssigkeit,
  realistisch oder stilisiert, ist ein Community-Shader, gebaut aus diesen Primitiven.
- **Unity** (HDRP, seit 2022.2/2023.1) liefert genau ein erstklassiges Flüssigkeitssystem aus —
  ein physikbasiertes Ozean-/Fluss-/See-Wassersystem mit Auftriebs-Hooks — als Kern-Engine-
  Funktionalität, weil die Simulation komplex genug ist, um es lohnenswert einmal zu bauen, und
  der Gameplay-Hook (Auftrieb) generisch ist. Stilisiertes Wasser, Lava, Sumpf- und Giftmüll-
  Varianten sind Shader-Graph-basierte Presets/Asset-Store-Inhalte, die über demselben Node-Graph
  liegen, keine eigenen Engine-Subsysteme.

## Entscheidung

Wir folgen der Unity-Aufteilung: **ein Kernmechanismus, ausgelieferte Presets fürs Aussehen**,
statt der Godot-Aufteilung (überhaupt kein Kernmechanismus) oder unseres früheren Zustands (N
vollständige Kopien des Mechanismus).

**Während der Umsetzung gefundene Implementierungskorrektur:** `OpenWaterMaterial`/
`StylizedWaterMaterial` hatten bereits jeden freien Float-Slot im festen
`StandardWebGPULayout`/`structs.wgsl`-Uniform-Layout für Schaum-Parameter verbraucht — es war kein
Platz mehr für ein neues Feld (z. B. Lavas Emissionsstärke), ohne diese Struct im Gleichschritt über
`DepthPrePassGPU`, `CascadedShadowPassGPU`, `SpotShadowPassGPU`, `MainRenderPass` und
`WebGLMainPass` hinweg zu ändern — ein für dieses Ziel unverhältnismäßig großer Wirkungsradius.
`FluidSurfaceMaterial` dagegen nutzte nur 3 seiner verfügbaren Uniform-Slots und hatte echten
Spielraum. "Ein Kernmechanismus" wird daher implementiert als **zwei Geschwister-Mechanismen, die
sich Shader-Text teilen, nicht ein gemeinsames Uniform-Layout**:

1. **Wellen-Familie** (transparent, refraktiv): `OpenWaterMaterial` und `StylizedWaterMaterial`
   erweitern jetzt beide `LiquidWaveMaterial`, eine gemeinsame abstrakte Basis, die die gemeinsame
   Options-Oberfläche (wave1-3, speed, refraction, absorption, foam-Parameter) und die identische
   `getRenderManifest()`-Packing-Logik hält, die früher byteidentisch zwischen den beiden Klassen
   dupliziert war. Ihr Gerstner-Wellen-Verschiebungs- und Worley-Noise-Shader-Code wird auf
   **Shader-Chunk-Ebene** dedupliziert (der bestehende `ShaderRegistry.registerChunk()`/
   `[TOKEN]`-Mechanismus der Engine, bereits genutzt für `FOG_CALC`/`PBR_MATH`) über zwei neue
   Chunks: `liquid_gerstner_wave.{wgsl,glsl}` und `liquid_worley_noise.{wgsl,glsl}`. Jede
   Unterklasse liefert weiterhin ihre eigenen 6 Shader-Quelldateien (diese Codebasis hat keine
   dynamische, pro-Material zusammengesetzte Shader-Quelle, nur statische Pro-Klasse-Imports),
   aber der tatsächlich duplizierte *Code* in diesen Dateien ist verschwunden.

2. **Fluss-Familie** (opak/emissionsfähig, noise-getrieben): `FluidSurfaceMaterial` — laut eigenem
   Doc-Kommentar bereits für "Wasser, Lava oder Schleim" verallgemeinert, zuvor aber für keines von
   beiden genutzt — ist die gemeinsame Basis. `LavaMaterial` und `SlimeMaterial` sind dünne
   Preset-Unterklassen (eigener `MaterialType`, eigene Standardfarben/Viskosität/Fluss,
   Wiederverwendung von `FluidSurfaceMaterial`s bestehenden Shader-Dateien unverändert, bis auf
   einen neuen optionalen Emissions-Glüh-Term, der in zuvor freie Uniform-Slots gepackt wird).
   Lava setzt `transparent = false`/`depthWrite = true` für einen opaken, geschmolzenen Look;
   Schleim behält die transparenten/kein-Depth-Write-Standardwerte der Basis.

3. **Die öffentliche API bleibt stabil.** `new OpenWaterMaterial(options)` und
   `new StylizedWaterMaterial(options)` funktionieren für bestehende Szenen/Showcases unverändert
   weiter — die Konsolidierung ist ein interner Umbau dessen, was hinter diesen Konstruktoren
   steckt, keine bahnbrechende Umbenennung.

4. **Aufräumen:** Die verwaisten Dateien `Liquid.*.wgsl`/`Liquid.*.glsl` (bestätigt: null Importe
   irgendwo in `src/` oder `showcases/`) wurden gelöscht statt befördert — sie stammten von vor dem
   neuen Chunk-basierten Mechanismus und überschnitten sich nicht mit ihm.

**Hinweis zum Enum-Namen:** `MaterialType` ist ein reiner, opaker Shader-ID-String ohne
Renderer-seitiges Dispatch, das nach einzelnen Material-Typen verzweigt (bestätigt: `SKYBOX`/
`DEPTH` sind die einzigen beiden irgendwo sonderbehandelten, rein für Cache-Lookup-Zwecke) — trotz
des Titels dieses ADRs gibt es also keinen einzelnen `LiquidSurfaceMaterial`-Enum-Wert oder
-Klasse; `LAVA`/`SLIME` wurden als unabhängige Enum-Einträge hinzugefügt, jeweils der eigene Typ
des Materials, ohne dass Renderer-Änderungen nötig waren.

## Konsequenzen

- Einen neuen Flüssigkeits-Look hinzuzufügen (z. B. künftig "toxischer Schlamm") ist ein Preset
  (Farben + ein paar numerische Regler), kein neuer Shader-Stack — genau das Anliegen, das
  diesen ADR motiviert hat.
- Ein einmal in `LiquidSurfaceMaterial` behobener Wellen-Mathe- oder Schaum-Bug behebt ihn für
  jeden Flüssigkeits-Look, statt über N Kopien hinweg erneut angewendet werden zu müssen (genau
  das Fehlerbild aus der auseinandergedrifteten 5-Wellen- vs. 3-Wellen-, abgesicherten vs.
  unabgesicherten Divergenz, zu dessen Beendigung dieser ADR geschrieben wurde).
- Der generische Anspruch von `FluidSurfaceMaterial` wird endlich durch einen zweiten echten Look
  (Lava) auf die Probe gestellt, was entweder sein Design bestätigt oder Änderungen daran
  erzwingt — so oder so hört es auf, unbestätigt zu sein.
- Kosten: ein nicht-trivialer Umbau, der `OpenWaterMaterial`, `StylizedWaterMaterial`,
  `FluidSurfaceMaterial` und ihre Shader-Dateien über alle drei Renderer-Backends hinweg
  (WebGPU/GLSL/GLSL100) berührt, plus die Klärung, welches Schicksal `Liquid.*` ereilt.

**Das hier überdenken, falls:** ein künftiger Flüssigkeits-Look einen grundlegend anderen
Vertex-/Fragment-Algorithmus braucht (nicht nur andere Farben/Koeffizienten/refraktiv-vs-emissiv)
— z. B. eine partikelbasierte oder SPH-simulierte Flüssigkeit. Das ist neue Arbeit, die ihr
eigenes Material rechtfertigt, kein Preset auf `LiquidSurfaceMaterial`.

---

## Verdikt-Update & Härtung (2026-10-07)

Im Rahmen der Flüssigkeits-Roadmap (Konsens P2, §8.6) wurden die Erkenntnisse aus der 256-Byte-Uniform-Slot-Grenze und der Interaktivitäts-Erweiterung (S1–S3) formell verankert:

### 1. Uniform-Slot-MOAT: 512 Byte (ADR 0027; die 256-Byte-Fassung ist historisch)

> **Stand 2026-10-19 — 256-Byte-MOAT obsolet:** Die unten historisch festgehaltene 256-Byte-Grenze
> ist inzwischen *nicht mehr* das Limit der Engine. ADR 0026 (256 Byte) ist durch
> [ADR 0027](./0027-object-uniforms-512-byte-expansion.md) **SUPERSEDED**: `ObjectUniforms` wurde
> auf **512 Byte** (128 Floats = 32 `vec4`) erweitert (`StandardWebGPULayout.ts`, `structs.wgsl`),
> inklusive der freien Parameter-Slots `u_matParam0` bis `u_matParam15`. Das aktive Limit der
> Engine ist damit **512 Byte**, nicht 256. WebGL1 bleibt davon unberührt: Die `glsl100`-Shader
> deklarieren weiterhin selektiv Einzeluniforms und unterliegen gar keinem Uniform-Block-Limit
> (Begründung in ADR 0027).

- **Historisch (Verdikt 2026-10-07, gültig bis ADR 0027):** Das feste Uniform-Layout von 256 Byte
  (`ObjectUniforms`, 16 `vec4` Register) galt als das unantastbare Limit der Engine, um strikte
  WebGL1-Kompatibilität (Fragment-Uniform-Mindestgarantie) sicherzustellen.
- **Kein blindes Slot-Wachstum bleibt Leitplanke:** Neue `vec4`-Felder werden nur über die freien
  `u_matParam0..15`-Slots des 512-Byte-Blocks oder exakt registrierte Lane-Reuses
  (`LaneContractRegistry`) bzw. Kompilierzeit-Spezialisierungen kanalisiert.

### 2. Strategie für Parameter-Surfaces, LOD & komplexe Looks
Sollten künftige Flüssigkeitseffekte (wie multiskaliges Ozean-LOD, komplexe Flow-Maps oder partikelgestützte Schaumkarten) mehr Parameter benötigen, als der 512-Byte-Block fasst, greift folgende Prioritätskaskade (gemäß ADR 0026/0027):
1. **LUT- & Parameter-Texturen (1D/2D):** Texturen bieten unbegrenzte Parameter-Speicherdichte bei voller WebGL1/2/WebGPU-Kompatibilität.
2. **Kompilierzeit-Konstanten:** Feste Material-Presets (z. B. feste Wellenkonfigurationen oder Farben) werden bei der Shader-Assemblierung per Chunk/Token injiziert (0 Uniform-Kosten).
3. **Instanz-/Vertex-Attribute:** Dynamische Partikel, Wellen-Splats oder lokale Modifikatoren können als Geometrie- oder Instanz-Attribute übertragen werden.
4. **Material-Scope-UBOs (WebGL2 & WebGPU only):** Falls nötig, dürfen isolierte Material-Uniform-Puffer existieren, sofern der WebGL1-Fallback graceful degradiert.

### 3. S2/S3 Interaktivitäts-Routing
- **S2 Splat-Displacement:** Dynamische Ringwellen nutzen die registrierte Lane `u_styleA` (`vec4(x, z, spawnTime, energy)`).
- **S3 Boundary Clapotis:** Stehwellen-Reflexionen werden rein analytisch im Vertex-Shader über den bestehenden Vektor `u_worldBounds` (`minX, minZ, maxX, maxZ`) berechnet — mit **0 zusätzlichen Uniform-Bytes**.

### 4. Zero-Allocation & CPU/GPU-Parität
- Manifest-Puffer (`getRenderManifest()`) und Pack-Routinen für alle Flüssigkeitsmaterialien sind zero-allocation auf dem Hot-Path garantiert (`LiquidZeroAlloc.test.ts`).
- Die CPU-seitige Wellensonde (`OpenWaterSurfaceProbe`) spiegelt die 6 Gerstner-Wellen f32-präzise zur GPU-Vertexberechnung für exakten hydrostatischen Auftrieb (`BuoyancySolver`).


