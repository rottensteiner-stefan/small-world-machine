# Was die Welt im Innersten zusammenhält: Wie speichern wir eine ganze Anwendung?

> **Stand:** 2026-09-29 · **Anlass:** Die Demo-App *The Whisper* wächst (Levels, Figuren, eigener Code, Kits) und die Frage „Wohin mit dem allen?" ist nicht mehr nebenbei zu beantworten.
> **Art:** Research-Papier mit Empfehlung, **kein** ADR. Aus den Empfehlungen in Abschnitt 9/10 können später ADRs werden (siehe Abschnitt 12).
> **Methode:** Vier parallele Recherchen (Engine-Formate, Branchen-Legenden/Praxis, Uni-Theorie/Lehre, Web-Plattform) plus Ist-Aufnahme des Repos. Jede Aussage über Dritte trägt einen Verlässlichkeits-Marker (siehe unten).
> **Nachtrag (2026-09-29, nach §12a):** Ergänzende Recherche in vier Auftraggeber-Schwerpunkten (moderne Praxis-Layer, Audio-Pipeline, Savegame-Interop, Web-/glTF-Ökosystem-Status) in **[§15](#15-anhang-ergänzende-recherche-2026-09-29-nach-12a)**. Der Haupttext bleibt unverändert; wo §15 einen früheren Status überholt, ist das explizit markiert.
> **Nachtrag (2026-09-30, Ideensammlung):** Dokumentation der Auftraggeber-Idee „Wie bauen wir aus Engine-Bausteinen ein fertiges Spiel zusammen und wie liefern wir es aus?" — als Kompass/North-Star (**keine** Entscheidungen, kein Bauvorhaben) in **[§16](#16-anhang-ideensammlung-zielbild-composition--export-2026-09-30)**.

---

## 0. Lesehilfe

### Verlässlichkeits-Marker

| Marker | Bedeutung |
| :--- | :--- |
| **[V]** | In dieser Recherche gegen eine Primärquelle (Doku, Quellcode, Spec, Originalartikel) geprüft. |
| **[S]** | Nur aus Suchergebnis-Zusammenfassung / Sekundärquelle bestätigt. |
| **[U]** | *Unverified* — aus allgemeinem Fachwissen, in dieser Session nicht nachgeprüft. Vor Zitat prüfen. |

Wörtliche Zitate stehen nur dort, wo sie im Original gefunden wurden. Alles andere ist paraphrasiert.

### Ehrliche Lücken (vorab)

- Zu Naughty Dog, Guerrilla/Horizon, Halo, Destiny, Frostbite fand sich **keine** lesbare Primärquelle. Sie tauchen hier bewusst nicht als Belege auf.
- Für Jonathan Blows *inhaltliche* Position zu Daten/Code-Packaging fand sich keine Primärquelle. Für Jason Gregory und Glenn Fiedler nur Inhaltsverzeichnis-Titel, keine Buchinhalte.
- Mehrere Primärseiten (Our Machinery, doomwiki, UESP) waren nicht abrufbar; dort gilt **[S]**.

---

## 1. Die Frage präzisieren

„Wie speichern wir eine gesamte Anwendung?" hat mindestens **acht** verschiedene Antworten, je nachdem, welche Schicht man meint. Ohne diese Trennung redet man aneinander vorbei:

| # | Schicht | Frage | Beispiel bei The Whisper |
| :-: | :--- | :--- | :--- |
| 1 | **Manifest** | Was *ist* diese Anwendung, was gehört dazu, was ist der Einstieg? | heute: nichts — implizit in `vite.config.ts` |
| 2 | **Code** | Wo wohnt der eigene Code, wie wird er geladen, was darf er? | `prologue.ts` (1336 Zeilen), `showcase.ts` (1917/1035 Zeilen), `OilSlickMaterial.ts` |
| 3 | **Welt-Daten** | Levels, Szenen, Platzierungen | `koje42.level.json`, `kaeltekammer.level.json` |
| 4 | **Entitäten/Figuren** | Charaktere, Rigs, Animationssets, NPC-Definitionen | `raw/mannequin/*`, `public/assets/the-whisper/mannequin/*` |
| 5 | **Assets** | Meshes, Texturen, Audio — Quelle vs. Laufzeitform | `public/assets/kits/*` (1,4 GB), `raw/` (31 MB) |
| 6 | **Konfiguration/Inhalt** | Dialoge, Story, Balancing, Texte | `docs/story.md` (Doku, nicht Laufzeit), Terminal-Texte im Code |
| 7 | **Laufzeitzustand** | Savegame, Fortschritt, Einstellungen | existiert nicht |
| 8 | **Distribution** | Wie kommt das Ganze zum Spieler, versioniert, gecacht? | Vite Multi-Page-Build, manuell in `vite.config.ts` registriert |

Und drei **Zustandsformen**, die jede reife Engine trennt (siehe Abschnitt 3, 4):

- **Authored** — was Menschen und Editor bearbeiten: diffbar, stabil, klein (JSON, glTF, PNG-Quellen).
- **Cooked/Built** — was die Laufzeit lädt: gehasht, komprimiert (KTX2, meshopt), regenerierbar, **nicht** eingecheckt.
- **Runtime/Saved** — was der Spieler erzeugt: Savegame, versioniert *unabhängig* vom Inhaltsformat.

> **Kernthese dieses Papiers:** Die Frage „Was hält die Welt zusammen?" ist im Kern die Frage nach **drei Dingen**: (1) stabilen **IDs**, (2) einer **Schichtung (Layering) mit Überschreibregel**, (3) einem **Manifest**, das beides benennt. Alles andere (Ordnerlayout, Archivformat, Editor) ist Ableitung.

---

## 2. Ist-Zustand in Small World Machine (Aufnahme 2026-09-29)

### 2.1 Wo liegt was?

| Ding | Ort | Größe/Umfang | Anmerkung |
| :--- | :--- | :--- | :--- |
| Szenen-Controller (Code) | `apps/sample-apps/the-whisper/scenes/<szene>/*.ts` | `prologue.ts` 1336 Z., diorama-`showcase.ts` 1917 Z., tunnel-`showcase.ts` 1035 Z. | Story-State-Machine + Rest-Imperatives |
| Level-Deskriptoren | `scenes/prologue/*.level.json` | 2 Dateien | Schema: `public/schemas/level.schema.json` ([ADR 0020](../adr/0020-declarative-level-descriptors-and-kit-runtime.md)) |
| Kits (Props, Texturen, Decals) | `public/assets/kits/<kit>/` mit `kit.json` + `meta.json` | **1,4 GB** (bunker 1,1 GB · flakturm 308 MB · industrial 4,8 MB) | liegt im **Engine**-Repo, nicht in der App ([ADR 0011](../adr/0011-modular-asset-kits-and-remote-catalog.md)) |
| App-spezifische Assets | `public/assets/the-whisper/` | 42 MB | Mannequins, Map, Konzeptbilder |
| Rohdaten der Figuren | `apps/…/the-whisper/raw/` | 31 MB | `.fbx`, `.glb`, `.obj`, Mixamo-ZIPs |
| Konzept/Story/Log | `apps/…/the-whisper/docs/` | — | `story.md`, `concept-dossier.html`, `log.md` |
| Kit-Builder (Code-Bauteile) | `apps/…/the-whisper/builder/{FlakturmKit,BunkerKit}.ts` | — | prozedurale Kit-Bauer, historisch |
| glTF-Vendor-Extensions | `packages/gltf-extensions` | `SW_prefab_instance`, `SW_stage_zone`, `SW_stage_vanishing_point` | [ADR 0016–0018](../adr/index.md) |
| Repo-Größe | `.git` **1,6 GB**, **685** Dateien in Git LFS | | `.gitattributes` routet `.glb/.png/.jpg/.webp/.fbx/.wav` in LFS |
| Speicherstand | — | — | in The Whisper nichts; nur `yad` nutzt `localStorage` |

### 2.2 Was bereits gut ist (nicht anfassen)

- **Zweistufige Trennung Prefab ↔ Instanz** ist da: `meta.json` (Defaults, Sockets) ↔ `*.level.json` (Overrides). Das ist genau das Muster, das Unity, Bitsquid und Our Machinery unabhängig voneinander gefunden haben (Abschnitt 3/4).
- **Namespaced IDs** existieren im Kleinen: `<kit-id>/<slug>` (`flakturm/bunker_blast_door`).
- **JSON-Schema + Validierungstests** für Kit, Prop-Meta und Level (`AssetKitValidation.test.ts`, `LevelValidation.test.ts`).
- **glTF + `SW_*`-Extensions** als Weltformat ([ADR 0010](../adr/0010-maker-editor-architecture.md)) — das Web-Ökosystem bestätigt die Richtung (Needle Engine, Abschnitt 6).
- **App-First-Regel** ([ADR 0015](../adr/0015-app-first-genre-code-extraction-rule.md)) entspricht Casey Muratoris „erst nach der zweiten Wiederholung abstrahieren" (Abschnitt 4).
- **Kein Singleton**, mehrere Engine-Instanzen pro Seite — das macht spätere Sandbox-/Mod-Szenarien überhaupt erst möglich.

### 2.3 Schmerzpunkte (die konkrete Motivation)

1. **Keine App-Grenze.** Es gibt kein Objekt „The Whisper" als Ganzes. Was zur App gehört, ergibt sich aus Ordnerkonvention + Einträgen in `vite.config.ts` (Eingänge sind per Hand gelistet, Zeilen ~239–302). Eine neue Szene braucht mindestens 3 Registrierungsstellen.
2. **Assets sind über drei Orte verteilt** (`raw/`, `public/assets/the-whisper/`, `public/assets/kits/`), Kits liegen im Engine-Baum. Eine App ist deshalb weder verschiebbar noch in Isolation baubar.
3. **Inhalt lebt im Engine-Repo.** 1,4 GB Kits in `public/` des Engine-Repos ist exakt das Anti-Pattern, das ADR 0011 in Phase 2 lösen sollte.
4. **Doku-Drift.** ADR 0011 (Status Phase 2) behauptet „ohne Git-LFS-Filter", das Repo hat aber LFS für 685 Dateien (`.gitattributes` kommentiert „Git LFS ab jetzt"). Der Status im ADR ist veraltet — **nicht Teil dieses Papiers, aber zu korrigieren**.
5. **Figuren haben kein Manifest.** Rig, Animationssets, Mixamo-Herkunft, Facing-Offset, Skalierung stehen teils im Code (`StageMovementBehavior.facingOffset`), teils in ADR 0009, teils in Dateinamen.
6. **Story/Inhalt im Code.** Dialoge/Terminaltexte sind nicht als Daten adressierbar — Lokalisierung, Lektorat und Maker-Editierbarkeit scheitern daran.
7. **Kein Laufzeitzustand.** Ohne Savegame-Konzept gibt es keinen Schnitt zwischen „Inhalt" und „Fortschritt". Das rächt sich, sobald ein Level-Update alte Spielstände treffen kann.
8. **Testabdeckung hängt an Ordnerkonventionen.** `LevelValidation.test.ts` scannt nur `repoRoot/apps`; ein Umzug der Level-JSONs nach `public/` würde den Test lautlos auf 0 Dateien setzen (bekannter Stolperstein, siehe `.agents/notes/scene-asset-pipeline.md`).

---

## 3. Was die Engines tun

Zusammenfassung der Engine-Recherche. **[V]** = Primärquelle geprüft, **[K]** hier ≙ **[U]** (allgemein bekannt, nicht neu geprüft).

### 3.1 Unity

