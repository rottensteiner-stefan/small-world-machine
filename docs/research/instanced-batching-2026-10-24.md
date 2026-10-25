# Instanced Batching — Stand der Technik & Integrationsbewertung für Small World Machine

- **Datum:** 2026-10-24
- **Anlass:** Auftrag: „Lerne mehr über Instanced Batching (5–10 Quellen von bestem Ruf). Liefere einen Bericht, wie wir das integrieren könnten — oder warum auch nicht."
- **Vorgehen:** Drei parallele Deep-Research-Agents (State of the Art / Web-Plattform-API-Fakten / Gegen-Evidenz) mit ausschließlich per Fetch verifizierten Quellen; kanonische Engines-Doku zusätzlich direkt verifiziert (three.js, Unity SRP Batcher, Godot MultiMesh). Vollständige, gestufte Quellenliste: `docs/research/instanced-batching-sources-2026-10-24.md`.
- **Befund vorab:** „Instanced Batching" ist **kein grünes Feld** — die hochwertige Kernvariante ist seit heute bereits produktiv im Code (ADR 0046, Automatisches Instancing). Dieser Bericht bewertet, ob/welche darüber hinausgehenden Stufen (Geometry-Merge, Multi-Draw, GPU-driven) sich für SWM lohnen.
- **Einordnung (Projektdoktrin):** Kein Vorentwurf von Abstraktion; große Features brauchen Messbeleg. Zusätzlich seit Kurzem bindend: [Whack-a-Mole-Doktrin (ADR 0047)](../adr/0047-whack-a-mole-doktrin.md) — neue öffentliche Parameter im auditierten Hot-Scope müssen klassifiziert werden (`@domain`/`@derived`/`@fixed`), geteilte Abstraktionen brauchen ≥3 semantische Konsumenten. Beides wirkt direkt auf jede Empfehlung unten: wenig bis keine neuen Renderer-Knöpfe, keine Vorrats-Subsysteme.

---

## 0. Management-Summary (Bottom Line)

1. **Behalten:** Das vorhandene Automatische Instancing (ADR 0046, `quality.autoInstancing`) ist exakt das Muster, das three.js, Bevy, Godot, Unreal und andere als Konsens anbieten. Es ist industriestandard-konform und erhält — im Gegensatz zu Geometry-Merging — die per-Objekt-Culling-Granularität. **Kein Handlungsbedarf, keine Abschaltung.**
2. **Die drei verbleibenden „Batching"-Stufen sind alle Drei **Verschieben („defer")** mit expliziten Triggern — nicht bauen auf Vorrat:
   - **B1 Geometry-Merge / Static-Batching** (drei.js `BatchedMesh`, Unity Static Batching, PlayCanvas `BatchManager`): speicherintensiv, zerstört Einzel-Bounds (Culling!), Rebuild-Kosten bei Bewegung. Höchstens als Build-/Offline-/Editor-Tool, nie als Runtime-Subsystem ohne Messbeleg.
   - **B2 Multi-Draw „gleiches Material, viele Geometrien"** (`gl_DrawID`): die einzige echte Funktionslücke. Aber auf dem Web 2026 ein Feature-Detection-Minenfeld (Firefox hat `WEBGL_multi_draw` **nicht**; WebGPU hat **kein** standardisiertes multi-draw-indirect). Machbar als tier-getrennter Dreipfad (WebGPU-Einzel-`drawIndexedIndirect` / WebGL2-`WEBGL_multi_draw` + CPU-Fallback), aber nur mit Schwellenwert.
   - **B3 Voll-GPU-driven** (HZB-Readback → GPU-Compute-Culling → indirekte Draws): auf WebGPU erst sinnvoll, wenn multi-draw-indirect standardisiert ist; derzeit höchstens Evolution des vorhandenen HZB.
3. **Eine billige, doktrinkonforme Sofort-Option innerhalb der vorhandenen Architektur:** ADR 0046 bildet Runs nur aus **aufeinanderfolgenden** Objekten einer Material-Subgroup (keine Sortierung pro Frame). Da opake Reihenfolge egal ist, kann die Renderliste **innerhalb einer Material-Subgroup nach Geometrie gruppiert** werden, um Runs länger zu machen — gemessen statt dogmatisiert (siehe §7).
4. **Der laut Quellen höchste Hebel ist gar kein Batching:** Material-/Shader-Varianten-Konsolidierung. Unity SRP Batcher und Sebastian Aaltonen argumentieren übereinstimmend, dass Render-State-/PSO-Konsolidierung > Zeichenzahl ist. Weniger Material-Spezialisierungen vergrößern jeden vorhandenen ADR-0046-Run ebenfalls.
5. **Nicht synchronisierte Hot-Range:** Alles mit Performance-Tiering (ADR 0035) fahren; kein neuer globaler Schalter.

---

## 1. Einordnung des Begriffs (warum „Instanced Batching" irreführend ist)

„Instanced Batching" verschmilzt im öffentlichen Diskurs vier **unabhängige** Fähigkeiten, die getrennt bewertet werden müssen:

