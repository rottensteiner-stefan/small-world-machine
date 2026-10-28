# Architecture & Code Showcases

Small World Machine has a modular design and favors composition over deep inheritance. Below is an overview of the key classes, interfaces, and parameters you'll work with day to day, along with concrete code examples to get started.

::: tip API Reference
For a complete list of _all_ classes, methods, and type declarations (including constructor parameters), open the auto-generated **[API Reference](/api/index.html)**.
:::

---

## 1. Scene Graph (`Object3D`)

The heart of the engine is the `Object3D` class. Everything that exists in the world (meshes, cameras, virtual anchors) is an `Object3D` or inherits from it. It manages local and global transformation matrices, geometry, and material.

### Showcase: Creating and placing an object

```typescript
import { Object3D, Cube, StandardMaterial, Color } from "@small-world-machine/engine";

const player = new Object3D("Player");

// Position (X=Right, Y=Up, Z=Backward)
player.position.set(0, 1, 0);

// Scale and rotation
player.scale.set(2, 2, 2);
player.rotation.y = Math.PI / 4; // 45 degrees

// Assign geometry and material
player.geometry = new Cube({ size: 1 }).getGeometryData();
player.material = new StandardMaterial({
  color: Color.RED,
  metallic: 0.1,
  roughness: 0.8,
});

// Attach child objects (hierarchy)
const weapon = new Object3D("Weapon");
weapon.position.set(1, 0, 0); // Relative to the player!
player.add(weapon);

// Add to the scene
this.scene.add(player);
```

---

## 2. Cameras & Behaviors

The engine uses a unified camera architecture. The base `Camera` is parameterized by a projection (`PerspectiveProjection` or `OrthographicProjection`) and driven dynamically through the **Behavior system**. Procedural, one-shot camera effects (shake, flash, ...) are a separate mechanism: the **CameraEffect system**, added via `camera.addEffect()` or `camera.applyEffect()` rather than `addBehavior()`.

### Showcase: Camera with controller and shake effect

```typescript
import { Camera, PerspectiveProjection, FirstPersonController, ShakeEffect } from "@small-world-machine/engine";

// Create a camera with a perspective projection
const camera = new Camera(new PerspectiveProjection({ fov: MathUtils.degToRad(60), near: 0.1, far: 1000 }));

// Attach a controller directly as a Behavior
camera.addBehavior(
  new FirstPersonController({
    moveSpeed: 10.0,
    rotationSpeed: 2.0,
  })
);

// Add a procedural trauma-based camera shake effect for impacts
camera.addEffect(new ShakeEffect(0.5, 0.5));
```

---

## 3. Materials & Shaders (PBR & built-in presets)

Small World Machine uses a hybrid rendering pipeline (WebGPU, WebGL2, WebGL1) built on the Cook-Torrance BRDF model with linear color space and sRGB gamma correction.

### Key material families

- `StandardMaterial`: Core PBR material with `color`, `metallic`, `roughness`, and diffuse/normal/roughness map slots.
- `GlassMaterial`: Glass material with a configurable `ior`.
- `SpriteMaterial`: Camera-facing 2D/2.5D billboard material.
- **Wave family (ADR 0013):**
  - `OpenWaterMaterial`: Realistic ocean water with Gerstner waves and opaque depth fade (soft shorelines).
  - `StylizedWaterMaterial`: Stylized/toon water with adjustable edge foam and cel shading.
- **Flow family (ADR 0013):**
  - `LavaMaterial`: Opaque, glowing molten rock with adjustable emissive intensity and noise-driven viscosity.
  - `SlimeMaterial`: Translucent, viscous preset with a subtle glowing edge rim.

### Showcase: Lava material with emissive glow

