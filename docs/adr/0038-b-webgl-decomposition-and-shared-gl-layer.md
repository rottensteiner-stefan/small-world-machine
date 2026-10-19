# ADR 0038: WebGL-Renderer-Zerlegung & gemeinsame GL-Manager-Schicht

> **Status: ACCEPTED** — 2026-10-19 (Maintainer-Abnahme; ursprünglich DRAFT vom 2026-10-19, Session `swm-wave2-b`). Grundlage:
> Thermo-Audit `.agents/scratches/thermo-1014/01-renderers-webgl.md` (§2.7) und
> `15-cross-cutting-and-roadmap.md`; Paket-Spezifikation `.agents/scratches/wave2-package-B.md`.
> **Übernommen am 2026-10-19 (Maintainer-Abnahme):** ACCEPTED; der DRAFT-Vorbehalt ist obsolet. Paket-B-
> Task 4 (PostEffectPass-GL-Konsum) ist mit Commit `d35b0517` vollständig umgesetzt (`GLPostEffects`,
> `GLPostEffectPass`, GL-seitiges `requiresOpaqueDepth`, Bereinigung der ad-hoc Pass-Felder und `destroy()`-Listen).
> **Pfade bezogen auf `HEAD 879bac8c` (2026-10-19); parallele Sessions verschieben Zeilen — vor weiterer
> Umsetzung re-validieren. ADR-Nummern Wave 2: 0037=A (GPU), 0038=B (WebGL, dieses), 0039=C (Materialien),
> 0040=D (Physix/Geometrie); `docs/adr/index.md` schreibt zentral die Koordination.**

## Kontext & Problem

`AbstractWebGLRenderer`, `WebGL1Renderer` und `WebGL2Renderer` sind die zentralen GL-Renderer der Engine.
Der Audit beklagt deren Größe und Duplikation: `WebGL2Renderer.ts` = 2087 Zeilen (HEAD-Basis), `WebGL1Renderer.ts`
= 1469 Zeilen, darunter die Render-Hot-Path-Methode `_renderSubgroup` mit ~522 Zeilen. Konkret:
- **WebGL1 hatte keine eigene Manager-Schicht.** Programm-/Texture-/Geometry-Caches lagen inline im Renderer;
  WebGL2 hielt die vier Analog-Bausteine (`WebGLProgramCache`, `WebGLTextureManager`, `WebGLBufferManager`,
  `NormalOutputWrapperGL`) unter `WebGL2/managers/`.
- **State/Fog/Billboard-Logik war zwischen GL1 und GL2 dupliziert** (Propertie-Bindung, Fog-Uniformen,
  Sprite-Billboard-Rewrite), mit einer bewussten GL1-only-Divergenz (Mat4-Array-Variante).
- **`WebGL2Renderer._renderSubgroup`** bündelte Flag-Aufbau, Programm-Aktivierung, Cluster-/Spot-/Richtungs-
  Schatten-Binding, IBL-Binding, Material-State/Texture-Binding und die Per-Object-Draw-Schleife (instanziert
  und Standard) in einer Monolith-Methode.

## Entscheidung

1. **Gemeinsame GL-Manager-Schicht unter `renderers/gl/managers/`.** `WebGLBufferManager`, `WebGLTextureManager`,
   `WebGLProgramCache` und `NormalOutputWrapperGL` wurden aus `WebGL2/managers/` dorthin verschoben und
   GLSL-Dialekt-bewusst gemacht (`GlslDialect` = `glsl100` | `glsl300`). `WebGL1Renderer` mountet dieselben
   Klassen mit `{ dialect: "glsl100" }` statt inline-Duplikaten. GL2 nutzt `glsl300` — Fehlermeldungs-/Compile-
   Labels von WebGL1 byte-identisch, GLSL300-Branch byte-identisch.
2. **Gemeinsame State/Fog/Billboard-Teile in `AbstractWebGLRenderer` heben** — nur wo GL1/GL2 identisch sind:
   `resetStateCache()` + 7 Per-Frame-State-Felder, `_bindFogUniforms`, `_bindMaterialState`,
   `_bindGenericMaterialProperties` (parametrisiert über `glsl100`-Flag: die WebGL1-only Mat4-Array-Variante
   bleibt GL1 vorbehalten, GL2 unverändert), `_uploadModelMatrix` (Billboard/Sprite, `_scratchModelMatrix`,
   Null-Allokation). GL1/GL2 laufen für diese Teile auf identischem Basis-Code.
3. **`WebGL2Renderer._renderSubgroup` in benannte Zero-Allocation-Helper zerlegt**: Flag-Aufbau
   (`_buildSubgroupShaderFlags`), Spot-/Richtungs-Schatten-Binding (`_bindSpotShadowMaps`,
   `_bindDirectionalShadowMaps`, inkl. `_ensureShadowMapUnit` als einzige Warn-Stelle), IBL-Binding
   (`_bindGlobalIblUniforms`), Texture-Binding (`_bindSubgroupTextures`) und die Per-Object-Draw-Pfade
   (`_renderInstancedObject`, `_renderStandardObject`). Die Loop-Lesart (`for…of` → index-basiert) bleibt
   Zero-Allocation; keine Verhaltensänderung. **Das `<1700`-Ziel für `WebGL2Renderer.ts` bleibt angestrebt,
   nicht erreicht (siehe Konsequenzen);** die Zerlegung belässt die Helper bewusst in der Klasse, damit der
   Hot Path direkte Privatfeld-Zugriffe behält (Coding-Guide §3B).
4. **PostEffectPass-GL-Konsum (Task 4, ausstehend):** `WebGLPostProcessPass`/`PostProcessPassGL` sollen auf den
   `PostEffectPass`-Interface-Vertrag aus Paket A umgestellt werden (`execute(ctx)`, `destroy()`,
   `Map<PostProcessingEffectType, PostEffectPass>`, `postProcessing.requiresOpaqueDepth` auch GL-seitig,
   `?.destroy()`-Listen in `WebGL2Renderer`/`WebGL1Renderer` zusammengeführt). Das Interface liegt bis zum
   Fold von Paket A nicht auf `main` — der Konsum läuft als Rebase-Glue, sobald `renderers/post/PostEffectPass.ts`
   vorhanden ist.

## Konsequenzen

- **Keine Verhaltensänderung:** `RendererParity*`/Golden-Tests grün; volle Testsuite 322/2227 grün; 4 WebGL-
  Showcase-Shards (20/20/20/18) + 1 WebGPU-Shard (30) ohne Konsole-Fehler; `check:markers` 0 Verstöße.
- **Zeilenstände (transparent):** `WebGL1Renderer.ts` 1469 → 875 (−594, kumulativ; Ziel −300…−400 weit übertroffen),
  `WebGL2Renderer.ts` 2087 → 1872 (−215 kumulativ; `_renderSubgroup` in-method 522 → ~60),
  `AbstractWebGLRenderer.ts` 303 → 485 (Staging der geteilten Helfer).
- **Wartbarkeit:** eine Quelle für Programm-/Texture-/Geometry-Caches, ein Ort für State/Fog/Billboard;
  GL1/GL2 driftverbunden statt parallel.
- **Offen (designer's call):** Unterschreitung der `~1700`-Zeilenmarke für `WebGL2Renderer.ts` erfordert
  Cross-File-Extraktion (Zwischen-Basis `WebGL2SubgroupRenderer` oder `GlobalUniformWriter`-Muster wie Paket A).
- **Abgeschlossen:** Task 4 (PostEffectPass-GL-Konsum) mit Commit `d35b0517` vollständig umgesetzt.
