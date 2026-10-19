# ADR 0039: Typisierte Material-Lane-Tabellen & Shader-Chunk-Konsolidierung (dreisprachige Parität)

> **Status: ACCEPTED** — 2026-10-19 (Maintainer-Abnahme; ursprünglich DRAFT vom 2026-10-19, Session `swm-wave2-c`).
> Grundlage: Thermo-Audit `.agents/scratches/thermo-1014/04-core-materials.md`,
> `02-renderers-webgpu-shaders.md` (Shader-Anteile), `13-extras-packages.md` (pbr_math ×3,
> Cluster-Index-Mathe), `15-cross-cutting-and-roadmap.md` (§2.8/§2.9); Paket-Spezifikation
> `.agents/scratches/wave2-package-C.md`.
> **Übernommen am 2026-10-19 (Maintainer-Abnahme):** ACCEPTED; der DRAFT-Vorbehalt ist obsolet. Der offene
> Verhaltens-Entscheidungspunkt Sheen-`specColor`-Divergenz (Entscheidung 4) wird separat geklärt;
> Ergebnis wird dort bzw. in der CHANGELOG nachgetragen.
> **Pfade/Commits bezogen auf `HEAD 4806d21a` (2026-10-19); parallele Sessions verschieben Zeilen — vor
> weiterer Umsetzung re-validieren. Wave-2-ADR-Nummern: 0037=A (GPU), 0038=B (WebGL, gelandet), 0039=C
> (Materialien, dieses), 0040=D (Physix/Geometrie); `docs/adr/index.md` schreibt zentral die Koordination.**

## Kontext & Problem

Zwei auditierte Mängel in den Material-/Shader-Quellen:
1. **Magic-Slot-Wiederverwendung statt typisierter Lane-Tabellen.** Überladene Uniform-Slots
   (`u_pad1`, `u_extraParams`, `u_liquidParams`, `u_thresholds`, `u_texOffset`/`u_texRepeat`,
   `u_color.a` als Specular-Intensitäts-Proxy) werden pro Material ad hoc re-interpretiert. Dadurch
   ist nicht aus dem Layout ersichtlich, welcher Lane welche Semantik trägt; eine Layout-Änderung kann
   ein anderes Material still brechen. Die in Wave 1/ADR 0027 etablierten semantischen
   `matParam0..2`-Slots (Liquid/StylizedWater) waren nicht auf die übrigen Materialien übertragen.
2. **Dreisprachige Duplikate** (glsl100 / glsl300 / wgsl): der Glass/Frostglass-PBR-Lichtloop existierte
   als **sechs** byte-identische In-Material-Kopien (3 Sprachen × 2 Materialien). Weitere Duplikate
   (`pbr_math`-Funkionssatz, Wellen-Ableitung in 6 Dateien, Cluster-Index-Mathe, geometrische Helfer)
   waren über `shaders/source/**` verteilt; ein Shader-Fix musste mehrfach geführt werden.

## Entscheidung

1. **Typisierte Lane-Tabelle pro Material statt Magic-Slots (Task 1).** Neues Modul
   `packages/engine/src/core/materials/MaterialLanes.ts` definiert einen typisierten `MaterialLane`
   (ID + `wxMax`/`vec4`-Semantik) und den packer `writeLane()`. Exemplarisch nutzt `StandardMaterial`
   eine `_LANES`-Tabelle (`u_matParam0.x` statt `u_pad1`, gepackt via `writeLane`, ADR-0027-Muster),
   mit deterministischem Reset im `clone()`-Pfad (`_renderManifest`). Die Liquid-/Wasser-Materialien
   nutzen die bereits lane-konsistenten Arrays (FluidSurface → `matParam0..4`, LiquidWave →
   `matParam3..6`, OpenWater/StylizedWater → `matParam3/4/5/6` Wellen bzw. Kante, StylizedWater-Specular
   → `matParam7.x`; `u_color.a` ist wieder echtes Alpha). Tote Deklarationen (u. a. `u_texOffset`)
   entfernt. Glass/Frostglass-Beleihung von `u_extraParams`/`u_liquidParams` bleibt wie vorgefunden
   (bewusst, siehe Konsequenzen). `MaterialLanes` nicht im öffentlichen Barrel (internes Werkzeug).
   Neue Source-Invariant-/Lane-Paritäts-Tests (`MaterialLaneTableParity.test.ts`), angepasste
   `DeadOptionLint`-/`OpenWaterSurfaceProbe`-Tests. **Wert-erhaltend**: kein Pixeldrift (Golden-Proof).
