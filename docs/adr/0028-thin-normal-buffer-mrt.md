# Dünner Normal-Buffer als MRT im Main Pass: kein G-Buffer, Velocity getrennt

Status: angenommen. WebGPU und WebGL2 umgesetzt und auf echter GPU geprüft (Boden, Würfelflächen, Sentinel am Himmel); HBAO nutzt den Buffer auf beiden Backends (Fallback: depth-abgeleitete Normale). Decals schalten ihn bei Bedarf automatisch ein.

Die Engine rendert Forward mit Clustered Lighting ([0007](0007-clustered-lighting-webgl2-webgpu-only.md)) und hat bewusst keinen G-Buffer. Es gibt auch keinen Normal- oder Velocity-Buffer. Dieser ADR führt einen dünnen Normal-Buffer ein, geschrieben als zweites Render-Ziel (MRT) des Main Pass, damit Decals die Normal-Map der Unterlage übernehmen können. Ein G-Buffer und Deferred bleiben ausgeschlossen.

**Entscheidung in einem Satz:** Option B (MRT im Main Pass, Normale inklusive Normal-Map, **World-Space**, oktaedrisch in `rg16float`), automatisch bei sichtbarem Decal (`quality.normalBuffer: "auto"`), WebGPU zuerst, WebGL2 nur mit aktivem Post-Processing.

## Ist-Zustand (aus dem Code)

- **WebGPU:** `DepthPrePassGPU` rendert Tiefe (`depth32float`). Die Opaque-Tiefe wird nach dem Opaque-Pass in `_opaqueDepthTexture` kopiert (`captureOpaqueDepth`), aber nur wenn Transparente oder HBAO sie brauchen.
- **WebGL2:** Es gibt keinen Depth-Prepass. Die Tiefe wird per `blitFramebuffer` kopiert, nur wenn `requiresOpaqueDepth(shaderId)` zutrifft oder Post-Processing aktiv ist.
- **HBAO:** Beide Backends rekonstruieren View-Position und Normale aus der kopierten Opaque-Tiefe (`AOPassGL.ts`, `AOPassGPU.ts`). Es gibt keinen Normal-Input.
- **TAA/MotionTrail:** History-Blend ohne Velocity (`HistoryBlendPassGPU`).
- **WebGL1:** kein MRT, kein samplebares Depth, kein Clustering.

## Optionen

| | A: Rekonstruktion aus Tiefe | B: Normal als MRT im Main Pass | C: Normal-Prepass (WebGPU: Depth-Prepass erweitern, WebGL2: neuer Pass) |
|---|---|---|---|
| Zusätzliche Geometrie-Arbeit | keine | keine | WebGL2: ein weiterer Pass |
| Kante/Artefakte | Fehler an Kanten und Tiefensprüngen | exakt (inkl. Normal-Map optional) | exakt (nur Geometrienormale) |
| Aufwand in Shadern | keiner | **jeder** Opaque-Shader (auch `CustomShaderMaterial`) muss ein zweites Ziel schreiben | nur ein schlanker Normal-Shader |
| Verfügbar für Pässe vor Opaque | ja (nach Prepass) | nein | ja |
| Bandbreite | keine | +1 Ziel pro Pixel | +1 Ziel, dafür Early-Z |

## Entscheidung

