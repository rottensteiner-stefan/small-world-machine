import { describe, expect, it } from "vitest";
import { Object3D } from "../../../src/core/Object3D.js";
import { Decal } from "../../../src/core/objects/Decal.js";
import { DecalPool } from "../../../src/core/decals/DecalPool.js";
import { compareDecals } from "../../../src/core/decals/DecalMath.js";
import { DecalMaterial } from "../../../src/core/materials/index.js";
import { Color } from "../../../src/core/colors/index.js";
import { Matrix4, Vector3D } from "../../../src/math/index.js";

const up = new Vector3D(0, 1, 0);
const at = (x: number, z = 0): Vector3D => new Vector3D(x, 0, z);

function makePool(
  capacity: number,
  extra: Partial<ConstructorParameters<typeof DecalPool>[1]> = {},
): { root: Object3D; pool: DecalPool } {
  const root = new Object3D("Root");
  const pool = new DecalPool(root, {
    capacity,
    createMaterial: (): DecalMaterial => new DecalMaterial({ color: new Color(1, 1, 1, 0.8) }),
    ...extra,
  });
  return { root, pool };
}

/** World-space +Y axis of a decal (its surface normal). */
function worldUp(decal: Decal): Vector3D {
  decal.updateMatrixWorld(true);
  const m = decal.worldMatrix.data;
  return new Vector3D(m[4]!, m[5]!, m[6]!).normalize();
}

describe("DecalPool", () => {
  it("rejects a capacity that is not a positive integer", () => {
    expect(() => makePool(0)).toThrow(/capacity/);
    expect(() => makePool(2.5)).toThrow(/capacity/);
  });

  it("creates every slot up front, hidden, and never adds nodes while spawning", () => {
    const { root, pool } = makePool(4);
    expect(root.children).toHaveLength(4);
    expect(root.children.every((c) => !c.isVisible)).toBe(true);
    pool.spawn(at(0), up);
    pool.spawn(at(1), up);
    expect(root.children).toHaveLength(4);
    expect(pool.activeCount).toBe(2);
  });

  it("places a decal on the surface: position, up axis along the normal, scale as (w, depth, h)", () => {
    const { pool } = makePool(2, { size: [2, 1, 0.4] });
    const normal = new Vector3D(1, 2, -3).normalize();
    const decal = pool.spawn(new Vector3D(4, 5, 6), normal);
    expect(decal.isVisible).toBe(true);
    expect([decal.position.x, decal.position.y, decal.position.z]).toEqual([4, 5, 6]);
    expect([decal.scale.x, decal.scale.y, decal.scale.z]).toEqual([2, 0.4, 1]);
    const n = worldUp(decal);
    expect(n.x).toBeCloseTo(normal.x, 5);
    expect(n.y).toBeCloseTo(normal.y, 5);
    expect(n.z).toBeCloseTo(normal.z, 5);
  });

  it("a per-spawn size and spin override the defaults", () => {
    const { pool } = makePool(1);
    const decal = pool.spawn(at(0), up, { size: [1, 3, 0.2], spin: Math.PI / 2 });
    expect([decal.scale.x, decal.scale.y, decal.scale.z]).toEqual([1, 0.2, 3]);
    expect(decal.rotation.y).toBeCloseTo(Math.PI / 2, 5);
  });

  it("recycles the oldest decal when full and puts it on top of the stacking order", () => {
    const { pool } = makePool(3);
    const a = pool.spawn(at(0), up);
    pool.update(1);
    const b = pool.spawn(at(1), up);
    pool.update(1);
    const c = pool.spawn(at(2), up);
    pool.update(1);
    expect(pool.activeCount).toBe(3);

    const d = pool.spawn(at(9), up);
    expect(d).toBe(a); // oldest
    expect(pool.activeCount).toBe(3);
    expect(d.position.x).toBe(9);
    // Same size and priority: only `sequence` decides, and the recycled decal must beat the younger b and c.
    expect(compareDecals(b, d)).toBeLessThan(0);
    expect(compareDecals(c, d)).toBeLessThan(0);
  });

  it("fades during the last fadeSeconds and frees the slot at the end of the lifetime", () => {
    const { pool } = makePool(2, { lifetime: 4, fadeSeconds: 2 });
    const decal = pool.spawn(at(0), up);
    const material = decal.material as DecalMaterial;
    pool.update(2); // exactly where the fade starts
    expect(material.color.a).toBeCloseTo(0.8);
    pool.update(1); // 1 s left of a 2 s fade
    expect(material.color.a).toBeCloseTo(0.4);
    pool.update(0.9);
    expect(decal.isVisible).toBe(true);
    pool.update(0.2);
    expect(decal.isVisible).toBe(false);
    expect(pool.activeCount).toBe(0);
  });

  it("a recycled slot starts at full opacity again", () => {
    const { pool } = makePool(1, { lifetime: 2, fadeSeconds: 2 });
    const decal = pool.spawn(at(0), up);
    pool.update(1.5);
    expect((decal.material as DecalMaterial).color.a).toBeLessThan(0.8);
    pool.spawn(at(1), up);
    expect((decal.material as DecalMaterial).color.a).toBeCloseTo(0.8);
  });

  it("without a lifetime a decal lives until it is recycled", () => {
    const { pool } = makePool(2);
    pool.spawn(at(0), up);
    pool.update(1e6);
    expect(pool.activeCount).toBe(1);
  });

  it("a per-spawn lifetime overrides the pool's", () => {
    const { pool } = makePool(2, { lifetime: 100 });
    pool.spawn(at(0), up, { lifetime: 1 });
    pool.update(1.5);
    expect(pool.activeCount).toBe(0);
  });

  it("attachTo keeps the world pose and then follows the receiver", () => {
    const { pool } = makePool(2);
    const receiver = new Object3D("Door");
    receiver.setPosition(10, 0, 0).setRotation(0, Math.PI / 2, 0);
    const decal = pool.spawn(new Vector3D(10, 1, 2), up, { attachTo: receiver });
    expect(decal.parent).toBe(receiver);

    const before = new Matrix4();
    decal.updateMatrixWorld(true);
    before.data.set(decal.worldMatrix.data);
    receiver.updateMatrixWorld(true);
    decal.updateMatrixWorld(true);
    expect(decal.worldMatrix.data[12]).toBeCloseTo(10, 4);
    expect(decal.worldMatrix.data[13]).toBeCloseTo(1, 4);
    expect(decal.worldMatrix.data[14]).toBeCloseTo(2, 4);
    const n = worldUp(decal);
    expect(n.y).toBeCloseTo(1, 4);

    receiver.setPosition(20, 0, 0);
    receiver.updateMatrixWorld(true);
    decal.updateMatrixWorld(true);
    expect(decal.worldMatrix.data[12]).toBeCloseTo(20, 4);
  });

  it("releasing an attached decal returns it to the pool root", () => {
    const { root, pool } = makePool(1, { lifetime: 1 });
    const receiver = new Object3D("Door");
    const decal = pool.spawn(at(0), up, { attachTo: receiver });
    pool.update(2);
    expect(decal.parent).toBe(root);
    expect(decal.isVisible).toBe(false);
  });

  it("clear() frees everything and dispose() removes the nodes", () => {
    const { root, pool } = makePool(3);
    pool.spawn(at(0), up);
    pool.spawn(at(1), up);
    pool.clear();
    expect(pool.activeCount).toBe(0);
    expect(root.children.every((c) => !c.isVisible)).toBe(true);
    pool.dispose();
    expect(root.children).toHaveLength(0);
    expect(pool.capacity).toBe(0);
  });
});
