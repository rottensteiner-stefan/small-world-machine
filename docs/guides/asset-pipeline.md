# Asset Sourcing, Budgets & Modular Environments

This guide establishes the engine-wide doctrine for sourcing 3D assets, structuring texture libraries, managing geometric triangle budgets, and authoring modular game environments in Small World Machine.

---

## 1. Sourcing Philosophy: Pragmatism & The "Handful" Rule

When building scenes, prototypes, or production dioramas, adhere to three core sourcing principles:

### Pragmatism Over Reinvention
Whenever standard 3D meshes or baseline materials are needed, leverage established, high-quality open repositories rather than modeling from scratch:
* **ambientCG (Lennart Demes):** >1,800 CC0 PBR materials. Essential for bunker concrete, damp tunnel walls, brick, mud, tiles, and weathered metals.
* **Poly Haven:** High-fidelity CC0 assets and physically calibrated PBR maps (Normal, Roughness, AO).
* **Kenney Assets:** Modular prototyping kits, furniture, and clean UI symbols.
* **Sketchfab (CC0 / CC-BY):** Detailed reference props and mechanical models.
* **Tripo3D API & AI Ingestion:** Rapid generation of bespoke low-poly props (`.glb` with optimized PBR atlas) based on 2D concept sketches or prompt briefs.

### The "Handful" Rule (3–5 Candidates)
Before settling on an asset or investing hours in custom modeling:
1. Source and download **3 to 5 candidate variants**.
2. Place them side-by-side in a test diorama or dev scene.
3. Compare them directly under engine lighting for **style consistency, silhouette clarity, polycount, and texture scale**.
4. Discard the unfitting candidates and commit only the winning asset.

### User Responsibility & Tooling Freedom
The user carries the sole responsibility for all prompts, assets, and licenses. The engine and its developer tools intentionally impose zero patronizing copyright checks or moralizing barriers. Build pragmatic, high-performance tools.

---

## 2. Texture Strategy: PBR vs. Shader Styling vs. Hero Props

Not all surfaces should be created the same way. Balance visual fidelity and production speed according to surface category:

| Surface Category | Recommended Source | Workflow & Technical Rationale |
| :--- | :--- | :--- |
| **Generic Surfaces**<br>*(Concrete, asphalt, masonry, gravel, rusted sheet metal, wooden planks)* | **Calibrated CC0 Packages**<br>*(ambientCG, Poly Haven)* | Physically calibrated PBR maps (Normal, Roughness, AO) with zero AI artifacts. Eliminates hundreds of hours of manual texture painting and baking. |
| **Stylized Graphic Looks**<br>*(Ink hatching, hand-drawn grooves, comic outlines)* | **Shader Stage & Post-Processing** | The engine's post-processing passes (`OutlineElement`, custom composite shaders) apply a consistent cross-scene graphic treatment uniformly over all PBR materials without dirtying source textures. |
| **Story-Critical Key Props**<br>*(Hero machinery, labeled cans, custom terminals, signs)* | **Bespoke Authoring**<br>*(AI Generation + SVG/CAD + PBR Finish)* | Narrative uniqueness and localized typography demand tailored wear patterns, exact labels, and dedicated UV layouts. |

---

## 3. The 4-Tier Polycount & Geometry Budget ([ADR 0011](/adr/0011-three-tier-rendering-architecture))

To avoid **sub-pixel quad overdraw** (where micro-triangles smaller than a 2×2 pixel fragment quad choke mobile TBDR rasterizers) and keep initial load times minimal, every 3D asset must adhere to a strict geometry budget based on its maximum bounding box dimension ($L_\text{max}$):

| Tier | Object Category | Max Dimension ($L_\text{max}$) | Target Budget (Tris) | Typical Examples |
| :---: | :--- | :---: | :---: | :--- |
| **Tier 1** | Clutter & Small Items | $\le 0.35\,\text{m}$ | **$800 – 1,500$** | Cups, plates, cutlery, switches, notes, bullets, small tools. |
| **Tier 2** | Medium Props | $0.35 – 1.0\,\text{m}$ | **$2,500 – 4,500$** | Boots, lamps, stools, buckets, toolboxes, wall vents. |
| **Tier 3** | Furniture & Machinery | $1.0 – 2.5\,\text{m}$ | **$6,000 – 10,000$** | Desks, bunk beds, lockers, industrial barrels, terminals. |
| **Tier 4** | Hero Props & Architecture | $> 2.5\,\text{m}$ | **$10,000 – 16,000$** | Heavy blast doors, wall breaches, rubble mounds, vehicles. |

> [!TIP]
> Budgets are enforced **upstream** during initial modeling, decimation, or via export parameters (e.g. Tripo `face_limit` or Blender remeshing with normal baking). Never ship raw multi-million polygon photogrammetry scans into web runtimes.

---

## 4. The 4-Pillar Modular Environment Doctrine ([ADR 0019](/adr/0019-modular-environment-design))

When assembling environments ranging from a small 7×7 m room to a 50 m hall, repetition and tiling artifacts destroy immersion. All modular kits follow four architectural pillars:

### 1. Multizonal PBR Palettes
Every architectural kit provides at least **4 distinct PBR material variants** representing different environmental states:
* *Base Structural Concrete* (e.g. board-formed concrete)
* *Smooth Panel Concrete* (refined architectural cassettes)
* *Damp / Saltpeter Concrete* (water leakage and mineral efflorescence for lower wall sections)
* *Heavy Reinforced Concrete* (fortress-grade aggregate for pillars and lintels)

### 2. Architectural Cadence & Modular Grids (3 m / 5 m)
Break up expansive flat surfaces rhythmically:
* Divide walls with structural **pilasters** (wall columns) every 3 m or 5 m.
* Use overhead **ceiling beams** to guide the eye and compartmentalize light volumes.
* Apply a darker, rougher **damp baseboard** zone along floor intersections to ground the architecture.

### 3. Dual Decal Layering (Macro vs. Micro)
Apply decals ([see Decals Guide](./decals.md)) in two distinct conceptual passes:
* **Macro-Decals (Wear & Destruction):** Large-scale water seepages, rust tracks, concrete spalling (`rebar_damage`), and scorch marks spanning 2–5 meters.
* **Micro-Decals (Signage & Narrative Detail):** Local stenciled numbers, warning labels, hazard stripes (`hazard_stripes`), and luminescent route markings (`guide_stripe_glow`).

### 4. Deterministic UV Jitter
To prevent adjacent modular wall chunks from displaying identical recognizable texture knots or stains, apply an instance-based UV offset:
```typescript
const jitterX = (chunkWorldX * 0.37) % 1.0;
const jitterZ = (chunkWorldZ * 0.37) % 1.0;
material.diffuseMap.offset.set(jitterX, jitterZ);
```
This guarantees continuous variation across modular tiling geometry with zero runtime memory overhead.