| Begriff | Mechanik | Beispiel-Implementierung |
|---|---|---|
| **Instancing** — N Kopien *einer* Geometrie+*eines* Materials in einem Draw | `drawElementsInstanced` + per-Instance-Attribute (Divisor/`stepMode:"instance"`) | SWM `InstancedMesh`, ADR 0046; three.js `InstancedMesh`; Godot `MultiMesh`; UE `ISM` |
| **Geometry-Merge / Static Batching** — viele *verschiedene* Meshes in **ein** Vertex-/Index-Buffer verschmolzen, ein Draw | CPU-seitiges Kopieren in einen Merged-Buffer; Verlust der Einzel-Bounds | three.js `BatchedMesh`; Unity Static/Dynamic Batching; PlayCanvas `BatchManager` |
| **Multi-Draw** — viele Sub-Draws *verschiedener* Geometrien in **einem** Call, gemeinsame Pipeline | `glMultiDraw*` / `WEBGL_multi_draw`, `#extension GL_ANGLE_multi_draw`, `gl_DrawID` | PlayCanvas Multi-Draw; Bevy indirect-Pfade; (WebGPU: noch nicht standardisiert) |
| **GPU-driven Rendering** — Geometrie-Culling/-Komprimierung auf der GPU, Draw-Args aus GPU-Puffern | Compute-Shader schreiben `drawIndexedIndirect`-Argumente | Nanite; ID-Engine-GPU-Granularitäts-Pfade; wgpu `multi_draw_indirect` |

Konsequenz für SWM: Die verbleibenden Stufen B1–B3 bauen **nicht** aufeinander auf und haben getrennte Kosten/Nutzen. Genau deshalb hat ADR 0046 B1 und B3 bereits bewusst verworfen — mit den anderen zwei wurde bisher nicht gerechnet, das liefert dieser Bericht.

**Attribut-Arithmetik (die Mathematik, die alles begrenzt):** Eine Instanz-Matrix ist 4 Float4-Slots (`a_instanceMatrix`, Lagen 6–9 in SWM). Für Skelett-Meshes gilt: `position(3) + normal(3) + uv(2) + joints(4) + weights(4) + color(4) = 22 > 16` — **vor** Instancing bereits über dem garantierten Minimum von `MAX_VERTEX_ATTRIBS = 16` (WebGL-Minimum **und** WebGPU-Default/Cap). Skinned+Instanced in getrennten Attribute-Streams ist auf dem Web also nur mit Indirektion (Textur/Storage-Puffer + `instance_index`) möglich. Mittelteil: **per-Instance-Daten niemals in Attribute-Slots planen; pro-Instance-Transforms über `@builtin(instance_index)` → Storage-Puffer routen (WebGPU) bzw. über einen einzigen geteilten Instanz-Stream (WebGL2).**

---

## 2. Ist-Aufnahme in Small World Machine (Ist-Zustand, verifiziert im Code)

### 2.1 Vorhandene Instancing-Infrastruktur

- **`packages/engine/src/core/InstancedMesh.ts`** — Core-Klasse (77 Z.), `instanceCount`/`instanceMatrices`/`instanceData`, Dirty-Flags; genutzt u. a. von `WeatherEmitter`, `RainStreaks`, `BillboardInstancer`.
- **Renderer-Pfade je Tier (alle drei):**
  - WebGL1: `ANGLE_instanced_arrays` (Extension) in `WebGL1Renderer.ts:677–686` (per-Objekt-Fallback, Tier-Autonomie).
  - WebGL2: `_renderInstancedObject` (`WebGL2Renderer.ts:1922`), `_drawInstanced` (`:2128`), per-Instance-Attribute mit `vertexAttribDivisor`; fixe Lagen 6–9 mat4, 10 = `a_instanceData` (`WebGLProgramCache.ts:118–128`).
  - WebGPU: `stepMode:"instance"`-Slots 6–10, Partial-Upload mit High-Water-Mark (`WebGPURenderer.ts:1396–1479`), `GPUInstanceRingBuffer` pro Frame.
- **Shader:** `USE_INSTANCING` ist bereits in allen Material-Shadern kompiliert (`base_vertex_header.vert.glsl:13–22` GLSL2, `base.vert.glsl:6–12` GLSL1, WGSL-Rewrite `GPUPipelineCache.ts:657–688`).

### 2.2 ADR 0046 — Automatisches Instancing (seit heute produktiv)

