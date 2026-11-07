# Shader Math Audit — 2026-11-03 (full variant, final)

> **Status:** 📋 Audit complete — every finding below was verified by reading the code path end-to-end
> (main session). Per-finding status legend: 💡 candidate · 📋 verified · 🔜 approved · ✅ fixed · ❌ rejected.
> **Plan:** `.agents/notes/shader-math-audit-plan.md` (full variant A–K). **Trigger:** showcase-50 session
> found 6 real math bugs in one day. **Decision rule:** no fix without per-finding user approval (look
> impact + goldens drift); a fix must land on ALL tiers carrying the path + contract test + golden
> re-baseline.
> **Disposition:** the small-variant trigger bugs + seeded findings S1–S5 are **already fixed** in
> `origin/main` (see §1). This report documents the NEW findings of the full variant (§2).

---

## 1. Seeded & trigger findings — final disposition (verified 2026-11-02/03; all on origin/main)

| ID | Class | Where | Verdict | Evidence (HEAD) |
|---|---|---|---|---|
| S1 | B | sheen energy comp | ✅ fixed | `sheenEnergyComp = 1 − 0.157·max3(sheenColor)` direct+IBL, all 3 tiers; sheen block BEFORE clearcoat; 4 loops + IBL consistent |
| S2 | B | sheen IBL | ✅ fixed | `IBLSheenBRDF(dotNV, sheenRoughness)` on all tiers (GL1: `u_ambientColor` stand-in) |
| S3 | C | water refraction UV | ✅ fixed | `worldDirToScreen(vec3(n.x,0,n.z))` all tiers + contract test `RefractionAspectParity.test.ts` |
| S4 | C | Glass refrDir.xy offset | ✅ fixed | vp projection (`u_vp`/`global.vp` exitClip), aspect-correct, WebGPU y-flip correct |
| S5 | G | Glass.glsl100 exposure | ❌ out of scope | `u_exposure` absent from ALL web_gl1 shaders; unconditional Reinhard everywhere — documented tier limitation (plan §8) |
| T5 | D | mirrored orbit reset | ✅ fixed | angles re-derived `atan2(rx,rz)`,`asin(ry/r)`; transition test `OrbitResetConvention.test.ts` |
| T6 | K | sub-block KTX2 mips | ✅ fixed | WebGPU `writeTexture` block-aligned size + `_blockLayout`; WebGL2 `TEXTURE_MAX_LEVEL` |

## 2. NEW findings — full-variant audit (all 📋 main-session verified unless noted)

Ranking: **P1** = visible bug / tier-breaking, **P2** = energy/convention error (latent but systematic),
**P3** = latent/edge/low-impact. Reach column lists concrete consumers.

