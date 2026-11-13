# ADR 0044: Ehrliche Tests-Doktrin & Konsolidierung der Test-Suite

> **Status: ACCEPTED** — 2026-10-24 (Session „Testverantwortlicher"-Review). Grundlage: kritische
> Review der Test-Suite (Ziele, Vertiefung, Verdichtung, Streichen von Netto-Null/irreführenden
> Tests), Messungen gegen reale Engine-Werte (Temporär-Proben, danach gelöscht) und Umsetzung
> aller fünf vom Nutzer beauftragten Arbeitsströme in einem kohärenten Milestone: Commit `48fd9540`
> „It is a capital mistake to theorize before one has data." (2026-10-23, 15 Files, +1060/−480).

## Kontext & Problem

Die Test-Suite des Repos wuchs organisch und enthielt eine Reihe von Tests, die **echten
Schutz vortäuschten**, ohne einen zu liefern, oder den Code an Stellen pinnten, die keine reale
Semantik hatten:

- **Netto-Null-Tests** (asserten Zustand, der gar nicht entstand) und **No-Op-Tests** (toter Code).
- **Irreführende Hardcodewerte:** Der Resolver-Slop-Korrektur-Faktor war in Kommentaren mit `±0.25`
  beschrieben, der echte gemessene Wert ist aber exakt `±0.2475`; Tests wurden auf Werte aus
  Kommentaren statt auf gemessene Wahrheit gestützt.
- **Verlogene Toleranzen:** z. B. `toBeCloseTo(1e10, -8)` (ein `1e10`-Wert „auf 10 Stellen" — sinnlos)
  oder Dot-Product-Identitäten mit dem Anschein hoher Präzision, die bei 5.7e-7 numerischem
  Float-Fehler nur mit Präzision 5 belastbar sind.
- **Tests für nicht existierende Mathematik:** `LightShaftsMath.test.ts` testete „Math", die in
  keinem `src`-Pfad ausgeliefert wurde; `Affectors.test.ts` wurde vollständig von `AffectorsDeep`
  subsumiert.
- **Duplikation/Führungslosigkeit:** z. B. 10+ aufeinanderfolgende duplizierte
  `system.fixedTimeStep =`-Zeilen in `PhysicsSystem.test.ts`.

## Entscheidung

Die Test-Suite folgt ab sofort der **Ehrliche-Tests-Doktrin** — fünf verbindliche Regeln:

1. **Gemessene Wahrheit statt Kommentar-Wahrheit.** Toleranzen und Erwartungswerte basieren auf
   gemessenen realen Engine-Werten, nicht auf Vermutungen/Kommentaren. Wo ein Kommentar und die
   Messung divergieren, gewinnt die Messung (Resolver-Slop: `±0.2475` statt `±0.25`, Kollisions-Output
   exakt `±1`). Belege aus Wegwerf-Proben sind im ADR/Aussage dokumentiert, die Proben selbst
   werden nicht eingecheckt.
2. **Kein Netto-Null, kein No-Op.** Jeder Test muss einen echten Zustand auslösen und asserten.
   No-Op-Testelemente werden entfernt (SquashStretch: von 4 auf 3 echte Tests), vollständig
   subsumierte Dateien gelöscht (`Affectors.test.ts`), Tests für nicht ausgelieferte Mathematik
   gelöscht (`LightShaftsMath.test.ts`). `MaterialUsage.test.ts` **bleibt** — es ist ein legitimer
   Architektur-Guard.
3. **Tier-Parity-Guards prüfen ausgelieferten Quelltext.** Statt Shader-Mathematik in Tests zu
   duplizieren und damit „zweite Quelle" zu pflegen, lesen Parity-Tests die **tatsächlich
   ausgelieferten Shader-Sources** via `fs` (`VignetteFormula.test.ts`, Pfad-Tiefe `../../src`) und
   beweisen deren mathematische Äquivalenz (GL1-Direktdistanz vs. GL2/GPU
   `length(abs(uv-0.5)*2)*0.5`). Tests pinnten damit das Artefakt, nicht eine Kopie.
4. **Lifecycle- und Invarianten-Tests als Spezifikation.** Schwer einschbare, unsichtbare
   Zusicherungen werden explizit getestet: Scene-/Object3D-/Behavior-Lifecycle (inkl.
   Verhaltens-Mutation während `Scene.update`), graphische Algebra-Identitäten
   (`M·M⁻¹=I`, `det=sx·sy·sz`, Inverse-Singularität, Orthonormalität; Quaternion-Inverse-Komposition
   ≈ Identität, unit length persistence), sowie Multi-Frame-Physik-Invarianten
   (`PhysicsMomentumConservation`: linearer Impuls < 1e-6, elastische kinetische Energie < 1e-2 über
   mehrere Frames — beides beweist zugleich, dass die Kollision tatsächlich stattfand).
5. **Binär-Fixtures werden im Test gebaut, nicht eingecheckt.** `parseGlb`-Randfälle
   (Security/Hardening: Magic, Version≠2, Header-Overflow, fehlende/duplizierte JSON-Chunks,
   unbekannte Chunks, `getBufferData`-Randpfade) nutzen einen `buildGlb()`-Writer
   (Spec-Konform) statt externer `.bin`-Fixtures — deterministisch, selbstdokumentierend,
   ohne Binärdateien im Repo.

### Corpus-Konvention: Byte-Contract vs. Math-Mirror vs. Real-Probe (P5-Realignment, ADR 0044)

Am P5-Gate (2026-10-25, Realignment-Entscheidung E3) wird die Test-Suite noch einmal auf die
folgenden, klar getrennten Korpus-Arten hin strukturiert. Jeder Test datei-weit EINE Art als
Header deklariert; eine Vermischung (z. B. „mirror-centric Datei, die nebenbei Strings bedient")
ist zu vermeiden:

1. **Byte-Contract / String-Guard**: verriegelt die exakte Verdrahtung im **ausgelieferten**
   Shader-/Source-Text (`SpotLightPCSS.test.ts`). Keine eigene Mathematik, kein „zweites Gesetz" —
   ein Reorder/Umbenennen bricht CI direkt.
2. **Math-Mirror**: dupliziert eine SHIPPED Formel als reine Funktion (Konstanten identisch aus
   dem Kern extrahiert) und assertet die mathematische Relation (`PcssMonotonicity`,
   `FroxelReprojection`-Teleport-Mirror, `PbrEnergyConservation`). Ehrlich gekennzeichnet, weil
   es eine zweite Quelle ist; die Konstanten/Relationen werden strukturell gegen den Kern
   gegengecheckt (Drift-Guard).
3. **Real-Probe**: treibt die echte Engine-API (`updateCascades`, `_updateBehaviorsRecursive`,
   `GlobalUniformLayout`, Accumulator-`step`) und assertet beobachtbare Eigenschaften — kein
   Duplikat, kein Mirror. Wo eine Engine-Tabelle autoritativ ist
   (`GlobalUniformLayout.ts`), wird GEGEN sie geprüft statt sie zu reimplementieren
   (`ClusteredLightingAlignment`).

Historie: Die frühere `ClusteredLightingAlignment.test.ts`-Byte-Tabelle war eine handgeschriebene
std140-Spiegelung und driftete vom einzigen autoritativen Layout weg; sie ist in eine
Real-Probe gegen `WebGL2GlobalUniformLayout` umgebaut (P5-DP-6).

### Golden-Pipeline-Status (Teilentscheidung, dokumentiert)

Der ~25-min-Golden-Lauf (`.agents/scripts/goldens/`) bleibt bewusst ein **manuelles Audit und KEIN
Push-/PR-Gate**, trotz der sonst strikten Gate-Kultur des Repos. Begründung: Das Kosten-Nutzen
eines CI-Gates für einen Lauf dieser Länge ist ungeklärt; der Status ist in
`.agents/scripts/goldens/README.md` als expliziter Status-Header plus Toleranz-Caveat dokumentiert.
Die Entscheidung „Goldens dauerhaft in CI verdrahten" bleibt ein offener, dokumentierter
Entscheidungspunkt.

### Erweiterung 2026-11-13: Test-Scope (WAS), Timing (WANN) & Canary-Smoke-Gate

Die Ehrliche-Tests-Doktrin regelte bisher, *wie* Tests aufgebaut sind, aber nicht, *welche*
Änderungen überhaupt einen Test bekommen und *wann* sie entstehen. Zu viele kleinteilige
Mock-Tests im Renderer (>27k Zeilen) bremsen Umbauten aus und übersehen dennoch reale Integrations-
und Bundler-Fehler (z. B. fehlende Vendor-/WASM-Assets oder Shader-Link-Fehler). Verbindliche Regeln 6–8:

6. **WAS getestet wird (Signal statt Masse):**
   - **Pflicht für Unit-/Contract-Tests:** Mathematik & `@invariant`-Zusicherungen, Physik,
     Parser-/Binär-Hardening, Buffer-/UBO-Byte-Layouts (`GlobalUniformLayout`), Shader-Tier-Parity
     gegen ausgelieferten Code (ADR 0057), nicht-triviale Zustandsübergänge/Lifecycles und **genau 1**
     Repro-Test pro echtem Bugfix.
   - **Verboten (kein Test-Spam):** Triviale Getter/Setter/Defaults/Enum-Werte, reines
     Delegations-Wiring nach Refactorings, **neue White-Box-Tests auf `_privateFields`** sowie
     **neue GPU-/WebGL-Context-Mock-Tests**, die nur `vi.fn()`-Aufrufe statt echter Grafik prüfen.
     Bestehende Alt-Mocks werden bei im Weg stehenden Refactorings entkoppelt oder entfernt statt
     mitgeschleppt.
7. **WANN Tests entstehen (Kein Flow-Blocker):**
   - **Während Feature-Bau, Exploration oder Refactoring:** Keine neuen Unit-Tests schreiben.
     Schnelles Feedback läuft über `npm run typecheck`, `lint:glsl`/`lint:wgsl` und bestehende Tests.
   - **Erst bei stabiler API am Meilenstein-Ende (vor dem Commit):** Einmal gegen Regel 6 prüfen und
     nur für dort gelistete Punkte gezielt Tests ergänzen. Bei reinen Refactorings ohne neue Semantik:
     0 neue Tests.
   - **Ausnahme Bugfix:** 1 minimaler Repro-Test direkt nach Lokalisierung des Root Cause.
8. **Canary- & Spectrum-Smoke-Gate statt Renderer-Mocks (alle 3 Renderer-Tiers):**
   - Echte Laufzeit-, Bundler-, Asset- und Shader-Fehler werden über `npm run test:canary`
     (`build:showcases` + `.agents/scripts/check-showcases.js 10,28,30,37,40,48,52` — mathematisches
     Schnell-Set mit 37/49 Engine-Features ohne Netz/Schwergewichte) bzw. vor Releases/großen
     Renderer-Umbauten über `npm run test:spectrum` (`4,6,10,13,14,23,26,28,30,34,37,40,41,42,48,50,51,52`
     — Minimum-Set-Cover für **49/49 = 100 % Feature-Abdeckung**) plus `lint:glsl`/`lint:wgsl` abgesichert.
   - **Pflicht über alle Tiers (`WEB_GL1`, `WEB_GL2`, `WEB_GPU`):** Jeder Smoke-Lauf prüft alle Features
     auf **allen drei** Renderern — ausdrücklich auch dann, wenn ein niedrigerer Tier (z. B. `WEB_GL1`) ein
     Feature höherer Tiers nicht unterstützt, um den absturzfreien Honest-Fallback (0 Console-Errors,
     kein schwarzer Canvas) zu beweisen.


## Konsequenzen

- **Verifikation als Honest Gate:** Nach der Reform: `tsc --noEmit` sauber, `eslint` auf allen
  geänderten Dateien sauber, geänderte Suiten 140/140 grün, **kompletter Repo-Lauf 2968/2968 grün**
  (405 Dateien), `npm run build:lib` OK. Die Pre-Commit-Hook (lint-staged) lief mit sauberem
  Ergebnis über die gestagten Dateien.
- **Nicht „fixen" (Regressionen):** Ein künftiger Engineer sollte NICHT (a) Toleranzen wieder auf
  Kommentar-Werte aufweichen, (b) die `VignetteFormula.test.ts`-Shader-Quellen-Abhängigkeit durch
  Hardcoding ersetzen, (c) No-Op-/Netto-Null-Tests re-importieren oder (d) die Goldens ohne den
  dokumentierten Kosten-Nutzen-Beschluss als CI-Gate erzwingen.
- **Messe-Reflex:** Wer einen neuen mathematischen Erwartungswert in Tests einschreibt, misst ihn
  zuerst gegen die echte Engine (Temporär-Probe), statt ihn aus Kommentar/Annahme zu übernehmen.

## Referenzen

- Umsetzung: Commit `48fd9540` („It is a capital mistake to theorize before one has data.", 2026-10-23)
- Golden-Pipeline-Status: `.agents/scripts/goldens/README.md` (Status-Header + Toleranz-Caveat)
- Berührte Suiten: `packages/engine/tests/{core,loaders/gltf,math,physix,renderers}`,
  `packages/vfx-extras/tests` (Löschungen: `Affectors.test.ts`, `renderers/post/LightShaftsMath.test.ts`)
- Verwandte ADRs: 0035/0036 (messungsgestützte Entscheidungen), 0043 (Quelltext-Guards + goldener
  Test als Muster für „Tests pinnten das Artefakt")
