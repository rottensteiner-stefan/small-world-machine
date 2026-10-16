# Physics, Collision Detection & Constraints

The Small World Machine includes a custom-built, highly optimized, and deterministic 3D physics engine based on **semi-implicit Euler** integration and a **Projected Gauss-Seidel (PGS)** constraint solver. It handles collision detection, dynamic position correction, 3D moments of inertia, real Coulomb friction, raycast/shape-cast queries, trigger zones, and a modular joint system — all under strict adherence to a "zero allocation on the hot path" architecture.

---

## 1. Architecture & Simulation Loop

The physics system is fully decoupled from the render loop. It uses a fixed-timestep accumulator to guarantee simulation-critical netcode determinism and mathematical stability independent of varying display refresh rates (e.g. 60 Hz, 144 Hz, ProMotion).

```
                  ┌──────────────────────────────────────────────────────────┐
                  │                 RequestAnimationFrame Loop                │
                  └─────────────────────────────┬────────────────────────────┘
                                                │ (Variable Render deltaTime)
                                                ▼
                                  ┌───────────────────────────┐
                                  │   Accumulator += deltaTime │
                                  └─────────────┬─────────────┘
                                                │
                       ┌────────────────────────▼────────────────────────┐
                       │  while (accumulator >= fixedTimeStep)           │
                       │    1. Continuous Force Accumulation (Springs)   │
                       │    2. Velocity Integration (Euler)              │
                       │    3. Continuous Collision Detection (CCD)      │
                       │    4. Position Displacement & Matrix Sync       │
                       │    5. Angular Velocity Integration              │
                       │    6. Broadphase (Octree / Fat-AABB Caching)    │
                       │    7. PGS Iterative Solver (Contacts + Joints)  │
                       │    8. Inactivity & Sleeping State Evaluation    │
                       │    accumulator -= fixedTimeStep                 │
                       └────────────────────────┬────────────────────────┘
                                                │
                                                ▼
                                  ┌───────────────────────────┐
                                  │ Render State Interpolation │
                                  │ (Decoupled Visual Smooth) │
                                  └───────────────────────────┘
```

### Wiring into the game loop

`SmallWorldMachine` already owns a built-in `PhysicsSystem` instance on `this.physics`, created for you in the constructor. Pass `enablePhysics: true` (and, optionally, a `gravity` vector) in the engine config, and the base class steps it automatically every frame — you generally do not need to instantiate your own `PhysicsSystem`:

```typescript
import { SmallWorldMachine } from "@small-world-machine/engine";

export class MyGame extends SmallWorldMachine {
  public constructor() {
    super({
      enablePhysics: true,      // Step the built-in `this.physics` automatically every frame
      gravity: [0, -9.81, 0],   // Initial gravity vector (default: -9.81 on Y)
    });
  }

  protected override init(): void {
    this.physics.fixedTimeStep = 1 / 60; // 60 Hz physics tick
    this.physics.solverIterations = 6;   // PGS iterations for stacking stability
  }

  protected override update(deltaTime: number): void {
    // Physics stepping and render interpolation are already handled by SmallWorldMachine.
    // Just add gameplay logic & camera updates here.
  }
}
```

---

## 2. Static vs. Dynamic Bodies (`RigidBody`)

An `Object3D` becomes physically active by assigning it a `RigidBody` (`packages/engine/src/physix/RigidBody.ts`) component:

```typescript
import { Object3D, RigidBody, Vector3D } from "@small-world-machine/engine";

const box = new Object3D("DynamicBox");
const rb = new RigidBody(2.5); // Mass = 2.5 kg (dynamic)

// Material & impact properties
rb.restitution = 0.2;         // Elasticity / bounciness (0.0 = clay/putty, 1.0 = superball)
rb.friction = 0.6;            // Coulomb friction coefficient (0.0 = ice, 1.0 = high grip)
rb.linearDamping = 0.99;      // Atmospheric drag (1.0 = no drag)
rb.angularDamping = 0.98;     // Rotational drag

box.rigidBody = rb;
scene.add(box);
```

### Body types at a glance