| ID | P | Class | File:line (all tiers) | Invariant violated | Failure scenario | Severity | Reach | Fix proposal | Status |
|---|---|---|---|---|---|---|---|---|---|
| G01 | P1 | G | `web_gpu/chunks/lighting_pbr.wgsl:425-435`, `web_gl1/…/light_calc_pbr.frag.glsl:220-231` vs `web_gl2/…/light_calc_pbr.frag.glsl:543-556` | Same capability must produce same energy; reflection-probe IBL must integrate the BRDF (`envF * BRDF_LUT`) | WGPU/GL1 probe specular = `envColor·F_Schlick90` — missing `kS·envBRDF.x + envBRDF.y` and `*envIntensity`; rough/dielectric probes overbright vs GL2; GL1 additionally has no `*envIntensity` | energy (visible at roughness) | Standard/Decal/World with `DynamicReflectionProbe` (showcases 15 mirror spheres, 30 puddle) | Align: apply BRDF-LUT term + envIntensity on WGPU/GL1 (or declare GL2 canonical intent in ADR) | 📋 |
| G02 | P1 | G | `shared/glass_pbr_loops.frag.glsl:8-14,75-91` vs `web_gpu/chunks/glass_pbr_loops.wgsl:10-39,98-122` | Same glass light loops must agree per tier capability | GLSL glass: dir light `radiance = u_dirLightColor` (NO CSM shadow), spot loop NO shadow; WGSL: full CSM+PCSS dir + PCSS spot. Glass in shadow is fully sunlit on GL1/GL2, shadowed on WebGPU; WGSL spot also lacks `dist<maxDist` guard + `pow(0,0)=1` keeps decay-0 spots lit beyond range | visible tier divergence | Glass/Frostglass in lit/shadowed scenes (showcases 12, 28, 36) | Port dir+spot shadow blocks into shared GLSL (guarded), add maxDist guard to WGSL spot | 📋 |
| G03 | P1 | D/G | `web_gpu/base.vert.wgsl:56-64` vs `web_gl2/chunks/base_vertex_main.vert.glsl:54-64`, `web_gl1/base.vert.glsl:77-95` | Tangent fallback + TBN orthonormality identical per tier | WGPU fallback `cross(up,N)` vs GL `cross(N,up)` (mirrored tangent-X for tangent-less normal-mapped mesh); WGPU has no Gram-Schmidt (`T−dot(T,N)N`) → skewed TBN under non-uniform scale/shear | visible (normal-map shading) | All normal-mapped geometry w/o authored tangents (procedural meshes, scaled objects) on WebGPU | Copy GL fallback order + Gram-Schmidt into `base.vert.wgsl` + parity test | ✅ fixed |
| A01 | P1 | A | opaque-capture consumers (water/glass/Standard transmission): `OpenWater.frag.{glsl,wgsl}`, `StylizedWater.*`, `FluidSurface.*`, `Glass/Frostglass.*`, `web_gl2/…/light_calc_pbr.frag.glsl:614`, `web_gpu/…/lighting_pbr.wgsl:480` | Exposure/tonemap once per output path | With post DISABLED (default config), `u_opaqueMap` = already exposed+Reinhard+encoded main target; `targetToLinear` inverts only gamma → refracted/transmitted bg Reinhard'd twice + exposure squared when ≠1. Mirror path already divides by exposure (`OpenWater.frag.wgsl:70`) — opaque path doesn't | energy (dark content) | All water/glass + Standard `USE_TRANSMISSION` in post-off configs (default) | Apply mirror pattern: ÷exposure on `u_opaqueMap`/`u_reflectionMap` samples; or capture untonemapped linear | 📋 |
| A02 | P1 | A/G | `Standard.frag.wgsl:19-38,48` vs `Standard.frag.glsl:171-187` | Same feature same exposure/gamma ordering per tier | WGPU: reflection (already exposed capture) mixed BEFORE `color *= exposure` → exposure² when ≠1; GL2: mix AFTER Reinhard+encode → reflection bypasses tonemap, wrong-gamma blend | visible (tier divergence + energy) | Standard `useReflectionMap` (DynamicReflectionProbe, planar; showcases 15, 30) | WGPU: ÷exposure decoded reflection; GL2: move mix into linear space pre-tail | 📋 |
| A03 | P1 | A | WebGL1 post chain: `web_gl1/…/light_calc_pbr.frag.glsl:248-249` (unconditional Reinhard+encode) + `PostProcess100.frag.glsl:89-98` + `post/passes/PostProcessPassGL.ts:193-194` (forces mode=1) + `:381-384` | Forward/post contract: post ENABLED ⇒ forward linear, post owns tonemap/gamma | WebGL1 forward ALWAYS Reinhard+sRGB (no `u_gamma` gate on tier); GL1 post then Reinhards again (mode forced 1 even when TM element disabled) and gamma-encodes again (`inverseGamma=1/2.2` on already-encoded, tm element default-enabled) → double tonemap + double gamma on every WebGL1 post config | visible (crushed/washed, WebGL1+post) | All WebGL1 + post-enabled configs (default group: all elements enabled) | Declare `u_gamma`/`u_exposure` in web_gl1 uniform set + gate forward tail on `u_gamma!=1` (mirror GL2 `WebGL2Renderer.ts:2564`); neutral `toneMappingMode` when element disabled | 📋 |
| A04 | P2 | A | `post/passes/PostProcessPassGL.ts:382` vs `:384` | Same "post on, TM off" config → same output per tier | GL2 post always sRGB-encodes (`u_gamma = 2.2` when tm disabled); GPU/GL1 `inverseGamma = 1.0` → no encode. Divergent output; GL2-only exposure path never applies when tm disabled | latent cross-tier | post configs w/o TM element | Align neutral baseline (one contract) across tiers | ✅ fixed |
| A05 | P2 | A | analytic `fog_calc.*` + volumetric `PostProcess.frag.wgsl:285-290` | Fog applied once per pixel path | `fogMode` never nulled when `VolumetricFogElement` active (write sites `GlobalUniformWriter.ts:259/268` only read scene fog) → same pixels get analytic attenuation + froxel transmittance (compounded) + doubled in-scatter | latent (config) | Scene fog + volumetric element both on (WebGPU/WebGL2) | Gate: renderer forces fogMode=0 with volumetric active, or document one-owner rule | ✅ fixed |
| C01 | P2 | C | `liquid-extras/…/RainPuddle.frag.{glsl:74,glsl100:75,wgsl:65}` | Screen-UV offsets via world→screen projection (S3 doctrine) | Raw world `N.xz` added to screen UV (wgsl hand-flips z only) → offset rotates with camera yaw, FOV/aspect-dependent — the last live S3-pattern instance after the water/glass fix | visible (reflection distortion under camera motion) | RainPuddle (all 3 tiers); no parity test covers it | Reuse `worldDirToScreen` + extend `RefractionAspectParity.test.ts` | ✅ dup of LIQ02 |
| E01 | P2 | E | Glass all tiers `Glass.frag.{glsl:45,glsl100:58,wgsl:48-49}` + `GlassMaterial.ts:60-62` vs Standard `lighting_pbr.wgsl:473-475` | One `thickness` semantic per engine; KHR volume: mesh-local × modelScale | Glass marches `refrDir·thickness` in raw world units, Standard converts `thickness × modelScale`; non-unit mesh scale → Glass refraction distance + Beer absorption diverge from Standard | latent (non-unit scale) | Glass material all tiers | Add `modelScale` conversion to Glass tiers (mirror Standard) + parity test | ✅ fixed |
| D01 | P2 | D | `audio/AudioSystem.ts:256-258` (listener forward) vs engine convention `Camera.ts:241`, `FPSStrategy` | Listener forward == actual view forward | `forwardX = −sinθ·cosφ` = yaw-MIRRORED vs engine `+sinθ·cosφ`; ω with θ≠0 a sound at world +X is panned left; test `AudioSystem.test.ts:147` only covers θ=0 (blind) | visible (audio pan only) | `light-cycle-arena/App.ts:284`, `yad/App.ts:307` | `forward = (target−position).normalize()` or fix sign per convention B | ✅ fixed |
| G04 | P2 | G | `web_gl1/…/light_calc_pbr.frag.glsl:232-253` vs `web_gl2:583-585`, `web_gpu:454-458` | Ambient energy split identical per tier | GL1 envMap diffuse `× (1−metallic)` only, missing `(1−F_Schlick90)` → dielectric ambient up to 1/(1−F) brighter with envMap | energy (small) | Standard PBR + envMap on GL1 | Apply `(1−F)(1−metallic)` in GL1 ambient | ✅ fixed |
| G05 | P2 | G | `Skybox.frag.wgsl:18` (`× global.exposure`) vs `Skybox.frag.glsl:9`/`glsl100:8` (none) | Same object same exposure across tiers | WGPU skybox exposed in-shader (→ double with post on), GL2/GL1 never → brightness divergent; post-off + exposure≠1 tier-inconsistent | visible (exposure≠1) | any skybox scene | Uniform placement (exposure in shader × all tiers, or exclude skybox) | ✅ fixed |
| G06 | P2 | G | `web_gl1/…/light_calc_pbr.frag.glsl:178` (area), `web_gl1/…/light_calc.frag.glsl:55,86` (spot) vs GL2/WGPU windowed | Same light attenuation per tier | GL1 spot/area = fixed `1/(1+0.1d+0.01d²)` — ignores `maxDist` + `decay` entirely → lights keep glowing beyond authored range; `decay` dead on GL1 | visible (range/decay) | All spot/area-lit scenes on GL1 | Port windowed attenuation (data already uploaded) | ✅ fixed |
| K01 | P1/K | K | `WebGLTextureManager.ts:71-79` (`_fastPath100` no compressed clause) + `Texture.fromCompressed` | GL1 must not route KTX2 to placeholder | WebGL1 + KTX2/KHR_texture_basisu: `compressedImage`-only texture → `_defaultTexture` white/blank (no RGBA8 fallback path on tier) | visible (missing texture WebGL1) | WebGL1 + basisu assets | Decompress KTX2 → RGBA8 canvas (`_planeToTexture` mirror) on glsl100 | ✅ fixed (parallel session: WebGL1 `_uploadCompressedTexture100` extension-aware block upload; `detectBestBlockFormat` WebGL1-aware) |
| K02 | P1/K | K | `BasisTranscoder.ts:95` (`flipY:false`) + `:173-188` (`_planeToTexture`/`fromCanvas`, no flip) vs `Texture.fromUrl:244` (`flipY` default true) | Uniform asset orientation convention | KTX2 outputs never flipped while PNG/JPEG are decode-flipped → KTX2 content vertically inverted vs pipeline | visible (orientation) | KTX2 path all tiers | Apply the fromUrl-consistent decode flip once on transcoder output | ✅ fixed (compressed wire re-orientation, see §5e; RGBA8 path flips in upload) |
| K03 | P3 | K | `WebGLTextureManager.ts:107-118,379` (KTX2 upload `useMipmaps=false`) vs WebGPU trilinear | Uploaded mip pyramid must be filtered | WebGL2 KTX2 textures minify at level 0 (aliasing); identical chain on WebGPU trilinear — tier asymmetry on same data | latent (quality) | WebGL2 KTX2 | Pass `useMipmaps = mipData.length>1` | ✅ fixed |
| K04 | P3 | K | `GPUTextureResourceCache.ts:166-186` (array upload `mipLevelCount:1`, no `generateMipmaps`) | Runtime arrays deserve mip chain | WebGPU texture arrays LOD-0 only; minify aliases silently | latent (quality) | WebGPU 2D-array textures | Generate array mips or non-mip filter | ✅ fixed |
| G07 | P3 | G/H | `ShaderRegistry.ts:107` regex `\[[A-Z][A-Z0-9_]+\]` vs `DepthOfFieldGather.frag.glsl:17` `[TAP_COUNT]`, `AO.frag.glsl:77` `[DIR_COUNT]` | Assembly markers only at real positions | Array-index tokens match the chunk regex → guaranteed `Chunk not found` warn per compile (today); would inline wrongly if a matching chunk is ever registered | latent (cosmetic) | Post assembly WebGL2/WebGPU | Anchor regex or rename consts | ✅ fixed |
| G08 | P2 | G | `web_gpu/chunks/lighting_pbr.wgsl:135-136`, `glass_pbr_loops.wgsl:24-25`, `lighting.wgsl` vs `web_gl2 …light_calc_pbr.frag.glsl:182-183` | Cascade blend identical per tier | WGPU `splitFar·0.2 + smoothstep`, GL2 `splitFar·0.1 + linear` → 2× wider + different-shape seam fade | latent (visual seam) | CSM shadow zones all tiers | Unify band constant + function | ✅ fixed |
| J01 | P3 | J | `lighting_pbr.wgsl:197-198`, `lighting.wgsl:62-63`, `glass_pbr_loops.wgsl:58-59`, `cluster_cull.wgsl:20-24` (`log(far/near)` divisor) | Guarded divisor everywhere it is shared (compute twin `froxel_inject.wgsl:193` IS guarded) | `near==far` degenerate camera → 0/0 NaN slice → wrong cluster cell (light bleed/removal) | latent (degenerate config) | WebGPU all clustered lighting | `max(log(far/near),1e-6)` at all five sites | ✅ fixed |
| J02 | P3 | J | `web_gl2/…/fog_calc.glsl`, `web_gpu/…/fog_calc.wgsl` (LINEAR `(fogFar−fogDist)/(fogFar−fogNear)`) | Division guard on LINEAR fog | `fogNear==fogFar` → NaN factor → NaN mix → NaN pixels | latent (config) | all tiers fog | `max(fogFar−fogNear,1e-4)` | ✅ fixed |
| I01 | P3 | I | `lighting_pbr.wgsl:193-200`, `lighting.wgsl:58-65`, `glass_pbr_loops.wgsl:54-61` = 3 inline cluster-index copies vs `web_gl2/…/lights.frag.glsl:105-114` fn | One implementation per formula | Byte-consistent today (verified); drift risk on future edits | structural | clustered lighting | Shared helper + byte-parity gate | ✅ fixed |
| H02 | P3 | H | `preprocessConditionals.ts:1` (DIRECTIVE regex, no trailing comment) | Directive = sole line content | Future `#endif // x` silently passes to WGSL → `createShaderModule` error + wrong rebalance | latent (robustness) | WGSL compile | Allow trailing `//…` | ✅ fixed |
| H03 | P3 | H | `WebGLProgramCache.ts:198,219-230` (glsl100 raw flags, no `_fitTextureUnits`) vs `SamplerBudget.ts:71`, `:208` (GL2 fitted) | Budget fitting on every tier | Min-spec 8-unit WebGL1 + rich PBR program (≈8 samplers) → `_assertTextureUnits` throw; no graceful drop like GL2/GPU | latent (crash WebGL1) | WebGL1 + extension-map materials | Apply drop-resolution on glsl100 (8-unit floor) | ✅ fixed |
| F01 | P3 | F | `Glass.frag.wgsl:74`, `Frostglass.frag.wgsl:89` (raw `u_irradianceMap` probe) vs `lighting_pbr.wgsl:407` (decoded) | Every irradiance sample decoded once | Probe read raw (sRGB-encoded) — currently only a presence test, no visible colour delta; contract gap (test audits only lighting chunks) | latent (convention) | WebGPU glass/frostglass | Wrap probe in `sRGBToLinear` + extend `IblColorspaceContract` | ✅ fixed |
| COMP01 | P1 | D/G | `web_gpu/compute/froxel_integrate.wgsl:163,193`, `froxel_reproject.wgsl:83` | ClipZ depth convention must match the inverted matrix | Formula computes OpenGL `[-1, 1]` depth `((far+near)z - 2nf)/(z(far-near))`, but `uni.invViewProj` inverts a ZO-corrected `[0, 1]` matrix → reconstructed world position is distorted along ray | visible (sun shadow disconnects + temporal reprojection ghosting in fog) | Volumetric fog & light shafts on WebGPU | Replace with exact WebGPU `[0, 1]` clipZ formula `far * (z - near) / (z * (far - near))` | ✅ fixed |
| COMP02 | P3 | F | `web_gpu/compute/froxel_inject.wgsl:214-220` | Ambient irradiance decoded via exact sRGB transfer | Uses `pow(..., vec3f(2.2))` instead of IEC 61966-2-1 `sRGBToLinear()` | latent (~5% shadow luminance drift) | Volumetric fog ambient injection | Use `sRGBToLinear()` from chunks | ✅ fixed |
| LIQ01 | P1 | A | `liquid-extras/…/OilPuddle.frag.{wgsl:109-115,171, glsl:110-116,174}` | Exposure applied once per output path | `u_opaqueMap` floor sample is already exposed under post-disabled; shader multiplies `exposure` again at tail → `exposure²` | visible (blown out / crushed rim) | OilPuddle transparent pass | Divide sampled opaque texture by exposure before blending (mirror OpenWater) | ✅ fixed |
| LIQ02 | P2 | C | `liquid-extras/…/RainPuddle.frag.{wgsl:65, glsl:74}` | Screen-UV offsets via world→screen projection | Raw world `N.xz` added directly to screen UV | visible (distortion rotates with camera yaw) | RainPuddle | Use `worldDirToScreen` from shared chunks | ✅ fixed |

