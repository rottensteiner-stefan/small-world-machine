import { BobbingBehavior } from "../../../src/core/behaviors/BobbingBehavior.js";
import { Object3D } from "../../../src/core/Object3D.js";

describe("BobbingBehavior", () => {
  it("should bob up and down based on a sine wave applied to the Y axis", () => {
    const target = new Object3D("testTarget");
    target.position.set(0, 10, 0); // Base height of 10

    // Amplitude 2.0, Frequency PI / 2
    // With time = 1.0, sine parameter is (PI / 2) -> sin = 1.0 -> offset = +2.0 -> total 12
    const behavior = new BobbingBehavior(2.0, Math.PI / 2);
    behavior.onAttach(target);

    // After 1 second
    behavior.update(1.0);
    expect(target.position.y).toBeCloseTo(12.0, 3);

    // After another 1 second (total 2.0s -> sin(PI) = 0.0)
    behavior.update(1.0);
    expect(target.position.y).toBeCloseTo(10.0, 3);

    // After another 1 second (total 3.0s -> sin(3PI/2) = -1.0)
    behavior.update(1.0);
    expect(target.position.y).toBeCloseTo(8.0, 3);
  });
});
