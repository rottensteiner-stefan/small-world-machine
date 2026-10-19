import type { AbstractMaterial } from "@small-world-machine/engine";
import {
  Object3D,
  RigidBody,
  ConvexHull,
  Vector3D,
  BoundingType,
} from "@small-world-machine/engine";
import type { Vec3Like, BoxBounds } from "@small-world-machine/geometry-extras";
import {
  VoronoiCells,
  computeCellFaces,
  cellCentroid,
  VoronoiShardGeometry,
} from "@small-world-machine/geometry-extras";

/**
 * Configuration options for `fractureObject`.
 */
export interface VoronoiFractureOptions {
  /** Explicit seed points, in `target`'s local space. If omitted, `pointCount` random points are generated. */
  points?: readonly Vec3Like[];
  /** The number of random shards to generate when `points` is omitted. Defaults to 12. */
  pointCount?: number;
  /** Seed for the deterministic random point generator. Defaults to 1. */
  seed?: number;
  /** Per-point power-diagram weights (see `@small-world-machine/geometry-extras`'s `VoronoiCells`). */
  weights?: readonly number[];
  /** Lloyd relaxation rounds applied to the seed points before clipping. Defaults to 1. */
  relaxationIterations?: number;
  /**
   * The clipping bounding box, in `target`'s local space. Defaults to
   * `target.geometry.getBoundingVolume()` (a Box, or a Sphere widened to its
   * enclosing box).
   */
  bounds?: BoxBounds;
  /** Shrinks each shard towards its own centroid, opening visible cracks between pieces. Defaults to 0.92. */
  cellPadding?: number;
  /** Total mass split evenly across every produced shard. Defaults to 1. */
  totalMass?: number;
  /** Shard `RigidBody` restitution. Defaults to 0.3. */
  restitution?: number;
  /** Shard `RigidBody` friction. Defaults to 0.9. */
  friction?: number;
  /** Material applied to every shard. Defaults to `target.material`. */
  material?: AbstractMaterial;
  /** World-space point the fracture originates from; if given, shards get an initial outward impulse. */
  impactPoint?: Vec3Like;
  /** Outward impulse strength applied when `impactPoint` is given. Defaults to 2. */
  explosionStrength?: number;
}

/**
 * Reads a Box-shaped (or Sphere, widened to its enclosing box) local bounding
 * volume off `target`'s geometry, for use as the fracture's clipping bounds.
 * @param target The object being fractured.
 * @returns The derived local-space bounds.
 */
function deriveLocalBounds(target: Object3D): BoxBounds {
  if (!target.geometry) {
    throw new Error("fractureObject: target has no geometry to derive fracture bounds from.");
  }
  const bv = target.geometry.getBoundingVolume();
  if (BoundingType.SPHERE === bv.type) {
    const s = bv;
    return {
      min: { x: s.center.x - s.radius, y: s.center.y - s.radius, z: s.center.z - s.radius },
      max: { x: s.center.x + s.radius, y: s.center.y + s.radius, z: s.center.z + s.radius },
    };
  }
  // Geometry-derived bounds are always Box or Sphere; for any exotic custom volume use the
  // enclosing AABB (`getAabb` returns the box itself unchanged), so clipping bounds stay usable.
  const aabb = bv.getAabb();
  return {
    min: { x: aabb.min.x, y: aabb.min.y, z: aabb.min.z },
    max: { x: aabb.max.x, y: aabb.max.y, z: aabb.max.z },
  };
}

/**
 * Shatters `target` into N convex Voronoi fracture shards: each is its own
 * `Object3D`, with its own renderable `VoronoiShardGeometry` and its own
 * `ConvexHull`-bounded `RigidBody`, so `PhysicsSystem` resolves collisions
 * against each piece's actual shape (via the engine's HULL SAT support)
 * instead of a crude box/sphere per shard.
 *
 * If `target` has a parent, the shards are added to it and `target` itself is
 * removed -- the caller is responsible for adding the returned shards
 * themselves if `target` had no parent.
 * @param target The object to fracture. Its geometry supplies the fracture's
 * local clipping bounds; its transform positions every shard.
 * @param options The configuration options.
 * @returns The created shard objects (already parented, unless `target` was unparented).
 */
