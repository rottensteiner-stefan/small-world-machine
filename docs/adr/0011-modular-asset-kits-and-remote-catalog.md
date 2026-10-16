# Modulare Asset-Kits & Out-of-Tree-Asset-Bibliotheks-Architektur

## Kontext & Problem

Während das Small-World-Machine-Ökosystem um reichhaltigere Diorama-Szenen, Charaktere, Animationen und 3D-Requisiten wächst (etwa die per Tripo3D generierten Industrie-Schott-Wandlampen, Holzkisten, Wellblech-Ölfässer, polygonalen Schutthaufen und humanoiden Biped-Rigs), wächst das Volumen binärer Assets rasant.

Große Binär-Assets (`.glb`-Modelle, 2K/4K-PBR-Texturkarten, Skelett-Bewegungsclips, Audio) direkt in das Git-Repository des Kern-Engines einzuchecken, verursacht grundlegende Probleme:
1. **Repository-Aufblähung:** Git verfolgt binäre Delta-Historien ineffizient. Die Größe des `.git`-Repositorys wächst monoton und verlangsamt `git clone`, CI-Builds und `npm install` für Entwickler, die nur die TypeScript-Rendering-/Mathe-Laufzeit benötigen.
2. **Kopplung von Engine & Inhalt:** Beispiel-Assets und app-spezifische Requisiten verheddern sich mit den Kernmodulen der Engine.
3. **Auffindbarkeit & Wiederverwendbarkeit:** Assets, die für eine App erstellt wurden (z. B. `and-now`), sind schwer zu durchsuchen, zu betrachten und in anderen Apps oder Werkzeugen (wie `MaterialStudio` oder `Maker`) wiederzuverwenden.

## Entscheidung

Wir etablieren einen 3-phasigen Architekturstandard für modulare Asset-Kits und Out-of-Tree-Asset-Distribution:

### 1. Phase 1: Semantische Kit-Struktur & Metadaten-Standard

**Namensfrage geklärt (2026-09-17):** Der Dateiname für das Kit-Manifest ist `kit.json` --
verbindlich, keine Abweichung mehr zulässig. Erwogen und verworfen:
- `package.json` -- kollidiert mit npm; selbst wenn der aktuelle Workspace-Glob
  (`packages/*`, `apps/*`) `public/assets/kits/*` nicht erfasst, durchsuchen IDEs und andere
  Tools den Baum nach *jeder* Datei mit diesem Namen, nicht nur nach Workspace-Mitgliedern.
- `manifest.json` -- keine harte Kollision (kein PWA-Manifest, kein Vite-Build-Manifest im
  Projekt referenziert), aber der Name ist im Web-Kontext stark mit PWA-/Browser-Extension-
  Manifesten assoziiert -- unnötige Verwechslungsgefahr ohne echten Zugewinn.
- `sw.json` -- kollidiert real mit dem projekteigenen glTF-Vendor-Namensraum `SWM_*`
  (`SWM_prefab_instance`, `SWM_stage_zone`, siehe ADR 0016/0017); neben einer `model.glb` läge ein
  `sw.json` nahe, es für einen Export der `SWM_*`-Extension-Daten dieses Modells zu halten.

**Verbindliches Schema (validiert durch
[`AssetKitValidation.test.ts`](../../packages/engine/tests/loaders/AssetKitValidation.test.ts),
das seit 2026-09-17 jedes Verzeichnis unter `public/assets/kits/` mit einer `kit.json` findet und
prüft -- nicht mehr nur `industrial/` wie zuvor):

- **Ort:** `public/assets/kits/<kit-id>/` (z. B. `industrial/`, `bunker/`, `flakturm/`).
- **`kit.json`** (ein pro Kit, Feldreihenfolge wie unten):
  ```jsonc
  {
    "id": "flakturm",              // == Verzeichnisname, keine Ausnahme
    "name": "Vienna Flakturm Architectural & Bunker Kit",  // Anzeigename, kein separates displayName
    "version": "1.0.0",            // SemVer
    "description": "...",
    "items": [                     // 3D-Requisiten mit model.glb; leeres Array zulässig
      {
        "id": "flakturm/bunker_blast_door",   // IMMER "<kit-id>/<slug>", auch in meta.json gespiegelt
        "name": "Flakturm Heavy Double Blast Door",
        "category": "doors",
        "path": "props/bunker_blast_door/model.glb",     // relativ zum Kit-Root, nicht zum Item
        "preview": "props/bunker_blast_door/preview.jpg", // .jpg ratifiziert, nicht .webp
        "meta": "props/bunker_blast_door/meta.json"       // Pflichtfeld -- jedes Item verweist auf sein meta.json
      }
    ],
    "textures": [                  // optional: reine PBR-Materialien ohne eigenes meta.json
      { "id": "flakturm/concrete_board", "name": "...", "category": "walls",
        "maps": ["albedo.png", "normal.png", "roughness.png", "ao.png"] }
    ],
    "decals": [                    // optional: einzelne PNG-Sticker ohne eigenes meta.json
      { "id": "flakturm/sign_koje42", "name": "...", "file": "sign_koje42.png" }
    ],
    "author": "Small World Machine Studio",
    "license": "CC0-1.0"
  }
  ```
