import { Object3D, Vector3D, Quaternion } from "../../src/index.js";
import { Behavior } from "../../src/core/behaviors/Behavior.js";
import { describe, it, expect } from "vitest";

describe("Object3D", () => {
  it("should initialize with default shadow properties", () => {
    const obj = new Object3D();

    // By default, objects should not cast or receive shadows
    expect(obj.castShadow).toBe(false);
    expect(obj.receiveShadow).toBe(false);
  });

  it("should allow setting shadow properties", () => {
    const obj = new Object3D();

    obj.castShadow = true;
    obj.receiveShadow = true;

    expect(obj.castShadow).toBe(true);
    expect(obj.receiveShadow).toBe(true);
  });

  describe("getWorldPosition", () => {
    it("matches position for a root object with no parent", () => {
      const obj = new Object3D();
      obj.position.set(3, 4, 5);
      obj.updateMatrixWorld();

      const world = obj.getWorldPosition();
      expect(world.x).toBeCloseTo(3);
      expect(world.y).toBeCloseTo(4);
      expect(world.z).toBeCloseTo(5);
    });

    it("resolves the full parent chain, unlike the local position", () => {
      const parent = new Object3D("parent");
      parent.position.set(10, 0, 0);
      const child = new Object3D("child");
      child.position.set(1, 2, 3); // Local offset from the parent.
      parent.add(child);
      parent.updateMatrixWorld();

      const world = child.getWorldPosition();
      expect(world.x).toBeCloseTo(11);
      expect(world.y).toBeCloseTo(2);
      expect(world.z).toBeCloseTo(3);

      // `position` itself stays local -- this is exactly the distinction the method exists for.
      expect(child.position.x).toBeCloseTo(1);
    });

    it("writes into the provided vector instead of allocating, when given one", () => {
      const obj = new Object3D();
      obj.position.set(7, 8, 9);
      obj.updateMatrixWorld();

      const out = new Vector3D();
      const result = obj.getWorldPosition(out);

      expect(result).toBe(out);
      expect(out.x).toBeCloseTo(7);
      expect(out.y).toBeCloseTo(8);
      expect(out.z).toBeCloseTo(9);
    });
  });

  describe("lookAt", () => {
    it("should correctly rotate to look at a target on the -Z axis (forward)", () => {
      const obj = new Object3D();
      obj.position.set(0, 0, 0);

      obj.lookAt(new Vector3D(0, 0, -1));
      obj.updateMatrixWorld();

      const forward = new Vector3D(0, 0, -1).transformDirection(obj.worldMatrix);
      expect(forward.x).toBeCloseTo(0);
      expect(forward.y).toBeCloseTo(0);
      expect(forward.z).toBeCloseTo(-1);
    });

    it("should correctly calculate rotation when looking UP (+Y)", () => {
      const obj = new Object3D();
      obj.position.set(0, 0, 0);

      obj.lookAt(new Vector3D(0, 5, 0));
      obj.updateMatrixWorld();

      const forward = new Vector3D(0, 0, -1).transformDirection(obj.worldMatrix);
      expect(forward.x).toBeCloseTo(0);
      expect(forward.y).toBeCloseTo(1);
      expect(forward.z).toBeCloseTo(0);
    });

    it("should correctly calculate rotation when looking RIGHT (+X)", () => {
      const obj = new Object3D();
      obj.position.set(0, 0, 0);

      obj.lookAt(new Vector3D(5, 0, 0));
      obj.updateMatrixWorld();

      const forward = new Vector3D(0, 0, -1).transformDirection(obj.worldMatrix);
      expect(forward.x).toBeCloseTo(1);
      expect(forward.y).toBeCloseTo(0);
      expect(forward.z).toBeCloseTo(0);
    });

    it("should update quaternion and worldMatrix when quaternion is set", () => {
      const obj = new Object3D();
      obj.position.set(0, 0, 0);
      obj.quaternion = new Quaternion(0, 0, 0, 1);

      obj.lookAt(new Vector3D(5, 0, 0));
      obj.updateMatrixWorld();

      const forward = new Vector3D(0, 0, -1).transformDirection(obj.worldMatrix);
      expect(forward.x).toBeCloseTo(1);
      expect(forward.y).toBeCloseTo(0);
      expect(forward.z).toBeCloseTo(0);
      expect(obj.quaternion.w).not.toBe(1); // Quaternion was actively updated from identity
    });
  });
});

