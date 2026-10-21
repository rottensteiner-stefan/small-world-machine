# Hierarchical-Z-Occlusion-Culling: nur WebGPU, Kugel-Bounds, um einen Frame veraltet

> **Stand-Hinweis (2026-10-21):** Die Implementierung liegt seit ADR 0037 in `renderers/WebGPU/managers/HzbOcclusionSystem.ts`; die genannten `_hzb*`-Felder und `MAX_HZB_TESTED_OBJECTS` stehen nicht mehr in `WebGPURenderer` (dort nur dünne Delegates). `BoundingVolume` umfasst inzwischen auch `ConvexHull` (ADR 0040); die Kugel-Begründung bleibt gültig.

Hierarchical-Z (HZB) Occlusion Culling gibt es nur für WebGPU, opt-in über
`EngineOptions.enableOcclusionCulling` (Standard: aus). Anders als Clustered Lighting
([0007](0007-clustered-lighting-webgl2-webgpu-only.md)) gibt es hier überhaupt keinen
WebGL2-Fallback-Pfad — Clustering hatte ein CPU-seitiges Analogon (Lichter durchlaufen,
Abdeckungsbereiche in JS testen), das WebGL2 ohne Compute-Shader ausführen konnte; HZB hat keine
äquivalente CPU-Abkürzung. Der Aufbau der Depth-Mip-Pyramide braucht einen
Max-Reduction-Compute-Pass, und das Testen von Objekt-Bounds dagegen braucht Pro-Objekt-Compute-
Dispatch mit einem Ergebnispuffer, der zur CPU zurückgelesen wird — beides erfordert grundlegend
Compute, das WebGL1/WebGL2 nicht haben. `Object3D.occlusionCulled` wird auf diesen Backends nie
geschrieben, sodass `Scene._collectVisible()`s Occlusion-Check dort ein dauerhaftes No-Op ist;
für diesen Check selbst braucht es kein Config-Gate, der eigene Default des Felds (`false`) ist
die Quelle der Wahrheit.

Der Sichtbarkeitstest hinkt der Tiefe, gegen die er getestet wird, immer um genau einen Frame
hinterher, und das ist strukturell, keine Abkürzung aus Bequemlichkeit: WebGPUs
`GPUBuffer.mapAsync()` für einen GPU-geschriebenen Puffer ist *immer* asynchron, sodass ein Test,
der gegen die gerade fertiggestellte Tiefe von Frame N dispatcht wird, frühestens ab Frame N+1
zurückgelesen und angewendet werden kann. Das ist dieselbe Latenz, die Frostbite und Unreal für
ihre eigenen temporal-reprojizierten HZB-Systeme akzeptieren — keine Ecke, die diese
Implementierung abgeschnitten hat. Im eingeschwungenen Zustand (Kamera bewegt sich sanft, teleportiert
nicht) hält die Annahme: ein Objekt, das im letzten Frame verdeckt war, ist mit überwältigender
Wahrscheinlichkeit auch in diesem Frame noch verdeckt.

`applyPendingOcclusionResults()` liest die Bereitschaft, indem es direkt jeden Frame
`GPUBuffer.mapState === "mapped"` auf jedem ausstehenden Staging-Slot abfragt — nicht, indem es auf
das Auflösen des eigenen Promise von `mapAsync()` reagiert. Eine frühere Version tat Letzteres
(setzte ein `resultsReady`-Flag aus dem `.then()` des Promise), und das führte zu einem Deadlock:
`_hzbStagingSlot` rückt nur bei einem *neuen* erfolgreichen Dispatch vor, und Dispatch weigert
sich, einen noch als ausstehend markierten Slot anzufassen — falls dieser Promise-Callback also
jemals langsam ist oder nie feuert, verklemmt sich der Slot — und mit ihm das ganze
Zwei-Slot-Ping-Pong — dauerhaft, ohne einen WebGPU-Validierungsfehler oder sonst irgendetwas, das
den Deadlock sichtbar macht. Das Lesen von `mapState` (die eigene, spec-garantierte Ground Truth der
GPU für den Mapped-Status des Puffers, die sich aktualisiert, egal ob jemand zuhört) hat keinen
solchen Fehlermodus: welcher Slot auch immer sein Mapping tatsächlich abgeschlossen hat, wird beim
allernächsten Aufruf konsumiert, unabhängig davon, was mit seinem Promise passiert ist.

