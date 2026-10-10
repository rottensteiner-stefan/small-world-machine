# ADR 0024: Entwicklungswerkzeuge als eigenes Ökosystem-Paket (`@small-world-machine/tools`)

## Kontext & Problem

Die Kern-Engine verfolgt die Philosophie eines ultraleichten Kerns; Domänenspezifisches wandert in separate Workspace-Pakete (ADR 0014, ADR 0018, ADR 0021, ADR 0022). Aktuell liegen alle Editor-/Diagnose-Werkzeuge (`Maker`, `MaterialStudio`, `Pixler`, `Xtractor`, `MapGenerator`, der `Forge`-Fenstermanager) physisch unter `packages/engine/src/tools/` — Teil des Kern-Pakets `@small-world-machine/engine` —, obwohl eine ausgelieferte Spiel-Anwendung sie zur Laufzeit nie braucht.

Bundle-Größe ist dafür bereits über dynamische `import()`-Aufrufe plus einen bewusst unvollständigen Barrel-Export gelöst (`tools/index.ts` dokumentiert das explizit im Code-Kommentar). Das eigentliche Problem ist also nicht Bundle-Bloat, sondern Paket-/Abhängigkeitsgraph-Klarheit, der Install- und `tsc`-Kompilier-Footprint für Konsumenten, die nur die Engine wollen, und eine bereits an anderer Stelle dokumentierte Lücke: `small-world-machine/tools` ist kein sauber auflösbarer Package-Export.

Der eigentliche Knoten: `SmallWorldMachine.ts` (Kern) importiert selbst dynamisch aus `../tools/...` (`Forge` + vier konkrete Tools), um bei `config.enableInspector` automatisch ein Dev-Overlay zu öffnen. Ein reiner Verzeichnis-Umzug würde daraus eine Abhängigkeit Kern → Tools-Paket machen — genau die Richtung, die ADR 0021 für Extras-Pakete ausdrücklich ausschließt ("kein Extras-Paket darf je `@small-world-machine/engine` importieren … nie umgekehrt" gilt hier spiegelbildlich: der Kern darf nicht von einem extras-artigen Paket abhängen).

## Entscheidung

1. Neues Workspace-Paket `@small-world-machine/tools` unter `packages/tools/`, nach demselben Muster wie `geometry-extras`/`physics-extras`/`vfx-extras`/`gltf-extensions`: hängt von `@small-world-machine/engine` ab, nie umgekehrt.
2. Reine Verschiebung (keine Verhaltensänderung) in dieses Paket: `tools/maker/` (komplett inkl. `docs/`), `tools/material-studio/`, `MaterialStudio.ts`, `Pixler.ts`, `Xtractor.ts`, `MapGenerator.ts`, `tools/forge/Forge.ts`, `ForgeWindow.ts`, `ForgeTheme.ts`.
3. Im Kern bleibt bewusst: `forge/ForgeTool.ts` (die Schnittstelle/der Erweiterungspunkt, schon heute barrel-exportiert) sowie `procgen/GridLevelBuilder.ts` und `IBLShaders.ts`/`ibl-gen.ts` — das sind zur Laufzeit genutzte Engine-Features (z. B. YADs ASCII-Dungeon-Generierung über `GridLevelBuilder`), keine Entwicklungswerkzeuge, auch wenn sie organisatorisch im selben `tools/`-Ordner lagen.
4. `SmallWorldMachine.ts`s hartkodierte Inspector-Verdrahtung (Forge + `MapGenerator`/`Pixler`/`Xtractor`/`MaterialStudio` automatisch öffnen, wenn `enableInspector: true`) wird ersatzlos aus dem Kern entfernt. Stattdessen exportiert `@small-world-machine/tools` eine Funktion `attachDevTools(app: SmallWorldMachine): void`, die genau das tut. Apps, die das In-Game-Overlay wollen, rufen sie selbst auf — das ist die einzige Möglichkeit, die Ein-Weg-Abhängigkeit sauber zu halten, ohne eine weiche/optionale Paketabhängigkeit im Kern zu erfinden.
5. Die vier `public/tools/*.html`-Einstiegspunkte, die direkt aus dem Quellbaum importieren (`maker.html`, `map-gen.html`, `pixler.html`, `pbr-gen.html`), bekommen aktualisierte Importpfade auf `packages/tools/src/...`.

## Erwogene Alternative (verworfen)

`@small-world-machine/tools` als optionale Peer-Dependency von `@small-world-machine/engine` führen und die Inspector-Verdrahtung in `SmallWorldMachine.ts` per rein dynamischem `import("@small-world-machine/tools/...")` (Paketname statt Relativpfad) beibehalten. Verworfen: das macht den Kern implizit abhängig von einem Paket, das seinerseits vom Kern abhängt — eine zyklische Paketbeziehung, nur zur Laufzeit statt zur Kompilierzeit versteckt. Das widerspricht der in ADR 0021 festgelegten strikten Ein-Weg-Regel und würde bei jedem künftigen Tool eine weitere unsichtbare Rückkopplung in den Kern schmuggeln.

## Konsequenzen

- `@small-world-machine/engine`s eigener Quellbaum verliert die komplette Tool-Implementierung (Maker- und MaterialStudio-Module, Pixler, Xtractor, MapGenerator, Forge) — kleinerer Install- und `tsc`-Footprint für reine Engine-Konsumenten.
- `SmallWorldMachine` verliert die Kenntnis konkreter Tool-Klassen; sie kennt danach nur noch `ForgeTool` (die Schnittstelle). Ob auch die `forge`-Property und der `KeyG`-Toggle-Mechanismus in `_onKeyDown` mit auswandern oder als generischer Hook im Kern bleiben, ist bei der Umsetzung zu entscheiden.
- **Breaking Change:** Jede bestehende App, die sich bisher auf `enableInspector: true` allein verlassen hat, um automatisch Forge + die vier Tools zu bekommen, muss beim Umsetzen auf den expliziten `attachDevTools(app)`-Aufruf umgestellt werden. Das ist eine bewusste, nicht stillschweigende Migration.
- Löst die bereits dokumentierte `small-world-machine/tools`-Subpath-Lücke: `@small-world-machine/tools` wird ein echtes, eigenständig auflösbares Paket mit eigenem `package.json`/`exports`.
- Folgeaufwand bei Umsetzung: die vier `public/tools/*.html`-Importpfade, `packages/engine/src/tools/index.ts`-Barrel entsprechend kürzen, neue `packages/tools/package.json` + `tests/`-Verzeichnis (bestehende Maker-/MaterialStudio-Tests wandern mit).
