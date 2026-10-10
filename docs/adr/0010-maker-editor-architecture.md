# Maker: Weltformat & Editor-Architektur

## Kontext & Problem

Small World Machine hat sich ein reichhaltiges Laufzeit-Objektmodell erarbeitet (19 Geometrie-Primitive, 16 Materialien, 5 Lichttypen, ~20 Behaviors), aber es gibt keine Möglichkeit, eine Szene zu *komponieren* oder zu *persistieren*, außer TypeScript von Hand zu schreiben. `GadgetInspector` (`src/tools/GadgetInspector.ts`) ist das bislang nächstliegende Werkzeug — ein Tweakpane-basiertes Overlay, das per Raycast ein Live-Objekt auswählt und dessen Transform-/Material-/Licht-/Behavior-Eigenschaften bearbeitet —, aber seine eigene Dokumentation (`docs/guides/gadget-inspector.md`) listet genau die Lücken auf, die ihn daran hindern, ein echter Editor zu werden:

- **Keine Persistenz** — `getState()`/`setState()` sind explizite No-Op-Stubs; Bearbeitungen verschwinden beim Neuladen.
- **Kein Export** — keine Möglichkeit, eine Szene wieder als Daten auszugeben.
- **Kein Undo/Redo.**
- **Keine Objekterzeugung/-platzierung** — es bearbeitet ausschließlich bereits vorhandene Objekte.
- **Kein Picking-Index** — Raycasts gegen jedes Objekt im Szenengraph bei jedem Klick.
- **Keine Kamerasteuerung** — die übergebene Kamera dient nur dazu, den Raycaster zu speisen.

Es hat außerdem ein Skalierungsproblem darin, wie es Eigenschaften erkennt: `Behavior` besitzt ein echtes, funktionierendes Reflection-Muster (`static readonly inspector?: Record<string, InspectorField>`), das `GadgetInspector` generisch ausliest. Materialien und Lichter erhalten keine solche Behandlung — sie werden über handgeschriebene `if ("roughness" in mat) matFolder.addBinding(...)`-Duck-Typing-Ketten offengelegt, und die eigenen Transform-/Sichtbarkeits-Felder von `Object3D` sind direkt in `_buildGUI()` hartkodiert. Drei verschiedene Mechanismen für dieselbe Aufgabe; eine neue Materialeigenschaft erfordert heute eine neue Zeile in `GadgetInspector.ts`, statt automatisch erkannt zu werden.

Getrennt davon existiert nirgends im Engine-Kern eine Serialisierungsschicht — der einzige zu `serialize` benachbarte Treffer in der Codebasis ist unzusammenhängend (`ThreadPool`). Der Aufbau einer In-Game-/In-Editor-Content-Pipeline (**Maker**) erfordert die Lösung beider Probleme: eine Szene braucht ein echtes Dateiformat, und das Eigenschaftensystem muss tatsächlich dynamisch sein statt von Hand gepflegt zu werden.

## Entscheidung

### 1. Die Reflection-Schicht verallgemeinern, nicht auf Behavior beschränkt lassen

Das bei `Behavior` bereits bewährte `InspectorField`/`static inspector`-Muster wird zum gemeinsamen Vertrag für jede editierbare Klasse: `AbstractMaterial`, `AbstractLight`, Geometrien und `Object3D` selbst (dessen Transform-/Sichtbarkeits-/Schatten-Felder von hartkodierten UI-Aufrufen zu einem deklarativen Basis-Schema wechseln). Ein generischer Panel-Renderer ersetzt die heutige Dreiteilung aus hartkodierter/duck-typed/deklarativer Eigenschaften-Offenlegung. Das ist additiv und abwärtskompatibel — bestehende `Behavior.inspector`-Deklarationen funktionieren unverändert weiter.

### 2. Weltformat = glTF 2.0 + ein `SW_*`-Erweiterungs-Namensraum, kein neues Format von Grund auf

