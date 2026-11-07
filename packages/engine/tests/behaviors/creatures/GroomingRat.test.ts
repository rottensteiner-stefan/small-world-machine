import { describe, it, expect } from "vitest";
import { GroomingRat } from "../../../src/behaviors/creatures/GroomingRat.js";
import {
  RatGroomingBehavior,
  RatGroomingState,
} from "../../../src/behaviors/creatures/RatGroomingBehavior.js";
import { Color } from "../../../src/core/colors/Color.js";
import { Object3D } from "../../../src/core/Object3D.js";

describe("GroomingRat & RatGroomingBehavior", () => {
  it("should create a GroomingRat with full articulated node hierarchy", () => {
    const rat = new GroomingRat();

    expect(rat.name).toBe("GroomingRat");
    expect(rat.getObjectByName("Head")).toBeDefined();
    expect(rat.getObjectByName("LeftPaw")).toBeDefined();
    expect(rat.getObjectByName("RightPaw")).toBeDefined();
    expect(rat.getObjectByName("Haunches")).toBeDefined();
    expect(rat.getObjectByName("Torso")).toBeDefined();
    expect(rat.getObjectByName("Tail_0")).toBeDefined();
    expect(rat.getObjectByName("Tail_5")).toBeDefined();
    expect(rat.behavior).toBeInstanceOf(RatGroomingBehavior);
  });

  it("should support custom color options and scaling", () => {
    const customRat = new GroomingRat({
      furColor: "#554433",
      skinColor: new Color(0.9, 0.6, 0.6),
      eyeColor: "#ff00ff",
      scale: 1.5,
    });

    expect(customRat.scale.x).toBe(1.5);
    expect(customRat.scale.y).toBe(1.5);
    expect(customRat.scale.z).toBe(1.5);
  });

  it("should execute 3-phase grooming state machine during update", () => {
    const rat = new GroomingRat({
      behaviorOptions: { speed: 1.0, cycleDuration: 8.5 },
    });
    const behavior = rat.behavior!;

    // Initial state
    expect(behavior.currentState).toBe(RatGroomingState.FACE_WASHING);

    // Update into phase 1 (Face washing, e.g. at 2.0s)
    behavior.update(2.0);
    expect(behavior.currentState).toBe(RatGroomingState.FACE_WASHING);
    const leftPaw = rat.getObjectByName("LeftPaw")!;
    expect(leftPaw.position.y).toBeGreaterThan(0.08);

    // Update into phase 2 (Alert sniffing, e.g. at 4.5s)
    behavior.update(2.5); // total 4.5s (cycle ~ 4.95)
    expect(behavior.currentState).toBe(RatGroomingState.ALERT_SNIFFING);

    // Update into phase 3 (Ear cleaning, e.g. at 7.0s)
    behavior.update(2.5); // total 7.0s (cycle ~ 7.7)
    expect(behavior.currentState).toBe(RatGroomingState.EAR_CLEANING);
  });

  it("should animate tail segments with wave propagation", () => {
    const rat = new GroomingRat();
    const tail0 = rat.getObjectByName("Tail_0")!;
    const tail3 = rat.getObjectByName("Tail_3")!;

    const rot0Before = tail0.rotation.y;
    const rot3Before = tail3.rotation.y;

    rat.behavior!.update(1.2);

    expect(tail0.rotation.y).not.toBe(rot0Before);
    expect(tail3.rotation.y).not.toBe(rot3Before);
  });

  it("should respect isActive flag", () => {
    const rat = new GroomingRat();
    const behavior = rat.behavior!;
    behavior.isActive = false;

    behavior.update(3.0);
    expect(behavior.elapsedTime).toBe(0);
  });

  it("should bind nodes on a rig that prefixes every name (e.g. an externally loaded glTF import) via a generic suffix match, not a fixed candidate list", () => {
    // Regression guard for the anti-pattern already fixed once in AnimationMixer
    // (`_findByNormalizedMixamoName`): rather than guessing a hardcoded list of prefix
    // candidates ("Rat1Head", "RatHead", ...), _bindNodes() must resolve any prefix generically.
    // A rig prefixed with something not on any hardcoded guess list exercises that.
    const target = new Object3D("Rig");
    const head = new Object3D("ImportedRig_Head");
    const leftPaw = new Object3D("ImportedRig_LeftPaw");
    const rightPaw = new Object3D("ImportedRig_RightPaw");
    const tail0 = new Object3D("ImportedRig_Tail_0");
    target.add(head, leftPaw, rightPaw, tail0);

    const behavior = new RatGroomingBehavior();
    behavior.onAttach(target);

    // Bound correctly if the state machine actually moves the head/paws on update().
    behavior.update(1.0);
    expect(head.rotation.x).not.toBe(0);
    expect(leftPaw.position.y).toBeGreaterThan(0);
    expect(rightPaw.position.y).toBeGreaterThan(0);
    expect(tail0.rotation.y).not.toBe(0);
  });
});
