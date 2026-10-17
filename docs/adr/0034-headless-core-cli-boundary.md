# ADR 0034: Headless-Kern & CLI-Grenze (`swm`-Boundary)

> **Status: DRAFT** — Entwurf zum Implementierungsstart des „Big Merge" (2026-10-13, Session `big-merge`,
> Konsens 4/4, Plan `.agents/collaborate/big-merge.md`). Noch nicht verbindlich: Die Entscheidung wird erst
> mit den Abnahme-Gates der Meilensteine (Plan §8) und der finalen Implementierung (M6) promoviert.

## Kontext & Problem

Die duale Nutzung aus einem Kern (Ziel G2) verlangt, die domain-logische Ebene als framework-agnostischen
Headless-Kern zu extrahieren, der von Web-Oberfläche und Kommandozeile **gemeinsam** konsumiert wird — ohne
doppelte Logik. Interaktive Editor-Features (Gizmos, Drag & Drop, Viewport-Navigation, Kameraführung) sind
für eine Kommandozeile nicht sinnvoll abbildbar; die user-seitige Vorgabe ist eine bewusste, pragmatische
Teilmenge, kein monströses Interface. Zusätzlich bricht an der Codec-Grenze die „gleicher Kern, gleiches
Ergebnis"-Zusage: Die Browser-Dekodierung (Canvas/`createImageBitmap`) ist nicht byte-gleich zur
`pngjs`-Dekodierung (Farbräume/Gamma/Premultiplication), sobald Bilddaten den Kern durchlaufen.

## Entscheidung (provisorisch, per Konsens)

- **`core/*` ist framework-agnostisch** — reines TypeScript mit ausschließlich Engine-Imports
  (`@small-world-machine/engine`) und reinen Daten-/Transform-Slices; keinerlei harte DOM-/GL-/Browser-
  Abhängigkeit auf Modulebene. Tauglichkeit dafür ist per Grep-Gate geprüft (0 Treffer
  `getContext|document\.|window\.` unter `packages/tools/src/core/`, Finding F1).
- **Canvas/GL treten nie direkt im Kern auf:** Alle Bilddaten fließen als RGBA-Fixtures über eine
  `RasterIO`-Schnittstelle (Codec-Adapter für Node und Web); GPU-abhängige Schritte laufen hinter
  dedizierten Adaptern.
- **Rendering-abhängige Schritte** (z. B. der IBL-Bake) werden in der CLI als Headless-Chrome-Subprozess mit
  festen, bewährten Flags ausgeführt — der einzige Browser-Einsatz im CLI-Pfad.
- **Die CLI (`swm`, Verpackung als `bin` in `@small-world-machine/tools`) ist die bewusste, dokumentierte
  Teilmenge des Kerns.** Explizit **nicht** abgebildet: die interaktive Gizmo-/Tastatur-/Viewport-Logik des
  Editors (sie verbleibt in der Web-Oberfläche). Die Ausgrenzung ist dokumentierter Vertrag, kein Versehen
  und kein Qualitätsmangel.

## Erwogene Alternativen (verworfen)

- **Thin-Controller** (CLI-eigene Adapter um Browser-Tools): dupliziert Logik und verletzt damit das Kernziel
  „ein Kern, keine doppelte Logik".
- **Reine Browser-Automation** (Puppeteer treibt die Web-UI): maximale Wiederverwendung, aber Kopplung an
  Dev-Server/Browser, schlechte Deterministik/Latenz, und es testet die UI statt des Kerns; nur Fallback für
  „needs-GL-/needs-Web-Viewport"-Operationen.

## Konsequenzen

- **Determinismus auf RGBA-Fixtures statt auf PNG-Bytes** — die puren Operationen sind deterministisch
  (IEEE-754), die Codec-Grenze nicht; Tests sichern Byte-Gleichheit auf Fixture-Ebene.
- **`--json`-Ausgabe als externer Automations-Kontrakt**, versioniert (Schema + Exit-Codes); Feld-/Code-
  Änderungen verlangen einen CHANGELOG-Eintrag.
- **Der Kern wächst, die UI bleibt dünn** — Funktionalität entsteht einmal im Kern und wird von beiden
  Flächen bedient; Web-Panels re-exportieren `core/*` kompatibel weiter.

**Scope-Clamp dieser ADR:** keine Web-Shell-/Panel-Entscheidungen (diese regelt ADR 0033), keine normative
Verb-/Kommando-Liste (die lebt in `swm --help` und den Guides), kein GLB-Container-Writer (Phasen-Nicht-Ziel,
geführt als Backlog-Item; `.gltf` mit Data-URIs bleibt Phase-A-Standard). PNG-first ist eine Laufzeit-/
Phasen-Entscheidung (Plan D3) — diese ADR hält nur das dauerhafte Prinzip der Kern-Reinheit.
