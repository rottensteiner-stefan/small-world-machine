import { describe, expect, it } from "vitest";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { Behavior } from "../../src/core/behaviors/Behavior.js";

/** Minimal countable behavior for lifecycle tests. */
class CountingBehavior extends Behavior {
  public calls = 0;
  public override update(): void {
    this.calls++;
  }
}

/** Removes itself from its host on the first update. */
class SelfRemovingBehavior extends Behavior {
  public calls = 0;
  public override update(): void {
    this.calls++;
    if (this.target instanceof Object3D) this.target.removeBehavior(this);
  }
}

/** Removes a named sibling from its host on the first update. */
class SiblingRemovingBehavior extends Behavior {
  public removeTarget!: (() => void) | undefined;
  public calls = 0;
  public override update(): void {
    this.calls++;
    this.removeTarget?.();
  }
}

/** Adds a behavior to its host on the first update. */
class AddingBehavior extends Behavior {
  public calls = 0;
  public override update(): void {
    this.calls++;
    if (this.target instanceof Object3D && this.target.behaviors.length < 2) {
      this.target.addBehavior(new CountingBehavior());
    }
  }
}

describe("Scene graph lifecycle", () => {
  it("attaches added objects to the scene root and exposes them via scene.objects", () => {
    const scene = new Scene();
    const a = new Object3D("a");
    const b = new Object3D("b");
    scene.add(a, b);

    expect(scene.objects).toContain(a);
    expect(scene.objects).toContain(b);
    expect(a.parent).toBe(scene.root);
    expect(b.parent).toBe(scene.root);
  });

  it("re-parenting moves a node between parents without duplicating or losing it", () => {
    const scene = new Scene();
    const holderA = new Object3D("holderA");
    const holderB = new Object3D("holderB");
    const child = new Object3D("child");
    scene.add(holderA, holderB);

    holderA.add(child);
    expect(holderA.children).toContain(child);
    expect(child.parent).toBe(holderA);

    holderB.add(child); // re-parent, not clone
    expect(child.parent).toBe(holderB);
    expect(holderA.children).not.toContain(child);
    expect(holderB.children).toContain(child);
    // One node, reachable exactly once in the graph.
    expect(holderB.getObjectByName("child")).toBe(child);
    expect(holderA.getObjectByName("child")).toBeUndefined();
  });

  it("remove() detaches and queues the whole subtree for GPU release", () => {
    const scene = new Scene();
    const parent = new Object3D("parent");
    const child = new Object3D("child");
    const grandchild = new Object3D("grandchild");
    child.add(grandchild);
    parent.add(child);
    scene.add(parent);

    scene.remove(parent);
    expect(scene.objects).not.toContain(parent);
    expect(parent.parent).toBeUndefined();

    const removed = scene.consumeRemovedObjects();
    expect(removed).toContain(parent);
    expect(removed).toContain(child);
    expect(removed).toContain(grandchild);
    // Draining again returns nothing -- removal is only ever reported once.
    expect(scene.consumeRemovedObjects()).toEqual([]);
  });

  it("getObjectByName finds nested nodes but never returns the anonymous root", () => {
    const scene = new Scene();
    const top = new Object3D("top");
    const mid = new Object3D("mid");
    const leaf = new Object3D("leaf");
    mid.add(leaf);
    top.add(mid);
    scene.add(top);

    expect(scene.getObjectByName("leaf")).toBe(leaf);
    expect(scene.getObjectByName("mid")).toBe(mid);
    expect(scene.getObjectByName("top")).toBe(top);
    expect(scene.getObjectByName("SceneRoot")).toBeUndefined(); // root is hidden
    expect(scene.getObjectByName("nope")).toBeUndefined();
  });
});

describe("Scene.update behavior lifecycle", () => {
  it("does not update inactive behaviors", () => {
    const scene = new Scene();
    const obj = new Object3D();
    const counter = new CountingBehavior();
    counter.isActive = false;
    obj.addBehavior(counter);
    scene.add(obj);

    scene.update(1 / 60);
    scene.update(1 / 60);
    expect(counter.calls).toBe(0);
  });

  it("behaviors on deep children are reached through scene.update", () => {
    const scene = new Scene();
    const grandchild = new Object3D("grandchild");
    const counter = new CountingBehavior();
    grandchild.addBehavior(counter);
    const mid = new Object3D("mid");
    mid.add(grandchild);
    const top = new Object3D("top");
    top.add(mid);
    scene.add(top);

    scene.update(1 / 60);
    scene.update(1 / 60);
    expect(counter.calls).toBe(2);
  });

  it("a behavior removing itself within update stops being called on later frames", () => {
    const scene = new Scene();
    const obj = new Object3D();
    const remover = new SelfRemovingBehavior();
    obj.addBehavior(remover);
    scene.add(obj);

    scene.update(1 / 60);
    expect(remover.calls).toBe(1);
    expect(obj.behaviors).not.toContain(remover);
    // onDetach ran: the behavior no longer references its host.
    expect(remover.target).toBeUndefined();

    scene.update(1 / 60);
    scene.update(1 / 60);
    expect(remover.calls).toBe(1); // never called again after removal
  });

  it("removing a sibling behavior within update removes it from the list without corrupting the loop", () => {
    const scene = new Scene();
    const obj = new Object3D();
    const remover = new SiblingRemovingBehavior();
    const victim = new CountingBehavior();
    remover.removeTarget = (): void => {
      obj.removeBehavior(victim);
    };
    obj.addBehavior(remover);
    obj.addBehavior(victim);
    scene.add(obj);

    scene.update(1 / 60);
    expect(obj.behaviors).toContain(remover);
    expect(obj.behaviors).not.toContain(victim);
    expect(victim.target).toBeUndefined(); // onDetach ran
    expect(remover.calls).toBe(1);
  });

  it("attaching a behavior during update is safe and leaves it properly attached", () => {
    const scene = new Scene();
    const obj = new Object3D();
    const adder = new AddingBehavior();
    obj.addBehavior(adder);
    scene.add(obj);

    scene.update(1 / 60);
    expect(adder.calls).toBe(1);
    const added = obj.behaviors.find((b) => b instanceof CountingBehavior && b !== undefined);
    expect(added).toBeDefined();
    expect(added!.target).toBe(obj);
    // No crash, and the new behavior is updated on the next frame like any other.
    scene.update(1 / 60);
    expect(obj.behaviors.length).toBe(2);
  });
});

describe("Scene.update matrix pass", () => {
  it("recursively updates world matrices of the whole graph", () => {
    const scene = new Scene();
    const parent = new Object3D("parent");
    parent.position.set(1, 0, 0);
    const child = new Object3D("child");
    child.position.set(2, 0, 0);
    parent.add(child);
    scene.add(parent);

    scene.update(0);
    // Local stays local, world resolves the chain.
    expect(child.position.x).toBe(2);
    expect(child.getWorldPosition().x).toBeCloseTo(3);
    expect(parent.getWorldPosition().x).toBeCloseTo(1);
  });
});
