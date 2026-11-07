# ADR 0046: Automatisches Instancing im Renderer

- **Status:** Accepted (2026-10-24, vom Nutzer freigegeben)

Szenen mit vielen gleichen Einzelobjekten (Showcase 19: 1600 Würfel, eine Geometrie, ein Material)
erzeugten pro Objekt einen Draw, im Shadow-Pass zusätzlich pro Cascade, also bis zu ~6700 Draws pro
Frame. `InstancedMesh` ist dort keine Lösung, weil jedes Objekt eigenes Picking, eigene Behaviors,
einen eigenen Octree-Eintrag und gegebenenfalls ein eigenes Material braucht. Wir lassen den
Szenengraphen deshalb unverändert und fassen **im Renderer** aufeinanderfolgende opake Objekte mit
gleicher Geometrie und gleichem Material zu einem instanzierten Draw zusammen
(`quality.autoInstancing`, Default `true`).

## Abgelehnte Alternativen

- **Manuelles `InstancedMesh`:** verliert Picking, Behaviors und Bounds pro Objekt.
- **Mesh-Merging** (statisches/dynamisches Batching wie PlayCanvas' `BatchManager`): kostet Speicher,
  zerstört Bounds pro Objekt und muss bei Bewegung neu gebaut werden.
- **Batching über Materialgrenzen hinweg** (Material-Parameter pro Instanz, Richtung Unitys GPU
  Resident Drawer): bräuchte Material-Daten pro Instanz in einem Storage-Buffer und ist für den
  aktuellen Bedarf zu groß. Objekte mit eigenem Material bleiben eigene Draws.

## Umsetzung

- `partitionInstanceRuns()` (`renderers/AutoInstancing.ts`) teilt eine Subgroup (ein Material) in
  Runs aus mindestens 4 aufeinanderfolgenden Objekten mit gleicher `GeometryData`. Skinned Meshes,
  Geometrie mit Joints und `InstancedMesh` sind ausgenommen, im Shadow-Pass zusätzlich Nicht-Caster.
  Sprites, Decals, Vertex-Colors und Line-Quad-Schatten (ADR 0045) laufen nicht über Runs.
- Ein Run nutzt die vorhandene Instanced-Pipeline bzw. das Instanced-Programm: Model-Matrix =
  Identität, Weltmatrizen der Objekte = Instanz-Matrizen. WebGPU schreibt sie in einen
  Per-Frame-Ring (`GPUInstanceRingBuffer`), WebGL2 streamt sie in einen geteilten Puffer
  (`_renderInstanceRun` → `_drawInstanced`).
- Lifecycle-Buchhaltung (Pipeline-/Programm-, Textur- und Geometrie-Refcounts) läuft weiter pro
  Objekt.
- `HoverBehavior` klont das Material erst beim ersten Hover (Copy-on-Write) statt beim Anhängen.
  Sonst hätte jedes interaktive Objekt sein eigenes Material und würde nie gebatcht.
- WebGL1 bleibt pro Objekt (Tier-Autonomie).

## Konsequenzen

- Nur **aufeinanderfolgende** Objekte bilden Runs (keine Sortierung pro Frame). Szenen, die gleiche
  Geometrien mit anderen mischen, profitieren weniger.
- Showcase 19 gemessen: WebGPU 6695 → 6 Draws, 14,9 → 8,2 ms pro Frame (Vsync-Limit). WebGL2
  5660 → 5 Draws, die Frame-Zeit lag dort schon vorher am Vsync.
- Ein Objekt wechselt zwischen Run und Einzel-Draw, sobald sich sein Material oder seine Nachbarschaft
  ändert. Unter WebGL2 kann das beim Wechsel einmalig ein Programm nachkompilieren.