| Type | Constructor / Mass | Behavior |
| :--- | :--- | :--- |
| **Dynamic** | `new RigidBody(mass > 0)` | Fully reacts to gravity, forces, torques, and collisions. |
| **Static (RigidBody)** | `new RigidBody(0)` | Infinitely heavy, immovable. Reflects dynamic bodies with 100% counterforce. |
| **Static (StaticCollider)** | `new StaticCollider(bounds)` | Ultra-lightweight obstacle outside the scene graph (terrain, architecture, walls). |

---

## 3. Collision Detectors & Bounding Volumes

`PhysicsSystem` uses bounding volumes for precise intersection and impulse calculations. Small World Machine implements analytical narrowphase solvers for every combination:

```
                  ┌─────────────────┐       ┌─────────────────┐
                  │ BoundingSphere  │       │   BoundingBox   │
                  │ (Radius, Center)│       │ (Axis-Aligned)  │
                  └────────┬────────┘       └────────┬────────┘
                           │                         │
                           │    Analytical Solver    │
                           │   (15-Axis SAT / GJK)   │
                           │                         │
                  ┌────────┴────────┐       ┌────────┴────────┐
                  │       OBB       │       │   ConvexHull    │
                  │ (Oriented Box)  │       │ (Polyhedron Mesh)│
                  └─────────────────┘       └─────────────────┘
```

### Supported detectors

1. **`BoundingSphere`:**
   - The fastest of all collision checks.
   - Fully rotation-invariant; rolls perfectly across surfaces.
   ```typescript
   import { BoundingSphere } from "@small-world-machine/engine";
   sphereObj.bounds = new BoundingSphere(sphereObj.position, 0.5);
   ```

2. **`BoundingBox` (AABB):**
   - Axis-aligned box (`min`, `max`, `center`).
   - Ideal for static level geometry, platforms, and floors.
   ```typescript
   import { BoundingBox, Vector3D } from "@small-world-machine/engine";
   floorObj.bounds = new BoundingBox(new Vector3D(-50, -1, -50), new Vector3D(50, 0, 50));
   ```

3. **`OBB` (Oriented Bounding Box):**
   - Rotatable box with local orientation axes and half-extents.
   - Uses the **15-axis Separating Axis Theorem (SAT)** for exact edge-edge and face contacts at arbitrary angles.
   ```typescript
   import { OBB } from "@small-world-machine/engine";
   // Automatically generated by obj.computeBounds() for rotated boxes
   ```

4. **`ConvexHull`:**
   - Convex polyhedral hull built from vertex lists.
   - Ideal for procedural debris pieces (e.g. from `@small-world-machine/physics-extras` Voronoi fracturing).

---

## 4. Collision Layers & Bitmask Filtering

Collisions can be efficiently controlled via 32-bit bitmasks on `Collidable` (`packages/engine/src/interfaces/Collidable.ts`), `Object3D` (`packages/engine/src/core/Object3D.ts`), and `StaticCollider` (`packages/engine/src/physix/StaticCollider.ts`):

$$ \text{canCollide}(A, B) = ((A.\text{layer} \ \& \ B.\text{mask}) \neq 0) \ \land \ ((B.\text{layer} \ \& \ A.\text{mask}) \neq 0) $$

### Standard layer convention

```typescript
export const CollisionLayers = {
  DEFAULT:    1 << 0, // 0x0001: Standard objects / world
  PLAYER:     1 << 1, // 0x0002: Player character
  ENEMY:      1 << 2, // 0x0004: Enemies
  PROJECTILE: 1 << 3, // 0x0008: Projectiles / spells
  DEBRIS:     1 << 4, // 0x0010: Debris & particles
  TRIGGER:    1 << 5, // 0x0020: Sensor zones & checkpoints
} as const;
```

> **Hinweis:** Die Engine exportiert kein solches `CollisionLayers`-Objekt — die konkrete
> Layer-Vereinbarung gehört ins eigene Projekt (im Beispiel oben zum Kopieren als `as const`).
> Die zugrunde liegenden Primitive existieren in der Engine: `Object3D.collisionLayer`
> (Default `1`) und `Object3D.collisionMask` (Default `0xFFFFFFFF`); Kollision findet nur statt,
> wenn beide Filtermasken überlappen (siehe Formel oben).

### Configuration example

```typescript
// Player collides with world, enemies, and debris — ignores its own projectiles
player.collisionLayer = CollisionLayers.PLAYER;
player.collisionMask = CollisionLayers.DEFAULT | CollisionLayers.ENEMY | CollisionLayers.DEBRIS | CollisionLayers.TRIGGER;

// Player projectile only hits walls and enemies
projectile.collisionLayer = CollisionLayers.PROJECTILE;
projectile.collisionMask = CollisionLayers.DEFAULT | CollisionLayers.ENEMY;
```

