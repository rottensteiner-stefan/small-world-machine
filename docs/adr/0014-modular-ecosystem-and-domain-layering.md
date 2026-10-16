# ADR 0014: Modulares Ökosystem und Domänen-Schichtung — Auflösung von `extensions/`

## Kontext & Problem

Das Verzeichnis `src/extensions/` wurde ursprünglich als Auffangordner für "modulare Logik, die auf dem Kern der Engine aufbaut, aber für grundlegendes 3D-Rendering nicht erforderlich ist" eingeführt. Mit der Zeit entstand daraus ein klassisches **"Grab-Bag"-/Rumpelkammer-Anti-Pattern**:
1. **Unklare Domänen-Grenzen:** Grundlegend verschiedene Architekturschichten wurden in denselben Ordner geworfen:
   - Rendering-Primitive und LOD-Helfer (`BillboardInstancer`, `ImposterBaker`)
   - Gameplay-KI und prozedurale Animation (`RatGroomingBehavior`, `GroomingRat`)
   - Umgebungs-/atmosphärische VFX (`WeatherEmitter`)
   - Prozedurale Level-Generierungs-Werkzeuge (`GridLevelBuilder`)
2. **Aufblähung des Wurzel-Namensraums:** `src/index.ts` exportierte `export * from "./extensions/index.js"` und zwang so alle Konsumenten und Engine-Bundles dazu, Level-Generatoren, Kreaturen-KI und Wetter-Emitter im globalen Engine-Namensraum mitzuführen, was Tree-Shaking und architektonischer Klarheit schadete.
3. **Fehlendes Erweiterungs-Protokoll:** Es gab keine formale Definition dessen, was als Engine-Kern-Subsystem, als Behavior, als Umgebungs-Komponente oder als Tool-/ProcGen-Werkzeug gilt.

### Branchen-Vergleichsanalyse

Wir haben verglichen, wie branchenführende 3D-Engines Kern- vs. optionale/Ökosystem-Module strukturieren:
- **Three.js (`three/addons/*`):** Hält den `three`-Kern strikt fokussiert auf Mathematik, Szenengraph, Kameras und grundlegende Render-Passes. Spezialisierte Loader (`GLTFLoader`), Kamerasteuerungen (`OrbitControls`), Post-Processing-Passes und prozedurale Helfer leben unter `three/addons/*` mit expliziten Subpath-Importen, was Verschmutzung des Kern-Namensraums verhindert.
- **Babylon.js (Monorepo & SceneComponent-Plugins):** Trennt den Kern (`@babylonjs/core`) strikt von spezialisierten Domänen (`@babylonjs/materials`, `@babylonjs/gui`, `@babylonjs/loaders`, `@babylonjs/procedural-textures`).
- **Godot Engine:** Hält einen schlanken C++-Kern. Szenengraph-Logik wird über eigene Nodes/Skripte erweitert, und High-Level-Werkzeuge oder Spiel-Utilities leben in expliziten Domänen-Ordnern oder Projekt-`addons/`, ohne die Engine-Primitive zu verschmutzen.
- **Unity:** Trennt spezialisierte Systeme (VFX Graph, Splines, AI Navigation, Input System) in dedizierte UPM-Pakete, die über den Kern-Laufzeit-Assemblies liegen.

---

## Entscheidung