```typescript
import { LavaMaterial, Color, Object3D, Plane } from "@small-world-machine/engine";

const lava = new Object3D("LavaLake");
lava.geometry = new Plane({ width: 50, height: 50, widthSegments: 32, heightSegments: 32 }).getGeometryData();
lava.material = new LavaMaterial({
  color: new Color(0.25, 0.03, 0.0),
  emissiveColor: new Color(1.0, 0.35, 0.05),
  emissiveStrength: 2.0,
  flowSpeed: 0.4,
});

this.scene.add(lava);
```

---

## 4. Behaviors & State Machines (FSM)

Complex logic should not be crammed into one giant `update()` loop. Instead, use the **Behavior system** to attach isolated blocks of logic (components) to an `Object3D`.

### Showcase: A Pulse behavior

```typescript
import { Behavior, Object3D } from "@small-world-machine/engine";

export class PulseBehavior extends Behavior {
  private _speed: number;
  private _baseScale: number;
  private _elapsed: number = 0;

  constructor(speed: number = 2.0) {
    super();
    this._speed = speed;
    this._baseScale = 1.0;
  }

  // Called when the behavior is attached to the object via obj.addBehavior()
  public override onAttach(target: Object3D): void {
    this._baseScale = target.scale.x;
  }

  // Called automatically every frame by the Scene, receiving only deltaTime
  public override update(deltaTime: number): void {
    if (!this.target) return;
    this._elapsed += deltaTime;

    // Compute a sinusoidal pulse
    const scale = this._baseScale + Math.sin(this._elapsed * this._speed) * 0.2;
    this.target.scale.set(scale, scale, scale);
  }
}

// Usage:
const heart = new Object3D("Heart");
heart.addBehavior(new PulseBehavior(5.0));
```

As states grow more complex (e.g. `IDLE` -> `WALK` -> `ATTACK`), use the built-in `StateMachine` module, which integrates seamlessly into behaviors via `StateMachineBehavior`.

---

## 5. Resource Management & Garbage Collection

Unlike older graphics engines, where `dispose()` must be called manually on geometries, textures, and materials to avoid GPU memory leaks, **Small World Machine uses automated internal reference counting**.

### How it works
Every geometry buffer, shader program, and texture is tracked by the active renderer (WebGL1, WebGL2, or WebGPU).
When an `Object3D` is removed from the `Scene`, the engine decrements the reference counters for the object's resources. Once a resource's reference counter reaches zero, the engine automatically queues it for deletion and safely destroys the underlying GPU object.

```typescript
// Adding an object increments the reference counters for its geometry and material textures
this.scene.add(myObject);

// ... later ...

// Removing the object decrements the reference counters.
// If no other object uses the same geometry/textures, they are automatically freed from VRAM!
this.scene.remove(myObject);
```
*(Note: `RenderTarget` textures are exempt from this automated cleanup, since their lifecycle is managed explicitly by the render pipeline rather than by individual objects.)*

---

## 6. Whack-a-Mole-Doktrin (verbindlich für neue ADRs & Refactorings)

> *(Dieser Abschnitt ist bewusst Deutsch — konsistent zu den ADRs und gemäß Moderatoren-Ruling D14/Q7.
> Er ist der öffentliche Anker für die Doktrin; maßgeblich ist [ADR 0047](../adr/0047-whack-a-mole-doktrin.md).)*

Die **Whack-a-Mole-Doktrin** (ADR 0047, Ruling R6) verankert die 5 Goldenen Prinzipien (S2 §4) als
**verbindliche Leitlinie** gegen Schleichkomplexität — pragmatisch, nicht dogmatisch. Jeder neue ADR
und jedes Refactoring im auditieren Hot-Scope ist daran zu messen:

1. **P1 — Invariante Domänen-Parameter statt Leaky Implementation Knobs.** Jeder neue öffentliche
   Parameter benennt eine physikalische/künstlerische Größe (`@domain`), ist abgeleitet (`@derived`)
   oder bewusst eingefroren (`@fixed`) — mit einzeiliger Bedeutung. Ein Knob ohne ehrliche
   Klassifikation wird abgeleitet oder eingefroren, nie als weiterer Regler exponiert.