1. **Kein G-Buffer, kein Deferred.** Transparenz, WebGL2/WebGPU-Parität und Shader-Freiheit sprechen dagegen. Der Hauptvorteil von Deferred (viele Lichter) ist durch Cluster abgedeckt.
2. **Option B für beide Backends.** Der Main Pass schreibt als zweites Ziel die shading-relevante Normale (nach Normal-Map), **World-Space**, oktaedrisch codiert, `rg16float`. World-Space statt View-Space, weil das Fragment-Stage-Layout (`GlobalUniforms`) keine View-Matrix enthält und Decals ohnehin Weltkoordinaten brauchen. Verbraucher im View-Space (HBAO) bekommen die View-Matrix selbst. Grund: Nur so übernimmt ein Decal die Normal-Map der Unterlage (Reoriented Normal Mapping auf die Basisnormale). Option C (Prepass) kennt nur die Geometrienormale. Die Normale wird nach Opaque gebraucht (Decals, AO, Post), nicht davor, deshalb reicht der Main Pass.
3. **Automatisch bei Bedarf.** `quality.normalBuffer` ist `boolean | "auto"`, Standard `"auto"`: Der Buffer ist aus, bis in einem Frame des Haupt-Targets ein Decal sichtbar ist (`renderList.decals.length > 0`, nicht in Offscreen-Pässen). Dann ruft der Renderer `requestNormalBuffer()` auf, das `quality.normalBuffer` auf `true` setzt. Einmal an, bleibt er an (Hysterese, kein Flackern). Ohne Decal kostet das nichts: keine Textur, keine Wrapper-Pipelines, kein `USE_NORMAL_OUT`. `true` erzwingt ihn von Anfang an, `false` verbietet ihn. WebGPU: `_syncNormalTexture` legt die Textur im selben Frame an, Pipelines für `write`/`masked`/`blend` entstehen bei Bedarf. WebGL2: der HDR-FBO wird verworfen und mit Sekundär-Attachment neu gebaut, Programme kompilieren über das neue Flag nach (einmaliger Hänger). Ohne Post-Processing bleibt die Warnung und der `dFdx`-Fallback. Pipelines werden pro Variante gecacht (`NormalTargetMode`: `none`, `write`, `masked`), weil WebGPU die Fragment-Ausgaben exakt an die Targets bindet. Offscreen-Targets (Reflexion, Probes, Imposter), Depth-Prepass und Shadow-Pässe bleiben bei `none`.
4. **Wrapper statt Shader-Änderungen.** `GPUPipelineCache.getShaderModule` benennt `fs` in `fs_color` um und hängt einen `fs` an, der zusätzlich `@location(1)` schreibt (`NormalOutputWrapper.ts`). Material-Shader (auch `CustomShaderMaterial`) bleiben unverändert. Der Wrapper schreibt standardmäßig die Geometrienormale; `lighting_pbr.wgsl` überschreibt `g_shadingNormal` mit der Normal-Map-Normalen (nur `Standard` hat diesen Pfad). Entry-Points, die nicht das gemeinsame `Out` entgegennehmen (z. B. Lava), schreiben den Sentinel (-2, -2). `lint:wgsl` prüft jeden gewrappten Material-Shader. WebGL2 nutzt denselben Mechanismus per `main`-Wrapping im `WebGLProgramCache` (`NormalOutputWrapperGL.ts`, Programm-Flag `USE_NORMAL_OUT`). Dort genügt ein Shader-Programm für alle Pässe, weil ein zweiter Output ohne aktiven Draw-Buffer verworfen wird.
5. **Transparente und Skybox schreiben nicht.** Beide laufen mit `NormalTargetMode.MASKED`: Der Pass behält das Attachment (`loadOp: load`), das Pipeline-Target hat `writeMask: 0`. So reicht ein Shader-Modul pro Material für alle Passes mit Normal-Ziel. Decals auf Transparenten sind ausgeschlossen (wie bei Unity und Godot). Der Clear-Wert (-2, -2) liegt außerhalb des Oktaeder-Bereichs und kennzeichnet „keine Normale“.
6. **WebGL1:** kein Normal-Buffer (kein MRT). Verbraucher fallen dort aus, Decals nur als Mesh-Decal. **WebGL2:** nur mit aktivem Post-Processing (nur dort existiert ein FBO; ohne FBO müsste der Default-Framebuffer ersetzt werden und das native MSAA ginge verloren). Ohne Post-Processing: Warnung und `dFdx`-Fallback.
7. **Rekonstruktion bleibt als Fallback.** Ist der Buffer aus, nutzen HBAO und Decals weiter `dFdx/dFdy` aus der Tiefe.
8. **Velocity getrennt.** Er wird nur angelegt, wenn TAA-Ghosting an bewegten Objekten im Spiel stört. Er braucht die vorherige Matrix pro Objekt und damit Platz im `ObjectUniforms`-Slot ([0027](0027-object-uniforms-512-byte-expansion.md)). Das ist ein eigener ADR.

## Verbraucher und Nutzen

- Decals (siehe Decal-Plan): echte Normale, bessere Winkel-Fades. Phase 1 nutzt Rekonstruktion.
- HBAO/SSAO: bessere Normalen an Kanten, schmalere Artefakte.
- Noir-Looks: Outlines, Kantenerkennung.
- Später: SSR, Contact Shadows, Soft Particles.

## Risiken

- Tile-Based-GPUs: Unity dokumentiert, dass der DepthNormals-Prepass dort ineffizient ist. Auf Mobile messen.
- MRT-Pflicht (B) bricht fremde Custom-Shader still, wenn der Default-Chunk fehlt.
- Zusätzlicher Speicher: 1 Ziel in Bildschirmgröße (RG16F ≈ 4 Byte/Pixel).
- Alle Opaque-Pässe, die in den HDR-Target rendern, müssen das zweite Ziel kennen (Main Pass, ggf. Offscreen-/Reflexions-Targets ohne zweites Ziel nutzen die Variante ohne Buffer).
- Alpha-Cutout und Instancing: der Default-Chunk muss `discard` vor der Normal-Ausgabe behandeln.

## Befund beim HBAO-Anschluss

Die depth-abgeleitete Normale war auf hochauflösenden Canvases wirkungslos: Der absolute Schwellwert `lenSq > 0.000001` verwarf jedes Kreuzprodukt (Nachbarpixel liegen dort nur winzige Schritte auseinander), und die Kamera-Achse diente als Normale für alle Pixel. Der Test zeigte auf 5600x2968 px eine Boden-AO von 0,61 statt 1,0. Der Schwellwert ist jetzt relativ zu den Kantenlängen, und die Normale zeigt zur Kamera (+z im View-Space; vorher zeigte sie davon weg). Mit Normal-Buffer ist das AO an Kontaktlinien korrekt (Würfelfuß 0,12, offener Boden 1,0). Bekannte Restschwäche: Die Suchschritte sind feste Pixelabstände (4 bis 16 px), `radius` wirkt bei hoher Auflösung nur noch auf einen schmalen Kontaktsaum.

## Das hier überdenken, wenn

- zwei Verbraucher (siehe Punkt 2) anstehen und die Rekonstruktion sichtbar versagt,
- eine Messung auf einem Zielgerät zeigt, dass Rekonstruktion pro Frame teurer ist als ein zusätzliches Ziel,
- TAA-Ghosting oder Motion Blur ein Velocity-Ziel verlangen,
- die Engine dauerhaft auf WebGL2/WebGPU ohne WebGL1 festgelegt wird (dann entfällt der Sonderfall).