export function fractureObject(target: Object3D, options: VoronoiFractureOptions = {}): Object3D[] {
  const {
    points,
    pointCount = 12,
    seed = 1,
    weights,
    relaxationIterations = 1,
    bounds = deriveLocalBounds(target),
    cellPadding = 0.92,
    totalMass = 1,
    restitution = 0.3,
    friction = 0.9,
    material = target.material,
    impactPoint,
    explosionStrength = 2,
  } = options;

  // Reuses VoronoiCells purely for its point generation (random + Lloyd
  // relaxation); its own merged mesh is discarded, each shard gets its own
  // separately-clipped cell via computeCellFaces() below.
  const pointSource = new VoronoiCells({
    ...(points ? { points } : {}),
    pointCount,
    seed,
    ...(weights ? { weights } : {}),
    relaxationIterations,
    bounds,
  });
  const seedPoints = pointSource.points;

  interface ShardCell {
    index: number;
    faces: Vec3Like[][];
    centroid: Vec3Like;
  }

  const cells: ShardCell[] = [];
  for (let i = 0; i < seedPoints.length; i++) {
    const faces = computeCellFaces(seedPoints, i, bounds, weights);
    if (null === faces) continue;
    cells.push({ index: i, faces, centroid: cellCentroid(faces) });
  }

  if (0 === cells.length) return [];

  const massPerShard = totalMass / cells.length;
  const shards: Object3D[] = [];

  for (const cell of cells) {
    // Shrunk towards the cell's own centroid (cellPadding) AND re-centered on
    // it (the `- c.*` term), so the shard's local origin is its own center of
    // mass rather than the original target's origin -- required for its
    // ConvexHull collider and RigidBody rotation to behave correctly once it's
    // its own independent object.
    const c = cell.centroid;
    const localFaces = cell.faces.map((face) =>
      face.map((p) => ({
        x: (p.x - c.x) * cellPadding,
        y: (p.y - c.y) * cellPadding,
        z: (p.z - c.z) * cellPadding,
      })),
    );

    const shard = new Object3D(`${target.name || "Fragment"}_shard_${cell.index}`);
    shard.geometry = new VoronoiShardGeometry(localFaces).getGeometryData();
    if (material) shard.material = material;

    shard.rotation.copyFrom(target.rotation);
    if (target.quaternion) shard.quaternion = target.quaternion.clone();
    shard.scale.copyFrom(target.scale);

    const worldCentroid = new Vector3D(c.x, c.y, c.z);
    target.updateMatrixWorld();
    target.worldMatrix.transformVector(worldCentroid);
    shard.position.copyFrom(worldCentroid);

    shard.rigidBody = new RigidBody(massPerShard);
    shard.rigidBody.restitution = restitution;
    shard.rigidBody.friction = friction;

    shard.bounds = ConvexHull.fromFaceLoops(
      localFaces.map((face) => face.map((p) => new Vector3D(p.x, p.y, p.z))),
    );
    shard.updateMatrixWorld();
    shard.computeBounds();

    if (impactPoint) {
      const dir = new Vector3D(
        worldCentroid.x - impactPoint.x,
        worldCentroid.y - impactPoint.y,
        worldCentroid.z - impactPoint.z,
      );
      const len = dir.length();
      if (len > 0.0001) {
        dir.scale(1 / len);
        shard.rigidBody.velocity.copyFrom(dir).scale(explosionStrength);
      }
    }

    shards.push(shard);
  }

  if (target.parent) {
    target.parent.add(...shards);
    target.parent.remove(target);
  }

  return shards;
}