- **`meta.json`** (eines pro `items`-Eintrag, neben dessen `model.glb`): `id` (== das `items[].id`
  aus der `kit.json`), `name`, `category`, `kit` (== die `kit.json`-`id`), `version`,
  `description`, `triangles` (> 0, $\le 25.000$), `materials`, `textures` (Namen der verwendeten
  Maps), `dimensions` (`{width, height, depth}` oder `{radius, height}`), `recommendedScale`,
  optional `sockets` (Anbaupunkte mit `name`, `position`, optional `recommendedLight`), optional
  `hazardClass` (ADR/GHS-Gefahrgutklasse), `author`, `license`.
- **Metrischer Einheiten-Standard:** Alle Kits halten sich strikt an $1{,}0\text{ Einheit} =
  1{,}0\text{ Meter}$.
- **`textures`/`decals`-Einträge** brauchen kein eigenes `meta.json` -- sie haben keine
  Dreieckszahl, keine Bounding-Box, keine Sockets; ihre `id` folgt trotzdem derselben
  `<kit-id>/<slug>`-Konvention.

**Status:** umgesetzt und seit 2026-09-17 für alle drei existierenden Kits (`bunker`, `flakturm`,
`industrial`) einheitlich; zuvor nutzten `bunker`/`flakturm` noch ein abweichendes,
unvalidiertes Schema (`props` statt `items`, `model` statt `path`, kein `meta`-Verweis, kein
Top-Level-`id`) -- eine stille Drift, die der damals nur auf `industrial` hartverdrahtete
Validierungstest nicht erkennen konnte.

