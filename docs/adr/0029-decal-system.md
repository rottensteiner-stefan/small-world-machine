# Decal-System: projizierte Decals als eigene Lit-Layer-Stufe nach Opaque

Status: angenommen. Kern auf WebGPU und WebGL2 umgesetzt und mit `apps/showcases/decal-probe` (`npm run test:decals`, 15 Assertions) auf echter GPU geprüft. Datenpfad: Level-Deskriptor und Kit-Decal-Laden (`KitRegistry.loadLevel`, `level.schema.json`) **implementiert** (Phase 3); glTF-Plugin `SWM_decal` (Lesen/Schreiben, `KitRegistry.hydrateDecal`) **implementiert** (Phase 4a); das Maker-Stamp-Tool (`D`, `DecalStampTool`; Phase 4b) ist **implementiert** und persistiert über das Plugin. Der Mesh-Decal-Baker für WebGL1 (Phase 5, `bakeDecalMesh`/`bakeSceneDecals`) ist **implementiert**, bewusst vereinfacht: harter Schnitt an `angleFadeEnd` statt Per-Vertex-Alpha, kein Edge-/Angle-Fade (die Textur-Alpha formt den Rand), weil dafür Shader-Änderungen an den Standard-Shadern nötig wären, die WebGL1 allein nicht rechtfertigt. Phase 6 ist umgesetzt: Plane-Fit im Maker-Stempel, Nässe als Kit-Decal (kein Engine-Feature), Laufzeit-`DecalPool` mit Restacking; Decal-Sockets sind bewusst zurückgestellt (`parent` plus Offset deckt den Bedarf, `meta.sockets` kennt nur Lichter und keine Rotation). Messwerte stammen von einer GPU und sind auf anderen **UNVERIFIED**.

Decals (Schilder, Schmutz, Einschläge) sollen auf beliebiger Opaque-Geometrie sitzen, Licht empfangen und die Normal-Map der Unterlage übernehmen. Dieser ADR hält fest, wie, aufbauend auf dem Normal-Buffer ([0028](0028-thin-normal-buffer-mrt.md)) und dem Clustered Lighting ([0007](0007-clustered-lighting-webgl2-webgpu-only.md)).

## Entscheidung

1. **`Decal extends Object3D`, eigene Liste, eigene Stufe.** `RenderList.decals` wird in einem Sub-Pass nach dem Opaque- und vor dem Transparent-Pass gezeichnet, nicht in der Transparent-Liste. Die Reihenfolge ist statisch und kamera-unabhängig (`priority`, dann Weltvolumen absteigend, dann Erzeugungs-ID). Dadurch kein Cache-Invalidieren durch die Kamera, und die Transparent-Sortierung bleibt unberührt.
2. **Box-Projektion aus der Opaque-Tiefe.** Die Box ist das Einheitswürfel-Volumen des Decals (lokal -Y = Projektionsachse). Der Shader rekonstruiert pro Pixel die Weltposition aus der kopierten Opaque-Tiefe und rechnet sie über **eine** zusätzliche Matrix `clipToBox = inverse(world) * invViewProj` in den Box-Raum (`matParam0..3` auf WebGPU, `u_decalClipToBox` auf WebGL2). `GlobalUniforms` bleibt unverändert. Zeichnen der Rückseiten (cull FRONT), Tiefentest und -schreiben aus: funktioniert mit Kamera in der Box. Pixel außerhalb der Box werden früh verworfen.
3. **Lit-Layer mit TBN-Normalenblend.** Das Decal nutzt den PBR-Lichtchunk (Cluster, Schatten). Seine Normal-Map wird über eine TBN auf die Normale der Unterlage gelegt (an RNM angelehnt, aber nicht RNM: TBN-Rotation statt Shortest-Arc-Formel) und per `NormalTargetMode.BLEND` mit dem Fragment-Alpha in den Normal-Buffer zurückgeschrieben. Die Unterlagen-Normale kommt aus einer pro Frame kopierten Normal-Textur (der Buffer ist während des Passes Attachment). Ohne Normal-Buffer: 3-Tap-Rekonstruktion aus der Tiefe. `USE_DECAL_UNLIT` ist die Performance-Option pro Decal.
   3-Tap statt `dFdx/dFdy` vermeidet Uniformitäts- und Silhouetten-Artefakte. Die Nachbar-Taps liefern auch **explizite UV-Gradienten** (`textureSampleGrad`/`textureGrad`), damit der frühe `discard` und Tiefensprünge keine Mip-Nähte erzeugen.
