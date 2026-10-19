# Log — Voxel Prototype (M0–M5 Kandieferung in SWM)

> Entwicklungslog für die Voxel-Kampagne (Dossier-Basis: `.agents/collaborate/minecraft/dossier.md`
> + `docs/log` dieser App). Einträge werden nie gelöscht; neue Einträge oben.

---

## 2026-10-19 — M0-Härtung: Live-Gate deckt 2 realer Mesher-Bugs auf (Black-Screen)

**Status:** ✅ M0-Gate final grün — Browser-Live-Verifikation (headless Puppeteer + SwiftShader,
WEBGL2) hat den Prototypen erst nach einem Heißsporn-Fix zum Zeichnen gebracht. Die Debug-Session
zeigt: **alle Engine-vermuteten Ursachen waren Rot-Schips** (UBO, Buffer-Upload, VAO, Programm,
Draw-State, Windung/Culling waren jeweils nachweislich korrekt) — der Fehler lag ausschließlich in
unserem `NaiveMesher`.

### Root-Cause (Bug #1 — der Black-Screen)

In `NaiveMesher.build()` Pass 2 wurden alle 4 Quad-Ecken in **denselben** Positions-Slot
(`base = vi*3`, im Corner-Loop überschrieben) geschrieben. Resultat: pro Face blieb nur die letzte
Ecke übrig, 3 von 4 Vertices blieben `(0,0,0)` → **jedes Dreieck war flächen-degeneriert** → nichts
wurde gerastert, ohne jeden GL-Fehler. Genau deshalb blieb auch ein hartkodierter
Fest-NDC-Quit + Flach-Magenta-Fragment unsichtbar (es leitete `gl_Position` aus `a_position` ab —
das waren lauter Nullen). Die bestehenden Unit-Tests prüften nur Zählungen + die statische
`FACES`-Winding, nie die **emittierten** Positionsdaten → der Bug schlüpfte durch.

### Folge-Fix (Bug #2 — falsche Face-Geometrie)

Die `FACES`-Templates legen Quads teils in die Nachbarzelle (z.B. -X-Face von Block z=5 mit
`TB=[0,0,-1]` → Ecke z=4; negative Achsen ohne Outward-Plane-Versatz). Neu gefasst unter klarer
Konvention „Block (x,y,z) belegt `[x,x+1]³`, Face liegt exakt auf der eigenen Grenzebene“, mit
explizitem `displacement` pro Face; `cross(TA,TB) === Normal` bleibt per Konstruktion erfüllt.

### Shader-Härtung (strikte Compiler)

- `#version 300 es` muss in **Zeile 1** stehen (nicht nach Kommentaren) — ANGLE/SwiftShader
  behandeln das sonst als GLSL-ES-1.00 (Fehler „storage qualifier supported in ES 3.00 and above
  only“). Engine-Konvention übernommen.
- Interpolations-Qualifier vor Storage-Qualifier: **`flat out` / `flat in`** (nicht `out flat`) —
  ES-3.00-Spezifikation, von SwiftShader hart durchgesetzt.
- `index.html`: `data:,`-Favicon gegen den unvermeidlichen `/favicon.ico`-404 im Headless-Test.

### Härtung des Testnetzes (Regression)

2 neue Tests in `tests/NaiveMesher.test.ts`, die **emittierte** Vertices prüfen: jede Face hat 4
distinkte, reelle Voxel-Ecken (`∈[5,6]`, kein `(0,0,0)`-Rest) und jedes emittierte Dreieck windet
gegen die Outward-Normale (kein Degenerieren/Inversion). Beide hätten Bug #1 & #2 sofort gefangen.

### Gate nach Fix (final grün)

- `npm run lint:fix` ✅ · `npm run build:lib` ✅ · `npm run test` ✅ **2322/2322** (327 Dateien,
  inkl. der 2 neuen Regressionstests).
- Live-Gate `node .agents/scratches/check-voxel-m0.mjs`: `ok: true`, `blank: false` (stddev 24.24),
  **0 Console-/Page-Errors**, WEBGL2, 720 Triangles, Test-Daten `#voxel-stats` korrekt befüllt.
- Vision-Modell (text-only-Brücke) bestätigt den Render: freistehende Terrain-Säule **Grün
  (Gras-Kappe) / Braun (Dirt) / Grau (Stein)**, Kanten sauber, keine Seams/Artefakte — der
  Per-Face-Layer-Beweis (Array-Texture, keine Bleeding) steht.

### Lehre

- Mesh-/Geometrie-Unit-Tests müssen **echte Positionsdaten** asserten (nicht nur Zählungen):
  Index-Fehler erzeugen stille Black-Screens ohne GL-Fehler.
- Das M0-Live-Gate bleibt in `.agents/scratches/check-voxel-m0.mjs` als wiederverwendbarer
  CI/QA-Baustein erhalten (SwiftShader-Pins, Pixel-Statistik, Fehler-Zählung).

## 2026-10-19 — M0 freigegeben & implementiert ("Skelett + EIN statischer Chunk")

**Status:** ✅ M0 implementiert (Freigabe-Entscheidung §4.4 #1: **Sample-App `voxel-prototype`**,
nicht Showcase). Research-Vorsprung seit 16./17.10. ist damit eingelöst (53-Quellen-Dossier hat
Folge-Commit).

### Was gebaut wurde

- **App-Shell** `apps/sample-apps/voxel-prototype/` (`index.html` + `App.ts` + `index.ts`-Barrel),
  registriert in `vite.config.ts` (`voxelPrototype`).
