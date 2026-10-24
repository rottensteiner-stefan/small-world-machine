# Instanced Batching — Verifizierte Quellenliste (2026-10-24)

Begleitdokument zu **`docs/research/instanced-batching-2026-10-24.md`**.

**Methodik:** Recherche durch drei parallele Deep-Research-Agents plus direkte Verifikation durch den Autor. **Jede** unten aufgeführte URL wurde per HTTP-Fetch abgerufen und ihr Inhalt geprüft („verified"). Nicht verifizierbare, oft zitierte Behauptungen wurden **bewusst weggelassen** (drei.js-WebGPURenderer-Notizen: Docs umgebaut, URLs 404; Apple-Metal-`31 vertex attributes`: in dieser Runde nicht parsebar; „PlayCanvas-Multi-Draw"-Ziel-URL in der Session nicht stabil erreichbar). Zwei vom gesunden Menschenverstand abweichende Fakten wurden an mehreren Primärquellen gegengeprüft und **dreifach** bestätigt: (a) kein indirect drawing in WebGL 1/2, (b) `WEBGL_multi_draw` nicht in Firefox.

Vertrauensstufen:
- **[O] = primary/official** — Spezifikation, offizielle Engine-Dokumentation, Konferenz-Primärquelle, Projekt-Changelog
- **[V] = vendor engineering** — Offizielle Hersteller-Blogs/Manuals/Technik-Notizen
- **[E] = experienced engineer** — Blog/öffentlicher Thread erfahrener Engine-Entwickler (teils Maintainer)
- **[C] = community/wiki** — plattformweite Referenz (MDN, caniuse)
- **[P] = Draft/Proposal** — ausdrücklich noch nicht verbindlicher Standard

Die Einstufung „verifiziert durch …" nennt, wer den Abruf tatsächlich durchgeführt hat (A/B/C = Forschungsagent; **direkt** = autor-seitiger Fetch in dieser Session).

---

## 1. Engines & State of the Art

| Quelle (URL) | Titel | Org/Autor | Datum | Tier | Nutzung im Bericht | Verifiziert durch |
|---|---|---|---|---|---|---|
| https://threejs.org/docs/pages/InstancedMesh.html | InstancedMesh — three.js Docs | three.js / drei.js Foundation | aktuell | O | §1 (§6.1): öffentliche Instancing-API, `count`/`instanceMatrix`/`instanceColor`, explizites Culling (boundingSphere wird „for culling" automatisch berechnet) | direkt |
| https://threejs.org/docs/pages/BatchedMesh.html | BatchedMesh — three.js Docs | three.js | aktuell | O | §3/S5: Merge-Batching-Dokumentation; Grenzen (`perObjectFrustumCulled`, `customSort`/`sortObjects` für Transparenz) | C |
| https://docs.unity3d.com/2023.1/Documentation/Manual/static-batching.html | Static Batching — Unity Manual | Unity Technologies | 2023-11-02 | O | §3/S5: 64.000 Verts/Batch, Speicher-Duplikation („same geometry appears … multiple times", Wald-Zitat „serious memory impact") | C |
| https://docs.unity3d.com/2023.1/Documentation/Manual/DrawCallBatching.html | Draw call batching — Unity Manual | Unity Technologies | 2023-11-02 | O | S5 (Culling): „most notably, Unity can still cull meshes individually" — Basis der Gegeninstanz B1 | C |
| https://docs.unity3d.com/2023.2/Documentation/Manual/GPUInstancing.html | GPU instancing — Unity Manual | Unity Technologies | 2024-04-25 | O | §S5: identische Meshes/Material erforderlich; `SkinnedMeshRenderer` nicht instancing-fähig | C |
| https://docs.unity3d.com/Manual/SRPBatcher.html | Scriptable Render Pipeline Batcher — Unity Manual | Unity Technologies | aktuell (2406/6000.6) | O | §3: SRP-Batcher = Render-State-Minimierung; „use as few shader variants as possible"; per-object-GPU-Großpuffer statt Drawcall-Reset | direkt |
| https://docs.godotengine.org/en/stable/classes/class_multimesh.html | MultiMesh — Godot Engine 4.7 Klasse | Godot Engine | aktuell | O | §3/S5: „spatially indexed as one" → Einzel-Culling unmöglich; **Licht-Kontingent geteilt** („once the maximum lights are consumed … the rest … will not receive any lighting"); Blend Shapes ignoriert | direkt |
| https://bevy.org/examples/shaders/custom-shader-instancing/ | Shaders / Instancing — Bevy-Beispiel | Bevy Foundation | n.d. | O | §3: Bevy-Instancing-Beispiel | A |
| https://docs.rs/bevy/latest/bevy/render/batching/index.html | `bevy::render::batching` | Bevy Foundation | build 2026-10-08 | O | §3: offizielles „automatically batch and instance when same Handle<Mesh>/Handle<Material>", `gpu_preprocessing` vs. `no_gpu_preprocessing`, `NoAutomaticBatching`/`NoIndirectDrawing` als Opt-outs, per-Entity-AABB-Culling erhalten | A |
| https://developer.playcanvas.com/user-manual/graphics/advanced-rendering/batching/ | Batching — PlayCanvas User Manual | PlayCanvas/PlayCanvas Ltd | aktuell | O | §3/S5: Batch-Regeln (gleiche Batch-Group-ID/Material/Shader-Parameter/Layer), „larger bounding box … will work less well with camera culling", Re-Batching „potentially expensive", 65.535-Verts-Cap | C |