- **Mechanik:** `partitionInstanceRuns()` (`renderers/AutoInstancing.ts`, `AUTO_INSTANCING_MIN_RUN = 4`) spaltet eine opake Material-Subgroup in Runs aus **aufeinanderfolgenden** Objekten mit identischer `GeometryData`-Identität; min. 4 Objekte; ausgenommen skinned/Joints/`InstancedMesh`, im Shadow-Pass Nicht-Caster. WebGL2 streamt Weltmatrizen in einen geteilten Puffer, WebGPU in den Per-Frame-Ring; Model-Matrix = Identität; Lifecycle-Buchhaltung läuft pro Objekt weiter. `quality.autoInstancing` (Default `true`).
- **Grund/Rationale (ADR-0046-Text):** Showcase 19 (1600 Würfel, eine Geometrie, ein Material) → 6695 Draws/F (inkl. Shadow-Cascades). `InstancedMesh` scheidet aus, weil jedes Objekt eigenes Picking/Behaviors/Octree-Eintrag/Material braucht.
- **Gemessen (ADR 0046):** WebGPU 6695 → 6 Draws (14,9 → 8,2 ms/Frame, Vsync-Limit); WebGL2 5660 → 5 Draws.
- **Bekannte Schwäche (ADR-0046-Text, „Konsequenzen"):** nur *aufeinanderfolgende* Objekte bilden Runs — Szenen, die gleiche Geometrien mit anderen mischen, profitieren weniger. Genau diese Lücke adressiert Option A2 in §7.

### 2.3 Bewusst nicht vorhanden (Gap)

Kein `drawIndirect`/`multiDraw` (0 Treffer in `packages/`), keine Render Bundles (WebGPU-Datei deklariert explizit „deliberately not used", `WebGPURenderer.ts:1354`), kein Geometry-Merge/Static-Batching-Utility, kein Batching über Materialgrenzen. WebGL1 bewusst per-Objekt. HZB-Occlusion (WebGPU-only) ist ein **Readback-Feedback-Loop** (Ergebnis 1–3 Frames verzögert, `HzbOcclusionSystem.ts:15–24`) — kein GPU-driven-Indirect.

---

## 3. State of the Art (2023–2026, Top-Ruf-Quellen, alle per Fetch verifiziert)

Detailierte Belege mit URL/Tier: siehe Quellen-Anhang. Hier die konsensfähigen Kernaussagen:

| Engine/Werk | Muster | Für SWM relevante Erkenntnis |
|---|---|---|
| **three.js** `InstancedMesh` / `BatchedMesh` | Explizites Instancing; `BatchedMesh` = ein **einziger instanzierter Draw über per-`addGeometry` zusammengeführte Sub-Parts in einem Merged-Buffer**, **ohne** Dokumentation einer Attribut-Kompatibilitäts-Warnung (kein „gleiche Vertex-Layouts"-Hinweis im ausgelieferten Docs) | `BatchedMesh` dokumentiert selbst die Grenzen, für die es Workarounds braucht: `perObjectFrustumCulled`, `customSort`/`sortObjects` für Transparenz — Bestätigung der Culling-/Sortierkosten von Merge-Batches. Schwelle in der Community (>1.000 unique Objects, #28776), darunter ist vanilla/Instancing schneller |
| **Unity** Static/Dynamic Batching, GPU Instancing, **SRP Batcher** | Static merge (64.000 Verts/Batch-Grenze, **Speicher-Verdopplung**, „serious memory impact" bei dichten Wäldern); Dynamic batching = CPU-Kontrakt, auf modernen Geräten kontraproduktiv; SRP Batcher minimiert Render-State-Änderungen statt Draws | Unity verkauft gegen manuelles Merging: „**most notably, Unity can still cull meshes individually**". SRP-Prinzip: **„use as few shader variants as possible"** — Konsolidierung > Drawnzahl. SkinnedMeshRenderer: GPU-Instancing nicht unterstützt; Crowd-Scale nur via VAT |
| **Unreal** ISM/HISM, Nanite | Explizite Instancing-Componenten; HISM = Hierarchical-LOD-Instancing; Nanite = Meshlet-/Virtual-Geometry-GPU-Rendering | Nanite: dedizierter Pass, nur Opaque/Masked, kein Forward-Lighting/Decals, WPO stark begrenzt — für stylized/inszenierte Szenen massiv überspezifiziert |
| **Godot** `MultiMesh` | Explizites Instancing (low-level); offizielle Doku | Direkt aus der Doku: Instanzen sind **„spatially indexed as one"**, AABB muss der Nutzer setzen → Einzel-Culling unmöglich; **Licht-Limit teilt sich** (verbrauchen wenige Instanzen das max-Lights-Kontingent, bekommen die übrigen **kein Licht**); Blend Shapes ignoriert |
| **Bevy** `batching`-Modul, `gpu_preprocessing` | Automatisches Instancing (gleiche `Handle<Mesh>`+`Handle<Material>`), GPU-preprocessing-Pfad optional, `NoAutomaticBatching`/`NoIndirectDrawing` = per-Entity-Opt-out | Bevy bestätigt das ADR-0046-Muster offiziell; per-Entity-AABB-Frustum-Culling bleibt erhalten; GPU-driven als Ziel, aber abwählbar (dasselbe „Indirect = Ziel, aber Feature-Detect"-Muster wie PlayCanvas) |
| **PlayCanvas** `BatchManager`, Multi-Draw | Statisches Batching mit 65.535-Verts-Cap & Batch-Gruppen-Regeln; Multi-Draw-Erweiterung mit `gl_DrawID` | `BatchManager`-Regeln: gleiche Batch-Group-ID, gleiches Material, gleiche Shader-Parameter, gleiche Layer; „a larger bounding box … will work less well with camera culling"; Re-Batching „potentially expensive" |
| **AMD** AZDO (GDC 2014), RDNA Performance Guide | Historische Fundamente gegen Driver-Overhead; heutige RDNA-Doku | „Avoid using bundles … they only benefit CPU performance"; **noch härter:** „Avoid updating vertex buffer bindings through ExecuteIndirect. Use vertex pull instead"; Argument-Puffer immer kompaktieren + Count-Puffer; wenig große Command-Listen |
| **Aaltonen** „No Graphics API" (2025) | Engine-Erfahrung 30 J. gegen Over-Low-Leveling | „porting DX11 renderers to DX12 often resulted in performance regression"; **MDI = Kern-Primitive der Zukunft** (Draw-Count aus GPU-Adresse), **merge-Batching nicht**; PSO-Permutations-Explosion > Drawcall-Zahl → **Variante-/Material-Konsolidierung ist der eigentliche Hebel** |

**Synthese §3:** Der branchenweite, dokumentierte Konsens ist exakt der ADR-0046-Weg (Instancing für gleiche Geometrie+gleiches Material, per-Objekt-Culling behalten). Kein Hersteller empfiehlt Merge-Batching für dynamische/stilisierte Szenen als ersten Hebel; alle warnen vor Culling-Verlust. Der einzige von mehreren Engineering-Quellen als „echte Lücke" benannte Punkt ist Multi-Draw „gleiches Material, verschiedene Geometrien".

---

## 4. Web-Plattform-Hard-Fakten (alle aus Primärquellen verifiziert)

Diese Faktenreihe entscheidet über das „wie/ob wir bauen":

1. **Es gibt in WebGL überhaupt kein indirektes Zeichnen — weder WebGL1 noch WebGL2.** `drawArraysIndirect`/`drawElementsIndirect` existieren erst ab **OpenGL ES 3.1**; WebGL2 basiert auf **ES 3.0** (im kompletten WebGL2-Spec-Text 0× „Indirect"). Keine WebGL-Erweiterung stellt es bereit. **GPU-driven Rendering ist auf dem Web WebGPU-only.** (Khronos-Registry, WebGL2-Spec, GLES-3.1-Refpage)
2. **Multi-Draw im WebGL: nur `WEBGL_multi_draw` (#40, Community-Approved), und Firefox hat es nicht.** Chrome/Edge ≥86, Safari ≥15/iOS ≥15; caniuse (Sep 2026): 93,52 % global, **Firefox ❌ in allen Versionen**. → Feature-Detection-Pflicht, nie erforderlich machen. `gl_DrawID`-Builtin via `#extension GL_ANGLE_multi_draw`.
3. **`WEBGL_draw_instanced_base_vertex_base_instance` (#46) ist nur Draft** — Implementierungen nicht garantiert; `gl_BaseVertex`/`gl_BaseInstance` fehlen absichtlich (als Uniforms reichen).
4. **`MAX_VERTEX_ATTRIBS` = 16 ist das verbindliche Minimum** (WebGL: übernommen aus GLES 3.0, Tabelle 6.31) **und** der WebGPU-Default **und** das Cap (`maxVertexAttributes`). Mobile/ANGLE sind bei 16; Desktop-GL kann 32, darauf ist kein Verlass. (§1-Arithmetik.)
5. **WebGPU: `drawIndirect`/`drawIndexedIndirect` sind Kern** (mit `indirectOffset`). `firstInstance ≠ 0` in indirekten Argumenten ist hinter dem optionalen Feature `"indirect-first-instance"` — sonst **no-op**. **multi-draw-indirect ist NICHT im Standard** (weder TR noch canary; Issue #4349 → #1354 in Milestone 2 vertagt, „teams lack excitement"). Chrome 131 bietet es nur experimentell (`#enable-unsafe-webgpu`).
6. **Render Bundles (WebGPU) sind Kern, aber:** Render-State **und** Bind-/Dynamic-Offset-State sind beim Encoden eingefroren, bei `executeBundles` nicht überschreibbar. AMD rät ohnehin ab (nur CPU-Nutzen, GPU kann leiden; wenn überhaupt ≥10 Draws pro Bundle). SWM hat das bereits bewusst verworfen (Doku-Kommentar `WebGPURenderer.ts:1354`).
7. **`@builtin(instance_index)` (WGSL) ist Kern** und der kanonische Weg, pro-Instance-Daten aus Storage-Puffern zu holen; Storage-Binding-Cap 128 MiB, Offset-Alignment 256 B.
8. **Fehlende aber oft behauptete Stücke (bewusst ausgeschlossen):** Metal-„31 Attribs" nicht verifizierbar in dieser Runde; drei.js-WebGPURenderer-Notizen (Docs umgebaut, URLs 404). Keine Behauptung ohne Fetch.

**Konsequenz §4 für SWM:** Ein sauberer, heute portabel baubarer Weg für B2 (Multi-Draw „gleiches Material, viele Geometrien") wäre ein **tier-getrennter Dreipfad** — WebGPU: pro-Cluster `drawIndexedIndirect`-Loop mit `instance_index`→Storage; WebGL2 (Feature-Detect): `WEBGL_multi_draw` + `gl_DrawID`; Fallback: CPU-Loop über Einzel-Draws (der heutige Pfad, bleibt erhalten). PlayCanvas und Bevy zeigen exakt dieses Muster. Voll-GPU-driven (B3) wartet auf Standardisierung von WebGPU multi-draw-indirect.

---

## 5. Wann Batching schadet — Evidenz (Gegen-Gewichte)

Damit die Empfehlung ehrlich bleibt, die dokumentierten Kollateralschäden (alle belegt, siehe Anhang):

- **Speicher & Rebuild (B1):** Unity Static Batching dupliziert Vertices pro Objekt („same geometry appears … multiple times", Wald-Zitat: „serious memory impact"); Caps zwingen zur Fragmentierung (Unity 64.000 Verts, PlayCanvas 65.535); Re-Batching nach Mutation „potentially expensive" (PlayCanvas).
- **Culling-Granularität (B1, teils B2):** Merge/Instancing mit Sammel-Bounds macht aus N vollem Tragen **ein** „all-or-nothing"-Tragen. ARM (offizielles best-practices-PDF) empfiehlt Instancing **gerade deshalb** gegenüber Static Batches („more aggressively cull instances which are guaranteed to not be visible"); Unity bewirbt Einzel-Culling als Vorteil gegen manuelles Merging; Godot „indexed as one"; three.js musste `perObjectFrustumCulled` nachrüsten; Bevy #89 (skinned-instancing ohne Culling). **Direkter Konflikt mit SWMs HZB-Investition** — genau die Stelle, wo B1 aktiv schadet.
- **Call-bound vs. pixel-bound:** Batching senkt **CPU-/Driver-Kosten**, nicht GPU-Durchsatz. ARM: „fewer than 500 draw calls … GLES, 2000 Vulkan" als ehrliches Budget; sogar ein Depth-Prepass „nearly always" lohnt nicht auf Tiled-GPUs (analog zu Schatten-/Overdraw-Multiplikatoren). Qt: GPU-Bilanz „a mixed bag", Überzeichnung durch Instanz-Order möglich.
- **Material-Divergenz:** Batch bricht an Materialgrenzen (PlayCanvas: gleiches Material+Shader-Parameter nötig; Unity: identische Meshes) — ein vertikaler Batcher über Materialgrenzen (Unity GRD-Richtung) braucht Material-Parameter pro Instanz im Storage-Buffer = eigenes Subsystem; Nutzen invers zur Kunst-Heterogenität.
- **Slot-/Bandbreiten-Druck:** pro-Instance-Attribute werden **pro Vertex** neu gelesen (bandbreitenintensiv); ARM: „more than one instanced vertex buffer … reduced performance", dynamisch indexierte Instanz-Uniforms verlieren Register-Mapping. Gemessen (Community): 164 B/Instanz/Frame Re-Upload bei WebGL2; UBO 64-kB-Deckel ≈ **~400 Instanzen/Draw**.
- **Skinned/animiert fliegt raus:** Unity: GPU-Instancing für `SkinnedMeshRenderer` nicht unterstützt; Crowd-Scale nur via VAT — SWM-Charaktere (die Naheliegendsten) sind strukturell ausgeschlossen; übrig bleiben statische Props — die Region, wo Culling-Verlust am meisten wehtut.
- **Transparenz fliegt raus:** Instancing nur sauber für opak; Transparentes bleibt per-Objekt sortiert (Qt rückwärts-treppauf; three.js `customSort`). Alpha-Objekte „poppen" still aus dem Batch.
- **Regressionsfälle:** wenige Instanzen amortisieren die Instanz-Kosten nicht (Greggman); per-Frame-Matrizen des oberen Laderaums (paavohtl); Shadow-Pass multipliziert Speicherdurchsatz (halb-sichtbare Batches zahlen vollen Vertex-Preis); die 1,6-MB-Draw-Arg-Re-Uploads des CPU-BatchedMesh-Burn in drei.js-Issues.
- **Wartbarkeit (B3/B2):** gpuweb #4349: multi-draw-indirect-Hardware nur ~99 % Desktop / **~63 % Android**, `drawIndirectCount` noch dünner; Bevy hat das Thema ~5 Jahre liegen lassen und liefert weiter nur Auto-Instancing; ein Einzelentwickler (Blog) hat vollen GPU-driven-Verzicht aus „I like the simplicity" dokumentiert.

**Gegen-Synthese §5:** B1 und B3 kaufen genau das ein, was SWM gerade schützt (Culling, Schlichtheit). Die einzige Stufe, deren Nutzen den Schaden nachweislich übersteigen kann, ist B2 (geometrie-heterogene, material-homogene Massen) — und auch die erst oberhalb einer echten Objekt-Schwelle.

---

## 6. Bewertung & Optionen für SWM

| Option | Was | Aufwand | Wann es sich zahlt (Trigger) | Verdikt 2026 |
|---|---|---|---|---|
| **A1** — ADR 0046 weiter + Material-/Varianten-Konsolidierung (wenige Spezialisierungen je Szene) | keine Renderer-Änderung; Kunst-/Tooling-Regel | sehr gering | immer; vergrößert jeden vorhandenen Run; PSO-Prinzip (Unity/Aaltonen) | ✅ Jetzt |
| **A2** — Run-Verlängerung: opake Renderliste **innerhalb Material-Subgroup nach Geometrie gruppieren** (kein globaler Sort; Reihenfolge opak egal) | kleiner Umbau in `Scene._collectVisible`-Batchaufbau, kein neuer Parameter | gering | Szenen, die Geometrien mischen (ADR-0046-Schwäche); Messpflicht | ✅ Jetzt / messen |
| **B1** — Static Geometry-Merge als Build-/Offline-/Editor-Tool (Chunking nach Region/Max-AABB, 64-k/65-k-Caps, Material- und Attribut-Compat-Prüfung) | mittel; außerhalb der Runtime, kein Hot-Scope | mittel | dichte statische Prop-Gruppen, **nach** Messbank-Call-limitiert | ⏸ Trigger gerade offen |
| **B2** — Multi-Draw „gleiches Material, viele Geometrien", tier-getrennter Dreipfad (WebGPU `drawIndexedIndirect`-Loop+`instance_index`→Storage / WebGL2 `WEBGL_multi_draw`+`gl_DrawID` / CPU-Fallback) | hoch; berührt alle Tiers; neue Shader-Pfade | hoch | nachhaltig >500 GLES-Tier-Draws bei Ziel-FPS **oder** Szene mit ≥10k material-homogenen opaken Objekten auf Screen | ⏸ der einzige echte Gap — aber hinter Feature-Detection, erst mit Trigger |
| **B3** — Voll-GPU-driven: HZB-Readback → Compute-Culling → `drawIndexedIndirect`-Komprimierung | hoch; WebGPU-only | hoch | Multi-Draw-indirect im WebGPU-Standard **und** 50k-Objekt-Szenen-Bedarf | ⏸ warten auf Standard |

**Warum NICHT sofort (das ehrliche „warum auch nicht"):**
- Der messbare Restnutzen über ADR 0046 hinaus existiert nur bei **Material-Homogenität + Geometrie-Heterogenität + Massen** — in stylized, inszenierten SWM-Szenen selten kombiniert (Kunst-Pipeline neigt zu vielen eigenständigen Materialien).
- Jede weitere Stufe kauft ein gegen Culling-Granularität (SWM hat HZB) oder gegen Web-Realität (Firefox-Multi-Draw-Lücke, WebGPU-MDI unstandardisiert).
- B1/B2/B3 sind jeweils Subsysteme (neue Klassen, neue Shader-Varianten, neue Pfade je Tier) — exakt die „Idiotic-class-heaps"-Gefahr gegen die ADR 0047 Whack-a-Mole-Doktrin und das „Kein-Vorentwurf"-Prinzip.
- ADR 0046 hat diese drei bereits als begründete Verworfenheiten aufgelistet; dieser Bericht bestätigt die Begründung mit 30+ verifizierten Quellen statt sie zu widerlegen.

---

## 7. Empfehlung & Trigger-Schwellen (verbindlich fürs Projektjournal)

**Sofort (eine Runde, gemessen):**
1. **A1 + A2 zusammen** umsetzen oder zumindest einmal durchmessen: (a) Geometrie-Gruppierung innerhalb der Material-Subgroup als zuschaltbare Detail-Option unter `quality` (falls neuer Parameter nötig: als `@fixed`/`@derived` gemäß ADR 0047 klassifizieren), (b) in einer echten Welt-Szene (z. B. Showcase-19-analoger Geometrie-Mix) Draws/F & Frame-Zeit vorher/nachher per Performance-Tier-Governor erfassen. Erwartung nach Quellenlage: Run-Pool wächst, ohne Culling zu verlieren (Puffer pro Run statt pro Frame — Bandbreite messen).
2. **Nichts Neues bauen** für B1/B2/B3.

**Defer-Liste (ins Backlog, mit expliziten Triggern):**
- **B1 (Merge-Tool):** Trigger = Messbank zeigt CPU-/Draw-limitiert **und** ≥10 k Verts statischer, single-material Propgruppen in einer Szene (Culling-Verlust durch Region-Chunking < Gewinn).
- **B2 (Multi-Draw):** Trigger = nachhaltig >500 GLES-Tier-Draws bei Ziel-FPS **oder** ≥10 k material-homogene opake Objekte sichtbar; **neu prüfen, sobald** WebGPU multi-draw-indirect standardisiert ist (Milestone-2-Tracker) oder Firefox `WEBGL_multi_draw` liefert.
- **B3 (GPU-driven):** Trigger = WebGPU multi-draw-indirect im Standard **und** Szene mit ≥50 k culling-würdigen Objekten auf Screen (sonst bleibt Readback-HZB günstiger).

**Grundregel:** Vor jeder Entscheidung messen, ob die Szene **call-limitiert (CPU/Driver)** oder **pixel-limitiert (GPU/Overdraw)** ist. Draw-Call-Reduktion hilft nur im ersten Fall (ARM, Qt). Der Performance-Governor (ADR 0035) ist das Instrumentarium.

---

## 8. Quellenlage & Umgang

- Vollständige, nach Themen sortierte und **nach Vertrauensstufe gestufte** Quellenliste mit URL/Titel/Org/Datum/Tier und pro Quelle belegter Nutzung: **`docs/research/instanced-batching-sources-2026-10-24.md`** (dieser Bericht verlinkt darauf statt Quellen zu duplizieren).
- Methoden-Standard wie in früheren Papieren: jede zitierte URL per HTTP-Fetch verifiziert; nicht verifizierbare Behauptungen („legendäre" Zitate) wurden **bewusst fallengelassen**, nicht übernommen. Absolute Klarheit bei zwei vom gesunden Menschenverstand abweichenden Fakten: (a) kein indirect in WebGL, (b) `WEBGL_multi_draw` nicht in Firefox.
- Diese Untersuchung **ersetzt ADR 0046 nicht** und etabliert keine neue Architektur-Entscheidung; sie bestätigt dessen Ablehnungen mit aktueller Evidenz und definiert die Bedingungen, unter denen ein künftiger ADR (B1/B2/B3) begründet wäre.

---

## 9. Stand (Umsetzung & erste Messung — 2026-10-24)

**A2 ist umgesetzt** (Commit `fb2a83dd`, „Order is the first law of heaven.") — wie in §7.1(a) empfohlen, aber bewusst **ohne neuen öffentlichen Parameter**: Die Geometrie-Gruppierung erfolgt renderer-seitig unmittelbar vor `partitionInstanceRuns` unter dem bestehenden `quality.autoInstancing`. Damit weder Whack-a-Mole-Fläche (keine neue `@domain`/`@derived`-Einstellung; `npm run check:doctrine` bleibt sauber) noch eine Scene-Vertragsänderung. Neue reine Helper `groupByGeometryForInstancing` in `packages/engine/src/renderers/AutoInstancing.ts` (stabile ES-2019-Sortierung, `WeakMap`-Ordinal-Scratch = keine Per-Frame-Allokation, deterministisch, nur Referenz-gleiche Geometrien — dieselbe Semantik wie ADR 0046). Eingebaut in `WebGL2Renderer.ts` (Main-Opaque) und `WebGPURenderer.ts` (`_renderSubgroup`, nährt dort zusätzlich das K6-Vertex-Puffer-Dedup).

**Erste automatisierte Messung** (WebGPU-Encoder-Draw-Count, deterministisch im CI-Test `WebGPURendererHotPath.test.ts`): 12 opake Objekte, 2 verschiedene Geometrien, gemeinsames Material, **gestreut** eingefügt (nie ≥4 identische Geometrie in Folge — exakt die ADR-0046-Schwäche).

| Zustand | Ergebnis |
|---|---|
| Naive Ordnung (ADR 0046 pur): `partitionInstanceRuns` | **0 Runs** → 12 Einzel-Draws |
| Mit A2-Gruppierung (`autoInstancing` aktiv) | 6er-Run + 6er-Run → **2 instanced Draws** (je 6 Instanzen) |
| `autoInstancing` deaktiviert | **12 Einzel-Draws** |

→ **6-fache Draw-Reduktion auf dem zuvor unbatchbaren Fall**, als Regressionstest belegt.

**Ehrliche Grenzen dieser Runde:**
- WebGL2 nutzt dieselben geteilten pure Helper (Unit-getestet); ein eigener WebGL2-Main-Pass-Draw-Zähl-Harness bleibt offener Folgepunkt (der vorhandene WebGL2-Harness deckt nur den Schatten-Run-Pfad ab).
- §7.1(b) bleibt offen: eine echte Welt-Szene mit Draws/Frame **und** Frame-Zeit vorher/nachher per Performance-Tier-Governor im Browser. Oben ist eine deterministische Test-basierte Zählmessung, keine Laufzeitmessung.
- B1/B2/B3 bleiben gemäß Trigger-Matrix in §6/§7 deferiert.

---

### 9.1 WebGL2-Paritätsmessung (2026-10-25)

**Der in §9 oben als offen markierte WebGL2-Main-Pass-Draw-Zähl-Harness ist umgesetzt und geschlossen** — Parität zur WebGPU-Messung aus §9, deterministisch im CI-Test `packages/engine/tests/renderers/WebGL2MainOpaqueInstancing.test.ts`. Gleicher Streuaufbau (12 opake Objekte, 2 verschiedene Geometrien, 1 gemeinsames Material, nie ≥4 identische Geometrie in Folge); die Zählung läuft über die Draw-Äquivalente `_renderInstanceRun`/`_renderStandardObject` im **echten** `renderBatch`-Entscheidungspfad (A2-Gruppierung + `partitionInstanceRuns` real; nur die GL-Blätter sind gezählte Stubs — 1:1-Draw-Äquivalent).

| Zustand (WebGL2 Main-Opaque, `renderBatch`) | Ergebnis |
|---|---|
| Naive Ordnung: `partitionInstanceRuns` | **0 Runs** → 12 Einzel-Draws |
| Mit A2-Gruppierung (`autoInstancing` aktiv) | 6er-Run + 6er-Run → **2 instanced Draws**, 0 per-object |
| `autoInstancing` deaktiviert | **12 Einzel-Draws** (per-object) |

→ **Identisches Messergebnis wie WebGPU (2 statt 12 Draws)**. Erwartetes Verhalten: Beide Tiers durchlaufen dieselben geteilten pure Helper (`groupByGeometryForInstancing` + `partitionInstanceRuns`) — WebGL2 bekommt denselben Algorithmus, keine degradierte Variante (Tier-Autonomie-Doktrin). Die **deterministische Call-Count-Geschichte ist damit auf beiden Tiers vollständig geschlossen.**

**Verbleibender §7.1(b)-Restpunkt — jetzt präzise handoffbar (nur noch device-gebunden):**
- Offen ist ausschließlich die **Realtime-Messung im Browser**: Frame-Zeit und Puffer-Upload-Bandbreite pro Frame auf einem konkreten Gerät per Performance-Tier-Governor (ADR 0035) — ein gerätegebundener Wert (analog zur WebGL2-PCSS-Kostenzahl in `docs/guides/shadows.md`, auch dort im realen Browser auf dem M4 Pro gemessen), kein deterministischer CI-Wert.
- Rezept (sobald gewünscht): geometrie-mischende Szene (Showcase-19-artig, aber 2–3 Geometrie-Größen unter **einem** Material, **gestreut**), Kamera fix weit genug weg (Culling-Einfluss ausblenden); Draws/Frame + Frame-Zeit **vorher/nachher**. Hinweis: die Engine hat **keine** öffentliche Draw-Call-Zähl-API — Messung über einen kurzen GL-Draw-Wrapper oder den Tier-Governor-Diagnostik-Modus.
- B1/B2/B3 bleiben gemäß Trigger-Matrix in §6/§7 unverändert deferiert.

#### 9.1.1 Reale Browser-Messung (Showcase 44, 2026-10-25) — beide §9-Follow-ups geschlossen

Der letzte noch als "nur device-gebunden" geführte Restpunkt (§7.1(b)) ist jetzt ebenfalls **real im Browser gemessen** — mit einem dauerhaften Messstand statt einer Einmal-Handaufnahme:

- **Showcase 44** (`apps/showcases/44/`) ist eine wiederverwendbare Mess-Rigg: zwei Cube-Geometrien (1.0/1.7) unter **einem** `StandardMaterial`, **gestreut** alternierend (`i % 2`, nie ≥2 gleiche Geometrien in Folge), alle `frustumCulled = false`, fixe erhöhte Kamera, nur `AmbientLight` (keine Shadow-Draws), Renderer erzwungen `WEB_GL2`. URL-Knobs: `?inst=off` (Auto-Instancing aus = Baseline), `?count=N`, `?frames=N`.
- **Engine-fremde Zählung:** `canvas.getContext("webgl2")` liefert denselben Kontext-Objekt der Engine → Shadowing der vier Draw-Entrypoints (`drawArrays/drawElements` + Instanced-Varianten). Keine Engine-Änderung, kein neuer öffentlicher Parameter (Whack-a-Mole-Doktrin).
- **Reproduzierbar:** `npm run build:showcases && node scripts/measure-a2-instancing.mjs` (startet eigenen Preview-Server, Headless-Chrome/SwiftShader-WebGL2 — identische Launch-Matrix wie `check-showcases.js`). Automatisiert über Puppeteer; Ergebnis einmalig als `MEASURE {json}`.

**Gemessene Realwerte (1600 Objekte, 240-Frame-Fenster nach 30 Warm-up-Frames, SwiftShader-WebGL2):**

| Leg | Draw-Calls/F | per-Object-Draws/F | instanced Draws/F | avgFPS | Frame-Zeit |
|---|---|---|---|---|---|
| Auto-Instancing an (A2-aktiv) | **≈ 2** | 0 | ≈ 2 | 45,2 | 22,1 ms |
| Baseline (`inst=off`) | **≈ 1600** | ≈ 1600 | 0 | 42,9 | 23,3 ms |

- **Draw-Call-Reduktion ≈ 800×** im Opaque-Main-Pass, 0 per-object — der A2-Vorteil exakt wie deterministisch vorhergesagt (2 statt 1600).
- **Frame-Zeit-Delta klein (~5 %)**: Die Szene ist unter Software-Rasterung **pixel-/präsentiert-limitiert** (1600 gefüllte Cubes überschreiben den Screen mehrfach) — bestätigt das in §7.1 dokumentierte Kaveat: Call-Reduktion hilft nur bei call-limitierten Szenen. Das ist der erwartete, ehrliche Befund, kein Messfehler.
- **Absolute Frame-Zeiten sind SwiftShader-artefaktbehaftet** (CPU-Rasterung) und nicht GPU-repräsentativ; der **Draw-Count ist backend-unabhängig** und der präzise, geräteunabhängige Wert. Die gerätepräzise Frame-Zeit auf dedizierter Hardware — der in §9.1 vorher als "optionaler, device-gebundener Folgeschritt" markierte Posten — ist inzwischen **ausgeführt** (echte GPU, M4 Pro): **§9.1.2**.
- Messfenster-Artefakt (Divisor +1 Frames → 1,99 statt 2,0 bzw. 1593 statt 1600) ist rechnerisch unerheblich; semantisch sind es 2 bzw. 1600 Draw-Calls pro Frame.

→ **Beide in §9/§9.1 benannten Follow-ups sind damit vollständig geschlossen:** (1) deterministische WebGL2-Parität im CI-Test, (2) reale Browser-Messung der Geometrie-Mix-Szene in Showcase 44. Kein §7.1(b)-Restpunkt mehr offen.

#### 9.1.2 Gerätepräzise Frame-Zeit auf echter GPU (M4 Pro, 2026-10-25) — device-gebundener Schritt ausgeführt

Der in §9.1/§9.1.1 zuvor als "optionaler, device-gebundener Folgeschritt" markierte Posten — echte Frame-Zeit statt SwiftShader-Artefakt — ist jetzt **ausgeführt und geschlossen**.

- **Setup:** Reiner `A2_GPU=1`-Modus von `scripts/measure-a2-instancing.mjs` — **headful Chrome auf der echten GPU** (ANGLE/Metal), kompositorisches Frame-Limit **abgeschaltet** (`--disable-frame-rate-limit --disable-gpu-vsync --disable-vsync`), sonst würden beide Legs am 60-Hz-Cap kleben und das Delta wäre unsichtbar. Viewport 1440×900, 1600 Objekte, 240-Frame-Fenster nach 30 Warm-up-Frames — identisches Messprotokoll wie §9.1.1.
- **GPU-Nachweis** (`WEBGL_debug_renderer_info.UNMASKED_RENDERER_WEBGL`): `ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, ...)` — Hardware inkl. Renderer-String im Laufprotokoll, kein SwiftShader-Fall.

| Leg | Draw-Calls/F | Frame-Zeit | avgFPS |
|---|---|---|---|
| Auto-Instancing an (A2-aktiv) | **≈ 2** | **1,55 ms** | 647 |
| Baseline (`inst=off`) | **≈ 1600** | **2,48 ms** | 403 |

- **Draw-Call-Reduktion ≈ 800×** erneut bestätigt — der Count ist unverändert geräte- und backend-unabhängig.
- **Frame-Zeit-Delta auf echter Hardware jetzt messbar: Baseline +0,93 ms (+60 %) pro Frame** — reiner CPU/Driver-Overhead der ~800× mehr Draw-Aufrufe (identische Pixelmenge, identische Geometrie, uncapped). In vsync-gebundenen Real-Szenen schlägt dieser Overhead direkt aufs Frame-Budget (Pacing), nicht als roher FPS-Sturz.
- **Ehrliche Einordnung:** Die Absolutwerte (1,6–2,5 ms) sind niedrig, weil die Testszene weit unter GPU-Sättigung läuft (1440×900, simple Cubes) und uncapped gemessen wird. Relevant ist der **relative Call-Overhead (+60 %)**, der über das 240-Frame-Fenster deterministisch und stabil ist — kein Rauschen. Der Befund bestätigt qualitativ das §7.1-Kaveat, präzisiert es aber: Call-Last ist selbst bei pixel-limitierter Szene auf echter Hardware als Frame-Zeit-Zuschlag nachweisbar, sobald nicht vsync-verdeckt.
- **Reproduzierbar:** `npm run build:showcases && A2_GPU=1 node scripts/measure-a2-instancing.mjs` (startet den eigenen Preview-Server, headed Chrome, showt das Fenster). Die SwiftShader-Werte (§9.1.1) bleiben als CI-artige Kontroll-Rechenzeile dokumentiert; M4 Pro ist die gerätepräzise Referenz (analog zur `docs/guides/shadows.md`-M4-Pro-Messung).

→ Damit ist im Instancing-Report **kein Posten mehr "auf später" verschoben** — deterministische Parität, reale Browser-Messung und gerätepräzise Frame-Zeit liegen vor.
