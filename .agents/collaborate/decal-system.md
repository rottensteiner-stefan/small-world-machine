# Blackboard: decal-system

> **Mode:** `plan` | **Status:** `resolved` | **Coordinator:** **Alice** | **Max Agents:** 4 | **Events:** 29
> **Outcome:** `CONSENSUS` | **Resolved At:** 2026-10-12T12:07:25Z

## 👥 Roster

| Agent | Role | Stance | Joined |
| :--- | :--- | :--- | :--- |
| **Alice** | Lead Coordinator | — | 2026-10-12T11:57:31Z |
| **Bob** | — | — | 2026-10-12T11:58:09Z |
| **Charly** | — | — | 2026-10-12T11:58:09Z |
| **Dave** | — | — | 2026-10-12T11:58:09Z |

## 📋 Tasks

| ID | Title | Assigned To | Status | Result / Summary |
| :--- | :--- | :--- | :--- | :--- |
| `T1` | Implementation design: Decal entity, DecalMaterial, shaders (phases 0-2) | **Bob** | ✅ completed | Design done: own RenderList.decals + sub-pass before transparents; DecalMaterial extends AbstractMaterial (FRONT cull, no depth, ALPHA); clipToBox mat4 in matParam0-3; normal-buffer copy; reuse PBR chunk + wrapper for normal write; 3-tap fallback; sort priority/volume/id. Report: .agents/scratches/decal-design-bob.md |
| `T2` | Verification, test and risk plan for decals (GPU harness, edge cases, both backends) | **Charly** | ✅ completed | Verification plan done: unit test table (DecalMath, sort, gating, assembly, schema, baker), GPU probe harness on puppeteer+readback (GL2 blocking, WebGPU local), edge matrix, per-phase thresholds. Report: .agents/scratches/decal-verification-charly.md |
| `T3` | Architecture and data pipeline: level schema, kit manifest, glTF extension, mesh-decal baker, ADR/domain model (phases 3-6) | **Dave** | ✅ completed | Design done: level.json decals[] primary (SWM_decal later), kit item gets size/normal/orm/emission, load-time pure MeshDecalBuilder (static receivers), modal stamp tool, v1=placement+maps+plane-normal; wetness v1.5; sockets/accumulator later; ADR 0029 drafted. Report: .agents/scratches/decal-architecture-dave.md |

## 🔍 Findings

