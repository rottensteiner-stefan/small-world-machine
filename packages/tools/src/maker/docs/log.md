# Maker — Development Log

> Dieses Log ist das primäre Gedächtnis für das Maker-Tool.
> Vor jeder Session lesen, nach jeder Session einen Eintrag anhängen.

---

## 2026-09-01 — Phase 3: Konsolidierung & Integration (ADR 0010 §5)

Paritäts-Gate gegen ADR 0010 §5 erfolgreich abgeschlossen und Maker fest im Gesamtsystem verankert:

- **Ökosystem & Build-Integration:**
  - `public/index.html`: Maker als **`T-08: Maker (World & Scene Editor)`** in der Development-Tools-Übersicht verankert.
  - `vite.config.ts`: Rollup-Input für `maker` (`public/tools/maker.html`) und Ausgabe unter `js/tools/maker.js` hinzugefügt.
  - `docs/guides/forge.md` & `docs/guides/maker.md`: Vollständige Benutzer- und Tool-Dokumentation für den Standalone-Workflow angelegt und verlinkt.
  - `docs/adr/0010-maker-editor-architecture.md`: Status auf *Delivered* aktualisiert.
- **Acceptance-Gate Status:**
  - Maker übertrifft GadgetInspector in allen Kernbereichen (Persistenz via glTF 2.0/Autosave, Undo/Redo, Objekt- & Prefab-Erstellung, Transform-Gizmos, Snapping, Marquee-Selection, Bookmarks).
- **Bugfix (Scroll-Zoom-Entkopplung):**
  - Wheel-Events auf `.maker-sidebar` (Hierarchy, Palette, Properties), Toolbars und Statusleiste isoliert (`stopPropagation()`), sodass Panel-Scrolling nicht mehr fälschlicherweise in den 3D-Viewport zoomt.

---

## 2026-09-01 — Phase 2 Feinschliff: Snapping, Pivot-Transform, Batch-Behaviors & Marquee-Selection

Vier wesentliche UX- und Workflow-Verbesserungen zur Vollendung von Phase 2 implementiert:

- **Grid- & Angle-Snapping:**
  - `GizmoSnapConfig` in `TransformGizmo.ts` mit getrennten Intervallen für Translation (`0.5m`), Rotation (`15°` / `Math.PI / 12`) und Skalierung (`0.25`).
  - Neuer Toolbar-Button `🧲 Snap (X)` + Tastenkürzel `X` zum Umschalten.
  - `TransformGizmo.snapValue()` rundet die akkumulierten Deltas bzw. Zielwerte auf das eingestellte Raster.
- **Pivot-relativer Gruppen-Transform:**
  - Bei Mehrfachauswahl rotiert und skaliert das Gizmo nun alle selektierten Objekte relativ zum Pivot (Weltposition des primären Objekts) im 3D-Raum, anstatt nur lokale Deltas auf die Einzelobjekte zu addieren.
  - Transform-Snapshot für Undo/Redo speichert Position, Rotation und Scale pro Objekt für verlustfreie Wiederherstellung.
- **Batch-Behaviors:**
  - `attachBehaviorToSelection(factory: () => Behavior)` akzeptiert nun eine Factory-Funktion und erzeugt für jedes Objekt in der aktuellen Selektion eine frische Behavior-Instanz.
  - Zusammenfassung als ein einziger Batch-Undo-Schritt.
- **Box- / Marquee-Selection (Rechteck-Auswahl):**
  - Klick und Ziehen auf freier Viewport-Fläche spannt ein 2D-Auswahlrechteck (`.maker-marquee-box`) auf.
  - Alle renderbaren/pickbaren Objekte im Sichtfeld werden über `camera.viewProjectionMatrix4.transformVector()` in Screen-Koordinaten projiziert (inkl. Bounding-Box/Sphere-Corners) und gegen das Marquee-Rechteck getestet.
  - Unterstützt Shift/Ctrl-Modifier zur additiven Mehrfachauswahl.

---

## 2026-09-01 — Nachtrag: Isolierter Prefab-Thumbnail-Render

Der bisherige Viewport-Snapshot (zeigte einfach die aktuelle Kameraansicht) wird jetzt zu einem
echten isolierten Render: nur das zu speichernde Objekt, freigestellt vor Schwarz, aus einem
festen 3/4-Winkel.

- `_captureIsolatedThumbnail(obj)` (ersetzt `_captureViewportThumbnail`): blendet Gizmo,
  Highlight-Boxen und JEDES ANDERE Top-Level-Szenenobjekt aus (nicht das Ziel-Objekt selbst oder
  dessen Top-Level-Vorfahre), reframed die Kamera auf die kombinierten Weltbounds des gesamten
  Subtrees (`_computeSubtreeWorldBounds`, läuft rekursiv über alle Kinder — ein Prefab ist oft
  mehr als ein Mesh), pausiert den Orbit-Controller währenddessen (`_thumbnailCaptureActive`,
  in `update()` geprüft), macht den Snapshot, stellt alles exakt wieder her (Sichtbarkeit,
  Kameraposition/-ziel, Orbit-Controller-State über `OrbitCameraController.getView()`/`setView()`
  — dieselbe Snapshot-Mechanik wie bei den Kamera-Bookmarks).
- **Echten Bug beim Live-Test gefunden und gefixt:** Die erste Version hat ALLE anderen
  Top-Level-Objekte ausgeblendet — inklusive `SunLight`/`Fill`, die in `setupScene()` auf
  derselben Ebene wie über die Palette platzierte Objekte liegen. Ergebnis: komplett
  unbeleuchtetes, schwarzes Thumbnail. Nicht sofort aufgefallen, weil `canvas.toDataURL()`
  weiterhin eine valide (nur eben rein schwarze) PNG zurückgab — kein Fehler, keine Exception,
  einfach ein falsches Bild. Erst der Pixel-Vergleich (Center-Pixel schwarz statt Würfelfarbe)
  hat es aufgedeckt. Fix: Lichter (`instanceof AbstractLight`) explizit von der
  Ausblend-Filterung ausgenommen.
