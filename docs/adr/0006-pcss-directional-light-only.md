# PCSS (weiche Schatten): Directional Lights überall, Spot Lights nur auf WebGPU

> **Stand-Hinweis (2026-10-21):** Das Texturen-Budget des Cluster-Systems beträgt heute die Einheiten 8–15 (Spot-Shadow 8–11, Directional 12, Raw-Depth 13, Cluster-Grid 14, Cluster-Index 15; `math/ClusterGrid.ts`). Die Aussage zum Warn-/Fallback-Pfad (Einheiten 8–18) trifft nicht mehr zu; die Schlussfolgerung, dass vier weitere Raw-Spot-Einheiten das 16er-Budget sprengen würden, bleibt gültig. `getShadowPCSS` ist in `pbr_math.wgsl` definiert.

Der Blocker-Search + Variable-Radius-PCF-Pass läuft für die primäre Kaskade des Directional Light
auf allen Backends, und (Stand dieses Updates) für Spot Lights auf WebGPU. Der
Cascade-Blend-Sample der sekundären Kaskade des Directional Light behält überall das ältere,
feste 3x3-PCF mit festem Radius, um die Blocker-Search-Kosten speziell in der
Cascade-Blend-Zone nicht zu verdoppeln.

**WebGPU-Spot-Lights nutzen PCSS** (`getShadowPCSS` in `lighting.wgsl`/`lighting_pbr.wgsl`): die
Funktion ist vollständig generisch (`(map: texture_depth_2d_array, samp: sampler_comparison,
shadowPos, layer, bias) -> f32`, kein directional-spezifischer Uniform-Zugriff im Funktionskörper),
und `textureLoad`+`textureSampleCompareLevel` koexistieren bereits auf demselben
`texture_depth_2d_array`-Binding ohne zweiten Sampler — anders als WebGL2 (siehe unten). Den
Spot-Light-Aufruf von `getShadowPCF` auf `getShadowPCSS` umzustellen brauchte keine neuen
Bindings, keine Struct-Änderungen, nichts über den Funktionsnamen an den zwei Aufrufstellen
hinaus.

**WebGL2-Spot-Lights bleiben bei festem PCF mit festem Radius.** Kein technisches Hindernis: derselbe
Comparison-/Non-Comparison-Dual-Sampler-Trick, der schon beim Directional Light verwendet wird
(`u_dirShadowMap` + `u_dirShadowMapRaw`, ein `_rawDepthSampler`-WebGLSampler-Objekt, gebunden an
eine zweite Textureinheit mit `TEXTURE_COMPARE_MODE = NONE`) würde identisch für die 4
Spot-Shadow-Maps funktionieren — reine Wiederholung, kein neuer Mechanismus. Die eigentlichen
Kosten sind das Textureinheiten-*Budget*: WebGL2 garantiert nur 16 Bildeinheiten, und dieses
Projekt reserviert bereits die Einheiten 8-18 (4x Spot-Compare, 1x Directional-Compare, 1x
Dummy-Fallback, 1x Directional-Raw-Depth, 4x Cluster-Grid/-Index) — auf Spec-Minimum-Hardware
erreicht das Cluster-System schon jetzt seinen bestehenden Warn-/Fallback-Pfad, bevor überhaupt
PCSS-Arbeit hinzukommt. Vier weitere Non-Comparison-Spot-Einheiten würden das verschlimmern, kein
neues Risiko einführen.

**WebGL1 hat überhaupt kein Shadow Mapping** (keine Depth-Texturen, kein Shadow-Pass,
`WEBGL_depth_texture` ungenutzt) — PCSS dort wäre ein Feature von Grund auf, keine Erweiterung von
irgendetwas.

**WebGL2-Spot-Light-PCSS überdenken, wenn:** ein Showcase Spot-Light-Schatten stark als primäres
visuelles Element nutzt (z. B. eine taschenlampengetriebene Horror-Szene) auf Hardware, die
bekanntermaßen über das 16-Einheiten-Minimum hinausgeht, wo die feste PCF-Kante spürbar schlechter
wird als die PCSS-Kante von Directional/WebGPU-Spot direkt daneben.