| ID | Task | Severity | Location | Title & Description | Author |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `F1` | `T2` | `error` | — | **Offscreen targets (reflection probes, planar reflection) have no normal buffer and a different target format: decal pass must be skipped or format-keyed, otherwise GPUValidationError instead of graceful miss** | **Charly** |
| `F2` | `T2` | `warn` | — | **Opaque-depth capture is gated on transparents/HBAO only (MainRenderPass.ts:94-148, WebGLMainPass.ts:105-114); WebGL2 DecalMaterial must declare u_opaqueDepthMap in its layout or the capture is silently skipped** | **Charly** |
| `F3` | `T2` | `warn` | — | **Transparent sort (Scene.ts:295) is centre-distance only with no tie-break and is cached by camera pos/vp; decal priority must be primary key plus stable id, and priority changes need render-list invalidation** | **Charly** |
| `F4` | `T2` | `warn` | — | **Silhouette smear and resize stale texture views are the highest-probability visual/GPU bugs; need probe assertions (smear < 1% of side area, resize 256-512-256 with zero validation errors)** | **Charly** |
| `F5` | `T3` | `warn` | — | **Maker has no level.json writer: ADR 0020 'Maker exports .level.json' is aspirational; ADR 0010 mandates glTF+SWM_*. Stamp tool persistence needs a decision (level.json decals[] merge-writer vs SWM_decal)** | **Dave** |
| `F6` | `T3` | `info` | — | **Key conflict: Maker binds R=scale gizmo, E=rotate, X=snap, Z=zone tool (MakerApp.ts:1480-1535); plain D is free. Stamp-mode R=rotate only OK as modal override** | **Dave** |
| `F7` | `T3` | `warn` | — | **loadLevel never instantiates environment.surfaces (type only, KitTypes.ts:225): same silent-gap risk for decals. level.schema root and kit.schema decal use additionalProperties:false, must change in lockstep with KitManifestValidator.ts:197-221,316-326** | **Dave** |
| `F8` | `T3` | `warn` | — | **Mesh-decal baker on skinned meshes needs weight transfer per emitted vertex: defer; v1 = static receivers, load-time pure CPU function, in-memory cache on KitRegistry instance** | **Dave** |
| `F9` | `T3` | `info` | — | **Prologue migration: 6 planes; drop flipX hack (prologue.ts:785), bake _morgueGroup parent transform into kaeltekammer.level.json (offset UNVERIFIED), keep planes behind flag until projector passes on WebGL2** | **Dave** |
| `F10` | `T1` | `error` | — | **Decal must not be isCollidable (physics collider + raycast hit) but then bounds=undefined and it is never frustum-culled: needs computeBounds() override forcing an OBB (Object3D.ts:246, FrustumCuller.ts:73, PhysicsSystem.ts:137)** | **Bob** |
| `F11` | `T1` | `warn` | — | **WebGL2 blend state is shared across draw buffers; GL normal wrapper writes vec2 o_normal so SRC_ALPHA reads undefined alpha on the normal target. Fix: vec4 o_normal with a=1, and decal shader writes the already-blended normal (replace semantics). UNVERIFIED on GPU** | **Bob** |
| `F12` | `T1` | `warn` | — | **Shared PBR lighting chunk uses implicit-derivative textureSample; an early discard for out-of-box pixels is a WGSL uniformity error. Use late discard (cost) or @diagnostic attr (lint-wgsl/wgsl_reflect support UNVERIFIED)** | **Bob** |
| `F13` | `T1` | `info` | — | **Normal buffer can't be sampled while attached: need per-frame normal copy (WebGPU copyTextureToTexture, COPY_SRC exists; WebGL2 blit from COLOR_ATTACHMENT1). Decals get own list+sub-pass before transparents; sort = priority, volume desc, id (no distance)** | **Bob** |

## ⚖️ Proposals & Consensus

### Proposal `P1`: Adopt consolidated decal plan v2 (.agents/scratches/decal-plan-v2.md)
- **Proposed by:** **Alice** at 2026-10-12T12:06:50Z
- **Status:** `open`
- **Votes:**
  - **Alice**: `AGREE` (*Proposer*)
  - **Dave**: `AGREE` (*Respects level.json primary, SWM_decal for Maker, strict schemas. Wetness re-scope and lit default plus unlit opt-in fine. Decal/DecalMaterial/isDecal fit, no singletons. Phase 3 before 4 sensible. Keep phase 0 as hard gate; no level.json writer in Maker.*)
  - **Bob**: `AGREE` (*v2 matches my T1 design; separate list with static sort, vec4 o_normal alpha 1, no early discard, wetness re-scope and phase 0 gate are sound. Notes: make Phase 0 a hard gate; require WebGL2 MRT blend check there; forbid negative scale in Decal.computeBounds.*)
  - **Charly**: `AGREE` (*Risks 1-3 closed (guard, gating, static sort). Amend: GL o_normal alpha must equal decal alpha, not 1 (else transparent texels wipe normals); add tests for offscreen guard and normal-copy on runtime quality toggle; spike needs numeric go/no-go thresholds.*)

---

## 🏁 Final Resolution

- **Outcome:** `CONSENSUS`
- **Resolved At:** 2026-10-12T12:07:25Z
- **Summary:**

P1 accepted 3/3 AGREE: consolidated decal plan v2 (.agents/scratches/decal-plan-v2.md) with vote amendments. Open for the moderator: Maker persistence, Maker keys, phase-0 gate.

