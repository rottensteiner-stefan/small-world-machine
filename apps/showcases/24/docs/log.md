# Showcase 24 – The Shader Gallery – Dev Log

Living log. Newest entries at the bottom, nothing is deleted.

## Overview & Concept

**Showcase:** 24 (The Shader Gallery) — WebGL2 (GLSL) vs WebGPU (WGSL) Shader Gallery.

The core concept: the observer stands **inside a sphere** and looks at a number of shader
"monitors" that are **adapted to the inner surface of the sphere** — each monitor is physically
bent along the sphere's geometry, so the screens visibly follow the lines of the wireframe
reference sphere. It is a planetarium of live shaders (Shadertoy / GLSLSandbox on WebGL2,
ComputeToys-WGSL on WebGPU), mounted all around the inner wall.

Key elements:
- `GALLERY_RADIUS = 5.5` — the (deliberately small) gallery sphere. A smaller radius means each
  monitor spans a larger arc of the sphere, so the curvature becomes readable to the human eye.
- `ScreenCurvatureBehavior` — bends a screen's `Plane` geometry along the gallery sphere.
  At full curvature the vertices lie **exactly on** the sphere (the wireframe line); at zero it is
  a flat tangent plane. Click-to-focus flattens, zoom-out re-curves.
- Observer **not at the center**, but pressed with the back close to the inner wall (`OBSERVER_BASE`)
  — the "optical trick" that makes the surrounding curvature perceptible via strong perspective.
- Interaction: free 360° Mouselook (FPS, no movement), click a monitor = fly in + flatten to read
  the shader, click empty / `Esc` = fly back out + re-curve.

---

## 2026-10-18 — Rebuild against the original concept (observer inside the sphere)

The idea for the showcase was re-stated: the observer stands *inside* a sphere and watches
monitors hugging the inner surface, each displaying a different shader. Audit against that idea
found several problems, all fixed in this session:

- **Bobbing removed.** `BobbingBehavior` (screens gently floating up/down) contradicted the
  "mounted on the inner wall" concept and was deleted entirely.
- **Real orientation bug fixed (`_createScreen`).** The engine composes Euler as **YXZ**, so the old
  `rotation.set(pitch, -yaw, 0)` only faced the sphere's center approximately at yaw ≈ 0 and drifted
  off over yaw. With the old code the screens never faced the observer correctly *and* the curvature
  bent in the wrong direction — one likely reason the bend was never perceptible. Now each screen is
  oriented with `lookAt(center)` followed by a 180° roll so its front (+Z) points at the sphere's
  center for **any** (yaw, pitch) around the full 360°, and the curvature bends "hugging" the wall.
- **Sphere smaller.** Radius 10 → 5.5 (plus a hair outward for the wireframe reference to avoid
  z-fighting where screen edges coincide with wireframe lines).
- **Observer stance.** Camera moved from the center to `OBSERVER_BASE` — near the inner wall (+Z),
  slightly below the equator; Mouselook on, movement off. Zoom-out returns to this vantage.
- **Full-surround layout.** The 8-monitor frontal cluster was replaced by `_buildSurrounding()`
  (3 rings × 8 monitors, 45° apart, pitch +35°/0°/-35°), reusing the existing shader set per ring
  with a ring-offset so no neighbours repeat. This is what makes curvature visible from an
  off-center stance: monitors around the observer are heavily foreshortened.
- **Click reaction kept** (per request): click monitor → fly in + flatten (read mode); empty
  click / `Esc` → fly back + re-curve.
- **`docs/` added** (this log + `concept-dossier.html`) per the app-docs convention.

**Note on perceptibility (user hint):** part of the reason the curvature was "invisible" was simply
that it was too weak to see (sag ≈ 0.2 units on a screen seen from 10+ units away). The fix is
geometric, not purely visual: a *smaller* sphere + the observer *pressed against the inner wall*
make the bend unambiguous. Verification of the actual rendered look is the explicit next step
(`check-showcases 24` + screenshots).

---

## 2026-10-19 — True grid-aligned curvature (edges along longitudes & latitudes) + runtime-bend fix

