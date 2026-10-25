# PCSS (weiche Schatten): Directional Lights überall, Spot Lights nur auf WebGPU

> **Stand-Hinweis (2026-10-24):** WebGL2-PCSS für das Directional Light ist jetzt ein Port des WebGPU-`getShadowPCSS` (`evalPCSSDir` in `base_fragment_header.frag.glsl`): prinzipieller Radius ohne Bias-Kopplung, 16-Tap-Sunflower-Blocker-Suche, Softness-Knöpfe über `u_shadowSoftness`. Vorher hatte nur der Nicht-PBR-Chunk (Lambert/Phong/Terrain/World) die alte Bias-gekoppelte Variante, der PBR-Chunk (Standard/Decal) festes 3x3-PCF. Beide Chunks nutzen die Funktion jetzt für den Haupt- **und** den Cascade-Blend-Sample (wie WebGPU, das im Blend-Sample ebenfalls `getShadowPCSS` aufruft). Damit sind die Aussagen „Softness-Knöpfe WebGPU-only“, „WebGL2 = festes PCF = exakte No-Op“ und „Blend-Sample behält überall festes PCF“ in den Hinweisen und im Text unten überholt. Die Negativkontrolle des Pole-Gates ist jetzt `softness=0` (hartes 3x3-PCF) statt WebGL2; gemessen fern `0.34` auf beiden Tiers gegen `0.60` in der Kontrolle. Spot Lights auf WebGL2 bleiben bei festem PCF. Nachtrag (2026-10-25): Die Funktion liegt jetzt im eigenen Chunk `DIR_PCSS` (`dir_pcss.frag.glsl`), den auch `dir_shadow.glsl` einbindet. Damit nutzen auch die Liquid-Materialien mit eigenem Header PCSS statt festem 3x3-PCF.

> **Stand-Hinweis (2026-10-21):** Das Texturen-Budget des Cluster-Systems beträgt heute die Einheiten 8–15 (Spot-Shadow 8–11, Directional 12, Raw-Depth 13, Cluster-Grid 14, Cluster-Index 15; `math/ClusterGrid.ts`). Die Aussage zum Warn-/Fallback-Pfad (Einheiten 8–18) trifft nicht mehr zu; die Schlussfolgerung, dass vier weitere Raw-Spot-Einheiten das 16er-Budget sprengen würden, bleibt gültig. `getShadowPCSS` ist in `pbr_math.wgsl` definiert.

> **Stand-Hinweis (2026-10-21, 0.115.7):** Kontakt-Härtung ist jetzt **demonstriert und gegated**. Der Dünn-Pfahl-Probe-Modus des Showcase 42 (`?probe=pole`) zeigt auf WebGPU das PCSS-Signaturverhalten „scharf am Caster, weich in der Distanz": die Kontaktlinie an der Pfahl-Basis bleibt hart und tief, während die Penumbra mit dem Abstand wächst und der Schatten fern in einen breiten, flachen Gradienten diffundiert. Numerisch gemessen (Kontrast-Metrik der Schatten-Umbra, `scripts/check-swm42-pole.mjs`, Live-Gate `SWM42 POLE GATE: OK`): Nahe-Zone `0.61` → Ferne-Zone `0.26`; die **WebGL2-Negativkontrolle** (festes PCF) hält `0.60`-`0.60` und beweist damit, dass der Gradient echt PCSS-spezifisch ist und nicht aus Perspektiv-Artefakten stammt. Die früher geplante **adaptive Blocker-Suche ist dafür nicht nötig** — die feste 16-Tap-Sunflower-Scheibe zerstört die Härtung für einen dünnen Occluder nicht. Ein breiter **Box-Blocker bleibt geometriebedingt uniform weich** (die Suchscheibe mittelt seine gesamte Tiefenspanne) — das ist die bewusste, in `shadows.md` und diesem ADR dokumentierte Grenze, keine offene Roadmap-Festlegung mehr. Die Softness-Knöpfe bleiben WebGPU-only (WebGL2 = festes PCF = exakte No-Op).

> **Stand-Hinweis (2026-10-21, 0.115.6):** `getShadowPCSS` wurde gehärtet: die Penumbra-Breite wird jetzt prinzipiell aus der perspektiv-normalisierten Receiver-/Blocker-Tiefendifferenz abgeleitet (orthografische Kaskaden → linearer Tiefenraum) statt aus der `bias`-Division des legacy-Pfads (die gegen den winzigen Bias explodierte, stets in den Cap sättigte und das Vorzeichen von Lauf zu Lauf kippte). Die Blocker-Suche nutzt eine deterministische 16-Tap-Sunflower-Scheibe (kein run-to-run-Flip mehr, durch das Live-Gate `check-swm42.mjs` bit-identisch über zwei Läufe verifiziert). **Ehrliche Grenze:** echte Kontakt-Härtung (scharf am Caster) ist geometriebedingt noch nicht erreicht — die feste Suchscheibe tastet an der Kontaktlinie in den Blockerschaft, daher liest die Penumbra für Box-Blocker annähernd uniform. Kontakt-Härtung braucht eine *adaptive* Blocker-Suche plus eine Dünn-Occluder-Kalibrierungs-Szene → Roadmap (Phase 2+/EVSM/EVSSM/MSM-Pfad). Die Softness-Knöpfe (`shadowSoftness`/`shadowMaxPcfRadius`) skalieren weiterhin die prinzipielle Schätzung und bleiben WebGPU-only (WebGL2 = festes PCF = exakte No-Op).

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
