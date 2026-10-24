# ADR 0047: Whack-a-Mole-Doktrin — Invariante Domänen-Parameter, Rule of Three, explizite Transitionen, invariante Tests & Fail-Closed (Verankerung der 5 Goldenen Prinzipien)

> **Nummerierungskorrektur:** Das P1-Gate-Dossier plante dieses ADR als 0044. Zwischenzeitlich wurden
> `0044` (Ehrliche Tests-Doktrin), `0045` und `0046` angenommen; dieses ADR trägt daher die nächste
> freie Nummer **0047**. Der Inhalt entspricht unverändert dem Gegenstand des Moderatoren-Rulings
> **R6**.

> **Status: ACCEPTED (draft pending gate review)** — 2026-10-24 (Moderatoren-Ruling R6 des P1-Gates;
> Umsetzungsschritt Stufe-1: ADR + `scripts/check-doctrine.ts` + committed Doctrine-Ledger, uncommitted
> im Working Tree zur Freigabe. CI-Hartschaltung ist ein separater, post-gate Schritt — siehe
> „Konsequenzen").
>
> **Status of:** Stufe 1 / P1 (S2 Whack-a-Mole), Kampagnen-§4 „5 Goldene Prinzipien" (S2 §4), ADR 0047
>
> **Decision Makers:** Small World Machine Architecture Team (human-approved 2026-10-24 via R6)

---

## Kontext & Problem

Die Engine kennt eine sich wiederholende Fehlerklasse, die jedes Subsystem einzeln heimsucht
(Shader ↔ Kamera ↔ Physik): **Whack-a-Mole** — ein Symptom wird geflickt, die zugrunde liegende
Entscheidung nicht, und das nächste Subsystem baut denselben Fehler neu. Die zugrunde liegenden
Mechanismen sind in der Schwerpunkt-Analyse S2 §1–§3 benannt:

- **Tuning-Knob-Fallacy:** Parameter werden hinzugefügt, um ein Symptom zu „tunen", statt die
  physikalische/künstlerische Größe zu benennen, die der Autor meint (`depthBias`, `normalOffset`,
  `fatMargin` …). Jeder zusätzliche Knob vergrößert den 15-dimensionalen Abstimmraum (S2 §3.1) und
  wird durch Hyrum's Law zu einem unbeabsichtigten API-Vertrag.
- **Wrong Abstraction / Semantic Compression:** Duplikation, die man aushalten muss, wird zu früh in
  eine Universalklasse oder einen Flag-gesättigten Super-Baustein komprimiert, statt erst nach drei
  realen, semantisch identischen Fällen (Sandi Metz; Muratori).
- **Shared Implicit State:** Modi (FPS↔Orbit, Material-Familien, Lifecycle-Phasen) teilen dieselben
  Felder, ohne dass Übergänge explizit konvertiert werden — Objektidentität wird als Kontrollfluss
  zweckentfremdet.
- **Closed vs. Open World & DoD:** Schwellwerte und Bounds-Grenzen ohne dokumentierte Semantik
  erzeugen mystische Fehlerbilder statt früher, klarer Bedingungen.

Diese Fehlerklasse ist **auf HEAD real belegt** (evidenzbasiert, P1 korrigiert den Großteil bereits):

- FPS-Sentinel-Hack (Objektidentität `targetPos !== camera.target` als Kontrollfluss) —
  `FPSStrategy.ts:26–31` (bereits gelöscht, Kommentar dokumentiert die Entfernung),
- tote Knobs `OrbitController.minPhi/maxPhi` (Zeichnungs-Konflikt Zenit vs. Elevation) —
  `OrbitController.ts` (bereits entfernt, 0 Treffer auf HEAD),
- `Object3D.computeBounds()`-Kugel-Bug und Dirty-Flag-Semantik —
  `Object3D.ts:94–117` (Verträge dokumentiert),
- Octree-Root-Growth-Degeneration und BoundingSphere-Lücke —
  `Object3D.ts`, `physix/Octree.ts` (P1 entschieden).

Warum muss das **Doktrin**, nicht Guidance sein? Weil dieselbe Fehlerklasse pro Subsystem
wiederkehrt und die Phasen 2–5 (Asset/DCC, Materialien/Skalen-Invarianz, Frame-Pacing, Verifikation)
einen **stabilen, prüfbaren Maßstab** brauchen. Eine unverbindliche Empfehlung pro Subsystem wäre
wieder ein auf alle Ewigkeit geteilter Rat ohne Biss. Zugleich darf die Doktrin **nicht** zur
Dogma-Eskalation werden — die Pragmatismus-Klausel der AGENTS.md ist der Countdown (siehe
„Anti-Dogma-Kalibrierung").

## Zu entscheidende Punkte (am P1-Gate bereits entschieden — hier nicht erneut aufrollen)

Alle offenen Doktrin-Fragen aus dem Dave-Report (§14 Q1–Q9) wurden am 2026-10-24 vom Moderator
autoritativ entschieden (Gate-Dossier §8; Rulings R6 sowie angenommene Standards D9–D17). Dieses ADR
**kodifiziert** diese Entscheidungen als verbindliche Doktrin:

| Punkt | Ruling | Inhalt (verbindlich) |
|---|---|---|
| Durchsetzungs-Apparat | **R6** | Pragmatische Richtlinie gegen Schleichkomplexität; **ein** CI-Prüfskript `scripts/check-doctrine.ts` (Exit 0/1/2, kein Fremd-Framework, kein ESLint-Plugin), `npm run check:doctrine`; ADR als committed Dokument. Schützt ADR 0041 vor `schemaVersion`-Churn (keine neue Config-/Schema-Grammatik). |
| Klassifikations-Scope (Q1) | **D9** | Pflicht-Klassifikation (A1) nur im **auditierten Hot-Scope** (§ „Scope" unten), nicht der gesamten Public-API. |
| Rule-of-Three (Q3) | **D10** | „≥3 konkrete Konsumenten" gilt ausschließlich für **Abstraktions-Extraktion**. Renderer-Shared-Infrastructure (ADR-0038-GL-Ebene, Fan-in 2 durch zwei GL-Tiers konstruktionsbedingt) ist **ausgenommen**; jede geteilte Infrastruktur benennt aber ihren geteilten invarianten Mathe-Block im ADR. |
| Metamorphic/PBT (Q4) | **D11** | Interims-Tests rein in TypeScript, determiniert, metamorphe Relationen; **fast-check/PBT wird an das P5-Gate geschoben** (dort evaluiert, nicht vorausgesetzt). |
| Sentinel-Identity-Check (Q5) | **D12** | Advisory/Review-Tier, nicht hart (Objektidentität ist anderswo legitim). |
| Honest-Fallback-Mandat (Q6) | **D13** | ADR-0043-Muster ist harte Fail-Closed-Pflicht **nur für render-kritische optionale Capabilities und Datenintegritäts-Lücken**; kosmetische Tier-Lücken advisory. |
| Sprache (Q7) | **D14** | ADR 0047 + committed Doktrin-Doku **Deutsch** (konsistent zu allen bestehenden ADRs); Board/Mailbox bleiben Englisch. |
| KPI-/Fang-Ledger (Q8) | **D15** | Ledger als **committed** Datei `docs/reference/doctrine-ledger.md` (`.agents/notes` ist gitignored und in Fresh-Clones abwesend). |
| Platzierung (Q9) | **D16** | ADR 0047 + `docs/guides/architecture.md` §6 + Reference-Verweis auf das Ledger. |
| Test-first / Backlog (Charlie-Q2) | **D17** | „Known-fail on HEAD"-Tests werden als `it.todo` **mit Entscheidungs-Referenz** abgelegt (Pflicht-Backlog); keine dauerhaft roten Suiten. |

---

## Entscheidung

Die fünf Goldenen Prinzipien (S2 §4) sind ab sofort **Engine-Doktrin** — ein pragmatischer
Schutz gegen Schleichkomplexität, kein Dogma. Sie gelten als verbindliche Leitlinie für alle
künftigen ADRs, Refactorings und neuen öffentlichen Parameter im auditierten Hot-Scope.

### D1 — Die 5 Goldenen Prinzipien sind Engine-Doktrin

1. **P1 — Invariante Domänen-Parameter statt Leaky Implementation Knobs:** Jeder neue öffentliche
   Parameter im auditieren Hot-Scope benennt eine physikalische/künstlerische Größe (Domain),
   ist aus Domänengrößen/Geometrie abgeleitet (Derived) oder ist ein bewusst eingefrorener Standard
   (Fixed). Ein Parameter, der keiner der drei Klassen ehrlich zuordenbar ist, ist ein Leaky Knob und
   wird abgeleitet (derived) oder eingefroren (fixed) — nicht als weiterer Regler exponiert.
2. **P2 — Rule of Three:** Eine neue geteilte Abstraktion (Extraktion oder Verbreiterung) wird erst
   nach **≥3 konkreten, semantisch verschiedenen Konsumenten** gebildet, die einen identischen
   Mathe-Block teilen; das ADR benennt die Fälle und den geteilten Block explizit. Duplikation ist
   billiger als die falsche Abstraktion (ADR 0015; ADR 0013/0025-Praxis). Renderer-Shared-
   Infrastructure ist ausgenommen (D10).
3. **P3 — Explizite State-Transitions statt Shared Implicit State:** Jede Klasse mit sich
   gegenseitig ausschließenden Modi (Kamerasstrategie, Material-Preset-Familie, Quality-Tier, 
   Lifecycle-Phase) konvertiert Zustand beim Wechsel explizit (Konverter- oder gekapselter
   Per-Mode-Zustand) oder dokumentiert den Verzicht. Kein Objektidentitäts-Kontrollfluss als Ersatz
   für falsche Call-Semantik.
4. **P4 — Metamorphische/invariante Tests:** Mathematische Behauptungen werden gegen
   **Invarianten** getestet (Energie-Erhaltung, Monotonie, Skalen-Invarianz, Round-trip-
   Invertierbarkeit, Beschränktheit) statt gegen Momentaufnahmen; wo kein numerisches Orakel
   existiert, kodiert der Test eine benannte Relation. Interims rein-TS (D11), PBT an P5.
5. **P5 — Fail-Closed & Bounds-Clamping an API-Grenzen:** Risiko-Skalareingänge an
   Systemgrenzen werden explizit behandelt (clamp auf gültige Domäne, NaN/Infinity-Guard, Nenner
   `> epsilon` vor Division, dokumentierte Ablehnung); bei fehlender **render-kritischer** optionaler
   Capability tritt der dokumentierte ehrliche Fallback ein (ADR-0043-Muster), nie ein NaN-Frame.
   Grenz-Clamping an API-Grenzen wird mit `console.warn`/Assert gepaart; Deep-Loop-Clamping nur für
   harte GPU-Zwänge.

### D2 — Zwei Durchsetzungsklassen (Contracts vs. Heuristiken)

- **Klasse A — Korrektheits-Kontrakte (binden sofort, Kosten ≈ 1 Satz):** Parameter-
  Klassifikation, Invarianten-Registry-ID, Grenz-Test-Namenskonvention, ADR-Doctrine-Compliance-
  Abschnitt, Transition-Test-Obliegenheit. Ihre Abwesenheit ist immer nur eine Ein-Zeilen-JSDoc-/
  Tag-Lücke; ihre Anwesenheit macht die Invariante statisch prüfbar. Ausführlich in §
  „Marker-Syntax".
- **Klasse B — Verhaltens-Heuristiken (verdienen ihre Schärfe per eigener Rule of Three):**
  alle Regeln, die ändern, *ob* der Build durchläuft (Dead-Knob-Scan, Sentinel-Identity-Advisor,
  Flag-Dichte, Boundary-Gating). Sie starten **advisory**; erst ihre ersten **3 unabhängigen
  Echtfänge** (Defekt mit file:line + rotierendem Test, im Ledger protokolliert) heben sie auf
  Warn-, dann Error-Tier. 2 Quartale mit 0 Fängen lösen Sunset aus (archiviert, Begründung
  bleibt erhalten).

### D3 — Pflicht-Klassifikation neuer öffentlicher Parameter (P1)

Jeder **neue** öffentliche/Config-Parameter im auditierten Hot-Scope trägt im JSDoc exakt eines von:
`@domain`, `@derived` oder `@fixed`, jeweils mit einer Ein-Zeilen-Bedeutung (Einheiten/Wertebereich
bzw. Ableitung bzw. Einfrier-Grund). Bestehende Parameter müssen **nicht** nachträglich getaggt
werden (kein historisches Retrofit); sie dürfen es. Ein Tag-Ritual ohne Bedeutung schlägt fehl: Der
Tag verlangt die physikalische Bedeutung in derselben Zeile. Leaky Knobs sind die dokumentierte
Anti-Klassifikation — wenn ein Autor ehrlich keine der drei Klassen wählen kann, ist der Parameter
abzuleiten oder einzufrieren.

### D4 — Rule-of-Three-Gating in ADRs (P2)

Jedes künftige ADR, das eine Abstraktion **extrahiert oder verbreitert**, listet ≥3 konkrete,
semantisch verschiedene Konsumenten und benennt den exakten geteilten Mathe-Block. Eine Extraktion
ohne drei Fälle wird in Review (a) als verfrüht abgelehnt oder (b) als explizite Duplikation mit
Verweis auf das später rechtfertigende ADR geschrieben. Plan-ADRs dürfen die Fälle weglassen; nur
merge-/gate-relevante ADRs sind gebunden (KPI M2). Shared-Infrastructure folgt D10/ADR 0038.

### D5 — Explizite Transitionen + Transition-Tests für modeful Objekte (P3)

Klassen mit sich ausschließenden Modi bekommen eine **dedizierte Live-Transition-Semantik** (Klasse-A-
Kontrakt): Konverter-Funktion pro Fall oder vollständig gekapselter Per-Mode-Zustand — kein
„Transition-Framework". Modeful Klassen liefern zusätzlich einen **Live-Transition-Test** (nicht nur
Zwei-Isolat-Zustandstests; A5). Referenz-Implementierung: `Camera.setStrategy` (`Camera.ts:229–243`).

### D6 — Invarianten-Registry + metamorphe Test-Konvention (P4)

Die in diesem ADR verankerten Invarianten bilden einen **versionierten Registry-Seed** (§
„Invarianten-Registry"). Mathematische Behauptungen im auditierten Hot-Scope referenzieren die ID per
`@invariant <ID>: <Relation>`; der Doktrin-Checker löst die ID gegen den Seed auf und fordert einen
Test-Namens-/Datei-Verweis. Werkzeug-agnostisch: Interims rein-TS-Seeded-Tests (D11), fast-check-/
PBT-Entscheidung an P5. Die S4-Matrix (IDs 1.1–3.2) wird beim P5-Gate als Registry-Erweiterung
übernommen, nicht vorgezogen.

### D7 — Fail-Closed & Honest-Fallback (P5, eingeschränkt per D13)

Fail-Closed ist harte Pflicht an API-Grenzen für **render-kritische optionale Capabilities und
Datenintegritäts-Lücken** (Muster: ADR 0043) sowie für Risiko-Skalar-Eingänge (clamp/NaN-Guard/
Nenner-Guard). Kosmetische Tier-Lücken sind advisory dokumentiert, nicht hart. Deep-Loop-Clamping nur
hart für GPU-Zwänge (branch-free `clamp`, Coding-Guide §3B); sonst Validierung an der Grenze mit
Warnung.

### D8 — Der eine Durchsetzungs-Apparat (R6) und die Anti-Dogma-Kalibrierung

- **Ein** Instrument: `scripts/check-doctrine.ts` (Exit 0/1/2, kein Fremd-Framework, kein
  ESLint-Plugin — ESLint-Custom-Rules bleiben für Code-Struktur, nicht für die Doktrin), verdrahtet als
  `npm run check:doctrine` im Root-`package.json`. Keine neue Config-/Schema-Grammatik (schützt ADR
  0041). Adoptionszustand transparent: harte Phase-0-Checks laufen immer; Class-B-Heuristiken sind
  hinter `--enable-advisory`-Flags (Start advisory).
- Die **Anti-Dogma-Kalibrierung** (§7 des Dave-Reports) ist verbindlicher Vertragstext, kein
  Kommentar:
  1. Klasse-B-Heuristiken verdienen ihre Schärfe per eigener Rule of Three (D2).
  2. Klasse-A-Kontrakte haben eine Ein-Satz-Decke: Eine Obliegenheit, die nicht mit einer
     JSDoc/Tag-Zeile, einem Testnamen oder einer ADR-Zeile zu erfüllen ist, ist zu überarbeiten.
  3. Two-Speed-Scope (§ „Scope"): Hot-Path/Shader/Physik/Kamera/Lichter tragen die Obliegenheiten;
     Setup/Loader/Editor/CLI-Code ist befreit.
  4. **Null False Positives auf dem Error-Tier gegen die aktuelle HEAD-Basis:** Ein Check, der auf
     einem grünen Baum nicht sauber läuft, wird nur advisory gemerged. Der erste `check:doctrine`-Lauf
     muss auf vollem Grün bestehen.
  5. **Escape-Hatch mit Pflicht-Begründung:** `// doctrine-ignore: <regel> <warum>` im Code. Der
     *Grund* wird auditiert; wiederholte Ausreden triggern die Rekalibrierung.
  6. **Sunset & Rekalibrierung:** 2 aufeinanderfolgende Quartale mit 0 Fängen → Heuristik
     archivieren (Begründung im Ledger); Reversions (blockierte echte Arbeit) über Fängen →
     Rekalibrierung am nächsten Gate.
  7. **Keine neuen Notationssysteme:** Tags leben ausschließlich in bestehenden JSDoc-Kommentaren;
     IDs kommen aus der Registry; keine neuen Dateiformate.

## Scope (auditierter Hot-Scope)

Klasse-A-Kontrakte und die hard-/advisory-Scans des Checkers gelten für den **auditierten
Hot-Scope**:

- `packages/engine/src/core/cameras/**`, `core/controllers/**`, `core/behaviors/**`
  (kamera-/physikseitig), `core/culling/**`, `core/lights/**`, `core/materials/**`,
  `core/objects/Object3D.ts`, `physix/**`, Render-Loop-Pfade (`renderers/**`), Shader-Quellen
  (WGSL/GLSL).

Setup-/One-Shot-/Loader-/Editor-/CLI-Code (`GltfLoader`-Setup, Tools, Showcases) ist **außerhalb**
des Pflicht-Scopes — Autoren dürfen dort taggen, aber nichts blockiert. Editors, die Parameter im
Hot-Scope neu öffentlich machen, unterliegen der Pflicht.

## Marker-Syntax (Klasse A — exakt so definiert)

Die Doktrin definiert die Syntax der Kontrakt-Marker **explizit**; der Checker validiert sie strikt.
Auf HEAD (2026-10-24) existiert **kein einziges** dieser Marker im Engine-Source (grep:
`@domain|@derived|@fixed|@invariant` → 0 Treffer in `packages/engine/**`) — die Doktrin führt sie neu
ein. Bestehende JSDoc-Konventionen des Repos (nur `@param`/`@returns`/`@inheritdoc` mit Text in
**derselben Zeile**) werden gespiegelt.

### P1-Klassifikation (separate Tags, keine `@invariant`-Überladung)

Die Parameter-Klassifikation nutzt **eigene Tags** — sie überlädt `@invariant` **nicht** (dies löst
die im Dave-Report angedeutete Doppelbelegung `@invariant domain|derived|fixed` vs.
`@invariant <ID>` eindeutig zugunsten getrennter Tags auf):

```
/**
 * Objektiv-Distanz des Spielers. @domain length in Metern  [0.05, 100]
 */
public eyeHeight: number = 1.6;

/**
 * Shadow-Offset aus Neigung/Empfänger-Texelgröße abgeleitet, nie manuell.
 * @derived aus receiver-slope Texel Coverage, siehe §FogBillboard
 */
public shadowBias?: number;

/**
 * EVSM-Warp-Exponent — bewusst eingefrorener Filament-Standard.
 * @fixed c=40 (Filament vsm-exponent), nicht tunen — Wertwechsel ändert Look global
 */
public evsmExponent: number = 40;
```

Regeln (vom Checker hart geprüft, sobald ein Tag existiert):

1. Nur die exakten Schreibweisen `@domain`, `@derived`, `@fixed`, `@invariant` sind erkannt.
2. Ein Tag im „Doktrin-Präfix-Raum" (beginnt mit `domain|derived|fixed|invariant`), der nicht exakt
   einer dieser Schreibweisen entspricht, ist ein Tippfehler → hart. (`@derieved`, `@domainX` …)
3. Jeder Klassifikations-Tag trägt **in derselben Zeile** nicht-leeren Text (die Ein-Zeilen-
   Bedeutung). Leerer Tag → hart.
4. Zwei **unterschiedliche** Klassifikations-Tags in **einer** Zeile (z. B. `@domain … @fixed …`) sind
   ein harter Konflikt (ein Parameter hat genau eine Klasse). Zwei Klassen in **einem** JSDoc-Block,
   die unterschiedliche Parameter dokumentieren, sind legitim und damit Review-Sache (advisory).
5. Es ist genau eine der drei Klassen pro Parameter erlaubt; der Tag existiert oder nicht. Das
   **Fehlen** eines Tags ist nie hart (historische Mitglieder sind befreit) — fehlende
   Klassifikation an sensiblen öffentlichen Parametern ist ein **advisory** Befund (Klasse B, M1b).

### Invarianten-Registry (A2)

Mathematische Behauptungen referenzieren die Registry-ID per `@invariant <ID>: <Relation>` — die ID
muss im **versionierten Registry-Seed** existieren (hart: unbekannte ID schlägt fehl), und der
Autor verweist auf die Test-Datei. Mehrdeutigkeit (mehr als eine ID pro Tag oder kein ID-Token nach
`@invariant`) → hart.

### Escape-Hatch (Pflicht-Begründung)

`// doctrine-ignore: <regel> <begründung>` — silenziert die genannte Regel ab der folgenden
Zeile/Datei; die Begründung ist **Pflicht** (leer → hart). Unbekannter Regelname → hart (Tippfehler
wird sofort sichtbar). Zulässige Regelnamen: `classification`, `classification-blank`,
`invariant-id`, `adr-compliance`, `dead-knob`, `sentinel-identity`, `untagged-param`,
`unguarded-division`, `any`.

### Grenz-Test-Namenskonvention (A3) und Transitionstest (A5) — Review-Obliegenheit

Grenz-/Corner-Fälle an Risiko-Eingängen tragen im Testnamen eines der Schlüsselwörter `NaN`,
`Infinity`, `clamp`, `boundary`, `outOfBounds`, `zero`, `negative` (A3). Modeful Klassen liefern
einen Live-Transition-Test (A5). Beide sind in der v1 des Checkers **nicht** automatisiert und damit
reine Review-Punkte (ehrlicher Verzicht statt lauter Regel; siehe „Prüfbare Konsequenzen").

## Invarianten-Registry-Seed (versioniert, v1)

Die Registry ist ein versionierter Seed dieses ADR und wird vom Checker als eingebettete, auflistbare
Liste geführt (`--list-invariants`). Er enthält ausschließlich auf HEAD **real verankerte**
Invarianten; die S4-Matrix (IDs 1.1–3.2) wird beim P5-Gate merge-bar ergänzt (D11):

| ID | Invariante | Anker (HEAD) |
|---|---|---|
| `CAM-POSITION-OWNERSHIP` | Kamera-Position ist Controller-/Strategy-Sache, nicht extern kopierbarer Sentinelschalter. | `FPSStrategy.ts:26–31`, Test `tests/core/FPSStrategy.test.ts` |
| `CAM-STRATEGY-CLAMP` | Vertikaler Look sieht auf ±(HALF_PI−0.01) begrenzt; die Position wird dabei nie bewegt. | `FPSStrategy.ts:36–38`, Test `FPSStrategy.test.ts:36–46` |
| `CAM-NATURAL-PITCH` | Einheitliche dy-Drehrichtung (Industrie-Standard Natural Pitch); `invertY` = expliziter Legacy-Escape. | `FPSStrategy.ts:18–23,34–35`, Test `tests/core/CameraStrategyPolarity.test.ts` |
| `CAM-STRATEGY-TRANSITION` | Strategiewechsel konvertiert Zustand explizit (kein Blind-Reuse der Felder). | `Camera.ts:229–243` |
| `BOUNDS-CONTAINMENT` | Berechnete Bounds enthalten die Geometrie; `isCollidable=false` ⇒ keine Bounds. | `Object3D.ts:94–102` |
| `STATIC-INTENT` | `isStatic` ist Absicht, kein Optimierungs-Hebel; keine versteckte Caching-Semantik. | `Object3D.ts:104–117`, `Scene.ts:214–216` |
| `PROJECTION-INVERTIBILITY` | `screenToWorld∘worldToScreen ≈ id` unter Toleranz; degenerierte Kamera soft-fail statt Crash. | `tests/core/CameraDegenerateSoftFail.test.ts` |
| `FRAME-ORDER` | Feste, getestete Phasen-Reihenfolge pro Frame (`step()`): physics → Interpolation (Renderpose) → Kamera → Lights/Cascades (Ist-Pose) → Frustum-Cull → Render; ein Phasen-Reorder bricht die Oracle-Tests laut. | `SmallWorldMachine.ts` `step()` (Phasen-Kontrakt), Test `tests/core/SmallWorldMachinePhaseOrder.test.ts` |

Wer eine Invariante referenziert, deren ID nicht im Seed steht, erweitert den Seed (Check-
Konstante + dieser Tabelle) oder nutzt den Escape-Hatch mit Begründung.

## Konsequenzen

**Positiv**

- **Eine wiederkehrende Fehlerklasse bekommt einen prüfbaren Maßstab:** Die 5 Prinzipien sind kein
  floskelhafter Leitfaden, sondern in Marker, Registry und einem Checker operationalisiert. Review
  kann einen Knob ohne Domänenbedeutung, eine Extraktion ohne 3 Fälle, einen Modus-Wechsel ohne
  Transitionstest, eine mathematische Behauptung ohne Invarianten-ID standardisiert zurückweisen.
- **Die Anti-Dogma-Bremse ist eingebaut, nicht nachgerüstet:** Zwei-Klassen-Modell, Rule-of-Three
  für die Regeln selbst, Null-False-Positives-Erstlauf, Pflicht-Begründungs-Escape, Sunset. Die
  Doktrin verdient ihre Schärfe aus Fängen, nicht aus Überzeugung.
- **Kein neues Tooling-Vakuum:** Ein Node-Skript ohne Dependency (Reuse des
  `check-verified-markers.js`-Musters), kein ESLint-Plugin, kein Framework, kein neues Dateiformat;
  ADR 0041 (`schemaVersion`) bleibt unberührt.
- **Der Pilotkorpus ist real, nicht aspirational:** R1, R2, R3, R4, D3, D5, D8 sind auf HEAD
  umgesetzt und im Ledger als „behoben" verbucht — die Doktrin verankert die Realität und liefert
  zugleich die ersten Rule-of-Three-Evidenzen.

**Negativ / Kosten**

- **Schreib-Overhead im Hot-Scope:** Neue öffentliche Parameter brauchen eine Ein-Zeilen-
  Klassifikation; das ist die bezahlte Versicherung gegen den 15-dimensionalen Tuning-Raum.
- **Tag-Ritual-Risiko:** Tags können mechanisch ohne gedankliche Bedeutung gesetzt werden. Dagegen:
  Ein-Zeilen-Bedeutungspflicht (ein Bullshit-Tag ist peinlicher als gar keiner) und Review-Sicht.
- **Heuristik-Latenz:** Klasse-B-Heuristiken sind zunächst advisory; echte Guardrails greifen erst
  nach 3 Fängen. Bewusst getragen (Anti-Dogma), dafür Sunset-geschützt.
- **Doppel-Dokum ent: `@domain`/`@derived`/`@fixed` als neue Tags neben dem `@param`-Korpus.** Der
  Checker ist strikt syntaktisch; semantische Echtheit („ist das wirklich eine Domänengröße?") bleibt
  Review-Arbeit.

**Auswirkungen**

- **API/Compatibility:** Keine bestehende API wird geändert; bestehende Parameter sind vom Retrofitting
  befreit. Neu öffentliche Hot-Scope-Parameter unterliegen der Klassifikationspflicht.
- **CI (draft, nicht hard verdrahtet):** `npm run check:doctrine` ist registriert. Die Aufnahme in den
  CI-`verify`-Job ist ein **separater, post-gate Schritt** (Folder-Stufe-1-Vorgabe: P2/P3-Analyse nicht
  durch Werkzeug blockieren). Erster Lauf: vollgrün (0 Treffer im Error-Tier).
- **Dokumentation:** Ledger (`docs/reference/doctrine-ledger.md`) ist der committed Fang- und
  Rekalibrierungs-Nachweis; `.agents/notes/backlog.md` bleibt operative Scratch-Tracking-Stelle.
- **ADRs:** Jedes künftige ADR trägt den Pflichtabschnitt „Doctrine Compliance" (siehe Vorlage unten).

## Alternativen (verworfen, mit Begründung)

- **Status quo ohne Doktrin:** verworfen — Whack-a-Mole setzt sich pro Subsystem fort (Shader ↔
  Kamera ↔ Physik); die Phasen 2–5 brauchen einen stabilen Maßstab.
- **Schwere Regel-Pflicht jetzt (alles Error-Tier sofort):** verworfen — dogmatische Blähung,
  widerspricht der Pragmatismus-Klausel; erzwingt historisches Retrofitting und False-Positive-
  Reparatur statt Fänge.
- **ESLint-Plugin-Route:** verworfen (R6) — schwergewichtiger als ein Script (Plugin-Dependency,
  langsamer zu ändern); ESLint bleibt für Code-Struktur, nicht für die Doktrin.
- **Per-Prinzip-Werkzeuge (fünf Prozesse):** verworfen — fünf Prozesse ≥ einer; Bürde steigt
  quadratisch mit der Prinzipienzahl.
- **Ledger nur in `.agents/notes`:** verworfen (D15) — gitignored, Fresh-Clone-frei. Committed
  Ledger ist alternativlos für einen überlebenden Nachweis.

## Prüfbare Konsequenzen / Messbarkeit (KPIs M1–M5)

Eine Metrik pro Prinzip darf hart sein, höchstens zwei advisory — nie ein KPI-Bürokratieraster.

| ID | Prinzip | Metrik (Proxy) | Typ | Instrument / Gate-Verhalten |
|---|---|---|---|---|
| **M1** | P1 | Unklassifizierter neuer öffentlicher Parameter im auditierten Hot-Scope | **Hart (Error-Tier)** | `check:doctrine`; nur *fehlender* Tag schlägt fehl, nie die Klassenwahl |
| M1b | P1 | Dead-Knob-Inventar (deklariert-ungelesen) | Advisory | `check:doctrine --enable-advisory`; Handlung pro Knob in Review |
| M1c | P1 | Leaky-Knob-Ableitungs-/Clamp-Abdeckung | Advisory | berichtet (dokumentiert), nie gescort |
| **M2** | P2 | ADR-Extraktion mit <3 benannten Fällen (nur merge-/gate-relevante ADRs) | **Hart** | Review-Checkliste A4 + Doc-Scan (Fallliste nicht leer) |
| M2b | P2 | Universal-Mode-Flag-Dichte in geteilten Modulen | Advisory | Trend; Review-Re-Trigger, kein Zahlen-Gate |
| **M3** | P3 | Modeful Klasse ohne dedizierten Live-Transition-Test | **Hart** | Zählung auditiertes Set vs. Transition-Test-Dateien; nur bootstrapierte Set, keine erfundenen Klassen |
| M3b | P3 | Sentinel-Identity-Stellen (`!==`-Objektidentität) | Advisory | Trend; je Stelle aufgelöst oder mit Kommentar legitimiert |
| M3c | P3 | State-Interleaving-Defektzahl (Backlog-Kategorie) | Advisory | Monotonie-Ziel, im Ledger/Backlog |
| **M4a** | P4 | Core-Invarianten-ID mit CI-Regressions-Abdeckung | **Hart** | ID muss im Seed existieren + Test-Verlauf referenzieren (v1: Seed-Auflösung hart, Test-Verlauf via Reviewer) |
| M4b | P4 | Metamorphischer Anteil neuer Mathe-lastiger Tests | Advisory | Report als Trend |
| M4c | P4 | `[VERIFIED: …; invariant=<ID>]`-Claims | Hart (bestehende Mechanik) | erweitert `check-verified-markers`-Grammatik; Pointer-not-Proof-Vorbehalt bleibt |
| **M5** | P5 | Grenz-/Corner-Abdeckung riskanter Skalar-Eingänge (auditiertes Set) | Hart für Set → advisory sonst | Bootstrap-High-Risk-Set (Kameras, Lichter, Octree, Kollision, Materialien); Testnamen-Konvention A3 |
| M5b | P5 | Unguardierte Divisionen durch abgeleitete Größen | Advisory | Review-Liste |
| M5c | P5 | Honest-Fallback-Dokumentation an tier-gated Features | Advisory | ADR-/Guide-Wortlaut; neue Features via A4 gebunden |

**Bürokratie-Deckel:** exakt ein hart-gatefähiger Scan (`check:doctrine`), eine Review-Checkliste
(§ „Doctrine Compliance"), null Standing-Meetings. Phasen-Gates konsumieren die Ausgaben;
nichts läuft intervall-basiert.

> **Hinweis zur ehrlichen Lücke in v1:** Die harten KPIs M2 (ADR-Fallliste), M3 (Transition-Test),
> M4c (`[VERIFIED … invariant=`-Grammatik) und M5 (Grenz-Test-Namensscan) sind im ersten
> Checker-Stand bewusst **nicht** automatisiert (Zero-False-Positives-Regel); sie bleiben
> Review-/Ledger-Punkte und werden per Rule-of-Three nachgeschärft. Automatisiert in v1 sind
> ausschließlich die Marker-Syntax-, Registry-ID-, Escape-Hatch- und ADR-Compliance-Checks (alle mit
> 0 Treffern auf HEAD ⇒ erster Lauf vollgrün) sowie die advisory Class-B-Heuristiken hinter Flags.

## Doctrine Compliance

Jedes künftige ADR, das einen öffentlichen Parameter, eine geteilte Abstraktion, ein modeful Objekt
oder eine mathematische Behauptung einführt, trägt **verbindlich** den folgenden Abschnitt (die
„n/a"-Antworten ehrlich setzen; ein weggelassener Abschnitt ist ein A4-Verstoß und bricht `npm run
check:doctrine` ab ADR-Nummer ≥ 0047):

```markdown
## Doctrine Compliance
- Neue öffentliche/r Parameter (Hot-Scope): `<namen>` → Klassifikation `domain|derived|fixed`
  (+ einzeilige Bedeutung / Ableitung / Einfrier-Grund) — oder „keine neuen"
- Geteilte Abstraktion eingeführt/verbreitert? → Rule-of-Three-Konsumenten (≥3, semantic) +
  geteilter Mathe-Block (oder „n/a"; Renderer-Shared-Infrastructure: ADR-0038-Ausnahme benannt)
- Modeful Objekt? → Transition-Semantik beschrieben + Live-Transition-Test-Referenz (oder „n/a")
- Mathematische Behauptungen → Invarianten-Registry-ID(s) + Test-Datei-Verweis (oder „n/a")
- Neue Skalar-Eingänge / tier-gated Capability → Grenz-Politik + Corner-Tests + Honest-Fallback-
  Aussage (nur falls render-kritisch; sonst kosmetisch-advisory markieren)
- Ausnahmen von dieser Doktrin begründet unter: `<verweis>` (Escape-Hatch-Pflicht)
```

Template-getrieben, kein Formular um des Formulars willen: ADRs mit ehrlichen „n/a" passieren; ADRs,
die den Abschnitt weglassen, scheitern an der A4-Prüfung.

## Bereits umgesetzte Exempel (Pilotkorpus — das ADR verankert Realität, nicht Wunsch)

Die folgende Tabelle dokumentiert die auf HEAD **bereits real umgesetzten** Phase-1-Exempel, die als
erste Rule-of-Three-Evidenzen ins Doctrine-Ledger („behoben") eingebucht sind. Sie demonstrieren,
dass die Doktrin aus der Praxis der Engine stammt — die Umsetzung des Gates ging der
Doktrin-Verankerung voraus.

| Exempel (Ruling) | Prinzip | Umsetzung (HEAD-Anker) | Dokumentations-/Test-Nachweis |
|---|---|---|---|
| **R1** — Orbit `minPhi/maxPhi` ersatzlos entfernt (Dead-Knob) | P1 | `core/controllers/OrbitController.ts` (grep `minPhi\|maxPhi` → **0 Treffer** auf HEAD; künftiges vertikales Orbit-Clamping als Elevation-Property in den Strategien) | entfernt per Gate-Ruling, kein Config-Overrides mehr |
| **R2** — Einheitliche Maus-Polarität (Natural Pitch) | P1/P3 | `strategies/FPSStrategy.ts:18–23,34–35` (`invertY` als expliziter Legacy-Escape) | `tests/core/CameraStrategyPolarity.test.ts` (pinnt die einheitliche dy-Richtung) |
| **R3** — `computeBounds()`-Kugel-Guard (BoundingSphere) | P5/P4 | `core/Object3D.ts:94–102` (dokumentierter `isCollidable`/Bounds-Vertrag; Sphären-Code existiert und wird erreicht) | Vertrag dokumentiert; Invariante `BOUNDS-CONTAINMENT` |
| **R4** — FPS-Sentinel (`targetPos !== camera.target`) gelöscht | P3/P1 | `strategies/FPSStrategy.ts:26–31` (Kommentar dokumentiert die Entfernung; Position = Controller-Sache) | `tests/core/FPSStrategy.test.ts` (Position bleibt controller-owned) |
| **D3** — Explizite Strategie-Transition | P3 | `core/cameras/Camera.ts:229–243` (`setStrategy` konvertiert theta/phi explizit, D3-Kommentar inline) | Live-Transition-Pfad gegengezeichnet; Invariante `CAM-STRATEGY-TRANSITION` |
| **D5** — `isStatic`-Semantik kodifiziert | P3 | `core/Object3D.ts:104–117` („intentional state, NOT an optimization lever"), `core/Scene.ts:214–216` | Vertrag dokumentiert; Invariante `STATIC-INTENT` |
| **D8** — Soft-Fail-Verträge gepinnt (H2) | P5/P4 | (kein Code-Eingriff nötig; Guards halten regular) | `tests/core/CameraDegenerateSoftFail.test.ts` (D8/H2) + `tests/math/Matrix4.test.ts` (lookAt) |

Weitere Gate-Exempel (z. B. D7 Octree accept-and-document) sind fallweise im Ledger nachgepflegt. Der
Ledger (`docs/reference/doctrine-ledger.md`) ist der **committed** Nachweis von Fängen, Rekalibrierung
und Sunset; `.agents/notes/backlog.md` bleibt nur operative Tracking-Stelle.

## Referenzen

- **Schwerpunkt-Quelle:** `S2 §1–§4` (Whack-a-Mole, Tuning-Knob-Fallacy, 5 Goldene Prinzipien);
  Gate-Dossier `.agents/scratches/schwerpunkte/p1-whack-a-mole/p1-gate-dossier.md` §8 (Rulings R1–R6,
  D9–D17); Dave-Report `.agents/scratches/schwerpunkte/p1-whack-a-mole/dave-report.md` (§2–§8, §11–§14).
- **Verwandte verbindliche Vorgänger:** ADR 0044 (Ehrliche Tests-Doktrin — ergänzt diese Doktrin um
  Test-Inhalts-Ehrlichkeit; Verwaltung der *Suite*), ADR 0043 (Honest-Fallback-Muster, hier per D13
  gezielt übernommen), ADR 0038 (Shared-GL-Infrastructure — Rule-of-Three-Ausnahme), ADR 0035
  (Tier-Politik: Perf-Tier skaliert Budgets, nie Domänen-Parameter), ADR 0026/0027/0013 (Uniform-/
  Material-Parallelität), ADR 0041 (persistierte Schemas — von dieser Doktrin unberührt).
- **Ledger:** `docs/reference/doctrine-ledger.md` (Fang-/Rekalibrierungs-Nachweis, committed, Deutsch).
- **Tooling:** `scripts/check-doctrine.ts` (`npm run check:doctrine`), Muster `scripts/check-verified-markers.js`.
- **Verteidigung der Registry-Seed-Einzigkeit:** Die 7 Seed-IDs (Tabelle oben) sind ausschließlich an
  HEAD real verankert; eine künftige S4-Matrix (IDs 1.1–3.2) wird als additive Erweiterung am P5-Gate
  übernommen, nicht ersatzweise eingeführt.