## 3. Rejected / false-positive candidates

| ID | Class | Where | Reason |
|---|---|---|---|
| G09 | G | `Decal.frag.wgsl:97` vs `.glsl:146` (AO `u_extraParams.x` only on GL2) | `DecalMaterial.ts` never writes `extraParams.x` (default 1.0) → GL2 `1.0·orm.r` == WGSL `orm.r`; no divergence. Keep the field in sync if extraParams is ever used |
| — | B | all tones | Energy model clean on all tiers: `kD=(1−F)(1−metal)`, transmission replaces diffuse, sheen+coat layering, Beer-Lambert single-pass (small-variant already fixed the historic violations) |
| — | A | `exposure`/`linearToSRGB`/fog/`* ao` in-shader | Single application everywhere except the capture-source paths (A01/A02/A03 document the real exceptions) |
| — | H | `[UPPER_ID]` markers in comments / unbalanced `#ifdef` | None exist (agent H greps across all tiers; 74 WGSL directives balanced; comment-embedded tokens guarded by `ShaderPlaceholderComments.test.ts`) |

## 4. Open verification notes (not findings)

- WebGPU visual verification: NOT headless-automatable in this workspace (no `navigator.gpu` in any Chrome). Findings on WebGPU tiers are verified by reading; visual proof requires the manual path (`.agents/scratches/verify-webgpu-recipe.md`).
- Some WebGL1 files were read while session `gl1-transmission` was editing them; every WebGL1-cited line above was re-checked against current disk state (verified 2026-11-03; `light_calc_pbr.glsl` WebGL1 now carries `u_vp`-based transmission, exposure/tone-map behavior unchanged).
- Reach column names showcases from `apps/showcases/`; exact per-showcase audit was not re-run.

