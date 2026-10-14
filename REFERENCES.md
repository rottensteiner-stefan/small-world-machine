# Sources & References

This document serves to record external sources, algorithms, mathematical derivations, and inspirations that flowed into the development of **small-world-machine**.

## Geometry & Mathematics

### `Rodrigues Quaternion-Vector Rotation`

- **File:** `packages/engine/src/math/Vector3D.ts`
- **Authors/Gurus:** Olinde Rodrigues (1840)
- **Formulas:** $v' = v + 2w(q \times v) + 2(q \times (q \times v))$
- **Usage:** Computes 3D vector rotation by unit quaternion with 15 multiplications and 12 additions, saving 40% of floating-point operations compared to full 4D Hamilton expansion ($q \cdot p \cdot q^*$) with zero memory allocations.

### `Perlin Smootherstep Polynomial`

- **File:** `packages/engine/src/math/MathUtils.ts`
- **Authors/Gurus:** Ken Perlin (2002, *Improving Noise*)
- **Formulas:** $S_2(t) = 6t^5 - 15t^4 + 10t^3$
- **Usage:** Quintic Hermite interpolation with zero 1st and 2nd derivatives at endpoints ($C^2$ continuity), preventing acceleration discontinuities in camera movements, transitions, and shader blending.

### `Gear`

