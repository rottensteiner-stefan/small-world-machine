import { describe, it, expect } from "vitest";
import { getGltfExtensions } from "@small-world-machine/engine";
import "../src/register.js";

describe("@small-world-machine/gltf-extensions register", () => {
  it("registers both KHR_draco_mesh_compression and KHR_texture_basisu in the global engine registry", () => {
    const extensions = getGltfExtensions();
    const names = extensions.map((ext) => ext.name);

    expect(names).toContain("KHR_draco_mesh_compression");
    expect(names).toContain("KHR_texture_basisu");
  });

  it("deduplicates glTF extensions when registered multiple times [MAJ-08]", async () => {
    const { registerGltfExtension } = await import("@small-world-machine/engine");
    const dummyPlugin = { name: "TEST_duplicate_plugin" };
    registerGltfExtension(dummyPlugin);
    registerGltfExtension(dummyPlugin);

    const extensions = getGltfExtensions();
    const matches = extensions.filter((e) => e.name === "TEST_duplicate_plugin");
    expect(matches.length).toBe(1);
  });
});
