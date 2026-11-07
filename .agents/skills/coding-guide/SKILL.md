---
name: coding-guide
description: Coding standards, TypeScript templates, guard clauses, hot-path performance rules, and shader math optimization references.
---

# Small World Machine Coding Guide

This guide provides templates, clean code standards, and shader optimization patterns for the Small World Machine.

---

## 1. TypeScript Standards & Templates

All TypeScript source files must adhere to strict type-safety, explicit visibility modifiers, and correct relative imports.

### Import Template

Do NOT start `.ts` files with a relative-path header comment (e.g. `/// src/core/materials/ExampleMaterial.ts`) — that convention was deliberately removed project-wide in changelog `[0.69.9]`; adding it back reintroduces exactly what that purge eliminated. Ensure relative imports explicitly end in `.js` (required by runtime resolution).

```typescript
import { Material } from "./Material.js";
import { Color } from "../../math/Color.js";
import { Vector3D } from "../../math/Vector3D.js";

export class ShowcaseMaterial extends Material {
  public color: Color;
  private _shininess: number;

  constructor(color: Color, shininess: number) {
    super();
    this.color = color;
    this._shininess = shininess;
  }

  public getShininess(): number {
    return this._shininess;
  }

  public setShininess(value: number): void {
    this._shininess = value;
  }
}
```

### Code comments

Write self-documenting code. Comments are for what the code cannot say.

- **Never explain WHAT the code does.** If logic needs narration, rewrite it. A comment that restates the line below it, or a docblock that repeats the method name, is a defect.
- **Only explain WHY:** non-obvious intent, a business or regulatory constraint, an ordering requirement, a workaround for an external system, or why an obvious alternative was not used.
- **Refactor before you comment.** Extract a named variable for a complex condition, extract a method for a dense block, or rename until the comment is redundant. A comment standing in for a name should become the name.
- Keep the JSDoc that public APIs require (parameter/return types, `@inheritdoc`, non-obvious contracts). Those are documentation, not narration.
- If a reader cannot follow the implementation without the comments, the code is not finished.

### Naming Conventions & Typing

- **PascalCase** for types, classes, interfaces, and enums (e.g. `ExampleMaterial`, `Vector3D`).
- **camelCase** for variables, properties, methods, and parameters (e.g. `color`, `setShininess`).
- **Underscore prefix (`_`)** for private and protected class members and properties (e.g. `_shininess`).
- **Types:** Explicit types, access modifiers, and **NO `any`**. Every function and method MUST have an explicit return type (e.g., `(): void`). In test files, explicitly mute the line if bypassing a private method.

### Strict Coding Constraints

- **UI/DOM:** Never use `@ts-nocheck` or `any` when dealing with DOM elements. Always cast explicitly to specific types like `HTMLElement`, `HTMLCanvasElement`, `HTMLInputElement`.
- **DOM Assignments:** Never use optional chaining on the left side of an assignment (e.g. `el?.style.cursor = 'pointer'`). It crashes bundlers like Esbuild/Rolldown. Always use explicit `if (el)` checks.
- **No Magic Strings/Numbers:** Never write a raw string/number literal that represents a fixed, named concept. Check `src/enums/` first. If no enum exists for a genuinely new fixed concept, add one to `src/enums/`.
- **Enum `DEFAULT` Member:** If an enum has one canonical fallback value, give the enum a `DEFAULT` member set to that value instead of repeating the concrete member everywhere.
- **Resource Loading:** Instantiate and load resources using static factory methods (e.g., `Texture.fromUrl()`).

---

## 2. Control Flow: Guard Clauses & Early Returns

To maximize readability and reduce nesting, use guard clauses instead of deep `if-else` branching.

### ❌ Bad (Deeply Nested)

```typescript
public processInput(input: InputDevice): void {
  if (input.isConnected()) {
    if (input.hasKey("Space")) {
      if (this.canJump) {
        this.jump();
      }
    }
  }
}
```

### ✅ Good (Flat Guard Clauses)

```typescript
public processInput(input: InputDevice): void {
  if (!input.isConnected()) {
    return;
  }
  if (!input.hasKey("Space")) {
    return;
  }
  if (!this.canJump) {
    return;
  }

  this.jump();
}
```

---

## 3. Shader Math Optimizations ("Math is Cheaper than Memory")

When writing WGSL or GLSL shaders, minimize texture fetches and branching in favor of analytical math and branch-free step-wise interpolations.

### A. Replacing Noise Textures with Procedural Hash

Instead of sampling a high-latency noise texture for grain, water, or glitch effects, generate pseudo-random numbers analytically on the GPU.

```wgsl
// Fast procedural 2D hash/noise in WGSL
fn random(st: vec2f) -> f32 {
    var p3 = fract(vec3f(st.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
```

### B. Branch-Free Interpolation (GLSL & WGSL)

Avoid branching (`if/else`) inside pixel shaders. Replace them with `clamp` and `mix` / `select` functions to keep GPU pipelines linear.