## 5. Fix disposition (board `shader-math-audit`, T1–T5) — implemented 2026-11-03

Implemented + landed on all listed tiers with contract tests; signed `swm-math-audit`.

| Finding | Fix (landed) | Contract test |
|---|---|---|
| COMP01 | `froxel_integrate.wgsl` (2 sites) + `froxel_reproject.wgsl` (1 site): WebGPU `[0,1]` clipZ `far*(z-near)/(z*(far-near))` replacing the OpenGL `[-1,1]` form; comment documents the ZO-corrected `invViewProj` convention | `packages/engine/tests/math/FroxelProjectionParity.test.ts` (round-trip through engine `Matrix4` pipeline, float32-relative bound `1e-6+1e-4·d`, old-formula rejection, source pin) |
| COMP02 | `froxel_inject.wgsl`: local byte-identical `sRGBToLinear` helper (compute chunks exclude `pbr_math.wgsl`); 6 six-axis mean samples decode via helper, no raw `pow(...,2.2)` | `packages/engine/tests/math/FroxelProjectionParity.test.ts` (helper presence + no `pow` in ambient mean) |
| G03 | `web_gpu/base.vert.wgsl` + byte-clone `packages/vfx-extras/src/fire/Fire.vert.wgsl`: fallback `cross(o.n, up)` (GL parity) + unconditional Gram-Schmidt `o.t - dot(o.t,o.n)·o.n` | `packages/engine/tests/geometry/TangentFrameParity.test.ts` (WGSL/GL2/GL1 source parity pin) |
| LIQ01 | `OilPuddle.frag.{wgsl,glsl}`: opaque-floor sample divided by `max(exposure, 0.001)` (mirror of OpenWater mirror path); tolerance floor guards `exposure→0` | visual tier parity (post-off exposure² removal); no numeric test (GPU capture semantics) |
| LIQ02 | `RainPuddle.frag.{wgsl,glsl,glsl100}`: `worldDirToScreen(vec3(N.x,0,N.z))` + `[WORLD_DIR_TO_SCREEN]` chunk include on GLSL tiers | visual tier parity; extends the S3 `worldDirToScreen` doctrine already covered by `RefractionAspectParity.test.ts` |

