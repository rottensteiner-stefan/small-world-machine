# Particle System Evolution: SoA Optimization, GPU Compute & SDF Collision Architecture (2026-10-30)

> **Context:** Technical analysis of `.agents/notes/particles.md` (AAA GPU particle pipelines, SoA layout, Curl Noise, SDF collision math) benchmarked against Small World Machine's existing `@small-world-machine/vfx-extras` and `@small-world-machine/engine` architecture.
> **Doctrine Alignment:** Godot & PlayCanvas Doctrine (lean modularity, zero-GC hot path), Tiered Renderer Autonomy (`WEB_GPU` / `WEB_GL2` / `WEB_GL1`), and Whack-a-Mole Doctrine (`ADR 0047`).

---

## 1. Baseline Audit: `.agents/notes/particles.md` vs. SWM Status Quo

| Concept in `particles.md` | SWM Current State (`v0.121.0`) | Gap / Opportunity |
|---|---|---|
| **Data-Oriented SoA Layout** (`Positions`, `Velocities`, `Lifetimes` flat arrays; no `class Particle` heap objects) | ✅ **Implemented on CPU:** `ParticleSystem` (`packages/vfx-extras/src/ParticleSystem.ts`) uses parallel `Float32Array` & `Uint8Array` buffers (`positions`, `velocities`, `accelerations`, `colors`, `sizes`, `alphas`, `masses`, `lives`, `maxLives`, `heats`, `aliveFlags`, `_frameFlags`). Zero allocation in `update(dt)`. | CPU-to-GPU bridge in `ParticleMeshRenderer.sync()` still expands SoA into `16 × f32` (`64 B`) `mat4` per slot on CPU. |
| **Batched Force Pipeline** (`Simulation-State-Changer`) | ✅ **Implemented on CPU:** `BatchedAffector.applyBatch(arrays, total, dt)` runs tight typed-array loops per affector (`GravityAffector`, `DragAffector`, `ColorOverLifeAffector`, `SizeGrowthAffector`, `ThermalCoolingAffector`, `VortexAffector`). | GPU Compute counterpart (`GPUParticleSystem`) does not exist yet; large atmospheric emitters (`WeatherEmitter`) run on CPU. |
| **Free-List / Dead-List Recycling** | ✅ **Implemented on CPU:** `ParticleSystem._freeIndices` stack + `compact()` slot reclamation. | In `ParticleMeshRenderer.sync()`, dead slots < `capacity` are zero-filled (`matrices.fill(0)`) instead of drawing a contiguous live prefix (`instanceCount = liveCount`). |
| **Semi-Implicit Euler Integration** ($\mathbf{v} \leftarrow \mathbf{v} + \mathbf{a}\Delta t$, $\mathbf{p} \leftarrow \mathbf{p} + \mathbf{v}\Delta t$) | ✅ **Implemented:** `ParticleSystem.update()` lines 251–268. | None on CPU; port directly to WGSL compute for Tier B. |
| **Divergence-Free Curl Noise** ($\mathbf{v}_{\text{noise}} = \nabla \times \mathbf{F}$) | 🟡 **Approximated:** `TurbulenceAffector` uses a fast trigonometric proxy ($\sin(y+t)\cos(z+0.7t)$). | Periodic $2\pi$ lattice creates axis-aligned drift over long lifetimes; lacks true 3D Simplex curl and obstacle boundary modulation. |
| **Collisions (Planes vs. SDF vs. Depth)** | 🟡 **Axis-Aligned Planes Only:** `BouncePlaneAffector` (`axis: "x" \| "y" \| "z"`). Meanwhile, `sdf_math.wgsl` and `sdf_math.glsl` already contain Inigo Quilez's analytical SDF primitives (`sdfSphere`, `sdfBox`, `sdfCapsule`, `sdfCylinder`, `opSmoothUnion`), unused by particles. | High-value synergy: bridge existing `sdf_math` primitives and `ADR 0028` Thin Normal Buffer + Opaque Depth into particle collision. |
| **Overdraw & Transparency Sorting** | 🟡 **Partial:** Straight-alpha procedural erosion (`SmokeSpriteMaterial`, `FireEmberMaterial`) avoids hard quad edges; `foldAlphaIntoScale` shrinks dying embers. | Missing **Soft Particles** (depth-buffer fade against opaque geometry) and GPU indirect compaction. |