#### ❌ Bad (Branching Color Grading)

```wgsl
if (luma < 0.3) {
    srgb = mix(cold, warm, luma / 0.3);
} else if (luma < 0.7) {
    srgb = mix(warm, hot, (luma - 0.3) / 0.4);
} else {
    srgb = mix(hot, whiteHot, (luma - 0.7) / 0.3);
}
```

#### ✅ Good (Branch-Free Clamp and Mix)

````wgsl
let c1 = mix(cold, warm, clamp(luma / 0.3, 0.0, 1.0));
let c2 = mix(c1, hot, clamp((luma - 0.3) / 0.4, 0.0, 1.0));
srgb = mix(c2, whiteHot, clamp((luma - 0.7) / 0.3, 0.0, 1.0));

---

## 3B. Hot-Path TypeScript Performance ("Zero Allocation in the Loop")

Any code reachable from the per-frame render/update loop (`Scene.update`, `Renderer.render`, behaviors, animation mixers, physics stepping, culling) is a **hot path**. Outside of hot paths, write normal, readable TypeScript — do not micro-optimize one-shot setup/loader/editor code.

- **No per-frame allocation:** Never `new Vector3D()`, `new Matrix4()`, `new Array()`, or create closures/arrow-function callbacks inside a method called every tick. Reuse a scratch instance held as a private field (`_scratchVec3`), or pass an output parameter to write into (`target: Vector3D`) instead of returning a new object.
- **Reused scratch objects are not shared state:** never let a scratch field leak past the call that fills it — a caller must copy out the values it needs before the next call overwrites the scratch object. Document this contract at the method, and never store a reference to a returned scratch object.
- **Classic `for` loops over iterator chains:** In a hot path, use `for (let i = 0; i < arr.length; i++)` instead of `.map/.filter/.forEach/.reduce/for-of` on arrays — those allocate intermediate arrays/iterators and add call overhead. `.map/.filter` are fine in setup/one-shot code.
- **Typed arrays for bulk numeric data:** Prefer `Float32Array`/`Uint16Array`/etc. over `number[]` or arrays-of-objects for vertex/particle/instance data — better cache locality, no per-element boxing.
- **Stable object shapes (monomorphism):** Initialize every field in the constructor, even to a default/zero value. Never add or `delete` a property after construction, and never assign a field a different type across instances — V8 deoptimizes megamorphic access patterns.
- **Hoist repeated lookups:** Cache `arr.length`, `this.someArray`, and repeated property/nested-path reads into a local `const` before a loop instead of re-reading them every iteration.
- **No string concatenation in the loop:** Avoid building strings (e.g. cache keys, debug labels) inside per-frame code paths.
- **Direct property reads over trivial getters in the innermost loop:** If a getter just returns a field, prefer reading `obj._field` directly in the innermost hot loop (still respecting normal encapsulation everywhere else) rather than routing through an accessor call thousands of times a frame.
- Trust `npm run build:lib` + `npm run test` to catch correctness regressions from these changes; performance claims themselves should be backed by a quick before/after profile (`performance.now()` around the loop, or the browser profiler) when the change is non-trivial, not just asserted.

---

## 4. Rendering Pipeline & Shader Parity

### A. General Rendering Rules
- **Order:** Opaque first, transparent sorted back-to-front (descending `distB - distA`).
- **Culling:** Frustum culling via `frustum.intersectsVolume(obj.bounds)`.
- **Colors:** Linear space math, final output gamma-corrected (sRGB). Diffuse + Specular <= 1.0.
- **Resources:** Explicit bitwise-OR usage flags. Bind `onuncapturederror`.
- **Shaders:** One final post-process pass (tone map, color grade, vignette, gamma). Compute shaders with workgroup memory for spatial ops.

### B. Shader Language Parity

Since the engine supports both pipelines, use this mapping guide to keep GLSL (WebGL2) and WGSL (WebGPU) shaders aligned.

#### Common Syntax Translation Table

| Feature / Concept | WebGL2 GLSL (glsl300) | WebGPU WGSL (wgsl) | Notes / Details |
| :--- | :--- | :--- | :--- |
| **Float Vectors** | `vec2`, `vec3`, `vec4` | `vec2f`, `vec3f`, `vec4f` | Or use `vec2<f32>` format |
| **Integers / Unsigned** | `int`, `uint` | `i32`, `u32` | WGSL uses `u` suffix for unsigned (e.g. `1u`) |
| **Texture Sample** | `texture(sampler, uv)` | `textureSample(texture, sampler, uv)` | WGSL separates sampler and texture bindings |
| **Condition Mix / Selection** | `mix(a, b, t)` / `cond ? a : b` | `mix(a, b, t)` / `select(a, b, cond)` | WGSL **does not support** ternary `? :` operators |
| **Matrix Type** | `mat4` | `mat4x4f` | Or `mat4x4<f32>` |
| **Matrix Multiply** | `projection * view * pos` | `projection * view * pos` | Both are column-major, right-to-left evaluation |