Wir **lösen `src/extensions/` vollständig auf** und etablieren ein striktes 4-Stufen-Domänen-Schichtungsmodell für Small World Machine:

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Tier 4: Tools & ProcGen (`packages/engine/src/tools/`, `.../procgen/`)   │
│  (GridLevelBuilder, MakerApp, Bakers, Asset Importers)                   │
├───────────────────────────────────────────────────────────────────────────┤
│  Tier 3: Behaviors & Simulation (`packages/engine/src/behaviors/`)       │
│  (OrbitController, RatGroomingBehavior, AI, Controllers)                 │
├───────────────────────────────────────────────────────────────────────────┤
│  Tier 2: Environment & VFX (`packages/engine/src/environment/`)          │
│  (WeatherEmitter, LiquidSurface, Skybox, Atmosphere)                     │
├───────────────────────────────────────────────────────────────────────────┤
│  Tier 1: Engine Core (`packages/engine/src/{core,math,renderers,geometry}/`) │
│  (Scene Graph, BillboardInstancer, ImposterBaker, PBR, Passes)           │
└───────────────────────────────────────────────────────────────────────────┘
```

### 1. Konkrete Migrationsziele

| Aktueller Ort | Neue architektonische Domäne | Begründung |
| :--- | :--- | :--- |
| `src/extensions/billboard/BillboardInstancer.ts` | `src/core/objects/BillboardInstancer.ts` (oder `src/core/entities/`) | Kern-Szenengraph-Primitiv, das `InstancedMesh` für kamerazugewandte Quads direkt umhüllt. |
| `src/extensions/imposter/ImposterBaker.ts` | `src/renderers/imposter/ImposterBaker.ts` | Spezialisiertes Renderer-Werkzeug / LOD-Generierungsmechanismus. |
| `src/extensions/weather/WeatherEmitter.ts` | `src/environment/weather/WeatherEmitter.ts` | Atmosphärisches Umgebungssystem (Regen, Schnee, Umgebungspartikel). |
| `src/extensions/creatures/RatGroomingBehavior.ts` | `src/behaviors/creatures/RatGroomingBehavior.ts` | Standard-Small-World-Machine-`Behavior`, an Entitäten für Umgebungsleben angehängt. |
| `src/extensions/creatures/GroomingRat.ts` | `src/behaviors/creatures/GroomingRat.ts` (oder Beispiel-Kreatur-Entität) | Entitäts-Komposition, die ein Mesh mit seinem Pflege-Behavior bündelt. |
| `src/extensions/grid-builder/GridLevelBuilder.ts` | `src/tools/procgen/GridLevelBuilder.ts` | High-Level-Level-Builder / Kartengenerierungs-Werkzeug für rasterbasierte Szenen. |

**Status (2026-09-12):** Alle 6 Migrationsziele umgesetzt und verifiziert. `BillboardInstancer`
lag bis dahin noch flach unter `src/core/BillboardInstancer.ts` statt unter `src/core/objects/`;
`RatGroomingBehavior`/`GroomingRat` lagen noch unter `src/core/behaviors/creatures/` statt am
eigenen Top-Level `src/behaviors/creatures/` (Geschwister von `src/core/`, wie im Tier-Diagramm
oben gezeichnet) — beide jetzt nachgezogen, alle Imports (inkl. `src/index.ts`, `src/core/index.ts`,
Tests) aktualisiert, volle Testsuite (744 Tests) grün.

### 2. Export- & Namensraum-Regeln

1. **Kern-Paket-Oberfläche (`packages/engine/src/index.ts`):**
   - Kern-Primitive (`BillboardInstancer`), Umgebungssysteme (`WeatherEmitter`) und Standard-Behaviors werden aus ihren jeweiligen Domänen-Namensräumen exportiert (`./core/index.js`, `./environment/index.js`, `./behaviors/index.js`).
2. **Tooling & ProcGen:**
   - ProcGen- und Erstellungswerkzeuge (`GridLevelBuilder`, `MakerApp`) werden unter `./tools/index.js` oder dedizierten Tool-Einstiegspunkten exportiert, was Laufzeit-Engine-Primitive klar von Build-Zeit-/Design-Zeit-Generatoren trennt.
3. **Keine Auffangordner:**
   - Es dürfen keine neuen generischen Wurzelverzeichnisse `extensions/`, `helpers/` oder `misc/` angelegt werden. Jedes neue Feature muss einer eindeutigen Domäne zugeordnet werden (Core, Environment, Behavior, Tool, Renderer, Math, Loader).

---

## Konsequenzen

- **Klarheit & Vorhersagbarkeit:** Entwickler wissen sofort, wo sie nachsehen müssen: Szenen-Nodes in `core/objects`, Controller und KI in `behaviors`, atmosphärische VFX in `environment`, und Generatoren in `tools/procgen`.
- **Sauberes Tree-Shaking:** High-Level-Level-Generierungswerkzeuge sind von grundlegenden Rendering-Primitiven entkoppelt.
- **Architektonische Skalierbarkeit:** Künftige Ergänzungen (z. B. Boids, Bewuchssysteme, Terrain-Generatoren) haben ein klares, vordefiniertes architektonisches Zuhause.
- **Migrationskosten:** Erfordert die Aktualisierung von Importen über bestehende Showcases (`showcase 32`, `showcase 34`), Tests (`tests/extensions/`) und Werkzeuge (`MakerApp`, `AsciiMapLegend`) hinweg.

**Update (2026-09-12):** Diese ADR beschreibt die Domänen-Schichtung *innerhalb* eines einzigen Pakets. Seit der npm-Workspaces-Restrukturierung (`packages/engine` + `apps/*`) gilt dieses Tier-Modell konkret für `packages/engine/src/`; die drei Apps (`the-whisper`, `yad`, `light-cycle-arena`) sind jetzt Unterordner des gemeinsamen Workspace-Package `@small-world-machine/sample-apps` unter `apps/sample-apps/`, das die Engine nur noch über den Package-Namen `@small-world-machine/engine` importiert, nie mehr über relative Pfade. Die Namensraum-Regeln oben (Export-Oberfläche, keine Auffangordner) gelten unverändert für `packages/engine`.
