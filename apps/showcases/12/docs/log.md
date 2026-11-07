# Showcase 12 — Underwater Hideout · Dev Log

Living log (see `docs/guides/app-docs-convention.md`). Started 2026-11-02; earlier history lives in the
git commits of `apps/showcases/12/`.

## 2026-11-02 — Lab glassware after the engine glass fixes

- **Context (engine, no showcase code change):** GlassMaterial now replaces diffuse by transmission,
  projects the refraction exit point (world-space `thickness`) and reflects the IBL via Fresnel
  (`c3cd0fc4`). The 12 coloured vessels on the workbench (`glassColorPalette`, `CullMode.NONE`) turned
  into a uniform lavender sheet.
- **Cause + fix (engine, `d06f2f3d`):** double-sided glass back faces had `dot(N, V) < 0`, so Fresnel
  saturated to 1 and the whole far wall mirrored the environment. Glass/Frostglass now turn the shading
  normal toward the viewer (all tiers, contract test in `TransmissionEnergyContract.test.ts`). Vessels
  are clear and individually tinted again; verified on WebGPU + WebGL2 (temporary camera at the table,
  reverted), no console errors.
- **Open:** `thickness: 0.25` is larger than most vessels (radius 0.045–0.24), so small cylinders show a
  slightly lens-like refraction of the table grain. Lowering it also fades the tint (GlassMaterial tints
  only through absorption). Look decision deferred.