**Formales JSON Schema (seit 2026-09-17):** Das obige Schema ist zusätzlich als echtes
[JSON Schema](https://json-schema.org/) (Draft 2020-12) niedergeschrieben --
[`public/schemas/kit.schema.json`](../../public/schemas/kit.schema.json) für `kit.json`,
[`public/schemas/prop-meta.schema.json`](../../public/schemas/prop-meta.schema.json) für
`meta.json` -- unter `public/schemas/`, nicht neben den Kits selbst, weil beide Schemas eine
`"$id"` von der Form `https://small-world-machine.dev/schemas/<name>.schema.json` tragen; sobald
`public/` unter dieser Domain ausgeliefert wird, referenziert die `$id` exakt den Pfad, unter dem
die Datei tatsächlich liegt, statt eine URL zu behaupten, die nirgendwo real bedient wird. Jede
echte `kit.json`/`meta.json` trägt ein `"$schema"`-Feld (relativer Pfad zu `public/schemas/`), das
auf die passende Datei zeigt -- IDEs mit JSON-Schema-Unterstützung (VSCode, WebStorm/PhpStorm)
validieren und autovervollständigen damit schon beim Tippen, nicht erst beim Testlauf.
[`AssetKitValidation.test.ts`](../../packages/engine/tests/loaders/AssetKitValidation.test.ts)
kompiliert beide Schemas per [Ajv](https://ajv.js.org/) und validiert jede reale Datei dagegen.
Ein JSON Schema prüft nur die *Form* eines einzelnen Dokuments (Pflichtfelder, Typen, Patterns);
es sieht nicht über Dateigrenzen hinweg. Cross-File-Prüfungen -- `id` gleich Verzeichnisname,
`item.meta` verweist auf eine wirklich existierende Datei, `meta.kit` gleich der eigenen
`kit.json`-`id` -- bleiben deshalb als eigene Assertions im selben Test bestehen, nicht als
Schema-Keywords erzwungen.

**Bewusst nicht eingeführt:** ein eigenes `meta.json` für `textures`/`decals`-Einträge. Deren
gesamte Metadaten (`id`, `name`, `category`/`maps`/`file`) stehen schon vollständig inline in
`kit.json` -- ein Sidecar-File hätte nur `id`/`name` dupliziert, ohne echten Informationsgewinn
(keine Dreiecke, keine Bounding-Box, keine Sockets, die ein solches File rechtfertigen würden).

### 1.1. Die 4-Tier Geometrie- & Polycount-Budget-Doktrin (2026-10-07)

Pauschale Polycounts (z. B. flache 12.000 Tris für alle Modelle) sind grafiktechnisch ineffizient: Ein 20-cm-Teller mit 12k Tris erzeugt sub-pixeligen **GPU Quad-Overdraw**, während ein 2-Meter-Hochbett dieselbe Polygonzahl benötigt, um Rundungen sauber abzubilden.

Alle Kit-Props folgen daher verbindlich dem **4-Tier-Budget-Rezept** nach Objektgröße (Bounding Box / Volumen) und Relevanz:

| Tier | Kategorie & Beispiele | Bounding-Box ($L_\text{max}$) | Ziel-Budget (Tris) | Standard-Textur |
| :--- | :--- | :---: | :---: | :---: |
| **Tier 1: Clutter / Kleinteile** | Teller, Besteck, Tassen, Schalter, Notizen | $\le 0{,}35\,\text{m}$ | **$800 – 1.500$** | $512 \times 512$ |
| **Tier 2: Medium Props** | Stiefel, Kerosinlampe, Hocker, Eimer, Wandregal | $0{,}35 – 1{,}0\,\text{m}$ | **$2.500 – 4.500$** | $1024 \times 1024$ |
| **Tier 3: Möbel / Großobjekte** | Schreibtisch, Hochbett, Terminal, Schrank, Fässer | $1{,}0 – 2{,}5\,\text{m}$ | **$6.000 – 10.000$** | $1024 / 2048$ |
| **Tier 4: Hero / Architektur** | Bunkertore, Schutthaufen, Schleusen, Fahrzeuge | $> 2{,}5\,\text{m}$ | **$10.000 – 16.000$** | $2048 \times 2048$ |

- **Pipeline-Doktrin:** Die Budgets werden **Upstream bei der Modellerstellung / im Tripo-Export / DCC-Remeshing** (`face_limit` / `decimate`) verbindlich festgelegt, um sicherzustellen, dass Textur-Bakes, UV-Seams und Vertex-Normalen sauber erhalten bleiben. Post-Hoc-Dezimierung ohne UV-Re-Bake ist unzulässig.
- **Status (2026-10-07):** Festgelegt als verbindlicher Standard für alle neuen Kit- und Prop-Erstellungen. Bestehende Original-Assets wurden unverändert beibehalten.

### 2. Phase 2: Out-of-Tree-Repository & CDN-Distribution
- **Dediziertes Asset-Repository (`small-world-machine-assets`):** Binäre Produktions-Assets, rohe DCC-Dateien und Kit-Bündel werden in einem dedizierten Repository oder Git-LFS-Speicher untergebracht.
- **CDN-Distribution:** Assets werden auf ein schnelles CDN veröffentlicht (über GitHub Releases, jsDelivr oder Cloudflare), sodass Szenen Standard-Assets über Remote-URIs referenzieren können, ohne den lokalen Datenträger aufzublähen.

**Status:** teilweise umgesetzt. Binäre Kit- und Goldens-Dateien sind seit 2026-10 per
Git-LFS-Filter im `.gitattributes` erfasst (`.glb/.fbx/.jpg/.png/... → filter=lfs`) und werden als
LFS-Objekte getrackt — das „LFS-Anti-Pattern“ ist also bereits behoben. Was weiterhin **nicht**
umgesetzt ist: das dedizierte Out-of-Tree-Repository `small-world-machine-assets` samt CDN-
Distribution (Remote-URIs) und damit der eigentliche entfernte Katalog-Ingest.

### 3. Phase 3: Laufzeit-Katalog-Ingest & CLI-Tooling
- **`GltfLoader`-Katalog-Auflösung:** `GltfLoader` um Katalog-Alias-Auflösung erweitern:
  ```typescript
  // Löst zum lokalen Cache oder CDN-Fallback auf:
  const lamp = await GltfLoader.loadFromCatalog("industrial/wall_lamp");
  ```
- **CLI-Download-Hilfsprogramm:** Entwickler können Kit-Bündel optional bei Bedarf in ihren lokalen Arbeitsbereich herunterladen:
  ```bash
  npx small-world-machine add kit industrial
  npx small-world-machine add prop industrial/wall_lamp
  ```

**Status:** nicht umgesetzt. Weder `GltfLoader.loadFromCatalog()` noch die `small-world-machine`-CLI
existieren im Code -- setzt ohnehin Phase 2 (ein echtes Remote-Katalog-Ziel) voraus.

## Konsequenzen

- **Leichtgewichtiger Kern-Engine:** Das Kern-Repository von `small-world-machine` bleibt schlank, schnell zu klonen und frei von schwerem binärem Ballast.
- **Modularität:** Ersteller können in sich geschlossene, thematische Asset-Pakete veröffentlichen und konsumieren (z. B. *Graphic Noir Sewer Kit*, *Industrial Bunker Kit*, *Character Starter Kit*).
- **Tooling-Kompatibilität:** `Maker` (Nachfolger von `GadgetInspector`, siehe ADR 0010),
  `MaterialStudio` und künftige In-Game-Szeneneditoren können Asset-Auswahl-Paletten dynamisch
  direkt aus Kit-Manifesten befüllen.
