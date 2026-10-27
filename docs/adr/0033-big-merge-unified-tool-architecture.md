# ADR 0033: „Big Merge" — vereinheitlichte Maker-Architektur für Entwicklungswerkzeuge

> **Status: ACCEPTED (AMENDED 2026-10-19, Maintainer-Freigabe „Option 3")** — ursprünglich Entwurf zum
> Implementierungsstart des „Big Merge" (2026-10-13, Session `big-merge`, Konsens 4/4, Plan
> `.agents/collaborate/big-merge.md`). Durch den Re-Scope vom 2026-10-19 ist **nur der Mechanismusteil**
> verbindlich (optionale Maker-Shell-Infrastruktur, Entry-Aliase, Forge bleibt In-Game, Undo pro
> Tool/Dokument); die Zielthese „alle Autoren-Werkzeuge verschmelzen zu einer Anwendungs-Shell" ist seitdem
> ein **opt-in-Richtungsziel ohne Vertragscharakter** (maßgeblich: Abschnitt „AMENDED 2026-10-19" unten).
> Der Re-Scope nimmt den ursprünglichen **AMEND von ADR 0010 §3** zurück (Maker bleibt eigenständige
> Seite); der gemeinsame Kern und die CLI sind über **ADR 0034** (ACCEPTED) geregelt; **ADR 0024**
> (Paketgrenze) bleibt unverändert.
>
> **Stand 2026-10-19 (Implementierungsfortschritt):** M1 (Maker-Shell-Bootstrap: `ToolMode`/`ToolModeHost`/
> `ModeHashRouter`, `MakerApp`, `public/tools/maker.html`) und M2 (Headless-Core-Extraktion
> `packages/tools/src/core/*`, Basis der CLI gemäß ADR 0034) sind umgesetzt und in main; in der Shell ist
> de facto genau ein Modus registriert (`WorldModeAdapter`). Die acht Legacy-Werkzeuge bleiben eigenständige
> `public/tools/*.html`-Seiten (Vite-Eingänge; M7-Input-Deletion explizit Nicht-Ziel).

## AMENDED 2026-10-19 — Re-Scope „Option 3" (verbindlich)

**[AMEND, Maintainer-Freigabe 2026-10-19]** Die folgenden Punkte **bleiben** verbindliche Entscheidungen
dieser ADR, in dem Umfang, in dem sie als Architektur-Rahmen umgesetzt und getragen sind:

1. **Optionale Maker-Shell-Infrastruktur statt Zwangs-Verschmelzung.** Maker stellt die Shell-Infrastruktur
   bereit (`ToolMode`-Lifecycle **statt** `ForgeTool`, `ToolModeHost`, `ModeHashRouter` / `maker.html#<mode>`,
   `MakerApp`). Die acht Autoren-Werkzeuge (Xtractor, Pixler, Map Generator, Material/PBR-Gen, IBL-Gen,
   Kit-Inspector, Splatter-Gen) **bleiben standardmäßig eigenständige Standalone-Seiten**; die Integration
   eines Werkzeugs in die Shell ist ein **per-Tool-Business-Case (opt-in)**, kein genereller Zwang.
   Kriterium für einen künftigen Fall: überwiegend Core-/`common/io`-getrieben **oder** expliziter
   Nutzerwunsch. Ist-Stand: **ein** Modul (`WorldModeAdapter`).
2. **URL-Strategie: Entry-Aliase statt Dokument-Swap** bleibt — alle Legacy-Adressen `public/tools/*.html`
   bleiben Vite-Eingänge und booten bei Bedarf `maker.html#<mode>`; **M7 (Input-Deletion) ist dauerhaft
   Nicht-Ziel**. Kein De-Merge, solange kein Werkzeug tatsächlich integriert ist.
3. **Forge bleibt strikt In-Game** — `attachDevTools`/Forge und die Forge-E2E-Harnesses bleiben exakt
   unverändert; Forge wird nicht in der Web-App neu aufgestellt.
4. **Undo bleibt pro Tool & pro Dokument**, kein globaler Undo; bestehende Werkzeug-Undo-Implementierungen
   bleiben erhalten.

Abgeändert bzw. **nicht mehr verbindlich**:
- **[Rücknahme des AMEND auf ADR 0010 §3]** Die Generalisierung „Maker als eine Anwendungs-Shell für alle
  Autoren-Werkzeuge" entfällt; **ADR 0010 §3 („Maker erscheint als eigenständige Seite") steht wieder in
  Originalfassung** (Re-Amendment in ADR 0010 dokumentiert; historische Texte bleiben erhalten).
