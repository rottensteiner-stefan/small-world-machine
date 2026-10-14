# 03 — renderers/post (inkl. Light Shafts), core/decals, culling, lights, reflection, sky

Slice: `packages/engine/src/renderers/post/**` (Elements, Passes, Shader, PostProcessingGroup), `core/decals/**`, `core/culling/**`, `core/lights/**`, `core/reflection/**`, `core/sky/**`. **65 Dateien, 7.253 Zeilen, alle vollständig gelesen** (Zeile 1 bis Ende), keine offenen Bereiche. HEAD `ff3f3ab6`. Nur gelesen, nichts geändert. „Unsicher" = nicht im Code verifiziert oder von Außerhalb-Slice abhängig. Keine Datei im Slice >1000 Zeilen (größte: `LightShaftsPassGL` 464 Z.).

> Quellenlage: Dieses Dokument basiert auf dem **vollständigen** Zweitbericht von Agent 3 (zuvor lag mir nur eine Zusammenfassung vor). Zusätzlich eingearbeitet: Ergebnisse des ersten Light-Shafts-Diff-Reviews und von Agent 1/2. Von mir selbst per grep bestätigt: intensity² (Raymarch + Composite), color² nur im WGSL-Composite, Depth-Threshold 0.05 hartkodiert.

## 1. Findings nach Schwere

### HOCH

~~**H1. `DynamicReflectionProbe` blendet bei Wurzel-Kindern die ganze Szene aus** — `core/reflection/DynamicReflectionProbe.ts:83-86` (+ `core/Scene.ts:32, 324`)<!-- ERLEDIGT: Parent-Check !this.parent || this.parent === scene.root || this.parent.parent === undefined verhindert Ausblenden von scene.root (Bob) -->~~
- `Scene` ist kein `Object3D` (`export class Scene`, nur `root = new Object3D("SceneRoot")`). `this.parent && !(this.parent instanceof Scene)` ist daher immer true. Hängt die Probe direkt an `scene.root`, wird `SceneRoot.isVisible=false` gesetzt; `_collectVisible(this.root)` (`Scene.ts:324`) bricht bei unsichtbarem Objekt sofort ab → **leerer Cubemap-Render**.
- Sicher gesehen: die Bug-Logik. Wirksam nur, wenn die Probe direkt unter `scene.root` hängt (typischer Fall bei `scene.add(probe)`).
- Vorschlag: Parent nur ausblenden, wenn er nicht `scene.root` ist (Scene-Referenz mitgeben oder `parent.parent !== undefined`-Check); besser: nur die Probe + explizite `excludedObjects` ausblenden, wie bei `PlanarReflectionNode`.

~~**H2. Kein try/finally beim Ausblenden/Render-Target-Wechsel** — `DynamicReflectionProbe.ts:76-136`, `PlanarReflectionNode.ts:88-109`<!-- ERLEDIGT: try...finally stellt Sichtbarkeit und vorheriges Render-Target wieder her und gibt MathPool-Vektoren frei (Bob) -->~~
- Wirft `renderer.render` (z. B. WebGPU-Validierung), bleiben Probe, Parent und `excludedObjects` unsichtbar und das Render-Target gebunden; der MathPool-Vektor `pos` (Probe `:89/128`) wird nicht freigegeben.
- Zusätzlich `setRenderTarget(null)` statt Wiederherstellung des vorherigen Targets (bricht Verschachtelung).
- Vorschlag: try/finally um Hide → Render → Restore, vorheriges Target merken.

**H3. Lensing: Event-Horizon-Radius im Post-Shader hart 0.03** — `shaders/PostProcess.frag.glsl:201, 238`; `PostProcess.frag.wgsl:213, 254`
- Verzerrung nutzt `eh = u_lensingEventHorizon` (`glsl:133`), aber die schwarze Scheibe (`dist < 0.03`) und die Bloom-Maske nutzen das Literal 0.03. `eventHorizonRadius` (`GravitationalLensingElement:18`) wirkt nur halb. Außerdem 0.35 (Disk) und 0.015 (Ring) als Magic Numbers.
- Dieselbe Rechnung (ivec2 dims/aspect/center/dir/dist) steht pro Shader 3× (`glsl:125-168, 193-213, 231-242`; wgsl analog `135-177, 206-225, 248-258`).
- Vorschlag: einmal `dist`/`inHorizon` am Anfang berechnen, überall `eh` verwenden; Konstanten als `const`.

**H4. Lensing-Shader-Fallbacks verhindern Wert 0** — `PostProcess.frag.glsl:133-137`, `PostProcess.frag.wgsl:142-146`
- `strength > 0 ? x : 0.25`, `beaming > 0 ? … : 1.2`, `eh > 0 ? … : 0.03` → strength=0 / beaming=0 nicht einstellbar. Die CPU liefert Defaults bereits (`PostProcessPassGL.ts:393-406`, Element-Defaults) → doppelte, widersprüchliche Default-Quelle.
- Vorschlag: Shader-Fallbacks löschen.