2. **Shared/Consolidierte Shader-Chunk-Bausteine „wo byte-identisch möglich“ (Task 2).** Konkret
   konsolidiert: der Glass/Frostglass-PBR-Lichtloop (directional/point/spot) wurde aus **sechs**
   byte-identischen In-Material-Kopien in **eine geteilte Chunk-Datei pro Dialekt** extrahiert —
   `web_gl1|web_gl2/chunks/glass_pbr_loops.frag.glsl` + `web_gpu/chunks/glass_pbr_loops.wgsl` — und in
   `CoreShaderChunks.ts` als `GLASS_PBR_LOOPS` (glsl300+glsl100) / `WGSL_GLASS_PBR_LOOPS` (wgsl)
   registriert. Glass **und** Frostglass referenzieren nur noch den Platzhalter; die Assemblierung ist
   **byte-identisch zum Vorzustand** (per Skript verifiziert: Platzhalter→Chunk reproduziert exakt die
   Original-Bytes), damit ist der Pixel-/Golden-Pfad trivially driftfrei. Kein `#ifdef`-Dauerbranching
   (ADR-0013-/Liquid-Doktrin); das einzige bewusste Dialekt-Delta (WebGPU-Spot `select(...)`-Fallback
   bei `maxDist == 0`) bleibt als solches dokumentiert und wird im Paritätstest gepinnt.
3. **Source-Invariant-/Paritäts-Tests je umgebautes Chunk-Trio (Task 3).** Neuer
   `GlassPbrLoopsParity.test.ts` (Muster `OpenWaterGlsl100ConstantParity.test.ts`): Registrierung für
   alle drei Dialekte, strukturelle Trio-Parität (BRDF-Terme, Konstanten, exakt dieselben drei
   Lichttypen, je genau ein `Lo +=` pro Lichttyp, keine `#ifdef`s, identisches Spot-Falloff-Gesetz),
   Material-Seite (keine private Loop-Kopie, keine eingebetteten `D_GGX(`-Aufrufe in Glass/Frostglass),
   sowie die Divergenz-Doku.