4. **Offscreen-Targets überspringen Decals** (Reflexion, Probes, Imposter): dort gibt es weder Normal-Buffer noch Opaque-Tiefen-Kopie.
5. **WebGL1 ignoriert `RenderList.decals`** (kein MRT, keine samplebare Tiefe). Ein Mesh-Decal-Baker (Clipping der Empfänger-Dreiecke zur Ladezeit) ist eine spätere Phase und deckt dann auch WebGL1 und skinned Empfänger ab.
6. **UV-Konvention:** Das Decal zeigt Texturen aufrecht (`uv = box.xz + 0.5`). Eine `Plane` mit `StandardMaterial` zeigt sie vertikal gespiegelt; das Decal übernimmt diese Spiegelung bewusst **nicht**. Bei der Migration der Prolog-Planes verschwindet der `flipX`-Hack, Wand-Decals bekommen Rotation (PI/2, Yaw, 0). Texture-Repeat/Offset gelten für Decals nicht. **Negative Skalierung wird abgelehnt** (`computeBounds`), weil sie die Windungsrichtung dreht.
7. **Decals auf Transparenten sind ausgeschlossen** (siehe 0028 Punkt 5).

## Datenpfad (ENTSCHIEDEN, NOCH NICHT IMPLEMENTIERT)

- Primär: `LevelDescriptor.decals[]` (Instanz: Transform, Größe, Fade, Opazität, Priorität, Tags, Parent) plus Kit-Decal-Eintrag (Prefab: Maps, Standardgröße), im Schema mit `additionalProperties: false` ([0020](0020-declarative-level-descriptors-and-kit-runtime.md)).
- `SWM_decal` (`gltf/extensions/SwmDecal.ts`): Payload = `LevelDecalPlacement` ohne `id` (Node-Name), `position`/`rotation` (Node-TRS) und `parent` (Node-Hierarchie). **Größe: `size` im Payload ist maßgeblich**; die Node-Scale wird zusätzlich als `(w, depth, h)` geschrieben, damit andere glTF-Viewer die Box sehen, und beim Lesen aus `size` überschrieben. `readNode` ist synchron, daher kommt das Decal textur-los zurück; `KitRegistry.hydrateDecal(decal)` / `resolveLevelDecals(root)` laden danach Maps und `unlit` über denselben Codepfad wie `loadLevel`. Unbekannte `kitDecal` oder Ladefehler warnen und überspringen, ein ungültiger Payload (Größe, Opazität, Tags) wirft beim Lesen.
- Maker persistiert über eine glTF-Erweiterung `SWM_decal` mit demselben Payload ([0010](0010-maker-editor-architecture.md), [0017](0017-gltf-extension-plugin-registry.md)); `level.json` bleibt führend für handgeschriebene Level.

## Gemessen (eine GPU, WebGPU, 5600x2968)

3 Decals: kein messbarer Mehraufwand (Rauschen ca. 2 ms). Stress mit 32 großen, überlappenden Lit-Decals bei 5600×2968: Kosten wachsen mit abgedeckten Pixeln mal Überlappung. **Die absoluten Zeiten sind auf der Testmaschine nicht belastbar:** dieselbe Szene lag zwischen Läufen bei 96 bis 374 ms (Faktor 4, vermutlich GPU-Takt und Last). Belastbar ist nur das Verhältnis innerhalb einer Sitzung: ein unlit-Decal (`USE_DECAL_UNLIT`) kostet etwa **0,5 ×** eines beleuchteten (52 gegen 96 ms und 188 gegen 374 ms). Der frühe Discard sparte etwa 18 % (einmalige Messung). **Es gibt deshalb keine verbindliche Budget-Zahl in ms.** Richtlinie nur qualitativ: Kosten ∝ Summe der Box-Bildschirmflächen, enge Boxen, und große überlappende Flächen (Schmutz, Flecken) unlit oder gar nicht überlappend. Eine ms-Schwelle braucht Messungen auf Zielgeräten. Ebenfalls UNVERIFIED: sichtbare Wirkung der per-Pixel neu berechneten Spot-Schatten-Varyings auf WebGL2.