**H5. WebGL1-Light-Shafts: „weiches Ausblenden" existiert nicht** — `passes/LightShaftsPassGL.ts:419`, `shaders/LightShafts100.frag.glsl:15-22, 37`
- CPU sendet `u_sunCameraZ = clipW > 0 ? 1.0 : -1.0` (nur ±1). Shader: `if (<=0) return 0` (harter Schnitt) und `camZFactor = clamp(z*0.5,0,1)` → immer 0.5. Kommentar im Shader behauptet „smoothly fade out".
- `LightShaftsPassGL.ts:398-403`: `clipX/clipW` ohne Guard bei clipW≈0 (Division, wird nur durch den Hard-Cut im Shader maskiert).
- Shader: `luma` (`:37`) berechnet, nie benutzt; `0.6` Schwelle und `1.0/32.0` + Loop `32` hartkodiert; TS: `density*10.0` (`LightShaftsPassGL.ts:420`) und Sonnenentfernung `1000.0` (`:393-395`) Magic Numbers.
- Vorschlag: `clipW` (oder `smoothstep`-Faktor) als Uniform, im Shader weich ausblenden; Konstanten benennen.

### MITTEL

**M1. Hot-Path-Allokationen/Strings (Verstoß coding-guide 3B)**
- `PostProcessPassGL.ts:63-104` `_getSignature`: pro Frame Array + `.join("|")` + 10 `group.get`-Lookups. Vorschlag: Bitmaske (number) aus Enabled-Flags + tonemap-mode + filterMode.
- `BloomPassGL.ts:231-244` `execute`: pro Frame `.map` mit 5 Objekten + je 1 Closure. Vorschlag: Mip-Chain beim Resize einmal als einheitliche Struktur `{bind(), texture, width, height}` ablegen; die zwei Pfade (`_mipChain` / `_gl1MipChain`) verschwinden.
- `PlanarReflectionNode.ts:94-95, 109`: `.map`, `for-of`, `forEach` + Closure pro Update. Vorschlag: vorab-allokiertes boolean[]/Index-Schleife.
- `DirectionalLight.ts:129, 154`: zwei `for-of` pro Kaskade/Frame; `_setCorner` (`:327-353`) holt pro Ecke einen Pool-Vektor (16/Kaskade) statt direkt zu rechnen.
- `DecalPool.spawn` → `DecalMath.decalEulerFromNormal` (`DecalMath.ts:42-64`): pro Spawn 4× `new Quaternion` + `toEuler()`-Vektor + `options.size ?? …`; widerspricht `DecalPool.ts:42-45` („a pool must not allocate while the game runs"). Vorschlag: Scratch-Quaternion/Out-Parameter; `q` in `quaternionFromNormal` (`:51`) nur zum Normalisieren ist unnötig (direkt rechnen).
- `DecalPool.ts:124, 138, 154` `for-of` in `update()`/`_acquire()`.
- `SpotLight.ts:115` `position.clone().add(direction)` pro `updateShadowCamera`-Aufruf.

**M2. `FrustumCuller`** — `core/culling/FrustumCuller.ts`
- `:29` `_resetCulling` und `:57` `_countVisible`: zwei rekursive Vollbaum-Walks pro Frame zusätzlich zu den Octree-Queries. Judo-Idee: Frame-Stamp (`obj.visibleFrame === frame`) statt Reset-Walk; Zählen nur bei Bedarf (Debug).
- `:32-55` zwei fast identische Blöcke für static/dynamic Octree → `_markHits(octree)`.
- `:38, :50` `hits[i] as Object3D` (Cast von `Collidable`) — Typgrenze unklar.
- `:65-66` Fallback iteriert `scene.objects`, `:29` setzt via `scene.root` zurück; leichte Inkonsistenz. `lastVisibleCount` und Rückgabewert doppelt.

**M3. `Octree`** — `core/culling/Octree.ts`
- `:125-143` `_subdivide`: `number[][]` + `dims[0]?.[x] ?? 0` — stille Fallbacks verstecken die Invariante; Kind-Bounds ergeben sich direkt aus Bit-Flags (`x ? center.x : min.x`) ohne Arrays.
- `:290-311` `_tryCollapse` rekursiert bei jedem `remove` (und auf jedem Vorfahren) über den ganzen Unterbaum. Bei per-Frame-Remove/Insert des Dynamic-Octree teuer (unsicher: Aufrufer im Slice nicht gesehen).
- `:259-278` `remove`: wenn aktuelle Bounds nicht zur gespeicherten Zelle passen (bewegtes Objekt), Fallback auf lineare Vollsuche (unsicher, vom Aufrufer abhängig).
- `:355-357` `Octree.insert` mutiert `root.bounds`, das vom Aufrufer übergebene `BoundingBox`-Objekt (Konstruktor `:329` speichert Referenz); Kinder werden nie neu aufgebaut → alles außerhalb des Ursprungsbereichs landet in `root.objects`, `_subdivide` bricht wegen Guard `:119` ab → lineare Liste, skaliert nicht.
- `:28` `private static _nodePool`: prozessweiter, unbegrenzter Pool (nahe an „keine globalen Singletons"; kein Instanz-Konflikt, aber geteilter Zustand).
- `:206-220` `queryRay` liefert alle Objekte getroffener Zellen ohne Narrow-Phase; Doc „intersect with a ray" irreführend. `:207` inline `import("../../physix/index.js").Ray` (2×) statt `import type`.
- Zusammenhang mit Physik: `PhysicsBroadphase._placeCollider` tauscht temporär `collider.bounds`, weil `Octree.insert` die Bounds nicht als Parameter nimmt (siehe `07`).

**M4. Shader-Duplikation GLSL300/GLSL100/WGSL + Parity-Drift**
- `BloomDownsample.frag.glsl/.glsl100/.wgsl` und `BloomUpsample.*` je 3-fach nahezu identisch. `PostProcess.frag.glsl/.wgsl/PostProcess100.frag.glsl` duplizieren Tonemapper, Color-Grading, Grain, Vignette, Quantize, Flash.
- Judo-Idee: GLSL100 per `ShaderRegistry` aus GLSL300-Quelle ableiten (`PostProcessPassGL.ts:125` nutzt `assemble` für glsl300 bereits); gemeinsame Chunks.
- **Drift:** `PostProcess100.frag.glsl:119-123` Vignette = `distance(uv,0.5)` ohne `roundness`/Aspect; glsl300/wgsl (`296-308` / `315-328`) haben `roundness`. Außerdem WebGL1 ohne NaN-Guard bei Shafts (`:84-87`) vs. glsl300 (`:247-252`, `isnan+isinf`) vs. wgsl (`:266` nur NaN).
- Filter-Modi als Literale 1, 2, 3, 4, 6, 8 im Shader und `3u == u_filterMode` etc. — kein Enum (CLAUDE.md: No Magic Numbers).

**M5. GL-Pass-Lifecycle**
- Kein `LINK_STATUS`-Check in `PostProcessPassGL` (`:208-213`), `BloomPassGL` (`:90, :106`), `AOPassGL` (`:60`), `HistoryBlendPassGL` (`:60`), `LightShaftsPassGL` (`:113, :140, :160`).
- **Shader-Leaks:** `BloomPassGL.ts:84-106` löscht `vDown/fDown/vUp/fUp` nie. `LightShaftsPassGL.ts:107-141` `vert` wird nur im Bilateral-Zweig gelöscht (`:141`); scheitert `fragShafts` oder `fragBilateral`, bleibt `vert` stehen; `fragShafts` wird nach Link gelöscht, `vert` erst später. `PostProcessPassGL.ts:194-213` loggt Kompilierfehler, verwendet das Programm aber trotzdem, löscht fehlerhafte Shader nicht.
- `PostProcessPassGL.ts:156-192`: `frag.replace("uniform int u_xxx;", "#define …")` ist stiller No-Op, wenn der Marker fehlt (Umbenennung) — kein Check (Magic-String-Kopplung).
- `_compileShader` identisch in `AOPassGL:36`, `BloomPassGL:60`, `HistoryBlendPassGL:36`, `LightShaftsPassGL:87` (`PostProcessPassGL` inline). Ob ein kanonischer Helfer in `renderers/WebGL*` existiert, nicht geprüft (unsicher). Repo-weit siehe `01` Punkt 24 (`compileProgram` mit throw).
- **GL-State-Leak:** `AOPassGL:116-119`, `HistoryBlendPassGL:112-115`, `LightShaftsPassGL:269-271`, `BloomPassGL:250-253` setzen `depthMask(false)`/`DEPTH_TEST`/`BLEND` und stellen nicht zurück; nur `PostProcessPassGL:437-439` restauriert (erzwingt `enable(BLEND)`). Implizite Aufrufreihenfolge.
- `LightShaftsPassGL`/`BloomPassGL`/`PostProcessPassGL` mischen GL1 und GL2 hinter `_isWebGL2` + Casts (`as WebGL2RenderingContext`: `PostProcessPassGL:119/254/423`; `BloomPassGL:115/256/327/345`; `LightShaftsPassGL 105/192/…`). `LightShaftsPassGL` hat zwei völlig disjunkte Pfade → zwei Klassen hinter einem Interface.
- Tippfehler/Reste: `_vaoSrafts` (`LightShaftsPassGL:26, 131, 344, 453`).

**M6. `mediump` in HDR-/Fullscreen-Shadern** — `HistoryBlend.frag.glsl:2`, `PostProcess.frag.glsl:2`, `PostProcess100.frag.glsl:1`, `PostProcess.vert.glsl:2`: HDR-Blend/Tonemap/Grain in mediump; `v_uv` aus mediump-Vertex kann auf Mobile bei hoher Auflösung UV-Stufen erzeugen. Unsicher (geräteabhängig, nicht getestet).

**M7. `DirectionalLight`** — `core/lights/DirectionalLight.ts`
- `:241-282` vs `:290-325`: `_updateFrustumCorners` und `_updateOrthoFrustumCorners` bis auf nearH/nearW/farH/farW identisch (~35 Z.) → ein Helfer mit diesen vier Werten.
- `:35, :75-87`: `numCascades` public/mutierbar, aber `cascadeCameras`/`cascadeSplits` nur im Konstruktor gefüllt → späteres Erhöhen führt zu `cascadeCameras[i]!` undefined (`:140`). Keine Klemmung auf 4, obwohl Shader/Passes 4 voraussetzen (`LightShaftsPass Math.min(numCascades,4)`, `mat4[4]`).
- Magic Numbers: 200 (`:136-138, :199-200`), 150.0 (`:217`), 2.0 (`:190`), −10/10/0.1/500 (`:76-83`).
- `:164-186` Texel-Snapping fixiert nur das Zentrum; die Slice-Größe (AABB der Ecken in Licht-Raum) variiert mit Kamerarotation → Shimmering kann bleiben (unsicher, nicht visuell geprüft). Kommentar `:168-172` benennt Kopplung an den WebGL2Renderer-Atlas (`cols=ceil(sqrt(n))`), die in `LightShafts.frag.glsl:55` erneut implizit dupliziert ist → gemeinsamer Helfer/Konstante.
- `:107-111`: `proj as PerspectiveProjection | OrthographicProjection` per `type`-Vergleich → fehlende Discriminated Union.
- `:94, :242, :291` `import("../../interfaces/index.js").CameraInterfaceData` 3× inline.
- `:5` und `SpotLight.ts:6` importieren `Camera` aus Barrel `"../index.js"` (Zyklusgefahr), `AbstractLight.ts:5` direkt aus `../cameras/Camera.js`.

**M8. `DecalMeshBaker`** — `core/decals/DecalMeshBaker.ts`
- `:87-93` `determinant3` dupliziert `DecalMath.decalWorldVolume` (`DecalMath.ts:5-12`); `:79-85` `transformPoint` vermutlich Duplikat von Matrix4-Helfern (unsicher, `math/` nicht im Slice).
- `:149-200` pro Dreieck: `order`, `world`, `box`, `corner`-Closure, `clipPlane`-Arrays, Vec3-Tupel → massiver GC bei großen Receivern (nur Bake-Zeit/Setup, daher nicht Hot Path, aber Startup-Kosten).
- `:346-372` `bakeSceneDecals(root)` hängt Welt-Raum-Geometrie an beliebige `root`; korrekt nur bei Identitäts-Transform (Doku nur bei `bakeDecalMesh :263`, keine Prüfung).
- `:282-303` Receiver-Eingaben (skipReason, getBoundingVolume, Arrays) pro Decal neu aufgebaut → O(D·M); hoisten.
- Reine Mathe (`clipPlane/clipPolygonToUnitBox/clipTrianglesToDecalBox/Vec3`, `:45-211`) und Szenengraph-Glue (`:213-372`) in einer Datei; Mathe-Exporte erweitern die öffentliche API nur wegen Tests → Teilung in `DecalClipper.ts` + Baker.
- `:278, 286, 357` `console.warn` direkt (zentraler Logger? nicht geprüft, unsicher). `:350-359` `traverse` überspringt nur unsichtbare Einzelobjekte, nicht deren Kinder-Subtrees (unsicher, Verhalten von `traverse` nicht geprüft).

**M9. `PostProcessingGroup`** — `renderers/post/PostProcessingGroup.ts` (276 Z.)
- `:88-275` `loadConfig`: ~50× `if (x !== undefined) el.x = x`; Farbauflösung (`Array.isArray` / `{r,g,b}`) 6× (`:133-140, 153-176, 242-249, 265-272`) plus Vector-Variante (`:227-234`). Vorschlag: `applyColor(target, v)` + `Object.assign(el, definedProps)` oder `element.applyConfig(partial)` → Methode ~40 Z.
- Kein Mapping für `effects.outline`, obwohl `OutlineElement` existiert (`:96-274`). Lücke, falls `PostProcessingConfig.effects.outline` existiert (Interface nicht geprüft, unsicher).
- `:30` `isGlobal` immer true, im Slice nirgends gelesen (tot; außerhalb unsicher). `:41` `singularityScreenPos` doppelt zu `GravitationalLensingElement.ts:15`; `PostProcessPassGL.ts:390` bevorzugt Element, Group nur Fallback → zwei Wahrheiten.
- `:32` `filterMode: number` + Zahlen-Kommentar (0..8) — Enum fehlt.
- `:88` inline `import("../../interfaces/index.js").PostProcessingConfig`; `:74-76` `get<T>` castet ohne Prüfung.

### NIEDRIG

**N1 Bloom:** `MIP_CHAIN_LENGTH` benannt (`BloomPassGL.ts:12`), in GPU Literal 5 (`BloomPassGPU.ts:118`); Abbruchlogik verschieden (GL `<2px` `:187`, GPU log2 `:117`). `BloomPassGPU.ts:206, 242` `Math.pow(2,i)` pro Iteration. Prefilter auf alle 13 Taps ohne Karis-Average (Firefly-Risiko, Designwahl). `BloomPassGPU:136` 32-Byte-Buffer für 16-Byte-UpUniforms. `loadOp "clear"` bei Fullscreen-Overwrite (`BloomPassGPU:224`, `HistoryBlendPassGPU:134`) unnötig. `BloomPassGL.ts:129` `extHalf!`-Non-Null.

**N2 AO:** `AO.frag.wgsl:154-160` `fs_main` ungenutzt (`AOPassGPU` baut nur Compute, `:47-53`) → tot. `AOPassGPU.ts:4-5` Doc „r8unorm", Code `rgba8unorm` (`:39, :72`) vs `AOPassGL` R8 (`:83`): Format-Drift. 8×8-Workgroup TS (`AOPassGPU:129`) und WGSL (`:142`) getrennt; Richtungen 6/Steps 4/`/4.0`/128/4px im Shader hartkodiert (GLSL hat `const int`, WGSL Literale). Normal-Fallback/Schwelle 0.0001 in GLSL und WGSL doppelt. `AOPassGL.ts:134` setzt nur `u_projScale` aus `projMatrixData[0],[5]` (korrekt laut `Matrix4.perspective`).

**N3 `PostProcessPassGL`** (451 Z.): Element-Abfrage dreifach (`:63-83, :127-153, :298-342`); Defaults 0.8/0.5/2.0/0.05/8.0/0.03/0.25/0.15/1.2/2.5 (`:344-412`) duplizieren Element-Defaults; 35+ Uniform-Location-Felder (`:18-53, :216-251`) → typisierte Map; `constructor(_gl, …)` `:59` `_gl` ungenutzt; `_uInverseGamma` in glsl300 immer null (Shader hat nur `u_gamma`, `:84-86` teilt pro Pixel); `performance.now()` `:419` statt Engine-Zeit (Pause friert Grain/Filter nicht ein; unsicher ob gewollt); `destroy` setzt nichts zurück; `u_lightShaftsEnabled` bleibt Uniform, während andere Flags Makros sind, trotzdem im Signatur-Hash (`:100`) → unnötiger Rebuild beim Toggle. WGSL: `@builtin(position) coord` (`:78`) ungenutzt; Grain nutzt `uv*dims` (`:332`) vs GL `gl_FragCoord`; `:98` `gainB` in `dyn.c.w` handgepackt; `shaftsParams.y` (density) ungenutzt; deutsche Kommentare in Shadern (`glsl:276-278`, `wgsl:296-298`), Kommentar-Sprache gemischt. `random(gl_FragCoord.xy + time)` in mediump.

**N4 Light Shafts (zusätzlich zu den bekannten Findings)**
- `LightShaftsBilateral.frag.wgsl:14, 28`: `fullDims`/`lowDims` aus derselben Tiefentextur (Name irreführend); der GL-Pass bindet `depthTexture` auf Unit 1 und 2 (`LightShaftsPassGL.ts:359-367`), WGSL-Bind-Group zweimal `depthView` (`LightShaftsPassGPU.ts:215-219`) — bestätigt das Redundanz-Finding.
- Cascade-Fallbacks inkonsistent: GL `?? 100.0` für alle (`LightShaftsPassGL.ts:329`) vs GPU `?? 10/25/50/100` (`LightShaftsPassGPU.ts:255-258`); fehlt eine Kaskaden-Kamera (GL `:327`), bleiben alte Matrizen im Scratch (kein Reset).
- `u_dirShadowInfo.y` (normalBias) wird in beiden Shadern nie verwendet (`LightShafts.frag.glsl:61`, `wgsl:53` nur `.x`).
- `normalize(u_sunDir)` pro Pixel (`glsl:89`, `wgsl:85`), obwohl die CPU bereits normalisiert (GL `:297-298`, GPU `:237-238`).
- IGN (`getIGN`) und `12.566370614359172` (4π) in GLSL und WGSL doppelt, Magic.
- Atlas `cols = ceil(sqrt(numCascades))` (`glsl:55`) implizit gekoppelt an `DirectionalLight.ts:173` und `WebGL2Renderer` (ungelesen).
- GPU: Uniform-Block-Hand-Packing `d[16..39]` (`LightShaftsPassGPU.ts:229-270`) mit Magic-Indizes und Größen 104 Floats/416 Byte (`:26, :71`) → bekanntes Param-Packing-Finding; `d[30]=0.1`, `d[31]=1000.0` (near/far, ungenutzt, bekannt).
- GL1-Tier ignoriert `samples`, nutzt `weight/decay` (Element-Doc `LightShaftsElement.ts:41-54` deklariert `samples` „clamped 4..32", Clamp erfolgt nur im Shader `glsl:83` / `wgsl:79`; Group clamp nicht).
- `LightShaftsPassGL.ts:251-255` `_resizeTargets` nach Early-Return-Checks, aber vor Programm-/Textur-Verfügbarkeitsprüfung (`:259, :384`) — unnötiger Resize bei fehlendem Shadow.
- ~~**Bekannt, hier bestätigt:** intensity² (`glsl:112 * u_intensity` + Composite `glsl300:250 * u_lightShaftsIntensity`), color² nur WebGPU (`LightShaftsPassGPU.ts:244-246` `color*intensity` im Raymarch + `PostProcess.frag.wgsl:267 shaftsColor` im Composite), Depth-Threshold 0.05 auf nichtlinearer Tiefe (GL `:373`, GPU `:277`), tote Uniforms (`density` lebt im Raymarch, tot nur in `PostProcess wgsl shaftsParams.y`; `near/far`).<!-- ERLEDIGT: intensity² und color² entzerrt, linearisierter/relativer depthThreshold via LightShaftsElement, tote Uniforms bereinigt (Bob) -->~~
- ~~Weitere im Diff-Review bestätigte Punkte (siehe auch `02`): `LightShaftsPassGL` mischt zwei Algorithmen hinter `_isWebGL2` (455/464 Z.) — zwei Klassen; Duplikation GL/GPU-Param-Packing (`halfW/halfH` 3× in `LightShaftsPassGL`); `_vaoSrafts`; kein Link-Check/Shader-Leak; `density * 10.0` Einheitenbruch GL1/GL2; GL1-Textur `UNSIGNED_BYTE` klippt bei `intensity > 1`; NaN/Inf-Guard unterschiedlich (GL2 `isnan+isinf`, WGSL nur NaN, GL1 keiner); Auflösung aus `gl.canvas.width/height` statt HDR-Target-Größe (unsicher, bei Offscreen/Resolution-Scale); Tests (`LightShaftsMath.test.ts`) bilden Formeln als lokale Kopie nach und hätten intensity² und den GL1-Fade nicht entdeckt; ADR `docs/adr/0030-volumetric-light-shafts.md` existiert.<!-- ERLEDIGT: _vaoShafts Typo behoben, Compile- & Link-Checks mit Shader-Cleanup gegen Leaks in LightShaftsPassGL implementiert (Bob) -->~~

**N5 `HistoryBlend`:** `config: { feedback: number }` (`HistoryBlendPassGL.ts:101`, `GPU:100`) anonymer Strukturtyp; GPU `:74` `for (const old of this._pingPong ?? [])` ok; GLSL `u_hasHistory` int, WGSL float — gleiche Semantik.

**N6 Lights**
- `AbstractLight.ts:100`: `Object.isFrozen(color) ? clone : color` teilt `Color`-Instanz mit Aufrufer (Aliasing zweier Lichter).
- `AbstractLight.ts:9-13`: „WebGL2/WebGL1 currently only read the first 16" — Magic 16 nirgends als Konstante; stille Kürzung ohne Warnung. `PointLight.ts:56` / `SpotLight.ts:131` `applyTo` verwerfen Überschuss stumm; `AmbientLight.ts:22-25` / `DirectionalLight.ts:356-363` last-wins ohne Hinweis.
- `AreaLight.ts:19-24` `MAX_AREA_LIGHTS` von Hand mit drei GLSL-Dateien synchronisiert (dokumentiert, fragil) → per Template-Token beim Assemble.
- Inspector-Schema nur Point/Spot; Area/Directional/Ambient ohne eigene Felder. Distance-Default Area 0 (infinite) vs Point 50. SpotLight-Inspector `angle max 1.57` Magic.
- `SpotLight.ts:109-111`: `worldMatrix.data[12] ?? this.position.x` — stiller Fallback auf `Float32Array` (nie undefined). Position kommt aus `worldMatrix`, `direction` ungetransformiert (unsicher, ob gewollt). Shadow-Camera nur bei `castShadow` im Konstruktor erzeugt (`:82`), sonst lazy via `updateShadowCamera`; near 0.1 und far-Fallback 1000 Magic (`:96-97, :103`).
- `DirectionalLight.applyTo:357-359` normalisiert `direction` nur in der Daten-Struktur, Feld selbst bleibt unnormalisiert (Light-Shafts-Pässe normalisieren erneut).
- Konstruktor: `new Vector3D(0,-1,0).normalize()` als Default-Argument in Destructuring (Allokation pro Konstruktion, nur Setup).

**N7 Reflexion/Sky/Decals**
- `DynamicReflectionProbe.ts:39-56` zwei Richtungstabellen; GL-Variante = negierte Up-Vektoren → eine Tabelle + `upSign`. `far=1000`, `near=0.1`, `fov=π/2` Literale (`:63-66`). `renderer.type === WEB_GL1 || WEB_GL2` Backend-Branch im Core-Objekt (Backend-Wissen im Scene-Layer; unsicher ob besser im Renderer).
- Weder Probe noch `PlanarReflectionNode` bieten `dispose()` für das gehaltene RenderTarget (Object3D-Basis nicht geprüft, unsicher).
- `PlanarReflectionNode.ts:41-42` teilt `mainCamera.projection`-Objekt mit `mirrorCamera` (Aliasing; Setzen von `aspect` wirkt auf beide). Kein schräger Near-Clip: Geometrie unter der Spiegelebene landet in der Reflexion (Qualitätslimit, kein Code-Fehler).
- `Skybox.ts:6-9` Doc „Configuration options for the Skydome." / Default-Name „Skydome" (Copy-Paste); `size = 1000` vs Skydome `radius = 100` inkonsistent; ob das Mesh der Kamera folgt/translationsfrei gerendert wird, im Slice nicht gesehen (unsicher). `Skydome.ts:45-57` kehrt nur die Index-Windung um, UVs nicht — Textur kann innen gespiegelt erscheinen (unsicher, hängt von Sphere-UVs ab). Skydome mutiert `geomData.indices` in place (ok, frisch erzeugt).
- `DecalPool.ts:142-149` `dispose()` leert `_slots`; danach `spawn` → `_acquire` `_release(undefined!)` → TypeError statt klarer Fail-Fast-Meldung (Doc sagt „unusable", Code erzwingt es nicht). `baseOpacity` nur im Konstruktor gelesen (`:81`). Slot nahe Fade: Spawn setzt Alpha voll, bei `lifetime<fadeSeconds` springt sie im ersten Update. `capacity`-Check `:63` (`!(x>=1) || !isInteger`) redundant (NaN schon durch erstes). Magic `[0.5,0.5,0.3]` `:67`.
- `DecalMath.ts:19-25` `compareDecals` berechnet die Determinante pro Vergleich im Sort-Comparator, der pro Frame in `Scene.ts:300` läuft (`decals.sort(compareDecals)`) → O(n log n) Determinanten pro Frame. Vorschlag: Volumen beim Matrix-Update cachen (Decal-Feld) oder nur bei Änderung neu sortieren. (Aufruf bei `Scene.ts:300` bestätigt, Häufigkeit der Decals unklar.) `DecalMath.ts:33-39` `computeClipToBox` pool-basiert, korrekt.

**N8 Sonstiges:** `renderers/post/index.ts:3-5` exportiert `PostProcessPassGL/BloomPassGL/BloomPassGPU` doppelt (zusätzlich `./passes/index.js`, `:8`). `PostProcessingElement.ts:9` Kommentar „Unique string identifier" stimmt nicht (Typ ist `PostProcessingEffectType`). `GrainElement` ohne Klassen-Doc; `GrainElement/ToneMappingElement` ohne Kommentare auf Feldern. Yoda-Vergleiche in Octree (`0 < x`, `false === …`) vs normalem Stil sonst. `PostProcessPassGL.ts:260` `new Float32Array([...])` pro `_build` (nur Setup, ok).

## 2. Ergänzend aus Agent 1/2/4 (renderer-nah, hier relevant)
- `PostProcessPass.ts` (WebGPU): dreifache Element-Abfrage (`:55-83, 152-175, 307-337`), elf `assembledFrag.replace("const u_x: u32 = 0u;", …)` (`:192-246`, stiller No-op bei WGSL-Änderung), Uniform-Packung `d[0..51]` mit hartkodierten Defaults (`:349-411`) dupliziert Defaults der `…Element`-Klassen und von `PostProcessPassGL`. Judo: `packUniforms(out, offset)` + `structuralKey` pro Element (−250 Z.), WGSL-`override`-Konstanten statt Source-Replace.
- `ShaderRegistry.instance` in `PostProcessPass.ts:145` und `PostProcessPassGL.ts:125` (deprecated Prozess-Registry statt `renderer.context.shaderRegistry`) — Mehrinstanz-Bug-Risiko, abhängig davon ob Post-Shader `#include`/Chunks nutzen (nicht geprüft). Danach werden `ShaderRegistry.instance` und die statische `DeviceCaps`-Fassade tot (siehe `15`).

## 3. Positive Befunde (nicht anfassen)
- **Zero-Allocation-Disziplin in den Light-Shafts-Passes:** Scratch-Matrix/Float32Arrays/Vector3D als `readonly`-Felder (`LightShaftsPassGL.ts:75-79`, GPU `:48-49, 26, 32`), Uniform-Pakete als vorallokierte `Float32Array`; Bind-Groups werden gecacht und nur bei View-Wechsel neu gebaut (GPU `:194-223`, `AOPassGPU:56-90`, `HistoryBlendPassGPU:109-123`, `BloomPassGPU:87-184`).
- **WebGPU-Lifecycle sauber:** Texturen/Uniform-Buffer werden bei Resize explizit `destroy()`ed (`BloomPassGPU:101-108`, `HistoryBlendPassGPU:72-74`, `LightShaftsPassGPU:143-144`, `AOPassGPU:66`), mit erklärenden „Warum"-Kommentaren.
- Strukturelle vs. kontinuierliche Parameter sauber getrennt: Rebuild nur bei Flags/Modi, Tuning per Uniform (`PostProcessPassGL:85-89`; WGSL `dyn`-Block); WGSL-Consts werden zur Compile-Zeit überschrieben.
- Bilateral-Upsample mit Nearest-Fallback an Silhouetten (`Bilateral glsl:48-52`, `wgsl:51-53`) — vernünftiger Edge-Schutz.
- AO: Normal-Rekonstruktion nach Turanszki mit relativer (statt absoluter) Gültigkeitsschwelle, NaN-Guards in beiden Backends, GLSL/WGSL-Parität algorithmisch sehr nah; WGSL-Compute statt Fullscreen-Pass sinnvoll.
- `HistoryBlend` teilt eine Pass-Klasse für TAA und MotionTrail (gute Wiederverwendung); Ping-Pong mit korrekter Parität (GPU `:129, 141`).
- Octree: Re-Subdivision-Guard (`Octree.ts:119`) mit Begründungskommentar; Pool-Vektoren in `_subdivide`/`insert`; Fast-Remove (swap/pop).
- DecalMath/Baker: saubere Pure-Math-Kerne, Sutherland-Hodgman korrekt dokumentiert; Negative-Determinante-Handling (`Baker:154, 162`); `computeClipToBox` pool-basiert; `DecalPool`: feste Kapazität, keine Node-Entfernung pro Spawn, Fail-Fast im Konstruktor (`:63-65`), lokale Instanz statt Singleton (Doc `:47-49`).
- `DirectionalLight`: Kaskaden-Berechnung ohne Heap-Allokation in der Rechenroutine (Scratch-Felder `:47-55`), Texel-Snapping mit begründetem Kommentar, Practical-Split-Scheme plus Ortho-Sonderfall.
- Lights: Inspector-Schemata statisch und mergebar (`AbstractLight:42`, `Point:21`, `Spot:30`); keine `any`; explizite Typen und Access-Modifier durchgängig; keine globalen Singletons außer `OctreeNode._nodePool`.
- Skydome/Skybox: `frustumCulled = false` korrekt gesetzt.

## 4. Widerlegte / eingeordnete Verdachtsfälle
- **WGSL-Depth-Range-Inkonsistenz** (`AO.frag.wgsl:17` `d*2-1` vs `LightShafts.frag.wgsl:65` `ndc.z = rawDepth`): kein Fehler, wenn der Renderer die View-Projection für WebGPU auf z∈[0,1] korrigiert und die rohe Perspective-Matrix (`Matrix4.ts:399-414`: GL-Konvention `(far+near)/(near-far)`) für AO benutzt wird; beide Shader sind dann konsistent. Die tatsächliche Korrektur in `WebGPURenderer` nicht verifiziert (offen, unsicher).
- **`u_toneMappingMode = 1` bei deaktiviertem Tonemapping** (`PostProcessPassGL.ts:164-167`): bewusst (Reinhard-Fallback, siehe `renderers/passes/PostProcessPass.ts:28, 192-197`); nur das benannte Enum-Mitglied fehlt.
- **FlashElement-Rebuild pro Frame:** `SmallWorldMachine.ts:393-399` setzt pro Frame nur `intensity`/`color`, nicht `enabled`; ob ein anderer Ort `enabled` toggelt, nicht geprüft.
- **`MipDownsample.frag.wgsl` nicht tot:** wird in `renderers/WebGPU/managers/GPUTextureResourceCache.ts:7` importiert.
- `textureSample` in WGSL `PostProcess` liegt nur in const-gated (uniformem) Kontrollfluss → keine Uniformity-Verletzung.
- `LightShaftsPassGL` `_vaoSrafts`/GL1-GL2-Mischung bestätigt (siehe M5/N4); WebGL1-Light-Shafts-Kamera-Z-Guard als H5 verschärft: der Fade existiert faktisch nicht.
- `Octree`-Collapse-Rekursion und Remove-Vollsuche: als Risiko markiert, nicht als bestätigter Defekt (Aufrufer im Slice nicht gesehen).

## 5. Abdeckung (alle komplett gelesen, Zeile 1 bis Ende; Pfade unter `packages/engine/src`)

| Datei | Zeilen |
|---|---|
| renderers/post/index.ts | 8 |
| renderers/post/PostProcessingElement.ts | 11 |
| renderers/post/PostProcessingGroup.ts | 276 |
| renderers/post/elements/BloomElement.ts | 21 |
| …/ColorGradingElement.ts | 31 |
| …/FlashElement.ts | 16 |
| …/GrainElement.ts | 9 |
| …/GravitationalLensingElement.ts | 31 |
| …/HbaoElement.ts | 19 |
| …/LightShaftsElement.ts | 60 |
| …/MotionTrailElement.ts | 19 |
| …/OutlineElement.ts | 22 |
| …/QuantizeElement.ts | 15 |
| …/TaaElement.ts | 19 |
| …/ToneMappingElement.ts | 13 |
| …/VignetteElement.ts | 16 |
| …/index.ts | 13 |
| renderers/post/passes/AOPassGL.ts | 154 |
| …/AOPassGPU.ts | 139 |
| …/BloomPassGL.ts | 357 |
| …/BloomPassGPU.ts | 278 |
| …/HistoryBlendPassGL.ts | 153 |
| …/HistoryBlendPassGPU.ts | 156 |
| …/LightShaftsPassGL.ts | 464 |
| …/LightShaftsPassGPU.ts | 322 |
| …/PostProcessPassGL.ts | 451 |
| …/index.ts | 9 |
| renderers/post/shaders/AO.frag.glsl | 125 |
| …/AO.frag.wgsl | 160 |
| …/BloomDownsample.frag.glsl / .glsl100 / .wgsl | 67 / 64 / 59 |
| …/BloomUpsample.frag.glsl / .glsl100 / .wgsl | 35 / 32 / 35 |
| …/HistoryBlend.frag.glsl / .wgsl | 24 / 24 |
| …/LightShafts.frag.glsl / .wgsl | 113 / 113 |
| …/LightShafts100.frag.glsl | 47 |
| …/LightShaftsBilateral.frag.glsl / .wgsl | 54 / 56 |
| …/MipDownsample.frag.wgsl | 7 |
| …/PostProcess.frag.glsl / .wgsl | 360 / 382 |
| …/PostProcess100.frag.glsl | 145 |
| …/PostProcess.vert.glsl / .wgsl, PostProcess100.vert.glsl | 12 / 16 / 7 |
| core/culling/FrustumCuller.ts | 102 |
| core/culling/Octree.ts | 387 |
| core/decals/DecalMath.ts | 65 |
| core/decals/DecalMeshBaker.ts | 372 |
| core/decals/DecalPool.ts | 191 |
| core/lights/AbstractLight.ts | 108 |
| core/lights/AmbientLight.ts | 26 |
| core/lights/AreaLight.ts | 64 |
| core/lights/DirectionalLight.ts | 364 |
| core/lights/PointLight.ts | 60 |
| core/lights/SpotLight.ts | 135 |
| core/lights/index.ts | 7 |
| core/reflection/DynamicReflectionProbe.ts | 137 |
| core/reflection/PlanarReflectionNode.ts | 111 |
| core/sky/Skybox.ts | 38 |
| core/sky/Skydome.ts | 67 |

Summe laut `wc`: 7.253 Zeilen, 65 Dateien. Zur Verifikation nur punktuell außerhalb des Slices gelesen: `core/Scene.ts` (28–60, 99–107, 270–345), `core/SmallWorldMachine.ts` (385–415), `math/Matrix4.ts` (399–414), `renderers/WebGPU/WebGPURenderer.ts` (1515–1550), Greps in `renderers/passes/PostProcessPass.ts` und `renderers/WebGL1/WebGL1Renderer.ts`.
