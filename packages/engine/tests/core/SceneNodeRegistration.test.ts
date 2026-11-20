import { describe, it, expect } from "vitest";
import {
  Scene,
  Object3D,
  DirectionalLight,
  PointLight,
  FogVolume,
  SkinnedMesh,
  Behavior,
} from "../../src/core/index.js";
import { BoundingBox, RigidBody } from "../../src/physix/index.js";
import { Vector3D } from "../../src/math/index.js";

class CounterBehavior extends Behavior {
  public count = 0;
  public selfRemove = false;
  public update(): void {
    this.count++;
    if (this.selfRemove && this.target instanceof Object3D) {
      this.target.removeBehavior(this);
    }
  }
}

describe("Scene node registration", () => {
  it("registers and unregisters lights, fog volumes, and skinned meshes on direct add/remove", () => {
    const scene = new Scene();
    const dir = new DirectionalLight();
    const point = new PointLight();
    const fog = new FogVolume();
    const skinned = new SkinnedMesh();

    scene.add(dir, point, fog, skinned);
    expect(scene.lights).toEqual([dir, point]);
    expect(scene.directionalLights).toEqual([dir]);
    expect(scene.fogVolumes).toEqual([fog]);
    expect(scene.skinnedMeshes).toEqual([skinned]);

    scene.remove(dir, point, fog, skinned);
    expect(scene.lights).toHaveLength(0);
    expect(scene.directionalLights).toHaveLength(0);
    expect(scene.fogVolumes).toHaveLength(0);
    expect(scene.skinnedMeshes).toHaveLength(0);
  });

  it("propagates registration for pre-populated subtrees on add and remove", () => {
    const scene = new Scene();
    const group = new Object3D("group");
    const nested = new Object3D("nested");
    const dir = new DirectionalLight();
    const fog = new FogVolume();
    const skinned = new SkinnedMesh();

    nested.add(dir, fog);
    group.add(nested, skinned);

    expect(scene.lights).toHaveLength(0);
    scene.add(group);
    expect(scene.lights).toEqual([dir]);
    expect(scene.directionalLights).toEqual([dir]);
    expect(scene.fogVolumes).toEqual([fog]);
    expect(scene.skinnedMeshes).toEqual([skinned]);

    scene.remove(group);
    expect(scene.lights).toHaveLength(0);
    expect(scene.directionalLights).toHaveLength(0);
    expect(scene.fogVolumes).toHaveLength(0);
    expect(scene.skinnedMeshes).toHaveLength(0);
  });

  it("handles incremental attach and direct child remove on nested nodes already in a scene", () => {
    const scene = new Scene();
    const group = new Object3D("group");
    scene.add(group);

    const point = new PointLight();
    group.add(point);
    expect(scene.lights).toEqual([point]);

    group.remove(point);
    expect(scene.lights).toHaveLength(0);
  });

  it("does not duplicate entries on same-scene reparenting or repeated add", () => {
    const scene = new Scene();
    const parentA = new Object3D("a");
    const parentB = new Object3D("b");
    const dir = new DirectionalLight();

    scene.add(parentA, parentB);
    parentA.add(dir);
    parentB.add(dir);
    scene.add(dir);

    expect(scene.lights).toEqual([dir]);
    expect(scene.directionalLights).toEqual([dir]);
  });

  it("moves registrations when a node is reparented to another scene", () => {
    const sceneA = new Scene();
    const sceneB = new Scene();
    const dir = new DirectionalLight();
    const fog = new FogVolume();

    sceneA.add(dir, fog);
    expect(sceneA.lights).toEqual([dir]);
    expect(sceneA.fogVolumes).toEqual([fog]);

    sceneB.add(dir, fog);
    expect(sceneA.lights).toHaveLength(0);
    expect(sceneA.directionalLights).toHaveLength(0);
    expect(sceneA.fogVolumes).toHaveLength(0);
    expect(sceneB.lights).toEqual([dir]);
    expect(sceneB.directionalLights).toEqual([dir]);
    expect(sceneB.fogVolumes).toEqual([fog]);
  });

  it("tracks behavior nodes across add/remove and handles self-removal during update", () => {
    const scene = new Scene();
    const a = new Object3D("a");
    const b = new Object3D("b");
    const c = new Object3D("c");
    const ba = new CounterBehavior();
    const bb = new CounterBehavior();
    const bc = new CounterBehavior();
    bb.selfRemove = true;

    a.addBehavior(ba);
    scene.add(a, b, c);
    b.addBehavior(bb);
    c.addBehavior(bc);

    expect(scene.behaviorNodes).toEqual([a, b, c]);

    scene.update(0.016);
    expect(ba.count).toBe(1);
    expect(bb.count).toBe(1);
    expect(bc.count).toBe(1);
    expect(scene.behaviorNodes).toEqual([a, c]);

    a.removeBehavior(ba);
    scene.remove(c);
    expect(scene.behaviorNodes).toHaveLength(0);
  });

  it("tracks physics nodes across rigidBody, bounds, isCollidable, and clone", () => {
    const scene = new Scene();
    const pre = new Object3D("pre");
    pre.rigidBody = new RigidBody(1);
    const post = new Object3D("post");

    scene.add(pre, post);
    expect(scene.physicsNodes).toEqual([pre]);

    post.bounds = new BoundingBox(new Vector3D(-1, -1, -1), new Vector3D(1, 1, 1));
    expect(scene.physicsNodes).toEqual([pre, post]);

    post.isCollidable = false;
    expect(scene.physicsNodes).toEqual([pre]);

    post.isCollidable = true;
    expect(scene.physicsNodes).toEqual([pre, post]);

    const cloned = pre.clone();
    expect(cloned.rigidBody).toBeUndefined();
    expect(cloned.bounds).toBeUndefined();
    expect(scene.physicsNodes).toEqual([pre, post]);

    scene.remove(pre, post);
    expect(scene.physicsNodes).toHaveLength(0);
  });
});
