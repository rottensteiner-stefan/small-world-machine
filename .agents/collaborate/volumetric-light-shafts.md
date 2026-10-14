# Blackboard: volumetric-light-shafts

> **Mode:** `plan` | **Status:** `resolved` | **Coordinator:** **Alice** | **Events:** 21
> **Outcome:** `CONSENSUS` | **Resolved At:** 2026-10-14T09:32:06Z

## 👥 Roster

| Agent | Role | Stance | Joined |
| :--- | :--- | :--- | :--- |
| **Alice** | Lead Coordinator | — | 2026-10-14T07:29:57Z |
| **Bob** | Implementation & Core Dev | — | 2026-10-14T07:30:09Z |
| **Charlie** | QA, Testing & Boundary Verification | — | 2026-10-14T07:30:09Z |
| **Dave** | Architecture & Systems Review | — | 2026-10-14T07:30:09Z |

## 📋 Tasks

| ID | Title | Assigned To | Status | Result / Summary |
| :--- | :--- | :--- | :--- | :--- |
| `T1` | Shader & Render-Pass Pipeline Design: Radial Blur vs Half-Res Raymarch across WebGL1, WebGL2, WebGPU | **Bob** | ✅ completed | 2-Tier architecture designed: WebGL1 uses 32-tap radial pull-blur with camera-Z guard; WebGL2/WebGPU uses 16-step half-res raymarch against CSM cascades 0-1 with Schlick phase function, IGN jitter, and bilateral upsample. |
| `T2` | Verification, Performance Benchmarking & Artifact Defense Plan: Depth-aware Bilateral Upsample, Jitter, GPU Parity | **Charlie** | ✅ completed | Verification & benchmark plan set: edge-bleed silhouette probe, 180-degree sun-inversion check, GPU performance budget (<0.75ms desktop, <1.8ms mobile), WebGL1/2/WebGPU parity test. |
| `T3` | Engine Architecture & API Contract: PostProcessing integration, Cascaded Shadow Map coupling, Quality tiers, and ADR draft | **Dave** | ✅ completed | Engine architecture finalized: LightShaftsElement in PostProcessingGroup, PostProcessingEffectType.LIGHT_SHAFTS, reuses CSM unit 14 and u_opaqueDepthMap with zero extra shadow passes; ADR 0030 drafted. |

## 🔍 Findings

| ID | Task | Severity | Location | Title & Description | Author |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `F1` | — | `info` | — | **T1**<br>*WebGL1ShadowPass does not exist; WebGL1 tier must use depth/luminance radial blur to preserve backend parity without errors.* | **Bob** |
| `F2` | — | `info` | — | **T2**<br>*Direct upscale of half-res raymarch buffer leaks light into foreground characters. A depth-aware bilateral composite with nearest-depth fallback fixes edge bleeding.* | **Charlie** |
| `F3` | — | `info` | — | **T3**<br>*Clustered Forward+ already binds CascadedShadowPassGPU and WebGLShadowPass. The light shaft pass only consumes existing depth and shadow maps in half-res.* | **Dave** |
| `F4` | — | `info` | — | **T1**<br>*Projecting the sun coordinate when dot(sunDir, camForward) <= 0 mirrors shafts across screen center. Must clamp and fade out with camera-Z guard.* | **Bob** |

## ⚖️ Proposals & Consensus

### Proposal `P1`: Adopt Tiered Volumetric Light Shafts Design (Dossier .agents/collaborate/volumetric-light-shafts.dossier.md)
- **Proposed by:** **Alice** at 2026-10-14T09:32:02Z
- **Status:** `open`
- **Description:** Consensus plan: Tier 1 Screen-Space Radial Blur on WebGL1; Tier 2 Half-Res CSM Raymarch with Schlick Phase, IGN Jitter, and 2x2 Depth-Aware Bilateral Upsample on WebGL2/WebGPU.
- **Votes:**
  - **Alice**: `AGREE` (*Reconciles visual fidelity with strict 3-backend parity and zero extra shadow pass allocations.*)
  - **Bob**: `AGREE` (*Schlick phase function and IGN jitter eliminate ALU bottlenecks while delivering smooth volumetric shafts at 16 steps.*)
  - **Charlie**: `AGREE` (*Depth-aware bilateral filter with nearest-depth fallback definitively prevents silhouette haloing; test harness prepared.*)
  - **Dave**: `AGREE` (*Fits cleanly into PostProcessingGroup without leaking state; conforms to No Global Singletons and Fail Fast.*)

---

## 🏁 Final Resolution

- **Outcome:** `CONSENSUS`
- **Resolved At:** 2026-10-14T09:32:06Z
- **Summary:**

Unanimous consensus (4/4 AGREE) on Proposal P1: 2-Tier Volumetric Light Shafts Architecture as detailed in .agents/collaborate/volumetric-light-shafts.dossier.md

