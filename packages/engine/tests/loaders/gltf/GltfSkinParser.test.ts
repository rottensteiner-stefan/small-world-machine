import { describe, it, expect } from "vitest";
import { GltfSkinParser } from "../../../src/loaders/gltf/GltfSkinParser.js";
import { Bone } from "../../../src/core/animation/index.js";

describe("GltfSkinParser", () => {
  it("parses joint hierarchies into Skeletons", () => {
    const bone0 = new Bone("Root");
    const bone1 = new Bone("Arm");
    const nodeObjects = [bone0, bone1];

    const json = {
      skins: [
        {
          joints: [0, 1],
          name: "Armature",
        },
      ],
      accessors: [],
    };

    const skeletons = GltfSkinParser.parseSkeletons(json, [], nodeObjects);
    expect(skeletons).toHaveLength(1);
    expect(skeletons[0]!.bones).toHaveLength(2);
    expect(skeletons[0]!.bones[0]).toBe(bone0);
    expect(skeletons[0]!.bones[1]).toBe(bone1);
  });
});