## 2. Hersteller-/GPU-Ebene (AMD, ARM, Meta)

| Quelle (URL) | Titel | Org/Autor | Datum | Tier | Nutzung | Verifiziert durch |
|---|---|---|---|---|---|---|
| https://gpuopen.com/learn/rdna-performance-guide/ | AMD RDNA™ Performance Guide | AMD GPUOpen | 2023-03-22 ff. | V | §3/S4/S5: Bundles „only benefit CPU … can hurt GPU performance"; „Avoid updating vertex buffer bindings through ExecuteIndirect. Use the vertex pull"; Draw-Args kompaktieren + Count-Puffer; wenig große Command-Listen | A |
| https://gdcvault.com/play/1020791/Approaching-Zero-Driver-Overhead-in (Archiv: https://web.archive.org/web/20240207194540/https://www.gdcvault.com/play/1020791/Approaching-Zero-Driver-Overhead-in) | Approaching Zero Driver Overhead in OpenGL — GDC 2014 | Cass Everitt (NVIDIA), Tim Foley (Intel), John McDonald (NVIDIA), Graham Sellers (AMD) | 2014 (Capture 2024-02-07) | O | §3/S4: historisches Fundament der Draw-Call-Reduktionsbewegung; „reduce driver overhead up to 10×" — Übertrag kontextuell auf WebGL/ANGLE | A |
| https://armkeil.blob.core.windows.net/developer/Arm%20Developer%20Community/PDF/Arm%20Mali%20GPU%20Best%20Practices.pdf | Arm Mali GPU Best Practices | Arm | aktuell | O | §5/S7: „fewer than 500 draw calls (GLES) / 2000 (Vulkan)"; Instancing vor Static-Batches für aggresiveres Instanz-Culling; „use more than one instanced vertex buffer → reduced performance"; Depth-Prepass-Warnung | C |
| https://developers.meta.com/vr/blog/tech-note-unity-settings-for-mobile-vr/ | Unity settings for mobile VR | Meta (Oculus) | 2018-04-12 | V | §5: „There is some CPU overhead for every vertex that is dynamically batched" | C |
| https://unity.com/blog/rendering-at-scale-efficient-strategies-for-massive-object-counts | Rendering at scale: efficient strategies for massive object counts | Unity Technologies | 2026 | V | §5: Skinned nur via VAT+GPU-Instancing auf tausendfache Charaktermengen | C |
| https://www.qt.io/blog/qtquick3d-instanced-rendering | QtQuick3D instanced rendering | Qt Group | 2021-02-26 | V | §5/S7: „GPU performance is a mixed bag"; Instanz-Order → Überzeichnung/Overdraw; Transparenz braucht back-to-front | C |

## 3. Experten-Engineering-Blogs & Maintainer-Threads

