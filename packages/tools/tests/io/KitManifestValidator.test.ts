import { describe, it, expect } from "vitest";
import {
  validateKitManifest,
  validateKitManifestStructure,
} from "../../src/common/io/KitManifestValidator.js";
import { ZipAssetSink } from "../../src/common/io/sinks/ZipAssetSink.js";
import { ZipAssetSource } from "../../src/common/io/sources/ZipAssetSource.js";

describe("KitManifestValidator", () => {
  it("should validate a complete kit archive with kit.json manifest and assets", async () => {
    const sink = new ZipAssetSink();

    const manifest = {
      id: "dungeon",
      name: "Dungeon Kit",
      version: "1.0.0",
      description: "Modular dungeon props",
      author: "Antigravity Team",
      license: "CC0",
      items: [
        {
          id: "dungeon/wall_01",
          name: "Stone Wall",
          category: "walls",
          path: "models/wall.glb",
          preview: "previews/wall.png",
          meta: "meta/wall.json",
        },
      ],
    };

    await sink.write("kit.json", new TextEncoder().encode(JSON.stringify(manifest)));
    await sink.write("models/wall.glb", new Uint8Array([0, 1, 2]));
    await sink.write("previews/wall.png", new Uint8Array([0, 1, 2]));
    await sink.write("meta/wall.json", new TextEncoder().encode("{}"));

    const zipBuffer = await sink.build();
    const source = await ZipAssetSource.fromBytes(zipBuffer);

    const { report, manifest: parsed, dir } = await validateKitManifest(source);
    expect(report.valid).toBe(true);
    expect(report.issues.filter((i) => i.severity === "error")).toHaveLength(0);
    expect(parsed?.["id"]).toBe("dungeon");
    expect(dir).toBe("");
  });

  it("should report error if kit.json is missing", async () => {
    const sink = new ZipAssetSink();
    await sink.write("readme.txt", new TextEncoder().encode("No manifest here"));

    const zipBuffer = await sink.build();
    const source = await ZipAssetSource.fromBytes(zipBuffer);

    const { report } = await validateKitManifest(source);
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.message.includes("kit.json"))).toBe(true);
  });

  it("should warn if referenced asset file is missing in the archive", async () => {
    const sink = new ZipAssetSink();

    const manifest = {
      id: "dungeon",
      name: "Dungeon Kit",
      version: "1.0.0",
      description: "Modular dungeon props",
      author: "Antigravity Team",
      license: "CC0",
      items: [
        {
          id: "dungeon/ghost",
          name: "Missing Item",
          category: "props",
          path: "models/ghost.glb",
          preview: "previews/ghost.png",
          meta: "meta/ghost.json",
        },
      ],
    };

    await sink.write("kit.json", new TextEncoder().encode(JSON.stringify(manifest)));

    const zipBuffer = await sink.build();
    const source = await ZipAssetSource.fromBytes(zipBuffer);

    const { report } = await validateKitManifest(source);
    expect(report.valid).toBe(true); // Structure is valid, files produce warnings
    expect(
      report.issues.some((i) => i.severity === "warning" && i.message.includes("ghost.glb")),
    ).toBe(true);
  });

  it("should reject structurally invalid manifest", () => {
    const report = validateKitManifestStructure({
      id: "INVALID ID WITH SPACES",
      name: "Bad Kit",
    });
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.path === "id")).toBe(true);
    expect(report.issues.some((i) => i.path === "version")).toBe(true);
  });

  describe("decal extras", () => {
    const base = {
      id: "kit",
      name: "Kit",
      version: "1.0.0",
      description: "d",
      author: "a",
      license: "CC0",
    };
    const decal = (extra: Record<string, unknown>): Record<string, unknown> => ({
      ...base,
      decals: [{ id: "kit/d", name: "D", file: "d.png", ...extra }],
    });

    it("accepts valid normal/orm/emission/size/unlit", () => {
      const report = validateKitManifestStructure(
        decal({
          normal: "d_n.png",
          orm: "d_orm.png",
          emission: "d_e.png",
          size: [1, 0.5, 0.25],
          unlit: true,
        }),
      );
      expect(report.issues.filter((i) => i.severity === "error")).toHaveLength(0);
    });

    it("accepts WebP for previews, texture maps and decal files like the schema", () => {
      const report = validateKitManifestStructure({
        ...base,
        items: [
          {
            id: "kit/i",
            name: "I",
            category: "c",
            path: "i.glb",
            preview: "i.webp",
            meta: "i.json",
          },
        ],
        textures: [{ id: "kit/t", name: "T", category: "c", maps: ["t_albedo.webp", "t_n.png"] }],
        decals: [{ id: "kit/d", name: "D", file: "d.webp", normal: "d_n.webp" }],
      });
      expect(report.issues.filter((i) => i.severity === "error")).toHaveLength(0);
    });

    it("rejects invalid decal extras", () => {
      const report = validateKitManifestStructure(
        decal({ normal: 3, orm: "x.jpg", size: [1, 0, 1], unlit: "yes" }),
      );
      const paths = report.issues.map((i) => i.path);
      expect(report.valid).toBe(false);
      expect(paths).toContain("decals[0].normal");
      expect(paths).toContain("decals[0].orm");
      expect(paths).toContain("decals[0].size");
      expect(paths).toContain("decals[0].unlit");
    });

    it("rejects size with wrong length", () => {
      const report = validateKitManifestStructure(decal({ size: [1, 1] }));
      expect(report.issues.some((i) => i.path === "decals[0].size")).toBe(true);
    });

    it("warns about missing extra map files", async () => {
      const sink = new ZipAssetSink();
      await sink.write(
        "kit.json",
        new TextEncoder().encode(JSON.stringify(decal({ normal: "d_n.png" }))),
      );
      await sink.write("decals/d.png", new Uint8Array([0]));
      const source = await ZipAssetSource.fromBytes(await sink.build());
      const { report } = await validateKitManifest(source);
      expect(report.issues.some((i) => i.path === "decals[0].normal")).toBe(true);
      expect(report.issues.some((i) => i.path === "decals[0].file")).toBe(false);
    });
  });
});