---

## 1b. Industry Benchmark: Who Builds the Best Particle Systems?

| Engine / Library | Architecture & Simulation Model | Collision & Physics | Rendering & Shading Strengths | Weaknesses / What SWM Should Avoid |
|---|---|---|---|---|
| **Godot 4 (`GPUParticles3D` + `ParticleProcessMaterial` & `CPUParticles3D`)** | **Uber-Shader Configurator + Explicit Dual Tier:** `ParticleProcessMaterial` compiles an uber-shader with toggleable curves/attractors (`GPUParticlesAttractorSphere3D`, `Box3D`, `VectorField3D`). `CPUParticles3D` mirrors the exact same API for lower-end devices (`convert_to_cpu_particles()`). Supports **Sub-Emitters** (ring-buffer emission on birth/collision/death) and **Trails** (ribbon/tube history buffer). | Dedicated `GPUParticlesCollisionSphere3D`, `Box3D`, `SDF3D` (local baked SDF box), and `HeightField3D` (ortho top-down heightmap for rain/snow!). | Zero node-graph overhead for 90% of effects; curve-LUT textures (1D float ramps) drive scale/color/turbulence over lifetime; clean separation between process material and draw pass meshes (up to 4 chained draw passes per emitter). | Monolithic `ParticleProcessMaterial` has ~80 properties in a single inspector class; violates SWM's composable `Affector` philosophy. |
| **PlayCanvas (`ParticleSystemComponent`)** | **WebGL2 Ping-Pong RGBA32F State Textures + CPU Fallback:** Packs state (pos, vel, age, rot) into floating-point textures updated via full-screen fragment pass, or falls back to CPU typed arrays. | Basic bounding-sphere/box or none; relies on scene scripts for gameplay triggers. | **1D Curve Evaluator (`Curve` / `CurveSet`):** Every parameter (velocity, localVelocity, radialSpeed, color, scale, alpha, rotationSpeed) is evaluated from a pre-baked 1D LUT texture or fast piecewise polynomial, plus **Motion Stretching** (`stretch` factor along velocity vector) and **Mesh Particles** (3D debris). | Texture ping-pong in WebGL2 is harder to read/debug than SoA buffers and cannot do atomic compaction (always processes `maxParticles` texels). |
| **`three.quarks` (Best-in-Class Web VFX Runtime)** | **Batched Cross-Emitter Instancing (`BatchedParticleRenderer`):** Decouples *Emitters* (CPU SoA + modular Behavior stack) from a central *Batch Renderer* that merges multiple emitters sharing the same material into a single instanced draw call. | Modular Behaviors (`ApplyCollision`, `ForceOverLife`, `Noise`, `OrbitOverLife`, `FrameOverLife`). | **Trail/Ribbon Renderer**, **Sub-Emitters** (`EmitSubParticleSystem`), **6-Way Lightmap / Flipbook blending** (`FrameOverLife` with motion vectors), and spline-curve modulation without GC allocations. | CPU-bound above ~25k particles because it targets Three.js WebGL2 first rather than native WebGPU compute. |
| **Babylon.js (`ParticleSystem` & `GPUParticleSystem`)** | **WebGL2 Transform Feedback (`GPUParticleSystem`) / WebGPU Compute:** Uses double-buffered VBOs with `gl.transformFeedbackVaryings` on WebGL2 and Compute on WebGPU. | CPU has `checkCollisions`; GPU particle system historically lacked collisions and sub-emitters due to Transform Feedback limits. | **Ramp Gradients** (color/size/drag gradients at arbitrary normalized life keys $t \in [0, 1]$), **Hemispheric/Cone/Cylinder/Mesh Emitters**, and **Custom Procedural Noise Textures**. | Transform Feedback requires maintaining two completely divergent shader pipelines (WebGL2 vs. WebGPU) and still cannot compact dead particles without CPU queries. |
| **Unreal Engine 5 (`Niagara`)** | **Modular Stack (`Emitter Spawn` $\rightarrow$ `Emitter Update` $\rightarrow$ `Particle Spawn` $\rightarrow$ `Particle Update` $\rightarrow$ `Render`)** running on SIMD CPU VM (`VectorVM`) or GPU Compute (`HLSL`). | Analytical primitives, Skeletal Mesh Bone/Skinned Capsules, Screen-Space Depth + G-Buffer Normal, and Global/Mesh SDFs. | **Data Interfaces (DI):** Clean plug-in bindings to read external engine data (Depth buffer, Audio spectrum, Splines, Skinned Meshes). **Ribbon Renderer** with UV tiling, **Light Renderer** (selected particles become dynamic point lights in Clustered Forward+). | Massive editor/compiler complexity (thousands of C++ classes). SWM must keep the modular stage mental model without the VM bloat. |
| **Unity (`VFX Graph` & `Shuriken`)** | `Shuriken` = CPU SIMD SoA with fixed modules; `VFX Graph` = GPU Compute + Strip/Quad/Mesh/Octagon outputs. | Depth Buffer Collision, Signed Distance Fields, Plane/Sphere lists. | **Octagon/Convex Bounding Cutouts** (reduces transparent quad overdraw by 35–50% by trimming empty sprite corners) and **6-Way Smoke Lighting**. | Two disconnected systems (`Shuriken` vs. `VFX Graph`) that cannot share assets or behaviors. |