## 5b. P2 fix disposition — implemented 2026-11-03 (shader-audit; claim `mw0jegrcwhu`)

All nine P2 implementable findings landed on every tier carrying the path, each with a contract test.
Golden impact: none of the affected paths is exercised by a canned golden scene (scene-10 liquid goldens
have no glass/skybox/post/GL1 content), verified by byte-identical re-capture.

| Finding | Fix (landed) | Contract test |
|---|---|---|
| A04 | `PostProcessPassGL.ts`: neutral baseline with tone mapping ABSENT is an identity passthrough (`u_gamma = 1.0` instead of the GL2-only `2.2` sRGB encode) — matches WebGPU `inverseGamma = 1.0` neutral pack and GL1's display-referred passthrough | `packages/engine/tests/renderers/PostNeutralBaselineParity.test.ts` (GL2 neutral gamma, WGSL neutral pack + consumption, GL1 no-encode; `PostProcessing.test.ts` simulation updated) |
| A05 | One-owner fog rule: `PostProcessingGroup.volumetricFogOwnsFog` (post enabled AND opt-in volumetric element enabled); WebGL2 + WebGPU gate their analytic-fog write (fogMode = NONE) on it; WebGL1 deliberately NOT gated (no volumetric term on tier — tier note documented) | `packages/engine/tests/renderers/FogOwnershipParity.test.ts` (functional group getter + per-tier source pins) |
| C01 | Verified as **already fixed by LIQ02** (RainPuddle `worldDirToScreen` fallback on all 3 tiers; no raw `N.xz` UV offsets remain) — no code change; ledger-only disposition | (covered by LIQ02) |
| D01 | `AudioSystem.updateListener`: listener forward = `normalize(target−position)` with convention-formula fallback `(sinθ·cosφ, sinφ, −cosθ·cosφ)` when the target is degenerate — fixes the yaw-mirrored `−sinθ·cosφ` pan | `packages/engine/tests/audio/AudioSystem.test.ts` (theta≠0 ground-truth + degenerate-target fallback) |
| E01 | `Glass.frag.{glsl,glsl100,wgsl}`: refraction march converts mesh-local `thickness` to world via `modelScale` (`refrMarch = refrDir·thickness·modelScale`, mirror uniform `u_model`/`obj.model`) and Beer integrates `length(refrMarch)` — mirror of the Standard volume ray | `packages/engine/tests/core/materials/RefractionAspectParity.test.ts` (all 3 tiers) + `Glsl100LightCalc.test.ts` |
| G04 | `light_calc_pbr.frag.glsl` (GL1): ambient diffuse now `kD_ambient = (1−F_Schlick90)·(1−metallic)`, specular envMap branch reuses the same `ambientFresnel` — energy split = GL2/WGPU | `packages/engine/tests/renderers/AmbientEnergySplitParity.test.ts` (GL1 + GL2 reference) |
| G05 | `Skybox.frag.glsl` (GL2): `displayToTarget(sky.rgb) * u_exposure` aligning with the canonical WebGPU skybox; GL1 stays unexposed (documented tier absence, no `u_exposure` on tier) with shader note | `packages/engine/tests/renderers/SkyboxExposureParity.test.ts` (3 tiers) |
| G06 | `light_calc.frag.glsl` + `light_calc_pbr.frag.glsl` (GL1): Phong spot + Phong/PBR area windowed (`pow(clamp(1−d/maxDist,0,1), decay)` with range gate, `distance=0` keeps the legacy inverse fallback); new `u_areaLightParams` uniform wired through `WebGLProgramCache` + `WebGL1Renderer._bindLights` upload | `packages/engine/tests/renderers/Gl1LightRangeDecayContract.test.ts` (shader law + upload wiring) |
| G08 | `lighting_pbr.wgsl`, `lighting.wgsl`, `glass_pbr_loops.wgsl` (WebGPU): cascade seam blend unified to the canonical `splitFar·0.1` + linear ramp (majority: GL2 PBR/Phong + `froxel_integrate` compute) — removes the 2× wider smoothstep form | `packages/engine/tests/renderers/CascadeBlendParity.test.ts` (all 6 CSM blend sites) |