---

## 5. Trigger System & Lifecycle Events

Triggers are physical sensor volumes (`isTrigger = true`) that register overlaps but exert **no physical repulsion force** on bodies.

Small World Machine provides zero-allocation lifecycle events via the global `EventDispatcher`:

| Event Name | When Fired? | Payload Properties |
| :--- | :--- | :--- |
| `physics:trigger-enter` | On the first intersection of two bodies (trigger) | `objectA`, `objectB`, `normal`, `depth` |
| `physics:trigger-stay` | For as long as bodies remain inside the trigger | `objectA`, `objectB`, `normal`, `depth` |
| `physics:trigger-exit` | On the first frame after leaving | `objectA`, `objectB` |
| `physics:collision-enter`| On the first physical solid-body contact | `objectA`, `objectB`, `normal`, `depth`, `impulse` |
| `physics:collision-stay` | On sustained contact / sliding | `objectA`, `objectB`, `normal`, `depth`, `impulse` |
| `physics:collision-exit` | After the physical contact resolves | `objectA`, `objectB` |
| `physics:sleep` | When a body transitions to the resting state | `object` |
| `physics:wakeup` | When a body wakes up from an impact/force | `object` |

### Example: checkpoint & damage zone

```typescript
const lavaZone = new StaticCollider(
  new BoundingBox(new Vector3D(-10, -1, -10), new Vector3D(10, 0, 10))
);
lavaZone.isTrigger = true;
scene.staticColliders.push(lavaZone);

// Subscribe to the trigger event
events.addEventListener("physics:trigger-enter", (e) => {
  if (e.objectA === player || e.objectB === player) {
    console.log("Player entered the lava zone! Applying damage.");
  }
});
```

---

## 6. Physics Raycast & Query API

The physics query API provides fast line-of-sight checks, hit scans, and spatial volume sweeps with built-in bitmask filtering:

### 1. `physics.raycast` (first hit)

Casts a ray and returns the nearest hit point:

```typescript
import { Ray, Vector3D } from "@small-world-machine/engine";

const origin = player.position;
const down = new Vector3D(0, -1, 0);

// Cast 2 meters downward to detect the ground
const hit = physics.raycast(new Ray(origin, down), 2.0, CollisionLayers.DEFAULT);

if (hit) {
  console.log(`Ground contact at distance: ${hit.distance.toFixed(2)} m`);
  console.log(`Hit point: (${hit.point.x}, ${hit.point.y}, ${hit.point.z})`);
  console.log(`Surface normal: (${hit.normal.x}, ${hit.normal.y}, ${hit.normal.z})`);
}
```

### 2. `physics.raycastAll` (all hits, sorted)

Returns every collider hit along the ray, sorted ascending by distance (ideal for penetrating projectiles or X-ray scans):

```typescript
const hits = physics.raycastAll(new Ray(gunMuzzlePos, shootDirection), 100.0);
for (const hit of hits) {
  applyDamage(hit.object, hit.point);
}
```

### 3. `physics.sphereCast` (volume sweep)

Sweeps a sphere of a given radius along a vector (ideal for thick projectiles, character collision capsules, and evasion sensors):

```typescript
// Check whether a 0.5m-wide character can move 3m forward
const sweepHit = physics.sphereCast(player.position, 0.5, forwardDir, 3.0);
if (!sweepHit) {
  // The path is clear
}
```

---

## 7. 3D Inertia Tensor & Off-Center Impacts

Real bodies rotate with varying ease around their principal moments of inertia ($I_{xx}, I_{yy}, I_{zz}$), depending on their mass distribution.

```typescript
const rb = new RigidBody(10.0); // 10 kg

// Helpers for exact analytical inertia calculation:
rb.setInertiaForBox(1.0, 2.0, 0.5);      // Box (width=1, height=2, depth=0.5)
rb.setInertiaForSphere(1.0);             // Sphere (radius=1)
rb.setInertiaForCylinder(0.5, 2.0);      // Cylinder along Y (radius=0.5, height=2)
```

### Off-center forces and impulses