---

## 1c. What Is "Industry Standard" vs. "Beyond Industry Standard" for Web Engines?

### Tier 1: Mandatory Industry Standard (What Every Serious 3D Engine Must Have)
1. **Composable Emitter Shapes:** Point, Sphere/Shell, Cone (directional bursts/flamethrowers), Box/Volume (ambient dust/rain), Circle/Ring (shockwaves), and Mesh Surface/Vertex emission.
2. **1D Curve / Gradient Ramps over Normalized Age ($t \in [0, 1]$):** Multi-stop Piecewise Linear / Hermite curves for `sizeOverLife`, `colorOverLife`, `alphaOverLife`, and `speedMultiplierOverLife` (baked into a tiny $64 \times 1$ LUT or evaluated inline).
3. **4 Core Render Modes:**
   - **Spherical / Cylindrical Billboard** (smoke, embers, dust).
   - **Velocity-Stretched Billboard** (`length = size + speed * stretchFactor` — sparks, rain, muzzle flashes).
   - **3D Mesh Particles** (rock debris, shrapnel, falling leaves with 3D angular velocity).
   - **Ribbon / Trail Renderer** (connected triangle strips behind moving emitters or leader particles — sword slashes, tracer rounds, rocket contrails, wind wisps).
4. **Soft Particles (Scene Depth Fade)** and **Flipbook UV Animation** (with smooth inter-frame blending or optical-flow motion vectors).
5. **Event-Driven Sub-Emitters:** Spawning child particles on `onBirth`, `onCollision` (e.g., raindrop $\rightarrow$ splash ring; ember hitting floor $\rightarrow$ 4 micro-sparks), or `onDeath` (firework shell $\rightarrow$ burst).

### Tier 2: Beyond Industry Standard (AAA / Next-Gen Differentiators Tailored to SWM)
1. **6-Way Lightmap / Directional Volume Smoke Shading (EmberGen / Klemen Lozar / Frostbite Technique):**
   - Standard billboard smoke looks flat when lighting changes because a single normal map cannot capture internal volumetric self-shadowing and multi-scattering.
   - **How it works:** Two RGBA textures store pre-integrated light response from the 6 cardinal axes (`TexA.rgb` = $+X, +Y, +Z$ tangent directions; `TexB.rgb` = $-X, -Y, -Z$ directions; `A` channels = alpha + emissive/temperature). In the fragment shader, project each light direction $\mathbf{L}$ into the billboard's tangent basis $(T, B, N)$ and weight the 3 positive/negative lobes:
     $$I(\mathbf{L}) = \max(0, L_x) W_{+X} + \max(0, -L_x) W_{-X} + \max(0, L_y) W_{+Y} + \max(0, -L_y) W_{-Y} + \max(0, L_z) W_{+Z} + \max(0, -L_z) W_{-Z}$$
   - **SWM Twist:** We don't even need heavy external EmberGen textures! We can synthesize the 6-way directional lobe weights **procedurally in our existing 3-octave FBM shader (`SmokeSpriteMaterial`)** using directional derivative offsets along $(u, v, z)$, giving physically reactive self-shadowed plumes from directional + point lights at zero texture memory cost.