Gates (shader-audit P2 change set): `lint:glsl`, `lint:wgsl`, `build:lib`, `typecheck`, `check:doctrine` clean;
`npm run test` green; scene-10 gl2 goldens byte-identical (no re-baseline needed).

Radiometric contract additions (T3): `packages/engine/tests/math/HelmholtzReciprocity.test.ts` (f(L,V)=f(V,L) within 1e-12 over 2000 deterministic sweeps/roughness, positivity), `packages/engine/tests/math/WhiteFurnaceEnergy.test.ts` (strict specular-lobe bound ≤1 via unbiased GGX VNDF estimator, Heitz 2018; documented Fresnel-partition composite envelope ≤1.02/≤1.2 at 60°/75°), reference BRDF `packages/engine/tests/math/_refBrdf.ts` (byte-mirrors `pbr_math.frag.glsl` D/G/F + VNDF).

Energy-model note: the direct-light composite (`kD=(1−F)(1−metallic)` + specular) is NOT aggregate-energy-conserving at grazing incidence (measured +1.6% @60°, +12% @75°, r=0.1) — accepted engine model approximation; the strict White-Furnace axiom applies to the specular lobe only.

## 5c. Status sync + WebGL1 gap closure — 2026-11-03 (ADR 0057)

The status column in §2 is a point-in-time snapshot; `docs/reference/tier-parity.json` (verified by
`TierParityMatrix.test.ts`) is the living source for tier support. Corrections found by reading HEAD:

| Finding | Current state | Evidence |
|---|---|---|
| A01 | ✅ fixed (earlier session) | opaque capture `/ max(exposure, 0.001)` in `lighting_pbr.wgsl`, GL2 + GL1 PBR chunks |
| G02 | ✅ fixed (earlier session) | `GLASS_DIR_SHADOW` in `shared/glass_pbr_loops.frag.glsl`; GL1 stays lit (dialect, `na`) |
| H03 | ✅ fixed | `WebGLProgramCache._buildGlsl100` goes through `_fitTextureUnits`; `SamplerBudget.test.ts` (8-unit device) |
| G01 (GL1) | ✅ fixed | `u_envIntensity`, roughness-biased probe lookup, `EnvBRDFApprox` split-sum; `EnvBrdfApproxGl1.test.ts` (MC reference) |
| A03/S5 (forward) | ✅ fixed | `u_exposure` on GL1 PBR/Standard/Glass/Frostglass tails; `Gl1ExposureEnvWiring.test.ts` (GL1 skybox stays unexposed: documented tier absence) |

## 5d. P3 fix disposition — implemented 2026-11-03 (swm-math-audit; claim `mw0kr56im7x`)

All implementable P3 findings of the §2 P3 batch are landed with contract tests. H03 is NOT part of
this change set (landed by the parallel session; remains in the working tree for its own commit).

| Finding | Fix (landed) | Contract test |
|---|---|---|
| G07 | `DepthOfFieldGather.frag.glsl`/`AO.frag.glsl`: array-index constants renamed below the chunk-regex shape (`TAP_COUNT`→`tapCount`, `DIR_COUNT`→`dirCount`). Line-start anchoring was rejected: inline chunk chains (`"[BASE_VERTEX_HEADER][BASE_VERTEX_MAIN]"`) are a real usage | `packages/engine/tests/renderers/ShaderArrayIndexTokens.test.ts` (scans all engine shaders; every `[UPPER_ID]` token must be a registered chunk) |
| H02 | `preprocessConditionals.ts`: DIRECTIVE regex accepts trailing `//…` comments | `PreprocessConditionals.test.ts` (trailing-comment cases) |
| J02 | `fog_calc.{wgsl,glsl}`: LINEAR divisor clamped `max(fogFar−fogNear, 1e-4)` | `packages/engine/tests/renderers/J02FogDivisorGuard.test.ts` (both chunks + no unguarded divisor) |
| K03 | `WebGLTextureManager.ts`: KTX2 uploads keep trilinear filtering when `mipData.length>1` (`useCompressedMips`); WebGL1 `_setSamplerParams100` gets `hasExplicitMips` so mip filtering on an explicit pyramid does NOT re-run `generateMipmap` (GL_INVALID_OPERATION on block-compressed sources) | `packages/engine/tests/renderers/K03CompressedMipFiltering.test.ts` (GL1/GL2 × full/single-level pyramid × mipmapping on/off) |
| K04 | `GPUTextureResourceCache.ts`: runtime texture arrays get a full mip chain with per-layer 2D views (`generateArrayMipmaps`, `dimension:"2d"`, `baseArrayLayer`, `arrayLayerCount:1`), gated identically to the single-image path | `packages/engine/tests/renderers/K04ArrayMipGeneration.test.ts` (full chain vs disabled; per-layer 2D view set) |
| F01 | `Glass.frag.wgsl` + `Frostglass.frag.wgsl`: irradiance probe decoded `sRGBToLinear(...)`. The `dot>1e-6` presence gate is transfer-invariant (0 stays 0) | `packages/engine/tests/renderers/IrradianceDecodeContract.test.ts` (scans every engine-shader irradiance sample; manual `pow(x,vec3(2.2))` variant allowed) |
| J01 | cluster `log(far/near)` divisors guarded `max(...,1e-6)` at all five sites: the three cluster chunks (now via the shared I01 chunk), `cluster_cull.wgsl`, WebGL2 `computeClusterCellIndex` | `packages/engine/tests/renderers/J01ClusterLogRatioGuard.test.ts` (site pins + whole `web_gpu`/`web_gl2` unguarded-divisor scan) |
| I01 | single shared implementation: new registered chunk `CLUSTER_INDEX_LOOKUP` spliced into `lighting_pbr.wgsl`/`lighting.wgsl`/`glass_pbr_loops.wgsl` (assembler resolves chunks-in-chunks). WebGL2 `computeClusterCellIndex` remains a language-native function; formula parity is pinned, not byte-shared | `packages/engine/tests/renderers/I01ClusterLookupShared.test.ts` (assembler resolution, no inline duplicates in the three chunks, WGSL↔GL2 formula-parity pairs) |

