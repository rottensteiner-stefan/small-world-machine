import { describe, it, expect, vi } from "vitest";
import {
  Bone,
  Skeleton,
  SkinnedMesh,
  AnimationClip,
  KeyframeTrack,
  AnimationMixer,
  MAX_SKINNED_BONES,
} from "../../../src/core/animation/index.js";
import { Object3D } from "../../../src/core/Object3D.js";
import { Scene } from "../../../src/core/Scene.js";
import { Matrix4 } from "../../../src/math/Matrix4.js";

describe("Skeletal Animation System", () => {
  it("should create bones and compute skeleton matrices", () => {
    const rootBone = new Bone("Root");
    const childBone = new Bone("Child");
    childBone.position.set(0, 5, 0);
    rootBone.add(childBone);

    const skeleton = new Skeleton([rootBone, childBone]);
    rootBone.updateMatrixWorld();
    skeleton.update();

    expect(skeleton.bones.length).toBe(2);
    expect(skeleton.boneMatrices.length).toBe(32); // 2 * 16 floats
    expect(skeleton.getBoneByName("Child")).toBe(childBone);
  });

  it("should interpolate translation keyframes in KeyframeTrack", () => {
    const times = new Float32Array([0, 1.0]);
    const values = new Float32Array([0, 0, 0, 10, 20, 30]);
    const track = new KeyframeTrack("BoneA", "translation", times, values, "LINEAR");

    const sampled = track.sampleVector(0.5);

    expect(sampled.x).toBeCloseTo(5);
    expect(sampled.y).toBeCloseTo(10);
    expect(sampled.z).toBeCloseTo(15);
  });

  it("should update tracks in AnimationMixer over time", () => {
    const root = new Object3D("Hero");
    const arm = new Bone("Arm");
    root.add(arm);

    const times = new Float32Array([0, 1.0, 2.0]);
    const values = new Float32Array([0, 0, 0, 1, 0, 0.7071, 0, 0.7071, 0, 1, 0, 0]);
    const track = new KeyframeTrack("Arm", "rotation", times, values, "LINEAR");
    const clip = new AnimationClip("Swing", 2.0, [track]);

    const mixer = new AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.play();

    mixer.update(0.5); // Halfway to 1.0
    expect(arm.quaternion).toBeDefined();
    expect(arm.quaternion!.y).toBeGreaterThan(0);
  });

  it("should bind skeleton to SkinnedMesh and update world matrix", () => {
    const bone = new Bone("B0");
    const skeleton = new Skeleton([bone]);
    const skinnedMesh = new SkinnedMesh("Character");

    skinnedMesh.bind(skeleton);
    skinnedMesh.updateMatrixWorld();

    expect(skinnedMesh.skeleton).toBe(skeleton);
  });

  it("should blend two simultaneously-playing actions by their relative weight", () => {
    const root = new Object3D("Hero");
    const arm = new Bone("Arm");
    root.add(arm);

    const times = new Float32Array([0, 1.0]);
    const trackA = new KeyframeTrack(
      "Arm",
      "translation",
      times,
      new Float32Array([0, 0, 0, 0, 0, 0]),
    );
    const trackB = new KeyframeTrack(
      "Arm",
      "translation",
      times,
      new Float32Array([10, 0, 0, 10, 0, 0]),
    );
    const clipA = new AnimationClip("Idle", 1.0, [trackA]);
    const clipB = new AnimationClip("Reach", 1.0, [trackB]);

    const mixer = new AnimationMixer(root);
    const actionA = mixer.clipAction(clipA);
    const actionB = mixer.clipAction(clipB);
    actionA.weight = 0.5;
    actionB.weight = 0.5;
    actionA.play();
    actionB.play();

    mixer.update(0);

    // A last-writer-wins implementation would snap to whichever action's track happened to
    // be evaluated last (0 or 10), not the weighted midpoint.
    expect(arm.position.x).toBeCloseTo(5);
  });

  it("should reflect the current frame's bone pose even when the SkinnedMesh is added before its bones", () => {
    // Mirrors typical glTF export order: the mesh node is a sibling of (and precedes)
    // the armature root in the parent's children array. A single top-down
    // updateMatrixWorld() pass would visit the mesh before its bones are current.
    const armatureRoot = new Bone("Hips");
    const skeleton = new Skeleton([armatureRoot]);
    const skinnedMesh = new SkinnedMesh("Character");
    skinnedMesh.bind(skeleton);

    const root = new Object3D("glTF_Root");
    root.add(skinnedMesh, armatureRoot);

    armatureRoot.position.set(0, 5, 0);

    const scene = new Scene();
    scene.add(root);
    scene.update(0);

    // If skinning were computed inside updateMatrixWorld() during the single
    // top-down pass, this would still read Hips' pre-update (identity) matrix.
    expect(skeleton.boneMatrices[13]).toBeCloseTo(5);
  });

  it("should bind a track's mixamorigN: target name to a node with a differently-numbered mixamorig suffix", () => {
    // Mixamo assigns its rig prefix's numeric suffix per export session, independent of which
    // character was exported -- a rig and a shared animation clip pulled from separate sessions
    // can carry different suffixes for what is otherwise the same joint.
    const root = new Object3D("Character");
    const hips = new Bone("mixamorig5:Hips");
    root.add(hips);

    const times = new Float32Array([0, 2.0]);
    const track = new KeyframeTrack(
      "mixamorig:Hips",
      "translation",
      times,
      new Float32Array([0, 0, 0, 10, 0, 0]),
    );
    const clip = new AnimationClip("Walk", 2.0, [track]);

    const mixer = new AnimationMixer(root);
    mixer.clipAction(clip).play();
    mixer.update(1.0); // Halfway to 2.0

    expect(hips.position.x).toBeCloseTo(5);
  });

  it("should report a bone's accumulated world scale, unaffected by ancestors shared with other branches", () => {
    const armature = new Object3D("Armature");
    armature.scale.set(100, 100, 100);
    const hips = new Bone("mixamorig:Hips");
    armature.add(hips);
    armature.updateMatrixWorld();

    expect(hips.getAccumulatedWorldScale()).toBeCloseTo(100);
  });

  it("should freeze a bone's pose (not reset it) once no action touches it anymore", () => {
    // AnimationMixer's zero-alloc blend states are only ever overwritten by a contribution
    // sampled in the *current* frame (`si !== frameIndex`); a bone dropped by every action
    // between one frame and the next must keep its last computed pose rather than snapping
    // back to zero, since nothing writes into `arm.position` for that frame anymore.
    const root = new Object3D("Hero");
    const arm = new Bone("Arm");
    root.add(arm);

    const times = new Float32Array([0, 1.0]);
    const track = new KeyframeTrack(
      "Arm",
      "translation",
      times,
      new Float32Array([0, 0, 0, 10, 0, 0]),
    );
    const clip = new AnimationClip("Reach", 1.0, [track]);

    const mixer = new AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.setLoop(false); // otherwise time=1.0 wraps back to 0 on a duration=1.0 clip
    action.play();

    mixer.update(1.0); // Sample at t=1.0 -> x = 10
    expect(arm.position.x).toBeCloseTo(10);

    action.stop(); // isPlaying = false: no longer contributes to any blend state
    mixer.update(0.5); // Nothing touches "Arm" this frame

    expect(arm.position.x).toBeCloseTo(10);
  });

  it("should fall back to identity when a SkinnedMesh's world matrix is singular (e.g. zero-scale pop-in)", () => {
    // A zero-scale world matrix can't be inverted; Skeleton.update() must detect the failed
    // invert() and fall back to identity rather than silently reusing the un-inverted (still
    // zero-scaled) matrix, which would zero out every bone matrix instead of just skipping the
    // mesh-space transform for this frame.
    const bone = new Bone("B0");
    bone.position.set(1, 2, 3);
    bone.updateMatrixWorld();

    const skeleton = new Skeleton([bone]);

    const singularWorldMatrix = new Matrix4();
    singularWorldMatrix.data.set([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    skeleton.update(singularWorldMatrix);

    // With the identity fallback, boneMatrices[i] == bone.worldMatrix * invBind (invBind is
    // identity here), i.e. the bone's own world position -- not all-zero.
    expect(skeleton.boneMatrices[12]).toBeCloseTo(1);
    expect(skeleton.boneMatrices[13]).toBeCloseTo(2);
    expect(skeleton.boneMatrices[14]).toBeCloseTo(3);
  });

  it("should warn when a skeleton exceeds the GPU skinning bone limit", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tooManyBones = Array.from(
      { length: MAX_SKINNED_BONES + 1 },
      (_, i) => new Bone(`Bone${i}`),
    );

    new Skeleton(tooManyBones);

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toContain(`${MAX_SKINNED_BONES}`);
    warnSpy.mockRestore();
  });
});
