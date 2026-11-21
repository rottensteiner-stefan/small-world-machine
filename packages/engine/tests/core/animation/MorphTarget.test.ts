import { describe, expect, it } from "vitest";
import {
  AnimationClip,
  AnimationMixer,
  KeyframeTrack,
  MorphTargetBlender,
} from "../../../src/core/animation/index.js";
import { Object3D } from "../../../src/core/Object3D.js";
import { ModelGeometry } from "../../../src/geometry/index.js";
import { BoundingBox } from "../../../src/physix/index.js";
import { GltfLoader } from "../../../src/loaders/GltfLoader.js";
import { partitionInstanceRuns } from "../../../src/renderers/AutoInstancing.js";

describe("MorphTargetBlender (AN09)", () => {
  it("blends position, normal (renormalized), and tangent xyz deltas while preserving tangent.w", () => {
    const geo = new ModelGeometry(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Float32Array([0, 0, 1, 0, 0, 1]),
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      new Uint16Array([0, 1, 2]),
      {
        tangents: new Float32Array([1, 0, 0, -1, 1, 0, 0, 1, 1, 0, 0, -1]),
        morphTargets: [
          {
            positions: new Float32Array([0, 2, 0, 0, 4, 0, 0, 6, 0]),
            normals: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]),
            tangents: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
          },
          {
            positions: new Float32Array([10, 0, 0, 10, 0, 0, 10, 0, 0]),
          },
        ],
        morphTargetNames: ["Lift", "ShiftX"],
      },
    ).getGeometryData();

    const out = {
      positions: new Float32Array(geo.vertices.length),
      normals: new Float32Array(geo.normals!.length),
      tangents: new Float32Array(geo.tangents!.length),
    };

    MorphTargetBlender.blend(geo, [0.5, 0.2], out);

    // Positions: base + 0.5*Lift + 0.2*ShiftX
    expect(out.positions[0]).toBeCloseTo(2, 5);
    expect(out.positions[1]).toBeCloseTo(1, 5);
    expect(out.positions[4]).toBeCloseTo(2, 5);
    expect(out.positions[7]).toBeCloseTo(4, 5);

    // Normals: normalize((0,0,1) + 0.5*(1,0,0)) = normalize(0.5, 0, 1)
    const invN = 1 / Math.hypot(0.5, 1);
    expect(out.normals[0]).toBeCloseTo(0.5 * invN, 5);
    expect(out.normals[1]).toBeCloseTo(0, 5);
    expect(out.normals[2]).toBeCloseTo(invN, 5);

    // Tangents: xyz renormalized, w handedness preserved verbatim (-1, 1, -1)
    const invT = 1 / Math.hypot(1, 0.5);
    expect(out.tangents[0]).toBeCloseTo(invT, 5);
    expect(out.tangents[1]).toBeCloseTo(0.5 * invT, 5);
    expect(out.tangents[3]).toBe(-1);
    expect(out.tangents[7]).toBe(1);
    expect(out.tangents[11]).toBe(-1);

    // Morphed bounding box reflects displaced vertices
    const bounds = new BoundingBox();
    MorphTargetBlender.computeMorphedBounds(geo, [0.5, 0.2], bounds);
    expect(bounds.min.x).toBeCloseTo(2, 5);
    expect(bounds.max.x).toBeCloseTo(3, 5);
    expect(bounds.min.y).toBeCloseTo(1, 5);
    expect(bounds.max.y).toBeCloseTo(4, 5);
  });

  it("tracks weight changes cleanly via hasActiveWeights and weightsDiffer", () => {
    expect(MorphTargetBlender.hasActiveWeights(undefined)).toBe(false);
    expect(MorphTargetBlender.hasActiveWeights([0, 0])).toBe(false);
    expect(MorphTargetBlender.hasActiveWeights([0, 0.25])).toBe(true);

    const cached = new Float32Array([0.1, 0.5]);
    expect(MorphTargetBlender.weightsDiffer([0.1, 0.5], cached, 2)).toBe(false);
    expect(MorphTargetBlender.weightsDiffer([0.1, 0.6], cached, 2)).toBe(true);
    expect(MorphTargetBlender.weightsDiffer([0.1, 0.5], undefined, 2)).toBe(true);
  });
});