- **`voxel/BlockRegistry.ts`** — Single Source of Truth für Block-Semantik (id/name/transparent/
  `collidable`/`faceLayers`), kein Singleton, pro Instanz; Seed-Set Grass/Dirt/Stone. `FACE_AXIS` als
  frozen const object + Literal-Type (kein `const enum`, Repo-Konvention).
- **`voxel/Chunk.ts`** — reine DATA (Uint8Array, 16³, `[x + z*s + y*s²]`), `getBlock`/`setBlock`/
  `fill`/`dirty`. Out-of-bounds `getBlock` → AIR (exakt das, was der Naive-Mesher für Randflächen
  braucht; M1 ersetzt das durch Nachbar-Read).
- **`voxel/mesh/NaiveMesher.ts`** — naives Visible-Face-Culling (produktions-Baseline nach Dossier
  §1.4 (b), Greedy = späteres Milestone). **Windung garantiert per Konstruktion**: jede Face hat
  Tangenten-Basis mit `cross(TA,TB) === Normal` (Unit-Test assertet das). Ausgabe = pure Typed
  Arrays (`VoxelMeshData`, structured-clone-fähig für M1-Worker). Emittiert bewusst **kein** Engine-
  Import → node-testbar.
- **`voxel/mesh/VoxelChunkGeometry.ts`** — dünner `AbstractGeometry`-Adapter (Bounds,
  `getGeometryData` für Upload), `generateGeometryData()` = no-op.
- **`voxel/material/BlockMaterial.ts`** — `CustomShaderMaterial`, **GLSL300-Triplet**,
  `sampler2DArray u_blockAtlas`. Atlas-Layer reist per-Vertex in `a_color.x` (Engine-fixierter
  Attribut-Slot 11 / `VERTEX_COLOR_LOCATION`) → kein Bleeding per Konstruktion (Array-Texturen =
  separate Layer).
- **`voxel/material/shaders/BlockMaterial.vert.glsl` / `.frag.glsl`** — Vertex deklariert den
  `GlobalUniforms`-std140-Block **exakt** aus dem Engine-Header (bindet der Engine-`WebGLProgramCache`
  an jedes Programm), nutzt `u_vp`/`u_model`; Fragment sampelt Layer über
  `vec3(uv, float(v_texLayer))`, minimale selbstenthaltene N·L-Beleuchtung (M0 = Vertrag, keine
  Engine-Lichtdaten).
- **`voxel/BlockTextureFactory.ts`** — prozedurale, **lizenzfreie** Palette als `TextureArray`
  (Canvas + `createImageBitmap`, NEAREST/CLAMP/no-mipmaps); deterministischer Speckle pro Layer,
  je Layer eigene Farbfamilie → falsche Layer/Bleeding wären visuell sofort sichtbar.
- **Tests** (`tests/`): Winding-Invariante, Face-Counts (Einzelvoxel=6, Paar=10 mit ge­­cullter
  gemeinsamer Fläche, Rand-Exposition, transparenter Nachbar cullt nicht, Vollmasse 16³ = 3072
  Dreiecke = exakt die Außenschale), Layer-Mapping Grass (top=0/side=1/bottom=2), Chunk-/Registry-
  Verträge.

### Verifikation (M0-Gate)

- `npm run lint:fix`, `npm run build:lib`, `npm run test` grün (siehe Gate-Ergebnisse unten).
- Browser-Live-Check: Orbit-Kamera um die Terrain-Säule (freistehend, Gras-Kappe/Dirt-Körper/
  Stein-Sockel); 3 Atlastexturen sichtbar; `#voxel-stats` zeigt Renderer/Objects/Triangles.

### Bewusste Scope-Entscheidungen (Dossier-Disziplin)

- **WebGL2-Default** (Dossier §4.4 #5): App pinnt `WEB_GL2` (Override via `?rendererType=` für
  CI). **WebGPU (`wgsl`-Material) bewusst NICHT in M0**: der WebGPU-Material-Bind-Group der Engine
  bindet feste 2D-Texture-Views (`u_diffuseMap`, …), keine Array-Texture-Views → `texture_2d_array`
  bräuchte eine kleine Engine-seitige Bind-Group-Erweiterung. Eigener Folge-Meilenstein, kein
  Scope-Creep in M0.
- **WebGL1 ebenfalls ausgesetzt** — WebGL1 hat kein `sampler2DArray`; 2D-Atlas-Fallback = separates
  Material (später).
- **Worker-Meshing erst M1** — M0 mesht auf dem Main-Thread (Dossier M0 = "Skelett + EIN statischer
  Chunk"). `ThreadPool` + Transferables sind bereits verdrahtet vorgesehen.
- **Keine Kollision, kein Lichtsystem, keine Persistenz** — alles M1+.
- **Klare Positionierung:** "ATM" = 1 Chunk = 1 `Object3D` = 1 Draw-Call (Dave-Report §2.1);
  kein InstancedMesh für Chunks.

### Nächste Schritte (M1)

`ChunkWorld` (Map + Lebenszyklus), `TerrainGenerator` (deterministisches Noise-Heightfield),
`GreedyMesher` im `ThreadPool`-Worker, `MeshWorkerProtocol` (typisierte Transfer-Nachrichten),
Voxel-AABB-Sweep-Resolver für den Spieler, Naht-freies Streaming. → Dossier §4.2 M1.