### C. WGSL Uniform Buffer Layout (The 16-byte Alignment Rule)
WebGPU uniform buffers require strict memory alignments. Members of structs must align to 16 bytes for vector types:
*   `vec3f` (and `vec4f`) takes 16 bytes.
*   If a `vec3f` is followed by an `f32`, they can sit in the same 16-byte boundary (12 bytes for vec3 + 4 bytes for float).
*   If a `vec3f` is followed by another struct or array, it requires 4 bytes of padding.

```wgsl
struct PostUniforms {
    exposure: f32,          // offset 0 (4 bytes)
    inverseGamma: f32,      // offset 4 (4 bytes)
    toneMappingMode: u32,   // offset 8 (4 bytes)
    vignetteEnabled: u32,   // offset 12 (4 bytes) -> Total 16 bytes boundary

    vignetteOffset: f32,    // offset 16 (4 bytes)
    vignetteDarkness: f32,  // offset 20 (4 bytes)
    vignetteRoundness: f32, // offset 24 (4 bytes)
    grainEnabled: u32,      // offset 28 (4 bytes) -> Total 16 bytes boundary

    grainIntensity: f32,    // offset 32 (4 bytes)
    time: f32,              // offset 36 (4 bytes)
    bloomEnabled: u32,      // offset 40 (4 bytes)
    bloomIntensity: f32,    // offset 44 (4 bytes) -> Total 16 bytes boundary

    bloomColor: vec3f,      // offset 48 (12 bytes)
    filterMode: u32,        // offset 60 (4 bytes) -> Packs perfectly with vec3f into 16 bytes!
}
```

Ensure CPU-side memory mapping (`Float32Array` or `DataView`) matches this layout index-for-index.

### D. Shader Template Chunks & Pre-Processor Token Discipline

Small World Machine replaces template tokens (z. B. `[WGSL_LIGHTING]`, `[CHUNK_NAME]`) string-basiert zur Compile-Zeit.
- **Keine Makro-Tokens in Kommentaren:** Schreibe niemals Template-Tokens wörtlich in erklärende Kommentare (z. B. `// [WGSL_LIGHTING] computes...`). Der String-Replacer ersetzt alle Vorkommnisse blindlings, was mehrzeiligen Shader-Code in eine Kommentarzeile injiziert und Syntax-Fehler verursacht.
- **Eindeutige Token-Präfixe:** Template-Slots müssen immer in eckigen Klammern und eindeutigem Schema definiert sein (z. B. `// [HOOK_LIGHTING]`).

### E. WGSL Scope Isolation & Variable Shadowing

WGSL verbietet strikt das Shadowing von Parametern der Entry-Point-Funktion (z. B. `fn fs_main(i: VertexOutput)`).
- **Keine Parameter-Redeklaration:** Ein `let i = ...` oder `var i = ...` führt zu einem WGSL-Validierungsfehler (`redeclaration of parameter 'i'`).
- **Scope Isolation für Template-Chunks:** Wenn ein injizierter Shader-Chunk feste Variablennamen wie `i.n` oder `i.wp` erwartet, muss die modifizierte Version in einem eigenen Block-Scope gekapselt werden:
  ```wgsl
  // Vorbereitende Berechnungen (z. B. Normalen-Perturbation)
  var mod_i = i;
  mod_i.n = perturbed_normal;
  {
      let i = mod_i; // Erlaubt innerhalb eines inneren Blocks
      [WGSL_LIGHTING_CHUNK]
  }
  ```

---

## 5. Testing Guide & Mocking Patterns

We use **Vitest** for running unit tests on behaviors, math, and materials without requiring a browser window or GPU hardware.

### A. Material Parameter Test Template

Tests for materials should verify that parameter modifications update CPU storage correctly, and that shaders compile.

```typescript
import { describe, it, expect } from "vitest";
import { ExampleMaterial } from "../../src/core/materials/ExampleMaterial.js";
import { Color } from "../../src/math/Color.js";

describe("ExampleMaterial", () => {
  it("should store and update color and shininess parameters", () => {
    const mat = new ExampleMaterial(Color.RED, 30);
    expect(mat.color.equals(Color.RED)).toBe(true);
    expect(mat.getShininess()).toBe(30);

    mat.setShininess(50);
    expect(mat.getShininess()).toBe(50);
  });
});
```

### B. Mocking WebGL/Canvas Contexts

When a test instantiates parts of the renderer, mock the DOM `HTMLCanvasElement` using Vitest:

```typescript
import { vi } from "vitest";

// Mock minimal canvas and WebGL context
const mockContext = {
  viewport: vi.fn(),
  clearColor: vi.fn(),
  clear: vi.fn(),
  createShader: vi.fn(() => ({})),
  shaderSource: vi.fn(),
  compileShader: vi.fn(),
  getShaderParameter: vi.fn(() => true),
};

vi.stubGlobal("document", {
  createElement: vi.fn(() => ({
    getContext: vi.fn(() => mockContext),
    addEventListener: vi.fn(),
  })),
});
```