| Quelle (URL) | Titel | Org/Autor | Datum | Tier | Nutzung | Verifiziert durch |
|---|---|---|---|---|---|---|
| https://www.sebastianaaltonen.com/blog/no-graphics-api | No Graphics API | Sebastian Aaltonen (ex-DICE/Remedy; Referenzen: RDNA-ISA, GPUOpen, Mesa, Turnip, PTX) | 2025-12-16 | E | §3: CLI-zu-Low-Level-Portings „often resulted in performance regression"; **MDI = zukünftige Kern-Primitive, merge-Batching nicht**; PSO-Permutations-Explosion > Drawcall-Zahl; Vertex-pull-Empfehlung | A |
| https://blog.paavo.me/demo-engine-part-1/ | Adventures in WebGL and frustum culling | Paavo Huhtala (WebGL-Engine-Projekt) | 2024-08-02 | E | §4/S5: 64-kB-UBO-Deckel → ~400 Instanzen/Draw; 164-B/Instanz/Frame-Re-Upload gemessen; bewusster Verzicht auf Split-Multi-Draw „I like the simplicity" | C |
| https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html | WebGPU Speed and Optimization | Gregg Tavares (Google, webglfundamentals) | aktuell | E | §5: „If you are going to only draw a few of the same thing then it's probably not worth the effort"; eine batched-`writeBuffer` pro Frame statt vieler Einzel-Writes | C |
| https://webgpufundamentals.org/webgpu/lessons/webgpu-storage-buffers.html | WebGPU Storage Buffers | Gregg Tavares | aktuell | E | §4: Storage-vs-Instance-Attribute, Default-Limits (64-kB-Uniform / 128-MiB-Storage), `@builtin(instance_index)`-Muster | B |
| https://webgl2fundamentals.org/webgl/lessons/webgl-cross-platform-issues.html | WebGL2 Cross Platform Issues | Gregg Tavares | aktuell | E | §4/S5: MAX_VERTEX_ATTRIBS WebGL1 min 8 / WebGL2 min 16 | C |
| https://waelyasmina.net/articles/batchedmesh-for-… | BatchedMesh for High-Performance Rendering | Wael Yasmina | 2025-01-23 | E | §3 (unterstützend): BatchedMesh-Einsatzgrenzen | C |
| https://github.com/gpuweb/gpuweb/issues/4349 | Investigation: multi-draw-indirect | W3C gpuweb / Chrome | 2023-10-24 … | P | §4/S5/S7: MDI + `drawIndirectCount` Status — in Milestone 2 vertagt; Hardware-Coverage (~99 % Desktop / ~63 % Android; `drawIndirectCount` noch dünner) | B, C |

## 4. Web-API, Spezifikationen & Standardwerk

