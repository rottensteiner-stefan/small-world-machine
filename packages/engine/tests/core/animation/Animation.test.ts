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

  it("should evaluate CUBICSPLINE translation and rotation tracks using glTF 2.0 Appendix C Hermite formula", () => {
    const times = new Float32Array([0, 1.0]);
    // 2 keyframes * 3 (inTangent, value, outTangent) * 3 components = 18 floats
    // k0: in=(99, 99, 99), v0=(1, 2, 3), b0=(4, 0, -2)
    // k1: a1=(2, 4, 0), v1=(5, 6, 7), out=(88, 88, 88)
    const transValues = new Float32Array([
      99, 99, 99,
      1, 2, 3,
      4, 0, -2,
      2, 4, 0,
      5, 6, 7,
      88, 88, 88,
    ]);
    const transTrack = new KeyframeTrack("Bone", "translation", times, transValues, "CUBICSPLINE");

    // At t = 0, returns value_0 (not inTangent_0)
    const vAt0 = transTrack.sampleVector(0);
    expect(vAt0.x).toBeCloseTo(1);
    expect(vAt0.y).toBeCloseTo(2);
    expect(vAt0.z).toBeCloseTo(3);

    // At t = 1, returns value_1
    const vAt1 = transTrack.sampleVector(1.0);
    expect(vAt1.x).toBeCloseTo(5);
    expect(vAt1.y).toBeCloseTo(6);
    expect(vAt1.z).toBeCloseTo(7);

    // At t = 0.5 (s = 0.5, dt = 1):
    // c0 = 2(0.125) - 3(0.25) + 1 = 0.5
    // c1 = 1 * (0.125 - 0.5 + 0.5) = 0.125
    // c2 = -2(0.125) + 3(0.25) = 0.5
    // c3 = 1 * (0.125 - 0.25) = -0.125
    // x = 0.5*1 + 0.125*4 + 0.5*5 - 0.125*2 = 0.5 + 0.5 + 2.5 - 0.25 = 3.25
    // y = 0.5*2 + 0.125*0 + 0.5*6 - 0.125*4 = 1.0 + 0 + 3.0 - 0.5 = 3.5
    // z = 0.5*3 + 0.125*(-2) + 0.5*7 - 0.125*0 = 1.5 - 0.25 + 3.5 - 0 = 4.75
    const vAtHalf = transTrack.sampleVector(0.5);
    expect(vAtHalf.x).toBeCloseTo(3.25);
    expect(vAtHalf.y).toBeCloseTo(3.5);
    expect(vAtHalf.z).toBeCloseTo(4.75);

    // Rotation CUBICSPLINE: 2 keyframes * 3 * 4 components = 24 floats
    // k0: in=(1,2,3,4), v0=(0,0,0,1), b0=(0,1,0,0)
    // k1: a1=(0,1,0,0), v1=(0,0.70710678,0,0.70710678), out=(5,6,7,8)
    const s2 = Math.SQRT1_2;
    const rotValues = new Float32Array([
      1, 2, 3, 4,
      0, 0, 0, 1,
      0, 1, 0, 0,
      0, 1, 0, 0,
      0, s2, 0, s2,
      5, 6, 7, 8,
    ]);
    const rotTrack = new KeyframeTrack("Bone", "rotation", times, rotValues, "CUBICSPLINE");

    const qAt0 = rotTrack.sampleQuaternion(0);
    expect(qAt0.x).toBeCloseTo(0);
    expect(qAt0.y).toBeCloseTo(0);
    expect(qAt0.z).toBeCloseTo(0);
    expect(qAt0.w).toBeCloseTo(1);

    const qAt1 = rotTrack.sampleQuaternion(1.0);
    expect(qAt1.x).toBeCloseTo(0);
    expect(qAt1.y).toBeCloseTo(s2);
    expect(qAt1.z).toBeCloseTo(0);
    expect(qAt1.w).toBeCloseTo(s2);

    // At t = 0.5: raw y = 0.5*0 + 0.125*1 + 0.5*s2 - 0.125*1 = 0.5*s2
    // raw w = 0.5*1 + 0 + 0.5*s2 - 0 = 0.5*(1 + s2)
    const rawY = 0.5 * s2;
    const rawW = 0.5 * (1 + s2);
    const len = Math.hypot(rawY, rawW);
    const qAtHalf = rotTrack.sampleQuaternion(0.5);
    expect(qAtHalf.x).toBeCloseTo(0);
    expect(qAtHalf.y).toBeCloseTo(rawY / len);
    expect(qAtHalf.z).toBeCloseTo(0);
    expect(qAtHalf.w).toBeCloseTo(rawW / len);
  });

  it("should cache negative bone lookups in AnimationMixer and call getObjectByName only once", () => {
    const root = new Object3D("Hero");
    const arm = new Bone("Arm");
    root.add(arm);

    const times = new Float32Array([0, 1.0]);
    const values = new Float32Array([0, 0, 0, 10, 0, 0]);
    const track = new KeyframeTrack("MissingBone", "translation", times, values, "LINEAR");
    const clip = new AnimationClip("Ghost", 1.0, [track]);

    const mixer = new AnimationMixer(root);
    const spy = vi.spyOn(root, "getObjectByName");
    mixer.clipAction(clip).play();

    mixer.update(0.1);
    mixer.update(0.1);
    mixer.update(0.1);

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("should bind unnamed or duplicate-named nodes unambiguously via track.targetNode when inside mixer root", () => {
    const root = new Object3D("Root");
    const nodeA = new Object3D("");
    const nodeB = new Object3D("");
    root.add(nodeA, nodeB);

    const times = new Float32Array([0, 1.0]);
    const trackB = new KeyframeTrack(
      "",
      "translation",
      times,
      new Float32Array([0, 0, 0, 10, 0, 0]),
      "LINEAR",
      nodeB,
    );
    const clip = new AnimationClip("UnnamedMove", 1.0, [trackB]);

    const mixer = new AnimationMixer(root);
    mixer.clipAction(clip).play();
    mixer.update(0.5);

    expect(nodeA.position.x).toBeCloseTo(0);
    expect(nodeB.position.x).toBeCloseTo(5);
  });
});
