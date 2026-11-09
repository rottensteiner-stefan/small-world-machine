---
status: proposed
---

# 0061: Auto exposure (eye adaptation) — GPU-metered, GPU-adapted, no readback

- **Status:** Accepted (2026-11-09, moderator; proposed 2026-11-08 on branch `veg-look`)
- **Date:** 2026-11-08
- **Trigger:** showcase 52 / ADR 0059 addendum: a fixed exposure cannot serve both a sunlit meadow and a forest interior; the reference demo walks between both.

## Decision

- **Element:** `AutoExposureElement` (`PostProcessingEffectType.AUTO_EXPOSURE`), registered in every group, **off by default** (existing scenes unchanged). Parameters: `minEv`, `maxEv`, `compensationEv`, `speedDark`, `speedBright`, `centerWeight`.
- **Metering (pass 1):** the final pre-uber HDR color (after TAA/trail/DoF) is reduced to a 16×16 grid; each texel averages 4×4 bilinear taps of `log2(Rec.709 luminance)` (NaN/Inf guarded), weighted by `mix(1, max(1 - 2|uv - 0.5|, 0.05), centerWeight)`.
- **Adaptation (pass 2, 1×1):** `target = clamp(log2(0.18) - avgLog + compensationEv, minEv, maxEv)`; `ev += (target - ev) * (1 - exp(-dt * rate))`, rate = `speedDark` when the exposure rises, `speedBright` when it falls (eyes adapt slower to the dark). Frame-rate independent; first frame and camera cuts (`resetHistory`) snap. Output `(2^ev, ev)`.
- **Application:** the uber shader multiplies the HDR radiance by the 1×1 texture before the tone curve; `ToneMappingElement.exposure` stays the artistic bias on top. While off, a white 1×1 stand-in is bound → bit-identical to before (×1.0).
- **No readback, no per-frame allocation:** WebGPU records both passes into the frame encoder and copies the result into a stable 1×1 texture (one uber bind group); WebGL2 ping-pongs two 1×1 targets.
- **Tiers (ADR 0057):** WebGPU present; WebGL2 present when float render targets exist (`EXT_color_buffer_float`, else the HDR input is clamped RGBA8 and the pass returns null → static exposure); WebGL1 deliberately absent (display-referred RGBA8 post input). Matrix row `auto_exposure`.

## Rejected

- **CPU readback of the average:** 1–3 frames latency plus a sync point; the GPU already holds the previous value.
- **Histogram with percentile clipping (compute):** WebGPU-only, more code; the log-average with center weight is enough for the target scenes. Revisit if bright skies or emissives skew the meter.
- **Mip-chain reduction of the full frame:** float `generateMipmap` paths differ per tier; the fixed 16×16 grid is identical on both tiers and costs 4 096 taps.
- **Adapting in linear exposure space:** asymmetric and frame-rate dependent; EV space with an exponential step is neither.

## Consequences

- Two tiny passes per frame (16×16 + 1×1) on WebGPU/WebGL2 while enabled; one extra texel fetch in the uber shader always.
- Dark-dominated scenes (foliage) are metered too bright by the 18 % assumption; apps set `compensationEv` (showcase 52: −1.2 EV, `maxEv` 2).
- Tests: `AutoExposure.test.ts` (CPU mirror `autoExposureStep`: key mapping, clamps, compensation, asymmetric rates, frame-rate independence; two-dialect shader parity; uber multiplication on both tiers, none on WebGL1). Visual: showcase 52 (`E`), meadow ↔ forest, WebGPU/WebGL2/WebGL1.

## Doctrine Compliance

- **New public hot-scope parameters (classification):** the six element fields are `@domain`; `AUTO_EXPOSURE_KEY` (0.18) and `AUTO_EXPOSURE_GRID` (16) are `@fixed`.
- **Shared abstraction >= 3 consumers?** No new abstraction; the passes follow the existing `PostEffectPass` / GL pass contracts.
- **Modeful object?** Single enable basis (`enabled`); disabling drops the view → white stand-in; re-enabling snaps on the first frame of a fresh pass (idle passes are destroyed after 300 frames).
- **Mathematical claims:** frame-rate independence and monotonic convergence of the EV step are checked numerically against the CPU mirror. No registry invariant claimed.
- **Fail-closed / honest fallback:** not render-critical; tiers without float targets keep the static exposure (documented, matrix row).
- **Exceptions:** none.
