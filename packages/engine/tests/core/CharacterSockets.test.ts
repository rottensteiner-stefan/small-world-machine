import { describe, it, expect } from "vitest";
import { Object3D } from "../../src/core/Object3D.js";

describe("Character Hand Sockets & Knuckle Alignment", () => {
  it("should correctly position socket item relative to character bone transform", () => {
    const root = new Object3D("CharacterRoot");
    const spine = new Object3D("mixamorig:Spine");
    const arm = new Object3D("mixamorig:LeftArm");
    const hand = new Object3D("mixamorig:LeftHand");
    const knuckle = new Object3D("mixamorig:LeftHandMiddle1");

    root.add(spine);
    spine.add(arm);
    arm.add(hand);
    hand.add(knuckle);

    root.position.set(0, 0, 0);
    spine.position.set(0, 1.0, 0);
    arm.position.set(-0.35, 0.4, 0);
    hand.position.set(-0.25, 0, 0);
    knuckle.position.set(-0.06, 0, 0.04); // Knuckle / palm center offset

    root.updateMatrixWorld();

    const knuckleWorldPos = knuckle.getWorldPosition();
    expect(knuckleWorldPos.x).toBeCloseTo(-0.66);
    expect(knuckleWorldPos.y).toBeCloseTo(1.4);
    expect(knuckleWorldPos.z).toBeCloseTo(0.04);

    // Attach held lantern prop
    const lantern = new Object3D("HeldLantern");
    // Offset lantern downward along handle (-Y = -0.12)
    lantern.position.set(0, -0.12, 0);
    knuckle.add(lantern);

    root.updateMatrixWorld();

    const lanternWorldPos = lantern.getWorldPosition();
    expect(lanternWorldPos.x).toBeCloseTo(-0.66);
    expect(lanternWorldPos.y).toBeCloseTo(1.28);
    expect(lanternWorldPos.z).toBeCloseTo(0.04);
  });

  it("should track character locomotion and rotation changes dynamically", () => {
    const root = new Object3D("CharacterRoot");
    const hand = new Object3D("mixamorig:LeftHand");
    const prop = new Object3D("Prop");

    root.add(hand);
    hand.add(prop);

    hand.position.set(0.2, 1.1, 0.3);
    prop.position.set(0, -0.1, 0);

    root.updateMatrixWorld();
    expect(prop.getWorldPosition().y).toBeCloseTo(1.0);

    // Player steps forward 2 meters and rotates 90 degrees
    root.position.set(0, 0, 2.0);
    root.rotation.y = Math.PI / 2;
    root.updateMatrixWorld();

    const worldPos = prop.getWorldPosition();
    expect(worldPos.z).toBeCloseTo(2.0 - 0.2); // X rotated into Z
    expect(worldPos.y).toBeCloseTo(1.0);
  });
});