- **File:** `packages/engine/src/geometry/Gear.ts`
- **Source:** [Rechneronline - Zahnrad berechnen](https://rechneronline.de/pi/zahnrad.php)
- **Usage:** The underlying formulas for generating isometric trapezoidal teeth, pitch circles, and radii for the 3D gear were taken from this tool and adapted.

### `HollowCylinder` (Hohlzylinder / Cylindrical Shell)

- **File:** `packages/engine/src/geometry/HollowCylinder.ts`
- **Source:** [Rechneronline - Hohlzylinder berechnen](https://rechneronline.de/pi/hohlzylinder.php)
- **Formulas:**
  - Wall thickness: $b = r_1 - r_2$
  - Volume: $V = \frac{\theta_{\text{len}}}{2\pi} \cdot \pi(r_1^2 - r_2^2)h$
  - Lateral surface area (outer + inner): $M = \frac{\theta_{\text{len}}}{2\pi} \cdot 2\pi(r_1 + r_2)h$
  - Total surface area: $A = 2\pi(r_1 + r_2)(r_1 - r_2 + h)$ (for closed cylinder)
- **Usage:** Provides exact procedural mesh generation for hollow cylinders / pipes with distinct normal vectors across the outer wall, inner wall, top annular cap, bottom annular cap, and sector cut planes. Includes closed-form geometric property calculations ($V$, $M$, $A$, $b$).

### `Barrel` (Fass / Keplersches Fass)

- **File:** `packages/engine/src/geometry/Barrel.ts`
- **Authors/Gurus:** Johannes Kepler (1615, *Nova Stereometria Doliorum Vinariorum*)
- **Source:** [Rechneronline - Fass berechnen](https://rechneronline.de/pi/fass.php)
- **Formulas:**
  - Kepler's barrel volume formula: $V \approx \frac{\theta_{\text{len}}}{2\pi} \cdot \frac{\pi \cdot h}{3} \left(2R^2 + \frac{r_{\text{top}}^2 + r_{\text{bottom}}^2}{2}\right)$
  - Space diagonal: $d = \sqrt{h^2 + 4r^2}$
  - Parabolic bulging radius profile: $r(y) = R - (R - r) \cdot \left(\frac{2y}{h}\right)^2$
- **Usage:** Procedural geometry for barrels, casks, kegs, and bulging containers with analytic surface normal derivations along the parabolic profile and crisp planar circular caps. Includes exact geometric calculations ($V$, $d$, $r(y)$).

### `TruncatedCone` (Kegelstumpf / Conical Frustum)

- **File:** `packages/engine/src/geometry/TruncatedCone.ts`
- **Source:** [Rechneronline - Kegelstumpf berechnen](https://rechneronline.de/pi/kegelstumpf.php)
- **Formulas:**
  - Slant height (Mantellinie): $s = \sqrt{(r_1 - r_2)^2 + h^2}$
  - Lateral surface area (Mantelfläche): $M = \frac{\theta_{\text{len}}}{2\pi} \cdot \pi(r_1 + r_2)s$
  - Total surface area: $A = M + \pi r_1^2 + \pi r_2^2$
  - Volume: $V = \frac{\theta_{\text{len}}}{2\pi} \cdot \frac{\pi h}{3}(r_1^2 + r_1 r_2 + r_2^2)$
- **Usage:** Procedural truncated cone geometry with mathematically exact surface normal slopes along the mantle, planar circular caps, and closed-form analytical geometric calculations.

### `CutCylinder` (Zylinderabschnitt / Oblique Cut Cylinder)

- **File:** `packages/engine/src/geometry/CutCylinder.ts`
- **Source:** [Rechneronline - Zylinderabschnitt berechnen](https://rechneronline.de/pi/zylinderabschnitt.php)
- **Formulas:**
  - Semi-major axis of elliptical top: $a = \sqrt{r^2 + \left(\frac{h_2 - h_1}{2}\right)^2}$
  - Cut angle: $\alpha = \arctan\left(\frac{h_2 - h_1}{2r}\right)$
  - Volume: $V = \frac{\theta_{\text{len}}}{2\pi} \cdot \pi r^2 \frac{h_1 + h_2}{2}$
  - Lateral surface area (Mantelfläche): $M = \frac{\theta_{\text{len}}}{2\pi} \cdot \pi r (h_1 + h_2)$
  - Total surface area: $A = \pi r (r + a + h_1 + h_2)$ (Base circle + Top ellipse + Mantle)
- **Usage:** Procedural cylinder sliced obliquely by an inclined cutting plane, creating an elliptical top face with distinct normals and exact geometric analysis methods.

### `PointedPillar` (Spitze Säule / Frustum Column with Conical Roof Tip)

- **File:** `packages/engine/src/geometry/PointedPillar.ts`
- **Source:** [Rechneronline - Spitze Säule berechnen](https://rechneronline.de/pi/spitze-saeule.php)
- **Formulas:**
  - Column slant height: $s_1 = \sqrt{(a - b)^2 + h_1^2}$
  - Tip slant height: $s_2 = \sqrt{b^2 + h_2^2}$
  - Lateral surface area (Mantelfläche): $M = \frac{\theta_{\text{len}}}{2\pi} \cdot \pi \left((a + b)s_1 + b s_2\right)$
  - Base area: $A_{\text{base}} = \pi a^2$
  - Total surface area: $A = \pi a^2 + M$
  - Volume: $V = \frac{\theta_{\text{len}}}{2\pi} \cdot \frac{\pi}{3} \left(h_1(a^2 + ab + b^2) + b^2 h_2\right)$
- **Usage:** Procedural architectural columns and obelisks consisting of a tapered shaft topped by a conical roof/tip with split normals across the transition ridge for crisp shading.

### `SphericalTriangleSector` (Kugeldreieck-Sektor / Spherical Triangle Wedge)

- **File:** `packages/engine/src/geometry/SphericalTriangleSector.ts`
- **Source:** [Rechneronline - Kugeldreieck-Sektor berechnen](https://rechneronline.de/pi/kugeldreiecksektor.php)
- **Formulas:**
  - Base equatorial arc length: $a = \alpha \cdot r$
  - Curved spherical triangle surface area: $S = \alpha \cdot r^2$
  - Planar bounding area (two meridian quarter circles + equator sector): $A_{\text{planar}} = \frac{\pi + \alpha}{2} r^2$
  - Total surface area: $A = \frac{3\alpha + \pi}{2} r^2$
  - Volume: $V = \frac{\alpha \cdot r^3}{3}$
- **Usage:** Procedural spherical triangle pyramid wedge geometry extending from the north pole to the equator, featuring separate normals for curved and planar faces.

### `SphericalCap` (Kugelsegment / Kugelkappe / Spherical Dome)

- **File:** `packages/engine/src/geometry/SphericalCap.ts`
- **Source:** [Rechneronline - Kugelsegment berechnen](https://rechneronline.de/pi/kugelsegment.php)
- **Formulas:**
  - Base radius: $a = \sqrt{h(2r - h)}$
  - Curved dome surface area (Kappenmantel): $M = \frac{\theta_{\text{len}}}{2\pi} \cdot 2\pi r h$
  - Base circular area: $A_{\text{base}} = \pi a^2 = \pi h(2r - h)$
  - Total surface area: $A = M + A_{\text{base}} = \pi h(4r - h)$
  - Volume: $V = \frac{\theta_{\text{len}}}{2\pi} \cdot \frac{\pi h^2}{3}(3r - h)$
- **Usage:** Procedural spherical dome and segment geometry sliced at height $h$ from the apex of a sphere of radius $r$, with analytical surface normal calculations and closed planar circular base.

### `Arch` (Bogen / Rundbogen / Roman Bridge Arch)

- **File:** `packages/engine/src/geometry/Arch.ts`
- **Source:** [Rechneronline - Bogen berechnen](https://rechneronline.de/pi/bogen.php)
- **Formulas:**
  - Front/back face area: $A_{\text{face}} = h l - \frac{\pi r^2}{2}$
  - Intrados (vault tunnel ceiling) area: $A_{\text{intrados}} = \pi r t$
  - Outer boundary area: $A_{\text{outer}} = 2t(l + h - r)$
  - Total surface area: $A = 2\left(h l - \frac{\pi r^2}{2}\right) + \pi r t + 2t(l + h - r)$
  - Volume: $V = \left(h l - \frac{\pi r^2}{2}\right) t$
- **Usage:** Procedural Roman masonry arch block with a semicircular vault tunnel carved out, watertight triangulated front/back faces, and inward-facing normals along the curved intrados ceiling.

### `Annulus` (Kreisring / Planar Flat Circular Ring)

- **File:** `packages/engine/src/geometry/Annulus.ts`
- **Source:** [Rechneronline - Kreisring berechnen](https://rechneronline.de/pi/kreisring.php)
- **Formulas:**
  - Ring width / wall thickness: $b = R - r$
  - Median radius: $r_{\text{med}} = \frac{R + r}{2}$
  - Tangent chord length: $l = 2\sqrt{R^2 - r^2}$
  - Perimeter: $U = \frac{\theta_{\text{len}}}{2\pi} \cdot 2\pi (R + r)$
  - Area: $A = \frac{\theta_{\text{len}}}{2\pi} \cdot \pi(R^2 - r^2) = \pi b(2r + b) = 2\pi b r_{\text{med}}$
- **Usage:** Planar 2D circular ring lying in the X-Z plane with normal $(0, 1, 0)$ and concentric UV coordinates, suitable for ground decals, disc rings, and planar halo effects.

### `OpenFrame` (Offener Rahmen / U-Profile)

- **File:** `packages/engine/src/geometry/OpenFrame.ts`
- **Source:** [Rechneronline - Offener Rahmen berechnen](https://rechneronline.de/pi/offener-rahmen.php)
- **Formulas:**
  - Outer width $a$, Inner width $b = a - 2c$
  - Outer height $h$, Inner height $i = h - c$
  - Wall/beam thickness $c$
  - Perimeter: $u = 2a + 4h - 4c = a + b + 2c + 2h + 2i$
  - Cross-sectional area: $A = c(2h + b) = c(2h + a - 2c) = 2ch + cb$
  - 3D Volume: $V = A \cdot t$
  - 3D Total surface area: $A_{\text{total}} = 2A + u \cdot t$
- **Usage:** Procedural U-shaped profile geometry that can render either as a 2D planar polygon in the X-Z plane or as a solid 3D extruded channel/beam with distinct outward-facing normals and closed-form analytical geometric calculations.

### `LShape` (L-Form / Winkelprofil / Angle Profile)

- **File:** `packages/engine/src/geometry/LShape.ts`
- **Source:** [Rechneronline - L-Form berechnen](https://rechneronline.de/pi/L-form.php)
- **Formulas:**
  - Outer sides $a, b$, Wall thickness $c$
  - Inner sides: $a' = a - c$, $b' = b - c$
  - Perimeter: $u = 2(a + b)$
  - Cross-sectional area: $A = c(a + b - c) = ac + b'c$
  - 3D Volume: $V = A \cdot t$
  - 3D Total surface area: $A_{\text{total}} = 2A + u \cdot t$
- **Usage:** Procedural L-beam angle profile geometry supporting both 2D planar rendering and 3D prism extrusion with exact normal vectors across all inner and outer facets and analytical geometric methods.

### `Rhombus` (Raute / Gleichseitiges Viereck / Diamond)

- **File:** `packages/engine/src/geometry/Rhombus.ts`
- **Source:** [Rechneronline - Raute berechnen](https://rechneronline.de/pi/raute.php)
- **Formulas:**
  - Side length $a$, Acute angle $\alpha$
  - Diagonals: $e = 2a \cos(\alpha / 2)$, $f = 2a \sin(\alpha / 2)$
  - Incircle radius: $r_i = \frac{a \sin \alpha}{2} = \frac{e f}{4a}$
  - Height: $h = a \sin \alpha = \frac{e f}{2a}$
  - Perimeter: $u = 4a = 2\sqrt{e^2 + f^2}$
  - Area: $A = a^2 \sin \alpha = \frac{e \cdot f}{2} = a \cdot h$
  - 3D Volume: $V = A \cdot t$
  - 3D Total surface area: $A_{\text{total}} = 2A + u \cdot t$
- **Usage:** Procedural equilateral rhombus / diamond geometry aligned along its diagonals $e$ and $f$, with support for 2D plane rendering and 3D extruded prism geometry.

### `TriStar` (Dreistern / 3-Pointed Star / Concave Hexagon)

- **File:** `packages/engine/src/geometry/TriStar.ts`
- **Source:** [Rechneronline - Dreistern berechnen](https://rechneronline.de/pi/dreistern.php)
- **Formulas:**
  - Arm edge length $a$, Inner apex angle $\alpha$
  - Outer angle: $\beta = 120^\circ + \alpha = \frac{2\pi}{3} + \alpha$
  - Arm base width: $b = \sqrt{2a^2(1 - \cos \alpha)} = 2a \sin(\alpha / 2)$
  - Arm height: $i = \sqrt{\frac{4a^2 - b^2}{4}} = a \cos(\alpha / 2)$
  - Tip distance / chord length: $l = \sqrt{2a^2(1 - \cos \beta)}$
  - Total height: $h = \frac{\sqrt{3}}{2} l$
  - Outer tip circumradius: $R = \frac{l}{\sqrt{3}} = a \cos(\alpha / 2) + \frac{a}{\sqrt{3}} \sin(\alpha / 2)$
  - Inner notch radius: $r_{\text{in}} = \frac{b}{\sqrt{3}} = \frac{2a}{\sqrt{3}} \sin(\alpha / 2)$
  - Perimeter: $u = 6a$
  - Area: $A = \frac{3}{2} i b + \frac{\sqrt{3}}{4} b^2$
  - 3D Volume: $V = A \cdot t$
  - 3D Total surface area: $A_{\text{total}} = 2A + u \cdot t$
- **Usage:** Procedural 3-pointed star geometry (concave equilateral hexagon for $\alpha < 60^\circ$) formed by 3 isosceles triangular arms on a central equilateral triangle, with exact analytical methods and 2D/3D meshing.

### `CylindricalArch` (Zylinderbogen / Rohrbogen / Curved Pipe Elbow)

- **File:** `packages/engine/src/geometry/CylindricalArch.ts`
- **Source:** [Rechneronline - Zylinderbogen berechnen](https://rechneronline.de/pi/zylinderbogen.php)
- **Formulas:**
  - Pipe radius $r$, Inner bend radius $a$
  - Major torus radius: $R = a + r$
  - Sweep angle: $\theta_{\text{arc}}$ (default $\pi / 2 = 90^\circ$ for perpendicular pipe connection)
  - Mantle lateral surface area: $M = 2\pi \cdot \theta_{\text{arc}} (a + r) r = \pi^2 (a + r) r$ (for $90^\circ$)
  - Total surface area: $A = M + 2\pi r^2 = \pi^2 (a + r) r + 2\pi r^2$ (with circular end caps)
  - Volume: $V = \pi \cdot \theta_{\text{arc}} (a + r) r^2 = \frac{1}{2} \pi^2 (a + r) r^2$ (for $90^\circ$)
  - Surface-to-volume ratio: $A / V$
- **Usage:** Procedural quarter-torus cylindrical elbow pipe geometry for smoothly joining perpendicular pipes, with analytical surface normal calculations and closed planar circular caps.

### `Cone` (Kegel / Circular Cone)

- **File:** `packages/engine/src/geometry/Cone.ts`
- **Source:** [Rechneronline - Kegel berechnen](https://rechneronline.de/pi/kegel.php)
- **Formulas:**
  - Base radius $r$, Height $h$
  - Slant height (Mantellinie): $m = \sqrt{h^2 + r^2}$
  - Lateral surface area (Mantelfläche): $M = \frac{\theta_{\text{len}}}{2\pi} \cdot \pi r m$
  - Base area: $A_{\text{base}} = \frac{\theta_{\text{len}}}{2\pi} \cdot \pi r^2$
  - Total surface area: $A = M + A_{\text{base}} = \pi r (r + m)$
  - Volume: $V = \frac{\theta_{\text{len}}}{2\pi} \cdot \frac{1}{3} \pi r^2 h$
  - Apex angle (Öffnungswinkel): $\alpha = 2 \arcsin(r / m)$
  - Base angle (Basiswinkel): $\beta = \frac{\pi - \alpha}{2} = \arctan(h / r)$
  - Surface-to-volume ratio: $A / V$
- **Usage:** Standard circular cone geometry with analytical geometric helper methods for all slant, surface, volume, and angular properties.

### `HollowTruncatedCone` (Hohlkegelstumpf / Truncated Hollow Cone)

- **File:** `packages/engine/src/geometry/HollowTruncatedCone.ts`
- **Source:** [Rechneronline - Hohlkegelstumpf berechnen](https://rechneronline.de/pi/hohlkegelstumpf.php)
- **Formulas:**
  - Outer base radius $R$, Outer top radius $r$
  - Inner base radius $S$, Inner top radius $s$
  - Height $h$, Wall thickness $d = R - S = r - s$
  - Outer slant height: $m_{\text{outer}} = \sqrt{(R - r)^2 + h^2}$
  - Inner slant height: $m_{\text{inner}} = \sqrt{(S - s)^2 + h^2}$
  - Outer lateral area: $M_{\text{outer}} = \frac{\theta_{\text{len}}}{2\pi} \cdot \pi (R + r) m_{\text{outer}}$
  - Inner lateral area: $M_{\text{inner}} = \frac{\theta_{\text{len}}}{2\pi} \cdot \pi (S + s) m_{\text{inner}}$
  - Bottom annular cap area: $A_{\text{bottom}} = \frac{\theta_{\text{len}}}{2\pi} \cdot \pi (R^2 - S^2)$
  - Top annular cap area: $A_{\text{top}} = \frac{\theta_{\text{len}}}{2\pi} \cdot \pi (r^2 - s^2)$
  - Total surface area: $A = M_{\text{outer}} + M_{\text{inner}} + A_{\text{bottom}} + A_{\text{top}}$
  - Volume: $V = \frac{\theta_{\text{len}}}{2\pi} \cdot \frac{\pi h}{3} (R^2 + R r + r^2 - S^2 - S s - s^2)$
  - Surface-to-volume ratio: $A / V$
- **Usage:** Procedural hollow conical frustum / reducer geometry with distinct normals across outer mantle, inner mantle, top annular cap, and bottom annular cap.

### `Capsule` (Kapsel / Spherocylinder)

- **File:** `packages/engine/src/geometry/Capsule.ts`
- **Source:** [Rechneronline - Kapsel berechnen](https://rechneronline.de/pi/kapsel.php)
- **Formulas:**
  - Sphere radius $r$, Cylinder height $h$
  - Total capsule length: $l = h + 2r$
  - Lateral cylinder area: $A_{\text{cyl}} = 2\pi r h$
  - Combined hemispherical caps area: $A_{\text{caps}} = 4\pi r^2$
  - Total surface area: $A = 2\pi r (2r + h) = 4\pi r^2 + 2\pi r h$
  - Volume: $V = \pi r^2 (\frac{4}{3}r + h) = \frac{4}{3}\pi r^3 + \pi r^2 h$
  - Surface-to-volume ratio: $A / V$
- **Usage:** Procedural spherocylinder capsule geometry combining a cylindrical center with hemispherical end caps and exact analytical surface and volume methods.


### Matrix and Quaternion Derivations (General Reference)

- **File:** Mainly affects `packages/engine/src/math/Matrix4.ts`, `packages/engine/src/math/Quaternion.ts`, `packages/engine/src/math/Matrix3.ts` as well as cameras/projections.
- **Source:** [Mathematische Grundlagen der 3D-Grafik (David Nadlinger, 2008/2009)](https://klickverbot.at/science/3d-mathematics/3d-mathematics.pdf)
- **Usage:** An excellent and compact German summary of the underlying 3D mathematics. Contains derivations for rotations (avoiding gimbal lock via quaternions), view matrix, and projection matrix (incl. frustum and clipping). Serves as a general reference for the engine's math, since `small-world-machine` uses the OpenGL convention (right-handed system, column vectors) as described there.

### Introduction to 3D Graphics and Rendering Pipeline (David Scherfgen)

- **File:** Affects the general architecture of the engine (e.g., lighting, shaders, geometry buffers, cameras).
- **Source:** [Einführung in die 3D-Grafik (David Scherfgen)](https://www.david-scherfgen.de/downloads/neues-buch-kapitel-3d-grafik.pdf)
- **Usage:** This book chapter provides a phenomenal overview of the entire rendering pipeline (from vector to pixel on the screen). It details topics such as the Phong lighting model (Ambient, Diffuse, Specular), shading types (Flat, Gouraud, Phong), texturing (MIP-mapping, Anti-Aliasing), and the Z-Buffer. **Note:** In contrast to `small-world-machine` (OpenGL convention), this script primarily uses the Direct3D convention (left-handed coordinate system, row vectors).

### Fast, Minimum Storage Ray/Triangle Intersection (Möller-Trumbore)

- **File:** `packages/engine/src/physix/Raycaster.ts`
- **Authors/Gurus:** Tomas Möller and Ben Trumbore (1997)
- **Source:** [Fast, Minimum Storage Ray-Triangle Intersection](https://cadxfem.org/inf/Fast%20MinimumStorage%20RayTriangle%20Intersection.pdf)
- **Usage:** This is the mathematical gold standard for ray-triangle intersection testing without requiring precomputed plane equations. Used in the `Raycaster` to provide mathematically exact, pixel-perfect polygon picking of 3D objects, directly against their `GeometryDataInterface` vertices after accelerating the queries with `Octree` AABB bounding box checks.

### Octree Spatial Partitioning

- **File:** `packages/engine/src/core/culling/Octree.ts`
- **Authors/Gurus:** Donald Meagher (1980)
- **Source:** [Octree Encoding: A New Solid Representation for Computer Graphics](https://rpi.edu/)
- **Usage:** Used as the fundamental spatial acceleration structure for the engine. It recursively divides 3D space into eight octants, allowing collision detection, frustum culling, and raycasting (picking) to operate in $O(\log n)$ time instead of $O(n)$, drastically improving performance in scenes with many objects.

### `AxesHelper` (3D Cartesian Coordinate System Visualization)

- **File:** `packages/engine/src/core/helpers/AxesHelper.ts`
- **Source:** Standard Computer Graphics RGB Coordinate Convention ($+X$ = Red, $+Y$ = Green, $+Z$ = Blue) and OpenGL Right-Handed System.
- **Usage:** Visualizes local and world coordinate systems using neon unlit cylinder shafts, cone arrowheads, and camera-facing billboarded text labels (`Sprite` + `TextTexture`). Integrated into `GadgetInspector` to visually track scene origin and animated bone transforms in real time.

### Gielis Superformula (Supershapes)

- **File:** `packages/geometry-extras/src/Supershape.ts`
- **Authors/Gurus:** Johan Gielis (2003), generalizing Gabriel Lamé's superellipse (1818)
- **Source:** [Gielis: "A generic geometric transformation that unifies a wide range of natural and abstract shapes" (American Journal of Botany, 2003)](https://bsapubs.onlinelibrary.wiley.com/doi/10.3732/ajb.90.3.333)
- **Formulas:**
  - $r(\theta) = \left( \left|\frac{\cos(m\theta/4)}{a}\right|^{n_2} + \left|\frac{\sin(m\theta/4)}{b}\right|^{n_3} \right)^{-1/n_1}$
  - 3D supershape surface combines two independent profiles $r_1(\theta)$ (longitude) and $r_2(\phi)$ (latitude): $x = r_1 \cos\theta \cdot r_2 \cos\phi$, $y = r_2 \sin\phi$, $z = r_1 \sin\theta \cdot r_2 \cos\phi$.
- **Usage:** Drives the exotic `Supershape` geometry in the `@small-world-machine/geometry-extras` package. A single closed-form formula, parametrized by two independent superformula profiles, produces a huge family of closed surfaces (spheres, starfish, gemstones, organic blobs) without any bespoke per-shape code.

### (p,q) Torus Knot Parametrization

- **File:** `packages/geometry-extras/src/TorusKnot.ts`
- **Source:** Standard parametric torus knot curve, $x(u) = R(2+\cos(\frac{q}{p}u))\frac{\cos u}{2}$, $y(u) = R\sin(\frac{q}{p}u)\frac{1}{2}$, $z(u) = R(2+\cos(\frac{q}{p}u))\frac{\sin u}{2}$ for $u \in [0, 2\pi p]$; well known from knot theory and widely used as a graphics primitive (e.g. three.js `TorusKnotGeometry`).
- **Usage:** `TorusKnot.generateGeometryData()` sweeps a circular tube cross-section along this curve. The per-vertex normal/binormal frame is built by projecting a fixed reference "up" vector against the curve tangent (Gram-Schmidt orthogonalization), swapping to a secondary reference near the singular case where the tangent is (almost) parallel to it — a cheaper, seam-free alternative to a full parallel-transport Frenet frame for a closed periodic curve.

### Möbius Strip Parametrization

- **File:** `packages/geometry-extras/src/MobiusStrip.ts`
- **Source:** Standard Möbius strip surface parametrization, $x(u,v) = (R + v\cos(u/2))\cos(u)$, $y(u,v) = v\sin(u/2)$, $z(u,v) = (R + v\cos(u/2))\sin(u)$ for $u \in [0, 2\pi]$, $v \in [-w/2, w/2]$ — the canonical single-half-twist non-orientable surface (August Möbius & Johann Listing, 1858).
- **Usage:** `MobiusStrip` renders the surface as an open strip mesh (first and last ring are never explicitly welded together) instead of a closed loop, since the two boundary rings only coincide in space after an implicit $v \to -v$ flip. This keeps the discrete mesh orientable and consistently shadeable (`computeNormals()` works unmodified), rather than needing double-sided rendering to fake a globally consistent normal field that a true non-orientable surface cannot have. A `twists` option generalizes the exponent to $n \cdot u/2$, allowing higher odd (Möbius-like) or even (simple twisted band) variants.

### 3D Voronoi Diagram via Half-Space Intersection

- **File:** `packages/geometry-extras/src/VoronoiCells.ts`
- **Authors/Gurus:** Georgy Voronoy (1908); polygon clipping technique after Ivan Sutherland & Gary Hodgman (1974)
- **Source:** Standard computational-geometry construction: a Voronoi cell for seed $S$ is the intersection of half-spaces $\{v : \|v - S\| \le \|v - O\|\}$ over every other seed $O$, each half-space bounded by the perpendicular bisector plane of $S$ and $O$.
- **Usage:** `VoronoiCells` builds each seed's cell by starting from a bounding box and iteratively clipping it against every other seed's bisector plane, using a 3D extension of Sutherland-Hodgman polygon clipping: each clipped face contributes exactly one new edge lying on the cutting plane, and these edges are chained into a new "cap" face closing the cut. A `cellPadding` option shrinks each finished cell towards its own centroid, opening visible gaps between cells for a "shattered crystal" look instead of a seamless tessellation. Candidates are clipped nearest-seed-first with an early skip once a plane is provably further away than the cell's current furthest vertex (`maxDistanceFromPoint` in the same file), avoiding the dominant per-clip cost for neighbors that can no longer affect the cell -- a pragmatic substitute for a full spatial index (k-d-tree/grid) at the point counts this package targets (tens to a few hundred).

### Power Diagram / Additively Weighted (Laguerre-)Voronoi Diagram

- **File:** `packages/geometry-extras/src/VoronoiCells.ts` (`computeCellFaces`)
- **Authors/Gurus:** Edmond Laguerre (1880s); Voronoi/power-diagram formalization is standard in computational geometry literature (e.g. Aurenhammer 1987)
- **Source:** Standard power-distance construction: the bisector between weighted seeds $(S, r_S)$ and $(O, r_O)$ is the plane where $\|v-S\|^2 - r_S^2 = \|v-O\|^2 - r_O^2$, which reduces to the ordinary bisector plane shifted along $\widehat{O-S}$ by $\frac{r_S^2 - r_O^2}{2\|O-S\|}$.
- **Usage:** `VoronoiCellsOptions.weights` lets a seed claim more or less space than a plain Voronoi diagram would give it, by shifting each bisector plane's `planePoint` by this derived offset instead of using the exact midpoint. Reduces to plain Voronoi when all weights are equal. The classical basis for foam/bubble-like structures (unequal cell sizes) instead of the roughly-equal cells a plain Voronoi diagram produces.

### Lloyd Relaxation (Centroidal Voronoi Tessellation)

- **File:** `packages/geometry-extras/src/VoronoiCells.ts` (`relaxPoints`)
- **Authors/Gurus:** Stuart P. Lloyd (1957/1982)
- **Source:** [Lloyd: "Least Squares Quantization in PCM" (IEEE Transactions on Information Theory, 1982; written 1957)](https://ieeexplore.ieee.org/document/1056489)
- **Usage:** `relaxPoints()` (and `VoronoiCellsOptions.relaxationIterations`) repeatedly moves each seed point to its own cell's centroid for a few rounds, converging towards a centroidal Voronoi tessellation. Evens out cell sizes that would otherwise come from pure random point placement (small slivers next to oversized cells), without changing the underlying cell-construction algorithm.

### Fast Poisson Disk Sampling in Arbitrary Dimensions

- **File:** `packages/geometry-extras/src/PoissonDiskSample.ts`
- **Authors/Gurus:** Robert Bridson (2007)
- **Source:** [Bridson: "Fast Poisson Disk Sampling in Arbitrary Dimensions" (SIGGRAPH 2007 Sketches)](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf)
- **Usage:** `poissonDiskSample()` generates seed points with a guaranteed minimum pairwise distance (via a grid-accelerated dart-throwing process around each newly placed point), instead of the clustering that plain uniform-random point placement produces. Intended as an alternative `VoronoiCellsOptions.points` source for a more evenly spaced "crystal shatter" look.

### Marching Tetrahedra (Scalar Field Isosurface Extraction)

- **File:** `packages/geometry-extras/src/MarchingCubes.ts`
- **Authors/Gurus:** William E. Lorensen & Harvey E. Cline (1987), originators of the Marching Cubes family
- **Source:** [Lorensen & Cline: "Marching Cubes: A High Resolution 3D Surface Construction Algorithm" (SIGGRAPH 1987)](https://dl.acm.org/doi/10.1145/37401.37422)
- **Usage:** `MarchingCubes` polygonises an arbitrary 3D scalar field (e.g. the bundled `metaballField()` helper) by splitting each grid cube into 6 tetrahedra (standard decomposition along the main diagonal) instead of using the classic algorithm's 256-case cube edge/triangle lookup tables. Each tetrahedron only has 16 simple inside/outside corner combinations (0, 1, or 2 output triangles), which is both immune to the classic algorithm's ambiguous-face hole artifacts and small enough to implement generically (with per-triangle auto-orientation against the local inside-to-outside direction) rather than transcribing the large, error-prone reference table from memory.

### Surface of Revolution (Lathe Geometry)

- **File:** `packages/geometry-extras/src/Lathe.ts`
- **Authors/Gurus:** Standard constructive solid geometry technique; the fixture modelling operation dates back to manual lathe turning.
- **Source:** Parametrization of a rotational surface as $P(u,v) = (r(v)\cos u,\ y(v),\ r(v)\sin u)$; widely available in geometry libraries (e.g. three.js `LatheGeometry`).
- **Usage:** `Lathe` revolves a user-supplied radius×height profile around the Y axis into a vase/bottle/goblet-shaped indexed mesh. A closed ring reuses the first revolution column to avoid a UV seam and back-facing wrap edge; a partial arc keeps distinct boundary columns. The profile must be strictly monotonic in height to avoid self-intersecting rings.

### Platonic Solids via Polar Duality (Dodecahedron Construction)

- **File:** `packages/geometry-extras/src/PlatonicSolid.ts`
- **Authors/Gurus:** Classical geometry (regular convex polyhedra, Euclid's "Elements" Book XIII); polar/dual polyhedron construction.
- **Source:** A regular dodecahedron is the polar dual of a regular icosahedron: each dual vertex is the normalized centroid of an icosahedron face, dual edges join faces sharing an edge, and dual faces are the cyclically ordered stars of the original vertices.
- **Usage:** `PlatonicSolid` generates tetrahedron/octahedron/icosahedron from canonical coordinates and derives the dodecahedron by the verified polar-dual construction above (V=20, E=30, F=12, uniform edge length), avoiding a hand-wired, error-prone pentagon index table. Optional `detail` subdivision normalizes edge midpoints onto the circumscribed sphere to produce geodetic spheres.

### Generic Parametric Surface Grid

- **File:** `packages/geometry-extras/src/ParametricSurface.ts`
- **Authors/Gurus:** Standard parametric surface representation in computer graphics.
- **Source:** $S(u,v) = (x(u,v), y(u,v), z(u,v))$ over a rectangular domain; foundational to any freeform/procedural surface modelling.
- **Usage:** Exposes a single `(u, v) → Vector3D` evaluator over `[uMin,uMax]×[vMin,vMax]`, tessellated into an indexed grid with optional wrap-around in `u`/`v` for periodic (closed) surfaces such as tubes or bands. Covers waves, flags, helixes and terrain patches without a dedicated class per family.

### Ear Clipping with Hole Bridging (Concave Polygon Fill)

- **File:** `packages/geometry-extras/src/FilledPolygon.ts`
- **Authors/Gurus:** David Eberly (Geometric Tools); the robust ear-clipping variant that requires a polygon without holes and the standard bridge insertion to fold holes into a single simple loop.
- **Source:** ["Triangulation by Ear Clipping" (David Eberly, Geometric Tools)](https://www.geometrictools.com/Documentation/TriangulationByEarClipping.pdf)
- **Usage:** `FilledPolygon` ear-clips arbitrary simple concave contours and subtracts holes: each hole is wound opposite to the outer ring, bridged to it through a mutually visible vertex pair, and traced as a closed loop so the doubled connector cut preserves the signed area (`area(outer) − Σ area(holes)`, verified by tests). This generalizes the core `PolygonFan`, which only fills star-shaped profiles.

## Physics & Collision Detection

### Gravitational Lensing (Black Hole Shadow & Einstein Ring)
- **File:** `packages/engine/src/renderers/post/shaders/PostProcess.frag.glsl`, `apps/showcases/21/showcase.ts`
- **Inspiration:** Dr. Katie Bouman, Dr. Sara Issaoun, and the Event Horizon Telescope (EHT) Collaboration (2019, 2022)
- **Source:** First imaging of M87* and Sagittarius A* (Sgr A*).
- **Usage:** The visual representation of the Super Massive Black Hole in Showcase 21 is profoundly inspired by the groundbreaking imaging work of the EHT team. The custom post-processing shader approximates the gravitational lensing, deflecting light rays near the simulated event horizon to recreate the iconic asymmetric glowing ring and the absolute black shadow at its core.

### Sequential Impulse & Rigid Body Dynamics

- **Authors/Gurus:** Erin Catto (Creator of Box2D)
- **Usage:** Essential concepts for resolving constraints, joints, and stable resting contacts using sequential impulses, which heavily influence how we stabilize physics loops and design our collision impulse resolution.

### Plummer Potential Gravity Well (Softened Central Field)

- **File:** `packages/vfx-extras/src/affectors/PointAttractorAffector.ts`, `packages/vfx-extras/src/AccretionDiskEmitter.ts`
- **Authors/Gurus:** H. C. Plummer (1911)
- **Source:** [Plummer: "On the Problem of Distribution in Globular Star Clusters" (Monthly Notices of the Royal Astronomical Society, 1911)](https://doi.org/10.1093/mnras/71.5.460)
- **Usage:** Used in `PointAttractorAffector` to simulate smooth, non-diverging gravitational acceleration for star clusters, planetary gravity, and black holes without numerical singularities or $O(1/r^2)$ explosions near the origin.

### Hydrostatic Buoyancy (Fluid Volume & Buoyancy Solver)

- **File:** `packages/engine/src/physix/fluids/BuoyancySolver.ts`, `packages/engine/src/physix/FluidVolume.ts`, `packages/engine/src/physix/PhysicsSystem.ts`
- **Authors/Gurus:** Archimedes of Syracuse (3rd century BC)
- **Formulas:**
  - Buoyant force: $F_{\text{buoy}} = \rho_{\text{fluid}} \cdot V_{\text{submerged}} \cdot g$ (Archimedes' principle), with the submerged volume $V_{\text{submerged}}$ derived from the collider's intersection with the fluid volume; sphere volume $V = \frac{4}{3}\pi r^3$, box volume $V = w \cdot h \cdot d$ respectively.
- **Source:** Standard hydrostatic law of physics (Archimedes' principle); universally taught in physics curricula.
- **Usage:** `BuoyancySolver` computes the upward buoyant force on a rigid body intersecting a fluid volume's surface (per submerged-collider fraction) together with fluid flow forces, and reports the resulting linear/angular drag multipliers back to the `PhysicsSystem`. Provides stable float/sink behaviour and interaction damping for buoyant props, vehicles, and containers in fluid scenes.

### Fixed-Timestep Render Interpolation

- **File:** `packages/engine/src/physix/PhysicsSystem.ts`
- **Authors/Gurus:** Glenn Fiedler (Gaffer On Games)
- **Source:** ["Fix Your Timestep!"](https://gafferongames.com/post/fix_your_timestep/)
- **Usage:** The canonical explanation of why a fixed-timestep physics accumulator needs to hand rendering an interpolated blend (`alpha = accumulator / fixedTimeStep`) between the two most recent physics states, rather than snapping to the latest completed step. Used as the basis for decoupling `small-world-machine`'s variable render framerate from its fixed physics tick, eliminating visual stutter/judder.

### Real-Time Collision Detection

- **Authors/Gurus:** Christer Ericson
- **Usage:** The ultimate reference for implementing the Separating Axis Theorem (SAT), efficient intersection testing, and robust handling of floating-point inaccuracies in spatial math.

### Generic Convex Polyhedron SAT (`ConvexHull` Collider)

- **File:** `packages/engine/src/physix/ConvexHull.ts`, `packages/engine/src/physix/Collision.ts`
- **Authors/Gurus:** Christer Ericson (Real-Time Collision Detection); same underlying theorem as the engine's existing OBB-OBB SAT (`Collision._obbObb`/`resolveObbObb`)
- **Usage:** Generalizes the engine's existing 3+3+9-axis OBB-OBB SAT to an arbitrary convex polyhedron: every face normal of both shapes, plus every pairwise cross product of their edge directions, is a candidate separating axis (`Collision._satPolytopes`). `BoundingBox`/`OBB` are adapted to this same generic test as ad-hoc 8-vertex hulls (`_boxAsHull`/`_obbAsHull`) rather than duplicating the axis logic per shape pair, so `HULL` collides correctly against `SPHERE`/`BOX`/`OBB`/`HULL` alike. Added specifically to give Voronoi fracture shards (`@small-world-machine/physics-extras`'s `fractureObject()`) their own correctly-shaped collider instead of a crude box/sphere approximation.

### Voronoi Fracture (Physics-Based Destruction)

- **File:** `packages/physics-extras/src/VoronoiFracture.ts`
- **Concept:** Common game/VFX destruction technique: partition an object into convex Voronoi cells (see `VoronoiCells` above) and give each cell its own rigid body, so an impact "shatters" the object into physically simulated fragments instead of a scripted animation.
- **Usage:** `fractureObject()` computes each shard as its own clipped cell (reusing `@small-world-machine/geometry-extras`'s `computeCellFaces`/`cellCentroid`), builds a `ConvexHull` collider from it, and gives it a `RigidBody` with an evenly-split share of the original object's mass -- optionally with an initial outward impulse from an `impactPoint`, for a "shatter" kick rather than inert pieces.

### Advanced Collision Detection and Simulation

- **Authors/Gurus:** Ming C. Lin and Nadia Magnenat Thalmann
- **Usage:** Prof. Ming C. Lin is a pioneer in the field of collision detection (I-COLLIDE, SWIFT, V-COLLIDE). Her foundational research in bounding volume hierarchies and fast continuous collision detection provided the theoretical groundwork for modern rigid body physics. Nadia Magnenat Thalmann's pioneering work in simulating virtual humans and deformable objects is a profound inspiration for expanding interactive 3D systems beyond simple rigid bodies.

### Physics-based Character Animation

- **Authors/Gurus:** Jessica Hodgins
- **Usage:** Her foundational research in integrating physical simulations with character animation serves as an ongoing inspiration for adding complex kinematics and physics-driven behaviors to game engines.

## Game Feel & Player Experience

### Trauma-Based Camera Shake

- **File:** `packages/engine/src/core/cameras/effects/ShakeEffect.ts`
- **Authors/Gurus:** Squirrel Eiserloh
- **Source:** ["Math for Game Programmers: Juicing Your Cameras With Math"](https://gdcvault.com/play/1023146/Math-for-Game-Programmers-Juicing) — GDC 2016
- **Usage:** Drives our screen-shake as a decaying "trauma" value with a squared (trauma²) falloff envelope, sampled through continuous simplex noise per axis instead of per-frame white noise — reads as a smooth wobble that eases out, rather than a jittery flicker that cuts off abruptly.

### Hit-Stop / Freeze-Frame

- **File:** `packages/engine/src/core/SmallWorldMachine.ts`
- **Authors/Gurus:** common technique across fighting/action games (e.g. Street Fighter, Bayonetta)
- **Source:** ["Juice It or Lose It"](https://www.gdcvault.com/play/1016487/Juice-It-or-Lose) — Martin Jonasson & Petri Purho, GDC Europe 2012
- **Usage:** Briefly scales down gameplay-facing deltaTime (app update, physics step, scene behaviors) on impact while the camera keeps updating at full speed, so its shake/flash effects still play — sells the weight of a hit without pausing the whole engine loop.

## Rendering Architecture & Best Practices

### Physically Based Rendering (PBR) & glTF 2.0 Specification

- **Authors/Gurus:** Matt Pharr, Wenzel Jakob, Greg Humphreys, Khronos 3D Formats Working Group
- **Source:**
  - [Physically Based Rendering: From Theory to Implementation (PBRT)](https://www.pbrt.org/)
  - [glTF 2.0 Specification: Appendix B (BRDF Implementation)](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#appendix-b-brdf-implementation)
- **Usage:** The mathematical basis for PBR, raytracing, refraction, and energy conservation (`Diffuse + Specular <= 1.0`) across all rendering backends.

### Cook-Torrance Microfacet BRDF (GGX / Smith / Schlick)

- **File:** `packages/engine/src/renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl`, `packages/engine/src/renderers/shaders/source/web_gpu/chunks/pbr_math.wgsl`, `packages/engine/src/renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl`
- **Authors/Gurus:** Robert L. Cook & Kenneth E. Torrance (1982), Bruce Walter et al. (GGX/Trowbridge-Reitz, 2007), Christophe Schlick (1994)
- **Source:**
  - [Cook & Torrance: "A Reflectance Model for Computer Graphics" (1982)](https://dl.acm.org/doi/10.1145/357290.357293)
  - [Walter et al.: "Microfacet Models for Refraction through Rough Surfaces" (2007)](https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf)
  - [Schlick: "An Inexpensive BRDF Model for Physically-based Rendering" (1994)](https://citeseerx.ist.psu.edu/viewdoc/download?doi=10.1.1.50.2297&rep=rep1&type=pdf)
- **Usage:** The core specular reflectance model used across both WebGL2 and WebGPU standard PBR pipelines. Composes the microfacet distribution $D$ (Trowbridge-Reitz/GGX for long-tailed specular highlights), geometric shadowing/masking $G$ (Smith model with Schlick-GGX approximation), and Fresnel reflectance $F$ (Schlick approximation) with energy-conserving diffuse split ($k_D = (1 - k_S) \cdot (1 - \text{metallic})$).

### Khronos PBR Material Extensions & Formulas

#### 1. `KHR_materials_ior` — Index of Refraction & Fresnel Baseline ($F_0$)

- **File:** `packages/liquid-extras/src/materials/OilSlick/OilSlickMaterial.ts`, `packages/engine/src/core/materials/surface/StandardMaterial.ts`, `packages/engine/src/core/materials/glass/GlassMaterial.ts`
- **Authors/Gurus:** Khronos 3D Formats Working Group
- **Source:** [Khronos glTF Extension: `KHR_materials_ior`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_ior)
- **Formulas:**
  - $F_0 = \left(\frac{\text{IOR} - 1}{\text{IOR} + 1}\right)^2$
  - Dielectric baseline: Water/Oil ($\text{IOR} \approx 1.333 \implies F_0 \approx 0.0204$), Glass ($\text{IOR} \approx 1.5 \implies F_0 = 0.040$).
- **Usage:** Calibrates analytic Schlick Fresnel reflections and specular base reflectance without requiring dynamic cubemap reflection probes.

#### 2. `KHR_materials_volume` — Beer-Lambert Volumetric Absorption

- **File:** `packages/engine/src/core/materials/glass/GlassMaterial.ts`, `packages/engine/src/core/materials/liquid/OpenWaterMaterial.ts`, `packages/liquid-extras/src/materials/OilSlick/OilSlickMaterial.ts`
- **Authors/Gurus:** Khronos 3D Formats Working Group
- **Source:** [Khronos glTF Extension: `KHR_materials_volume`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_volume)
- **Formulas:**
  - $T(x) = c^{\frac{x}{d}} = \exp(-\sigma_t \cdot x)$ with extinction coefficient $\sigma_t = -\frac{\ln(c)}{d}$
- **Usage:** Calculates realistic light attenuation and color absorption as light rays travel through translucent materials (colored glass, murky water, oil layers).

#### 3. `KHR_materials_iridescence` — Two-Beam Thin-Film Interference

- **File:** `packages/liquid-extras/src/shading/thinFilm/thinFilm.ts`, `packages/liquid-extras/src/materials/OilSlick/OilSlickMaterial.ts`, `packages/liquid-extras/src/materials/OilPuddle/OilPuddle.frag.glsl`, `packages/liquid-extras/src/materials/OilPuddle/OilPuddle.frag.glsl100`, `packages/liquid-extras/src/materials/OilPuddle/OilPuddle.frag.wgsl`
- **Authors/Gurus:** Laurent Belcour & Pascal Barla (2017), Khronos 3D Formats Working Group
- **Source:**
  - [Khronos glTF Extension: `KHR_materials_iridescence`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_iridescence)
  - [Belcour & Barla: "A Practical Extension to Microfacet Theory for the Modeling of Varying Iridescence" (2017)](https://belcour.github.io/blog/research/publication/2017/05/01/brdf-thin-film.html)
- **Formulas:**
  - $I(\lambda) = R_1 + R_2 + 2\sqrt{R_1 R_2}\cos(\Delta\phi(\lambda))$
  - Phase difference: $\Delta\phi(\lambda) = \frac{4\pi \cdot \eta_{\text{film}} \cdot d \cdot \cos\theta_2}{\lambda}$ evaluated at reference wavelengths $\lambda \in \{650, 550, 450\}\,\text{nm}$ (RGB).
- **Usage:** Renders physical rainbow-like color interference across the oil slick surface based on view angle and wandering film thickness, replacing ad-hoc hue rotations with wave-optics interference.

#### 4. `KHR_materials_clearcoat` — Second-Layer Dielectric Specular Lobe

- **File:** `packages/engine/src/core/materials/surface/StandardMaterial.ts`, `packages/engine/src/core/materials/surface/shaders/Standard.frag.glsl`, `packages/engine/src/loaders/gltf/GltfMaterialParser.ts`
- **Authors/Gurus:** Brent Burley (Disney Principled BRDF 2012), Sébastien Lagarde (Frostbite), Khronos 3D Formats Working Group
- **Source:**
  - [Khronos glTF Extension: `KHR_materials_clearcoat`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_clearcoat)
  - [Burley: "Physically-Based Shading at Disney" (SIGGRAPH 2012)](https://disneyanimation.com/publications/physically-based-shading-at-disney/)
- **Formulas:**
  - Clearcoat Fresnel: $F_{cc} = F_{\text{Schlick}}(N_{cc} \cdot V, F_0 = 0.04) \cdot \text{clearcoatFactor}$
  - Kelemen / Schlick-GGX visibility and GGX distribution: $D_{cc} = D_{\text{GGX}}(N_{cc} \cdot H, \alpha_{cc})$
  - Base layer attenuation: $(1 - F_{cc})$ energy conservation.
- **Pipeline Implementation:** WebGL2 supports an independent clearcoat normal map ($N_{cc}$ via `light_calc_pbr.frag.glsl`), while WebGPU evaluates clearcoat using the base surface normal ($N_{cc} = N$).
- **Usage:** Simulates a transparent, smooth dielectric coating over a rough or colored substrate (e.g. car paint, carbon fiber, lacquered furniture, wet stones).

#### 5. `KHR_materials_sheen` — Charlie Microfiber Grazing-Angle Specular BRDF

- **File:** `packages/engine/src/core/materials/surface/StandardMaterial.ts`, `packages/engine/src/core/materials/surface/shaders/Standard.frag.glsl`, `packages/engine/src/loaders/gltf/GltfMaterialParser.ts`
- **Authors/Gurus:** Stephen Estevez & Toshiya Hachisuka (Sony Pictures Imageworks 2017), Aleksandr Neubelt & Matt Pettineo (Ready at Dawn 2013), Khronos 3D Formats Working Group
- **Source:**
  - [Khronos glTF Extension: `KHR_materials_sheen`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_sheen)
  - [Estevez & Kulla: "Production Friendly Microfacet Sheen BRDF" (2017)](https://blog.selfshadow.com/publications/s2017-shading-course/imageworks/s2017_pbs_imageworks_sheen.pdf)
- **Formulas:**
  - Charlie distribution: $D_{\text{Charlie}}(\theta_h) = \frac{2 + \frac{1}{\alpha}}{2\pi} (1 - \cos^2 \theta_h)^{\frac{1}{2\alpha}}$
  - Neubelt shadowing/masking: $V_{\text{Neubelt}} = \frac{1}{4(N \cdot L + N \cdot V - N \cdot L \cdot N \cdot V)}$
- **Usage:** Renders soft, fuzzy grazing-angle highlights on cloth, velvet, silk, and woven textiles without unnatural metallic specular flares.

#### 6. `KHR_materials_transmission` — Specular Light Transmission & Screen-Space Refraction

- **File:** `packages/engine/src/core/materials/glass/GlassMaterial.ts`, `packages/engine/src/core/materials/surface/StandardMaterial.ts`, `packages/engine/src/loaders/gltf/GltfMaterialParser.ts`
- **Authors/Gurus:** Bruce Walter, Stephen R. Marschner, Hongsong Li, Kenneth E. Torrance (2007), Khronos 3D Formats Working Group
- **Source:**
  - [Khronos glTF Extension: `KHR_materials_transmission`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_transmission)
  - [Walter et al.: "Microfacet Models for Refraction through Rough Surfaces" (EGSR 2007)](https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf)
- **Formulas:**
  - Transmission ratio: $T = 1.0 - F$
  - Refraction direction: $\vec{R} = \text{refract}(-\vec{V}, \vec{N}, \frac{1}{\eta})$
- **Usage:** Allows thin and thick glass-like dielectric surfaces to transmit background light while preserving PBR specular highlights and roughness.

#### 7. `KHR_materials_variants` — Configurable Material Variants

- **File:** `packages/engine/src/loaders/GltfLoader.ts`, `packages/engine/src/loaders/gltf/GltfVariants.ts`, `packages/engine/src/loaders/gltf/types.ts`
- **Authors/Gurus:** Gary Hsu (Microsoft), Don McCurdy (Google), Khronos 3D Formats Working Group
- **Source:** [Khronos glTF Extension: `KHR_materials_variants`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_variants)
- **Usage:** Defines multiple alternate material choices per mesh primitive (e.g. product color/material configurators in 3D e-commerce and gaming) and switches them dynamically at runtime via `GltfVariants.selectVariant()` or loader options.

### glTF 2.0 Loader & Data Compression Extensions

#### 1. `KHR_draco_mesh_compression` — Google Draco Geometry Compression

- **File:** `packages/gltf-extensions/src/draco/KhrDracoMeshCompression.ts`, `packages/gltf-extensions/src/draco/DracoDecoder.ts`
- **Authors/Gurus:** Frank Galligan, Ondrej Stava, Jamieson Brettle et al. (Google Chrome / VR Draco Team), Khronos 3D Formats Working Group
- **Source:**
  - [Google Draco 3D Data Compression Library](https://github.com/google/draco)
  - [Khronos glTF Extension: `KHR_draco_mesh_compression`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_draco_mesh_compression)
- **Usage:** Decompresses lossy/lossless Draco bitstreams containing quantized vertex positions, normals, UV coordinates, and triangle connectivity. Reduces raw 3D asset transfer sizes over the network by up to 80-90%.

#### 2. `KHR_texture_basisu` — Basis Universal / KTX2 GPU Texture Compression

- **File:** `packages/gltf-extensions/src/basisu/KhrTextureBasisu.ts`, `packages/gltf-extensions/src/basisu/BasisTranscoder.ts`
- **Authors/Gurus:** Rich Geldreich & Stephanie Hurlburt (Binomial LLC), Khronos 3D Formats Working Group
- **Source:**
  - [Basis Universal Supercompressed GPU Texture Codec](https://github.com/BinomialLLC/basis_universal)
  - [Khronos glTF Extension: `KHR_texture_basisu`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_texture_basisu)
- **Usage:** Transcodes KTX2 / Basis Universal compressed textures directly into GPU-native block compression formats (BC7, ASTC, ETC2, DXT) or RGBA8 fallback, dramatically cutting runtime VRAM memory consumption and GPU texture bandwidth.

### Metallic-Roughness Sphere Grid (PBR Reference Test)

- **File:** `apps/showcases/35/showcase.ts`
- **Authors/Gurus:** Khronos Group (glTF Sample Viewer / glTF-Sample-Assets contributors)
- **Source:** [Khronos glTF-Sample-Assets: "MetalRoughSpheres"](https://github.com/KhronosGroup/glTF-Sample-Assets)
- **Usage:** The de-facto industry reference scene for validating a metallic-roughness PBR implementation: a grid of identical spheres with metallic varying along one axis and roughness along the other, under a fixed base color. Showcase 35 reproduces this layout with `StandardMaterial` to visually cross-check PBR shading consistency across the WebGL1/WebGL2/WebGPU renderers via `?rendererType=`.

### Real-Time Rendering Pipeline & State Minimization

- **Authors/Gurus:** Tomas Akenine-Möller, Eric Haines, Naty Hoffman
- **Source:** [Real-Time Rendering (RTR)](https://www.realtimerendering.com/)
- **Usage:** The bible for real-time rendering. Fundamental concepts such as Opaque vs. Transparent rendering order, back-to-front sorting, and state minimization (minimizing draw calls by efficiently grouping by pass -> shader -> material) are derived from here.

### Percentage-Closer Filtering (PCF) for Soft Shadows

- **File:** `packages/engine/src/renderers/WebGL2/WebGL2Renderer.ts`, `packages/engine/src/core/materials/surface/shaders/Phong.frag.glsl`, `packages/engine/src/core/materials/surface/shaders/Standard.frag.glsl`
- **Authors/Gurus:** William T. Reeves, David H. Salesin, and Robert L. Cook (1987)
- **Source:** [Rendering antialiased shadows with depth maps (SIGGRAPH 1987)](https://dl.acm.org/doi/10.1145/37402.37425)
- **Usage:** The foundational technique for generating soft edges on shadow maps. By sampling the depth map multiple times around the target fragment and averaging the binary visibility results, jagged aliased shadows become smoothly blurred (especially when combined with hardware `sampler2DShadow`).

### Percentage-Closer Soft Shadows (PCSS)

- **File:** `packages/engine/src/renderers/shaders/source/web_gl2/chunks/light_calc.frag.glsl`, `packages/engine/src/renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl`, `packages/engine/src/renderers/shaders/source/web_gpu/chunks/pbr_math.wgsl`, `packages/engine/src/renderers/shaders/source/web_gpu/chunks/lighting.wgsl`, `packages/engine/src/renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl`, `packages/engine/src/renderers/WebGL2/WebGL2Renderer.ts`
- **Authors/Gurus:** Randima Fernando (NVIDIA)
- **Source:** ["Percentage-Closer Soft Shadows"](https://download.nvidia.com/developer/presentations/2005/I3D/I3D_05_Percentage_Closer_Soft_Shadows.pdf) — SIGGRAPH 2005
- **Usage:** Upgrades the directional-light PCF pass to a variable-radius filter: a blocker search over a small ring of raw (non-comparison) depth reads estimates how far the average occluder sits below the receiver, which then scales the PCF sample radius so contact shadows stay sharp while shadows further from their caster soften — contact-hardening soft shadows from a single shadow map, no extra light samples or pre-pass needed.

### Clustered / Tiled Forward+ Lighting (Light Culling)

- **File:** `packages/engine/src/renderers/passes/WebGLClusterCullPass.ts`, `packages/engine/src/renderers/passes/ClusterCullPassGPU.ts`, `packages/engine/src/renderers/shaders/source/web_gl2/chunks/lights.frag.glsl`, `packages/engine/src/renderers/shaders/source/web_gpu/chunks/lighting.wgsl`; architecture decisions in `docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md`
- **Authors/Gurus:** Emil Persson (humus.name); comparative research against three.js `ClusteredLighting`, Godot renderer docs and Babylon.js clustered lighting (see `docs/research/aaa-engine-techniques.md`)
- **Source:**
  - [Practical Clustered Shading (Emil Persson)](https://www.humus.name/Articles/PracticalClusteredShading.pdf)
  - [A Primer on Efficient Rendering & Clustered Shading (aortiz.me)](http://www.aortiz.me/2018/12/21/CG.html)
- **Usage:** Divides the view frustum into a fixed 3D cluster grid and pre-computes per-cluster light lists before the forward pass, so a fragment only ever evaluates the few lights whose coverage range touches its cluster instead of iterating all scene lights. WebGPU runs compute-based light culling on the shared `ClusterGrid` (`ClusterCullPassGPU`); WebGL2 falls back to CPU-side culling (`WebGLClusterCullPass`, fixed per-cluster capacity, no atomics, packing into two textures within the 16-texture-unit limit) using `lightClusterCoverage()` to limit the lights evaluated in `lights.frag.glsl`/`lighting.wgsl`.

### Image-Space Horizon-Based Ambient Occlusion (HBAO)

- **File:** `packages/engine/src/renderers/post/shaders/AO.frag.glsl`, `packages/engine/src/renderers/post/shaders/AO.frag.wgsl`, `packages/engine/src/renderers/post/passes/AOPassGL.ts`, `packages/engine/src/renderers/post/passes/AOPassGPU.ts`, `packages/engine/src/renderers/post/elements/HbaoElement.ts`
- **Authors/Gurus:** Louis Bavoil, Miguel Sainz, Rouslan Dimitrov (NVIDIA)
- **Source:** ["Image-Space Horizon-Based Ambient Occlusion"](https://developer.download.nvidia.com/presentations/2008/SIGGRAPH/HBAO_SIG08b.pdf) — SIGGRAPH 2008
- **Usage:** The reference for our screen-space ambient occlusion pass (`HbaoElement` in code) — marching a handful of screen-space directions per pixel and taking `dot(directionToSample, normal)` as the sine of that direction's horizon elevation angle, then darkening by how much of the hemisphere those horizons block. Simplified relative to the paper: a single max-sample per direction instead of true horizon-angle accumulation via the sine-integration formula, and no per-pixel direction rotation or bilateral blur pass to turn banding into noise. The march distance follows a world-space radius: `radius * projScaleY * (height / 2) / linearZ` is the radius projected to pixels (clamped to 4..128 px, four steps), so `radius` keeps its meaning across resolutions and distances (`AO.frag.glsl`, `AO.frag.wgsl`). The normal is always the flat geometric one reconstructed from depth with neighbour selection (Turánszki 2019, see the normal-reconstruction entry); the normal buffer is deliberately not used because it carries the receiver's normal map while the horizon test marches against flat depth, which over-darkens.

### Octahedral Normal Encoding

- **File:** `packages/engine/src/renderers/WebGPU/managers/NormalOutputWrapper.ts`, `packages/engine/src/renderers/WebGL2/managers/NormalOutputWrapperGL.ts`, `packages/engine/src/renderers/shaders/source/web_gpu/chunks/structs.wgsl`, `packages/engine/src/core/materials/surface/shaders/Decal.frag.wgsl`, `packages/engine/src/core/materials/surface/shaders/Decal.frag.glsl`, `packages/engine/src/renderers/post/shaders/AO.frag.wgsl`, `packages/engine/src/renderers/post/shaders/AO.frag.glsl`; decision in `docs/adr/0028-thin-normal-buffer-mrt.md`
- **Authors/Gurus:** Zina H. Cigolle, Sam Donow, Daniel Evangelakos, Michael Mara, Morgan McGuire, Quirin Meyer
- **Source:** [A Survey of Efficient Representations for Independent Unit Vectors (JCGT 2014)](https://jcgt.org/published/0003/02/01/)
- **Usage:** The thin normal buffer stores the world-space shading normal as two `rg16float` channels (`octEncode`) instead of three, so the second render target of the main pass costs 4 bytes per pixel. Decals and the AO pass decode it with `octDecode`. Variant: the paper's "oct" in its fast (non-precise) form with `signNotZero` folding and a final `normalize` on decode (Listings 1 and 2); the paper evaluates it for snorm storage (oct16 = snorm8x2, oct32 = snorm16x2), so the `rg16float` storage and its precision are our own adaptation, not covered by the paper's error tables; the clear value (-2, -2) lies outside the octahedron's [-1, 1] range and marks "no normal".

### Reoriented Normal Mapping (Detail Normal Blending)

- **File:** `packages/engine/src/core/materials/surface/shaders/Decal.frag.wgsl`, `packages/engine/src/core/materials/surface/shaders/Decal.frag.glsl`; decision in `docs/adr/0028-thin-normal-buffer-mrt.md`
- **Authors/Gurus:** Colin Barré-Brisebois, Stephen Hill
- **Source:** [Blending in Detail (2012)](https://blog.selfshadow.com/publications/blending-in-detail/)
- **Usage:** The inspiration for letting a decal's tangent-space normal map ride on the receiver's own (already normal-mapped) normal from the normal buffer instead of on the bare geometry normal. Note: the decal shaders do not implement RNM and are not RNM-equivalent. RNM (the article) rotates the detail normal by the shortest-arc rotation from the geometric normal [0,0,1] onto the base normal, `r = normalize(t*dot(t,u) - u*t.z)`; the article does not mention decals. The decal shaders instead build a tangent frame around the receiver normal (`tangent` orthogonalised against `baseNormal`, seeded from the decal's local X axis) and apply the decal normal map in that frame.

### Screen-Space / Forward Decals via Depth Unprojection

- **File:** `packages/engine/src/core/materials/surface/shaders/Decal.frag.wgsl`, `packages/engine/src/core/materials/surface/shaders/Decal.frag.glsl`, `packages/engine/src/core/decals/DecalMath.ts`, `packages/engine/src/core/objects/Decal.ts`, `packages/engine/src/core/materials/surface/DecalMaterial.ts`
- **Authors/Gurus:** Turánszki János (Wicked Engine); Unity URP and Unreal Engine decal documentation as the industry benchmark
- **Source:**
  - [Forward decal rendering (Wicked Engine, 2017)](https://web.archive.org/web/2020/https://wickedengine.net/2017/10/forward-decal-rendering/)
  - [Decal Renderer Feature reference (Unity URP manual)](https://docs.unity3d.com/Manual/urp/renderer-feature-decal-reference.html)
  - [Decal Actors (Unreal Engine documentation)](https://dev.epicgames.com/documentation/en-us/unreal-engine/decal-actors-in-unreal-engine) and [Decal Materials](https://dev.epicgames.com/documentation/en-us/unreal-engine/decal-materials-in-unreal-engine) (the cited overview page `decals-in-unreal-engine` is only a link hub)
- **Usage:** Our technique is the deferred-style box decal (Unity URP "Screen Space", Unreal deferred decals): a unit box drawn after the opaque pass (back faces only, no depth test or write) whose fragment shader unprojects the already-rendered opaque depth into box space through `clipToBox = inverse(world) * invViewProj` (`computeClipToBox`) and discards everything outside [-0.5, 0.5]; the box x/z become the UV, local +Y is the surface normal. Because the engine has no G-buffer, the decal is lit forward on top of the opaque image (clustered lights, shadows) and blends its own normal onto the buffer normal. No decals on transparents, as in Unity (its decal manual lists "The decal projection does not work on transparent surfaces" as a limitation; Godot and Unreal not checked, UNVERIFIED).
  - **What the Wicked Engine article is and is not:** it describes this box-reads-the-G-buffer approach only as the simple *deferred* method and proposes a different one: decals inserted into the Forward+ light tiles and evaluated inside every object's own shader before the lights (so they can change normal/roughness and also hit transparents), sorted per tile. We do not implement that. We take two points from it: (1) overlapping decals need a strict, deterministic order or they flicker (ours: the static `compareDecals`, priority, then volume, then creation order); (2) the mip-mapping update credited to MJP: feed `SampleGrad` with decal-space derivatives of the surface position instead of implicit derivatives, which are wrong in branching code and across depth discontinuities (ours: the three-tap box-space differences in `g_uvGradX/Y`). The author notes this is slightly blurrier than hardware mips and suggests a constant LOD bias; we have not applied one yet.

### Normal Reconstruction from Depth with Neighbour Selection

- **File:** `packages/engine/src/core/materials/surface/shaders/Decal.frag.wgsl`, `packages/engine/src/core/materials/surface/shaders/Decal.frag.glsl`, `packages/engine/src/renderers/post/shaders/AO.frag.wgsl`, `packages/engine/src/renderers/post/shaders/AO.frag.glsl`
- **Authors/Gurus:** Turánszki János (Wicked Engine)
- **Source:** [Improved normal reconstruction from depth (Wicked Engine, 2019)](https://web.archive.org/web/2020/https://wickedengine.net/2019/09/improved-normal-reconstruction-from-depth/)
- **Usage:** In the decal shaders (fallback when `quality.normalBuffer` is off): for each axis the neighbour (forward or backward) whose depth is closer to the centre pixel is used for the finite difference (`decalNeighbourDelta`), so the tangent vectors never reach across a silhouette; sky neighbours count as infinitely far. The article compares view-space Z (linear distance); we compare the raw depth values, which is monotonic but not identical. The same three taps give the UV gradients for `textureSampleGrad`. The degenerate-cross-product test is relative to the edge lengths, not absolute (see the HBAO finding in ADR 0028).
- **Also used by HBAO:** `AO.frag.wgsl/glsl` use the same per-axis neighbour selection (`neighbourViewPos`). The article's own motivation is the flat geometric normal for SSAO: a normal-mapped normal (such as the one in the normal buffer) lets horizon rays dip below the flat depth surface and over-darkens, which is why HBAO does not read the normal buffer.

### Thin Normal Buffer instead of G-Buffer

- **File:** `packages/engine/src/renderers/WebGPU/managers/NormalOutputWrapper.ts`, `packages/engine/src/renderers/WebGL2/managers/NormalOutputWrapperGL.ts`, `packages/engine/src/renderers/shaders/source/web_gpu/chunks/structs.wgsl`; decision in `docs/adr/0028-thin-normal-buffer-mrt.md`
- **Authors/Gurus:** Unity Technologies (URP DepthNormals prepass); Unity manual for the "no decals on transparents" limitation (Godot and Unreal UNVERIFIED)
- **Source:** [Decal Renderer Feature reference, DBuffer vs. Screen Space (Unity URP manual)](https://docs.unity3d.com/Manual/urp/renderer-feature-decal-reference.html)
- **Usage:** The engine stays forward (clustered lighting) and adds only a thin second render target for the world-space shading normal, written by the main pass through a shader wrapper (`fs` renamed to `fs_color` plus an `fs` that also writes `@location(1)`), so material shaders stay untouched. Transparents and skybox run with a masked write (`writeMask: 0`). Unity documents that its DBuffer technique (and the Rendering Layers option) needs a DepthNormal prepass, which is less efficient on tile-based GPUs, and recommends its Screen Space technique for such mobile GPUs; that is about a separate prepass, not our MRT normal target, so it is only an analogy for why mobile needs measuring.

### Normal-Offset Shadow Bias

- **File:** `packages/engine/src/renderers/shaders/source/web_gl2/chunks/light_calc.frag.glsl`, `packages/engine/src/renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl`, `packages/engine/src/renderers/shaders/source/web_gl2/chunks/base_vertex_main.vert.glsl`, `packages/engine/src/renderers/shaders/source/web_gpu/chunks/lighting.wgsl`, `packages/engine/src/renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl`
- **Authors/Gurus:** Jasper Flick (Catlike Coding)
- **Source:** [Directional Shadows (Custom SRP) — Catlike Coding](https://catlikecoding.com/unity/tutorials/custom-srp/directional-shadows/)
- **Usage:** The reference for offsetting the shadow-map sample position along the surface normal (scaled by NdotL) before the light-space transform, instead of only biasing the compared depth value. Separates the fix for shadow acne from depth manipulation, reducing both acne and peter-panning simultaneously across our directional and spot light shadows.

### Temporal Supersampling / TAA (Jitter + History Blend)

- **File:** `packages/engine/src/renderers/post/shaders/HistoryBlend.frag.glsl`, `packages/engine/src/renderers/post/shaders/HistoryBlend.frag.wgsl`, `packages/engine/src/renderers/post/passes/HistoryBlendPassGL.ts`, `packages/engine/src/renderers/post/passes/HistoryBlendPassGPU.ts`, `packages/engine/src/renderers/post/elements/TaaElement.ts`, `packages/engine/src/core/cameras/Camera.ts`, `packages/engine/src/core/SmallWorldMachine.ts`
- **Authors/Gurus:** Brian Karis (Epic Games)
- **Source:** ["High-Quality Temporal Supersampling"](http://advances.realtimerendering.com/s2014/#_HIGH-QUALITY_TEMPORAL_SUPERSAMPLING) — SIGGRAPH 2014, Advances in Real-Time Rendering
- **Usage:** The canonical reference for sub-pixel camera jitter (we use a Halton(2,3) sequence, cycling 16 samples) combined with a history buffer accumulated across frames to reconstruct anti-aliased detail beyond a single frame's sample rate. We implement only the simplified half of the technique — jitter plus an exponential history blend, no motion-vector reprojection or neighborhood clamping — which smooths edges in static/slow scenes but visibly ghosts on fast movement, an accepted trade-off documented in `docs/research/aaa-engine-techniques.md`.

### Accumulation Buffer (Motion Trail / Afterimage Effect)

- **File:** `packages/engine/src/renderers/post/passes/HistoryBlendPassGL.ts`, `packages/engine/src/renderers/post/passes/HistoryBlendPassGPU.ts`, `packages/engine/src/renderers/post/elements/MotionTrailElement.ts`
- **Authors/Gurus:** Paul Haeberli, Kurt Akeley (SGI)
- **Source:** ["The Accumulation Buffer: Hardware Support for High-Quality Rendering"](https://graphics.stanford.edu/courses/cs248-02/haeberli-akeley-accumulation-buffer-sig90.pdf) — SIGGRAPH 1990
- **Usage:** The original paper generalizing "blend this frame with an accumulated buffer of prior frames" beyond anti-aliasing to motion blur, depth-of-field, and soft shadows — the same family of technique as our TAA history blend above, just aimed at a deliberately visible result instead of an invisible one. `MotionTrailElement` reuses the identical `HistoryBlendPassGL`/`HistoryBlendPassGPU` infrastructure as TAA (its own separate instance/history buffer, no camera jitter), tuned with a much higher feedback value so fast-moving objects intentionally leave a ghost/afterimage trail — an honest stylistic effect, not a mislabeled anti-aliasing technique.

### Dual Kawase Bloom (Post-Processing)

- **File:** `packages/engine/src/renderers/post/shaders/BloomDownsample.frag.wgsl`, `packages/engine/src/renderers/post/shaders/BloomUpsample.frag.wgsl`, `packages/engine/src/renderers/passes/PostProcessPass.ts`
- **Authors/Gurus:** Masaki Kawase (2003) and Marius Bjørge (2014)
- **Source:** [Bandwidth-Efficient Rendering (ARM)](https://community.arm.com/cfs-file/__key/communityserver-blogs-components-weblogfiles/00-00-00-20-66/siggraph2015_2D00_mmg_2D00_marius_2D00_notes.pdf)
- **Usage:** Used as the high-performance WebGPU bloom filter. By downsampling using a 13-tap filter and upsampling using a 9-tap tent filter across a mip-chain, this technique produces extremely soft, high-quality glows spanning large screen areas at a fraction of the cost of a traditional Gaussian blur.

### Linear Color Space & Gamma Correctness

- **Authors/Gurus:** Naty Hoffman, Sebastien Lagarde (Frostbite Engine)
- **Source:** SIGGRAPH Presentations & "Moving Frostbite to Physically Based Rendering"
- **Usage:** The law of linear color space: All color textures (albedo) must be converted to linear space (sRGB -> Linear) in the shader before lighting calculations. After all lighting calculations, the result must be converted back to sRGB space (Gamma Correction) before being output to the screen.

### ACES Filmic Tone Mapping (Narkowicz Analytic Fit)

- **File:** `packages/engine/src/renderers/post/shaders/PostProcess.frag.glsl`, `packages/engine/src/renderers/post/shaders/PostProcess.frag.wgsl`, `packages/engine/src/renderers/post/shaders/PostProcess100.frag.glsl`, `packages/engine/src/renderers/post/elements/ToneMappingElement.ts`
- **Authors/Gurus:** Krzysztof Narkowicz (2015), Academy of Motion Picture Arts and Sciences (AMPAS)
- **Source:** [ACES Filmic Tone Mapping Curve (Krzysztof Narkowicz)](https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/)
- **Formulas:**
  - $f(x) = \text{saturate}\left(\frac{x(a x + b)}{x(c x + d) + e}\right)$ with $a = 2.51$, $b = 0.03$, $c = 2.43$, $d = 0.59$, $e = 0.14$.
- **Usage:** High-performance, closed-form analytic approximation of the ACES S-curve tone mapping operator. Used across all post-processing passes to map high-dynamic-range HDR radiance to standard display ranges with filmic contrast, preserving hue consistency and smoothly compressing highlights without hard white clamping.

### Data-Oriented Design (DOD)

- **Authors/Gurus:** Mike Acton (Insomniac Games, Unity)
- **Usage:** The architectural guideline that data structures (like TypedArrays and flat arrays) should be preferred over OOP and deeply nested objects to avoid CPU cache misses during the rendering loop.

### Component & Behavior Architecture

- **Concepts:** Component-based programming, Unity Behaviors.
- **Usage:** Small World Machine uses a strict behavior-driven architecture where logical components (`Behavior`) are attached directly to nodes like `Object3D` or `Camera` via `.addBehavior()`. This eliminates rigid inheritance structures for controllers (like `OrbitController` or `FPSController`), allowing them to be dynamically composed at runtime.

### Asynchronous Asset Loading

- **Usage:** Provides unified static factories like `Texture.fromUrl()` with promise-based loading. This ensures asynchronous image decoding integrates smoothly into the synchronous render loop, often falling back to a placeholder pixel until the GPU upload is fully complete.

### AAA Rendering Techniques (Research Sources, 2026-09-27)

- **Source:** [AAA-Rendering-Techniken — Wunschliste & Bestand (`docs/research/aaa-engine-techniques.md`)](https://github.com/rottensteiner-stefan/small-world-machine/blob/main/docs/research/aaa-engine-techniques.md)
- **Authors/Gurus (named in research):** Emil Persson (humus.name, clustered shading), Sébastien Hillaire & Frostbite (volumetric rendering, SIGGRAPH 2015), "therealmjp" (shadow-map sampling), Alex Tardif (cascaded shadow maps with soft shadows), XeGTAO/Intel GameDev (ground-truth AO), Valdemir D. (game feel on the web), plus Unreal/Unity/Godot/Babylon.js/three.js documentation.
- **Usage:** Consolidated research on forward lighting, shadows, occlusion culling, volumetric fog and post-processing compared against industry engines. Verified against the live engine on 2026-09-27: implemented items are fixed bestand (clustered lighting, PCSS, CSM polishing, HBAO, simplified TAA, HZB occlusion culling, game feel), remaining items are a maintained wishlist (froxel volumetric fog, full GTAO, LOD, full TAA). The full source list lives in the document's "Quellen" appendix.

### Schlick Phase Function (Henyey-Greenstein Approximation)

- **File:** `packages/engine/src/renderers/post/shaders/LightShafts.frag.glsl`, `packages/engine/src/renderers/post/shaders/LightShafts.frag.wgsl`
- **Authors/Gurus:** Christophe Schlick (1993, *A customizable reflectance model for everyday rendering*)
- **Formulas:**
  - Parameter remapping: $k \approx 1.55 g - 0.55 g^3$
  - Phase function: $p(\theta, k) = \frac{1 - k^2}{4\pi (1 - k \cos\theta)^2}$
- **Usage:** Replaces the computationally heavy Henyey-Greenstein phase function (which requires expensive `pow(..., 1.5)` evaluations per raymarching step). Matches Henyey-Greenstein forward scattering behavior within 10% on atmospheric aerosols ($g \in [0.6, 0.8]$) using solely basic arithmetic.

### Interleaved Gradient Noise (IGN)

- **File:** `packages/engine/src/renderers/post/shaders/LightShafts.frag.glsl`, `packages/engine/src/renderers/post/shaders/LightShafts.frag.wgsl`
- **Authors/Gurus:** Jorge Jimenez (2014, Activision Blizzard, *Next Generation Post Processing in Call of Duty: Advanced Warfare*, SIGGRAPH 2014)
- **Formulas:**
  - $\text{IGN}(x, y) = \text{fract}\left(52.9829189 \cdot \text{fract}(0.06711056 x + 0.00583715 y)\right)$
- **Usage:** High-frequency, deterministic spatio-temporal dither noise used to jitter raymarching starting offsets per pixel. Converts regular step banding artifacts into high-frequency noise that easily blends out with cross-bilateral upsampling and TAA without temporal crawling.

### Depth-Aware Cross-Bilateral Upsampling for Volumetrics

- **File:** `packages/engine/src/renderers/post/shaders/LightShaftsBilateral.frag.glsl`, `packages/engine/src/renderers/post/shaders/LightShaftsBilateral.frag.wgsl`
- **Authors/Gurus:** Johannes Kopf et al. (2007, *Joint Bilateral Upsampling*), Bart Wronski (2014, *Volumetric Fog: Unified, compute shader based solution to atmospheric scattering*, Crytek)
- **Formulas:**
  - Depth weight: $w_i = \exp\left(-\frac{|\Delta z_i|}{\tau}\right)$
  - Edge fallback: If $\sum w_i < \epsilon$, select nearest depth sample: $i_{\text{nearest}} = \arg\min_i |\Delta z_i|$
- **Usage:** Upsamples half-resolution volumetric scattering to full resolution without causing light-bleeding or bright halos across foreground object silhouettes. When sampling across depth discontinuities, foreground pixels reject background fog taps and fall back to the closest depth sample.

## Graphics APIs (WebGPU / WebGL)

### W3C WebGPU Specification

- **Source:** [WebGPU W3C Working Draft](https://www.w3.org/TR/webgpu/)
- **Usage:** The absolute single source of truth for WebGPU mechanisms. It establishes the strict validation rules and explicit resource requirements (e.g., why `GPUTextureUsage` must be exactly defined before an operation like `copyTextureToTexture` can be executed).

### WebGPU Fundamentals

- **Authors/Gurus:** Gregg Tavares
- **Source:** [WebGPU Fundamentals](https://webgpufundamentals.org/)
- **Usage:** An excellent source for understanding the conceptual difference between implicit state (WebGL) and explicit pipelines/layouts (WebGPU). Serves as a template for best practices around texture bindings, memory alignments (Uniforms/UBOs), and the safe handling of render passes.

### Tour of WebGPU

- **Authors/Gurus:** Alain Galvan
- **Source:** [Raw WebGPU (Tour of WebGPU)](https://alain.xyz/blog/raw-webgpu)
- **Usage:** Serves as an important architectural reference for understanding bind group layouts, command buffer encoding, and mapping concepts like Vulkan/Metal/D3D12 to the web standard.

## Image Processing & Texture Generation

### Perlin Noise (2D Noise)

- **File:** `public/tools/splatter-gen.html` (as well as engine noise in `packages/engine/src/utils/Noise.ts`)
- **Authors/Gurus:** Ken Perlin (1985 / Improved Noise 2002)
- **Source:** [Making Noise (Ken Perlin)](https://mrl.cs.nyu.edu/~perlin/doc/oscar.html)
- **Usage:** 2D Perlin noise is used to calculate soft, organic disturbances and ripples on circles (Noise Warp). This creates natural-looking splash edges for liquids and mud splatters from simple geometric shapes.

### Liquid Metaballs (Liquid Blobs)

- **File:** `public/tools/splatter-gen.html`
- **Authors/Gurus:** James Blinn (1982)
- **Usage:** The physical concept of metaballs describes organically merging spherical surfaces. In the splatter generator, we draw multiple circles on an offscreen canvas, blur them (density field), and cut them off sharply using a threshold (alpha thresholding). This allows adjacent drops to merge into each other like liquids.

### Box-Blur

- **File:** `public/tools/splatter-gen.html`, `public/tools/pbr-gen.html`
- **Usage:** To simulate Gaussian blur on pixel arrays, a two-stage, linear box-blur (horizontal and vertical pass) is implemented in pure JavaScript. This enables extremely fast real-time image smoothing with O(N) complexity (independent of the radius).

### Normal Map Generation (Sobel Filter)

- **File:** `public/tools/pbr-gen.html`
- **Authors/Gurus:** Irwin Sobel (1968)
- **Source:** Sobel operators for image segmentation / edge detection.
- **Usage:** The normal map is generated by calculating the derivatives of the height map in the X and Y directions using a discrete 3x3 Sobel convolution kernel. The normal vector is calculated from n = normalize(-dx _ s, -dy _ s, 1.0) and encoded into RGB color values in the range [0, 255].

### Sigmoidal Contrast (Specular S-Curves)

- **File:** `public/tools/pbr-gen.html`
- **Source:** ImageMagick `-sigmoidal-contrast` function.
- **Usage:** To raise highlights softly but with high contrast, a sigmoidal curve function f(x) = 1 / (1 + exp(-c \* (x - t))) is applied to the brightness values. This prevents hard clipping and simulates more realistic specular behavior.

### Laplacian Crevice Cavity Mapping (Ambient Occlusion)

- **File:** `public/tools/pbr-gen.html`
- **Source:** Discrete Laplace filters / edge operators.
- **Usage:** To approximate local self-shadowing (ambient occlusion / crevices), the curvature (second derivative) of the height values is calculated using a Laplace kernel (4 \* center - sum(neighbors)). This highlights depressions and crevices, which are multiplied with a blurred macro height map.

### Planckian Locus & Thermal Blackbody Radiation

- **File:** `packages/engine/src/core/colors/Color.ts`, `packages/vfx-extras/src/affectors/ThermalCoolingAffector.ts`
- **Authors/Gurus:** Max Planck (1900), Tanner Helland (2012)
- **Source:** [Tanner Helland: "How to Convert Temperature (K) to RGB: Algorithm and Code"](https://tannerhelland.com/2012/09/18/subtractive-color-temperature-algorithm.html)
- **Usage:** Used in `Color.fromTemperature()` and `Color.blackbody()` to compute physically accurate thermal radiation spectra, star temperatures, and glowing accretion disk colors across temperature gradients from $1000\,\text{K}$ to $40000\,\text{K}$.

## Assets & Fonts


### Damaged Helmet (glTF PBR Sample Model)

- **File:** `apps/showcases/13/assets/DamagedHelmet.glb`, `apps/showcases/13/assets/LICENSE.md`, `apps/showcases/13/assets/README.md`, `apps/showcases/13/assets/metadata.json`
- **Authors/Gurus:** theblueturtle_ (original model), ctxwing (rebuild & conversion to glTF)
- **Source:** [Khronos glTF-Sample-Assets: "DamagedHelmet"](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/DamagedHelmet) (glTF-Binary variant)
- **License:** © 2016 theblueturtle_, [CC-BY-NC-4.0](https://creativecommons.org/licenses/by-nc/4.0/legalcode) (earlier version of the model); © 2018 ctxwing, [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/legalcode) (rebuild/conversion). Both licenses apply combined — non-commercial use with attribution.
- **Usage:** The de-facto industry-standard glTF 2.0 PBR reference model (full metallic-roughness workflow with albedo, normal, ORM, and emissive maps) used in Showcase 13 to validate `GltfLoader` and PBR shading against a known-good asset across all three renderers.

### Glass Broken Window (glTF Transmission Sample Model)

- **File:** `apps/showcases/36/assets/GlassBrokenWindow.glb`, `apps/showcases/36/assets/LICENSE.md`, `apps/showcases/36/assets/README.md`, `apps/showcases/36/assets/metadata.json`
- **Authors/Gurus:** Wayfair / Eric Chadwick
- **Source:** [Khronos glTF-Sample-Assets: "GlassBrokenWindow"](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/GlassBrokenWindow) (glTF-Binary variant)
- **License:** © 2023 Wayfair, [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/legalcode).
- **Usage:** The official Khronos reference asset for combining `KHR_materials_transmission` (real glass refraction) with `alphaMode:"MASK"` (jagged cutout holes for the missing shards). Used in Showcase 36 to validate `GltfLoader`'s alpha-tested transparent material path against a known-good glTF sample across all three renderers.

### Race Future (Hover Car Model, Showcase 30)

- **File:** `apps/showcases/30/assets/car/race-future.glb`, `apps/showcases/30/assets/car/Textures/colormap.png`, `apps/showcases/30/assets/car/License.txt`
- **Authors/Gurus:** Kenney (www.kenney.nl)
- **Source:** [Kenney: "Car Kit"](https://kenney.nl/assets/car-kit) (GLB format)
- **License:** [CC0 (Creative Commons Zero)](https://creativecommons.org/publicdomain/zero/1.0/) — public domain, no attribution required (credited here anyway).
- **Usage:** Replaces Showcase 30's original hand-built box-primitive "hover car" placeholder with a real low-poly vehicle mesh, re-skinned with the showcase's own neon-emissive materials.

### Wet Asphalt & Cyberpunk Night Sky (Showcase 30 Textures)

- **File:** `apps/showcases/30/assets/wet_asphalt_diffuse.webp`, `apps/showcases/30/assets/wet_asphalt_normal.webp`, `apps/showcases/30/assets/wet_asphalt_roughness.webp`, `apps/showcases/30/assets/skybox.webp`
- **Source:** AI-generated (Gemini `gemini-3.1-flash-image`) diffuse photo + skybox faces, roughness/normal maps derived locally via ImageMagick.
- **Usage:** Replaces two assets that were originally reused from unrelated showcases and didn't fit the scene: the street previously used a brass/gear "steampunk" PBR set instead of asphalt, and the skybox was a bright space-nebula texture that blew out through the building gap. The new skybox is a 6-panel horizontal-cross cubemap, each face generated independently and composited (not a single generated cross image, which generative models can't lay out reliably).

### 360-Degree Milky Way Panorama (`eso0932a`)

- **File:** `apps/showcases/22/assets/milkyway.webp`, `apps/showcases/22/showcase.ts`
- **Authors/Gurus:** Serge Brunier, Frédéric Tapissier / European Southern Observatory (ESO)
- **Source:** [ESO - 360-degree Panorama of the Southern Sky (eso0932a)](https://www.eso.org/public/images/eso0932a/)
- **License:** [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- **Usage:** Used as the high-resolution equirectangular background texture for the `Skydome` in Showcase 22 (Accretion Disk & Magnetic Singularity simulation), providing an astronomically accurate $360^\circ$ panoramic backdrop that is dynamically distorted by the gravitational lensing and relativistic beaming post-processing shaders.

### Dungeon Font (Yet Another Dungeon HUD)

- **File:** `apps/sample-apps/yad/assets/fonts/Dungeon.ttf`
- **Source:** [DooM Font auf DaFont](https://www.dafont.com/doom.font)
- **Usage:** Used to render the iconic red numbers and UI text in the YAD (Yet Another Dungeon) showcase. A huge thanks to the unknown author who originally created and shared this authentic TTF replica!
  _Note: While the project uses the name "Yet Another Dungeon" (YAD), its aesthetic and assets are deeply inspired by the legendary DOOM (1993)._

### Retro Dungeon Texture & Sprite Pack

- **File:** `apps/sample-apps/yad/assets/dungeon_pack/`
- **Source:** Original assets by **id Software** (DOOM, 1993).
- **Usage:** Used in the YAD showcase for authentic wall textures, flats, and weapon/enemy sprites. Thank you to the DOOM community and id Software for making these legendary assets available for educational and nostalgic projects!

### Mixamo Mannequin (Rigged Character Pool)

- **File:** `public/assets/the-whisper/mannequin/`, `apps/sample-apps/the-whisper/raw/mannequin/`
- **Authors/Gurus:** Mixamo / Adobe
- **Source:** [Mixamo Characters](https://www.mixamo.com/#/?page=1&query=Mannequin&type=Character)
- **Usage:** Served as the initial 3D dummy/proxy character for early movement prototyping and animation testing in the "The Whisper" app, allowing robust iteration on the 2.5D and isometric controllers.

### Player / Spieler (Protagonist Character Rig & Motion Clips)

- **File:** `public/assets/the-whisper/mannequin/player-female/character.glb`, `public/assets/the-whisper/mannequin/player-male/character.glb`, `public/assets/the-whisper/mannequin/shared/anim/`, `apps/sample-apps/the-whisper/raw/mannequin/`
- **Authors/Gurus:** Adobe Mixamo (Auto-Rigging & Animation Library)
- **Source:** [Adobe Mixamo](https://www.mixamo.com/)
- **Usage:** Provides the rigged skeletal hierarchy (`mixamorig:LeftHand`, spine, limbs) and converted binary glTF motion clips (`idle_torch.glb`, `walk_torch.glb`, `ascending_stairs.glb`) driving the player character in the "The Whisper" bunker scenes.

### Yoshi (Easter Egg Character)

- **File:** `public/assets/the-whisper/mannequin/yoshi/character.glb`, `apps/sample-apps/the-whisper/raw/mannequin/yoshi/`
- **Authors/Gurus:** akennedy007 ([Sketchfab](https://sketchfab.com/akennedy007)) / Nintendo
- **Source:** [Yoshi on Sketchfab](https://sketchfab.com/3d-models/yoshi-9d6d7b5685a442039a555b2c1cd887c4) (CC-BY-4.0)
- **Usage:** Provides the 3D geometry of Yoshi rigged against the standard Mixamo biped armature for a fun, hidden Easter Egg character playable via `[C]`.

### Procedural Rodent Grooming FSM & Spline Wave Kinematics (`RatGroomingBehavior`)

- **File:** `packages/engine/src/behaviors/creatures/RatGroomingBehavior.ts`, `packages/engine/src/behaviors/creatures/GroomingRat.ts`
- **Concept:** Procedural rodent grooming state machine (Finite State Machine) combining Lissajous paw scrubbing trajectories with phase-delayed spline wave propagation for multi-segment tails.
- **Formulas:**
  - _Face/Whisker Scrubbing Trajectory:_ $x(t) = \pm 0.015 + \sin(18t) \cdot 0.008$, $y(t) = 0.125 + \cos(18t) \cdot 0.014$ synchronized with resonant head nodding ($\Delta \theta_X = 0.12 + 0.06 \sin(18t)$).
  - _Phase-Shifted Tail Wave Kinematics:_ $\theta_Y(s, t) = \sin(2.8t + s \cdot 0.75) \cdot (0.16 + s \cdot 0.09)$ across $s \in [0, 5]$ cylinder vertebra nodes to achieve organic whip/serpentine momentum without skeletal skinning.
- **Usage:** Provides lightweight, zero-rigging procedural living creature ambient animations running at 60 FPS with zero bundle overhead.

## Shaders & Procedural Art

### Star Nest (Volumetric Cosmic Raymarching)

- **File:** `apps/showcases/23/showcase.ts` (SHADERTOY_STAR_NEST)
- **Authors/Gurus:** Kali
- **Source:** [Star Nest on Shadertoy](https://www.shadertoy.com/view/XlfGRj)
- **Usage:** This iconic Shadertoy creates a stunning, volumetric deep-space effect using iterative distance folding. It beautifully demonstrates how WebGL2 handles heavy loops and spatial transformations on our dynamic billboards.

### Neon Fractal (Kishimisu)

- **File:** `apps/showcases/23/showcase.ts` (COMPUTETOYS_KISHIMISU and SHADERTOY_FRACTAL)
- **Authors/Gurus:** Kishimisu
- **Source:** [An introduction to Shader Art Coding](https://www.youtube.com/watch?v=f4s1h2YETNY)
- **Usage:** This hypnotic, colorful fractal shader is a direct adaptation of Kishimisu's legendary shader art tutorial. It uses space folding, sine-wave color palettes, and iterative distance field manipulation to create an infinitely zooming neon landscape. A masterpiece of procedural math, featured in both the WebGL2 and WebGPU galleries!

### Plasma (GLSLSandbox)

- **File:** `apps/showcases/23/showcase.ts` (GLSLSANDBOX_PLASMA)
- **Source:** Generic / Public Domain (GLSLSandbox)
- **Usage:** A classic, foundational plasma effect built using overlaid sine/cosine waves and time offsets. It serves as a minimalist, high-performance reference implementation for WebGL2 custom materials.

### Raymarching & SDFs

- **File:** `packages/engine/src/renderers/shaders/source/web_gl2/chunks/sdf_math.glsl`, `packages/engine/src/renderers/shaders/source/web_gpu/chunks/sdf_math.wgsl`, `apps/showcases/24/showcase.ts`
- **Authors/Gurus:** Inigo Quilez
- **Source:** [Inigo Quilez - Computer Graphics, Mathematics, Shaders](https://iquilezles.org/)
- **Usage:** Provides core Signed Distance Field (SDF) mathematical primitives (sphere, box, torus, cylinder, capsule, plane), polynomial smooth CSG operators (smooth union, subtraction, intersection), and domain modifiers (twist, repetition, rotation). Standardizes raymarching and procedural distance evaluations across WebGL2 and WebGPU shaders.

### Retro Synthwave Grid

- **File:** `apps/showcases/23/showcase.ts` (COMPUTETOYS_SYNTHWAVE)
- **Usage:** A classic 80s outrun-style shader featuring an endless glowing grid and a sunset. It demonstrates the use of simple coordinate manipulations and smoothstep functions to recreate nostalgic procedural aesthetics.

### Stylized 3D Water Shader (Vertex Waves, Depth Fade, Foam)

- **File:** `packages/engine/src/core/materials/liquid/OpenWaterMaterial.ts`, `packages/engine/src/core/materials/liquid/shaders/OpenWater.vert.glsl`, `packages/engine/src/core/materials/liquid/shaders/OpenWater.frag.glsl`, `packages/engine/src/core/materials/liquid/shaders/OpenWater.frag.wgsl`
- **Authors/Gurus:** gameidea (gameidea.org, also active as `gameidea-studio` on itch.io and Patreon)
- **Source:** ["Creating a Stylized 3D Water Shader"](https://gameidea.org/2026/02/01/creating-a-stylized-3d-water-shader/) — gameidea, published 2026-02-01
- **Usage:** Reference for the stylized (Sea of Thieves-inspired) open-water look: simple sine/noise-based Gerstner-like vertex wave displacement combined with fragment-side depth fade (mixing toward an underwater fog color with scene depth) and screen-space foam near intersections with other geometry, instead of a physically simulated ocean (no FFT).

### Physical Gerstner Waves & Deep-Water Dispersion Relation

- **File:** `packages/engine/src/core/materials/shaders/chunks/liquid_gerstner_wave.glsl`, `packages/engine/src/core/materials/shaders/chunks/liquid_gerstner_wave.wgsl`
- **Authors/Gurus:** František Josef Gerstner (1804), Jerry Tessendorf (2001, *Simulating Ocean Water*)
- **Formulas:**
  - Deep-Water Dispersion Relation: $\omega(k) = \sqrt{g \cdot k} = \sqrt{\frac{2\pi g}{\lambda}}$ (Phase speed $c = \sqrt{\frac{g}{k}}$)
  - Surface Position: $\mathbf{P}(x_0, z_0, t) = \left(x_0 - \sum \frac{Q_i}{k_i} d_{x,i} \sin\phi_i, \ \sum A_i \cos\phi_i, \ z_0 - \sum \frac{Q_i}{k_i} d_{z,i} \sin\phi_i\right)^T$ where $\phi_i = k_i (\mathbf{d}_i \cdot \mathbf{x}_0) - \omega_i t$
  - Analytical Tangents & Bitangents: $\mathbf{T} = \frac{\partial \mathbf{P}}{\partial x_0}, \ \mathbf{B} = \frac{\partial \mathbf{P}}{\partial z_0}, \ \mathbf{N} = \text{normalize}(\mathbf{B} \times \mathbf{T})$
  - Horizontal Jacobian Metric: $J = T_x B_z - T_z B_x$ ($J < 1$ represents crest pinching / compression; $J \le 0$ indicates breaking wave cusps)
- **Usage:** Provides realistic, non-linear ocean wave propagation where long swell waves outrun short chop, sharp trochoidal wave crests form naturally without self-intersection, and exact analytical normal vectors eliminate finite-difference artifacts across WebGL and WebGPU.

### Smooth-Min Voronoi Caustics Network ($F_1 - \text{Smooth}F_1$)

- **File:** `packages/engine/src/renderers/shaders/source/web_gl2/chunks/liquid_caustics.glsl`, `packages/engine/src/renderers/shaders/source/web_gpu/chunks/liquid_caustics.wgsl`
- **Authors/Gurus:** Inigo Quilez (Smooth Voronoi / Cellular Noise)
- **Source:** [Inigo Quilez - Smooth Voronoi](https://iquilezles.org/articles/smoothvoronoi/)
- **Formulas:**
  - 2D Domain Warp: $p' = p + 0.35 \sin(p \cdot 2.1 + t \cdot 0.8)$
  - Smooth Minimum: $smin(a, b, k) = -k \cdot \ln(e^{-a/k} + e^{-b/k})$ or polynomial $smin(a, b, k) = \frac{a+b-\sqrt{(a-b)^2+k^2}}{2}$
  - Cell Edge Network: $C(p) = \text{smoothstep}(w_0, w_1, F_1(p') - \text{smooth}F_1(p'))$
- **Usage:** Provides organic, soft anime/Ghibli-style caustic cell networks underneath transparent fluid surfaces in WebGL and WebGPU without sharp cellular boundaries or lookup texture overhead.

### Stepped-Time Star Billboard Glint & Sparkle Lattice

- **File:** `packages/engine/src/renderers/shaders/source/web_gl2/chunks/liquid_glint.glsl`, `packages/engine/src/renderers/shaders/source/web_gpu/chunks/liquid_glint.wgsl`
- **Authors/Gurus:** Traditional Japanese Limited Animation (Studio Ghibli aesthetic cadence)
- **Formulas:**
  - Stepped Time Quantization: $t_{\text{step}} = \frac{\lfloor t \cdot \text{fps} \rfloor}{\text{fps}}$ (e.g. 8 or 12 FPS)
  - 4-Point Astroid Star Shape: $S(u, v) = \max(0, 1 - (|u|^{0.5} + |v|^{0.5})^2)$
  - Sparkle Modulation: $I = S(u, v) \cdot \text{step}(\tau, N(c, t_{\text{step}}))$
- **Usage:** Generates crisp anime/Ghibli specular sparkle cross glints on wave crests animated at deliberate low framerates (on-twos / on-threes) to emulate hand-drawn traditional cel animation.

### Stylized Lava Surface & Subtractive Fissure Shading

- **File:** `packages/engine/src/core/materials/liquid/StylizedLavaMaterial.ts`, `packages/engine/src/core/materials/liquid/shaders/StylizedLava.{vert,frag}.{glsl,glsl100,wgsl}`, `scripts/gen-lava-textures.mjs` (stand-ins for the shader's two input textures)
- **Authors/Gurus:** Joyce / MinionsArt (Joyce[MinionsArt] on Patreon / Twitter / Bluesky)
- **Source:**
  - ["Stylized Lava Shader" (Patreon Post 32245619)](https://www.patreon.com/posts/stylized-lava-32245619)
  - ["Shader Graph Stylized Lava" (Patreon Post 33388865)](https://www.patreon.com/posts/shader-graph-33388865)
- **Formulas & Architecture:**
  - Line-by-line port of the original "Simple Lava" shader (`_Time.x = t/20`, `_Time.z = 2t`). World-XZ projected `_DistortTex` sampled at two scales: $d = \text{saturate}\big(\frac{T_d(\mathbf{u}_d) + T_d(0.5\,\mathbf{u}_d)}{2}\big)$ with $\mathbf{u}_d = \mathbf{x}_{xz} s_{\text{dist}} + \tfrac{t}{20}\mathbf{v}_{\text{dist}}$
  - Main UV: $\mathbf{u}_{\text{main}} = \mathbf{x}_{xz} s_{\text{main}} + d\,w_{\text{dist}} + \tfrac{t}{20}\mathbf{v}_{\text{main}} + r\,w_{\text{vtx}}$, then $c = T_m(\mathbf{u}_{\text{main}})\,r + d$ with $r$ the red vertex color
  - Diagonal vertex wave (object space): $\Delta y = \sin(2t \cdot \omega + x \cdot z \cdot k) \cdot A \cdot r$
  - Depth edge: $e_{\text{line}} = 1 - \text{sat}\big(E\,(z_{\text{scene}} - z_{\text{frag}})\big)$, $M_{\text{edge}} = \text{smoothstep}(1-c,\,1-c+b_e,\,e_{\text{line}})$, $M_{\text{top}} = \text{smoothstep}(c_{\text{cut}},\,c_{\text{cut}}+b_t,\,c)\,r$
  - Non-Overlapping Subtractive Isolation: $\big(\text{lerp}(C_1, C_2, c\,o)\,S\,(1 - M_{\text{edge}})(1 - M_{\text{top}})\,r\big) + M_{\text{edge}} C_{\text{edge}} S_{\text{top}} + M_{\text{top}} C_{\text{top}} S_{\text{top}}$
- **Usage:** A massive heartfelt thank-you to Joyce (MinionsArt) for pioneering this stylized NPR lava paradigm! Her step-by-step breakdown (dual-frequency noise UV perturbation, a cellular crust texture, vertex-color painting, Scene Depth edge subtraction for organic shoreline burns, and mathematically clean subtractive cutout algebra that eliminates HDR bloom blowout) serves as the primary artistic and mathematical foundation for Small World Machine's `StylizedLavaMaterial`.

## AI Coding & Architecture Assistants


### Google Gemini (2.5 Pro)

- **Authors/Gurus:** Google DeepMind
- **Source:** [Gemini 2.5 Pro | Gemini API (Google AI for Developers)](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro)
- **Usage:** The flagship reasoning/thinking model used as a reference for solving complex engineering problems in `small-world-machine` — analyzing large codebases, long-context reasoning over the engine architecture, and drafting architectural decisions. Serves as a counterpart to human review for high-level design and code-quality judgement.

### Claude Sonnet (Anthropic Claude Sonnet 5)

- **Authors/Gurus:** Anthropic
- **Source:** [Claude Models (Anthropic)](https://docs.anthropic.com/en/docs/about-claude/models/overview)
- **Usage:** The reference agentic coding assistant used as a second pair of eyes on cross-cutting architectural decisions and large multi-file refactors in `small-world-machine`. Consulted for architecture reviews (e.g., renderer abstraction seams between WebGL2 and WebGPU, behavior-driven component design) and for writing/refactoring TypeScript code along the project's coding standards.

### DeepSeek V4 Flash

- **Authors/Gurus:** DeepSeek AI
- **Source:** [DeepSeek-V4-Flash (Hugging Face)](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash)
- **Usage:** A fast Mixture-of-Experts (MoE) model (284B total / 13B activated parameters) used as a lightweight, high-throughput reference assistant for iterative coding and localized architecture checks during active development, trading deep reasoning for speed on routine code generation and short refactors within the engine.