Der Test verwendet die **Kugel**-Bounding-Volume jedes Objekts, keine enge AABB. `BoundingVolume`
(das Interface, als das `Object3D.bounds` typisiert ist) legt über seine drei konkreten Formen
(Box/Sphere/OBB) hinweg generisch nur `center`/`getBroadRadius()` offen — eine enge
achsenausgerichtete Box zu bekommen bräuchte ein Downcasting pro Bounds-Typ. Eine Kugel ist eine
konservative Näherung: sie kann nur *unter*-culen (ein Objekt als sichtbar testen, wenn eine
engere Box es als verdeckt erkannt hätte), niemals fälschlich etwas verstecken, das die Kamera
tatsächlich sehen kann.

Die AABB- und Ergebnispuffer (`_hzbAabbBuffer`/`_hzbResultsBuffer`, und das Ping-Pong-Paar
`_hzbStagingBuffers`) haben feste Kapazität, dimensioniert für `MAX_HZB_TESTED_OBJECTS` (8192) —
kein dynamisches Nachwachsen, keine Atomics, dieselbe Feste-Kapazität-ohne-Atomics-Begründung, die
0007 schon für die Cluster-Licht-Puffer verwendet. Objekte jenseits der Obergrenze (unter denen,
die Frustum-Culling schon bestanden haben) werden einfach nie occlusion-getestet; sie werden immer
gezeichnet, derselbe sichere Standardwert, der der eigene Anfangswert von `occlusionCulled` schon
ist.

`_dispatchHzbTest()` leitet seine Kandidatenliste ab, indem es die ihm übergebene `Scene` direkt
durchläuft (`isVisible && inFrustum && bounds`), statt ein `static`-Feld auf `FrustumCuller` zu
lesen — zum Zeitpunkt dieser Entscheidung führte `FrustumCuller` genau ein solches Nebenprodukt-Feld
(`lastVisibleObjects`). `FrustumCuller`s Felder sind `static`, geteilt über jede `SmallWorldMachine`-Instanz
auf der Seite; damals lief `GadgetInspector`s `MaterialStudioApp`-Materialvorschau-Panel selbst als
eigene `SmallWorldMachine`-Instanz mit eigener `_loop()` (und damit eigenem `FrustumCuller.cull()`) auf
einer winzigen Vorschau-Szene nebenher, wann immer der Showcase-Modus, der es hostete, aktiv war
(`enableInspector: true`, nie Engine-Standard, aber von etlichen Showcases explizit gesetzt) — ein
statisches Feld zu lesen hieß in diesem Fall, zu testen, welcher Szene `cull()` zuletzt lief, fast
nie die tatsächlich gerenderte. Der szenengebundene Durchlauf kostet eine zusätzliche rekursive
Traversierung pro Frame, vermeidet aber genau diese Klasse Bug von vornherein.

**Update:** `GadgetInspector` selbst ist inzwischen vollständig durch Maker ersetzt (ADR 0010), und
`lastVisibleObjects` wurde als totes, nie korrekt konsumiertes Feld entfernt (`lastVisibleCount`/
`lastIntersectedNodes` blieben als tatsächlich genutzte Introspektions-Felder). Um eine redundante
Baumerkundung pro Frame zu vermeiden, nutzt `_dispatchHzbTest()` nun die szenengebundene, pro-Kamera gecachte
Instanz-Property `scene.lastFrustumVisibleObjects`, die während `Scene.getVisibleObjectsSorted()` als Nebenprodukt
der Frustum-Prüfung befüllt wird — damit entfällt der rekursive Zweitdurchlauf, ohne auf geteilte statische
Felder zurückgreifen zu müssen.

Occlusion Culling läuft nur für den Haupt-Canvas-Pass. `WebGPURenderer._buildHzbPyramid()`/
`_dispatchHzbTest()` sind beide No-Ops, wann immer `_activeRenderTarget` gesetzt ist
(Reflection Probes, `bakeImposter()`, jedes andere Offscreen-`RenderTarget`/
`RenderTargetCube`-Rendering) — eine zweite HZB-Pyramide pro Render-Target, bei jedem Rendern
dieses Targets neu aufgebaut, wäre echter zusätzlicher Umfang, den diese Iteration bewusst nicht
übernimmt.

**Das hier überdenken, wenn:** ein Showcase Occlusion Culling auf einem stark überzeichneten
Offscreen-Render-Target braucht (z. B. eine Reflection-Probe-Szene, die dicht genug ist, dass das
Überspringen verdeckter Zeichnungen dort etwas ausmachen würde) — das braucht eine
Pro-Render-Target-HZB-Pyramide, nicht nur die Wiederverwendung der Haupt-Pyramide. Oder falls die
Ein-Frame-Veraltung sichtbares Pop-in bei schnellen Kameraschnitten/Teleports verursacht — das
braucht explizite HZB-Invalidierung (z. B. szenenweites Zurücksetzen von `occlusionCulled`) bei
erkannten großen Kamerasprüngen, was nicht Teil der Nur-eingeschwungener-Zustand-Begründung dieses
ADRs ist.