| Quelle (URL) | Titel | Org/Autor | Datum | Tier | Nutzung | Verifiziert durch |
|---|---|---|---|---|---|---|
| https://registry.khronos.org/webgl/extensions/ANGLE_instanced_arrays/ | WebGL ANGLE_instanced_arrays (Ratified Extension #19) | Khronos | rev 9, 2015-09-23 | O | §2.1/§4: `draw*InstancedANGLE`/`vertexAttribDivisorANGLE`; Promotion-Hinweis → in WebGL2 Kern | B |
| https://registry.khronos.org/webgl/extensions/ | WebGL Extension Registry (Index) | Khronos | live | O | §4: Gesamt-Index (kein indirect, keine `OES_draw_elements_base_vertex` in WebGL) | B |
| https://registry.khronos.org/webgl/extensions/WEBGL_multi_draw/ | WEBGL_multi_draw (#40, Community Approved) | Khronos | rev 8, 2023-09-08 | O | §4/S7: `multiDraw*WEBGL`, `gl_DrawID` via `GL_ANGLE_multi_draw`; „not Baseline" → Feature-Detection-Pflicht | B, A (MDN-Seite) |
| https://registry.khronos.org/webgl/extensions/WEBGL_draw_instanced_base_vertex_base_instance/ | Draft Extension #46 | Khronos | rev 3, 2021-05-26 | P | §4: base-vertex/base-instance nur als Draft; keine Builtins | B |
| https://registry.khronos.org/webgl/extensions/WEBGL_multi_draw_instanced_base_vertex_base_instance/ | Draft Extension #47 | Khronos | rev 8, 2023-09-08 | P | §4: Kombination #40+#46; für v1 ignorieren | B |
| https://registry.khronos.org/webgl/specs/latest/2.0/ + https://registry.khronos.org/webgl/specs/2.0.0/ | WebGL 2.0 Specification | Khronos | 2026 / 2017-04-11 | O | §4: Instancing = Kern; „Indirect" kommt im gesamten Text **0×** vor | B |
| https://registry.khronos.org/OpenGL-Refpages/es3.1/html/glDrawElementsIndirect.xhtml | glDrawElementsIndirect — GLES 3.1 Refpage | Khronos | 2010–2019 | O | §4: indirect erst ab ES 3.1 (API-Tabelle: 2.0 = –, 3.0 = –, 3.1 = ✔) | B |
| https://registry.khronos.org/OpenGL-Refpages/es3.0/html/glVertexAttribPointer.xhtml | glVertexAttribPointer — GLES 3.0 Refpage | Khronos | 2003–2014 | O | §4/S1: MAX_VERTEX_ATTRIBS-indizierte Fehler | B |
| https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf | OpenGL ES 3.0.6 Spec (Tabelle 6.31, §2.9.3) | Khronos | 2019-11-01 | O | §4/S1: MAX_VERTEX_ATTRIBS Minimum **16**; `VertexAttribDivisor` Kern; `gl_InstanceID`-Regel | B |
| https://www.w3.org/TR/webgpu/ | WebGPU Specification (TR) | W3C WebGPU WG | TR 2026-09-15 | O | §4: `drawIndirect`/`drawIndexedIndirect` Kern; `"indirect-first-instance"`-Feature-Gate (sonst no-op); Limits; Render-Bundles (State bei Encode eingefroren); **multi_draw_indirect 0× im Spec** | A, B |
| https://gpuweb.github.io/gpuweb/ | WebGPU spec (canary) | W3C gpuweb | live | O | §4: auch canary ohne `multiDrawIndirect` | B |
| https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_multi_draw | WEBGL_multi_draw — MDN | Mozilla/web-docs | zuletzt 2026-08-27 | C | §4: API + „not Baseline" („does not work in some of the most widely-used browsers") | A |
| https://caniuse.com/webgl2 | WebGL2 support | caniuse (Daten Sep 2026) | Sep 2026 | C | §4: 97,13 % global | B |
| https://caniuse.com/mdn-api_angle_instanced_arrays | ANGLE_instanced_arrays support | caniuse | Sep 2026 | C | §4: 97,48 % global (Chrome 32+, FF 47+, Safari 8+, Edge 12+, iOS 8+) | B |
| https://caniuse.com/mdn-api_webgl_multi_draw | WEBGL_multi_draw support | caniuse | Sep 2026 | C | §4/S7: 93,52 % global; **Firefox ❌** (alle Versionen) — die Firefox-Lücke | B |
| https://developer.chrome.com/blog/new-in-webgpu-131 | What's New in WebGPU (Chrome 131) | Google (François Beaufort) | 2024-11-06 | V | §4: `multiDrawIndirect`/`multiDrawIndexedIndirect` nur experimentell (`#enable-unsafe-webgpu`); Use-Case „instancing, and large scenes" | A |
| https://github.com/gfx-rs/wgpu/blob/trunk/CHANGELOG.md | wgpu CHANGELOG (multi-draw indirect) | wgpu/gfx-rs | trunk (Ende 2025) | O | §4: MDI in wgpu verfügbar (`DownlevelFlags::INDIRECT_EXECUTION`), **nur nicht im W3C-Standard** — „implementierungsreif, nicht standardisiert" | A |
| https://github.com/bevyengine/bevy/issues/89 | GPU Instancing #89 | bevyengine | 2020-08-05 … | E | §5: Instanz-Culling-Kaveat skinned („either all … or none"); Bevy brauchte ~5 J. bis Auto-Instancing | C |
| (MDN `WebGL2RenderingContext`, `drawElementsInstanced`, `vertexAttribDivisor`) | WebGL2-Kernmethoden-Doku | MDN/Mozilla | 2024 | C | §4: Bestätigung Kern-Gegenteil-Erweiterung | B |

## 5. Nicht übernommene, oft behauptete Quellen (bewusst ausgeschlossen)

- three.js `WebGPURenderer`-Notizen zu Instancing/Limits — alle Kandidaten-URLs 404 (Docs umgebaut) → ausgeschlossen statt geraten.
- Apple Metal „31 vertex attributes" — PDF/JS-Seite in dieser Runde nicht parsebar → als unbestätigter Kontext markiert, nicht zitiert.
- „PlayCanvas-Multi-Draw"-Betrachtungs-URL — Session-Output ohne stabile verifizierbare URL → als Mechanik beschrieben, nicht als Quellen-URL gelistet.
- `OES_draw_elements_base_vertex` (GLES-Welt) — in WebGL **nicht** exponiert (Extension-Registry bestätigt) → daher auch nicht als Ziel aufgeführt.
