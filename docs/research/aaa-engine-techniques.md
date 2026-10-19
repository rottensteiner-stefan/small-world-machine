# AAA-Rendering-Techniken — Wunschliste & Bestand

**Ursprünglich:** 2026-08-19/20 — vergleichende Recherche von Rendering-Techniken aus Unreal Engine,
Babylon.js, three.js und Godot hinsichtlich Übertragbarkeit auf eine kleine Hybrid-WebGL1/WebGL2/WebGPU-Engine.
**Umbau:** 2026-09-27 — die ursprüngliche Recherche wurde gegen den Live-Code verifiziert; umgesetzte
Punkte sind jetzt fester Bestand, die verbleibenden Punkte sind unten als pflegbare **Wunschliste**
konsolidiert. Die vollständige Recherche-Historie (Methode, Quellen, Details) ist in den Git-Commits
dieses Dokuments und im Referenz-Anhang am Ende erhalten.

> **Hinweis:** `docs/research/` ist ein Point-in-time-Bereich. Diese Datei wird zugleich als Wunschliste
> gepflegt; der Abgabestand („erledigt") ist anhand des Live-Codes verifiziert und muss bei neuer
> Implementierung aktualisiert werden (✅/🟡/🔍 gemäß Konvention, niemals gelöscht werden).

---

## Wunschliste (offene Punkte, pflegbar)

| # | Technik | Priorität | Aufwand | Abhängigkeit / Hinweis |
|---|---|---|---|---|
| W1 | ✅ **umgesetzt** — **Echter volumetrischer Nebel (Froxel, „Stufe B")** — kamera-ausgerichtetes 3D-Dichte-Raster + Raymarching + Phasenfunktion/In-Scattering gegen Lichtquellen, God-Rays. (ADR 0031, Showcase 39 „Atmospheric Sanctum"; Früher: **hoch** (nächstes großes Vorhaben), Aufwand mittel.) | — | Wiederverwendet die Clustered-Lighting-Infrastruktur (#5): Frustum-Slicing, Pro-Zelle-Lichtlisten (Frostbite/Hillaire SIGGRAPH 15 bestätigt diese Reihenfolge). WebGPU via Compute; WebGL2-Folge als CPU-Culling+Datentextur geplant (ADR 0031), WebGL1 kein Pfad. Referenzarchitektur: Unreal, Godot 4 (nur Forward+), Frostbite. |
| W2 | **Volles GTAO** — aktuell nur ein vereinfachtes HBAO (`AOPassGL/GPU`, `HbaoElement`). Es fehlen: kosinus-gewichtete Arc-Integration (arccos statt `dot()`-Proxy), Multi-Bounce-Näherung, Dünne-Objekte-Heuristik, Temporal Filtering über Motion Vectors (bräuchte volles TAA, netto offen). | mittel | mittel | Separate Einordnung im Referenz-Anhang A. |
| W3 | **LOD + Dithered Cross-Fade** — kein LOD-System vorhanden; einfache Distanzstufen mit Bayer-/Noise-Dither an der Fade-Grenze. | niedrig-mittel | mittel | Erst sinnvoll, wenn Multi-LOD-Assets existieren. |
| W4 | ✅ **umgesetzt** — **Billboards/Imposter** — für offene Welten/Wälder/Menschenmengen; `BillboardInstancer` (`core/objects/`), Showcase 34; CPU-seitige Billboard-Ausrichtung (das „Unreal/Fortnite tree"-Muster). (Früher: Priorität niedrig, Aufwand mittel, kein dringender Anwendungsfall.) | — | — |
| W5 | **Volles TAA (Motion-Vector-Reprojektion)** — aktuell dokumentierter Trade-off ohne Reprojektion (Ghosting bei schneller Bewegung akzeptiert). | niedrig (bewusster Verzicht) | groß | Extra-Render-Target + Pro-Material-Output; Basis (`HistoryBlendPassGL/GPU`) existiert bereits. |

> **Stand 2026-10-19:** W1 (volumetrischer Froxel-Nebel, „Stufe B") und W4 (Billboards) sind
> umgesetzt — W1 via ADR 0031/Showcase 39 (Froxel = Cluster-Grid-Reuse, WebGPU-V1; WebGL2 als
> ADR-0031-Folge geplant), W4 via `BillboardInstancer` (Showcase 34). Beide Reihen oben sind zur
> Historie mit ✅ markiert und zählen nicht mehr zu den offenen Punkten. Weiter offen: W2 (volles
> GTAO), W3 (LOD), W5 (volles TAA).

**Bewusst geschlossen (nicht mehr offen):**
- **#4 Pro-Objekt-Lichtauswahl** — obsolet: durch Clustered/Tiled Lighting (#5) ersetzt (globaler Cap 16/64).
- **#13/volumetrischer Nebel Stufe A** (Noise-Aufsatz) — verworfen: kein branchenüblicher Pfad, Stufe B ist das echte Etappenziel (siehe Historie).
- **#16 Schneesturm als Fog-Parametrisierung** — verworfen: Branchenlösung ist Partikel-/Overdraw-VFX (CoH2: Halb-Auflösungs-Trick), kein Volumetric-Fog; `WeatherEmitter`/Showcase 32 (Radioactive Ashfall) setzt das bereits um.

---

## Fester Bestand (umgesetzt, Referenz)

> Holen Sie Details aus dem Live-Code/ADR; Kopien hier sind Zitat-Ebene, nicht Wahrheit. Verifikationsdatum: 2026-09-27.

| # | Technik | Status | Wo / Nachweis |
|---|---|---|---|
| 1 | ACES-Tonemapping (statt Reinhard/Linear) | ✅ vorhanden | `ToneMappingMode.DEFAULT = ACES_FILMIC`, alle 3 Backends |
| 2 | Normal-Offset Bias bei Schatten | ✅ implementiert | Dir & Spot, GLSL300+WGSL, Standard+PBR-Pfad; WebGL1 ohne Schatten |
| 3 | Fixed-Timestep Render-Interpolation | ✅ implementiert | `PhysicsSystem.applyRenderInterpolation()`, `RigidBody.prev*`, getestet |
| 5 | Clustered/Tiled Forward+ Lighting | ✅ implementiert | `ClusterCullPassGPU` (Compute), `WebGLClusterCullPass` (CPU), `ClusterGrid` geteilt, Cap 64 (WebGPU)/16 (WebGL2); ADR 0007; WebGL1 ausgenommen |
| 6 | PCSS (Contact-Hardening Soft Shadows) — Directional | ✅ implementiert | `u_dirShadowMapRaw`-Sampler (Unit 14), Blocker-Search + Penumbra-Schätzung; Spot bewusst ausgelassen (Rechtfertigung in Historie, ADR 0006) |
| 7 | CSM-Politur: Cascade-Blending + Texel-Snapping | ✅ implementiert | alle 4 Lighting-Chunks; `DirectionalLight.updateCascades()` |
| 8 | Vereinfachtes HBAO (kein echtes GTAO → W2) | 🟡 implementiert (vereinfacht) | `AOPassGL/GPU`, `HbaoElement` (default aus); Einordnung: elliptische Nähe zu HBAO, kein GTAO |
| 9 | Vereinfachtes TAA (Halton-Jitter + History-Blend) + `MotionTrailElement` | ✅ implementiert | `HistoryBlendPassGL/GPU` (aus `TAAPass*` umbenannt), `TaaElement`; Trade-off dokumentiert |
| 10 | GPU-Instancing nutzen | ✅ bestätigt | `InstancedMesh` existiert; Disc Wars / Neon Labyrinth (beide entfernt) nutzten es korrekt |
| 11 | Game Feel: Camera-Shake, Hit-Stop, Squash&Stretch | ✅ implementiert | `ShakeEffect` (Trauma²+Simplex), `triggerHitStop`, `SquashStretchBehavior`; getestet |
| 14 | Hierarchical-Z Occlusion Culling | ✅ implementiert | `HzbOcclusionPassGPU` (WebGPU-only, opt-in via `EngineOptions.enableOcclusionCulling`), ADR 0008 — **Status im Original-Dokument war veraltet** |
| 16 | Schneesturm/Wetter (als Ashfall) | ✅ implementiert | `WeatherEmitter`-Extension, Showcase 32 „Radioactive Ashfall" |

---

## Referenz-Anhang (zitierte Abwägungsgründe, Stand 2026-08)

> Diese Ausschnitte bleiben erhalten, weil externe Dokumente darauf verweisen:
> `docs/guides/shadows.md` (PCSS-Umfang), `docs/guides/configuration.md` (HBAO-Einordnung), `REFERENCES.md` (TAA-Trade-off).

### 6. PCSS-Umfang (zitiert von `docs/guides/shadows.md`)

PCSS für **directionales Licht umgesetzt** als Drop-in-Upgrade auf PCSS-Infrastruktur: 8-Tap-Blocker-Search
(fester Ring ±2 Texel, nicht-vergleichender Tiefenread `u_dirShadowMapRaw`), Penumbra-Schätzung aus
`occluderDepthDelta / bias`, variable 3×3-PCF-Schleife mit `texelSize * pcfRadius`. Nur primäre Kaskade
erhält PCSS; das Kaskaden-Blend-Sample bleibt festes PCF (Kosten). **Spotlicht-PCSS bewusst nicht
umgesetzt:** 4 zusätzliche Raw-Sampler/Texture-Units bei WebGL2 für einen Lichttyp, der in aktuellen
Showcases seltener/kleinräumiger Schatten wirft — schlechtes Aufwand-Gewinn-Verhältnis.

**WebGL1-Schatten bewusst ausgelassen:** dort existiert gar keine Shadow-Map-Implementierung (kein CSM/PCF);
Minimalvariante (eine Dir-Shadow-Map, `WEBGL_depth_texture`, 4-Tap statt Hardware-PCF, fester Bias) wäre
machbar, aber WebGL1 ist ohnehin der LOW-Tier-Fallback (`DeviceCaps` reduziert dort Schattenauflösung) —
Schatten lieber wegnehmen als hinzufügen. (PAF-Verifikation: Bestand-Abschnitt #6.)

### 8. HBAO-Einordnung (zitiert von `docs/guides/configuration.md`)

Ein Full-Resolution-Screen-Space-Pass: View-Space-Position aus Opaque-Depth rekonstruiert (über
Perspektiv-Matrix-Diagonalterme, keine volle Inverse), Normale über Screen-Space-Ableitungen der
Position (dFdx/dFdy bzw. manuelle Differenzen in WGSL), pro 6 fester Richtungen 4 Marschschritte mit
Max-Dot-Produkt. **Näher an HBAO als an SSAO:** `dot(Richtung, Normale)` = Sinus des Horizont-
Elevationswinkels → strukturell Horizont-Suche, aber nur ein Max-Sample statt kontinuierlichem Tracking
und ohne Tangentenwinkel-Subtraktion. Was GTAO ausmacht, fehlt (siehe W2). Bekanntes Artefakt:
Ableitungs-Normalen entarten an Silhouetten-Kanten → übertriebene Randverdunkelung. Läuft nur, wenn der
Opaque-Depth-Capture aktiv ist (Bug fix: Capture lief vorher nur bei Transparenz in der Szene; jetzt
auch bei aktivem HBAO). Default aus.

### 9. TAA-Trade-off (zitiert von `REFERENCES.md`, Accumulation-Buffer-Eintrag)

Vereinfachtes TAA: Halton(2,3)-Jitter (16 Samples, zyklisch) direkt in `Camera.updateViewMatrix()`-
`_viewProjMatrix`, exponentielles History-Blend mit `feedback = 0.9`, Ping-Pong
(`HistoryBlendPassGL/GPU`, umbenannt aus `TAAPass*`). Keine Motion-Vektoren/Reprojektion → akzeptiertes
Ghosting bei schneller Bewegung; glättet Kanten in statischen/slow-Szenen. `MotionTrailElement` nutzt
dieselbe History-Blend-Infrastruktur (höherer Feedback, kein Jitter) als bewusster Stil-Effekt.
Volles TAA = W5.

### 13. Volumetric-Fog-Stufenmodell (Hintergrund für W1)

- **Stufe 0 (aktueller Bestand):** analytischer Distanz-/Höhen-Fog (`Fog`), reiner Post-Lighting-
  Farbverschnitt, kein Scattering/Noise/Zeit — entspricht Unreal Height Fog ohne Inscattering.
- **Stufe A (verworfen):** Noise-Multiplikation auf `fogFactor` — keine der geprüften Engines baut das
  als eigene Stufe; nur ein Abzweig, kein Etappenziel.
- **Stufe B (W1):** Froxel + Raymarching + Phasenfunktion. Frostbite (Hillaire) etabliert die
  Reihenfolge „erst Pro-Zelle-Lichtlisten (== #5), dann Nebel als Konsument". Unity HDRP: Local
  Volumetric Fog ohne volumetrische Schatten; Godot: nur Forward+; Unreal/Godot/Frostbite: mit
  Selbstabschattung. **(Stand 2026-10-19: Stufe B ist umgesetzt — ADR 0031, Showcase 39; dieser
  Abschnitt dokumentiert die Recherche-Grundlage.)**

---

## Quellen (vollständige Liste der Recherche)

- Clustered Lighting: [Godot-Renderer-Docs](https://docs.godotengine.org/en/stable/tutorials/rendering/renderers.html) · [three.js ClusteredLighting](https://threejs.org/docs/pages/ClusteredLighting.html) · [Babylon.js 9.0 Announcement](https://blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0/) · [Babylon.js Clustered Lighting Doc](https://doc.babylonjs.com/features/featuresDeepDive/lights/clusteredLighting/) · [A Primer on Efficient Rendering & Clustered Shading (aortiz.me)](http://www.aortiz.me/2018/12/21/CG.html) · [Practical Clustered Shading — Emil Persson](https://www.humus.name/Articles/PracticalClusteredShading.pdf)
- Schatten: [PCSS (RTR Kap. 7.6)](https://assassin-plus.github.io/posts/Percentage-Closer-Soft-Shadows/) · [NVIDIA Soft Shadows Sample](http://gameworksdocs.nvidia.com/GraphicsSamples/SoftShadowsSample.htm) · [Sampling of Shadow Techniques — therealmjp](https://therealmjp.github.io/posts/shadow-maps/) · [Catlike Coding — Directional Shadows](https://catlikecoding.com/unity/tutorials/custom-srp/directional-shadows/) · [Cascaded Shadow Maps with Soft Shadows — Alex Tardif](https://alextardif.com/shadowmapping.html) · [three-csm](https://strandedkitty.github.io/three-csm/) · [Virtual Shadow Maps (Unreal)](https://dev.epicgames.com/documentation/en-us/unreal-engine/virtual-shadow-maps-in-unreal-engine) · [VSM Fortnite Ch. 4](https://www.unrealengine.com/en-US/tech-blog/virtual-shadow-maps-in-fortnite-battle-royale-chapter-4)
- Culling/LOD/Instancing: [Visibility & Occlusion Culling (Unreal)](https://dev.epicgames.com/documentation/en-us/unreal-engine/visibility-and-occlusion-culling-in-unreal-engine) · [Two-Pass HZB Occlusion Culling](https://medium.com/@Lucmomber/two-pass-hierarchical-z-buffer-occlusion-culling-93171c5a9808) · [Babylon.js Thin Instances](https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/thinInstances) · [three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html) · [Unity LOD-Transitions](https://docs.unity3d.com/6000.2/Documentation/Manual/lod/lod-transitions-lod-group.html) · [Godot MultiMeshInstance3D](https://docs.godotengine.org/en/stable/tutorials/3d/using_multi_mesh_instance.html)
- Post-Processing: [XeGTAO README](https://github.com/GameTechDev/XeGTAO/blob/master/README.md) · [SSAO vs HBAO vs GTAO](https://superrendersfarm.com/article/ambient-occlusion-explained-ssao-hbao-gtao-2026) · [TAA – Step by Step](https://ziyadbarakat.wordpress.com/2020/07/28/temporal-anti-aliasing-step-by-step/) · [Filmic vs ACES vs AgX (Blender)](https://blenderartists.org/t/filmic-vs-aces-vs-agx-for-architectural-visualization/1459951) · [AgX Tonemapping (three.js forum)](https://discourse.threejs.org/t/is-agx-tonemapping-implemented-correctly/60609) · [Flax Volumetric Fog Docs](https://github.com/FlaxEngine/FlaxDocs/blob/c7ca0c976936f5203fc441816dcab68a7c4f31f9/manual/graphics/fog-effects/volumetric-fog.md/)
- Game Feel: [Fix Your Timestep! — Gaffer On Games](https://gafferongames.com/post/fix_your_timestep/) · [Blend Trees](https://medium.com/@lemapp09/beginning-game-development-blend-trees-315cd3e78d8c) · [Game feel on the web: squash, shake, and the art of juice](https://valdemird.com/blog/game-feel-on-the-web/)
- Nebel/Streuung: [Exponential Height Fog (UE 5.8)](https://dev.epicgames.com/documentation/unreal-engine/exponential-height-fog-in-unreal-engine) · [Volumetric Fog (UE 5.8)](https://dev.epicgames.com/documentation/unreal-engine/volumetric-fog-in-unreal-engine) · [Local Volumetric Fog (Unity HDRP 14)](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Local-Volumetric-Fog.html) · [Volumetric fog and fog volumes (Godot)](https://docs.godotengine.org/en/latest/tutorials/3d/volumetric_fog.html) · [Physically-based & Unified Volumetric Rendering in Frostbite (Hillaire, SIGGRAPH 2015)](https://www.slideshare.net/slideshow/physically-based-and-unified-volumetric-rendering-in-frostbite/51840934) · [Frostbite News](https://www.ea.com/frostbite/news/physically-based-unified-volumetric-rendering-in-frostbite) · [Snow Examples (UE 4.27)](https://docs.unrealengine.com/4.27/en-US/Resources/Showcases/Effects/SnowExamples) · [CoH2 Rendering Tech](https://www.slideshare.net/proyZ/daniel-barrero-coh2renderingtech)