2. **Zero-VRAM Screen-Space Depth + `ADR 0028` Thin Normal Buffer Bouncing (Idea C2):**
   - Almost no web engine (neither Three.js, PlayCanvas, nor Babylon.js) supports real-time GPU particle collision against arbitrary scene geometry because they lack a guaranteed G-Buffer normal or require expensive raycasting. Because SWM already renders the `ADR 0028` Thin Normal Buffer and Opaque Depth Buffer, our particles can bounce off intricate gothic arches, Sponza columns, or character armor at **2 texel loads per particle and 0 MB extra VRAM**.
3. **Top-Down Ortho Heightfield Collision (Godot 4 `GPUParticlesCollisionHeightField3D` Pattern for Weather):**
   - For `WeatherEmitter` (rain/snow/ash over large outdoor scenes), rendering a single $256 \times 256$ orthographic top-down depth map once (or when the camera moves by $>5\text{ m}$) allows 50,000 raindrops to be culled or trigger splash sub-emitters the exact millisecond their $y < y_{\text{roof}}(x, z)$ — solving the classic "rain falling through bunker roofs and bridges" problem with **1 scalar texture lookup**.
4. **Bridson Boundary-Ramped Curl Potential (Idea N1):**
   - Instead of particles flying straight into a pillar and abruptly bouncing, multiplying the Curl Noise vector potential $\vec{\Psi}$ by $\text{smoothstep}(0, r, \text{SDF}(\mathbf{p}))$ guarantees $\nabla \cdot \mathbf{v} = 0$ and $\mathbf{v} \cdot \mathbf{n} = 0$ on obstacle surfaces — smoke and embers **part and swirl aerodynamically around characters and pillars**.
5. **Particle-Driven Dynamic Light Pool (Niagara Light Renderer Pattern):**
   - Allow an emitter to nominate up to $N \le 8$ brightest/hottest particles (`heats[i]`) to drive a pooled set of SWM `PointLight` nodes (with smooth intensity fade on death), so a burst of sparks or a floating fireball casts real dynamic light on walls and floors without manual light choreography.

---

## 2. High-ROI Architectural Ideas for Small World Machine

### Idea P1: Compact 32-Byte Instance Packing & GPU Vertex Billboarding (All Tiers)

- **Problem:** `ParticleMeshRenderer.sync()` currently loops over `0..capacity`, executes `Math.atan2(dx, dz)`, `Math.hypot(dx, dz)`, and `Matrix4.compose()` on the CPU for every live particle, and uploads `16 floats` (`64 B` matrix) + `4 floats` (`16 B` RGBA) = **`80 Bytes/particle`** per frame. Dead slots still upload 16 zeros and submit degenerate triangles to the vertex processor.
- **Solution:**
  1. **Active-Prefix Compaction in `sync()`:** Write only live, visible particles (`aliveFlags[i] === 1 && alphas[i] > 0.001`) contiguously into `0..liveCount - 1` and set `mesh.instanceCount = liveCount`. Zero dead-slot uploads, zero degenerate vertex invocations.
  2. **32-Byte Particle Instance Payload (60% Bandwidth Reduction):** Replace the `mat4` instance matrix on particles with two `vec4` attributes:
     - `a_particlePosScale`: `vec4(pos.x, pos.y, pos.z, size)` (`16 B`)
     - `a_particleColor`: `vec4(r, g, b, alpha)` (`16 B`)
  3. **Vertex-Shader Billboarding:** Pass `u_cameraRight` and `u_cameraUp` (extracted from view matrix rows 0 and 1) once per frame. Expand the quad in the vertex shader:
     - **Spherical:** $\mathbf{p}_{\text{world}} = \mathbf{p}_{\text{center}} + s \cdot (u \cdot \mathbf{R}_{\text{cam}} + v \cdot \mathbf{U}_{\text{cam}})$
     - **Yaw-Only (Cylindrical):** $\mathbf{p}_{\text{world}} = \mathbf{p}_{\text{center}} + s \cdot (u \cdot \mathbf{R}_{\text{cam,xz}} + v \cdot \hat{\mathbf{y}})$