Szenen werden als glTF-2.0-JSON persistiert (Node-Hierarchie, Transforms, PBR-Materialien, `KHR_lights_punctual`-Lichter, Kameras), wobei `packages/engine/src/loaders/GltfLoader.ts` als Lese-seitiges Fundament wiederverwendet wird — es parst bereits das `extensions`-Objekt (aktuell nur `KHR_materials_emissive_strength`). Small-World-Machine-spezifische Daten ohne glTF-Äquivalent (Behaviors und ihre Parameter, Physik-Konfiguration, Nicht-PBR-Materialfelder) werden in Vendor-Extension-Objekten unter einem `SW_*`-Präfix transportiert — genau der Mechanismus, den Khronos für diesen Fall vorgesehen hat. Ein begleitender `WorldWriter` wird neben `GltfLoader` ergänzt, um den lebenden `Scene`/`Object3D`-Graph zurück in diese Form zu serialisieren.

Verworfene Alternativen:
- **Ein eigens entworfenes, individuelles JSON-Schema**: mehr Kontrolle, erfindet aber ein Szenengraph-Format neu, das die Branche längst standardisiert hat, verzichtet auf Interop mit Blender/DCC-Tools und verlangt einen von Grund auf gebauten Parser/Writer statt der Erweiterung von `GltfLoader`.
- **YAML**: verworfen aufgrund konkreter Präzedenzfälle, nicht aus Geschmack — Unitys `.unity`/`.prefab`-Dateien sind YAML, und das ist eine bekannte Quelle für Merge-Konflikt-Schmerzen (Unity liefert extra ein "Smart Merge"-Tool, um damit klarzukommen), dazu YAMLs Skalar-Inferenz-Mehrdeutigkeiten (das "Norwegen-Problem": `no`/`off`/`on` werden je nach Parser/Version als Booleans interpretiert).
- **TOML**: für flache Konfiguration in Ordnung, aber unlesbar für tief verschachtelte Szenengraph-Bäume (Array-of-Tables-Syntax).
- **USD**: die "größte" Antwort der Branche (unterstützt von Pixar/Apple/NVIDIA), aber ein Kompositionssystem in C++-Größenordnung, das der "Leichtgewicht statt Umfassend"-Philosophie von `VISION.md` widerspricht — außerhalb des Rahmens für eine Engine dieser Größe.

### 3. Maker erscheint als eigenständige Seite, nicht als angedocktes Forge-Werkzeug

Dem bestehenden Vorbild von `public/tools/pixler.html`, `map-gen.html` und `xtractor.html` folgend (eigenständige Asset-Bearbeitungs-Workflows, die keine laufende Spiel-Canvas benötigen), erhält Maker `public/tools/maker.html`. Das entspricht seinem tatsächlichen Umfang — das Komponieren ganzer Umgebungen, nicht nur das Live-Anpassen einer bereits laufenden Szene — und erfordert nicht, dass zuerst eine `SmallWorldMachine`-Instanz existiert.

### 4. Kein expliziter Speichern-Button — Autosave, Undo-first-UX

Jede Eigenschaftsbearbeitung: (a) wird sofort live auf die Szene im Speicher angewendet, (b) wird auf einen Undo/Redo-Befehlsstapel gelegt (Wiederverwendung des bereits in `Pixler`s "vollständiger Undo/Redo-Historie" bewährten Musters), (c) löst ein entprelltes (~500 ms) Durchschreiben in den gebundenen Projektordner über die File System Access API aus (`showDirectoryPicker`/`FileSystemFileHandle`). Kein modaler "Speichern"-Dialog für gewöhnliche Bearbeitungen; ein "Ungespeicherte Änderungen"-Indikator übernimmt die Rolle, die ein Titelleisten-Punkt unter macOS spielt. Cmd+S bleibt als expliziter Fallback-/Export-Pfad für Browser ohne Unterstützung der File System Access API verfügbar.

### 5. GadgetInspector wird erst nach Funktionsparität abgeschaltet, nicht am ersten Tag