- **Verifikations-Notiz:** `requestAnimationFrame` feuert in diesem Tab durchgehend nicht
  (`document.hidden`, siehe `feedback_browser_automation_raf_throttling`-Erinnerung) — echte
  End-zu-Ende-Captures über die Promise-Kette liefen deshalb konsequent in den bereits gebauten
  1-Sekunden-Timeout-Fallback (sauber, kein Hänger, korrektes Restore — selbst geprüft). Um die
  eigentliche Bild-Korrektheit trotzdem zu verifizieren, wurde der reale Renderloop manuell
  über `app._loop(t)` mit Hand-Timestamps durchgekurbelt (dokumentierter Workaround), das
  Ergebnis-PNG dekodiert und Center- gegen Eck-Pixel verglichen — genau darüber wurde der
  Licht-Bug gefunden und der Fix bestätigt (Center-Pixel danach echtes beleuchtetes Grau statt
  Schwarz, Nachbarobjekt nachweislich nicht im Bild).
- Kamera-Framing: fester Blickwinkel `(1, 0.75, 1)` normalisiert, Distanz skaliert mit dem
  Bounds-Radius (`max(1, radius * 2.2)`). Objekte ganz ohne Geometrie (leere Gruppen) bekommen
  eine Default-Distanz um ihre eigene Position statt eines Abbruchs.

---

## 2026-09-01 — Nachtrag: Multi-Selektion (letzter offener Roadmap-Punkt)

Größter Umbau bisher — betrifft Selection-State, Gizmo, Hierarchy-Panel, Property-Panel und
Undo für Duplicate/Delete/Group gleichzeitig.

- **Selection-Modell:** `_selection: Set<Object3D>` + `_primary: Object3D | undefined`
  (Blender/Unity-"aktives Objekt"-Konvention — treibt Property-Panel-Anzeige + Gizmo-Pivot).
  `_selected` bleibt als reiner Getter-Alias auf `_primary` erhalten, damit die ~25 bestehenden
  Single-Object-Lesestellen im Code unverändert weiterlaufen.
- **Klick-Semantik:** Klick = Auswahl ersetzen. Shift/Ctrl/Cmd+Klick = togglen, ohne den Rest
  anzutasten — sowohl im Viewport (`_onPointerDown`) als auch im Hierarchy-Panel (Zeilen-Klick
  reicht jetzt den Modifier-Status durch). Modifier+Klick auf Leerraum ist bewusst ein No-op
  (löscht keine bestehende Mehrfachauswahl).
- **Highlight:** Pool aus wiederverwendeten Wireframe-Boxen (`_highlightMeshes[]`, indexbasiert
  statt an ein festes Objekt gebunden) statt einer einzigen — primäres Objekt cyan, alle anderen
  amber, damit auf einen Blick klar ist, welches Objekt Gizmo/Property-Panel gerade treiben.