When an impulse is applied at an eccentric point $\vec{p}$ with lever arm $\vec{r} = \vec{p} - \vec{c}$, Small World Machine computes both the linear acceleration and the resulting torque $\vec{\tau} = \vec{r} \times \vec{J}$:

```typescript
// Push a box forward at its upper-right corner
const cornerPos = new Vector3D(1.0, 2.0, 0.0);
const pushImpulse = new Vector3D(0, 0, -10.0);

// Produces forward motion + immediate backward tumbling
myBox.rigidBody.applyImpulseAtPoint(pushImpulse, cornerPos, myBox.position);
```

---

## 8. Coulomb Friction & Stacking Stability

Small World Machine implements the full **Coulomb friction cone**:

$$ \|\vec{J}_T\| \leq \mu \cdot J_N \quad \text{with} \quad \mu = \sqrt{\mu_A \cdot \mu_B} $$

- **Static friction:** If the tangential impulse lies within the friction cone, the sliding velocity at the contact surface is driven exactly to $0$ (e.g. crates resting on a slope, or spheres rolling without slipping).
- **Dynamic friction:** If the impulse exceeds the limit, the friction force is clamped to $\mu \cdot J_N$, resulting in controlled sliding.

### Stacking & multi-iteration solver

By combining **symmetric Gauss-Seidel relaxation** (`solverIterations = 4..8`) with position projection, stacked crates and rubble piles no longer sink and no longer tend to oscillate.

```typescript
physics.solverIterations = 8; // For extreme stacking stability (e.g. 10+ crates)
```

---

## 9. Constraints & Joint System

Joints couple two bodies (`bodyA` and `bodyB`), or anchor a single body to a fixed world anchor (`bodyB = null`).

```
          ┌────────────────────────────────────────────────────────┐
          │                    Joint (Base Class)                  │
          │ (bodyA, bodyB, anchorA, anchorB, breakForce, enabled)  │
          └───────────────────────────┬────────────────────────────┘
                                      │
        ┌──────────────────┬──────────┴─────────┬──────────────────┐
        │                  │                    │                  │
        ▼                  ▼                    ▼                  ▼
┌───────────────┐  ┌───────────────┐    ┌───────────────┐  ┌───────────────┐
│ DistanceJoint │  │  SpringJoint  │    │BallSocketJoint│  │  HingeJoint   │
│ (Rope / Rod)  │  │(Spring-Damper)│    │ (Ball Joint)  │  │   (Hinge)     │
└───────────────┘  └───────────────┘    └───────────────┘  └───────────────┘
```

### 1. `DistanceJoint` (fixed or bounded distance)

Keeps two anchor points at an exact distance (e.g. pendulums, ropes, rigid struts):

```typescript
import { DistanceJoint, Vector3D } from "@small-world-machine/engine";

const pendulum = new DistanceJoint({
  bodyA: bobMesh,
  anchorA: new Vector3D(0, 0, 0),       // Center of the bob
  anchorB: new Vector3D(0, 10, 0),      // Fixed ceiling anchor at Y=10
  distance: 10.0,                       // Exact rope length
  breakForce: 5000.0,                   // Breaks under extreme forces
});
scene.joints.push(pendulum);
```

### 2. `SpringJoint` (Hookean spring)

Produces damped elastic oscillation following Hooke's law ($F = -k \cdot \Delta x - c \cdot v_{\text{rel}}$):

```typescript
import { SpringJoint } from "@small-world-machine/engine";

const suspension = new SpringJoint({
  bodyA: wheelMesh,
  bodyB: chassisMesh,
  restLength: 1.5,                      // Rest length
  stiffness: 150.0,                     // Spring constant k
  damping: 8.0,                         // Damping constant c
});
scene.joints.push(suspension);
```

### 3. `BallSocketJoint` (3-DOF ball joint)

Locks two anchor points together in 3D ($\vec{p}_A = \vec{p}_B$) while allowing free rotation on all axes (e.g. ragdoll shoulders, trailer hitches):

```typescript
import { BallSocketJoint } from "@small-world-machine/engine";

const shoulder = new BallSocketJoint({
  bodyA: upperArm,
  bodyB: torso,
  anchorA: new Vector3D(0, 0.5, 0),
  anchorB: new Vector3D(0.8, 1.4, 0),
});
scene.joints.push(shoulder);
```