describe("KeyframeTrack & AnimationMixer morph weights (AN09)", () => {
  it("evaluates STEP, LINEAR, and CUBICSPLINE weights tracks and blends against rest weights", () => {
    const linearTrack = new KeyframeTrack(
      "Face",
      "weights",
      new Float32Array([0, 1]),
      new Float32Array([0, 1, 1, 0]),
      "LINEAR",
    );
    const out = new Float32Array(2);
    expect(linearTrack.evaluateWeights(0.25, out)).toBe(2);
    expect(out[0]).toBeCloseTo(0.25, 5);
    expect(out[1]).toBeCloseTo(0.75, 5);

    const stepTrack = new KeyframeTrack(
      "Face",
      "weights",
      new Float32Array([0, 1]),
      new Float32Array([0.2, 0.8, 0.9, 0.1]),
      "STEP",
    );
    stepTrack.evaluateWeights(0.9, out);
    expect(out[0]).toBeCloseTo(0.2, 5);
    expect(out[1]).toBeCloseTo(0.8, 5);

    // CUBICSPLINE: 2 keyframes * 3 (in, val, out) * 2 targets = 12 floats
    // k0: val=(0, 1), out=(2, 0); k1: in=(0, 0), val=(1, 0)
    const cubicTrack = new KeyframeTrack(
      "Face",
      "weights",
      new Float32Array([0, 1]),
      new Float32Array([
        0,
        0, // in0
        0,
        1, // v0
        2,
        0, // b0
        0,
        0, // a1
        1,
        0, // v1
        0,
        0, // out1
      ]),
      "CUBICSPLINE",
    );
    cubicTrack.evaluateWeights(0.5, out);
    // c0=0.5, c1=0.125, c2=0.5, c3=-0.125 -> w0 = 0.5*0 + 0.125*2 + 0.5*1 + 0 = 0.75; w1 = 0.5
    expect(out[0]).toBeCloseTo(0.75, 5);
    expect(out[1]).toBeCloseTo(0.5, 5);

    // Mixer rest-pose blend at weight = 0.5: rest = [0, 0], animated = [1, 0] -> [0.5, 0]
    const root = new Object3D("Root");
    const face = new Object3D("Face");
    face.morphTargetInfluences = new Float32Array([0, 0]);
    root.add(face);
    const clip = new AnimationClip("Smile", 1, [linearTrack]);
    const mixer = new AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.weight = 0.5;
    action.play();
    mixer.update(1); // at t=1 (loop wraps to 0 unless loop=false) -> set loop=false first
    action.setLoop(false);
    action.reset();
    action.play();
    mixer.update(1);
    expect(face.morphTargetInfluences[0]).toBeCloseTo(0.5, 5);
    expect(face.morphTargetInfluences[1]).toBeCloseTo(0, 5);
  });
});