- **Impact:** Eliminates 100% of CPU `atan2`/`hypot`/`Matrix4.compose` overhead in `ParticleMeshRenderer.sync()`, cuts PCIe/WebGL buffer upload bandwidth by **60%**, and scales CPU-driven emitters from ~2k to **15k–25k particles at 60 FPS** across WebGPU, WebGL2, and WebGL1.

---

### Idea P2: Soft Particles via Opaque Scene Depth (`WEB_GPU` & `WEB_GL2`)

- **Problem:** `particles.md` §1 highlights **Overdraw & Fragment Shading** as the primary GPU bottleneck, and `SmokeSpriteMaterial` currently documents soft-particle depth fade as an open follow-up. Large smoke/mist quads intersecting floors or bunker walls produce hard geometric seams.
- **Solution:** Reuse the existing opaque scene depth texture (already captured for `ADR 0029` Decals, Froxel Fog, and HBAO):
  $$\alpha_{\text{soft}} = \alpha_{\text{particle}} \cdot \text{clamp}\!\left(\frac{z_{\text{scene,linear}}(u,v) - z_{\text{particle,linear}}}{d_{\text{fade}}}, 0.0, 1.0\right)$$
- **Optimization:** If $\alpha_{\text{soft}} < 0.005$, `discard` early before noise/lighting evaluation.

---

### Idea C1: Analytical SDF Collider List (`SdfColliderAffector` & Shader Uniforms)

- **Critique of `particles.md` §4 (Global 3D SDF Texture):** Baking a $256^3$ `r16float` Global Distance Field costs `32 MB` of VRAM and requires **6 trilinear 3D texture lookups per particle** via central differences (`CalculateSDFNormal`). In a lightweight browser engine, this violates the footprint doctrine (`GEMINI.md` §2).
- **SWM Alternative — Analytical SDF Primitives + Exact/Tetrahedral Gradients:**
  - SWM already ships `sdfSphere`, `sdfBox`, `sdfRoundBox`, `sdfCapsule`, `sdfCylinder`, and `sdfPlane` in `packages/engine/src/renderers/shaders/source/web_gpu/chunks/sdf_math.wgsl` (and `web_gl2/chunks/sdf_math.glsl`).
  - Expose a compact `SdfColliderList` (4–16 primitives per emitter: e.g., floor plane, bunker walls, pillars, character capsule, brazier bowl) usable both by a CPU `SdfColliderAffector` and by WebGPU compute shaders.
  - **Closed-Form Analytical Gradients (0 extra taps):** For individual primitives, compute $(d, \mathbf{n})$ directly without finite differences:
    - **Sphere $(\mathbf{c}, R)$:** $\mathbf{q} = \mathbf{p} - \mathbf{c}$, $d = \|\mathbf{q}\| - R$, $\mathbf{n} = \mathbf{q} / \|\mathbf{q}\|$.
    - **Plane $(\hat{\mathbf{n}}, h)$:** $d = \mathbf{p} \cdot \hat{\mathbf{n}} + h$, $\mathbf{n} = \hat{\mathbf{n}}$.
    - **Capsule $(\mathbf{a}, \mathbf{b}, R)$:** $\mathbf{h} = \text{clamp}\!\left(\frac{(\mathbf{p}-\mathbf{a})\cdot(\mathbf{b}-\mathbf{a})}{\|\mathbf{b}-\mathbf{a}\|^2}, 0, 1\right)$, $\mathbf{q} = \mathbf{p} - \mathbf{a} - \mathbf{h}(\mathbf{b}-\mathbf{a})$, $d = \|\mathbf{q}\| - R$, $\mathbf{n} = \mathbf{q} / \|\mathbf{q}\|$.
  - **Tetrahedral Gradient for CSG / 3D Textures (4 taps instead of 6):** Whenever a composite SDF or local 3D texture is sampled, replace the 6-tap central difference from `particles.md` with **Inigo Quilez's 4-tap Tetrahedral Gradient** (**33% fewer evaluations**):
    ```wgsl
    fn calcSDFNormalTetrahedral(p: vec3f, eps: f32) -> vec3f {
        let k = vec2f(1.0, -1.0);
        return normalize(
            k.xyy * sampleSceneSDF(p + k.xyy * eps) +
            k.yyx * sampleSceneSDF(p + k.yyx * eps) +
            k.yxy * sampleSceneSDF(p + k.yxy * eps) +
            k.xxx * sampleSceneSDF(p + k.xxx * eps)
        );
    }
    ```