**SUPERSEDES the curvature part of the 2026-10-18 entry** (which used a radial/polar bend mapping).

User spec, exactly: *"Linker und rechter Rand eines Screens läuft immer entlang eines Längengrades,
oberer und unterer Rand immer entlang eines Breitengrades … eine eigentliche Verkrümmung des Screens.
Nicht nur ein einfaches Verbiegen."* — a screen adapted to the sphere must be a real spherical patch
(Gaussian curvature ≠ 0), whose left/right edges lie on **meridians** and top/bottom edges on
**parallels** of the sphere grid. Implemented and **proven**:

- `ScreenCurvatureBehavior` now maps each flat-plane vertex to the exact sphere point at grid
  offsets `θ₀ + u/(R·cosφ₀)` (lateral, along the parallel) and `φ₀ + v/R` (vertical, along the
  meridian), projected into the container's local frame. At rest the screen lies exactly ON the
  sphere with edges aligned to the grid; on click it interpolates to the flat tangent plane.
- **Orientation via explicit basis** (Matrix4 → Quaternion): local +X = parallel tangent,
  +Y = meridian tangent, +Z = toward the sphere center. Empirically verified per mount that the
  engine reproduces this frame exactly (`.agents/scratches/orient-probe.ts`).
- **Math proof** (`.agents/scratches/curvature-verify.ts`): for 3 sample mounts — every vertex on
  the sphere (radius err ~1e-8), left/right edges constant-θ, top/bottom edges constant-φ,
  container axes correctly aligned. PASS for all mounts.
- **Real runtime bug found & fixed:** the previous code added the screen to its parent AFTER
  attaching `ScreenCurvatureBehavior`, so `target.parent` was still null in `onAttach` and the bend
  never initialized — every screen rendered flat without any error. Fixed by parenting first and by
  making the behavior lazily configure itself (`_ensureReady()`), with a guard that warns if a mount
  strays off the gallery sphere.
- **QA hook** `window.__showcase24.report()` (pattern like Showcase 28's `__showcase28`): per-screen
  orientation dots (height axis along meridian, front toward center), a probe edge vertex (live
  local z ≈ +0.21 at rest proves the bend is applied) and observer distances to screen-center vs
  screen-edge. Verified via headless Puppeteer dump (`.agents/scratches/qa-dump24.mjs`).

**Measured result (all 24 screens, real browser, `?rendererType=WEB_GL2`):**
- `yDotMeridian = +1` and `zDotInward = +1` on every screen → global orientation correct.
- `probeEdge z ≈ +0.21` on every screen → spherical bend is genuinely applied (before the fix it was 0/flat).
- Edge-vs-center distance from the fixed observer is split exactly 12/12 (near ring edge-closer,
  far ring edge-farther). This is the projection of an off-center observer inside a sphere —
  geometry is uniform (all screens bow away from the observer, i.e. they follow the concave inner
  wall), the perceived near/far split is an inherent perspective effect of `OBSERVER_BASE`, not a
  per-screen bug.

**Aesthetic check (synthetic-eyes vision, WEB_GL2):** middle and upper tiers visibly follow the
longitude/latitude grid (edges taper along meridians towards the pole, top/bottom arc along the
latitude rings); lower tier is heavily foreshortened from the low vantage (reads "flat floor"-ish
despite being on-sphere). Open question for the artist: whether the uniform concave-on-sphere
reading is desired, or a per-screen convex-bulge knob should be added (breaks on-sphere alignment).

---

## 2026-10-19 — Decision confirmed: keep the concave vectors on the sphere (CLOSED)

The artist chose the recommended option: **screens stay concave on the sphere** — no per-screen
curvature sign flip, no convex-bulge knob. Rationale on record: all 24 screens bow uniformly away
from the camera (concave dome interior = following the wireframe), and the 12/12 near/far distance
split measured at the fixed observer is inherent perspective of the off-center vantage, not a
per-screen geometry defect. The grid-aligned implementation of the previous entry is the final
shape. No code changes resulted from this decision.