- Ordner `Assets/` (Quelle), `Library/` (lokaler Import-Cache, **nicht** eingecheckt), `Packages/manifest.json` + Lockfile, `ProjectSettings/`. **[U]**
- Der *Asset Database* konvertiert Quellassets in eine Laufzeit-optimierte Form und hält beides synchron. **[V]** ([Unity Manual: AssetDatabase](https://docs.unity3d.com/Manual/AssetDatabase.html))
- Neben jedem Asset liegt eine **`.meta`-Datei mit GUID** + Importer-Einstellungen; Referenzen laufen über GUID+fileID, Verschieben bricht sie nicht. **[U]**
- Szenen/Prefabs sind **YAML-Text** (Force Text), mit fileIDs pro Objekt; `UnityYAMLMerge` („Smart Merge") existiert eigens, weil Text-Merge dort scheitert. **[V]** für Smart Merge als Werkzeug (Anchorpoint/Unity-Doku via Uni-Recherche), Details **[U]**.
- Code: `.cs` in Assemblies (`.asmdef`), Pakete via UPM (`package.json` mit Name/Version). **[U]**
- Auslieferung: AssetBundles/Addressables (Adresse → GUID → Bundle-Katalog). **[U]**
- **Lehre:** Sidecar-GUID + Text-Szenen + git-ignorierter Cache ist eine *bewährte* Kombination. Preis: `.meta`-Rauschen und fileID-Lärm.

### 3.2 Unreal

- `.uproject` = Projektmanifest (JSON: Module, Plugins, Engine-Version); `.uplugin` = Plugin-Manifest, Plugins können **Code-Module und Content** tragen. **[U]**
- `Content/` besteht aus binären `.uasset`/`.umap` → nicht diffbar → Workflow **erzwingt Locking** (Perforce). **[U]**
- **One File Per Actor (OFPA):** Actor-Instanzen liegen in *eigenen* Dateien statt in der Level-Datei; Standard bei World Partition, beim Cooken wieder eingebettet, nur Editor-seitig. **[V]** ([Epic Doku](https://dev.epicgames.com/documentation/en-us/unreal-engine/one-file-per-actor-in-unreal-engine))
- **Game Feature Plugins:** Content-Plugins mit `GameFeatureData` und „Actions" (Komponenten hinzufügen, Daten registrieren, World-Partition-Inhalt), zur Laufzeit an-/abschaltbar, in sich geschlossen. **[V]** ([Epic Doku](https://dev.epicgames.com/documentation/en-us/unreal-engine/game-features-and-modular-gameplay-in-unreal-engine))
- Cook → plattformspezifisch; IoStore (`.utoc/.ucas`) löst `.pak` ab. **[U]** (Details der Defaults ungeprüft)
- **Lehre:** OFPA zeigt: **Merge-Einheit sollte das Entity sein, nicht die Szene.** Und: Binärformate erzwingen Locking — also vermeiden.

### 3.3 Godot

- `project.godot` (INI-Manifest: Name, Hauptszene, Autoloads, Plugins); Adressierung über `res://`. **[U]**
- Doku sagt: Godot nutze das Dateisystem „as-is, without metadata or an asset database"; Assets möglichst **nah bei den Szenen** gruppieren, Drittanbieter-Zeug in `addons/`. **[V]** ([Godot: Project organization](https://docs.godotengine.org/en/stable/tutorials/best_practices/project_organization.html))
- `.tscn`/`.tres` sind Text, Szenen werden durch **Instanzieren anderer Szenen** komponiert; „alles ist eine Resource". **[U]**
- **UID-System (4.4):** `uid://…`-Referenzen überleben Dateiverschiebungen; Textdateien (Scripts, Shader) bekommen `<file>.uid`-Sidecars, die eingecheckt und mit verschoben werden müssen. **[V]** ([Godot-Blog: UID changes](https://godotengine.org/article/uid-changes-coming-to-godot-4-4/))
- Export = `.pck` + Runtime; native Erweiterungen via GDExtension. **[U]**
- **Lehre:** Godot hat das UID-System **nachgerüstet** — pfadbasiert zu starten war ein teurer Fehler. *IDs von Tag 1.*

### 3.4 Bevy

- Cargo-Projekt; **Code und Plugins sind Crates**, `Plugin` ist die Kompositionseinheit. **[U]**
- Szenen als `.scn.ron` über Reflection; **BSN-Vorschlag** (Required Components, Patch/Vererbungsmodell für geschichtete Szenen). **[V]** für die Existenz ([Bevy Discussion #14437](https://github.com/bevyengine/bevy/discussions/14437)), Umsetzungsstand **[U]**.
- Pluggable Asset Sources (`name://path`), optionaler Asset-Processor → `imported_assets/`. **[U]**
- **Lehre:** Reflection-getriebenes „Welt → Text" ist billig. Die *Patch-/Vererbungsschicht* macht Prefabs+Overrides diffbar.

### 3.5 O3DE, Defold

- **O3DE:** Gems (`gem.json`, Code+Assets+Abhängigkeiten), Projekt listet aktive Gems; Prefabs/Levels als JSON, Instanzen als **Patches gegen ein Template**; Asset Processor erzeugt einen Produkt-Cache mit Source-/Product-IDs. **[U]** (Doku-Seite lieferte 404)
- **Defold:** `game.project` (INI), `.collection`/`.go` als Protobuf-**Text**; Collections instanziieren Collections rekursiv; Asset-Archive + Bundler. **[U]**

### 3.6 Web-Engines (kurz; Details Abschnitt 6)

- **three.js Editor:** `Object3D.toJSON()` — Metadaten + UUID-indizierte Tabellen (geometries, materials, textures, images) + Objektbaum; Editor speichert in IndexedDB. Kein Manifest, keine Prefabs, keine Pakete. **[U]/[S]**
- **PlayCanvas:** Cloud-Projekt (serverseitig), Build-Export als ZIP; Engine läuft eigenständig ohne Editor. **[S]**
- **Babylon.js:** `.babylon`-JSON + glTF, Node-Material-Graphen als kleines JSON über Snippet-Server. **[S]**
- **Needle Engine:** Unity/Blender → `scene.glb` in ein generiertes **Vite-Projekt** (`assets/`, `src/main.ts`, `package.json`); Komponenten als `NEEDLE_components`-**Extension pro Node**. **[S]**
- **Wonderland Engine:** Projektdatei `.wlp`, Deploy-Ordner mit `.bin` + `.wasm` + JS. **[S]**

### 3.7 Muster quer durch alle Engines

| # | Muster | Belege |
| :-: | :--- | :--- |
| 1 | **Manifest + stabile IDs** | `.uproject`, `project.godot`, `game.project`, `manifest.json`; IDs als `.meta`-GUID (Unity), `uid://` (Godot), UUID (three.js) |
| 2 | **Text-diffbare Szenen** | Unity-YAML, tscn, RON, O3DE-JSON, Defold-Protobuf-Text, three-JSON. Ausreißer Unreal → deshalb OFPA |
| 3 | **Quelle ↔ Cooked getrennt** | `Library/`, `.godot/imported`, Cook/IoStore, O3DE-Cache, `imported_assets` — immer regenerierbar und ignoriert |
| 4 | **Code als Paket** | UPM/asmdef, Plugins/Module, GDExtension/addons, Crates, Gems — Paket = Manifest mit Name, Version, Abhängigkeiten, trägt Code *und* Content |
| 5 | **Prefab = Template + Overrides** | Patch (O3DE, Unity-Variants, BSN) oder Instanzieren (Godot, Defold) |
| 6 | **Laufzeit-Umschaltbare Module** | Unreal Game Features, Godot Autoloads/Plugins, Bevy Plugin — das stärkste Modularitätsmuster |

---

## 4. Die „Götter" und die Praxis

### 4.1 id Software — Inhalt als Ebene, Code als Daten

- **Doom-WAD:** Container aus benannten „Lumps"; **IWAD** enthält alles Nötige, **PWAD** legt sich als Patch darüber und ersetzt/ergänzt Ressourcen — ohne Code-Patch. **[S]** (Wikipedia). *Reihenfolge der Lumps entscheidet, Karte = Markerlump + feste Lump-Namen* **[U]**.
- **Quake 3 `pk3`:** ein ZIP mit anderer Endung; mehrere `pk3` in einem Verzeichnis, später sortierende überschreiben frühere. **[S]** (OpenArena-Wiki). Im Originalcode (`files.c`), wörtlich:
  > "Zip files are searched in decending order from the highest number to the lowest, and will always take precedence over the filesystem." **[V]**
  > "never load anything from pk3 files that are not present at the server when pure" **[V]** (der `sv_pure`-Integritätsmechanismus)
- **Spiel-Code als Daten:** QuakeC → `progs.dat`-Bytecode (interpretiert); Quake II ging zu nativen DLLs zurück; **Quake 3** kehrte zu **sandboxed Bytecode (QVM)** zurück — C → lcc → q3asm → QVM, interpretiert oder JIT. **[S]/[V]** ([Sanglard: QVM](https://fabiensanglard.net/quake3/qvm.php)). Carmacks Aussage zum in einem Tag geschriebenen JIT stammt nur aus Sekundärquellen **[U]**.
- **Lehre:** **Overlay ist das Modding-Primitiv.** Spätere Schicht gewinnt per Pfad/ID. Und: „Code als sandboxed Daten" hat Quake-3-Mods erst möglich gemacht — aber id hat zwischen beiden Extremen *hin- und hergependelt*.

### 4.2 Bethesda (ESM/ESP) — Layering mit Kollisionsproblem

- **Master** (`.esm`) ist autonom; **Plugin** (`.esp`) hängt an Mastern und fügt Records hinzu/ändert sie. Master laden vor Plugins, sonst gilt die Reihenfolge in der Plugin-Liste; bei zwei Änderungen am selben FormID **gewinnt der später geladene**. **[S]** (UESP CK-Wiki)
- Folge (nicht am Wiki geprüft): Record-Überschreibung ist **verlustbehaftet** — andere Mods' Änderungen an nicht betroffenen Feldern gehen verloren; deshalb existieren Community-Patches und xEdit-Konfliktwerkzeuge. **[U]**
- **Lehre:** Ganze-Record-Override ist einfach, aber lossy. Wenn Layering, dann **feldweise** oder Patch-Semantik. Jede Entität braucht eine stabile ID (Äquivalent zur FormID).

### 4.3 Minecraft und Factorio — Namespace + Merge-Regeln

- **Minecraft Data Packs:** Ordner/ZIP mit `pack.mcmeta`; Inhalt unter `data/<namespace>/<registry>/<path>.json`, adressiert als `<namespace>:<path>`; der Namespace `minecraft` kann Vanilla überschreiben. Wörtlich aus dem Wiki:
  > "If a file exists in multiple data packs only the file in the last data pack is used." **[V]**
  Pack-Reihenfolge ist konfigurierbar; **Tags** werden gemerged, außer `"replace": true`; **Overlays** lassen einen Pack mehrere Format-Versionen unterstützen. **[V]** ([minecraft.wiki](https://minecraft.wiki/w/Data_pack))
- **Factorio:** dreiphasiger Datenlebenszyklus (`data.lua` → `data-updates.lua` → `data-final-fixes.lua`), damit eine Mod die Prototypen *anderer* Mods anpassen kann, ohne Abhängigkeit zu deklarieren; Ladereihenfolge nach Abhängigkeitstiefe. **[V]** ([Factorio data lifecycle](https://lua-api.factorio.com/latest/auxiliary/data-lifecycle.html))
- **Lehre:** `namespace:path`-IDs, ein kleines Pack-Manifest, **„last wins" mit expliziter Wahl `merge`/`replace` pro Kollektion**, und ein Nach-Lade-Hook für Feinkorrekturen.

### 4.4 Bitsquid/Stingray und Our Machinery — Authored ≠ Runtime

- **Bitsquid (Niklas Frykholm):** Alle Quellinhalte als **SJSON** (relaxed JSON), Hot-Reload als Designprinzip; ein **Datenkompiler** macht daraus Binär; **Prefab-Vererbung wird zur Compile-Zeit aufgelöst** (Ketten gemerged), Levels enthalten Instanzen mit lokalen Overrides; „The entity definition is just a list of components and children." Offsets statt Pointer, damit Blobs verschiebbar/konkatenierbar sind. **[V]** ([Blob & I](https://bitsquid.blogspot.com/2010/02/blob-and-i.html), [Entity-Post](https://raw.githubusercontent.com/niklasfrykholm/blog/master/entity-5.md)); die Render-Pipeline selbst als Datendatei **[S]**.
- **Our Machinery „The Truth":** Daten = Objekte mit typisierten Properties (bool, int, float, string, buffer, reference, sub-object, Mengen davon); **jede Änderung ist `(object, property, old, new)`** → Undo, Copy/Paste und Echtzeit-Kollaboration fallen aus der Datenschicht heraus; Prototypen über Prototype-Referenz + **Override-Bitmaske**. **[S]** (Seite nicht abrufbar; Gamedeveloper-Spiegel)
- **Lehre:** Authored-Form (diffbares JSON) strikt trennen von Runtime-Form; ein Kompilierschritt löst Prefabs/Kits auf und validiert Referenzen. **Eine einheitliche Edit-Operation `(id, path, old, new)`** würde Makers Undo und spätere Kollaboration geschenkt liefern.

### 4.5 Einzelne Stimmen

- **Mike Acton (CppCon 2014, „Data-Oriented Design and C++"):** Programme transformieren Daten — sonst nichts. Das oft zitierte „If you don't understand the data, you don't understand the problem" erreichte uns nur über Suchsummary, **wörtlich nicht bestätigt [S]**. → *Bedeutung für uns:* zuerst das **Datenlayout** (Kit-Record, Platzierung) definieren, dann den Code, der es transformiert.
- **Casey Muratori:** „Semantic Compression" — Gemeinsames erst herauslösen, *nachdem* die Wiederholung ≥2× gesehen wurde, nicht im Voraus abstrahieren. **[V]** ([Blog](https://caseymuratori.com/blog_0015)). *Handmade Hero:* Quellassets werden von einem Asset-Builder in binäre `.hha`-Dateien gepackt, Textbeschreibungen in `.hht`, Format **versioniert mit Upgrade-Tool** (v0→v1, Tag 465). **[V]** ([Handmade Hero Guide](https://guide.handmadehero.org/code/day149/)). → deckt sich exakt mit [ADR 0015](../adr/0015-app-first-genre-code-extraction-rule.md) und dem Schema-Migrations-Gedanken.
- **Robert Nystrom (Game Programming Patterns):** *Type Object* — „Allow the flexible creation of new 'classes' by creating a single class, each instance of which represents a different type of object." **[V]** ([Type Object](https://gameprogrammingpatterns.com/type-object.html)). *Bytecode* — „Give behavior the flexibility of data by encoding it as instructions for a virtual machine." Gründe: Iterationsgeschwindigkeit, Sicherheit/Sandbox für Mods, Trennung; Preis Performance → für inhaltsgetriebene Features, nicht für Engine-Interna. **[V]** ([Bytecode](https://gameprogrammingpatterns.com/bytecode.html)). → *Ein Kit-Katalog **ist** Type Object.*
- **Scott Bilas (GDC 2002, „A Data-Driven Game Object System"):** Objekte als Schema/Property-Daten + Archetypen, angelehnt an Thief; Vorteile: Designer-Unabhängigkeit, schnellere Iteration, sauberes Save/Load auf strukturierten Daten; Kosten: Indirektion, schwierigeres Debugging, Konsistenz tausender datendefinierter Entitäten. **[V]** ([PDF](https://www.gamedevs.org/uploads/data-driven-game-object-system.pdf))
- **Tim Sweeney („The Next Mainstream Programming Language", POPL 2006):** Abstract bestätigt (Beispiele aus Spiele- und Framework-Entwicklung); **Detailaussagen (UnrealScript-Anteile, Code-/Asset-Volumen) nicht geprüft [U]**.
- **Jonathan Blow:** keine Primärquelle zu seiner Position gefunden. *Nicht* zitiert. Sein ACM-Queue-Artikel „Game Development: Harder Than You Think" (2004) **[V]** betont, dass Engineering und Code-Komplexität der harte Teil sind — sagt aber nichts Konkretes zu Packaging.
- **Jason Gregory / Glenn Fiedler:** nur Kapiteltitel (Gregory, siehe 5.1). *Nicht* zitiert.

### 4.6 Praxis-Konventionen

- **Allar UE-Style-Guide:** *Alle* Projektassets in **einem** Top-Level-Ordner mit Projektnamen (`Content/GenericShooter/`) — gegen Namespace-Verschmutzung, für sicheres Migrate zwischen Projekten und für DLC/Patches als getrennte Top-Level-Ordner; Typ-Präfixe (`BP_`, `M_`, `T_`) statt Typ-Unterordnern; ein `Developers`-Ordner für Experimente. **[V]** ([Allar/ue5-style-guide](https://github.com/Allar/ue5-style-guide))
- **Godot:** Assets **bei den Szenen**, die sie nutzen; `addons/` für Fremdes; `snake_case`; `.gdignore` überspringt Import. **[V]** (siehe 3.3)
- **Unity:** keine offiziellen Organisationsrichtlinien gefunden; Sonderordner (`Resources`, `StreamingAssets`, `Editor`) **[U]**.

### 4.7 Was die Praxis gemeinsam sagt

1. Jedes langlebige System hat dasselbe Skelett: **ID-Schema + geordnete Schichtenliste + Überschreibregel** (Doom: Lump-Name/Ladereihenfolge · pk3: Pfad/alphabetisch · ESP: FormID/Ladereihenfolge · Minecraft: `namespace:path`/Pack-Reihenfolge). *(Synthese der Recherche, keine Einzelquelle.)*
2. Die besseren Systeme haben **Merge-Semantik zusätzlich zur Überschreibung** (Minecraft-Tags, Factorio-Updates-Phase, Our-Machinery-Prototypen). Ganze-Record-Ersetzung (ESP) ist die schwache Stelle.
3. **Authored und Runtime sind getrennt**, verbunden durch einen Compiler (Bitsquid, Handmade Hero, Unity-Import).
4. Verhalten als Daten ist **entweder** sandboxed VM (QVM, Bytecode) **oder** deklarative Daten (Type Object). Man muss bewusst wählen.

---

## 5. Was die Theorie sagt

> **Achtung:** Abschnitt 5 stützt sich auf Lehrbuch-Titel und Fachliteratur; es wurde **kein Kursplan** vollständig verifiziert.

### 5.1 Lehrbücher und Lehre

- **Jason Gregory, *Game Engine Architecture*, 4. Aufl.:** Inhaltsverzeichnis belegt die Abschnitte „Tools and the Asset Pipeline", „The Resource Manager" (Kap. 7), „The Game World Editor" (Kap. 16), „Runtime Object Model Architectures", „World Chunk Data Formats" und „Loading and Streaming Game Worlds" (Kap. 17). **[V]** ([TOC](https://www.gameenginebook.com/toc.html)). Die *Argumentation* (Offline-Tool-Modell ≠ Runtime-Objektmodell; Welt in streambare Chunks) ist Fachwissen **[U]**.
- **Michigan EECS 404 (Game Engine Architecture)** nutzt Gregory; Wochen behandeln „Resource Manager: file system, async I/O, asset pipeline" und „Game Object Models: world editors, offline vs runtime object model, spawners". **[S]** (nur Suchsnippet, Seite 403)
- **Nystrom, *Game Programming Patterns*:** Command-Kapitel — Undo entsteht, wenn jeder Befehl seinen Vorzustand hält und eine Liste mit „current"-Zeiger Mehrfach-Undo/Redo liefert; Replay über aufgezeichnete Befehle statt Zustands-Snapshots; Nystrom implementierte das nach eigener Aussage zuerst „in a level editor". **[V]** ([Command](https://gameprogrammingpatterns.com/command.html))
- **Anderson, Engel, Comninos, McLoughlin (2008), „The Case for Research in Game Engine Architecture" (Future Play):** fordert Forschung zu Engine-Architektur, listet offene Fragen. **[V]**. Die von der Recherche gesuchten Titel „Deconstructing Game Engines"/„Toward a Taxonomy" konnten **nicht** bestätigt werden **[U]**.

> **Konsequenz für Small World Machine:** Die Engine hat schon Gregorys Bausteine: `*.level.json` ≙ *World Chunk Data Format*, Kit-Katalog ≙ *Resource Manager*, Maker ≙ *World Editor*. **Streaming-Einheiten früh festlegen** — dort wird ein Levelformat später eingeschränkt.

### 5.2 Serialisierungstheorie: Schema-Evolution

- **Protobuf:** Feldnummern nie wiederverwenden, gelöschte mit `reserved` sperren; Hinzufügen und (nach Sperren) Entfernen ist wire-sicher. **[V]** ([Proto3 Guide](https://protobuf.dev/programming-guides/proto3/))
- **Cap'n Proto:** neue Member brauchen größere Ordinale als alle bisherigen; Umbenennen sicher, Typ-/Default-Änderung unsicher. **[V]** ([Language](https://capnproto.org/language.html))
- **Kleppmann, *Designing Data-Intensive Applications*, Kap. 4:** *Rückwärtskompatibel* = neuer Code liest alte Daten; *Vorwärtskompatibel* = alter Code liest neue Daten — schwieriger, weil alter Code Zusätze ignorieren muss. **[S]** (nur Sekundärzusammenfassung)
- **glTF hat Vorwärtskompatibilität eingebaut:** Extensions tragen Vendor-Präfix; unbekannte, nur in `extensionsUsed` gelistete werden ignoriert, in `extensionsRequired` gelistete dürfen **nicht** ignoriert werden. **[V]** ([glTF Spec](https://github.com/KhronosGroup/glTF))
- **Rive** nutzt „skippable typed property records" (unbekannte Property-Keys werden übersprungen) — ein robustes Versionierungsmuster. **[S]** ([Rive Format](https://rive.app/docs/runtimes/advanced-topic/format))

> **Konsequenz:** `*.level.json` bekommt eine explizite `schemaVersion` **plus eine Kette von Migrationen** (alt lesen, neu schreiben); IDs werden **nie wiederverwendet** (Analogon zu `reserved`); unbekannte Felder beim Laden **ignorieren** (alte Engine überlebt neue Dateien); `SW_*`-Extensions standardmäßig optional, nur bei bedeutungsloser Ohne-Extension-Darstellung in `extensionsRequired`.

### 5.3 Content-Addressable Storage, Event Sourcing, Undo

- **Git** ist ein „content-addressable filesystem": Key-Value-Store, Schlüssel = Hash von Inhalt+Header; Objekte `blob`/`tree`/`commit`, Trees verweisen per Hash auf Blobs. **[V]** ([Git Internals](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects)). Nix-Store-Pfade und IPFS-CIDs nutzen dieselbe Idee **[U]**.
- **Event Sourcing (Fowler):** „Capture all changes to an application state as a sequence of events" — Vorteile Audit-Trail und Zustandsrekonstruktion; Nachteile unnatürliche Schnittstelle, Replay gegen externe Systeme, langsamer Vollaufbau (deshalb Snapshots). **[V]** ([Fowler](https://martinfowler.com/eaaDev/EventSourcing.html))

> **Konsequenz:** Für Makers Undo genügt ein **Befehlslog**; dessen *Persistierung* ist optional. **Content-Hash-IDs für Binär-Assets** sind billig und liefern Cache-Busting + Dedup gratis.

### 5.4 Architektur-Theorie fürs Packaging

- **Potvin & Levenberg, CACM 59(7), 2016 (Google-Monorepo):** Vorteile — einheitliche Versionierung, Code-Sharing, einfachere Abhängigkeiten, atomare Änderungen, Refactoring im Großen; Nachteile — Tooling muss mitwachsen, Code-Health-Aufwand. **[S]** (CACM-Seite 403, nur Suchsummary)
- **SemVer 2.0.0:** MAJOR bei inkompatibler API-Änderung; **0.y.z** heißt „anything MAY change at any time". **[V]** ([semver.org](https://semver.org/))
- **Cockburn, Hexagonal Architecture (2005):** Kernlogik wird über Ports/Adapter getrieben und ist ohne UI/DB entwickel- und testbar. **[V]** ([Cockburn](https://alistair.cockburn.us/hexagonal-architecture/))
- **Parnas (1972):** Module verbergen Entwurfsentscheidungen, die sich ändern könnten. **[U]**

> **Konsequenz:** `packages/*` + `apps/*` als npm-Workspaces-Monorepo folgt dem Monorepo-Argument (eine Version, atomare Querschnittsänderungen). Die ESLint-Grenzregel ist Parnas-artiges Information Hiding. **Das Dateiformat (`level.json` + `SW_*`) ist die eigentliche öffentliche API** und sollte *getrennt* vom npm-SemVer versioniert werden. Ports & Adapter passt für Speicher: ein abstrakter `LevelStore`/`AssetSource` mit Adaptern für `fetch`, File System Access und IndexedDB, damit Maker und Runtime die Kernlogik teilen.

### 5.5 Versionskontrolle großer Binärdaten

- **Git LFS** ersetzt große Dateien durch Text-Pointer, der Inhalt liegt auf einem Server. **[V]** ([git-lfs.com](https://git-lfs.com/)) — sagt nichts über Merge/Locking.
- Binärassets lassen sich nicht automatisch mergen → **exklusives Locking**; Perforce ist Studio-Standard; Unity Version Control (ehem. Plastic SCM) bietet Locking + Semantic Merge. **[S]**
- **UnityYAMLMerge** für Szenen/Prefabs, weil Text-Merge dort bricht; hängt an Git, Perforce, Mercurial, SVN, UVCS. **[V]** ([Unity SmartMerge](https://docs.unity3d.com/Manual/SmartMerge.html))
- DVC nicht recherchiert. **[U]**

> **Konsequenz:** Szenen als **kleine, stabil sortierte, pretty-printed JSON** pro Level/Chunk; Entity-Sammlungen **per ID adressieren** (Objekt oder sortiertes Array), nicht per Position → normale Git-Merges genügen meist ohne Merge-Treiber. Große Binärdaten bleiben außerhalb der Szenendatei, Referenz per Pfad/Hash. LFS nutzen wir schon; Locking ist im Ein-Künstler-Workflow kein Thema.

### 5.6 Forschung zu Spielesoftware

- **Politowski et al., „Are Game Engines Software Frameworks? A Three-perspective Study" (JSS 2020):** Literatur + Vergleich von 282 Engines mit 282 Frameworks auf GitHub + Umfrage unter 124 Engine-Entwicklern; Engines sind in der SE-Forschung wenig untersucht. **[V]** ([arXiv 2004.05705](https://arxiv.org/abs/2004.05705))
- **Politowski et al., „Dataset of Video Game Development Problems"** (>200 Postmortems, 1035 Probleme) **[V]** ([arXiv 2001.00491](https://arxiv.org/abs/2001.00491)) und **Ullmann et al., „Video Game Project Management Anti-patterns"**: aus 440 Postmortem-Problemen tauchten *Feature Creep, Feature Cuts, Working on Multiple Projects* und *Absent or Inadequate Tools* ohne Entsprechung in der SE-Literatur auf. **[V]** ([arXiv 2202.06183](https://arxiv.org/abs/2202.06183))
- Zur spezifischen Frage „technische Schulden in Asset-Pipelines" wurde **keine verifizierte Arbeit** gefunden. **[U]**

> **Konsequenz:** Die Postmortem-Literatur tadelt Scope-Creep und *fehlende Werkzeuge* stärker als Engine-Design. Das stützt: **Maker als Investition ernst nehmen** — und **keine schwere Persistenzschicht auf Vorrat bauen**. Akademisch gibt es wenig Führung; die Industriequellen in Abschnitt 3/4 sind der beste Maßstab.

---

## 6. Die Web-Plattform

### 6.1 glTF als Kern — und seine Grenzen

- **Namensregeln:** `PREFIX_scope_feature`, snake_case. `KHR` = Khronos-ratifiziert, `EXT` = Multi-Vendor, sonstige Präfixe pro Firma reserviert; **jeder** (nicht nur Mitglieder) kann ein Präfix per GitHub-Issue beantragen. **[V]** ([Khronos Extensions README](https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md)). → **`SW_*` ist legitim, aber ungeschützt, solange das Präfix nicht registriert ist.** *Prüfen, ob eine Registrierung sinnvoll ist.*
- **`extras` vs. `extensions`:** `extras` = anwendungsspezifisch ohne Schema/Interop-Garantie; `extensions` = benannt, schema-behaftet, in `extensionsUsed`/`extensionsRequired` deklarierbar. **[U]** → Alles, was Rendering oder Semantik ändert, gehört in eine Extension; `extras` nur für reine Editor-Hinweise.
- **Status relevanter Extensions (laut Registry-README):**

| Extension | Status |
| :--- | :--- |
| `KHR_texture_basisu`, `EXT_meshopt_compression`, `KHR_animation_pointer`, `KHR_xmp_json_ld` | Ratified **[V]** |
| `KHR_interactivity` | Registry: Ratified · Khronos-Pressemeldung 2026-07-16: „Submitted for ratification" — **Widerspruch, vor Einsatz neu prüfen** **[V]** |
| `KHR_physics_rigid_bodies` | Review Draft (PR #2424); Zeitplan mehrfach gerutscht **[V]** |
| `KHR_lights_punctual`, `KHR_materials_*`, `KHR_mesh_quantization`, `KHR_draco_mesh_compression` | Ratified **[U]** |

- **`KHR_interactivity`** bettet einen **deklarativen Verhaltensgraphen** ein (Events, Flow-Control, Math, Variablen, Pointer-Lese-/Schreibzugriffe auf glTF-Properties) — *kein* beliebiger Code, was zu einem „Custom-Code-als-Inhalt"-Sicherheitsmodell passt. **[S]/[U]**
- **Grenzen von glTF als „ganze App":** glTF ist Austauschformat; kein Asset-Versioning-, Abhängigkeits- oder Code-Modul-Konzept **[U]**. `.glb` bündelt alles in einem Blob ohne Partial-/Streaming-Laden, `.gltf` mit externen URIs erlaubt HTTP-Caching pro Datei. **Cross-File-Referenzen sind noch Proposal** **[S]**. → Die Trennung *Level-Datei referenziert Kit-glTFs* ist die richtige Aufteilung.

### 6.2 OpenUSD

- **AOUSD** (Pixar, Adobe, Apple, Autodesk, NVIDIA) **[S]**; Khronos und AOUSD haben formales Liaison, die Metaverse-Standards-Forum-Arbeitsgruppe „3D Asset Interoperability using USD and glTF" arbeitet an Interop. **[S]**
- Einordnung **[U]**: USD = Authoring-/Kompositionsformat (Layer, References, Variants), schwer, ohne praktische Browser-Runtime; usdz = Apples Zip-Lieferformat für AR Quick Look; glTF = Web-Laufzeitformat. Bereits in [ADR 0010](../adr/0010-maker-editor-architecture.md) aus Gründen der Leichtgewichtigkeit abgelehnt — **das Bild bleibt unverändert.** *Interessante Idee zum Ausleihen:* USD-*Layer* (das Kompositionskonzept), nicht das Format.
- **3D Tiles / I3S** = Geodaten-Streaming-Hierarchien **[U]**; als Idee ausleihbar: *Bounding-Volume + URI pro Chunk*.

### 6.3 Kompression, Caching, Browser-Speicher

- **KTX2 + Basis Universal:** ETC1S (klein) und UASTC (hochwertiger, größer), schnelles Transcoding auf die GPU-Zielformate; libktx/`msc_basis_transcoder` als JS/WASM. **[V]** ([KTX-Software README](https://github.com/KhronosGroup/KTX-Software/blob/main/README.md)). Faustregel ETC1S für Albedo, UASTC für Normalmaps **[U]**. *Unser* `BasisWasmTranscoder` ist noch auf RGBA8 festgenagelt (Memory-Notiz 2026-09-24) — der natürliche erste Schritt.
- **meshopt vs. Draco:** meshopt dekodiert schneller und bleibt GPU-freundlich, oft mit `KHR_mesh_quantization` und Brotli/Gzip; Draco komprimiert kleiner, dekodiert langsamer und braucht WASM. **[U]**
- **Cache-Busting:** Vite-Production-Builds emittieren gehashte Namen; **[V]** ([Vite Assets](https://vite.dev/guide/assets)). Gehashte Dateien mit `Cache-Control: public, max-age=31536000, immutable`, Entry-HTML und Manifest mit `no-cache` **[U]**. Unity kennt „Name Files As Hashes" für dasselbe. **[V]** ([Unity WebGL Building](https://docs.unity3d.com/6000.0/Documentation/Manual/webgl-building.html))
- **Browser-Speicher:**
  - **OPFS** (Origin Private File System) ist in Chrome, Firefox, Safari 15.2+ verfügbar, *Baseline* seit März 2023. **[S]** ([MDN OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system))
  - **`showOpenFilePicker`/`showDirectoryPicker`** (File System Access API) sind **nur Chromium** (Chrome/Edge 86+, Opera), MDN: experimental, kein Baseline, Secure Context + User-Aktivierung nötig. **[S]** ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/showOpenFilePicker))
  - → **Für Maker:** Autosave via File System Access bleibt Chromium-only (wie in ADR 0010 akzeptiert); als Fallback **ZIP-Download/-Upload + OPFS als Arbeitsspeicher** oder `<input webkitdirectory>` für nur-lesenden Import.
  - Service Worker + Cache Storage für versionierte Offline-Assets, IndexedDB für kleine strukturierte Daten **[U]**. HTTP-Range-Requests auf `.glb` sind möglich, *content-addressed Chunk-Dateien* meist einfacher **[U]**.

### 6.4 Vite-spezifisch

- `new URL('./x.glb', import.meta.url).href` liefert in Builds eine gehashte, aufgelöste Asset-URL — der richtige Weg für Kit-/Level-Assets aus TypeScript. **[V]** *(Passt zur schon geltenden Regel im Repo: Level-JSON nur per `import.meta.url` laden.)*
- `public/` wird unverändert (ungehasht) kopiert, Vite rät, wenn möglich zu importieren. **[V]** → `public/` nur für **feste Pfade** (Manifest, Worker/WASM mit festem Namen).
- `build.manifest: true` erzeugt `manifest.json` (Quelle → gehashtes Ergebnis); dynamisches `import()` pro Szene wird ein eigener Chunk. **[U]**
- **Module Federation** hat kein natives Vite-Primitiv, braucht ein Plugin (`@module-federation/vite`, `@originjs/vite-plugin-federation`); **Import Maps** als leichtere Alternative — ein Host pinnt geteilte Engine-Versionen für Plugin-/DLC-ES-Module. **[S]/[U]**

### 6.5 „Eigener Code als Inhalt" — Sicherheits-Kompromisse

| Option | Isolation | Preis |
| :--- | :--- | :--- |
| Gleiches Realm, `import()` | keine, voller Seiten-Vertrauen | null — nur für Erst-Partei-Code |
| Worker | eigener Thread, kein DOM, kann aber fetchen | Message-Passing, kein direkter Szenenzugriff |
| Sandboxed Cross-Origin-Iframe (`sandbox` ohne `allow-same-origin`) | stark | nur `postMessage`, kein GPU-/Szenen-Sharing |
| WASM (oder QuickJS-WASM) | capability-basiert, deterministisch | langsamer, schwerere Toolchain |
| Deklarativer Graph (`KHR_interactivity`-Stil) | keine Code-Ausführung | begrenzte Ausdrucksstärke |

*(alles [U], Abwägung der Recherche)* — sicherste Reihenfolge: **deklarativer Graph zuerst**, sandboxed Code als Notausgang.

### 6.6 Ökosysteme (Lehren)

- **Needle Engine** ist der nächste Präzedenzfall für unser Modell (`SW_*` + glTF + Vite): per-Node-Komponentendaten in einer Vendor-Extension **funktionieren**; Skripte sind normale Vite-TS-Module. **[S]** ([Needle Docs](https://engine.needle.tools/docs/explanation/exporting-to-gltf))
- **PlayCanvas:** sauberer Schnitt zwischen Editor-Projektspeicher und eigenständig deploybarem Build; Engine ohne Editor nutzbar. **[S]**
- **three.js:** Editor-JSON „Object Scene format 4" — nah an unserem `*.level.json`; **Schema von Tag 1 versionieren** (`metadata.version`), Migrationscode einplanen. **[S]** ([ObjectLoader](https://threejs.org/docs/#api/en/loaders/ObjectLoader))
- **Wonderland Engine:** ein gepacktes, streambares `.bin` mit Build-Schritt und separater Editor-Projektdatei. **[S]**
- **Godot Web:** `.wasm` + `.pck`; Threaded-Builds brauchen **COOP/COEP** (SharedArrayBuffer), was Einbettung/Drittinhalte bricht → **SharedArrayBuffer vermeiden**. **[S]** ([Godot Web Export](https://github.com/godotengine/godot-docs/blob/master/tutorials/export/exporting_for_web.rst))
- **Unity WebGL:** ein monolithisches `.data`-Blob → lange Ladezeiten, schlechte inkrementelle Updates → **viele kleine gehashte Dateien**. **[V]**
- **Spline:** komfortabel, aber proprietär und gehostet — Lock-in vermeiden. **[U]**
- **A-Frame:** HTML-deklarative Entity-Component-Szenen, diffbar, skaliert aber schlecht auf große Levels. **[U]**

---

## 7. Synthese: zehn Invarianten

Was *alle* Quellen — Engine, Legende, Theorie, Web — auf verschiedenen Wegen sagen:

1. **IDs zuerst, Pfade sind nur Ablageort.** (Godot-UID-Nachrüstung, Unity-`.meta`, Bethesda-FormID, Protobuf-`reserved`.) IDs werden nie wiederverwendet.
2. **Authored ≠ Cooked ≠ Runtime.** Drei Formen, drei Lebenszyklen, drei Versionsregeln.
3. **Authored ist diffbares Text/JSON, Merge-Einheit ist die Entität.** (OFPA, Unity Smart Merge, Bitsquid-SJSON.)
4. **Prefab = Vorlage + Overrides, aufgelöst zur Lade-/Compile-Zeit.** (Bitsquid, O3DE, Our Machinery.)
5. **Schichten mit Reihenfolge und expliziter Regel (`replace` vs. `merge`).** (pk3, Minecraft, Factorio; Bethesdas Ganz-Record-Ersatz als Warnung.)
6. **Ein Manifest benennt die Einheit** (Name, Version, Abhängigkeiten, Einstieg) — und das gilt für Apps *und* Pakete *und* Kits.
7. **Code ist ein Paket, kein Anhängsel** — mit Manifest, deklarierten Abhängigkeiten, ggf. zur Laufzeit an-/abschaltbar. (Unreal Game Features, Bevy Plugins, Needle-Komponenten.)
8. **Verhalten als Daten: bewusst zwischen deklarativ und sandboxed VM wählen** — nie „einfach freier Code" für fremde Inhalte.
9. **Format vorwärts/rückwärts-kompatibel + explizite Versionsnummer + Migrationskette.** (Handmade-Hero-`.hha`-Upgrade, glTF-`extensionsRequired`, Protobuf.)
10. **Abstrahiere nach der zweiten Wiederholung.** (Muratori, ADR 0015, die Postmortem-Statistik zu Scope-Creep.) Das ist das Gegengewicht zu 1–9: **nichts davon ist als Vorratsbau zu verstehen.**

---

## 8. Architekturoptionen für Small World Machine

Sparring-Hut („critical architect") auf, Branchen-Benchmark angewendet:

| | **A. Nur Konvention** | **B. App-Manifest + Pack-Layering** | **C. Alles in glTF** | **D. Archiv (`.swapp`) als Primärformat** |
| :--- | :--- | :--- | :--- | :--- |
| Idee | Ordnerlayout pro App + Doku, sonst nichts | `app.json` benennt Levels, Figuren, Code-Einstieg, Kits; IDs `ns:path`; Schichten | ganze App als eine große glTF mit `SW_*` | ZIP/PCK-artiger Container mit Manifest (Godot PCK / id pk3) |
| Vorbild | Godot „project organization", Allar-Style-Guide | Unity `manifest.json`, `.uproject`, Minecraft `pack.mcmeta`, Godot `project.godot` | Needle (`NEEDLE_components`) — aber nur je *Szene* | Godot, Quake 3, Wonderland |
| Stärken | null Aufwand, sofort | löst Schmerzpunkte 1–3, 5; Maker/Runtime/CI teilen ein Objekt; Diff-freundlich | ein Format | Auslieferung trivial, integritätsprüfbar (`sv_pure`-Idee) |
| Schwächen | löst *nichts*, nur Disziplin | Aufwand, Gefahr der Überabstraktion | glTF ist Austausch-, kein App-Format; keine Abhängigkeiten/Code; `.glb` nicht streambar | Web liebt viele kleine gehashte Dateien; Blob blockiert inkrementelle Updates (Unity-WebGL-Lehre); Debugging schlechter |
| Passt zu SW? | teilweise | **ja** | nein (aber glTF bleibt *Asset*-Format) | später, als *Export*-Artefakt |
| Risiko | bleibt bei Schmerz | mittel (Scope) | hoch | mittel |

**Empfehlung (kurz):** **B, in kleinsten Schritten — mit A als Sofortmaßnahme.** *Archiv (D) ist ein späterer Build-Output, kein Authoring-Format.* C wird explizit verworfen (glTF bleibt Asset- und Szenen-Format, keine App-Klammer).

Warum nicht sofort das volle System? Weil **Invariante 10** und die Postmortem-Literatur (Scope-Creep, fehlende *Werkzeuge* statt fehlender Formate) dagegen sprechen, und weil `CLAUDE.md` „Simplicity — strictly avoid overengineering" verlangt. Das Manifest ist der *einzige* neue Begriff, den wir sofort brauchen — alles Weitere folgt aus realer Reibung.

---

## 9. Konkreter Vorschlag (Skizze, nicht verbindlich)

### 9.1 Zielbild eines App-Ordners

```text
apps/sample-apps/the-whisper/
├─ app.json                    ← Manifest (NEU, einziges Pflichtobjekt)
├─ index.html
├─ levels/                     ← statt scenes/<x>/*.level.json (Level-Daten gehören nicht in Szenenordner)
│   ├─ koje42.level.json
│   └─ kaeltekammer.level.json
├─ scenes/                     ← nur noch Controller-Code (Story-State-Machine)
│   └─ prologue/prologue.ts
├─ characters/                 ← NEU: eine Figur = ein Ordner + Manifest
│   └─ player-male/
│       ├─ character.json      ← Rig, Skalierung, facingOffset, Animationsset, Herkunft
│       ├─ model.glb
│       └─ animations/idle_1.glb …
├─ content/                    ← NEU, später: Dialoge/Terminaltexte als Daten (JSON)
├─ src/                        ← App-eigener Code (Materialien, Behaviors)
├─ raw/                        ← Quellmaterial, NICHT ausgeliefert (FBX, Mixamo-ZIPs)
└─ docs/                       ← Konzept, Story, log.md (wie gehabt)
```

*Regel (Godot + Allar):* **Assets wohnen bei dem, der sie benutzt.** Was mehrere Apps nutzen, ist ein **Kit** (eigenes Paket, s. 9.4).

### 9.2 Das Manifest `app.json`

```jsonc
{
  "$schema": "../../../public/schemas/app.schema.json",
  "id": "the-whisper",
  "name": "The Whisper",
  "version": "0.1.0",                 // Inhaltsversion der App
  "schemaVersion": 1,                 // Version des app.json-Formats selbst
  "engine": ">=0.90.0",               // ab welcher Engine lauffähig
  "entry": "prologue",                // ID des Start-Levels
  "levels": ["koje42", "kaeltekammer"],
  "characters": ["player-male", "player-female", "yoshi"],
  "kits": [                           // Abhängigkeiten, ID + Version-Bereich
    { "id": "flakturm", "version": "^1.0.0" },
    { "id": "bunker",   "version": "^1.0.0" }
  ],
  "code": {                           // Erst-Partei-Code, gleiches Realm (siehe 9.5)
    "module": "./src/index.ts"
  },
  "save": { "schemaVersion": 1 }      // siehe 9.6
}
```

**Bewusst klein:** `id`, `version`, `entry`, Auflistung der eigenen Bestandteile, Kit-Abhängigkeiten. Alles andere (Lokalisierung, Sound, Balancing) kommt erst, wenn es weh tut.

### 9.3 ID-Schema und Schichten

- **IDs:** `namespace:path` (Minecraft-Stil). Vorschlag: Kit-Items behalten ihre `kit/slug`-Form; Level-/Figuren-IDs sind **innerhalb einer App** eindeutig und **außen** als `the-whisper:koje42` adressierbar. **IDs werden nie wiederverwendet.**
- **Schichten (Layering)** sind zunächst nur **zwei** definiert, nicht mehr:
  1. **Kit-Defaults** (`meta.json`) → 2. **Level-Instanz-Override** (`*.level.json`) — *das gibt es schon* (ADR 0020).
  - Eine dritte Schicht („Mod/DLC-Pack", „App-Patch") wird **erst gebaut, wenn ein zweites Konsumentenprojekt sie braucht** (Muratori/ADR 0015). Wenn sie kommt: **Feld-/Patch-Semantik**, *nicht* Ganz-Record-Ersatz (Bethesda-Lehre), mit expliziter Wahl `merge`/`replace` je Kollektion (Minecraft-Lehre).

### 9.4 Kits: raus aus dem Engine-Repo

- 1,4 GB Kits gehören **nicht** in `public/` des Engine-Repos (ADR 0011 Phase 2). Nächster sinnvoller Schritt ist **Auslagerung in ein eigenes Repo/Paket mit `kit.json`-Manifest** (existiert schon), das die App per **Version-Bereich** referenziert.
- Auslieferung: **viele kleine, content-gehashte Dateien** + ein **Asset-Manifest** (Unity-WebGL-Lehre, Vite-`manifest.json`). Kein Monolith-Archiv.

### 9.5 Eigener Code

Drei Stufen, aufsteigende Vorsicht:

1. **Erst-Partei-Code (Standard heute):** TS-Module in `src/`, gleiches Realm, per Vite gebündelt, Registrierung über das Manifest statt `vite.config.ts` (Ziel: `vite.config.ts` liest `app.json`, statt Eingänge per Hand zu listen).
2. **Deklarative Verhaltensdaten:** Bausteine wie Hotspots, Trigger, Sequenzen als JSON (Nystrom *Type Object*), Vorbild `KHR_interactivity`-Stil. **Nur dort einführen, wo Maker sie editieren soll.**
3. **Sandbox für Fremdcode:** *nicht Teil dieser Runde.* Wenn je nötig: Worker/Iframe/WASM (Tabelle 6.5), nie gleiches Realm.

*Wichtig:* Story-Logik (`prologue.ts`, 1336 Zeilen) ist **kein** Kandidat für Deklarativisierung, solange es keine zweite Story-App gibt.

### 9.6 Laufzeitzustand (Savegame)

- **Eigenes Format, eigene Versionsnummer**, getrennt von Inhalt (`schemaVersion` + Migrationskette, Handmade-Hero-Lehre).
- Speichert **Referenzen per ID**, nie Inhalte („Level `koje42`, Item `flakturm/bunker_blast_door` aufgehoben") → ein Content-Update bricht Spielstände nicht, solange IDs nie wiederverwendet werden.
- Speicherort: **IndexedDB/OPFS** als Standard; Export als Datei optional. *Nicht* `localStorage` für alles (Größe, synchron).

### 9.7 Figuren

Eine Figur ist ein **Ordner mit `character.json`**: Modell-Verweis, Rig-Standard (ADR 0009: Mixamo), `scale`, `facingOffset` (heute im Code), Animationsset-IDs, Herkunft/Lizenz. Die Roh-FBX/ZIP-Dateien bleiben in `raw/` (Quelle, nicht ausgeliefert, in LFS). Die **auslieferbare** Form ist ein optimiertes `.glb` (meshopt/KTX2, sobald der Transcoder real ist).

### 9.8 Build und Distribution

- Ausgabe: statischer Ordner (`index.html` + gehashte Assets + `manifest.json` + JS-Chunks pro Level per dynamischem `import()`), *kein* Archiv, *kein* SharedArrayBuffer.
- Kopfzeilen-Konvention: gehashte Dateien `immutable`, Entry/Manifest `no-cache` (6.3).
- **Ein Archiv (`.swapp`) als *Export*-Artefakt** kann später aus genau diesem Ordner entstehen (Quake-3-`pure`-artige Integritätsprüfung, Offline-Weitergabe) — wenn jemand es braucht.

---

## 10. Migrationspfad für The Whisper (in kleinsten, einzeln nützlichen Schritten)

> Jeder Schritt ist **für sich wertvoll** und darf hier aufhören. Keiner setzt einen späteren voraus.

| # | Schritt | Wirkung | Aufwand | Risiko |
| :-: | :--- | :--- | :-: | :-: |
| **0** | ADR-0011-Statusdrift korrigieren (LFS ist aktiv) | Doku ehrlich | XS | keins |
| **1** | **`app.json` einführen** (nur `id`, `version`, `entry`, `levels`, `characters`, `kits`) + `app.schema.json` + Validierungstest im Stil von `AssetKitValidation.test.ts` | Schmerz 1; erstes „Ding", das die App *ist* | S | niedrig |
| **2** | **Level-Dateien nach `apps/…/levels/`**; Test-Scan bleibt unter `apps/` (unverändert gültig) | Trennt Daten von Controller-Code | S | niedrig — `LevelValidation`-Falle beachten |
| **3** | **`vite.config.ts` liest `app.json`** statt Eingänge per Hand zu listen (nur für Whisper) | Schmerz 1 (3 Registrierungsstellen → 1) | M | mittel — Build-Verhalten testen |
| **4** | **`character.json` pro Figur**; `facingOffset` & Skalierung aus dem Code | Schmerz 5 | S–M | niedrig |
| **5** | **`schemaVersion` + Migrationskette in `level.schema.json`** (Wert `1`, leere Kette) | Invariante 9 vorbereiten, kostet fast nichts | XS | keins |
| **6** | **Assets bei die Konsumenten verschieben**: `public/assets/the-whisper/` → `apps/…/`-Asset-Ordner, per `import.meta.url` referenziert | Schmerz 2 | M | mittel — Pfad-Referenzen |
| **7** | **Savegame-Format v1** (ID-Referenzen, `schemaVersion`) sobald *erste* Speicherfunktion gebaut wird | Schmerz 7 | S | niedrig (neu) |
| **8** | **Kits aus Engine-Repo** auslagern (ADR 0011 Phase 2) | Schmerz 3, `.git`-Größe | L | hoch (Infrastruktur) |
| **9** | **Dialog-/Terminaltexte als JSON** (`content/`) | Schmerz 6, Lokalisierung | M | niedrig |

**Empfohlene Reihenfolge der *ersten Runde*:** 0 → 1 → 2 → 4 → 5. Danach *anhalten und beobachten*, ob Schritte 3/6/8 wirklich schmerzen.

### Was wir bewusst **nicht** tun

- **Kein eigenes Archivformat** (`.swapp`), weder im Authoring noch als Export (Entscheidung 8) — Web will viele kleine gehashte Dateien.
- **Keine dritte Layer-Ebene / kein Mod-System**, bis ein *zweiter* Konsument sie braucht.
- **Kein Sandbox-Scripting**, solange es keine Fremdautoren gibt.
- **Kein Umbau von `prologue.ts` in Deklarativdaten**; Story-State-Machines bleiben TypeScript.
- **Kein YAML/TOML/USD** — bereits in ADR 0010 begründet verworfen, Recherche bestätigt die Richtung.
- **Kein SharedArrayBuffer / COOP-COEP-Zwang** (Godot-Web-Lehre).

---

## 11. Risiken und Gegenargumente (Advocatus Diaboli)

- **„Das Manifest wird zur Ablade-Halde."** Realistisch. Gegenmittel: `additionalProperties: false` im Schema (wie bei `level.schema.json`), jedes neue Feld braucht einen realen Anwender.
- **„IDs von Anfang an" widerspricht „keine Vorratsbau."** Stimmt teilweise. Auflösung: **IDs sind billig und nicht rückholbar** (Godots Nachrüstung als Warnung) — das ist die *eine* Ausnahme vom Vorratsbau-Verbot.
- **Pfad-Umzüge (Schritte 2, 6) sind fehleranfällig** — der Level-Test-Scan ist ein bekannter Stolperstein. Gegenmittel: Vor jedem Umzug den Test ausführen und *explizit* prüfen, dass er >0 Dateien findet.
- **`vite.config.ts` per Manifest zu treiben** verlagert Komplexität in Build-Logik. Gegenmittel: erst ein Whisper-Pilot, kein Framework für „alle Apps".
- **`KHR_interactivity` und `KHR_physics_rigid_bodies`** sind bewegliche Ziele (Widerspruch Registry vs. Pressemeldung; Physik seit 2024 verspätet). **Nicht abhängig machen**; beobachten.
- **LFS ist Host-gebunden** (Speicherkontingent/Bandbreite). Bei 1,4 GB Kits + 1,6 GB `.git` wird das ein realer Kostenpunkt — eine Motivation für Schritt 8.
- **Die Uni-Recherche ist dünn.** Wer hier Belege für eine Arbeit braucht, muss die Syllabi (CMU 15-466 etc.) selbst prüfen.

---

## 12. Fragen an den Auftraggeber

> **Stand 2026-09-29:** Alle Fragen sind beantwortet (siehe [Abschnitt 12a](#12a-entscheidungen-des-auftraggebers-2026-09-29-und-ihre-folgen)). Ursprünglicher Wortlaut zur Nachvollziehbarkeit:

Diese Punkte ändern die Empfehlung — bitte entscheiden:

1. **Ziel-Horizont:** Bleibt *The Whisper* eine **Demo-App im Engine-Repo**, oder soll sie ein **eigenständig baubares/auslieferbares Projekt** werden (eigenes Repo, eigene CI)? — Das entscheidet über Dringlichkeit von Schritt 3/6/8.
2. **Fremdinhalte:** Soll je **jemand anders** Levels/Figuren/Code beisteuern (Mods, Community)? — Ohne Ja bleibt Sandbox und Layering komplett draußen.
3. **Maker-Rolle:** Soll Maker eine **ganze App** (Manifest, Figuren, Levels) editieren oder weiter nur **einzelne Levels**? — Bestimmt, ob `app.json` von Maker mitgeschrieben werden muss.
4. **Speicherstand:** Ist ein Savegame für *The Whisper* geplant (Adventure-Fortschritt) oder bleibt es eine lineare Demo? — Bestimmt Schritt 7.
5. **Kits:** Sind die Kits (1,4 GB, v. a. `bunker`) **Eigenproduktionen** (z. B. Tripo3D) oder **fremdlizenziert**? — Lizenz-Metadaten im `kit.json` sind schon vorgesehen (`license`), aber die Auslagerung hängt an der Antwort.
6. **`SW_`-Präfix:** Soll der Präfix bei Khronos **registriert** werden (Registrierung per Issue, [V]) oder bleibt er informell?
7. **Lokalisierung:** Ist Mehrsprachigkeit (de/en) denkbar? — Dann Schritt 9 früher.
8. **Wunschformat für Weitergabe:** Genügt ein statischer Ordner/URL, oder wird ein **einzelnes Datei-Artefakt** (z. B. für Offline-Demo, Messe) gebraucht? — Entscheidet, ob `.swapp` überhaupt als Export gebaut wird.

---

## 12a. Entscheidungen des Auftraggebers (2026-09-29) und ihre Folgen

Alle acht Fragen aus Abschnitt 12 sind beantwortet.

| # | Entscheidung | Folge für dieses Papier |
| :-: | :--- | :--- |
| 1 | *The Whisper* wird ein **eigenständiges Projekt** und das **erste Referenzbeispiel „mit allem, was wir bieten könnten"**. | Schritte **3, 6 und 8** (Manifest-getriebener Build, Assets bei den Konsumenten, Kit-Auslagerung) sind **gesetzt statt optional**. Die App wird zugleich Referenzimplementierung für `app.json`, `character.json`, Savegame und Level-Migration. **Warnung:** „alles, was wir bieten" ist genau das Scope-Creep-Muster aus Abschnitt 5.6. Gegenmittel: jedes Feature braucht einen konkreten Spielmoment, der es benutzt — keine Feature-Parade. |
| 2 | **Kein Mod-System geplant.** | Bestätigt Abschnitt 10 („bewusst nicht"): keine dritte Layer-Ebene, kein Sandbox-Scripting, keine `replace`/`merge`-Regel. Die Erkenntnisse aus 4.1–4.3 bleiben Referenz für später. |
| 3 | **Maker editiert ganze Apps.** | `app.json` und `character.json` müssen **von Maker les- und schreibbar** sein: Schema-getrieben (`additionalProperties: false`), **stabile Schlüsselreihenfolge** und Pretty-Print für saubere Git-Diffs, Änderungen als Befehle `(id, path, old, new)` im Undo-Stack (Abschnitt 4.4). Maker braucht eine **Projekt-Ebene** oberhalb der Level-Ebene. Passend: `showDirectoryPicker` bindet ohnehin einen Projektordner (ADR 0010, Chromium-only). Das Manifest ist damit Maker-Vertrag, nicht nur Build-Eingabe. |
| 4 | **Savegame: ja.** | Schritt 7 rückt in die **erste Runde**. Savegame-Format v1 wird *vor* dem ersten Speichern-Feature entworfen: nur ID-Referenzen, `schemaVersion`, Migrationskette, Ablage in IndexedDB/OPFS. **„IDs werden nie wiederverwendet"** wird damit zur harten Regel (ADR-Kandidat). |
| 5 | **Kits sind Eigenproduktionen.** | Lizenz ist kein Blocker für die Auslagerung (Schritt 8). Es bleibt eine Wahl, unter welcher Lizenz sie veröffentlicht werden (`kit.json` trägt `license` bereits). |
| 6 | **`SW_`-Präfix: vorerst nicht registrieren.** | Bleibt informell. Empfehlung: vor der ersten **externen Veröffentlichung** von Level-/Kit-Dateien erneut entscheiden, weil dann Dritte `SW_*`-Dateien sehen können. |
| 7 | **Lokalisierung: ja.** | Schritt 9 (Texte als Daten) ist **gesetzt** und wird vorgezogen. Alle Spielertexte (Dialoge, Terminal, Hotspot-Beschriftungen) bekommen **stabile Text-IDs** und liegen in `content/<sprache>.json`; der Code referenziert nur IDs. Das Savegame speichert die gewählte Sprache nicht als Inhalt, sondern als Einstellung. Text-IDs unterliegen derselben Regel wie alle IDs: **nie wiederverwenden**. Sprachdateien werden im Test gegeneinander auf fehlende/überzählige Schlüssel geprüft (analog `AssetKitValidation.test.ts`). Maker (Entscheidung 3) sollte Texte per ID anzeigen und editieren können. |
| 8 | **Kein Einzeldatei-Artefakt nötig.** | `.swapp` entfällt auch als Export. Auslieferung bleibt der statische Ordner mit gehashten Dateien (Abschnitt 9.8). Spart die gesamte Archiv-/Integritätsprüfungs-Diskussion. |

### Angepasste Reihenfolge der ersten Runde

Vorher (Abschnitt 10): 0 → 1 → 2 → 4 → 5, danach beobachten.

**Jetzt:** **0 → 1 → 5 → 2 → 4 → 7 (nur Format-Entwurf) → 9 (Text-IDs + `content/<sprache>.json`) → 3 → 6**, danach Schritt 8 (Kit-Auslagerung) als eigenes Vorhaben mit eigenem ADR-Update.

Begründung: `schemaVersion` (5) kostet fast nichts und gehört vor die Umzüge; das Savegame-*Format* (7) und die Text-IDs (9) werden früh festgelegt, weil beide Anforderungen an die ID-Stabilität stellen und später nur teuer nachzurüsten sind (Godot-UID-Lehre); Umzüge und Build-Umbau (2, 3, 6) folgen erst, wenn Manifest und IDs stehen.

---

## 13. Vorgeschlagene ADRs (nach Entscheidung)

- **ADR (neu): App-Manifest `app.json` und App-Grenze** — Schritt 1–3; ersetzt implizite Registrierung.
- **ADR (neu): Stabile IDs, Namespaces und Layering-Regel** — Invarianten 1, 5; enthält die `replace`/`merge`-Regel *erst wenn* ein zweiter Konsument existiert.
- **ADR (neu): Savegame-Format und Schema-Migration** — sobald Schritt 7 real wird.
- **Update ADR 0011:** Statusdrift (LFS), Phase-2-Entscheidung neu bewerten.
- **Update ADR 0020:** `schemaVersion` + Migrationskette für Level-Deskriptoren.

---

## 14. Quellenverzeichnis

*Legende wie in Abschnitt 0. Nicht aufgeführte Behauptungen sind [U]. Quellen der Nachtrags-Recherche (2026-09-29) stehen in §15.6.*

### Engines und Werkzeuge
- Unity Manual — AssetDatabase: https://docs.unity3d.com/Manual/AssetDatabase.html **[V, teilweise]**
- Unity — Smart Merge: https://docs.unity3d.com/Manual/SmartMerge.html **[V]**
- Unity — WebGL Building: https://docs.unity3d.com/6000.0/Documentation/Manual/webgl-building.html **[V]**
- Unreal — One File Per Actor: https://dev.epicgames.com/documentation/en-us/unreal-engine/one-file-per-actor-in-unreal-engine **[V]**
- Unreal — Game Features & Modular Gameplay: https://dev.epicgames.com/documentation/en-us/unreal-engine/game-features-and-modular-gameplay-in-unreal-engine **[V]**
- Godot — Project organization: https://docs.godotengine.org/en/stable/tutorials/best_practices/project_organization.html **[V]**
- Godot — UID changes in 4.4: https://godotengine.org/article/uid-changes-coming-to-godot-4-4/ **[V]**
- Godot — Web export: https://github.com/godotengine/godot-docs/blob/master/tutorials/export/exporting_for_web.rst **[S]**
- Bevy — BSN Diskussion: https://github.com/bevyengine/bevy/discussions/14437 **[V]**
- PlayCanvas — Self-hosting: https://developer.playcanvas.com/user-manual/editor/publishing/web/self-hosting/ **[S]**
- Babylon.js — Loading file types: https://doc.babylonjs.com/features/featuresDeepDive/importers/loadingFileTypes **[S]**
- three.js — ObjectLoader: https://threejs.org/docs/#api/en/loaders/ObjectLoader **[S]**
- Needle Engine — Exporting to glTF: https://engine.needle.tools/docs/explanation/exporting-to-gltf **[S]**
- Wonderland Engine — Release: https://wonderlandengine.com/release/ **[S]**
- Rive — Format: https://rive.app/docs/runtimes/advanced-topic/format **[S]**

### Legenden und Praxis
- id Software, Quake III `files.c`: https://github.com/id-Software/Quake-III-Arena/blob/master/code/qcommon/files.c **[V]**
- Doom WAD (Wikipedia): https://en.wikipedia.org/wiki/Doom_WAD **[S]**
- OpenArena — pk3: https://openarena.fandom.com/wiki/Pk3 **[S]**
- Sanglard — Quake 3 QVM: https://fabiensanglard.net/quake3/qvm.php **[S/V]**
- QuakeC (Wikipedia): https://en.wikipedia.org/wiki/QuakeC **[S]**
- UESP Creation Kit — Data file: https://ck.uesp.net/wiki/Data_file **[S]**
- xEdit — Managing mod files: https://tes5edit.github.io/docs/8-managing-mod-files.html **[nicht abgerufen]**
- Minecraft Wiki — Data pack: https://minecraft.wiki/w/Data_pack **[V]**
- Factorio — Data lifecycle: https://lua-api.factorio.com/latest/auxiliary/data-lifecycle.html **[V]**
- Bitsquid — Blob and I: https://bitsquid.blogspot.com/2010/02/blob-and-i.html **[V]**
- Frykholm — Entity-Post: https://raw.githubusercontent.com/niklasfrykholm/blog/master/entity-5.md **[V]**
- Stingray Renderer Walkthrough #7: http://bitsquid.blogspot.com/2017/03/stingray-renderer-walkthrough-7-data.html **[S]**
- Our Machinery — The Truth: https://ourmachinery.com/post/the-story-behind-the-truth-designing-a-data-model/ und Spiegel https://www.gamedeveloper.com/programming/the-story-behind-the-truth-designing-a-data-model **[S]**
- Our Machinery — Prototypes: https://ourmachinery.com/post/prototypes-in-the-machinery/ **[S]**
- GDC Vault — Loading Based on Imperfect Data (Insomniac): https://www.gdcvault.com/play/1017878/Loading-Based-on-Imperfect **[S]**
- GDC Vault — Overwatch Gameplay Architecture: https://www.gdcvault.com/play/1024001/-Overwatch-Gameplay-Architecture-and **[S]**
- Acton, CppCon 2014: https://isocpp.org/blog/2015/01/cppcon-2014-data-oriented-design-and-c-mike-acton **[S]**
- Muratori — Semantic Compression: https://caseymuratori.com/blog_0015 **[V]**
- Handmade Hero Guide: https://guide.handmadehero.org/code/day149/ **[V]**
- Sweeney — Next Mainstream Programming Language: https://groups.csail.mit.edu/cag/crg/papers/sweeney06games.pdf **[Abstract V]**
- Nystrom — Type Object: https://gameprogrammingpatterns.com/type-object.html **[V]**
- Nystrom — Bytecode: https://gameprogrammingpatterns.com/bytecode.html **[V]**
- Nystrom — Command: https://gameprogrammingpatterns.com/command.html **[V]**
- Allar — UE5 Style Guide: https://github.com/Allar/ue5-style-guide **[V]**

### Theorie und Lehre
- Gregory — *Game Engine Architecture* TOC: https://www.gameenginebook.com/toc.html **[V]**
- Bilas — A Data-Driven Game Object System: https://www.gamedevs.org/uploads/data-driven-game-object-system.pdf **[V]**
- Protobuf: https://protobuf.dev/programming-guides/proto3/ **[V]**
- Cap'n Proto: https://capnproto.org/language.html **[V]**
- Fowler — Event Sourcing: https://martinfowler.com/eaaDev/EventSourcing.html **[V]**
- Git Internals: https://git-scm.com/book/en/v2/Git-Internals-Git-Objects **[V]**
- Git LFS: https://git-lfs.com/ **[V]**
- SemVer: https://semver.org/ **[V]**
- Cockburn — Hexagonal Architecture: https://alistair.cockburn.us/hexagonal-architecture/ **[V]**
- Potvin & Levenberg (CACM 2016): https://cacm.acm.org/research/why-google-stores-billions-of-lines-of-code-in-a-single-repository/ **[S]**
- Blow — Game Development: Harder Than You Think: https://dl.acm.org/doi/10.1145/971564.971590 **[V]**
- Anderson et al. 2008: https://eprints.bournemouth.ac.uk/24322/1/FP8GEA.pdf **[V]**
- Politowski et al. — Are Game Engines Software Frameworks?: https://arxiv.org/abs/2004.05705 **[V]**
- Politowski et al. — Dataset of Video Game Development Problems: https://arxiv.org/abs/2001.00491 **[V]**
- Ullmann et al. — Video Game Project Management Anti-patterns: https://arxiv.org/abs/2202.06183 **[V]**
- Michigan EECS 498/404 (Suchsnippet): https://ayarger.engin.umich.edu/eecs-498-game-engine-architecture/ **[S, Seite 403]**
- Kleppmann-Sekundärzusammenfassung: https://candost.blog/books/ddia-encoding-decoding-schemas-and-data-evolution/ **[S]**
- Anchorpoint — Version Control for Game Dev (Locking): https://www.anchorpoint.app/blog/version-control-for-game-development **[S]**

### Web-Plattform
- Khronos glTF Extensions README: https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md **[V]**
- Khronos — KHR_interactivity submitted for ratification: https://www.khronos.org/news/press/gltf-interactivity-extension-submitted-for-ratification **[V]**
- Khronos — glTF now and next: https://www.khronos.org/blog/gltf-now-and-next **[V]**
- Khronos — glTF 2.1 and Beyond (SIGGRAPH Jul26): https://www.khronos.org/assets/uploads/developers/presentations/glTF_2_1_and_Beyond_-_SIGGRAPH_Jul26.pdf **[nicht lesbar]**
- Khronos/AOUSD Interop: https://www.khronos.org/blog/building-bridges-in-3d-aousd-and-khronos-collaborate-on-openusd-and-gltf-interoperability **[S]**
- Metaverse Standards Forum BOF: https://metaverse-standards.org/wp-content/uploads/glTF-USD-BOF-SIGGRAPH-Vancouver-Aug25-FINAL.pdf **[S]**
- AOUSD (Wikipedia): https://en.wikipedia.org/wiki/Alliance_for_OpenUSD **[S]**
- KTX-Software: https://github.com/KhronosGroup/KTX-Software/blob/main/README.md **[V]**
- Vite — Assets: https://vite.dev/guide/assets **[V]**
- Module Federation für Vite: https://module-federation.io/integrations/build-tool/vite.html **[S]** · Import-Map-Wunsch: https://github.com/module-federation/vite/issues/1381 **[S]**
- MDN — `showOpenFilePicker`: https://developer.mozilla.org/en-US/docs/Web/API/Window/showOpenFilePicker **[S]**
- MDN — OPFS: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system **[S]**
- Can-I-Use-Zusammenfassung: https://github.com/Fyrd/caniuse/issues/6615 **[S]**

### Interne Verweise
- [ADR 0009](../adr/0009-character-pipeline-and-mixamo-rigging-standard.md) · [ADR 0010](../adr/0010-maker-editor-architecture.md) · [ADR 0011](../adr/0011-modular-asset-kits-and-remote-catalog.md) · [ADR 0014](../adr/0014-modular-ecosystem-and-domain-layering.md) · [ADR 0015](../adr/0015-app-first-genre-code-extraction-rule.md) · [ADR 0016](../adr/0016-2-5d-stage-zones-as-a-gltf-extension.md) · [ADR 0017](../adr/0017-gltf-extension-plugin-registry.md) · [ADR 0018](../adr/0018-gltf-data-level-extensions-and-ecosystem-package.md) · [ADR 0020](../adr/0020-declarative-level-descriptors-and-kit-runtime.md)
- Schemas: `public/schemas/{kit,prop-meta,level}.schema.json`
- Tests: `packages/engine/tests/loaders/{AssetKitValidation,LevelValidation}.test.ts`
- Notiz: `.agents/notes/scene-asset-pipeline.md`

---

## 15. Anhang: Ergänzende Recherche (2026-09-29, nach §12a)

> **Auftrag:** Vom Auftraggeber priorisierte Schwerpunkte (moderne Praxis-Layer, Audio-Pipeline, Savegame-Interop, Web-/glTF-Ökosystem-Status) als **Appendix** — der Haupttext bleibt unverändert. **Nicht** vertieft: Uni-/Lehre (bewusst eigener Gegenstand, hier nicht nachrecherchiert).
> **Disziplin:** Gleiche Marker wie §0. `[V]` nur, wo ich die genannte Seite am 2026-09-29 tatsächlich gelesen habe; `[S]` nur aus Suchsnippet/Sekundärquelle. Wo ein Befund einen früheren Abschnitt überholt, ist das explizit markiert — historische Aussagen bleiben unangetastet.
> **Funktion:** Festigung der Entscheidungen aus §12a, keine Neu-Eröffnung. Vorschläge, die über §12a hinausgehen (Audio), sind als solche gekennzeichnet und brauchen Zustimmung.

### 15.1 Moderne Praxis-Layer (lebende Analogien statt Legenden)

Die drei Fälle sind die *heutigen* Gegenstücke zu §4.1–4.3: Plattformen, bei denen „Inhalt als Datenpaket über einer laufenden Engine" aktuelles Produktionsmodell ist.

**Roblox — Packages: Template + Overrides mit expliziter Erhalt-Semantik [V]**

Die offizielle Creator-Hub-Doku (create.roblox.com/docs/projects/assets/packages, am 2026-09-29 gelesen) beschreibt:

- Jede Objekt-Hierarchie kann zu einem **Package** mit eigenem Versionsverlauf werden (`PackageLink`); Einfügen als Kopie; **Version History, Restore, Vergleichs-Viewer** (`Compare Package Versions`); **Mass Update** / **Einzel-Update** / **Auto-Update**; **nested packages** (Komposition).
- Für unser Thema am wichtigsten, wörtlich der Doku nachgeordnet: Beim Update einer Paketkopie werden **pro Instanz geänderte Konfigurationswerte erhalten**, während andere Attribute auf den neuesten Standardwert aktualisiert werden ("modified configuration values will be preserved, while other attributes will be updated to the latest default value").
- Lokal bearbeitete Pakete deaktivieren Auto-Update, bis die Änderung veröffentlicht oder verworfen wird — bewusste Trennung „instanz-eigene Änderung" vs. „Upstream-Version".

**Lehre:** Das ist das ADR-0020-Muster (`meta.json`-Defaults → Level-Overrides) in Industriedimension, und Roblox **erhält die feldweisen Instanz-Änderungen über ein Upstream-Update hinweg explizit**. Genau der Gegensatz zu Bethesdas verlustbehaftetem Ganz-Record-Ersatz (§4.2). Overrides sind **Patch-Daten am Instanz-Branch**, kein zwischengespeicherter Endzustand.

**Stardew Valley / SMAPI — Content Packs: reine Daten, Manifest mit Loader-Referenz [V]**

Die offizielle Stardew-Wiki (Modding:Modder Guide/APIs/Content Packs) beschreibt:

- Ein **Content Pack** ist ein Ordner mit `manifest.json` (`ContentPackFor` = welche Framework-Mod ihn konsumiert, `UniqueID`, Version, Abhängigkeiten). SMAPI **führt es nicht aus** — es sind Dateien, die die eigene Mod liest (`ReadJsonFile`, `LoadAsset`, …).
- **Load-Reihenfolge wird nach Abhängigkeiten sortiert** („Content packs are listed in load order, so they're already sorted for dependencies. … B requires A, they'll be listed in the order A → B").
- Jeder Content Pack kann einen **`i18n/`-Ordner** mit Übersetzungen tragen — Text-IDs + Sprachdateien, das Muster aus Entscheidung 7, in Produktion.
- Die Framework-Mod **Content Patcher** wendet reine **Daten-Patches** an: Aktionen `Load`, `EditData`, `EditImage`, `EditMap`, mit `Target`, `FromFile`, Bedingungen und eigener `Format`-Versionsnummer (aktuell 2.8.0). `Load` ersetzt ein Asset, `EditData` merged/überlagert — die explizite Wahl „replace" vs. „merge **je Patch**", die §4.3 (Minecraft, Factorio) als Merkmal guter Systeme nennt und Bethesdas ESP fehlt.

**Lehre:** Ein deklaratives Patch-Vokabular über einem ID-Namensraum ist kein Zukunfts- oder Modding-Nischenkonzept, sondern ein täglich aktives Produktionsmodell mit Tausenden Creators. Unser zweistufiges Layering (meta.json → level.json) kann, falls je ein zweiter Konsument entsteht (§12a-2: heute nein), exakt nach diesem Vorbild erweitert werden — ohne dass wir es heute bauen.

**Baldur's Gate 3 / Larian — `.pak` + getrennte Lokalisierungs-/Voice-Archive [S]**

Community-Moddings-Doku (bg3.wiki/wiki/Modding:PAK_files) und Larian-Forum:

- Spiel- und Mod-Inhalte liegen in **`.pak`-Archiven**; Level-/Dialog-/Definitionsdaten als binäres `.lsf` (im Editor-Tooling zu lesbarem `.lsx` konvertiert); **Lokalisierungstexte getrennt** (`English.pak` mit `.loca`) und **Stimmen getrennt** (`Voice.pak`, `.wem`); Mods tragen ein `meta.lsx`-Manifest (Autor, Version, Abhängigkeiten).
- Larian-Forum: `.lsv`-Spielstände sind bereits komprimiert.

**Lehre:** Sogar ein AAA-Studio trennt Weltdaten, Text-Lokalisierung und Sprachdaten **physisch** — genau die Trennung, zu der Entscheidung 7 uns zwingt, inklusive Audio-Konsequenz (§15.2). Mod-Manifeste existieren (`meta.lsx`); unsere `app.json` ist das bewusst kleinere Gegenstück (Invariante 10).

**Vorsicht-Falle:** `.pak` ist ein **Binär-Archiv**; für Web-Play sprechen §6.4/9.8 (viele kleine gehashte Dateien) weiter gegen ein Archiv als Primärformat. `.pak` belegt nur das *Layering-Konzept*, nicht das *Containerformat*.

**Synthese (Schlussfolgerung der Recherche, keine Einzelquelle):**
1. Der heutige lebende Standard für „Inhalt als Datenpaket" ist **Manifest + Versions-/Abhängigkeits-Ordnung + Load-Reihenfolge** — Invariante 6, nicht mehr.
2. Instanz-Overrides überleben Upstream-Updates nur als **Feld-/Patch-Overrides** (Roblox, Content Patcher) — nie als Ganz-Objekt-Ersatz (Bethesda-Warnung, §4.2).
3. Lokalisierung ist überall **getrennt abgelegt** (Content-Pack-`i18n`, `English.pak`, bei uns geplant `content/<sprache>.json`).

### 15.2 Audio-Pipeline & Sound-Assets (Lückenschluss)

**Ausgang:** Das Papier behandelt Audio durchgängig nicht; The Whisper hat aber realen Sound-Bedarf (und die Auftraggeber-Nennung „Sound" in der Ausgangsfrage).

**Middleware-Modell Wwise / FMOD [S]** (offizielle Seiten am Stichtag nicht abrufbar — Captcha/JS; nur aus Suchsnippets der offiziellen Doku):

- Beide kompilieren ein Authoring-Projekt in **SoundBanks**; lokalisierte Sounds liegen in **sprachspezifischen SoundBanks** (Wwise-Integrationsdoku: „Localized sound objects are found in language-specific SoundBanks in subdirectories"); FMOD empfiehlt für mehrere gesprochene Sprachen **„localized audio tables"**.
- Wiedergabe läuft über **Events/IDs**, nicht über Dateipfade; lange Audio-Anteile werden gestreamt statt im Speicher gehalten.

**BG3 [S]** hält Stimmen getrennt im eigenen `Voice.pak` (§15.1) — physische Trennung Voice/SFX auch dort.

**Web-Kontext:**

- Browser-Autoplay-Politik: Audio-Ausgabe braucht zu Beginn eine Nutzergeste — ein Engine-/App-Verhalten, kein Formatthema; hier nur als Rahmung erwähnt.
- Lange/amorphe Audioströme gehören in **eigene, gehashte Streaming-Dateien** (WebAudio/`<audio>`-Quellen), nicht in einen Blob — die Unity-WebGL-Monolith-Lehre (§6.6) gilt für Audio doppelt.
- `KHR_audio_graph` ist als glTF-Extension erst **Proposal** [V] (§15.4) — nicht darauf bauen.

**Konsequenz (neu; über §12a hinaus — braucht Zustimmung):** Audio ist **Inhalt** und folgt denselben Regeln wie alles andere: (a) Assets bei dem, der sie nutzt (Level/App), Teilbares als Kit; (b) im App-Manifest erfasst; (c) **sprachabhängige Sets getrennt** (`content/<sprache>/vo/…`), SFX/Ambience sprachunabhängig; (d) **Event-IDs statt Pfade** im Level-/Cue-Format. *Kein* Wwise-Äquivalent, *kein* eigenes Bank-Subsystem jetzt (Invariante 10). Das **ID-Layout** ist der einzige heute nötige, nicht rückholbare Schritt — eine direkte Parallele zu Entscheidung 4 (Savegame-Format v1 vor dem ersten Speichern-Feature).

### 15.3 Savegame-Interop & ID-Stabilität

**Minecraft DataFixerUpper (DFU) [V]** — die stärkste Bestätigung für Entscheidung 4:

- Mojang stellt die Welt-/Save-Migration als **eigene Open-Source-Bibliothek** (MIT, github.com/Mojang/DataFixerUpper) zur Verfügung: „a library developed and used by Mojang for handling world upgrades and version changes … migrate data entries such as **ids** and the format of how data is stored" (minecraft.wiki/DataFixerUpper und Quell-/Release-Repo, am 2026-09-29 gelesen).
- Eingesetzt ab Java-Edition 1.13; Welten werden **automatisch auf neue Formate migriert** und Sicherungskopien des Vorgängerformats bleiben erhalten (minecraft.wiki/Anvil_file_format, gelesen: „automatically convert worlds to the new format, but a copy of the world files is created in the previous formats").
- Die Data-Version wird im Welt-Stand getragen (`level.dat`; `DataVersion`-Feld — Details als [S], Unterseite nicht gelesen).

**Zwei redundante Industriebelege für Invariante 9:** DFU (Migration inklusive ID-Umschreibung, produktiv) und Handmade Hero (`hha`-Upgrade-Tool, Tag 465, §4.5). Unsere Regel **„IDs werden nie wiederverwendet" + `schemaVersion` + Migrationskette** ist damit kein Sonderweg, sondern das von Mojang produktiv gefahrene Muster. Der Zeitpunkt „Format v1 **vor** dem ersten Speicherfeature" (§12a-4) bleibt richtig — DFU kam bei Mojang *nach* dem Schema, mit jahrelangem Legacy-Schlepp als Folge.

**Gegenmittel-Ableitung:** DFU + automatische Welt-Backups zeigen, dass **vor jeder Migration ein Backup** gehört — für Whisper eine billige Snapshot-Kopie in OPFS/IndexedDB (Data-Protection, kein Formatthema).

**Stardew Saves [S]** (offizielle Wiki, Snippet): Save-Dateien tragen das letzte Speicher-`<gameVersion>`; ältere Spielversionen laden neuere Stände häufig nicht — **Versionstor ohne Migration**. Kontrastfall: Entscheidung 4 wählt bewusst die DFU- statt der Stardew-Seite.

**Hades (Supergiant) [S]** (Ankündigung des „Pluto"-Save-Editors, r/HadesTheGame): proprietäres Serialisierungsformat; ein wesentlicher Teil der Save-Daten ist **durch Inhaltsdefinitionen (Lua) getrackt** — Spielstände koppeln sich an Inhalts-IDs. Unterstreicht exakt das in §9.6 benannte Risiko „Content-Update bricht Spielstände", das unser ID-Referenz-Verbot adressiert.

**Konsequenz:** Entscheidung 4 bleibt, jetzt doppelt belegt. Zusätzlich vorgeschlagen (nicht verbindlich, ADR-Kandidat bei Umsetzung): (1) Savegame-Backup vor Migration als Default; (2) Savegame speichert nur **ID-Referenzen + minimale Zustandsflags**, nie Serialisierungen von Inhalts-Objekten (Props/Lichter) — mit der Roblox-Erhalt-Semantik (§15.1) als Nachweis, dass Overrides-getrennt-von-Inhalt industriell funktioniert.

### 15.4 Web-/glTF-Ökosystem: Status-Update zum Stichtag 2026-09-29

Offizielle Statusangaben aus dem glTF-Extensions-Registry-README (raw.githubusercontent.com/KhronosGroup/glTF/main/extensions/README.md, am 2026-09-29 gelesen, **[V]**):

| Punkt | Stand in §6.1 (Papier) | Heute 2026-09-29 | Folge |
| :--- | :--- | :--- | :--- |
| `KHR_interactivity` | Widerspruch „Registry: Ratified" vs. Pressemeldung „Submitted for ratification" | **Ratified** (in der Registry-Liste der ratifizierten Khronos-Extensions) | Widerspruch ist aufgelöst; §11-Beobachtung entfällt. Verhaltensgraphen als glTF-Standard sind jetzt reif — für uns aber weiter optional (eigenes `SW_*`-Design bleibt zulässig) |
| `KHR_node_visibility` / `KHR_node_selectability` / `KHR_node_hoverability` | nicht erwähnt | **Ratified (neu)** | Direkt relevant für Maker: genau die Anzeige-/Auswahl-/Hover-Semantik für Nicht-Mesh-Nodes, für die wir heute eigene Helfer bauen — **vor weiterem Eigenbau prüfen, ob die Standard-Extension reicht** (beobachten, nicht übernehmen) |
| `KHR_gaussian_splatting`, `EXT_texture_webp` | — | Ratified (neu) | WebP-Texturpfad jetzt als Extension standardisiert; für Kits beobachtenswert |
| `KHR_audio_graph` | — | **Proposal** (PR #2421) | §15.2: nicht darauf bauen |
| `KHR_physics_rigid_bodies` | Review Draft (PR #2424) | Review Draft (PR #2424) | unverändert; §11-Beobachtung bleibt |
| glTF External References (glXF) | „Cross-File-Referenzen sind noch Proposal" | **Proposal**; eigenes Khronos-Repo `glTF-External-Reference`; explizit „not currently a specification"; 2022er-Spec-Dokumente sind obsolet, Ersatzdokumente erst für 2H2025 angekündigt | §6.1-Schluss **bestätigt**: nicht warten; die Aufteilung „Level-Datei referenziert Kit-glTFs" bleibt fürs Erste das richtige Muster |
| Vendor-Prefix-Registrierung | „jeder kann per GitHub-Issue einen Präfix beantragen" | bestätigt (README; Ablauf: Name, Firma, URL/Kontakt per Issue) | Entscheidung 6 (SW_ vorerst informell) unverändert; erneute Abwägung weiterhin nur vor externer Veröffentlichung |

Zusätzlich bestätigt [V]: `extensionsUsed`/`extensionsRequired`-Mechanik unverändert; „Extensions can't remove existing glTF properties or redefine existing glTF properties to mean something else" — unsere `SW_*`-Hygiene sowie die Entscheidung, `SW_*` standardmäßig in `extensionsUsed` (nicht `extensionsRequired`) zu halten (§5.2), bleiben konform.

**Browser-Speicher [S]** (MDN OPFS + web.dev): Status unverändert — OPFS breit verfügbar und standardisiert, `showOpenFilePicker` weiterhin Chromium-only. §6.3-Fallback-Empfehlung (OPFS als Arbeitsspeicher, ZIP-Import/Export, Chromium-only-Autor-Modus als akzeptierter Kompromiss) bleibt heute unverändert gültig. Kein Handlungsbedarf.

### 15.5 Konsequenzen für die Entscheidungen (§12a)

Diese Ergänzung stützt und präzisiert; sie reißt keine Entscheidung auf.

- **Entscheidung 4 (Savegame: ja, Format v1 vor erstem Feature):** durch Minecraft-DFU produktiv belegt (§15.3). Zusatz (beim Bauen verbindlich machen): Backup-vor-Migration und ID-Referenz-Verbot sind harte Regeln, nicht Empfehlungen. Der in §13 vorgeschlagene ADR „Savegame-Format" bekommt mit §15.3 seine Industriebelege.
- **Entscheidung 2 (kein Mod-System):** bestätigt durch §15.1 — Content-Pack-/Patch-Mechanismen (SMAPI, Content Patcher, meta.lsx) sind reife Vorlagen, bleiben aber bewusst ungebaut, bis ein zweiter Konsument sie verlangt (Invariante 10). Wenn es je kommt: Content Patcher ist das strukturelle Vorbild für die „replace/merge je Patch"-Semantik.
- **Entscheidung 3 (Maker editiert ganze Apps):** Roblox-Packages zeigen, dass Instanz-Override-Erhalt industrieüblich und technisch machbar ist; Makers Undo als `(id, path, old, new)` (§12a-3) ist mit dem Roblox-Modell konsistent. Kein Widerspruch.
- **Entscheidung 7 (Lokalisierung):** SMAPI-Content-Pack-`i18n` und BG3-`.loca` bestätigen das Text-ID-Modell als Produktionsstandard. **Neu abgeleitet (braucht Zustimmung):** Sprache betrifft nicht nur Text, sondern auch **Stimme** — `content/<sprache>.json` bekommt früher oder später ein `content/<sprache>/vo/…`. Einplanen, aber erst umsetzen, wenn die erste Sprachdatei real entsteht (kein Vorratsbau).
- **Entscheidung 6 (`SW_`-Präfix):** unverändert; Khronos-Prozess bestätigt. Zusätzlich beobachten: `KHR_node_visibility/_selectability/_hoverability` als möglicher künftiger Standardersatz für eigene Maker-Helfer-Semantik.
- **Entscheidung 1 (Referenzbeispiel „mit allem, was wir bieten"):** Audio ist eine der sichtbarsten Lücken eines Referenzbeispiels; §15.2 hält fest, dass nur das **ID-Layout** jetzt nötig ist — die Scope-Creep-Warnung aus §12a-1 bleibt die maßgebliche Gegenlese.

**Kein Anpassungsbedarf** in §9/§10: Die Ergänzung ist zu den dortigen Weichen konsistent. §10-Schritt 7 (Savegame-Format-Entwurf) rückt laut §12a ohnehin vor Entscheidung in der ersten Runde — §15.3 liefert dafür die Belege, nicht neue Schritte.

### 15.6 Quellen dieser Ergänzung

Alle Angaben nach demselben Schlüssel wie §0; `[V]` = Seite am 2026-09-29 gelesen.

- Roblox — Packages (offizielle Creator-Hub-Doku): https://create.roblox.com/docs/projects/assets/packages **[V]**
- Stardew Valley Wiki — Modding:Modder Guide/APIs/Content Packs: https://stardewvalleywiki.com/Modding:Modder_Guide/APIs/Content_Packs **[V]**
- Stardew Valley Wiki — Modding:Content Patcher: https://stardewvalleywiki.com/Modding:Content_Patcher **[V]**
- Stardew Valley Wiki — Saves: https://stardewvalleywiki.com/Saves **[S]**
- bg3.wiki — Modding:PAK files: https://bg3.wiki/wiki/Modding:PAK_files **[S]**
- Larian-Forum — „lsv bereits komprimiert": https://forums.larian.com/ubbthreads.php?ubb=showflat&Number=641216 **[S]**
- FMOD Docs — Dialogue and Localization: https://www.fmod.com/docs/2.03/studio/dialogue-and-localization.html **[S]** (Seite am Stichtag nicht abrufbar)
- Audiokinetic — Wwise Integration Demo Sample (lokalisierte SoundBanks): https://www.audiokinetic.com/library/2025.1.4_9062/?source=SDK&id=soundengine_integration_samplecode.html **[S]** (Suchsnippet)
- Mojang — DataFixerUpper (Quelle/Releases): https://github.com/Mojang/DataFixerUpper/ **[V]**
- Minecraft Wiki — DataFixerUpper: https://minecraft.wiki/w/DataFixerUpper **[V]** · — Anvil file format: https://minecraft.wiki/w/Anvil_file_format **[V]**
- Reddit r/HadesTheGame — „Introducing Pluto, a Hades Save Editor": https://www.reddit.com/r/HadesTheGame/comments/eo3enn/introducing_pluto_a_hades_save_editor/ **[S]**
- Khronos — glTF 2.0 Extension Registry (README, Stichtag 2026-09-29): https://raw.githubusercontent.com/KhronosGroup/glTF/main/extensions/README.md **[V]**
- Khronos — glTF-External-Reference (glXF): https://github.com/KhronosGroup/glTF-External-Reference/tree/main **[V]**
- MDN — Origin private file system: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system **[S]** · web.dev — The origin private file system: https://web.dev/articles/origin-private-file-system **[S]**

---

## 16. Anhang: Ideensammlung „Zielbild: Composition & Export" (2026-09-30)

> **Auftrag:** Auftraggeber-Ideen zur Frage „Wie bauen wir aus Engine-Bausteinen ein fertiges Spiel zusammen und wie liefern wir es aus?" dokumentieren.
> **Art:** Kompass/North-Star mit Praxis-Nachweis — **keine Entscheidungen** (§12a bleibt maßgeblich), **kein Bauvorhaben** (Invariante 10). Wo eine Idee bestehenden Text überholt oder genauer fasst, ist das explizit markiert.
> **Disziplin:** Marker wie §0; die Web-Praxis-Belege sind überwiegend `[S]` (offizielle Tutorials/Wikis, per Suche gefunden). Historische Aussagen bleiben unangetastet; dieser Anhang reißt §9/§10/§12a nicht auf.

### 16.1 Die leitende Frage

Small World Machine ist eine Engine; der Name trägt die Idee, dass man sich seine Welt baut. In unserem Sinn: **The Whisper** als Spiel, das von der Engine angetrieben wird. Damit verschiebt sich die eigentliche Frage gegenüber Abschnitt 1:

> **Wie konfigurieren/bauen wir ein fertiges Spiel aus Engine-Bausteinen zusammen — und was ist am Ende das auslieferbare Ding?**

Persistenz und Manifest (§7–9) sind dafür *Mittel*, nicht Zweck; Abschnitt 8/9 bleibt der Kern. Als pragmatisches Vorbild nennt der Auftraggeber das Godot-Modell: Ein Builder **schraubt eine gesamte Anwendung zusammen** (mit allem, was man braucht) und speichert sie in *seinem eigenen Format*; erst ein **Export** erzeugt das Artefakt für die gewünschte Zielplattform — z. B. Web → fertige ZIP, die man auf einen Webserver lädt und die läuft.

Metapher des Auftraggebers: „Das ist wie die Reise zum Mars — und wir wissen noch nicht einmal, wie man segelt." Der Abschnitt dokumentiert das Zielbild; der heutige „Segelschritt" bleibt Schritt 1 (`app.json`, §10).

### 16.2 Auftraggeber-Positionen (Ideensammlung, nicht verbindlich)

1. **App-Grenze als Package:** Alles, was zum Spiel gehört und nicht Teil der allgemeinen Engine ist, wird ausgelagert — als Package, z. B. **`@small-world-machine/the-whisper`**. **Kits und Assets gehören dorthin** (Schmerzpunkte 2 und 3, §2.3).
2. **Kit-Frage (weicht von §9.4/ADR 0011 Phase 2 ab):** Kits **physisch in den App-Baum**, aber `kit.json`-Manifeste intakt lassen — eine spätere Ausgliederung bleibt dann ein Ordner-Umzug, kein Re-Architect. Heute spricht §12a-2 (ein Konsument) dafür; bewusste **Scope-Reduktion** von ADR 0011, *noch keine formale Entscheidung*. Verbindlich wird es erst mit der ersten Umsetzung.
3. **Package-Form:** Workspace-Package mit `private: true` — **keine publishbare npm-Lib** (niemand konsumiert Whisper-Code per `npm i`). Öffentliche API sind die Dateiformate (`app.json`, `level.json`, `SW_*`); Versionierung läuft über die Formate, nicht npm-SemVer (§5.4). Ein „eigenes Repo/eigene CI" bleibt als späterer reiner Ordner-Umzug möglich.
4. **Eine Zielform heute:** statischer Ordner + Host. Andere Formen (Offline, Messe, Weitergabe) bleiben **dokumentierte spätere Optionen**, kein Bauvorhaben.

### 16.3 Wie machen es andere? (Praxis-Nachweis)

Alle untersuchten Werkzeuge folgen demselben Skelett: **eigenes Composition-/Projektformat → Build-Pipeline → pro Zielplattform ein Artefakt**. Fürs Web ist dieses Artefakt durchgängig eine selbst-enthaltene ZIP / ein fertiger Build-Ordner — keine Source-Dateien.

| Werkzeug | Composition-Format | Web-Artefakt | Beleg |
| :--- | :--- | :--- | :--- |
| Godot | `project.godot` + Export-Presets | `wasm` + `.pck` als ZIP | [V] (§3.3) |
| Construct 3 | `.c3p`-Projekt | Web-(HTML5-)Export → ZIP, „which contains all the files" (offizielles Tutorial) | [S] |
| Defold | `game.project` | HTML5-Bundle als ZIP (offizieller Blog) | [S] |
| GDevelop | Projekt | `File > Export > Web` → HTML5-Ordner / Single-File (offizielles Wiki) | [S] |
| RPG Maker MV/MZ | Projekt + Deployment | `Deployment → Web Browser` → ZIP zum Hochladen | [S] |
| PlayCanvas | Cloud-Projekt | Build-Export als ZIP (§3.6) | [S] |
| Unity / Unreal | Projekt + Editor | Plattform-Build; Unity trennt mit **Addressables** Content- von Code-Build (für Kits beobachtenswert) | [U] |
| Needle Engine | Unity/Blender → **generiertes Vite-Projekt** (`assets/` + `scene.glb` + Komponenten-Extensions) | der uns *architektonisch* nächste Präzedenzfall (§6.6) | [S] |

### 16.4 Analyse: Was ist universell, was ist anders

- **Universell (deckt Invariante 2, §7-2):** Die Trennung Authored/Composition ≠ Cooked/Build ≠ Runtime ist bei allen identisch. Der Weg ist „derselbe", **weil es die einzige funktionierende Architektur ist** — das ist Physik, kein Kopieren.
- **Nicht übertragbar, Punkt (a) — die Plattform-Matrix:** Godot/Unity exportieren in 10+ Ziele; Small World Machine hat **genau ein** natiches Ziel (statische Web-Dateien). Die „gleiche Spur" kollabiert hier zu: *ein* Composition-Format + *eine* Build-Pipeline (Vite) + optionaler Trivial-ZIP-Transport. **Kein Export-Framework, keine Ziel-Registry, kein Adapter-Pattern als Vorsorge.**
- **Nicht übertragbar, Punkt (b) — Player-Runtime bündeln:** Jeder Vergleich packt eine *eigene Engine-Runtime* ins Artefakt (Godot-WASM, Construct-, Defold-, RPG-Maker-Laufzeit). Small World Machines Engine *ist* bereits der Browser-Code — das Artefakt enthält nur **Inhalt + Erst-Partei-Code über Vite**. Wir sind um eine ganze Schicht billiger; genau deshalb bleibt der Export trivial.

### 16.5 Verhältnis zu bestehenden Entscheidungen

- **Entscheidung 8 (kein Einzeldatei-Artefakt) bleibt — mit Präzisierung:** Eine **Transport-ZIP** (fertige Build-Ordnerstruktur → `zip` → Serverseite unzip → statische Dateien) ist **orthogonal** zum Archiv-Begriff aus §6.4/9.8 (dort geht es um das *Laufzeit-Laden* vieler kleiner gehasster Dateien). Die Über-Absage „kein Archiv, *auch* nicht als Export" aus §12a-8 wird **nicht erneuert**: Autorier-Format bleibt archivfrei, Export-Packaging bleibt offen und billig — Tür offen, nichts gebaut. Kein Widerspruch zu §12a-8 inhaltlich (kein Einzeldatei-Artefakt *als Laufzeitform*), nur sprachliche Korrektur des „auch".
- **Zu §12a-1 (The Whisper wird eigenständiges Projekt):** Diese Ideensammlung konkretisiert das Zielbild aus §12a-1, ändert dessen Reihenfolge der ersten Runde (§12a) aber nicht.
- **Kein Godot-Editor heute:** Die „Zusammenschraub"-Schicht beginnt mit Schritt 1 (`app.json`); der Builder/Editor entsteht erst aus Maker (§12a-3). Der volle Godot-artige Komplett-Builder ist der Mars — heute segeln wir nur bis Schritt 1.

### 16.6 Quellen dieser Ergänzung

- Construct 3 — Publishing to the web (Tutorial): https://www.construct.net/en/tutorials/publishing-web-10 **[S]**
- Defold — Releasing HTML5 games on Game Distribution: https://www.defold.com/2021/03/14/Releasing-html5-games-on-Game-Distribution/ **[S]**
- GDevelop — Manually export as HTML5 in a local folder: https://wiki.gdevelop.io/gdevelop5/publishing/html5_game_in_a_local_folder/ **[S]**
- RPG Maker — Deploy for web browser (r/RPGMaker): https://www.reddit.com/r/RPGMaker/comments/142xrls/how_to_publish_game_as_an_app_or_web_based_game/ **[S]**
- Interne Verweise: §3.3 · §3.5 · §3.6 · §6.6 · §7-2 · §12a-1 · §12a-2 · §12a-8 · ADR 0011