---

### Idea C2: Screen-Space Depth + Thin Normal Buffer Collision (`ADR 0028` Synergy)

- **Key Insight:** Small World Machine already maintains a **Thin Normal Buffer MRT (`ADR 0028`)** alongside the opaque depth buffer for decals (`ADR 0029`) and post-processing!
- **Why this beats 3D SDFs for Sparks, Rain & Debris:**
  1. Transform particle world position $\mathbf{p}$ by `u_viewProjectionMatrix` to screen UV $(u, v)$ and linear view depth $z_p$.
  2. Fetch scene linear depth $z_s = \text{textureLoad}(\text{depthTex}, \text{pixelXY}, 0)$.
  3. If $z_p > z_s$ and $(z_p - z_s) < \Delta z_{\text{thickness}}$ (thickness guard prevents particles walking behind a thin column from snapping to its front face):
     - Fetch world/view normal $\mathbf{n}$ **directly** from the `ADR 0028` Thin Normal Buffer (`1 textureLoad`, **zero finite-difference taps**!).
     - Push out: $\mathbf{p} \leftarrow \mathbf{p} + (z_p - z_s + r)\mathbf{n}$.
     - Reflect with restitution $e$ and tangential friction $\mu$:
       $$\mathbf{v}_n = (\mathbf{v} \cdot \mathbf{n})\mathbf{n}, \quad \mathbf{v}_t = \mathbf{v} - \mathbf{v}_n, \quad \mathbf{v}_{\text{new}} = (1 - \mu)\mathbf{v}_t - e\mathbf{v}_n$$
- **Cost:** Exactly **2 2D texel fetches** (`depth` + `normal`), **0 MB extra VRAM**, and automatic sub-centimeter accuracy against complex triangle meshes (Sponza reliefs, Flakturm rubble, animated characters).

---

### Idea N1: True 3D Analytical Curl Noise + SDF Boundary Respect

- **Upgrade to `TurbulenceAffector`:**
  - Add `CurlNoiseAffector` (CPU) and `curl_noise.wgsl` (GPU) using 3D Simplex noise with **analytical gradient evaluation** (computing value and $\nabla N$ simultaneously in one hash pass rather than 6 finite-difference noise calls).
  - **Obstacle-Aware Curl Modulation (Bridson 2007):** Near an SDF boundary $d = \text{SDF}(\mathbf{p})$, ramp the vector potential $\mathbf{\Psi}_{\text{mod}}(\mathbf{p}) = \text{smoothstep}(0, r_{\text{boundary}}, d) \cdot \mathbf{\Psi}(\mathbf{p})$. Because the curl of a boundary-ramped potential has zero normal component at $d = 0$, smoke and embers naturally **swirl around pillars, characters, and walls** before ever needing a hard bounce!

---

### Idea G1: WebGPU Autonomous `GPUParticleSystem` (`ADR 0035` Tiered Autonomy)

- **WebGPU Reality Check vs. HLSL in `particles.md`:** WGSL does not have DX12's `ConsumeStructuredBuffer` / `AppendStructuredBuffer`. Instead, WebGPU uses `var<storage, read_write>` with `atomic<u32>` counters and `drawIndexedIndirect`.
- **Buffer Layout (SoA in GPU Storage):**
  - `positionsAndSizes: array<vec4f>` (`xyz` = world pos, `w` = size)
  - `velocitiesAndLives: array<vec4f>` (`xyz` = velocity, `w` = normalized age $t / t_{\max}$)
  - `colors: array<vec4f>` (`rgba`)
  - `deadIndices: array<u32>` (stack of free slot indices, initialized to `capacity - 1 .. 0`)
  - `aliveIndicesCurr: array<u32>` & `aliveIndicesNext: array<u32>` (ping-pong active index lists)
  - `countersAndIndirect: DrawIndexedIndirectArgs` (`indexCount = 6u`, `instanceCount: atomic<u32>`, `firstIndex = 0u`, `baseVertex = 0i`, `firstInstance = 0u`, plus `deadCount: atomic<u32>`, `aliveCurrCount: u32`)