- Aufgehoben: die Konsequenz „Die modusgetriebene Verschmelzung ist die Voraussetzung für ‚ein Kern' mit
  dualer Bedienung" — **duale Bedienung ist bereits über den Headless-Kern/die CLI (ADR 0034, ACCEPTED)
  erfüllt**, unabhängig von jeder Shell-Verschmelzung.
- Herabgestuft auf Backlog-/Tracking: „alle Autoren-Werkzeuge als ToolMode-Module in einer Shell" und der
  gemeinsame Projektbegriff „Workspace/Project" (bleibt Zukunft, vgl. `CONTEXT.md`).

## AMENDED 2026-10-27 — M3 umgesetzt, drei Legacy-Seiten entfernt (Maintainer-Entscheid)

**[AMEND, Maintainer-Auftrag 2026-10-27]** Der Maintainer hat die Integration von **Xtractor, Pixler und Map
Generator** in die Shell beauftragt (Business-Case-Kriterium „expliziter Nutzerwunsch" aus Punkt 1 erfüllt) und
entschieden, deren Standalone-Seiten **zu entfernen** statt als Entry-Aliase zu halten:

- Die drei Werkzeuge laufen als `ToolMode`-Module (`ForgeToolMode`, `maker.html#xtractor|pixler|map`). Die
  Werkzeug-Klassen bleiben unverändert `ForgeTool`s (Forge-Fenster, `attachDevTools`); die Shell baut pro `mount()`
  eine frische Instanz und trägt das Dokument über `getState()`/`setState()` durch den Moduswechsel.
- **Punkt 2 gilt für diese drei Seiten nicht mehr:** `public/tools/xtractor.html`, `pixler.html` und `map-gen.html`
  und ihre Vite-Eingänge sind gelöscht, alte Adressen liefern 404. Verweise (`public/index.html`, README, Guides,
  `scripts/xtractor-e2e.mjs`) zeigen auf `maker.html#<mode>`. **M7 (Input-Deletion) bleibt für alle übrigen Seiten
  Nicht-Ziel** (Material/PBR, IBL, Kit-Inspector, Splatter, Gamepad).
- Der Crop→Pixler-Handoff läuft in der Shell: Xtractor sendet über den App-Event-Bus, die Shell parkt das Bild im
  Pixler-Modus und wechselt (Pixler ist beim Senden nicht gemountet).
- Undo bleibt pro Werkzeug und **pro Mount**: ein Moduswechsel behält das Dokument (Bild, Karte), nicht den Verlauf.
- Verifikation: `scripts/xtractor-e2e.mjs` 33/33 gegen `maker.html#xtractor`, Moduswechsel/Deep-Link/Handoff live
  geprüft, Forge-Pfad unverändert.

**M4 (2026-10-27, Material):** Material Studio läuft als vierter Shell-Modus (`maker.html#material`, `ForgeToolMode`
um die bestehende `MaterialStudio`-Klasse; zweite 3D-Oberfläche = Studio-Sandbox, damit bleibt das GL-Budget bei ≤ 2).
Die Seite `public/tools/pbr-gen.html` **bleibt** (Material/PBR ist von der Entfernung ausgenommen), ihre Inline-Pipeline
(~430 Zeilen: Presets, Blur, Sobel/AO/Edge-Ableitung) ist aber durch `derivePbrMaps`/`MATERIAL_STUDIO_PRESETS` aus
`core/material.ts` ersetzt. Golden-Gate: `tests/core/materialGolden.test.ts` (sha256 je Map, erzeugt aus der
Original-Inline-Pipeline), zusätzlich Browser-Vergleich Alt gegen Neu über alle vier Profile. Gefunden und behoben:
`MaterialStudioController` ließ die Window-Drop-/Paste-Listener seiner Dropzone beim `unmount()` stehen.
Der Kit-Inspector-Validator-Dialog (Plan M4) ist nicht gebaut; `swm kit validate` deckt die Validierung ab.

**M5 (2026-10-27, IBL + Splatter):** IBL-Gen läuft als fünfter Shell-Modus (`maker.html#ibl`, `IblGenTool` als
`ForgeTool` um den bestehenden `IBLBaker`; der Baker erzeugt seinen WebGL2-Kontext erst beim ersten Bake und gibt
ihn beim Verlassen frei). Die Seite `public/tools/ibl-gen.html` bleibt. Splatter bekommt nur den CLI-Port
(`swm splatter`, siehe ADR 0034); seine Seite bleibt dauerhaft standalone, ohne Shell-Panel.

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

## Entscheidung (provisorisch, per Konsens — soweit nicht durch den Abschnitt „AMENDED 2026-10-19" abgeändert)

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
