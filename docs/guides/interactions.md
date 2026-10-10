# Gamification & Interactions

The Small World Machine provides a built-in interaction layer via the `InteractionManager`. This system lets you react to mouse and touch events directly on 3D objects in the scene, through a performance-optimized, octree-based raycasting pipeline.

## 1. Setup

The `InteractionManager` is instantiated automatically during the `SmallWorldMachine` lifecycle and is available as `this.interactionManager`.

To make an object respond to pointer events, you only need to mark it as pickable and assign your event callbacks:

```typescript
const mesh = new Object3D("InteractiveCube");
mesh.geometry = new Cube({ size: 1.0 }).getGeometryData();
mesh.material = new StandardMaterial({ color: Color.RED });

// 1. Enable picking
mesh.isPickable = true;

// 2. Define events
mesh.onPointerEnter = () => {
    mesh.scale.set(1.5, 1.5, 1.5);
};

mesh.onPointerLeave = () => {
    mesh.scale.set(1.0, 1.0, 1.0);
};

mesh.onPointerClick = () => {
    (mesh.material as StandardMaterial).color.set(Math.random(), Math.random(), Math.random());
};

this.scene.add(mesh);
```

## 2. Octree Acceleration (Performance)

A naive raycaster iterates over all $O(n)$ objects in the scene every frame, which tanks the frame rate in large scenes. Small World Machine accelerates interactions via a spatially partitioning **octree** that rejects most objects with cheap bounds checks instead of a full linear pass.

To use octree acceleration, initialize the scene's octrees and declare your static objects:

```typescript
// Define the dimensions of your interactive world
const bounds = new BoundingBox(new Vector3D(-50, -50, -50), new Vector3D(50, 50, 50));
this.scene.initOctrees(bounds);

const mesh = new Object3D("Tree");
mesh.isStatic = true; // Marks the object as static so it is included in the static octree
mesh.isPickable = true;
this.scene.add(mesh);

// Once your static objects are added, build the octree:
this.scene.updateStaticOctree();
```

Once an octree is present, the `InteractionManager` automatically uses `Octree.queryRay()` to instantly discard thousands of objects without performing a single expensive intersection test.

## 3. Ready-Made Behaviors

Small World Machine includes built-in behaviors you can attach directly to objects for rapid prototyping.

### HoverBehavior

Smoothly scales an object up on hover and makes it glow in a neon color.

```typescript
import { HoverBehavior } from "@small-world-machine/engine";

// Scales up to 1.5x on hover
const hover = new HoverBehavior(1.5);
mesh.addBehavior(hover);
```

### DraggableBehavior

Allows objects to be freely dragged and dropped in 3D space. The object moves along a plane that is perfectly aligned with the camera.

```typescript
import { DraggableBehavior } from "@small-world-machine/engine";

// Requires the active camera to compute the drag plane
const draggable = new DraggableBehavior(this.camera);
mesh.addBehavior(draggable);
```

> **Note:** These behaviors set `isPickable = true` automatically as soon as they are attached to an object.

## 4. Pixel-Precise Picking (Möller-Trumbore)

For high-precision applications such as CAD tools or shooters, the raycaster uses a hybrid approach:
1. First, the **octree** (or the AABB bounding box) is queried to quickly exclude objects the ray clearly misses.
2. If the object has a `geometry`, it dynamically iterates over the mesh's actual triangle vertices and transforms them into world space.
3. It performs a **Möller-Trumbore intersection test** to determine the exact intersection distance `t`.

> **Architecture Note (Broadphase vs. Narrowphase):** The `Raycaster` core class itself is designed strictly as a linear *narrowphase* evaluator. It deliberately contains no spatial acceleration of its own (such as a BVH or an internal octree). Instead, spatial filtering (the *broadphase*) is handled one layer up by systems like the `InteractionManager` (via `scene.staticOctree.queryRay`), which then hands the `Raycaster` only the drastically reduced list of candidate objects. This clear separation of responsibilities keeps the raycaster simple and avoids redundant acceleration structures.

This guarantees that even transparent gaps or irregular meshes remain pixel-precisely clickable.
