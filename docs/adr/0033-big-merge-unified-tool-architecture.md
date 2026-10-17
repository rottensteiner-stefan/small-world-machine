# ADR 0033: „Big Merge" — vereinheitlichte Maker-Architektur für Entwicklungswerkzeuge

> **Status: DRAFT** — Entwurf zum Implementierungsstart des „Big Merge" (2026-10-13, Session `big-merge`,
> Konsens 4/4, Plan `.agents/collaborate/big-merge.md`). Noch nicht verbindlich: Die Entscheidung wird erst
> über die Abnahme-Gates der Meilensteine (Plan §8) und mit der finalen Implementierung (M6) promoviert.
> Diese ADR ersetzt bzw. ergänzt die Standalone-Seiten-Festlegung von **ADR 0010 §3** und die
> Persistenz-Semantik von **ADR 0010 §4** und erweitert **ADR 0024** (Paketgrenze bleibt).

## Kontext & Problem

Der aktuellen Werkzeuglandschaft fehlt eine einheitliche Arbeitsfläche und ein gemeinsamer Projektbegriff:
Acht eigenständige `public/tools/*.html`-Seiten (Maker, Xtractor, Pixler, Map Generator, Material
Studio/PBR-Gen, IBL-Gen, Kit-Inspector, Splatter-Gen) plus der Forge-Fenstermanager als In-Game-Overlay
(ADR 0010 §3, durch ADR 0024 in das eigene Paket `@small-world-machine/tools` verlängert) pflegen jeweils
eigene App-Roots, eigene Ingest-Schienen, eigene Undo-Flüsse und eigene AI-Verdrahtung. Der gebundene
Projektordner existiert nur implizit im Maker — `CONTEXT.md` kennt heute keinen Projektbegriff (Finding F6).

User-Vorgabe (Kernauftrag): die Autoren-Werkzeuge in **eine Anwendung** (den Maker) verschmelzen und aus
**einem gemeinsamen Kern** sowohl die Web-Oberfläche als auch eine Kommandozeile bedienen („dual"). Die Web-
Oberfläche bleibt die primäre Hauptfläche; alle bisherigen Tool-URLs müssen weiter funktionieren; der
In-Game-Weg über `attachDevTools`/Forge bleibt unangetastet.

## Entscheidung (provisorisch, per Konsens)

Der Maker wird die **eine Anwendungs-Shell**. Jedes Autoren-Werkzeug wird ein **`ToolMode`-Modul**, das
über einen **dedizierten `ToolMode`-Lifecycle** (mount/unmount/state) in einem modusgetriebenen Host
(„ToolHost") registriert und ausgeführt wird — ausdrücklich **nicht** über den `ForgeTool`-Vertrag: Die
Konstruktions-Signaturen der Werkzeuge sind uneinheitlich, und `ForgeTool` ist ein Overlay-über-Game-Canvas-
Vertrag, keine Shell für Standalone-Arbeitsflächen (Finding F3).

- **URL-Strategie: Entry-Aliases statt Dokument-Swap.** Die Legacy-Adressen `public/tools/*.html` bleiben
  Vite-Eingänge und werden zu Entry-Aliases, die die verschmolzene App mit vorausgewähltem Modus booten
  (`maker.html#<mode>`). Interne Modus-Wechsel sind ein reiner In-App-View-Swap ohne Navigation, damit
  gebundene Projektordner, Undo-Stacks und Auto-Save-Zustand erhalten bleiben (Finding F2).
- **Forge bleibt strikt In-Game.** `attachDevTools`/Forge werden nicht in die Web-App neu aufgestellt; die
  vier ForgeTool-Instanzen bleiben exakt unverändert und werden weiterhin von den Forge-E2E-Harnesses des
  Showcases getestet.
- **Ein gemeinsamer Projektbegriff „Workspace/Project"** wird als zukünftiges Konzept erklärt — noch nicht
  implementiert: ein Projektordner pro Session als gemeinsamer Workspace-Root, aus dem alle Werkzeuge ihre
  Unterstruktur beziehen (vgl. `CONTEXT.md`, Begriff „Workspace/Project").
- **Undo bleibt pro Tool & pro Dokument**, es wird keine globale Undo-Schiene gebaut.

Reichweiten-Deklaration an bestehenden Entscheidungen (Amendments statt Neuaufsetzen, historische ADRs werden
nicht umgeschrieben):

- **[AMEND] ADR 0010 §3** — „Maker erscheint als eigenständige Seite" wird zur „Maker als Anwendungs-Shell
  für alle Autoren-Werkzeuge" verallgemeinert; die Standalone-Seiten-Festlegung gilt nur noch für die
  dauerhaft separaten Seiten (Gamepad-Test, Splatter-Seite).
- **[AMEND] ADR 0010 §4** — die Persistenz-Semantik (Autosave in den gebundenen Projektordner über die File
  System Access API) wird zur Grundlage des gemeinsamen Workspace-Konzepts erklärt.
- **[ERWEITERUNG] ADR 0024** — die Paketgrenze bleibt: `@small-world-machine/tools` bleibt in der einen
  Abhängigkeitsrichtung von `@small-world-machine/engine`; der Merge ändert die Ein-Weg-Abhängigkeit nicht.

## Erwogene Alternativen (verworfen)

- **1B Neutrales „Studio-Host"** (Maker nur ein Modus unter mehreren): sauberste Marke, aber der höchste
  Re-Skin-Aufwand — für Phase A kein Mehrwert.
- **1C iframe-/Tab-Launcher**: die schnellste, aber schwächste Vereinfachung — kein geteilter Ingest, kein
  geteiltes Undo, keine gemeinsame Tastatur; kein Hebel für die Kernziele.
- **1D Forge-Dock als Host**: Fenster-in-Fenster ist kein echter Editor-Shell-Look und schwächt die Modus-
  Tastaturgeschichte; als Fallback vorgehalten, falls die Panel-Verschmelzung für Vollbild-3D-Werkzeuge zu
  invasiv wird.

## Konsequenzen

- **Undo pro Tool & pro Dokument**, nie global; bestehende Werkzeug-Undo-Implementierungen bleiben erhalten.
- **Ein Projektordner/Ingest pro Session** als gemeinsamer Workspace-Root; gemeinsamer Ingest über die
  bestehende `common/io`-Schiene.
- **Legacy-Seiten bleiben erreichbar** — die Entry-Alias-Politik hält alle bisherigen URLs am Leben und
  sichert die bestehenden E2E-Harnesses.
- **`attachDevTools`/Forge unverändert** — die In-Game-Welt wird vom Merge nicht berührt; die Forge-E2E-
  Harnesses bleiben gültige Gates.
- Die modusgetriebene Verschmelzung ist die Voraussetzung für „ein Kern" mit dualer Bedienung; die Grenze
  des gemeinsamen Headless-Kerns regelt **ADR 0034**.

**Scope-Clamp dieser ADR:** keine CLI-/Kommando-Details (diese regeln ADR 0034 und die Guides), keine
Per-Tool-Panel-Verhältnisse (Kit- und Splatter-Panel sind Tracking-Entscheidungen, geführt im Plan und im
Backlog), kein „globaler Undo".
