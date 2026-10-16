# 0031: Volumetric Froxel Fog (Stufe 3, WebGPU Compute)

- **Status:** Accepted (Implementation in Progress)
- **Date:** 2026-10-16
- **Status of:** *[2026-10-16 Ready]* 3-Tier Fog Standard, Stufe 3
- **Decision Makers:** Small World Machine Architecture Team (human-approved 2026-10-16)

---

## Context & Motivation

The fog & volumetric lighting roadmap (`.agents/notes/backlog.md`, Stufe 1..3) mandates a true
3D volumetric fog layer as the third tier:

- **Stufe 1** — classic analytic distance/height fog (`Fog.ts`, all backends). ✅
- **Stufe 2** — volumetric light shafts (God Rays, ADR 0030), 2-tier hybrid across all backends. ✅
- **Stufe 3** — real 3D in-scattering against local + directional lights ("froxels"). 📋 → 🔜

W1 of `docs/research/aaa-engine-techniques.md` explicitly requires a Frustum-aligned voxel grid
("froxels", e.g. 160×90×64 in the reference texts) that **reuses the clustered-light
infrastructure** for per-cell light lists (ADR 0007), with a Mie/Henyey-Greenstein phase function,
raymarch/Z-integration in compute, and additive compositing before tonemapping.

### Open questions that had to be decided

1. **Grid coupling** — build an own dense 3D grid (full freedom, own culling/storage path,
   ~3.7× more cells than the 190k-cluster grid, higher VRAM) or reuse the existing 16×16-tile
   cluster grid (ADR 0007) as the froxel grid.
2. **Backend scope of V1** — WebGPU compute plus WebGL2 CPU-culling data texture, or WebGPU only.
3. **Shadow interaction** — whether directional CSM self-shadowing is part of V1 or a follow-up.
4. **Compositing** — forward-pass in-scattering lookup (invasive, touches every material shader)
   vs. a dedicated fullscreen composite pass (LightShafts pattern, ADR 0030).

---

## Architectural Decision

The human approved the following binding decisions on 2026-10-16 (do not re-litigate in future
sessions):

1. **Option R — Cluster-Reuse:** The froxel grid **is** the existing clustered light grid
   (`ClusterGrid` / `computeClusterCounts` / `zSliceFromViewDepth`, 16×16-tile + log-staggered
   Z-slices). No second culling/storage path. A denser grid stays a measured candidate later.
   The single source of truth for the grid formula is extracted into `packages/engine/src/math/froxel.ts`.
2. **WebGPU only in V1:** The compute injection + integration path is WebGPU-only. The WebGL2
   tier (CPU culling + data-texture lookup on the same formula) is a separate follow-up (P2);
   WebGL1 remains on Stufe 1 analytic fog.
3. **CSM self-shadowing IN V1:** Local-light in-scattering considers directional-light shadow
   self-occlusion through the existing Directional CSM of Stufe 2 (ADR 0030) — zero extra
   shadow passes.
4. **Compositing = dedicated composite pass:** Unlike the plan's forward-pass lookup, the
   integrated in-scattering texture is composited additively **before tonemapping** through the
   existing post-processing composite (`PostProcess.frag.wgsl`, LightShafts pattern). This keeps
   all material shaders untouched and minimizes regression risk for existing showcases (29).
   The analytic distance/height fog (Stufe 1) stays active in parallel; the volumetric part is
   strictly additive to it.

### Data & resource flow (WebGPU V1)

```
[Main Pass] → [Opaque Depth] → [Froxel Injection (compute):
                                  per-cell density + local-light in-scattering,
                                  walks the SAME cluster light lists (ADR 0007)]
                              → [Integration (raymarch): per-pixel Z-integration,
                                  directional CSM self-shadowing + phase per step]
                              → [Composite (fullscreen, additive, pre-tonemapping)]
```

New/changed surface (V1 scope):
- `packages/engine/src/math/froxel.ts` — grid formula (single source of truth, backends mirror it).
- `VolumetricFogElement` (post-processing API, off by default like `LightShaftsElement`).
- `froxel_inject.wgsl` (compute) + `VolumetricFog.frag.wgsl` (integration ray-march fragment).
- `VolumetricFogPassGPU` (injection + integration orchestration after the `LightShaftsPassGPU` pattern).
- WebGPURenderer wiring + additive composite block in `PostProcess.frag.wgsl`.
- WebGL2 tier (`VolumetricFogPassGL`, CPU culling + data texture) = follow-up P2.

---

## Consequences

### Positive
- Zero redundant light-culling and zero extra shadow passes; grid and light lists can never
  disagree per cell (Option R is literally what W1 asks for: "reuses the clustered-light
  infrastructure").
- Dedicated composite keeps the material forward pass untouched; existing Showcase 29
  (Light Shafts) stays a separate, orthogonal element.
- Budget-friendly on WebGPU; grid resolution stays tied to the cluster grid's screen tiles.

### Negative / trade-offs
- Option R cements the volume to the 2D tile structure — cells stay thick near the camera
  where a dense grid would be finer. Densification is tracked as a measured candidate.
- V1 leaves WebGL2 without a volumetric tier (P2); WebGL1 intentionally stays on analytic fog.
- 3D texture reads have bandwidth cost on mobile — `quality`-scaled resolution is a mitigation
  candidate in P3.
- Per-pixel raymarch integration can band; IGN jitter + temporal handling (ADR 0030:75 pattern)
  is part of P3 hardening.

### Performance gate (P3)
- Target ≤ ~1.5–2 ms on a desktop GPU for the full volumetric path before V1 closes.

---

## References

- Fog & Volumetric Lighting Roadmap — `.agents/notes/backlog.md` (Stufe 3).
- Approved plan — `.agents/scratches/volumetric-froxel-step3-plan.md`.
- Clustered light grid — ADR 0007.
- Light Shafts (3-tier Stufe 2, composite pattern) — ADR 0030.
- W1 (AAA reference techniques) — `docs/research/aaa-engine-techniques.md`.