2. **P2 — Rule of Three.** Eine neue geteilte Abstraktion entsteht erst nach ≥3 semantisch
   verschiedenen Konsumenten mit identischem Mathe-Block (im ADR benannt). Renderer-Shared-
   Infrastructure (ADR-0038-GL-Ebene) ist ausgenommen.
3. **P3 — Explizite State-Transitions.** Modeful Objekte (Strategien, Material-Familien,
   Lifecycle-Phasen) konvertieren Zustand beim Wechsel explizit (Konverter oder gekapselter
   Per-Mode-Zustand) und liefern einen Live-Transition-Test; kein Objektidentitäts-Kontrollfluss.
4. **P4 — Invariante/metamorphische Tests.** Mathematische Behauptungen referenzieren die
   Invarianten-Registry (`@invariant <ID>`, Seed in ADR 0047) und werden gegen Relationen
   (Erhaltung, Monotonie, Invertierbarkeit) statt Momentaufnahmen getestet.
5. **P5 — Fail-Closed & Bounds-Clamping an API-Grenzen.** Risiko-Skalareingänge werden explizit
   behandelt (clamp/NaN-Guard/Nenner `> epsilon`); fehlende **render-kritische** optionale
   Capabilities lösen den dokumentierten ehrlichen Fallback aus (ADR-0043-Muster), nie einen
   NaN-Frame.

**Zwei Durchsetzungsklassen:** Klasse-A-Kontrakte (Klassifikation, Registry-ID, Transitionstest,
ADR-Compliance-Abschnitt) binden sofort; Klasse-B-Heuristiken (Dead-Knob, Sentinel-Identity, …)
starten advisory und verdienen ihre Schärfe erst nach 3 Echtfängen (verbucht im Ledger). Der
Zero-False-Positives-Erstlauf, der Escape-Hatch mit Pflicht-Begründung (`// doctrine-ignore: <regel>
<warum>`) und die Sunset-Klausel sind verbindlicher Vertragstext.

**Scope:** Pflicht im auditierten Hot-Scope (Cameras, Controllers, Behaviors, Culling, Lights,
Materials, `Object3D`, Physix, Render-Loop, Shader); Setup-/Loader-/Editor-Code ist befreit.
Bestehende Parameter müssen **nicht** nachgetaggt werden (kein historisches Retrofitting).

**Prüfmechanismus:** `npm run check:doctrine` (ein Skript `.agents/scripts/check-doctrine.ts`, Exit 0/1/2,
kein ESLint-Plugin, kein Framework — R6); Class-B-Heuristiken unter `--enable-advisory`. Fang- und
Rekalibrierungs-Nachweis: committed Ledger `../reference/doctrine-ledger.md`. Jedes künftige ADR
trägt den Pflichtabschnitt **„Doctrine Compliance"** (Vorlage in ADR 0047).

### Doctrine Gate Checklist (eine Seite, fünf Fragen — Review-Pflicht)

1. **P1:** Enthält dieser PR neue öffentliche Parameter im Hot-Scope? → Klassifikation
   `domain|derived|fixed` + einzeilige Bedeutung; tote Knobs entfernt oder begründet?
2. **P2:** Extrahiert/verbreitert dieser PR eine geteilte Abstraktion? → ADR mit ≥3 konkreten
   Konsumenten und dem geteilten Mathe-Block (oder ADR-0038-Ausnahme)?
3. **P3:** Berührt er ein modeful Objekt? → explizite Transition-Semantik + Live-Transition-Test?
4. **P4:** Enthält er mathematische Behauptungen? → Invarianten-Registry-ID + Regressions-Abdeckung?
5. **P5:** Enthält er riskante Skalar-Eingänge? → Grenz-Politik (clamp/NaN-Guard/Fallback) +
   Corner-Test (Namenskonvention `NaN`/`Infinity`/`clamp`/`boundary`/`outOfBounds`/`zero`/`negative`)?