4. **Offene Verifikationen (Task 4) → Befunde dokumentiert, keine stillen Fixes (STOP-Regel):**
   - **Sheen/Emissive teilen `u_specColor` (Bericht 02 #8) — bestätigt, bewusst offen gelassen.**
     WebGL1 + WebGPU gaten Sheen zur Laufzeit auf `(u_specColor.rgb > 0)` (Tint = `u_specColor.rgb`,
     `sheenRoughness = clamp(u_thresholds.y, 0.05, 1.0)` ist wegen der 0.05-Untergrenze rechnerisch
     immer aktiv), WebGL2 gated per Compile-Flag `USE_SHEEN` mit weißer Sheen-Tint. Ein emissives
     Material (das `u_specColor` als Emissionsfarbe führt) erhält damit auf WebGL1/WebGPU Sheen ohne
     WebGL2-Äquivalent — **drei Semantiken, vorbestehend.** Eine Vereinheitlichung wäre eine
     sichtbare Verhaltensänderung (mind. eines Backends) → bewusst NICHT still in Paket C korrigiert;
     User-Entscheid + CHANGELOG-Bullet vorgeschlagen.
   - **Decals `color.a`-Manifest (Showcase 12):** `u_color.a` bleibt echtes Alpha
     (`DecalMaterial` → `u_color`), von den Task-1-Lane-Umlegungen unberührt; Showcase 12 im Browser
     ohne neue Fehler. OK.
   - **Cluster-Index-Mathe:** WebGL2 zentralisiert in `computeClusterCellIndex` (LIGHT_DEFS-Chunk);
     WebGPU hält die identische Formel inline in `lighting_pbr.wgsl` **und** `lighting.wgsl` — mit
     explizitem In-Kommentar-Vermerk, dass es keinen Shared-Code-Mechanismus zwischen den beiden
     Chunks gibt (bewusste Duplikation, einheitliche Formel, kein Verhalten-Delta).
5. **Bewusst NICHT konsolidiert (Wo „byte-identisch“ nicht greift, dokumentierte Gründe):**
   - `[GLOBAL_UNIFORMS]`/`[OUTPUT_TRANSFORM]`: die GLSL-`GlobalUniforms`-Deklaration muss in jedem
     Vertex-Shader ohnehin byte-identisch zur LIGHT_DEFS-Chunk-Deklaration stehen (WebGL2-Renderfähig-
     keits-Anforderung); gesichert durch den „identical GlobalUniforms fields“-ShaderValidation-Test.
     Eine Extraktion in einen Chunk brächte Indirektion ohne funktionalen Gewinn → belassen.
   - `deriveWaves`/Wellen-Ableitung (6 Dateien): OpenWater vs. StylizedWater divergieren im Loop
     (S2-Ripple, S3-Clapotis, `w3.w`-Guard, Crest-Metrik) — nicht byte-identisch, eine
     Funktions-Extraktion wäre ein semantischer Refactor ohne ALU-Budget-Gewinn → belassen.
   - `linearizeDepth`: existiert nur in WebGPU-Compute (`froxel_inject/integrate/reproject`,
     `b_visibility_test`), einsprachig, keine Cross-Backend-Duplikation → kein Chunk nötig.
   - `pbr_math` ×3: bereits eine Datei pro Sprache (registriert als `PBR_MATH`/`WGSL_PBR_MATH`); die
     GL-Licht-Chunks (`light_calc_pbr.frag.glsl` glsl100+glsl300, `lighting_pbr.wgsl`) **rufen** die
     Funktionen nur, definieren sie nicht (verifiziert) → Sicht-Vereinheitlichung bereits gegeben.
   - `shadeLight(L, radiance, …)` als Funktions-Chunk: durch die GLASS_PBR_LOOPS-Verheftung ist der
     Per-Licht-Loop bereits eine geteilte Quelle; eine Signatur-getriebene Funktions-Extraktion über
     alle PBR-Materialien trägt ALU-Paritätsrisiko ohne Budget-Nutzen → belassen (kann Nachfolge sein).
   - OilPuddle/Bloom (×3): liegen außerhalb der Paket-C-Boundary bzw. sind bereits eine Quelle pro
     Sprache → kein Aktionsbedarf in C.

## Konsequenzen

- **Keine Verhaltensänderung:** alle Task-1-Lane-Umlegungen wert-erhaltend (Golden: mein Render ist
  byte-identisch zum Clean-HEAD-Render, 0.0000 % Abweichung in allen 32 Golden-Zellen; die einzige
  Differenz zur CI-Baseline ist Umgebungs-bedingt, Mac vs. CI — Baseline bleibt gültig, keine
  Neuaufnahme). Task-2-Assemblierung byte-identisch (Skript-Verifikation). Showcase-Shards grün:
  WebGL 2/4 (20+18 Checks) + WebGPU Shard 1 (30) — `failed=0`, inkl. Showcase 10/12/16 ohne neue
  Fehler. Volle Testsuite grün (326 Dateien / 2303 Tests auf HEAD), `check:markers` 0 Verstöße.
- **Wartbarkeit:** ein Ort für den Glass-PBR-Loop (pro Sprache), ein Ort für neue
  MatLen-Semantiken (`MaterialLanes`, `writeLane`); Shader-Fixes für Glass/Frostglass müssen nur noch
  in der Chunk-Datei geführt werden.
- **Grep-Gate:** `u_pad`-Treffer im Code **17** (vor Paket C höher; Grenze laut Spezifikation < 23);
  aussagekräftige Rest-Treffer sind Layout-Padding/Testliterale.
- **Transparente Grenzen:** `<23`-Uhr ohne erzwungenes universelles Chunk-Registry; GLOBAL_UNIFORMS/
  OUTPUT_TRANSFORM/deriveWaves/linearizeDepth/shadeLight/cluster als künftige, bewusst gekoppelte
  Einzelschritte benannt (siehe Entscheidung 5); Sheen-`specColor`-Divergenz als offener
  Verhaltens-Entscheidungspunkt für den User geflaggt.
- **Commits Paket C (lokal, kein Push):** `f405dbf0` (Task 1), `36a7e47f` (Task 2), `4806d21a`
  (Task 3) sowie der ADR/CHANGELOG-Commit dieses Endes — nicht Teil eines Releases; kein
  Version-Bump. ADR-Index-Zeile ergänzt zentral die Koordination.