describe("glTF morph target roundtrip & AutoInstancing exclusion (AN09)", () => {
  it("parses primitive.targets, weights, targetNames, multi-primitive sharing, weights animation, and clone isolation", async () => {
    // Pack buffers:
    // 0: base POSITION (3 verts * 3 floats = 36 B)
    // 1: target0 POSITION delta (36 B)
    // 2: target0 NORMAL delta (36 B)
    // 3: target1 POSITION delta (36 B)
    // 4: anim times (2 floats = 8 B)
    // 5: anim weights (2 keys * 2 targets = 4 floats = 16 B)
    const chunks = [
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      new Float32Array([2, 0, 0, 2, 0, 0, 2, 0, 0]),
      new Float32Array([0, 1]),
      new Float32Array([0, 0, 1, 0.5]),
    ];
    const totalBytes = chunks.reduce((s, c) => s + c.byteLength, 0);
    const bin = new ArrayBuffer(totalBytes);
    const view = new Uint8Array(bin);
    const bufferViews: { buffer: number; byteOffset: number; byteLength: number }[] = [];
    let offset = 0;
    for (const c of chunks) {
      view.set(new Uint8Array(c.buffer), offset);
      bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: c.byteLength });
      offset += c.byteLength;
    }

    const gltf = {
      json: {
        asset: { version: "2.0" },
        bufferViews,
        accessors: [
          { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
          { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
          { bufferView: 2, componentType: 5126, count: 3, type: "VEC3" },
          { bufferView: 3, componentType: 5126, count: 3, type: "VEC3" },
          { bufferView: 4, componentType: 5126, count: 2, type: "SCALAR" },
          { bufferView: 5, componentType: 5126, count: 4, type: "SCALAR" },
        ],
        meshes: [
          {
            name: "MorphedHead",
            weights: [0.1, 0.2],
            extras: { targetNames: ["Smile", "Blink"] },
            primitives: [
              {
                attributes: { POSITION: 0 },
                targets: [{ POSITION: 1, NORMAL: 2 }, { POSITION: 3 }],
              },
              {
                attributes: { POSITION: 0 },
                targets: [{ POSITION: 1 }, { POSITION: 3 }],
              },
            ],
          },
        ],
        nodes: [{ name: "HeadNode", mesh: 0, weights: [0.3, 0.4] }],
        animations: [
          {
            name: "MorphAnim",
            samplers: [{ input: 4, output: 5, interpolation: "LINEAR" as const }],
            channels: [{ sampler: 0, target: { node: 0, path: "weights" as const } }],
          },
        ],
        scenes: [{ nodes: [0] }],
        scene: 0,
      },
      buffers: [bin],
    };

    const loader = new GltfLoader();
    const root = await loader.parse(gltf, "");
    const headNode = root.getObjectByName("HeadNode")!;
    expect(headNode).toBeDefined();
    expect(headNode.children).toHaveLength(2);

    const prim0 = headNode.children[0]!;
    const prim1 = headNode.children[1]!;

    // Node.weights overrides mesh.weights and is shared across both primitive children
    expect(headNode.morphTargetInfluences).toBeInstanceOf(Float32Array);
    expect(prim0.morphTargetInfluences).toBe(headNode.morphTargetInfluences);
    expect(prim1.morphTargetInfluences).toBe(headNode.morphTargetInfluences);
    expect(headNode.morphTargetInfluences![0]).toBeCloseTo(0.3, 5);
    expect(headNode.morphTargetInfluences![1]).toBeCloseTo(0.4, 5);

    // Geometry morph targets & names parsed
    expect(prim0.geometry?.morphTargets).toHaveLength(2);
    expect(prim0.geometry?.morphTargets![0]!.positions![1]).toBeCloseTo(1, 5);
    expect(prim0.geometry?.morphTargets![0]!.normals![2]).toBeCloseTo(1, 5);
    expect(prim0.geometry?.morphTargetNames).toEqual(["Smile", "Blink"]);

    // Animation clip parsed with `"weights"` track and updates both primitives via shared array
    expect(root.animations).toHaveLength(1);
    expect(root.animations[0]!.tracks).toHaveLength(1);
    expect(root.animations[0]!.tracks[0]!.property).toBe("weights");

    const mixer = new AnimationMixer(root);
    const action = mixer.clipAction(root.animations[0]!);
    action.setLoop(false).play();
    mixer.update(0.5);
    expect(prim0.morphTargetInfluences![0]).toBeCloseTo(0.5, 5);
    expect(prim1.morphTargetInfluences![1]).toBeCloseTo(0.25, 5);

    // Cloned rig gets an independent influences buffer that is still shared across its own primitives
    const clonedRoot = root.clone();
    const clonedHead = clonedRoot.getObjectByName("HeadNode")!;
    expect(clonedHead.morphTargetInfluences).not.toBe(headNode.morphTargetInfluences);
    expect(clonedHead.children[0]!.morphTargetInfluences).toBe(clonedHead.morphTargetInfluences);
    expect(clonedHead.children[1]!.morphTargetInfluences).toBe(clonedHead.morphTargetInfluences);
    clonedHead.morphTargetInfluences![0] = 0.99;
    expect(headNode.morphTargetInfluences![0]).toBeCloseTo(0.5, 5);

    // AutoInstancing excludes morphed meshes from instanced runs
    const objs = [prim0, prim0.clone(), prim0.clone(), prim0.clone(), prim0.clone()];
    const runObjects: Object3D[] = [];
    const runs: number[] = [];
    const rest: Object3D[] = [];
    partitionInstanceRuns(objs, runObjects, runs, rest);
    expect(runs).toHaveLength(0);
    expect(rest).toHaveLength(5);
  });
});