- **Gizmo:** bleibt am Primary verankert (Pivot/Orientierung unverändert), aber der Drag-Delta
  wird auf ALLE selektierten Objekte angewendet (gleicher Delta pro Objekt, kein
  Pivot-relativer Gruppen-Transform — bewusste Vereinfachung, passt zum ohnehin schon
  "simplified gizmo"-Ansatz aus TransformGizmo's eigenem Kommentar). Ein Drag = ein Undo-Schritt
  für die ganze Selektion (`Map<Object3D, Vector3D>`-Snapshot statt Einzelwert).
- **Duplicate/Delete:** `duplicateSelection()`/`deleteSelection()` ersetzen die alten
  Single-Object-Methoden komplett (keine Sonderfälle mehr nötig, N=1 läuft über denselben Pfad).
  Je EIN Undo-Schritt für die ganze Batch-Operation.
- **Group:** `groupSelection()` verzweigt jetzt: 1 Objekt → alte Logik unverändert
  (`_groupSingle`, Gruppe übernimmt exakt die alte Transform). Mehrere Objekte → neue
  `_groupMultiple`: Gruppe landet am Centroid der Weltpositionen, jedes Objekt behält seine
  exakte Weltposition (nur Position wird angepasst, Rotation/Scale bleiben unberührt, da die
  Gruppe selbst Identity-Rotation/Scale bekommt). Funktioniert auch, wenn die selektierten
  Objekte unterschiedliche ursprüngliche Parents hatten — jedes bekommt beim Undo seinen
  eigenen Parent zurück.
- **Echter Bug beim Live-Test gefunden und gefixt (betraf auch den alten Single-Object-Pfad!):**
  Eine frisch erzeugte Gruppe hat eine Identity-`worldMatrix`, bis irgendwer
  `updateMatrixWorld()` drauf aufruft — fehlte in beiden `redo()`-Pfaden. Kinder haben ihre
  Weltposition dadurch beim Reparenting kurzzeitig NICHT korrekt erhalten (nur durch den
  nächsten Render-Frame kaschiert, der `scene.update()` ohnehin für den ganzen Baum aufruft —
  im Live-Betrieb also unsichtbar, aber synchron nachweisbar falsch). Nie aufgefallen, weil der
  allererste Group-Test (frühere Session) zufällig ein Objekt im Ursprung traf (0=0 sieht aus
  wie "korrekt", ist es aber nicht). Erst der heutige Test mit echten Nicht-Null-Positionen hat
  es aufgedeckt. Fix: `group.updateMatrixWorld()` direkt nach dem Hinzufügen zur Szene, vor dem
  Repositionieren der Kinder — in beiden Pfaden.
- **PropertyPanel:** zeigt weiterhin nur das Primary-Objekt (kein Batch-Edit), aber jetzt mit
  "(+N more)"-Suffix im Titel, damit klar ist, dass mehr als ein Objekt selektiert ist.
- **Bewusst nicht erweitert:** `attachBehaviorToSelection` bleibt Single-Object (Primary) —
  Behaviors sind nicht teilbar (ein Behavior hat genau ein `target`), hätte eine
  Factory-Signatur-Änderung in `ObjectPalette` gebraucht; als klare Grenze dokumentiert, kein
  Bug.
- Live geprüft: Shift-Klick im Hierarchy-Panel UND direkte Selection-API, Duplicate/Delete/Group
  mit 2 Objekten inkl. Undo (je ein Batch-Schritt, nicht N Einzelschritte), Gizmo-Multi-Drag
  (gleicher Delta auf beide Objekte, ein Undo-Schritt), Weltpositions-Erhalt bei Group jetzt
  synchron korrekt, Single-Object-Regression (Group/Duplicate/Delete verhalten sich exakt wie
  vor der Umstellung) — durchgehend keine Konsolen-Fehler.

---

## 2026-09-01 — Nachtrag: Prefab-Vorschau im Panel

Prefab-Liste zeigt jetzt ein echtes 28×28px-Thumbnail-Bild neben jedem Namen statt nur Text.

- `ProjectBinding.savePrefabThumbnail()`/`.loadPrefabThumbnail()` (neu): Sidecar-Datei
  `prefabs/<name>.thumb.json` (`{ dataUrl }`) neben dem `.gltf` — bewusst JSON statt roher `.png`,
  weil die eigene `FileSystemWritableFileStreamLike`-Abstraktion nur String-Writes kann und eine
  `data:`-URL bereits ein String ist. Kollidiert nicht mit `listPrefabs()` (filtert nach `.gltf`).
- `MakerApp._captureViewportThumbnail()` (neu): blendet Gizmo + Highlight-Box für einen Frame aus
  (Doppel-`requestAnimationFrame`, Standard-Pattern für "nach dem nächsten echten Paint"),
  `canvas.toDataURL()`, stellt Sichtbarkeit wieder her. Rührt sonst nichts an der Szene an —
  andere sichtbare Objekte landen mit im Bild. Ein isolierter Render (Kamera auf die Bounds des
  Objekts) wäre der nächste Ausbauschritt, bewusst nicht in diesem Durchgang.
- **Echter Robustheits-Bug beim Live-Test gefunden und gefixt:** Wenn der Browser-Tab beim Klick
  auf "Save Selection" nicht sichtbar ist, pausiert `requestAnimationFrame` unbegrenzt — der
  komplette Speicher-Flow (inkl. Status-Text und Prefab-Listen-Refresh, die NACH dem
  Thumbnail-Schritt liegen) hing dadurch fest, nicht nur das Thumbnail selbst. Fix: die
  Doppel-rAF-Kette läuft jetzt gegen ein 1-Sekunden-Timeout via `Promise.race` — Thumbnail fehlt
  dann einfach (kosmetische Lücke, wie ohnehin schon vorgesehen), aber der Rest des Flows blockiert
  nie mehr unbegrenzt.
- Live geprüft: `canvas.toDataURL()` liefert nachweislich echte Pixel (Center-Pixel = Würfelfarbe,
  Eckpixel = schwarzer Hintergrund, ~380KB PNG) direkt nach dem Laden. Der komplette
  Save→Thumbnail→Liste-Flow läuft robust durch, auch als der Test-Tab `document.hidden` wurde
  (bekannte claude-in-chrome-Automatisierungs-Einschränkung, siehe
  `feedback_browser_automation_raf_throttling`-Erinnerung) — genau dieser Fall hat den
  Robustheits-Bug erst sichtbar gemacht. `<img class="maker-prefab-thumb">` rendert korrekt mit
  dem gespeicherten `dataUrl`, separat verifiziert.
- 3 neue Tests in `tests/tools/maker/ProjectBinding.test.ts` für die neuen Methoden.

---

## 2026-08-31 — Nachtrag: Kamera-Bookmarks

9 Slots (1-9), **links = springen, rechts = aktuelle Ansicht speichern** (Toolbar-Buttons `📷1`-`📷9`
und Tastenkürzel `1`-`9` / `Ctrl+1`-`9`), analog zu Unity/Unreal-Numpad-Bookmarks, nur auf
Maus-only übertragen. Belegte Slots werden per `.active`-Klasse visuell hervorgehoben.

- `OrbitCameraController.getView()`/`.setView()` (neu): Snapshot als eigenes `target`-Clone, damit
  spätere Kamerabewegung einen bereits gespeicherten Bookmark nicht rückwirkend verändert.
- **Bewusst nicht persistiert** — reines In-Memory-Feature für die laufende Maker-Session, kein
  Teil des glTF-Weltformats (keine `SW_*`-Extension dafür). Reine Navigations-Hilfe, kein
  Szeneninhalt, überlebt daher kein Neuladen.
- Live geprüft: Speichern/Springen über direkte Methodenaufrufe, echten Button-Klick
  (`.click()`) und echte Tastatur-Events verifiziert — Kamera-State nach Sprung war exakt der
  gespeicherte, eine zwischenzeitliche Kamerabewegung hat den Bookmark nicht verändert (beweist,
  dass der Snapshot unabhängig vom Live-`target` ist). `computer`-Tool-Rechtsklick/Zifferntasten
  simulierten in der Browser-Automation keine echten `contextmenu`/`keydown`-Events (bekannte
  Automations-Einschränkung, siehe Erinnerung zu rAF-Throttling) — über echte dispatchte
  DOM-Events lief alles korrekt.

---

## 2026-08-31 — Nachtrag: Duplicate / Group

**Ctrl+D** (Duplicate) und **Ctrl+G** (Group) implementiert, plus Buttons in der Toolbar.

- `Object3D.clone()` (neu, `src/core/Object3D.ts`): generischer Deep-Clone über
  `shallowCloneWithValueTypes()` (neu, `src/core/CloneUtils.ts`) — Prototyp-basiertes Shallow-Copy
  + automatisches Deep-Clone jedes `Vector3D`/`Quaternion`/`Color`-Feldes + frische `uuid`.
  Rekursiv für Children, `AbstractMaterial.clone()` fürs Material (eigene, gründlichere
  `clone()`-Overrides von `StandardMaterial`/`FrostglassMaterial` bleiben unangetastet und
  gewinnen), `Behavior.clone()` + `attachBehavior()` fürs Re-Attachment. `geometry`/Texturen
  bleiben bewusst geteilt (unveränderliche Daten, Standard-Praxis). `rigidBody` wird bewusst
  NICHT geklont (sonst würden zwei Objekte an einem physischen Body hängen).
  **Bekannte Lücke:** SkinnedMesh/Skeleton nicht speziell behandelt — Duplicate ist für
  Props/Lights/Prefab-Instanzen gedacht, Charakter-Rigs laufen über die Prefab/glTF-Pipeline.
- `MakerApp.duplicateObject()` / `.groupSelection()`: beide über `UndoStack`, gleiches Muster wie
  `addObject`/`deleteObject`/`reparent`. Group nimmt den alten Local-Transform des Objekts für die
  neue leere Parent-Gruppe, Objekt selbst wird auf Identity zurückgesetzt (Weltposition bleibt
  gleich) — Standard-Verhalten aus Blender/Unity. Vorerst nur Einzelobjekt (kein Multi-Select).
- Live im Browser verifiziert (`public/tools/maker.html`): Duplicate erzeugt unabhängige Kopie
  (Farbänderung an der Kopie beeinflusst das Original nachweislich NICHT), Group verschachtelt
  korrekt und setzt Kind-Transform auf 0/0/0 zurück, beide Undo-Pfade räumen sauber auf, Buttons
  UND Shortcuts geprüft, keine Konsolen-Fehler.

---

## 2026-08-31 — Nachtrag: GadgetInspector entschlackt (ADR 0010 §5)

Im Zuge der Branch-Hygiene fielen fünf tote Imports in `GadgetInspector.ts` auf
(`InspectorAudio`, `InspectorDeviceCaps`, `InspectorDiagnostics`, `InspectorGizmos`,
`InspectorSelection`) — Reste eines abgeschlossenen, aber nie zurück verdrahteten
"Extract Service"-Refactors aus dem gelöschten `god-objects-refactoring`-Branch.

**Erkenntnis:** Reines Service-Extrahieren reicht nicht — die extrahierte
`InspectorSelection.buildGUI()` war weiterhin 250 Zeilen `if ("roughness" in mat) ...`
Duck-Typing, nur in einer neuen Datei. Stattdessen: die vier unproblematischen Klassen
(Audio/DeviceCaps/Diagnostics/Gizmos) angeschlossen, `InspectorSelection` aber komplett auf
`collectInspectorSchema()` (den `Inspectable`-Reflection-Layer aus Phase 0, denselben den
Makers `PropertyPanel` schon nutzt) umgestellt. `GadgetInspector.ts`: 1037 → 479 Zeilen,
kein Duck-Typing mehr. Dabei echte Lücken in Material-/Light-Schemas geschlossen
(`alphaTest` auf Standard-/PhongMaterial, `wireframeMode` auf WireframeMaterial,
`distance`/`angle`/`penumbra`/`decay` auf SpotLight). Live im Browser verifiziert
(`and-now`/Flakturm-Tunnel-Szene): General Settings, Transform, Hierarchy-Navigation,
Behaviors, Light-Properties — alles fehlerfrei, keine Konsolen-Fehler.

**Warum das hier steht:** GadgetInspector ist laut ADR 0010 §5 nur ein "wird erst nach
Feature-Parität mit Maker abgelöst" — dieser Umbau bringt ihn architektonisch näher an
Maker heran (gleicher Reflection-Layer), ohne ihn zu ersetzen.

---

## 2026-08-31 — Session: Aufräumen & Fundament legen

**Branch:** `maker`

### Kontext
Maker war eine "abendliche Schnappsidee" ohne formales Konzept — aber mit
überraschend viel Substanz: Transform-Gizmo, Hierarchy, Property-Panel, Prefabs,
Autosave, Undo-Stack, ASCII-Map-Import und ein massiv ausgebauter GadgetInspector
(letzter Commit: +707 Zeilen).

Heute: Branch-Hygiene, Core-Änderungen isoliert nach `main` gemergt, Docs angelegt.

### Was passierte
- `god-objects-refactoring` und `god-objects-refactoring-bob` (lokal + remote) gelöscht.
- `maker`-Worktree aufgelöst → normaler Branch-Checkout.
- `Object3D.prefabSource?: string` (ADR 0010 Phase 2) aus `maker` nach `main` extrahiert
  und committed (`fd2d2ec6`).
- `GltfLoader.ts` + `WorldWriter.ts`-Änderungen bleiben in `maker` — sie sind eng an
  den Prefab-Workflow gekoppelt und gehören semantisch hierher.
- Concept Dossier (`concept-dossier.html`) und dieses Log angelegt.

### Stand der Features
| Feature | Status |
|---|---|
| Transform-Gizmo (translate/rotate/scale) | ✅ |
| Hierarchy-Panel | ✅ |
| Property-Panel | ✅ |
| Objekt-Palette (Geometrien) | ✅ |
| Prefab-Palette (Phase 2 / stamped copies) | ✅ |
| Autosave via File System Access API | ✅ |
| Undo-Stack | ✅ |
| ASCII-Map-Import | ✅ |
| GadgetInspector (massiver Ausbau) | ✅ |

### Offene Punkte / Nächste Schritte
- Behaviors auf Mehrfachauswahl anwendbar machen (bewusst nicht in der Multi-Select-Runde
  mitgemacht, siehe Nachtrag oben)
- Pivot-relativer Gruppen-Transform für Gizmo-Rotate/Scale bei Mehrfachauswahl (aktuell: gleicher
  Delta pro Objekt, kein "um gemeinsamen Punkt drehen")

**Update (2026-09-01):** Isolierter Prefab-Thumbnail-Render ist erledigt — siehe Nachtrag oben.

**Korrektur (2026-08-31):** "Licht-Platzierung" fälschlich als offen gelistet — Point-,
Directional- und AmbientLight sind bereits seit dem Phase-1-MVP-Commit (`cd9a608c`) Teil der
`ObjectPalette`. Dokumentationsfehler, kein nachträglich gebautes Feature.

**Update (2026-09-01):** Alle Punkte der ursprünglichen Roadmap-Liste sind jetzt erledigt
(Duplicate/Group, Kamera-Bookmarks, Prefab-Vorschau im Panel, Multi-Selektion). Die drei oben
genannten Punkte sind neu entdeckte, kleinere Ausbauschritte aus der heutigen Session, keine aus
der ursprünglichen Liste.

### Architektur-Notizen
- `MakerApp extends SmallWorldMachine` — Orchestrator, kein Monolith
- Soft-Delete via `_trashBin` (Off-Scene Object3D) verhindert GPU-Buffer-Disposal beim Undo
- `ProjectBinding` nutzt abstrakte Interfaces → vollständig testbar ohne Browser-FS
- ADR 0010 (docs/adr/0010-maker-editor-architecture.md) ist die Haupt-Referenz
- **Phase 0 (Fundament, 2026-08-30):** `Behavior.inspector`-Reflection-Pattern generalisiert →
  `Inspectable`-Interface (`src/core/Inspectable.ts`) + `collectInspectorSchema()`, jetzt über
  `Object3D`, alle Materialien und Lichter hinweg. Ersetzt die alte Drei-Wege-Aufteilung
  (hardcoded / duck-typed / deklarativ) durch einen generischen Panel-Renderer.
- **Bekannter Stolperstein — Circular-Import-TDZ:** `SmallWorldMachine` muss zwingend aus dem
  `core/index.js`-Barrel importiert werden, nicht direkt aus `./SmallWorldMachine.js`. Grund: die
  gesamte Renderer-Pipeline importiert selbst den Barrel, ein Direktimport als allererstes
  Modul im Graph kann `AbstractShowcase.ts`s `extends SmallWorldMachine` erreichen, bevor `SmallWorldMachine`s
  eigene Klassendeklaration gelaufen ist — realer, live im Browser reproduzierter TDZ-Crash,
  kein hypothetisches Risiko. Dokumentiert im Kopfkommentar von `MakerApp.ts`.

### Arbeitsvereinbarung
**"Blindflug":** Der User testet Maker bewusst nicht selbst, solange es sich vermeiden lässt —
meine eigene Live-Browser-Verifikation (claude-in-chrome) ist die einzige QA für dieses Projekt,
nicht nur eine Ergänzung. Vor jeder "Phase X fertig"-Meldung: so gründlich wie möglich live im
Browser testen, inklusive Gesten, die die Automation nicht direkt unterstützt (z.B. Right-Drag
für Orbit-Rotation via simulierte DOM-`MouseEvent`s mit `button:2`/`movementX/Y`, über einen
Frame gehalten). Explizit benennen, was sich tatsächlich nicht verifizieren ließ.

---

## 2026-09-01 — Phase 3 & Power-User Keyboard Workflow

**Phase 3 Konsolidierung & GadgetInspector-Ablösung:**
- Maker offiziell als Tool **T-08** in `public/index.html` und Rollup-Build (`vite.config.ts` $\rightarrow$ `js/tools/maker.js`) integriert.
- `GadgetInspector.ts`, `src/tools/inspector/*` (7 Module) und alle zugehörigen Tests/Guides vollständig physisch aus dem Tree gelöscht (-1.355 Zeilen Alt-Code). SmallWorldMachine-Engine-Loop und Showcases 15 & 16 bereinigt.

**Interaktions-Feinschliff & Power-User-Ergonomie:**
- **Scroll-Zoom-Entkopplung:** `wheel`-Event-Propagation auf Sidebars/Toolbars gestoppt, damit Scrollen in den Menüs nicht mehr den 3D-Viewport zoomt.
- **Plattformübergreifender Orbit:** Direkte `setPointerCapture`-Verarbeitung für kontinuierliches Dragging, gleichberechtigte Unterstützung für Rechtsklick (`button: 2`), Mittelklick (`button: 1`), `Alt + Drag` und Mac `Ctrl + Klick`.
- **Always-on-Top Gizmo-Rendering:** `depthTest: false` und `depthWrite: false` für alle Gizmo-Handles in `TransformGizmo.ts` – Achsen können nicht mehr im Inneren von Meshes verschwinden.
- **Snapping per Default & Grid-Stepping:** Snapping standardmäßig aktiv (`0.5m`). Schnelle Raster-Anpassung via **`[`** (feiner) und **`]`** (gröber) zwischen `0.1m` bis `2.0m`.
- **Snap to Ground:** **End**-Taste beamt markierte Objekte exakt mit ihrer Bounding-Box-Unterkante auf den Boden (`Y = 0`).
- **Camera-Cardinal Keyboard Nudge:** Pfeiltasten steuern Move, Rotate (im <kbd>E</kbd>-Modus oder mit <kbd>Alt</kbd>) und Scale (im <kbd>R</kbd>-Modus oder mit <kbd>Alt+Shift</kbd>). Verschiebung auf dem XZ-Bodenraster berechnet in Echtzeit den dominanten Kardinalvektor der Kamera, sodass $\rightarrow$ und $\uparrow$ immer 1:1 der sichtbaren Bildschirm-Richtung entsprechen.
- **Live-Verifikation:** Alle 15 Kern-Aktionen vollautomatisch in headless Chrome mit WebGL2 verifiziert (15/15 bestanden). 626/626 Unit-Tests grün.

---

## 2026-09-01 — Maker Pro-Feature Referenz- & Benutzerdokumentation

Vollständiges Handbuch und Referenzdokumentation für Power-User & Digital Artists ausgearbeitet:
- **`docs/guides/maker.md`:** Umfassender Pro-User-Guide mit detaillierter Erläuterung aller Profi-Features:
  - *Camera-Cardinal Nudging* (Kamera-abhängige Richtungsnavigation via Pfeiltasten & Modifier)
  - *Dynamic Grid Stepping* (`[` / `]` und `0.1m`–`2.0m` Snapping-Presets)
  - *Snap to Ground* (<kbd>End</kbd> / `⬇ Ground` Bounding-Box-Bottom-Alignment auf $Y = 0$)
  - *Marquee Selection & Pivot-Cluster-Transforms* (2D-Lasso, Cyan/Amber Highlighting, Gruppen-Transforms um das Primary-Objekt)
  - *Always-on-Top Gizmos* (`depthTest: false`)
  - *Prefab-Pipeline mit isolierten 3D-Thumbnails*
  - *glTF 2.0 Autosave & SW_* Extension Engine*
  - *Master Keyboard Shortcuts Reference Table*
- **`src/tools/maker/docs/concept-dossier.html`:** Visual Dossier auf Phase 3 und den aktuellen Pro-Feature-Stand synchronisiert.

---

## 2026-09-02 — Unified Object Renaming (Hierarchy Inline Edit & Property Panel)

Vollständige, bidirektionale Unterstützung für das Umbenennen von Objekten in der Szene nach Industriestandard (Unity/Blender/Figma):
- **Schema-Erweiterung:** `Object3D.inspector` deklariert `name: { type: "string", label: "Name" }` als oberstes Feld im Inspector.
- **Hierarchy Inline-Renaming:** Doppel-Klick auf eine Zeile in der Hierarchy oder Drücken der Taste <kbd>F2</kbd> (bei selektiertem Objekt) verwandelt die Zeile in ein nahtloses `<input>`-Feld.
  - <kbd>Enter</kbd> / `blur` bestätigt die Umbenennung.
  - <kbd>Escape</kbd> bricht ab.
  - Tastatur-Shortcuts (W, E, R, X, Delete, Arrows) werden während der Texteingabe isoliert und nicht mehr versehentlich getriggert.
- **PropertyPanel Sync & Header-Interaktion:**
  - Direktes Editieren des `Name`-Feldes im Property Panel aktualisiert synchron den Header (`_titleFolder.title`) und die Hierarchy.
  - Doppel-Klick auf den Titel-Header im Property Panel fokussiert und selektiert automatisch das Name-Input-Feld.
- **Undo/Redo Integration:** Jede Namensänderung (egal ob via Hierarchy, <kbd>F2</kbd> oder PropertyPanel) erzeugt atomare Undo-Schritte auf dem `UndoStack`.
- **Status:** 112 Test-Dateien, 630 Tests, Build & Lint 100% grün.

---

## 2026-09-02 — Hierarchy Search & Live Filter (Ctrl+F)

Blitzschnelle Live-Objektsuche im Szenenbaum nach Industriestandard (Unity/Unreal/Blender Outliner):
- **Search Header Bar:** Schlankes Suchfeld `[ 🔍 Filter objects... (Ctrl+F) ]` sticky über der Hierarchy-Baumstruktur.
- **Echtzeit-Filterung:** Filtert während des Tippens den gesamten Szenenbaum (Match auf Objekt- oder Kind-Namen).
- **Keyboard-Workflow (<kbd>Ctrl+F</kbd> / <kbd>Cmd+F</kbd>):**
  - <kbd>Ctrl+F</kbd> springt direkt in das Suchfeld und markiert den Text.
  - <kbd>Enter</kbd> selektiert direkt das erste passende Objekt im 3D-Viewport und in der Hierarchy.
  - <kbd>Escape</kbd> leert den Suchfilter, stellt den vollen Szenenbaum wieder her und setzt den Fokus zurück in den Viewport.
- **Status:** 112 Test-Dateien, 631 Tests, Build & Lint 100% grün.

---

## 2026-09-02 — Categorized Icon Matrix Palette (Primitives, Lights, Structure & Behaviors)

Vollständige Überarbeitung der Objekt-Palette vom Textlisten-Design zur kompakten, ergonomischen 4-Spalten-Icon-Matrix nach Unreal/Figma-Vorbild:
- **3D Primitives (8 Formen):** Cube 🧊, Sphere ⚪, Cylinder 🥫, Plane ⏹️, Capsule 💊, Cone 📐, Torus 🍩, Pyramid 🔺.
- **Lights (4 Lichtarten):** Point Light 💡, Directional Sun Light ☀️, Spot Light 🔦, Ambient Light 🌐.
- **Structure (1 Helfer):** Empty Group Node 📁.
- **Behaviors (6 Verhalten):** Rotator 🔄, Hover 🛸, Bobbing 🌊, Pulse 💓, LookAt 👁️, Flicker ⚡.
- **UI & Ergonomie:**
  - Kompakte 44px-Tiles mit Icon + Sub-Label und Hover-Tooltips.
  - Spart über 65% vertikale Panelhöhe und eliminiert vertikales Scrollen in der linken Leiste.
  - Sofortige taktile Rückmeldung mit Hover-Glow und Active-Press-Feedback.
- **Status:** 112 Test-Dateien, 632 Tests, Build & Lint 100% grün.

---

## 2026-09-02 — 3D Light Gizmos, Viewport Glyphs & Dynamic Range Bounds

Vollständige 3D-Lichtrepräsentation und Direkt-Interaktion nach Industriestandard (Unity/Unreal/Blender):
- **Visual Glyphs (Editor-Marker):**
  - PointLight 💡: Leuchtender Oktaeder-Kern, Kamera-ausgerichtet (Billboard) in Lichtfarbe.
  - DirectionalLight ☀️: Sonnen-Kugel mit 3D-Richtungspfeil entlang des Lichtvektors.
  - SpotLight 🔦: Emitter-Kegel in Strahlrichtung.
  - AmbientLight 🌐: Zarte Drahtgitter-Sphäre.
- **3D-Raycasting & Selektion:** Lichter können im 3D-Viewport direkt per Klick ausgewählt, verschoben (<kbd>W</kbd>) und rotiert (<kbd>E</kbd>) werden.
- **Wirkungsbereich (Selection Bounds):**
  - Bei Selektion eines `PointLight` wird die Attenuations-Reichweite (`distance`) als Wireframe-Kugel gezeichnet.
  - Bei Selektion eines `SpotLight` wird der exakte Öffnungswinkel (`angle`) und Reichweite als Drahtgitter-Kegel dargestellt (skaliert live mit Inspector-Werten).
- **Editor-Only Isolation:** Alle Light-Helper sind vom glTF-Export und Play-Modus vollständig isoliert.
- **Status:** 112 Test-Dateien, 633 Tests, Build & Lint 100% grün.

---

## 2026-09-02 — Player SpawnPoint (1.8m Silhouette & Direction Indicator)

Einführung des `SpawnPoint`-Elements als First-Class-Knoten im Szenengraph und in der Maker-Palette:
- **`SpawnPoint` (Core-Entität):** Erweitert `Object3D` mit `tag` (z.B. `"bunker_entrance"`) und `spawnRadius`.
- **Visuelle Repräsentation (1.8m Drahtgitter-Kapsel):**
  - Smaragdgrüne Kapsel ($1.8\text{m}$ Höhe, $0.35\text{m}$ Radius) dient sofort als perfekter Maßstabs- und Größenvergleich beim Levelbau.
  - Kegel-Richtungspfeil an der Vorderseite zeigt die exakte Blickrichtung (Forward-Vektor $-Z$) des Spielers beim Levelstart an.
- **Status:** 112 Test-Dateien, 633 Tests, Build & Lint 100% grün.

---

## 2026-09-02 — Smart Viewport-Center Spawning & Automatic Floor-Resting

Intelligente Platzierung neu erzeugter Objekte nach Industriestandard (Blender 3D Cursor / Unity Scene Focus View):
- **Kein Spawnen mehr bei $(0, 0, 0)$:** Neu hinzugefügte Objekte landen nicht mehr unbemerkt im Weltursprung oder hinter der Kamera, sondern **direkt im aktuellen Fokus-Zentrum des Viewports** (`this._orbit.target` / Blick-Schnittpunkt mit der Bodenebene $Y = 0$).
- **Automatisches Aufsetzen auf den Boden (Zero In-Ground Clipping):**
  - Meshes (Würfel, Kugel, Zylinder, Kapsel, SpawnPoint etc.) berechnen ihren Bounding-Box-Bottom und sitzen mit ihrer Unterkante exakt bündig auf $Y = 0$ auf (z.B. Würfel-Mittelpunkt bei $Y = 0.5$).
  - Lichter werden automatisch in ergonomischer Arbeitshöhe platziert (PointLight: $Y = 2.0\text{m}$, SpotLight: $Y = 3.0\text{m}$, Sun: $Y = 5.0\text{m}$).
- **Status:** 112 Test-Dateien, 634 Tests, Build & Lint 100% grün.

---

## 2026-09-02 — Behavior Removal & Inspector 3-Dots Context Menu (Unity/Blender Style)

Erweiterung des Property Inspectors um ein direktes Abkoppeln von Behaviors nach Industriestandard (Unity/Blender Component Actions):
- **Kompakter `⋮`-Button im Ordner-Header:** Jedes zugewiesene Behavior besitzt in der Titelleiste rechts einen dezenten 3-Punkte-Button (kostet $0$ vertikale Extra-Zeilen).
- **Kontextmenü mit `🗑️ Remove Behavior`:** Klick auf `⋮` öffnet ein schwebendes Dropdown-Menü zur gezielten Verwaltung der Komponente.
- **Sauberes Abkoppeln:** Ruft `detachBehavior(obj.behaviors, behavior)` auf, bereinigt den Host-Status und triggert `behavior.onDetach()`.
- **Volle Undo/Redo- & Autosave-Unterstützung:**
  - Klick auf Entfernen erzeugt einen atomaren Schritt auf dem `UndoStack`.
  - <kbd>Ctrl+Z</kbd> stellt das Behavior samt all seinen zuvor konfigurierten Werten (Speed, Axis, Duration etc.) synchron wieder her.
- **Status:** 112 Test-Dateien, 635 Tests, Build & Lint 100% grün.

---

## 2026-09-02 — Full Material Management (Switch, Reset, Remove & Add)

Vollwertige Materialverwaltung im Property Inspector nach Industriestandard (Blender/Unity):
- **3-Punkte-Menü (`⋮`) im Material-Header:**
  - `🎨 Switch Material`: Schneller Wechsel zwischen PBR (`StandardMaterial`), Unlit (`BasicMaterial`), `WireframeMaterial`, `GlassMaterial` und `PhongMaterial`.
  - `🔄 Reset to Defaults`: Setzt alle Material-Uniforms (Farbe, Roughness, Metalness) auf Standardwerte zurück.
  - `🗑️ Remove Material`: Entfernt das Material sauber vom Objekt (z.B. für unsichtbare Collider/Trigger).
- **`[ ➕ Add Standard Material ]`-Button:** Wenn ein Mesh kein Material besitzt, wird ein eleganter Hinzufügen-Button gerendert.
- **Status:** 112 Test-Dateien, 636 Tests, Build & Lint 100% grün.

---

## 2026-09-02 — Multi-Column Property Layout, Vector3 Trios & Compact Control Pairs

Massive Verdichtung und Ergonomie-Optimierung des Property Inspectors nach Vorbild von Unity und Blender:
- **Transform-Trios ($X, Y, Z$ in 1 Zeile statt 3):**
  - `Position`: $X [ ] \; Y [ ] \; Z [ ]$
  - `Rotation`: $X [ ] \; Y [ ] \; Z [ ]$
  - `Scale`: $X [ ] \; Y [ ] \; Z [ ]$
  - Spart alleine im Transform-Bereich **6 volle Zeilen Höhe** ein!
- **Kompakte Boolean-Pärchen (`.maker-prop-row`):**
  - `Shadows`: `[x] Cast Shadow` | `[x] Recv Shadow`
  - `Depth Buffer`: `[x] Depth Test` | `[x] Depth Write`
- **Gepaarte Zahlenfelder & Sliders:**
  - `PBR Surface`: `Metallic [ 0.00 ]` | `Roughness [ 0.50 ]`
  - `Light Attenuation`: `Distance [ 10.0 ]` | `Decay [ 2.0 ]`
  - `SpotLight Cone`: `Angle [ 45° ]` | `Penumbra [ 0.1 ]`
- **Schema-gesteuert via `row`-Attribut:** Beliebige Properties im `static inspector` können mit `row: "..."` automatisch horizontal nebeneinander gerendert werden.
- **Status:** 112 Test-Dateien, 637 Tests, Build & Lint 100% grün.

---

## 2026-09-29 — Content Drawer (UE5-Style Asset Browser) + Flakturm-Texturproduktion

Erster Baustein eines industrietauglichen Asset-Workflows im Maker, angelehnt an Unreal Engines Content-Browser-Konzept:
- **Neuer `ContentDrawer` (`packages/tools/src/maker/ContentDrawer.ts`):**
  - Andockbare, per Resizer höhenverstellbare Bottom-Drawer-Leiste mit `Ctrl/Cmd+Space`-Kurzbefehl und Pin-Modus.
  - Zwei-Spalten-Navigation: hierarchischer Ordnerbaum (Kits, Materials, Decals, Primitives, Lights, Prefabs) + Live-Asset-Raster.
  - Sofortsuche, Typ-Filter-Pills (Props, PBR Materials, Decals, Primitives, Lights, Prefabs).
  - **Nativer HTML5-Drag & Drop direkt auf den 3D-Viewport** mit Ground-Plane-/Scene-Raycasting, Doppelklick-Platzierung und Auto-Close nach Drop (ausser gepinnt).
  - Textur-Drop trifft das angeklickte Objekt (Material-Zuweisung), Asset-Platzierung erfolgt am Raycast-Hitpunkt.
- **MakerApp-Integration:** Eigene `KitRegistry`-Instanz, `contentDrawer`/`kitRegistry`-Accessors und Callback-Bridge (Prop-Load, Primitive/Objekt-Erzeugung, Textur-Applikation, Decal-Erzeugung, Prefab-Instanziierung, Raycast).
- **Kit-Inspector-Decal-Preview:** Seitenverhältnis-getreue Ebene (Aspect aus dekodiertem Bild statt Verzerrung), `flipY`, transparentes beidseitiges Material (`CullMode.NONE`), Kamera-Framing. Kit-/Such-Filter wirken nun konsistent auf Zählungen und leere Zustände.
- **KitRegistry-Härtung:** `manifest.items` null-safe in `getPropMeta`/`loadProp`.
- **Flakturm:** Neues `travertine`-PBR-Set (albedo/ao/normal/roughness) über den reworkten `pbr.sh`; `brick_aged` mit nachgeschärftem AO regeneriert.
- **Status:** 201 Test-Dateien, 1191 Tests, Build & Lint 100% grün.

---

## 2026-10-13 — Big Merge: Implementierungsstart (M1 Shell-Bootstrap & M2 Headless-Core)

Der Umsetzungsplan **`.agents/collaborate/big-merge.md`** (Konsens 4/4, Findings F1–F6 verbindlich) ist
freigegeben und die Implementierung beginnt. Der Maker wird die eine App-Shell für alle Autoren-Werkzeuge;
diese Session legt dafür die Grundlagen — die Werkzeug-Verschmelzung selbst (M3+) folgt in späteren
Meilensteinen.

- **M1 — Shell-Bootstrap (parallel, Implementierungs-Agent):** Dedizierter `ToolMode`-Lifecycle-Vertrag
  (mount/unmount/state) plus Mode-/Hash-Router und Panel-Host in `MakerApp`; `maker.html` erhält einen
  Mode-Launcher. Keine Tool-Datei-Umzüge, keine Seitenänderungen — Legacy-URLs funktionieren unverändert.
- **M2 — Headless-Core-Extraktion (parallel, Implementierungs-Agent):** Per-Tool-`core/*`-Slices (Sprite,
  Pixler-Ops, Map-Def-Converter, Material-Map-Pipeline) ohne Verhaltensänderung,
  gemeinsame `core/pipeline/`-Infrastruktur mit `RasterIO` (Codec-Grenze F5), Purge
  `MapGenerator.loadFromImage` (F1) und Grep-Gate (0 Treffer `getContext|document\.|window\.` unter
  `core/`). Barrels re-exportieren kompatibel weiter.
- **Dokumentations-/Domain-Anteil (diese Session):** ADR-Entwürfe **0030** (Maker-App-Shell, `ToolMode`
  statt `ForgeTool`, Entry-Aliases) und **0031** (Headless-Kern & CLI-Grenze) als DRAFT angelegt;
  `CONTEXT.md` um die Begriffe **Maker-Mode/ToolHost**, **Workspace/Project** (noch nicht implementiert)
  und **Headless Operation** ergänzt; CHANGELOG-Impl-Notiz und `backlog.md`-Sessioneintrag angehängt.
- **Abnahmevermerk:** Die Runtime-Browser-Verifikation steht für diese Meilensteine noch aus — sie erfolgt
  erst über die meilensteinübergreifenden Gates/Abnahme (Plan §9, Verifikationsstrategie §8), nicht in dieser
  Session. Implementations-Arbeitsstand ist code-seitig, Live-Browser-Verhalten (Mode-Router, Re-Export-
  Kompatibilität) ist erst in den Gates zu prüfen.
- **Review & Abnahme (Round 2 nach Umzug ins Worktree `small-world-machine-bigmerge`):** Alle Implementierungs-
  Gates grün (lint, typecheck, build:lib, 283 Dateien/1889 Tests) auch im Worktree; Grep-Gate F1 `core/` DOM-frei.
  Unabhängige Review-Runde (Dave, Checkliste `big-merge-review-checklist.md`): `[VERIFICATION_PASSED]`, 0 P0/P1,
  nur 2 P2 (P2-F1 Splatter-Core-Angabe in der M2-Bullet korrigiert; P2-F2 Web-`RasterIO`-Adapter auf M5
  verschoben). Board `big-merge-impl` resolved (Konsens 4/4), `[ABNAHME_ERTEILT]`. Mit Patch `80baf2a8`
  ("Every tool carries with it the spirit by which it has been created.") auf Branch `big-merge` committet.
  Runtime-Browser-Verifikation im Worktree-Dev-Server erledigt: Maker-Seite mit verschmolzenem Header und
  Mode-Launcher (World aktiv, übrige Modes disabled bis M3+), Router schaltet auf `#world`, 0 Fehler/0 Warnungen.