Das Auswahl-→-Eigenschaftspanel-Interaktionsmodell von `GadgetInspector` ist korrekt und bleibt konzeptionell bestehen; seine Implementierung wird schrittweise abgelöst, sobald Makers verallgemeinertes Panel, Picking-Index und Undo-System einsatzbereit sind. `GadgetInspector.ts` wird gelöscht und `enableInspector`/der Forge-Hub erst dann auf Maker umgebogen, wenn Maker seine dokumentierte Feature-Liste abdeckt (Persistenz, Export, Undo/Redo, Erzeugung, Picking-Index, Kamerasteuerung) — ein expliziter Abnahme-Gate, keine Annahme.

### Stufenweise Umsetzung

0. **Fundament** — verallgemeinerte Reflection-Metadaten über Materialien/Lichter/Geometrie/`Object3D`; minimaler glTF+`SW_*`-Roundtrip (Transform-Baum + ein Material + ein Licht) mit Tests.
1. **Maker MVP** — eigenständige Seite, Edit-Mode-Kamera, Hierarchie-Panel mit echtem Reparenting, generisches Eigenschaftspanel, Objekterzeugungs-Palette (bestehender Geometrie-/Material-/Licht-/Behavior-Katalog, nichts Neues zu bauen), File-System-Access-Autosave, Undo/Redo.
2. **Umgebungs-Maßstab** — Viewport-Transform-Gizmos (Translate-/Rotate-/Scale-Handles, nicht nur numerische Felder), verschachtelte/instanzierte Unterszenen (Prefab-Äquivalent, z. B. eine wiederverwendbare Flakturm-Zone oder das Diorama-Requisiten-Set), eine Brücke zu `MapGenerator`s bestehender ASCII-/`GridLevelBuilder`-Pipeline.

3. **Konsolidierung (Ausgeliefert)** — Paritätsprüfung gegen das Gate aus §5 bestanden (vollständige Persistenz, Export, Undo/Redo, Erzeugung, Picking, Lesezeichen, Transform-Gizmos, Snapping, Rahmen-Auswahl). Maker ist integriert in `public/index.html` (T-08), `vite.config.ts`, die Forge-Werkzeuglisten und die Dokumentation. `GadgetInspector.ts` und seine Hilfsmodule sind abgeschaltet und aus dem Quellbaum gelöscht.

## Konsequenzen

- **Autosave nur unter Chromium.** Die File System Access API hat heute keine Firefox-/Safari-Unterstützung. Akzeptiert als bewusster Umfangs-Trade-off für ein Entwickler-Werkzeug, kein Blocker — Maker funktioniert dort weiterhin über manuellen Export, wo die API fehlt.
- **glTF-Ausführlichkeit.** glTFs Schema ist auf Asset-Austausch optimiert, nicht darauf, dass "der Editor alle 500 ms ein minimales Diff schreibt" — es ist starrer/ausführlicher, als es ein eigens entworfenes Schema wäre. Akzeptiert im Austausch für die Wiederverwendung von `GltfLoader` und kostenlose Interop mit Blender und anderen DCC-Tools.
- **Erweiterungs-Namensraum-Disziplin erforderlich.** `SW_*`-Erweiterungsschlüssel müssen additiv und sorgfältig namensraum-getrennt gehalten werden, sonst könnte eine künftige glTF-Spec-Revision mit Vendor-Daten kollidieren — Standard-glTF-Erweiterungshygiene, keine neue Risikoklasse.
- **Migrationskosten für bestehende, von Hand verfasste Szenen.** Showcases/Apps, die direkt in TypeScript gebaut sind, sind nicht betroffen (Maker ist additives Tooling); nur Inhalte, die *durch* Maker verfasst werden, nutzen das neue Format.
- **`GadgetInspector` abgeschaltet.** Vollständig durch Maker ersetzt. Szeneninspektion und -erstellung teilen sich jetzt eine einzige, vereinheitlichte Reflection-Schicht (`Inspectable`) und einen gemeinsamen Workflow.
