# ADR 0057: Tier parity matrix — machine-verified source of truth for tier differences

- **Status:** Accepted (2026-11-03, moderator decision)
- **Related:** ADR 0044 (honest tests), ADR 0056 (WebGL2 sampler budget), `docs/research/shader-math-audit-2026-11.md`

## Context
- Every look-relevant convention exists 3–4× (GLSL300, GLSL100, WGSL, showcases). Tier differences were tracked in prose (audit report, shader comments) and went stale: A01/G02 were fixed in code while the report still listed them open.
- Tier absence is legitimate (Tiered Renderer Autonomy) but must be *classified*, otherwise gaps and design decisions are indistinguishable.

## Decision
- `docs/reference/tier-parity.json` is the single source of truth for per-feature tier support (`webgpu`/`webgl2`/`webgl1`).
- Cell states: `present` (regex MUST match in `file`), `absent` (regex MUST NOT match), `na` (reason required).
- Every `absent` cell carries a class:
  - `gap` — fix wanted, requires a finding id.
  - `deliberate` — tier absence by design, reason required (hardware/dialect limit).
  - `undecided` — owner decision pending.
- `packages/engine/tests/renderers/TierParityMatrix.test.ts` verifies every cell against the real sources. Implementing a gap or regressing a capability turns the test red until the matrix is updated, so the matrix cannot silently go stale.
- Math claims are *not* pinned as source text: scalar laws are executed from the shader source (`tests/math/_shaderScalar.ts`), vector/BRDF laws are checked against CPU references (`_refBrdf.ts`, `EnvBrdfApproxGl1.test.ts`). Text pins stay only for uniform wiring and tier-absence.

## Gaps closed with this ADR (WebGL1)
| Finding | Change |
|---|---|
| H03 | `glsl100` programs run through `_fitTextureUnits` (sequential units, no reserved block) — extends ADR 0056 |
| G01 | probe specular `* u_envIntensity`, roughness-biased cube lookup, split-sum via analytic `EnvBRDFApprox` (Karis/Lazarov fit, clamped ≥ 0) instead of the LUT sampler; documented fit envelope max 0.16 / mean 0.07 vs Monte-Carlo. Upgrade path: `scene.brdfLUT` + a probe (`u_envMap`) adds `USE_BRDF_LUT` (real LUT, GL2/WGPU-identical); it is the first group dropped by the sampler budget (silent, analytic fit takes over) — selection is by free texture units, not frame time |
| A03/S5 | `u_exposure` on the GL1 forward tails (PBR chunk, Standard, Glass, Frostglass): gain before Reinhard, `1.0` while post owns exposure, quality exposure otherwise; opaque-capture divides it out like GL2 |

## Remaining classified absences
- `ibl_irradiance_map`, `csm_dir_shadow` on WebGL1: `deliberate` (no IBL bake / shadow samplers in GLSL100).
- `glass_dir_shadow` on WebGL1: `na` (shared glass loops stay fully lit without shadow maps).
- WebGL1 skybox stays unexposed (documented tier absence, `SkyboxExposureParity.test.ts`).

## Consequences
- New tier-dependent features add a matrix row in the same change; a `gap` row without a finding id fails the test.
- Closing a gap = flip cell to `present` + add a behavior test.
- Rejected: prose-only matrix (stale within days), registry generated from shader comments (couples docs to comment style).

## Doctrine Compliance

- **New public hot-scope parameters (classification):** none. `tier-parity.json` is a build/test verification ledger; the internal GL1 uniform and flag additions (`u_exposure`, `u_envIntensity`, `USE_BRDF_LUT`) are internal shader conventions conforming to the existing WebGL2/WebGPU layouts.
- **Shared abstraction >= 3 consumers?** Yes; `docs/reference/tier-parity.json` serves all 3 renderer tiers (`webgpu`, `webgl2`, `webgl1`) as the unified parity contract verified by `TierParityMatrix.test.ts`.
- **Modeful object?** None; the parity ledger and validator are pure stateless data and test assertions.
- **Mathematical claims:** Split-sum approximations (`EnvBRDFApprox` Karis fit) and scalar evaluations reference `@invariant` formulas verified in `EnvBrdfApproxGl1.test.ts` against Monte-Carlo ground truth.
- **Fail-closed / honest fallback:** Honest fallback on WebGL1; missing shadow/IBL capabilities stay unpretended (`deliberate`), while BRDF LUT falls back gracefully to `EnvBRDFApprox` when texture budget is exhausted.
- **Exceptions:** none.