### 4. `HingeJoint` (1-DOF revolute joint / hinge)

Constrains rotation to a single axis. Supports **angle limits** (`minAngle`/`maxAngle`) and an **active motor**:

```typescript
import { HingeJoint, Vector3D } from "@small-world-machine/engine";

const doorHinge = new HingeJoint({
  bodyA: doorMesh,
  anchorA: new Vector3D(-0.8, 0, 0),    // Hinge side of the door
  anchorB: new Vector3D(0, 0, 0),       // Door frame
  axisA: new Vector3D(0, 1, 0),         // Rotate only around the Y axis
  enableLimit: true,
  minAngle: 0.0,                        // Door closed (0°)
  maxAngle: Math.PI * 0.5,              // Opens up to 90°
  enableMotor: true,
  motorSpeed: 1.5,                      // Automatic closing motor (1.5 rad/s)
  maxMotorTorque: 50.0,                 // Maximum motor force
});
scene.joints.push(doorHinge);
```

---

## 10. Continuous Collision Detection (CCD)

For very fast-moving objects (projectiles, balls) that would otherwise skip through thin walls within a single frame (**tunneling**), Small World Machine provides continuous collision detection for spheres, boxes (`BoundingBox`), `OBB`s, and rays:

```typescript
// CCD threshold: how much movement distance (relative to radius) engages CCD
physics.ccdMotionThreshold = 0.5; // Kicks in once displacement exceeds 50% of the body's own size
```

---

## 11. Inactivity, Sleeping & Performance Limits

To conserve CPU resources, Small World Machine automatically puts resting bodies into the `isSleeping` state. Sleeping bodies skip force integration and narrowphase collision tests entirely ($\mathcal{O}(1)$ cost).

```typescript
const rb = myObject.rigidBody;

rb.allowSleep = true;                  // Allow automatic sleeping (default: true)
rb.sleepLinearThreshold = 0.05;        // Velocity threshold (m/s)
rb.sleepAngularThreshold = 0.05;       // Rotation threshold (rad/s)
rb.sleepTimeThreshold = 0.5;           // Required rest duration (0.5s)
```

### Recommended limits & best practices (caps)

| Parameter | Recommended Range | Note |
| :--- | :--- | :--- |
| **Mass ratio** | $\leq 100 : 1$ | Avoids numerical instability at contacts between extremely light and heavy objects. |
| **Max sub-steps** | $4 - 10$ | Prevents the "spiral of death" during massive frame drops (`maxSubSteps = 10`). |
| **Solver iterations** | $4 - 8$ | 4 iterations for action games; 8 iterations for complex crate stacks and joint chains. |
| **Collider choice** | Sphere $\to$ Box $\to$ OBB $\to$ Hull | Prefer simple shapes (sphere/box) wherever possible. |

---

## 12. Practical Recipes

### Recipe: 3D character controller with raycast ground grip

```typescript
import { Object3D, RigidBody, BoundingSphere, Ray, Vector3D } from "@small-world-machine/engine";

export class PlayerController {
  public entity: Object3D;
  private _groundRayDir = new Vector3D(0, -1, 0);

  constructor() {
    this.entity = new Object3D("Player");
    this.entity.bounds = new BoundingSphere(this.entity.position, 0.5);
    
    const rb = new RigidBody(75.0); // 75 kg
    rb.angularDamping = 0.0;        // Rotation is controlled manually via look direction
    rb.restitution = 0.0;           // No rubber-ball effect on landing
    rb.friction = 0.8;
    this.entity.rigidBody = rb;
  }

  public update(physics: PhysicsSystem, inputMove: Vector3D, wantsJump: boolean): void {
    const rb = this.entity.rigidBody!;
    
    // 1. Check whether the player is grounded
    const groundHit = physics.raycast(
      new Ray(this.entity.position, this._groundRayDir),
      0.6, // Radius 0.5 + 0.1 tolerance
      CollisionLayers.DEFAULT
    );

    const isGrounded = groundHit !== null;

    // 2. Control horizontal movement
    rb.velocity.x = inputMove.x * 6.0;
    rb.velocity.z = inputMove.z * 6.0;

    // 3. Execute the jump impulse
    if (isGrounded && wantsJump) {
      rb.applyImpulse(new Vector3D(0, 350.0, 0)); // 75kg * ~4.6 m/s
    }
  }
}
```
