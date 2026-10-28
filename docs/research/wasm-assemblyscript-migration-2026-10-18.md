# WASM / AssemblyScript-Migration: Analyse einer teilweisen & vollständigen Verlagerung von Berechnungen

> **Status:** Point-in-time-Analyse (2026-10-18), noch **keine Entscheidung** getroffen — dieses
> Dokument ist ein Recherche-Papier im Sinne von `docs/research/` (Bestandsaufnahme, Pros/Contras,
> Empfehlung), **kein** ADR. Wird die Strategie fixiert, gehört die Entscheidung als ADR
> (Vorschlag `docs/adr/0036-typescript-bleibt-kein-wasm-assemblyscript.md`) dokumentiert.
> **Update 2026-10-19 — Entscheidung getroffen:** [ADR 0036](../adr/0036-typescript-bleibt-kein-wasm-assemblyscript.md)
> ist seit **2026-10-18 ACCEPTED** und folgt dieser Empfehlung: additiv bleiben, kein Vollumstieg;
> einziger fest eingeplanter WASM-Einsatz ist Asset-Decoding außerhalb des Kerns
> (`packages/gltf-extensions`, ADR 0018). Die Analysen und Empfehlungen dieses Papiers bleiben
> unverändert gültig und sind unverändert als Referenz zu lesen.
> **Anlass:** User-Frage, ob Teile der Engine (Berechnungen) oder die Engine **zur Gänze** auf
> WASM/AssemblyScript umgestellt werden sollten.
> **Kontext:** Dieses Papier versteht sich als Sparring-Input im Sinne der AGENTS-Doktrin
> („critical architect hat", Benchmark gegen bewährte Industrie-Standards) und ist gegen den
> **Ist-Zustand der Engine** geschrieben, nicht gegen ein hypothetisches Projekt.
> **Relevante Bestandteile des Ist-Zustands:** Kern ist **frei von WASM** (nur Capability-Check in
> `DeviceCaps.ts`); Decoder für Draco/Basis sind per [ADR 0018](../adr/0018-gltf-data-level-extensions-and-ecosystem-package.md)
> **bewusst außerhalb** des Kerns (`packages/gltf-extensions`) platziert; schwere GPU-Parallelarbeit
> läuft bereits als **WebGPU-Compute-Pipelines**; CPU-Offload existiert bereits als
> **Web-Worker-Pool** (`core/threading/ThreadPool.ts`).

---

## 1. Terminologische Klarstellung (Voraussetzung für jede Wertung)

Die Frage vermengt zwei Kategorien, die getrennt bewertet werden müssen:

1. **WASM als Ausführungsziel** — erreichbar aus Rust, C/C++, Zig, Go u. v. a. (dort: `wasm-bindgen`,
   Emscripten), und vermeintlich „einfach“ aus TypeScript-artigem Code.
2. **AssemblyScript (AS) als Sprache** — geht man davon aus, „Weil wir schon TypeScript haben,
   stellen wir um“, liegt darin der **größte Irrtum**. AS ist **kein TypeScript 2.0**. Es ist eine
   *strikte, ahead-of-time kompilierte Variante* von TypeScript mit eigenen Werttypen (`i32`,
   `u8`, `f64`), eigenem stdlib und eigener Speicher-Handhabung. Die offizielle Projektdokumentation
   sagt selbst: *„Will AssemblyScript support all of TypeScript eventually? It likely won't."*
   `asc` kann bestehenden Engine-Code **nicht** einfach „übernehmen“; ein Umstieg ist ein
   **Rewrite in einer eingeschränkten Schwester-Sprache**, kein Port.

Zusätzlich gilt eine **harte Plattform-Grenze**: WebGL/WebGPU, DOM, Input, Audio und WebHID
(`joy-con-webhid`) sind im Browser **nur aus JavaScript erreichbar**. WASM kann die GPU-API nicht
direkt aufrufen (die Interface-Types-Vorschläge sind nicht ausgeliefert; Ansätze wie „WebGPU in
WASM“ sind experimentell und benötigen weiterhin JS-Aufsetzlogik). Damit ist ein „zur Gänze auf
WASM“ als Endzustand **strukturell unmöglich** — es bliebe immer eine JS-Shell um einen WASM-Kern.

> **Folgerung:** Die ehrliche Leitfrage lautet nicht „WASM oder nicht?“, sondern:
> *Wie schmal kann die JS-/Web-API-Grenze geschnitten werden, und welcher Arbeitsanteil ist so
> geformt, dass WASM ihn tatsächlich schneller und deterministischer macht?*

---

## 2. Ist-Aufnahme: Wo steht Small World Machine heute

| Bereich | Tatsächlicher Stand (2026-10-18) |
|---|---|
| WASM im Kern | **Keines.** `DeviceCaps.ts` prüft nur `typeof WebAssembly === "object"`. Kein `.wasm`-Asset, keine Binary im Laden. |
| Draco/Basis/Meshopt | **Explizit außerhalb des Kerns** als WASM-Decoder in `packages/gltf-extensions` ([ADR 0018](../adr/0018-gltf-data-level-extensions-and-ecosystem-package.md), „Kern bleibt schlank“, „ultraleicht gewichtig, zero-external-dependencies“). |
| Massive GPU-Parallelarbeit | **Bereits als WebGPU-Compute-Pipelines relokalisiert:** Clustered-Light-List (`ClusterCullPassGPU.ts`), HZB (WebGPURenderer), HBAO (`AOPassGPU.ts`), Volumetric-Fog/Froxel inkl. Injection/Temporal-Reprojection/Integration (`VolumetricFogPassGPU.ts`). |
| CPU-Offload | **Bereits vorhanden** als Web-Worker-Pool (`core/threading/ThreadPool.ts`, Blob-Worker, Transferables). |
| CPU-Hotpaths | PhysX (`broadphase/`, `narrowphase` via `Collision.ts`, `solvers/ContactSolver.ts`, CCD `SweptSphereCCD.ts`, `joints/`), `physix/fluids/BuoyancySolver.ts` (CPU-Proben), prozedurale Geometrie, glTF-Parsing, Kit-/MapGen. |
| Math | `math/Vector3D`, `Matrix4`, `Quaternion`, `MathPool` (Allokations-freie Scratch-Pools im Hotpath). |
| Determinismus & QA | `captureFrameRate`-Modus, Golden-Baseline, GPU-Paritäts-Proben (z. B. Wellen-Sonde CPU↔Shader, `probe:gpu-parity`, gemessen bis µm) — **~2000 Tests** per Vitest. |
| Konsolen-/Desktop-Pfad | `docs/guides/commercial-indie-roadmap.md`: Konsolenport würde über **nativen C++-Host mit eingebetteter WASM-Runtime (Wasmtime)** oder Tauri gehen — *dort*, nicht im Browser, spielt „WASM als App-Ebene“ eine Rolle. |

**Beobachtung:** Die beiden Dinge, die WASM klassischerweise motivieren — (a) massive
daten-parallele Arbeit und (b) CPU-Parallelität —, sind hier **bereits anders gelöst**:
daten-parallel über GPU-Compute (WebGPU), parallel über Web Worker. Eine WASM-Migration würde
also heute größtenteils „heiße Pfade ersetzen, die gar nicht (mehr) auf der Haupt-CPU liegen“.

---

## 3. Teilweise Migration („Berechnungen“): Pros & Contras pro Kandidatenklasse

### 3.1 Wo WASM/AS echte, belegbare Gewinne brächte

**Kriterien für echte Tauglichkeit** (alle müssen erfüllt sein): selbstgenügsame, abgeschlossene
Arbeit; batch-/array-förmig statt objektgraphen-durchzogen; CPU-intensiv; keine Objekte/Callbacks
über die Grenze; kein Zugriff auf Web-APIs innerhalb des Moduls.

| Kandidat | Pro | Contra / Aufwand | Urteil |
|---|---|---|---|
| **Asset-Decoding** (Draco/Basis/Meshopt) | 2–10× Decode, vom Main-Thread weg, keine Abhängigkeit im Kern | — | **Bereits Doktrin** ([ADR 0018](../adr/0018-gltf-data-level-extensions-and-ecosystem-package.md)). Realer Gewinn; hier sind C++→WASM-Portierungen der reife Weg, nicht AS. |
| **Physikkern im Ganzen** (Broad/Narrowphase, `ContactSolver`, CCD, Joints) | deterministischer (s. §5), GC-frei im Kern, ins Worker auslagerbar, typischer 2–5×-Bereich bei vielen Körpern; etabliertes Web-Muster (Rapier, Ammo, Planck, Box2D-WASM) | Eigenen Kern in AS neu bauen = Großprojekt; fertige Lösungen (Rapier) kollidieren mit „null Abhängigkeiten“-Doktrin und sind Rust, nicht AS | ⚠️ **nur als Worker-Modul**, nach Bottleneck-Messung; nicht als Selbstzweck |
| **Batch-Kernel** (z. B. `BuoyancySolver` über N Körper, MapGen-Noise, Kit-/Prozedural-Generierung) | echte, messbare Batch-Speedups; schmales `Float32Array`-ABI; Paradebeispiel für AS („image manipulation, hot game logic, specialized algorithms“ laut AS-Doku) | Dual-Impl-Parität (CPU↔WASM↔Shader) wird CI-Dauerpflicht | ⚠️ eng geschnitten, **optional** |
| **Mesh-/Asset-Verarbeitung** (Decimation, Voxelisierung, Bake) | ja, aber selten im Browser-Hotpath | selten genutzt | 🔸 nur bei realem Bedarf |

### 3.2 Wo WASM/AS NICHT gewinnt — und warum das den Kern der Entscheidung ausmacht

1. **Mathe-Bibliothek (`Vector3D`, `Matrix4`, `Quaternion`):** Der häufigste Fehlschluss ist,
   „Berechnungen“ mit „Math“ gleichzusetzen. Diese Typen sind das **Vokabular des Objektgraphen** —
   sie werden von Behaviors, FSM-Callbacks, Animation, Forge-Inspektor und Nutzercode tausendfach
   pro Frame berührt. Jede Vektor-Op, die nach WASM wandert, wird zum **Cross-Boundary-Call mit
   Boxing/Kopieren**. V8 erreicht bei skalarer Float-Arithmetik erfahrungsgemäß 50–90 % eines
   optimierten WASM-Binaries — nach Marshalling ist man **langsamer** und muss jeden Konsumenten
   umschreiben. `MathPool` existiert genau dafür, diesen JS-Pfad allokfrei zu halten.
   → **Math bleibt in TS.**
2. **Behavior/FSM/EventBus/Callbacks (`State Data`):** Closures über Nutzerdaten, Editor-Sicherheit,
   Live-Edit. WASM kann keine JS-Closures halten; jeder Rückweg ist ein teurer Trampolin.
   → **Die Logik-Bausteine bleiben in TS.** Das ist kein technisches Defizit, sondern ein
   **Produkt-Argument**: Behaviors/FSMs sind der Kreativ-Anteil der Engine.
3. **Renderer/Shader:** GPU-gebunden; WASM auf der CPU hilft nicht; der Bulk läuft bereits in den
   Compute-Pipelines aus §2. → **bleibt unangetastet.**

### 3.3 Contra (projektübergreifend, gewichtig)

- **Zweite Sprach-/Wahrheitsebene:** AS = eigene Toolchain (`asc`), eigene Tests, eigene
  Debugging-Werkzeuge (hinter V8 zurück). Jede Zahl, die in WASM rechnet, muss in CI-Parität mit
  der JS- und der Shader-Wahrheit stehen. Die Wellen-Sonde (§2) zeigt bereits den Preis solcher
  Parität — er ist Wartungslast, kein Einmalaufwand.
- **GC ist nicht weg, er kommt zurück:** Der *managed* AS-Runtime hat wieder einen Garbage
  Collector; *unmanaged* heißt manuelle Speicher-Disziplin (`__new`/`__pin`/Allokator) im Hotpath —
  Fehlerquelle und Memory-Safety-Risiko bei sehr begrenzter Gegenleistung in den meisten Fällen.
- **Ökosystem/Reifegrad AS:** bis heute **kein 1.0**, Mini-Registry, kaum gepflegte AS-Math-Libs.
  Die ausgereiften Wege sind **Rust (`wasm-bindgen`)** und **C++/Emscripten** — beides bedeutet:
  man verlässt TypeScript eben doch.
- **Bundle/Loading:** zusätzlicher Binär-Blob, Streaming-Instantiation, Worker-Pfad, Lizenzfragen,
  Startkosten auf Mobile.
- **SAB braucht Cross-Origin-Isolation:** **geteilte** Speicherparalleltät (SharedArrayBuffer)
  setzt COOP/COEP-Header voraus — ein Deployment-Constraint, das viele Hosts nicht setzen.
  (`ThreadPool.ts` umgeht das heute korrekt über Transferables ohne SAB.)

---

## 4. Vollständige Migration („zur Gänze“): warum sie für DIESE Engine nicht trägt

1. **Browser-API-Grenze („Web-API-Shim“):** GL/GPU, DOM, Input, Audio, `joy-con-webhid`, Forge-Overlay
   sind JS-only. Ein WASM-Kern bekäme eine ABI/Syscall-Schicht — faktisch landet man wieder bei der
   **JS-Shell + WASM-Kern**-Architektur, die es im Web immer gab. „Zur Gänze“ existiert als Zustand nicht.
2. **Das Produkt IST TS:** Behaviors, FSMs, Maker-Tools, MapGen, Forge — der Kreativ-Anteil, den
   Künstler live editieren. In einem WASM-Kern müsste jede solche Interaktion über die Grenze
   marschieren → Latenz, Komplexität, Live-Edit kaputt, Inspektionswerkzeuge lahmgelegt.
3. **Dev-Maschinerie kollabiert:** ~2000 Tests (Vitest), Puppeteer-Goldens, Forge-Inspektor,
   V8-Debugger — alles TS-first. WASM-Debugging hinkt bis heute deutlich hinterher.
4. **Es ist ein Rewrite von ~63.400 LoC** auf einem peripheren AOT-Subset-Compiler, der vorhandene
   TS-Dynamik (Closures, dynamische Shapes, hohes stdlib) gar nicht ausdrücken kann. Risiko massiv,
   Nutzen gering — **weil die echten Hotpaths bereits GPU-compute-parallelisiert oder
   worker-ausgelagert sind** (§2).
5. **Kein Präzedenzfall stützt eine Vollverlagerung:** Drei-große-Web-Engines (three.js, Babylon,
   PlayCanvas) halten TS-Kerne und setzen WASM **additiv** ein (rapier, basis, ammo) — nie ersetzend.
   Unreal/Epic gingen fürs Desktop/Konsole an C++/nativen Host — und selbst dort bleibt im Web die
   JS-Shell.

---

## 5. Pro-Punkte, die man ehrlich anerkennen sollte

Neben den klassischen „schneller/GC-frei“-Argumenten gibt es einen **spezifischen, handfesten** Vorteil:

- **Determinismus über Engines hinweg:** WASM-`f64`-Operationen sind in der Spezifikation **exakt**
  festgelegt. JavaScript garantiert IEEE-754 zwar für elementare Operatoren, aber `Math.sin/cos/exp…`
  dürfen engine- und implementationsabhängig approximiert werden. Wer **cross-engine
  byte-deterministische** Physik oder Rechenkerne will (Golden-Baselines über verschiedene
  Browser/Devices), bekommt das nur über einen WASM-Kern zuverlässig. Konkret: Es würde die
  Golden-Baseline-Aussagekraft stärken — **um den Preis**, dass Dual-Impl-Paritäts-Proben (§3.3)
  die neue Daueraufgabe sind.
- **Arbeits-Auslagerung & Multi-Core:** Physik mit `SharedArrayBuffer` + Workern ist der etablierte
  Weg für große Szenen — setzt aber §3.3 (COOP/COEP) voraus.
- **Zero-Allocation-Doktrin im Kern:** Ein unmanaged-WASM-Kern hat *per se* keine GC-Pausen im
  heißen Pfad — insofern die konsequente Umsetzung der bestehenden „Zero-Allocation (Hot Path)“-Linie,
  aber nur dort, wo die Grenze schmal bleibt.

---

## 6. Entscheidungsmatrix (zusammenfassend)

| Bereich | WASM sinnvoll? | Empfohlener Weg |
|---|---|---|
| Vektor/Matrix/Quat | ❌ | TS + `MathPool` (bleibt) |
| Behaviors/FSM/Renderer | ❌ | TS / GPU-Compute (bleibt) |
| Draco/Basis/Meshopt-Decoding | ✅ | C++→WASM, **außerhalb** des Kerns ([ADR 0018](../adr/0018-gltf-data-level-extensions-and-ecosystem-package.md)) |
| Physik ab größerer Bodyzahl | ⚠️ nur als Worker-Modul | fertige Runtime (Rapier-compat) **oder** eigener enger Batch-Kernel; erst nach Messung |
| Batch-/Gen-Kernel (MapGen, Buoyancy, Kit) | ⚠️ eng geschnitten | WASM/AS mit `Float32Array`-ABI + Paritäts-Tests |
| „Zur Gänze“ | ❌ | verwerfen als Ziel; additiv bleiben |

---

## 7. Empfehlung

1. **Keinen „Umstieg“. Bewusst additiv bleiben.** Der Kern bleibt TypeScript.
2. **Fest eingeplant:** Draco/Basis/Meshopt-Decoder via `packages/gltf-extensions` — wie von
   [ADR 0018](../adr/0018-gltf-data-level-extensions-and-ecosystem-package.md) bereits beabsichtigt;
   das ist der einzige WASM-Einsatz mit klarem, unverfänglichem Nutzen. Bevorzugt etablierte
   C++→WASM-Portierungen, nicht AS.
3. **Optional, beweis-getrieben:** Erst wenn eine Bottleneck-Messung (`.agents/scripts/perf-liquid.mjs`,
   Profiling) für eine konkrete Szene belegt, dass die CPU kippt (z. B. Physik ab N Körpern),
   **einen** schmalen Kernel als isoliertes Worker-Modul mit `Float32Array`-ABI portieren —
   entweder fertige Runtime oder ein eigener AS-Batch-Kernel. **Nie Vektor-/Matrix-Typen und nie
   Callbacks/Behaviors über die Grenze führen.** Jede Dual-Implementierung wird durch
   Paritäts- und Golden-Tests (Muster: Wellen-Sonde) CI-pflichtig.
4. **„Zur Gänze“ als Ziel streichen.** Der Konsolen-/Desktop-Pfad ist ohnehin über den nativen
   C++-Host (`commercial-indie-roadmap.md`) abgedeckt — dort ist „eingebettete WASM-Runtime“
   eine Frage des *Hosts*, nicht der Engine-Architektur.
5. **Falls die Strategie fixiert wird:** Entscheidung als ADR dokumentieren
   (Entwurf `docs/adr/0036-typescript-bleibt-kein-wasm-assemblyscript.md`), mit Verweis auf dieses Papier.
   **Update 2026-10-19 — erledigt:** die Entscheidung ist getroffen,
   [ADR 0036](../adr/0036-typescript-bleibt-kein-wasm-assemblyscript.md) ist ACCEPTED
   (2026-10-18) und verweist auf dieses Papier; die Empfehlungen bleiben unverändert.

---

## 8. Offene Fragen / nächste Schritte

- **Messen vor entscheiden:** Liegt heute real CPU-Last im Physics-/Buoyancy-Pfad? WebGPU-Targets
  sind GPU-gebunden; ist der Deckel überhaupt die CPU?
- **Körper-Zahl-Schwelle:** Ab welcher Body-Zahl würde WASM-Physik die Parity-Proben rechtfertigen?
- **Schlankheit vs. Rapier:** Beharrt die „null Abhängigkeiten“-Doktrin auch gegenüber einem
  geo-prüfbaren, lizenzierten WASM-Runtime-Binary, oder ist ein mitgeführtes Binary akzeptabel?
- **AS vs. Rust/C++:** Falls portiert wird: AS (gleiche-Sprachfamilie, schwaches Ökosystem) oder eine
  reife Fremdsprache (starkes Ökosystem, aber zusätzliche Build-Kette)?

---

## 9. Quellen & Belege

- **Projekt-Code:** `packages/engine/src/core/DeviceCaps.ts` (WASM-Capability-Check), `packages/engine/src/core/threading/ThreadPool.ts` (Worker-Pool), `packages/engine/src/renderers/passes/ClusterCullPassGPU.ts` + `renderers/post/passes/{AOPassGPU,VolumetricFogPassGPU}.ts` + `renderers/WebGPU/WebGPURenderer.ts` (Compute-Pipelines), `packages/engine/src/physix/**` (Physics, ContactSolver, CCD, BuoyancySolver), `packages/engine/src/math/MathPool.ts`.
- **Projekt-Doktrin:** [ADR 0018](../adr/0018-gltf-data-level-extensions-and-ecosystem-package.md), `docs/guides/commercial-indie-roadmap.md`, `CONTEXT.md` („Basis Transcoding“, „MathPool“, „Zero-Allocation (Hot Path)“, „Tiered Renderer Autonomy“), `packages/gltf-extensions/README.md`.
- **AssemblyScript (offizielle Doku, Stand 2026-10):** AssemblyScript ist eine per Binaryen AOT-kompilierte *Variante* von TypeScript; „all of TypeScript? It likely won't.“; managed stdlib (Array/String/Map) mit GC; Runtime-Varianten managed/unmanaged; empfohlene Use-Cases: „image manipulation, hot game logic, specialized algorithms, emulators, compilers“.
- **Alternative Toolchains:** Rust + `wasm-bindgen`, C/C++ + Emscripten (reife Pfade zum realen WASM-Einsatz im Web).
- **Plattform-Grenze:** WebGL/WebGPU sowie der Rest der Web-API sind JS-only; direkter GPU-Aufruf aus WASM ist (Interface-Types/direktes WebGPU) weiterhin experimentell, nicht produktionsreif.
