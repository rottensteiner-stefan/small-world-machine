import { RotatorBehavior } from "../../../src/core/behaviors/RotatorBehavior.js";
import { Object3D } from "../../../src/core/Object3D.js";
import { Vector3D } from "../../../src/math/Vector3D.js";

describe("RotatorBehavior", () => {
  it("should rotate the object over time according to the given speed vector", () => {
    const target = new Object3D("testTarget");
    const behavior = new RotatorBehavior(new Vector3D(1.0, 2.0, -1.0));
    behavior.onAttach(target);

    // Update by 0.5 seconds
    behavior.update(0.5);

    expect(target.rotation.x).toBeCloseTo(0.5, 3);
    expect(target.rotation.y).toBeCloseTo(1.0, 3);
    expect(target.rotation.z).toBeCloseTo(-0.5, 3);

    // Update by another 1.0 second
    behavior.update(1.0);

    expect(target.rotation.x).toBeCloseTo(1.5, 3);
    expect(target.rotation.y).toBeCloseTo(3.0, 3);
    expect(target.rotation.z).toBeCloseTo(-1.5, 3);
  });
});
