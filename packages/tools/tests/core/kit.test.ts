import { describe, it, expect } from "vitest";
import {
  createNodeDirectoryAssetSource,
  validateKitSource,
  validateKitStructure,
  validateKitZip,
} from "../../src/core/kit.js";
import { ZipAssetSink } from "../../src/common/io/sinks/ZipAssetSink.js";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VALID_MANIFEST = {
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

async function buildValidZip(): Promise<Uint8Array> {
  const sink = new ZipAssetSink();
  await sink.write("kit.json", new TextEncoder().encode(JSON.stringify(VALID_MANIFEST)));
  await sink.write("models/wall.glb", new Uint8Array([1, 2, 3]));
  await sink.write("previews/wall.png", new Uint8Array([1, 2, 3]));
  await sink.write("meta/wall.json", new TextEncoder().encode("{}"));
  return sink.build();
}

describe("core/kit validateKitStructure", () => {
  it("accepts a structurally valid manifest", () => {
    const report = validateKitStructure(VALID_MANIFEST);
    expect(report.valid).toBe(true);
    expect(report.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("rejects a manifest missing required fields", () => {
    const report = validateKitStructure({ id: "dungeon" });
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.path === "name")).toBe(true);
  });
});

describe("core/kit validateKitZip", () => {
  it("validates a complete kit archive from raw zip bytes", async () => {
    const bytes = await buildValidZip();
    const { report, manifest, dir } = await validateKitZip(bytes);
    expect(report.valid).toBe(true);
    expect(manifest?.["id"]).toBe("dungeon");
    expect(dir).toBe("");
  });

  it("reports an error when the archive has no kit.json", async () => {
    const sink = new ZipAssetSink();
    await sink.write("readme.txt", new TextEncoder().encode("no manifest"));
    const bytes = await sink.build();
    const { report } = await validateKitZip(bytes);
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.message.includes("kit.json"))).toBe(true);
  });
});

describe("core/kit createNodeDirectoryAssetSource", () => {
  it("walks a directory and validates through the same validator", async () => {
    const dir = await mkdtemp(join(tmpdir(), "swm-kit-test-"));
    try {
      await writeFile(join(dir, "kit.json"), JSON.stringify(VALID_MANIFEST), "utf-8");
      await mkdir(join(dir, "models"), { recursive: true });
      await mkdir(join(dir, "previews"), { recursive: true });
      await mkdir(join(dir, "meta"), { recursive: true });
      await writeFile(join(dir, "models", "wall.glb"), new Uint8Array([1, 2, 3]));
      await writeFile(join(dir, "previews", "wall.png"), new Uint8Array([1, 2, 3]));
      await writeFile(join(dir, "meta", "wall.json"), "{}", "utf-8");

      const source = await createNodeDirectoryAssetSource(dir);
      const files = await source.list();
      expect(files).toContain("kit.json");
      expect(files).toContain("models/wall.glb");

      const { report } = await validateKitSource(source);
      expect(report.valid).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("core/kit createNodeDirectoryAssetSource — lazy, safe", () => {
  it("reads file contents on demand (not snapshotted at construction)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "swm-kit-lazy-"));
    try {
      await writeFile(join(dir, "a.txt"), "one", "utf-8");
      const source = await createNodeDirectoryAssetSource(dir);
      await writeFile(join(dir, "a.txt"), "two", "utf-8");
      expect(await source.readText("a.txt")).toBe("two");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips node_modules/.git and does not choke on symlinked directories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "swm-kit-skip-"));
    try {
      await mkdir(join(dir, "node_modules", "x"), { recursive: true });
      await writeFile(join(dir, "node_modules", "x", "big.bin"), "x");
      await mkdir(join(dir, "real"), { recursive: true });
      await writeFile(join(dir, "real", "f.txt"), "f");
      await symlink(join(dir, "real"), join(dir, "linkdir"));
      await symlink(join(dir, "real"), join(dir, "real", "loop"));
      const source = await createNodeDirectoryAssetSource(dir);
      const files = await source.list();
      expect(files).toEqual(["real/f.txt"]);
      expect(await source.has("node_modules/x/big.bin")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("list(pattern) treats regex metacharacters literally and anchors the match", async () => {
    const dir = await mkdtemp(join(tmpdir(), "swm-kit-glob-"));
    try {
      for (const f of ["a.png", "a.png.bak", "aXpng", "b(1).png"]) {
        await writeFile(join(dir, f), "x");
      }
      const source = await createNodeDirectoryAssetSource(dir);
      expect((await source.list("*.png")).sort()).toEqual(["a.png", "b(1).png"]);
      expect(await source.list("b(1).png")).toEqual(["b(1).png"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("toFetch: malformed percent-encoding yields 400 (no throw), missing 404, hit 200", async () => {
    const dir = await mkdtemp(join(tmpdir(), "swm-kit-fetch-"));
    try {
      await writeFile(join(dir, "a b.txt"), "hi");
      const source = await createNodeDirectoryAssetSource(dir);
      const f = source.toFetch();
      expect((await f("/%E0%A4%A.txt")).status).toBe(400);
      expect((await f("/missing.txt")).status).toBe(404);
      expect((await f("/../etc/passwd")).status).toBe(404);
      const ok = await f("/a%20b.txt?x=1");
      expect(ok.status).toBe(200);
      expect(await ok.text()).toBe("hi");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