describe("Object3D graph operations", () => {
  it("add() reparents and tracks children; remove() detaches and clears the parent", () => {
    const parent = new Object3D("parent");
    const child = new Object3D("child");

    parent.add(child);
    expect(parent.children).toContain(child);
    expect(child.parent).toBe(parent);

    parent.remove(child);
    expect(parent.children).not.toContain(child);
    expect(child.parent).toBeUndefined();
  });

  it("getObjectByName finds nested descendants", () => {
    const root = new Object3D("root");
    const mid = new Object3D("mid");
    const leaf = new Object3D("leaf");
    mid.add(leaf);
    root.add(mid);
    expect(root.getObjectByName("leaf")).toBe(leaf);
    expect(root.getObjectByName("root")).toBe(root);
    expect(root.getObjectByName("missing")).toBeUndefined();
  });

  it("traverse visits every node exactly once in depth-first pre-order", () => {
    const root = new Object3D("root");
    const a = new Object3D("a");
    const a1 = new Object3D("a1");
    const b = new Object3D("b");
    a.add(a1);
    root.add(a, b);

    const visited: string[] = [];
    root.traverse((o) => visited.push(o.name));
    // Depth-first pre-order: root, then a and its subtree, then b.
    expect(visited).toEqual(["root", "a", "a1", "b"]);
  });

  it("removing a node during traverse does not crash or observe stale nodes", () => {
    const root = new Object3D("root");
    const doomed = new Object3D("doomed");
    const survivor = new Object3D("survivor");
    root.add(doomed, survivor);

    const visited: string[] = [];
    root.traverse((o) => {
      visited.push(o.name);
      if (o === root) root.remove(doomed);
    });

    expect(visited[0]).toBe("root");
    expect(root.children).not.toContain(doomed);
    expect(root.children).toContain(survivor);
  });
});

describe("Object3D behavior lifecycle", () => {
  it("addBehavior attaches and sets target; removeBehavior detaches and clears target", () => {
    const obj = new Object3D();
    const behavior = new (class extends Behavior {
      public override update(): void {}
    })();

    obj.addBehavior(behavior);
    expect(obj.behaviors).toContain(behavior);
    expect(behavior.target).toBe(obj);

    obj.removeBehavior(behavior);
    expect(obj.behaviors).not.toContain(behavior);
    expect(behavior.target).toBeUndefined();
  });

  it("clone re-attaches independent behavior instances with the clone as target", () => {
    const obj = new Object3D("source");
    const originalBehavior = new (class extends Behavior {
      public override update(): void {}
    })();
    obj.addBehavior(originalBehavior);

    const copy = obj.clone();
    expect(copy).not.toBe(obj);
    expect(copy.behaviors).toHaveLength(1);
    const copiedBehavior = copy.behaviors[0]!;
    expect(copiedBehavior).not.toBe(originalBehavior);
    expect(copiedBehavior.target).toBe(copy);
    // Behavior uuids are fresh per clone -- no shared identity.
    expect(copiedBehavior.uuid).not.toBe(originalBehavior.uuid);
  });

  it("clone produces a deep independent subtree and drops the rigid body", () => {
    const parent = new Object3D("parent");
    const child = new Object3D("child");
    parent.add(child);
    parent.rigidBody = { mass: 1 } as unknown as import("../../src/physix/RigidBody.js").RigidBody;

    const copy = parent.clone();
    expect(copy.children).toHaveLength(1);
    expect(copy.children[0]).not.toBe(child);
    expect((copy.children[0] as Object3D).parent).toBe(copy);
    // The clone is free-floating until reparented.
    expect(copy.parent).toBeUndefined();
    expect(copy.rigidBody).toBeUndefined();

    // Mutating the clone must not touch the original subtree.
    copy.getObjectByName("child")!.name = "renamed";
    expect(child.name).toBe("child");
  });
});
