import { ProximitySensorBehavior } from "../../../src/core/behaviors/ProximitySensorBehavior.js";
import { Object3D } from "../../../src/core/Object3D.js";

describe("ProximitySensorBehavior", () => {
  it("should calculate correct normalized factor based on distance", () => {
    let lastFactor = -1;
    const target = new Object3D("sensor");
    const player = new Object3D("player");

    target.position.set(0, 0, 0);
    target.updateMatrixWorld();

    const behavior = new ProximitySensorBehavior({
      targetObj: player,
      radius: 10.0,
      minDistance: 2.0,
      onUpdate: (factor): void => {
        lastFactor = factor;
      },
    });

    behavior.onAttach(target);

    // 1. Far away (outside radius)
    player.position.set(20, 0, 0);
    player.updateMatrixWorld();
    behavior.update(0.1);
    expect(lastFactor).toBe(0.0);

    // 2. Inside radius, but outside minDistance
    player.position.set(6, 0, 0); // distance = 6
    player.updateMatrixWorld();
    behavior.update(0.1);
    // radius = 10, min = 2, range = 8. distance = 6.
    // factor = 1.0 - (6 - 2) / 8 = 1.0 - 0.5 = 0.5
    expect(lastFactor).toBe(0.5);

    // 3. Exactly at minDistance
    player.position.set(0, 2, 0); // distance = 2
    player.updateMatrixWorld();
    behavior.update(0.1);
    expect(lastFactor).toBe(1.0);

    // 4. Inside minDistance (very close)
    player.position.set(0, 1, 0); // distance = 1
    player.updateMatrixWorld();
    behavior.update(0.1);
    expect(lastFactor).toBe(1.0);
  });

  it("measures full 3D distance by default, even when only Y differs", () => {
    let lastDistance = -1;
    const target = new Object3D("sensor");
    const player = new Object3D("player");
    target.position.set(0, 0, 0);
    target.updateMatrixWorld();

    const behavior = new ProximitySensorBehavior({
      targetObj: player,
      radius: 10.0,
      onUpdate: (_factor, distance): void => {
        lastDistance = distance;
      },
    });
    behavior.onAttach(target);

    // Same XZ position, 3 units apart on Y only.
    player.position.set(0, 3, 0);
    player.updateMatrixWorld();
    behavior.update(0.1);
    expect(lastDistance).toBeCloseTo(3.0);
  });

  it("ignores the Y axis when planar is true", () => {
    let lastDistance = -1;
    const target = new Object3D("sensor");
    const player = new Object3D("player");
    target.position.set(0, 0, 0);
    target.updateMatrixWorld();

    const behavior = new ProximitySensorBehavior({
      targetObj: player,
      radius: 10.0,
      planar: true,
      onUpdate: (_factor, distance): void => {
        lastDistance = distance;
      },
    });
    behavior.onAttach(target);

    // Same XZ position as before (3 units apart on Y only) -- planar distance should read ~0.
    player.position.set(0, 3, 0);
    player.updateMatrixWorld();
    behavior.update(0.1);
    expect(lastDistance).toBeCloseTo(0.0);

    // Now offset on X/Z too -- planar distance should only reflect the XZ offset.
    player.position.set(4, 99, -3);
    player.updateMatrixWorld();
    behavior.update(0.1);
    expect(lastDistance).toBeCloseTo(5.0); // 3-4-5 triangle on the XZ plane
  });
});