- **3-Stage Compute Dispatch per Frame (Zero CPU Readback):**
  ```wgsl
  struct Counters {
      indexCount: u32,
      instanceCount: atomic<u32>, // Directly drives drawIndexedIndirect!
      firstIndex: u32,
      baseVertex: i32,
      firstInstance: u32,
      deadCount: atomic<u32>,
      aliveCurrCount: u32,
      emitCount: u32,
  };

  @compute @workgroup_size(64)
  fn csSimulate(@builtin(global_invocation_id) gid: vec3u) {
      let tid = gid.x;
      if (tid >= counters.aliveCurrCount) { return; }

      let slot = aliveCurr[tid];
      var velLife = velocitiesAndLives[slot];
      velLife.w += params.dt * params.invMaxLife;

      if (velLife.w >= 1.0) {
          let deadIdx = atomicAdd(&counters.deadCount, 1u);
          deadIndices[deadIdx] = slot;
          return;
      }

      var posSize = positionsAndSizes[slot];
      let force = params.gravity + evalCurlNoise(posSize.xyz * params.noiseFreq + params.time);
      velLife = vec4f(velLife.xyz + force * params.dt, velLife.w);
      posSize = vec4f(posSize.xyz + velLife.xyz * params.dt, posSize.w);

      // Screen-Space Depth + ADR 0028 Normal Collision or Analytical SDF
      resolveCollision(&posSize, &velLife);

      positionsAndSizes[slot] = posSize;
      velocitiesAndLives[slot] = velLife;

      let nextIdx = atomicAdd(&counters.instanceCount, 1u);
      aliveNext[nextIdx] = slot;
  }
  ```
- **Tiered Renderer Autonomy Matrix:**
  | Capability | `WEB_GPU` (High Tier) | `WEB_GL2` (Medium Tier) | `WEB_GL1` (Low Tier) |
  |---|---|---|---|
  | **Simulation Backend** | Compute Shader (`GPUParticleSystem`) for 50k–250k visual particles; CPU `ParticleSystem` for gameplay (< 5k) | CPU `ParticleSystem` SoA + `BatchedAffector` (up to 15k particles) | CPU `ParticleSystem` SoA (governor-scaled count ≤ 2k) |
  | **Draw Submission** | `drawIndexedIndirect` (0 CPU readback) + Vertex Pulling from `aliveNext` | Instanced compact `vec4` pos/scale + `vec4` color (`instanceCount = liveCount`) | `ANGLE_instanced_arrays` compact buffers |
  | **Collision Mode** | Screen-Space Depth + `ADR 0028` Normal MRT **and** Analytical SDF Collider Buffer | CPU `SdfColliderAffector` (Analytical Sphere/Box/Capsule/Plane) | CPU `BouncePlaneAffector` |
  | **Soft Particles** | Yes (Opaque Depth texture sample) | Yes (Opaque Depth texture sample) | No (Hard alpha erosion) |

---

## 3. Recommended 4-Stage Architecture Synthesis & Roadmap

> **Collaborate Topic Document:** Detailed multi-agent execution plan and blackboard specification in [`.agents/collaborate/particle-system-requirements.md`](../../.agents/collaborate/particle-system-requirements.md) (and `.agents/collaborate/particle-system.md`).

### Stage 1 — Foundation, CPU/GPU Bridge & Curves (All Tiers: `WEB_GPU` / `WEB_GL2` / `WEB_GL1`)
- **Idea P1 (Active-Prefix Compaction & 32-Byte Packing):**
  - Stop writing zero-matrices for dead slots in `ParticleMeshRenderer.sync()`; pack only live, visible particles contiguously into `0..liveCount - 1` and set `InstancedMesh.instanceCount = liveCount`.
  - Add 32-byte instanced attribute fast-path (`a_particlePosScale: vec4`, `a_particleColor: vec4`) + GPU vertex billboarding (`u_cameraRight`, `u_cameraUp`) to eliminate CPU `atan2`, `hypot`, and `Matrix4.compose`.
- **Velocity-Aligned Stretch in Vertex Shader (PlayCanvas Pattern):**
  - Project particle velocity into screen/world basis in the vertex shader (`length = size + speed * stretchFactor`) for crisp sparks, muzzle flashes, and rain streaks without CPU matrix construction.
