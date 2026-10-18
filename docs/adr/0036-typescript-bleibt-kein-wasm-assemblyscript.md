# ADR 0036: TypeScript bleibt — kein WASM/AssemblyScript bis auf weiteres

> Status: **ACCEPTED** (2026-10-18). Entscheidung des Maintainers: Die Engine bleibt bis auf weiteres
> vollständig TypeScript. Dieser ADR hält die Analyse, die Messdaten und die Bedingungen fest, unter denen
> die Frage neu gestellt wird.

## Kontext & Problem

Gefragt war, ob Teile der Berechnungen (Physik, Procgen, Culling) oder die gesamte Engine nach
WASM/AssemblyScript (AS) wandern sollten. Ausgangslage: ca. 63k Zeilen Engine-TS, ca. 23k `tools`; eigenes
WASM gibt es nicht, nur Vendor-WASM für Draco und Basis. Rechenlastig sind `physix/` (Broadphase,
Narrowphase, Solver, CCD), `geometry/procgen`, `VoronoiFracture`, `ClusterGrid`-Culling und der IBL-Bake.

## Messung (2026-10-18)

Aufbau: alle 38 Showcases unter WebGL2, echte Metal-GPU, 1280×720, Dev-Build, Desktop-Mac, 14 s nach 6 s
Warm-up; die fünf schwersten zusätzlich mit dem CPU-Sampling-Profiler (CDP). Skripte und Rohdaten:
`.agents/scratches/{survey,profile}.mjs`, `survey*.json` (lokal).

- **Alle Showcases halten 60 fps**; die höchste JS-Zeit lag bei 6,0 ms/Frame (von 16,7 ms).
- **Kein Rechenkern dominiert.** Die Top-Posten waren GL-Synchronisation, keine Mathematik:
  `texSubImage2D` (80 % in 15/16, Upload der Cluster-Texturen) und `getError` (75 % in 14, Depth-Blit-Probe
  pro Frame), dazu verteilter Renderer-Overhead (19).
- **Physik ist praktisch unsichtbar:** `Collision.test` 1,3 %, Broadphase-Update 0,8 % in Showcase 21.
- **GC ist kein Befund:** kein `(garbage collector)` in den Top-12, Heap-Wachstum ca. 0 MB/s.
- Einziger echter CPU-Rechenkern: Cluster-Culling (Showcase 29, ca. 1,5 ms/Frame) — unter WebGPU ohnehin ein
  Compute-Shader.

Die drei daraufhin umgesetzten TS-Fixes (alle in TypeScript, ohne neue Toolchain):

| Showcase | JS ms/Frame vorher | nachher |
| -------- | ------------------ | ------- |
| 15       | 5,16               | 1,11    |
| 16       | 4,94               | 0,96    |
| 14       | 4,81               | 1,07    |
| 29       | 4,01               | 2,46    |
| 10       | 3,68               | 1,35    |
| 21       | 2,04               | 0,49    |
| 23       | 1,88               | 1,76    |
| 19       | 5,99               | 5,04    |

Fixes: (1) Depth-Blit nur nach (Re-)Allokation per `getError` prüfen (`WebGL2Renderer.copyToOpaqueDepthTexture`);
(2) Cluster-Indexliste kompakt packen und nur die belegten Zeilen hochladen
(`WebGLClusterCullPass._uploadAndBind`, bei 1280×720 vorher ca. 11 MB pro Frame); (3) Uniform-Lookups inkl.
Fehlschlägen pro Programm cachen (`WebGL2Renderer._cachedUniformLocation`). Ein Schaden dieser Größe wäre
durch WASM nicht behoben worden: Er lag in der GL-Grenze, die auch aus WASM nur über JS-Glue erreichbar ist.

## Entscheidung

1. **Die Engine bleibt reines TypeScript.** Kein AssemblyScript, kein anderer WASM-Kern, solange keine
   Messung (unten) einen Rechenengpass belegt.
2. **Ein Vollumstieg ist ausgeschlossen:** DOM, WebGL und WebGPU sind nur über JS erreichbar, Renderer,
   Szenengraph, Loader und Tools gewinnen nichts, und ein Rewrite von ca. 90k Zeilen steht in keinem Verhältnis.
3. **Reihenfolge bei künftigem Performance-Bedarf** (jede Stufe mit Abbruchkriterium): messen →
   Allokationen/GL-Sync abbauen → Typed-Array/SoA-Layout in TS → Worker (Physik off-thread, dafür den
   `fnString`-basierten `ThreadPool` durch echte Modul-Worker ersetzen) → WebGPU-Compute → erst dann WASM.
4. **Re-Evaluations-Trigger** für einen WASM-Pilot, mindestens einer:
   - Profil zeigt einen CPU-Rechenkern (Physik, Procgen, Fracture) mit > 25 % der Frame-Zeit **nach**
     Stufe 3 und 4;
   - Mobile-Messung (Quality-Tier-Arbeit, ADR 0035) zeigt Rechenlast als Engpass;
   - Bedarf an deterministischer Physik (Replays/Lockstep-Netcode).
5. **Falls WASM kommt:** nur ein isolierter Kernel hinter einem Interface, der TS-Pfad bleibt Referenz und
   Fallback (wie bei der Tiered-Renderer-Autonomie), Benchmark-Gate ≥ 2× sonst verwerfen, SoA-Umbau der
   betroffenen Daten vorher in TS. Sprachwahl dann neu bewerten: Rust/Zig sind technisch robuster als AS,
   AS ist nur TS-ähnlich (keine Unions/`any`, eingeschränkte Closures/Generics, eigene Runtime/GC).

## Begründung (Pros/Cons der Analyse, gekürzt)

Für WASM sprachen: GC-freie, vorhersagbare Frame-Zeiten, SIMD (2–4× bei Batch-Mathe), Determinismus,
Portabilität (Browser und Node/CLI, vgl. ADR 0034), erzwungene Datenorientierung.

Dagegen sprachen: V8 liegt auf monomorphem Typed-Array-Code oft nur 1–2× hinter WASM; die Grenze ist teuer,
wenn Daten kopiert werden müssen, ein Gewinn setzt SoA im linearen Speicher voraus (Umbau von `RigidBody`);
AS ist nur TS-ähnlich; ESLint/Typedoc/Vitest-Mocks, Source-Maps und Debugging gelten nicht für den WASM-Teil;
asynchrone Initialisierung kollidiert mit dem Fail-Fast-Lifecycle; Threads brauchen `SharedArrayBuffer`
(COOP/COEP, Hosting-abhängig); zwei Sprachen und Toolchains widersprechen der Simplicity-Doktrin, und
LLM-gestützte Entwicklung ist in TS am zuverlässigsten. Mehrere Engine-Instanzen wären dagegen unproblematisch
(eine `WebAssembly.Instance` pro Engine) und kein Gegenargument.

## Grenzen der Messung

Desktop-Mac mit M-Klasse-GPU, Dev-Build, WebGL2, kurze Fenster. Nicht gemessen: Mobilgeräte, WebGPU-Pfad,
Szenen mit vielen Rigid-Bodies jenseits der vorhandenen Showcases. Eine Messung dort kann Punkt 4 auslösen.