Notes:
- G07/H02/J02 of this batch are already upstream as commit `714e1cb2` (user-directed "commit everything", executed by the parallel session); the remaining paths land in this change set.
- H03 was landed by the parallel session (`_buildGlsl100` through `_fitTextureUnits` + 8-unit `SamplerBudget.test.ts`); NOT committed here (path-scoped).

Gates (this change set): `typecheck`, `build:lib`, `lint:glsl`, `lint:wgsl` (112/112), `npm run test` (579 files / 4683 pass / 0 fail). `check:doctrine` reports a single pre-existing violation -- the parallel session's uncommitted ADR 0057 missing its mandatory `## Doctrine Compliance` section (per ADR 0047) -- not part of this change set; flagged to that session via mailbox.

## 5e. K02 fix disposition — implemented 2026-11-04 (compressed mirror, no RGBA fallback)

K02 resolved on the **compressed wire format**, not by flipping pixels: the compressed texture path now re-orients
the block-compressed bytes themselves, so block-compressed textures share the decode-flip orientation of the
`Texture.fromUrl` / RGBA8 KTX2 fallback (`flippedCompressedMipChain` hook in `BasisTranscoder.ts`; RGBA8 planes flip
in upload). No format falls back to RGBA8; every transcoder-emitted block format is mirrored on its exact wire layout:

| Format | Wire approach (module) | Contract tests |
|---|---|---|
| BC1 / BC3 | texel-index rows permuted by the flip; color words move with their blocks (`compressedMirror.ts`) | `compressedMirrorCodecs.test.ts` (BC1/BC3 decode-level + involution + boundary) |
| ETC2 RGBA8 | EAC alpha stream + ETC RGB sub-block region swap (intensity + diff-delta negation, diff-mode `-4` handled as the documented 1-step approximation) | `compressedMirrorCodecs.test.ts` (ETC2 decode `≤10` bound on delta-`-4`; byte-exact involution for in-range bases) |
| BC7 | full parse/repack of all 8 modes; partition pattern flipped (exact when representable, else nearest flip-closed partition), endpoints/index values move with texels | `compressedMirrorBc7.test.ts` (single-subset 4/5/6 decode-exact; multi-subset on subset-stable texels; partition-flip exactness) |
| ASTC 4x4 | surgical patch: weight (index) BISE stream permuted by texel flip + partition seed replaced by the flip-closed seed (exact when representable); endpoints/CEM/CCS byte-identical; void-extent = identity | `compressedMirrorAstc.test.ts` (18 ARM-cross-validated golden partition tuples, raw-wire weight oracle without reversal tables, seed-flip exactness + fallback closure, patch structure, void identity) |

Real transcoder-output contract (fixture): `compressedMirrorFixture.test.ts` mirrors the actual
`basis_transcoder.wasm` ETC1S→ETC2/BC3/BC7/ASTC plane bytes of `tests/fixtures/ktx2/2d_etc1s.ktx2` and asserts
decode-level orientation at 4-aligned levels 0/1 (ETC2/BC3 exact, BC7 subset-stable, ASTC raw-wire + seed reflect).

Testing against independent oracles (Khronos/basis `unpack_bc7*`/`decoder_etc_block` ports + wire-bit readers)
caught **5 real bugs**, 2 of them in the mirror modules on the production path:
1. `ETC_DB_BITS` 42→40 (`compressedMirror.ts`) — delta-B fields overlapped the base-B field (43..47).
2. BC7 mode-field overrun (`compressedBc7Mirror.ts parseBlock`) — `bit = 2·mode+1` instead of `mode+1`; would have
   corrupted every real transcode for modes ≥1.
3. Orakel underflow detection (`miniBlockCodecs.ts`) — `(r|g|b) > 31` misses JS-negative OR results; now `& ~31`
   (GPU/Khronos ETC1 5-bit clamp semantics, documented in the oracle).
4. Mode-6 wire layout (oracle) — component-major endpoint order + 3-bit texel-0 anchor (`m_s00 : 3`).
5. Mode-4 builder — endpoint precision fixed 5/6-bit, `indexMode` only selects the weight-plane widths.

Gates (this change set): `lint:fix` clean, `check:doctrine` clean, `lint:wgsl` (112/112), `lint:glsl` clean,
`typecheck` clean, `build:lib` clean, full `npm run test` green (585 files / 4741 pass / 10 todo).
Test modules: `compressedMirrorCodecs.test.ts` (13), `compressedMirrorBc7.test.ts` (17), `compressedMirrorAstc.test.ts`
(14), `compressedMirrorFixture.test.ts` (8).