## Verworfen

- DBuffer/G-Buffer (0028 Punkt 1) und Godot-artige Cluster-Decals (Konflikt mit dem Cluster-Raster aus 0007).
- Decals in der Transparent-Liste: kamera-abhängige Sortierung, Cache-Invalidierung.
- Beide Datenpfade gleichzeitig als Primärquelle.

## Risiken

- Jedes sichtbare Decal erzwingt Opaque-Tiefen-Kopie und Normal-Kopie pro Frame; der Normal-Buffer schaltet sich dabei per `"auto"` an (0028).
- Overdraw-Kosten von Lit-Decals; enge Boxen und `USE_DECAL_UNLIT` sind die Gegenmittel.
- Ein Decal kann die Roughness der Unterlage nicht überschreiben (Forward, kein G-Buffer); "Nässe" ist daher ein dunkles, glänzendes Overlay, kein ORM-Override.

## Das hier überdenken, wenn

- mehrere Ziel-GPUs die Budget-Richtlinie reißen oder Mobile (Tile-Based) die Tiefen-/Normal-Kopie teuer macht,
- Decals auf Transparenten oder echte Roughness-Overrides gebraucht werden (dann G-Buffer-/DBuffer-Frage neu stellen),
- ein Velocity-Buffer oder SSR eingeführt wird und Decals darin sichtbar sein müssen,
- WebGL1 dauerhaft entfällt (dann entfällt auch der Mesh-Decal-Fallback),
- Decals sich bewegen oder akkumulieren (Treffer, Blut) und die statische Sortierung nicht mehr trägt. Der `DecalPool` hält sie bewusst bei einer statischen Ordnung: ein recycelter Slot bekommt per `Decal.restack()` eine neue `sequence`, deshalb liegt die neueste Markierung oben. Das trägt nur, solange gleich große, gleich priorisierte Decals überlappen; ein Treffer-Fleck unter einem größeren, älteren Decal bleibt über das Volumen sortiert.

## Verifiziert: ORM-Kanalreihenfolge und Vertex-Alpha

- **ORM-Map des Decals:** Kanalreihenfolge wie im Rest der Engine, also glTF-Konvention: **R = AO, G = Roughness, B = Metallic**. Quelle: `Standard.frag.wgsl:8-10` und `Standard.frag.glsl:90,96,102` (metallicMap `.b`, roughnessMap `.g`, aoMap `.r`). Der glTF-Loader bindet dieselbe Textur an `metallicMap` und `roughnessMap` (`GltfMaterialParser.ts:61-73`), `occlusionTexture` separat an `aoMap` (`:88-98`). Kit-Texturen (`flakturm/textures/*/{roughness,metalness,ao}.png`) sind getrennte RGB-Graustufen-Dateien, kein gepacktes ORM. `DecalMaterial` hat noch keine ORM-Map: `Decal.frag.wgsl:89-90` und `Decal.frag.glsl:133-134` nehmen nur die Skalare `metallic`/`roughness`. Phase 3: `u_ormMap` in `DecalMaterial.ts` (Textur-Deklaration und `manifest.textures`) plus Flag `USE_DECAL_ORM`, und dort `roughness = clamp(rough * orm.g, 0.05, 1.0)`, `metallic = metal * orm.b`, `ao = orm.r`.
- **Vertex-Alpha:** Nur teilweise. Vertex-Farbe ist RGBA (`Mesh.ts:4,256` Location 11, vec4; WebGPU `GPUPipelineCache.ts:426-437` float32x4, Slot 6, `WebGPURenderer.ts:1806`), nur per Flag `USE_VERTEX_COLOR` und **nicht mit Instancing kombinierbar**. Verbraucher ist nur `StylizedLava`; `Standard.frag.*` und `Decal.frag.*` lesen keine Vertex-Farbe. Der glTF-Loader lädt `COLOR_0` nicht (kein Treffer in `loaders/gltf`). Baker braucht: `colors` (vec4) im Geometry-Datensatz setzen, Flag im Manifest, `a_color`/`@location(11)` im Vertex-Shader durchreichen und im Fragment-Shader alpha multiplizieren.
