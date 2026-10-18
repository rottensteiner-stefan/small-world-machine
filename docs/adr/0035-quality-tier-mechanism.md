# ADR 0035: Quality-Tier-Mechanismus (Detektion → Policy → Override-Sperre)

> **Status: DRAFT** — Entwurf zur Diskussion über den Quality-Tier-Mechanismus (2026-10-18, Session
> `alice-mobile-research`). Grundlage: 4-Agent-Recherche „mobile-rendering-testing" (Konsens 4/4,
> Berichte `.agents/scratches/mobile-research/01–04*.md`), Audit-Verifikation gegen `HEAD 9ba78f16`.
> Noch nicht verbindlich: Die Entscheidung wird erst mit der V1-Abgrenzung (siehe §„Offene
> Entscheidungspunkte") und der finalen Implementierung promoviert.
> **Pfade in diesem ADR beziehen sich auf `HEAD 9ba78f16` (2026-10-18); parallele Sessions
> (ADR 0032, import-type, Wave-1-Packages A/B) können Zeilen verschieben — vor Umsetzung re-validieren.**

## Kontext & Problem

Der Nutzer kann Showcases eines Xiaomi Redmi (Modell 23108RN04Y, identifiziert als Redmi 13C,
MediaTek Helio G85, Mali-G52 MC2, ~96 GFLOPS, ~13.4 GB/s geteilter Speicher, ~5 W sustained) im
selben WLAN nur „sehr zähflüssig" ausführen. Der Audit (Bericht `02`) bestätigt: Die Engine hat
**keine per-Effekt-Auflösungs-/Qualitätssteuerung und keine dynamische Render-Skala** — HBAO,
Volumetrik, Light Shafts, CSM und der Full-Res-Uber-Pass (ACES) laufen alle auf voller
Canvas-Auflösung, was auf Tile-based-Mobile-GPUs (TBR/TBDR) der Worst Case ist.

Der heutige Auto-Downgrade-Pfad (`packages/engine/src/core/SmallWorldMachine.ts:173-200`) setzt im
`start()` **nur einzelne Booleans**, abhängig von `DeviceCaps.getPerformanceTier()`:

| Tier | Effekt des heutigen Blocks |
|---|---|
| LOW | `hdr=false`, `msaa=0`, `maxAnisotropy=1`, `maxShadowResolution=512`, **`postProcessing.enabled=false`** (Post komplett aus) |
| MEDIUM | `msaa=2`, `maxAnisotropy=2` |
| HIGH | keine Overrides |

Dieser Block **schreibt `this.config.quality` und `this.config.postProcessing` nachträglich um**
(zwei Schreiborte für dieselbe Konfiguration — ein Widerspruch zur Fail-Fast-Doktrin in den
AGENTS-Instructions) und **berührt nie Auflösung, Post-Scale oder Einzel-Effekte**. Die einzige
existierende Auflösungs-Stellschraube ist `maxPixelRatio` (`EngineOptions.ts:78`, konsumiert in
`AbstractWebGLRenderer.ts:208` und `WebGPURenderer.ts`), keine Post-Resolution-Scale.

Konsequenz: Das Problem muss die Engine lösen, nicht jeder Showcase einzeln (kein
Showcase-29-Spezialfix). Die Persona (Power-User/Art Director, der bewusst konfiguriert) darf dabei
nicht entmündigt werden.

## Entscheidung

Der Quality-Tier-Mechanismus trennt **vier Ebenen**, die heute in einem mutablen `config.quality`
verklebt sind. Kernprinzip: **eine Ebene = eine Zuständigkeit, ein einmaliger Schreibort der
resolved Config, explizite Wahl sperrt Automatik.**

### Ebene 1 — Detektion (bleibt, unverändert)
`DeviceCaps.getPerformanceTier()` (`DeviceCaps.ts:594-620`) und `isMobile()` (`:549-564`) bleiben
die einzige Quelle der Geräteklassifikation. Das ist Input, kein Hook: keine neuen
User-konfigurierbaren Gerät-Knobs, keine Score-Veränderung in V1.

### Ebene 2 — Policy (NEU: Quality-Tier-Resolver)
Neu ist ein **deterministischer, einmaliger Resolver**, aufgerufen exakt einmal in
`start()` (nach `createDefaultRendererContext()`, ersetzt den Block `:173-200`). Er bildet
`(Tier, explizite Overrides) → vollständige, normalisierte `QualityConfig` + `PostProcessingConfig``
ab — **inklusive** Post-Resolution-Scale und per-Effekt-Stufen (HBAO/Bloom/Kaskaden/Fog).
Regeln:
- Die Fallback-Werte des heutigen Blocks wandern ersatzlos in die Tier-Matrix (kein Verhaltenstabu).
- Der Resolver liefert eine **geschlossene, einmalig validierte** Konfiguration; `start()` schreibt
  danach nichts mehr an `config.quality`/`config.postProcessing` nach (Fail-Fast: genau ein
  Auflösungsschritt, danach gilt die Config).
- **WebGPU wird nie als Downgrade-Schritt deaktiviert** (AGENTS-Doktrin „Never degrade WebGPU"):
  der Tier bietet pro Effekt *Stufen* an (half-res, Samples, Kaskaden), degradiert aber kein Backend.
- **Keine Shader-Recompiles durch Tier-Wechsel.** Tier-Entscheidungen werden als
  on/off-Konfiguration und Auflösungs-/Samples-Werte modelliert (statische Variationen via
  konfigurierbarer Uniforms/Konstanten), nicht als Wechsel zwischen verschiedenen Shader-Varianten —
  sonst erzeugen Tier-Wechsel genau die Ruckler, die sie beheben sollen (Bericht `04`).

### Ebene 3 — Override (bleibt, aber als explizite Sperre)
Explizite App-/User-Werte haben **Vorrang** vor der Tier-Policy (Muster aus Bericht `04`,
„explicit choice locks out auto"). Präzisierungsbedarf in V1: Die Override-Semantik wird als
„gesetzter Wert = gesperrte Achse" modelliert (ein manuell gesetztes `maxPixelRatio: 1.5` z. B.
sperrt genau diese Achse gegen die Policy, nicht die ganze Tier-Zuordnung). Umfang zeigt die
Offene-Entscheidungspunkte-Liste.

### Ebene 4 — Runtime-Feedback (optional, NICHT in V1)
Dynamische Render-Skala mit Frame-Time-Hysterese (Mechanismus b, Bericht `04`) — respektiert
Overrides, nur wenn GPU-bound-Evidenz vorliegt, nicht bei CPU-gebundenen Szenen. Wird bewusst aus
V1 heraus gehalten: Es benötigt Eingriffe in `setSize`/Resize-Pfade (paralel zu Alices Wave-1-Claim
auf `renderers/`) und verlangt Sustained-Thermal-Messung auf dem Redmi, bevor Werte kalibriert
werden können. Als eigener, späterer Meilenstein (ADR-Ergänzung).

### Was verschwindet / was bleibt

| Hook / Mechanismus | Entscheidung |
|---|---|
| `autoDowngrade`-Block `SmallWorldMachine.ts:173-200` + nachträgliche `config.quality`-Überschreibung | **Entfernt**, ersetzt durch Ebene-2-Resolver |
| `QualityConfig.autoDowngrade`-Feld (`EngineOptions.ts:76`) | **Entfernt** (obsolet) — wenn der Nutzer zustimmt: API-brechend |
| `DeviceCaps.getPerformanceTier()` / `isMobile()` | **Bleibt** (Ebene 1, Detektion) |
| `maxPixelRatio` + manuelle `msaa`/Qualitätswerte | **Bleibt**, als Override-Sperre (Ebene 3) |
| Vorhandene Hebel (`renderer.type`-Branching, Post-Pipeline-Runtime-Config, per-Effekt-`enabled`) | **Bleiben** als Implementierungs-Surface der Tier-Matrix |

## Implementierungsansatz (V1-Skizze)

1. Neue logische Einheit (im Kern, in Nähe von `DeviceCaps`/`SmallWorldMachine`): ein
   `QualityConfigResolver` (nicht-global, per Engine-Instanz — AGENTS-Doktrin „No Global Singletons",
   Konsistenz mit `RendererContext`-Muster aus ADR 0032).
2. Tier-Matrix als Daten (fertige Defaults je Tier; Werte müssen am Redmi kalibriert werden,
   Runbook Bericht `03`): LOW = Quarter-Res-AO/HBAO, ≤2 Kaskaden, kleine Bloom-Mips, kein
   Volumetrik-Composite full-res, Post-Resolution-Scale < 1.0; MEDIUM = konservative Stufen;
   HIGH = heutiges Verhalten. Baseline-Invariant: **HIGH muss exakt heutigem Desktop-Verhalten
   entsprechen** (Regressionstest auf bestehende Showcases).
3. `start()` ruft den Resolver einmal auf; danach ist die Config geschlossen.
4. Override-Sperre: explizit gesetzte Felder in `config.quality`/`config.postProcessing` gewinnen
   gegen die Matrix (V1 nur für die dokumentierten Achsen, siehe offene Punkte).

## Offene Entscheidungspunkte (vor Promotion zu Accepted)

1. **V1-Umfang statisch vs. dynamisch:** Empfehlung dieses Entwurfs: **V1 nur statischer
   Tier-Resolver (Ebene 2), keine dynamische Render-Skala** (Ebene 4 später). Reduziert Kollision
   mit Alices Wave-1-Claim (`renderers/`), Deckt das echte Problem (Redmi braucht statische
   30-FPS-Reduktion bei starken Einsparungen) ohne unkalibrierte Auto-Logik.
2. **API-Breaking `autoDowngrade`:** Feld entfernen (V1) oder deprecaten + in v1.0.0 entfernen?
   (Parallele ADRs entfernen Deprecations mit v1.0.0-Ziel — Konsistenz spricht für
   Deprecate→Remove, aber der Block selbst muss raus.)
3. **Override-Umfang in V1:** Nur `maxPixelRatio` + `msaa` als gesperrte Achsen, oder generisch
   „jedes explizit gesetzte Qualitäts-Feld sperrt"? Generisch ist weniger Code-Sonderfälle,
   aber schwerer dokumentierbar.
4. **Kaskaden-/Fog-Werte der LOW-Matrix:** exakte Zahlen werden am Redmi kalibriert — ADR
   hinterlegt nur Prinzip + Startwerte, finale Werte in der Implementierungs-Notiz.

## Consequences

- **API:** `autoDowngrade`-Feld entfällt (siehe offener Punkt 2); Konfigurationssemantik ändert
  sich von „mutabl, zweimal geschrieben" zu „einmal resolved, danach geschlossen".
- **CI/Regression:** `autoDowngrade` ist heute implizit im Verhalten von Tests/Showcases enthalten;
  Entfernen verlangt eine **Golden-/Showcase-Gegenprobe auf erzwungenem LOW** (Redmi-Simulation via
  erzwungenem Tier + niedriger Auflösung, Runbook `03`), nicht nur Unit-Tests.
- **Showcases:** Neue Default-Sicherheit für Mobile, ohne dass Showcases Code ändern müssen
  (kein Showcase-29-Sonderfall).
- **Parallel-Aktivität:** `EngineOptions.ts` (Interfaces) wird von keinem aktiven Claim berührt
  (Alice: `renderers/`+`vfx-extras`; Bob: `core/showcase/`+`apps/showcases/`); `SmallWorldMachine.ts`
  ebenfalls frei. Ebene-4-Eingriffe in `setSize` sind erst nach Alices Wave 1 zu terminieren.

## Referenzen

- Berichte: `.agents/scratches/mobile-research/01-mobile-gpu-primer.md`, `02-engine-cost-audit.md`,
  `03-device-testing-howto.md`, `04-industry-quality-tier-benchmark.md`
- Wissen: `.agents/notes/codebase-search-knowledge.md` (Abschnitt „2026-10-17 Smartphone-Rendering-Recherche")
- Backlog: Eintrag `2026-09-28 — Smartphone-Performance` (→ Update 2026-10-17)
- Verwandte ADRs: 0032 (per-Engine Shader Registry, Muster für nicht-globalen Resolver),
  0028 (Normal-Buffer), 0030/0031 (Light Shafts / Froxel Fog als Kostenpunkte der Matrix)
