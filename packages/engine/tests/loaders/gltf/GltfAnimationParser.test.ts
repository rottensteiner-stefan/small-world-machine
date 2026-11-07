import { describe, it, expect } from "vitest";
import { GltfAnimationParser } from "../../../src/loaders/gltf/GltfAnimationParser.js";
import { Object3D } from "../../../src/core/Object3D.js";

describe("GltfAnimationParser", () => {
  it("parses animation channels and creates keyframe tracks", () => {
    const timeFloats = new Float32Array([0.0, 1.0]);
    const posFloats = new Float32Array([0, 0, 0, 10, 0, 0]);

    const buffers = [timeFloats.buffer, posFloats.buffer];

    const json = {
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 8 },
        { buffer: 1, byteOffset: 0, byteLength: 24 },
      ],
      accessors: [
        { bufferView: 0, byteOffset: 0, componentType: 5126, count: 2, type: "SCALAR" },
        { bufferView: 1, byteOffset: 0, componentType: 5126, count: 2, type: "VEC3" },
      ],
      animations: [
        {
          name: "Run",
          samplers: [{ input: 0, output: 1, interpolation: "LINEAR" as const }],
          channels: [{ sampler: 0, target: { node: 0, path: "translation" as const } }],
        },
      ],
    };

    const targetObj = new Object3D("HeroNode");
    const nodeObjects = [targetObj];

    const clips = GltfAnimationParser.parseAnimations(json, buffers, nodeObjects);
    expect(clips).toHaveLength(1);
    expect(clips[0]!.name).toBe("Run");
    expect(clips[0]!.tracks).toHaveLength(1);
    expect(clips[0]!.tracks[0]!.targetName).toBe("HeroNode");
    expect(clips[0]!.tracks[0]!.property).toBe("translation");
  });
});