- **Octagon Sprite Cutout Geometry (Unity VFX Graph Pattern):**
  - Provide an optional 8-vertex / 6-triangle regular octagon billboard mesh in `ParticleMeshRenderer` to trim empty transparent corners on spherical smoke/ember sprites (-30% fragment shader overdraw).
- **Multi-Stop `ColorRamp` & `Curve1D` Evaluators + Standard Spawner Shapes (`Point`, `Sphere`, `Cone`, `Box`, `Circle/Ring`):**
  - Zero-GC piecewise linear / Hermite curve and multi-stop color gradient evaluators over normalized life $t \in [0, 1]$ (`CurveOverLifeAffector`, `ColorRampAffector`).

### Stage 2 — Physics, Analytical SDF Collision, Aerodynamic Flow & Sub-Emitters
- **Idea C1 (`SdfColliderAffector`):**
  - Analytical SDF primitives (`Sphere`, `Box`, `RoundBox`, `Capsule`, `Cylinder`, `Plane`) matching `sdf_math.wgsl`/`sdf_math.glsl` semantics with closed-form normals (or 4-tap Tetrahedral Gradient for smooth CSG unions), configurable restitution $e \in [0, 1]$ and tangential friction $\mu \in [0, 1]$.
- **Idea N1 (`CurlNoiseAffector` with Bridson SDF Boundary Ramp):**
  - True divergence-free 3D Simplex curl noise ($\nabla \times \vec{\Psi}$) modulated by $\text{smoothstep}(0, r_{\text{ramp}}, \text{SDF}(\mathbf{p}))$ so smoke and embers aerodynamically part and swirl around pillars, walls, and characters.
- **Event-Driven Sub-Emitters (`onBirth`, `onCollision`, `onDeath`) & Dynamic PointLight Pool:**
  - Lightweight ring-buffer event queue triggering secondary `ParticleSystem` bursts on impact/death (e.g., spark hitting floor $\rightarrow$ 4 micro-sparks; raindrop $\rightarrow$ splash ring) + optional pooling of up to $N \le 8$ `PointLight` nodes driven by the hottest particles.

### Stage 3 — Volumetric Shading, Soft Particles & Ribbon Trails (`WEB_GPU` & `WEB_GL2`)
- **Idea P2 (Soft Particles via Opaque Scene Depth):**
  - Wire opaque scene depth fade ($\alpha \cdot \text{smoothstep}(0, d_{\text{soft}}, z_{\text{scene}} - z_{\text{particle}})$) and early occlusion `discard` into `SmokeSpriteMaterial` and `FireEmberMaterial` (graceful no-op fallback on `WEB_GL1`).
- **Procedural 6-Way Volume Smoke Lighting (EmberGen / Frostbite Principle, Zero Texture Overhead):**
  - Derive directional self-shadowing and forward-scattering rim lobes analytically from the 3-octave FBM density gradient inside `SmokeSpriteMaterial` against scene directional and point lights.
- **`ParticleTrailRenderer` (Ribbon / Trail Strips):**
  - Zero-GC ring-buffer history strip renderer generating camera-facing triangle ribbons with UV tiling and age fade behind moving emitters or leader particles.

### Stage 4 — WebGPU Autonomous Compute (`GPUParticleSystem`) & Scene-Aware Weather
- **Idea G1 (WebGPU Compute + `drawIndexedIndirect`):**
  - 3-stage WGSL compute pipeline (`csEmit` $\rightarrow$ `csSimulate` $\rightarrow$ `csPrepareIndirect`) using `atomic<u32>` counters on `deadIndices` and ping-pong `aliveIndices`, driving `drawIndexedIndirect` with zero CPU readback for 50k–250k particles.
- **Idea C2 (Screen-Space Depth + `ADR 0028` Thin Normal Buffer Collision):**
  - 2-texel-load GPU collision against arbitrary visible scene triangles using SWM's existing Opaque Depth Buffer + `ADR 0028` Thin Normal Buffer MRT (`0 MB` extra VRAM).
- **Top-Down Ortho Heightfield Collision for `WeatherEmitter` (Godot 4 Pattern):**
  - Single $256 \times 256$ orthographic top-down depth capture around the camera so rain, snow, and ash automatically stop on roofs, bridges, and overhangs and trigger splash sub-emitters.
