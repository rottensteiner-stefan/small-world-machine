import { describe, it, expect, vi } from "vitest";
import { zipSync, gzipSync } from "fflate";
import {
  matchPbrSlots,
  ArchiveDecompressor,
  SecurityValidator,
  UniversalIngestRouter,
} from "../../src/common/io/index.js";

describe("Universal Ingestion Engine", () => {
  describe("PbrSlotMatcher", () => {
    it("matches multi-file texture batches to PBR slots", () => {
      const blobs = ["a", "n", "r", "m", "o"].map((c) => new Blob([c], { type: "image/png" }));
      const [albedo, normal, roughness, metallic, ao] = blobs;
      const files = [
        { name: "dungeon_brick_albedo.png", blob: albedo! },
        { name: "dungeon_brick_normal.png", blob: normal! },
        { name: "dungeon_brick_roughness.png", blob: roughness! },
        { name: "dungeon_brick_metallic.png", blob: metallic! },
        { name: "dungeon_brick_ao.png", blob: ao! },
        { name: "readme.txt", blob: new Blob(["txt"], { type: "text/plain" }) },
      ];

      const pbr = matchPbrSlots(files);
      expect(pbr).not.toBeNull();
      expect(pbr!.name).toBe("dungeon_brick");
      expect(pbr!.albedo).toBe(albedo);
      expect(pbr!.normal).toBe(normal);
      expect(pbr!.roughness).toBe(roughness);
      expect(pbr!.metallic).toBe(metallic);
      expect(pbr!.ao).toBe(ao);
      expect(pbr!.height).toBeUndefined();
    });

    it("recognizes alternative suffixes like _diff, _norm, _rgh, _disp", () => {
      const [diff, norm, rgh, disp] = ["d", "n", "r", "h"].map(
        (c) => new Blob([c], { type: "image/png" }),
      );
      const files = [
        { name: "rusted_iron_diff.jpg", blob: diff! },
        { name: "rusted_iron_norm.png", blob: norm! },
        { name: "rusted_iron_rgh.webp", blob: rgh! },
        { name: "rusted_iron_disp.png", blob: disp! },
      ];

      const pbr = matchPbrSlots(files);
      expect(pbr).not.toBeNull();
      expect(pbr!.albedo).toBe(diff);
      expect(pbr!.normal).toBe(norm);
      expect(pbr!.roughness).toBe(rgh);
      expect(pbr!.height).toBe(disp);
    });

    it("returns null if not enough matching slots are present", () => {
      const dummyBlob = new Blob(["dummy"], { type: "text/plain" });
      const files = [
        { name: "document.pdf", blob: dummyBlob },
        { name: "notes.txt", blob: dummyBlob },
      ];

      const pbr = matchPbrSlots(files);
      expect(pbr).toBeNull();
    });
  });

  describe("ArchiveDecompressor", () => {
    it("decompresses GZIP files in memory", async () => {
      const decompressor = new ArchiveDecompressor();
      const content = new TextEncoder().encode('{"name": "test_map", "version": 1}');
      const gzipped = gzipSync(content);

      const result = await decompressor.decompressGzip(gzipped, "level.json.gz");
      expect(result.name).toBe("level.json");
      expect(result.mimeType).toBe("application/json");
      const text = new TextDecoder().decode(result.data);
      expect(JSON.parse(text).name).toBe("test_map");
    });

    it("unpacks ZIP files into sanitized IngestFileItem entries", async () => {
      const decompressor = new ArchiveDecompressor();
      const zipData = zipSync({
        "manifest.json": new TextEncoder().encode('{"kit": "scifi"}'),
        "textures/wall_albedo.png": new Uint8Array([1, 2, 3, 4]),
      });

      const items = await decompressor.unpackZip(zipData);
      expect(items.length).toBe(2);
      const manifest = items.find((i) => i.name === "manifest.json");
      const texture = items.find((i) => i.name === "wall_albedo.png");
      expect(manifest?.mimeType).toBe("application/json");
      expect(manifest?.size).toBe(16);
      expect(texture?.path).toBe("textures/wall_albedo.png");
      expect(texture?.size).toBe(4);
    });

    it("rejects a ZIP whose declared entry size exceeds the file limit (zip bomb)", async () => {
      const decompressor = new ArchiveDecompressor(new SecurityValidator({ maxFileBytes: 1024 }));
      const bomb = zipSync({ "big.bin": new Uint8Array(1024 * 1024) });
      expect(bomb.byteLength).toBeLessThan(10 * 1024);
      await expect(decompressor.unpackZip(bomb)).rejects.toThrow(/exceeds limit/);
    });

    it("rejects a ZIP whose entries together exceed the total limit", async () => {
      const decompressor = new ArchiveDecompressor(
        new SecurityValidator({ maxFileBytes: 1024, maxTotalBytes: 1500 }),
      );
      const zip = zipSync({ "a.bin": new Uint8Array(1000), "b.bin": new Uint8Array(1000) });
      await expect(decompressor.unpackZip(zip)).rejects.toThrow(/Total payload size/);
    });

    it("skips Zip-Slip entries and disallowed extensions", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const decompressor = new ArchiveDecompressor();
      const zip = zipSync({
        "../evil.json": new Uint8Array([1]),
        "/abs.json": new Uint8Array([1]),
        "run.exe": new Uint8Array([1]),
        "ok/fine.json": new Uint8Array([1]),
      });
      const items = await decompressor.unpackZip(zip);
      expect(items.map((i) => i.path)).toEqual(["ok/fine.json"]);
      expect(warn).toHaveBeenCalledTimes(3);
      warn.mockRestore();
    });

    it("aborts GZIP decompression beyond the file limit (gzip bomb)", async () => {
      const decompressor = new ArchiveDecompressor(new SecurityValidator({ maxFileBytes: 1024 }));
      const bomb = gzipSync(new Uint8Array(4 * 1024 * 1024));
      await expect(decompressor.decompressGzip(bomb, "bomb.bin.gz")).rejects.toThrow(
        /exceeds limit/,
      );
    });
  });

  describe("UniversalIngestRouter", () => {
    const router = new UniversalIngestRouter();

    it("routes raw JSON string to kind json", async () => {
      const jsonStr = JSON.stringify({ author: "SmallWorldMachine", entities: [1, 2, 3] });
      const res = await router.routeText(jsonStr, "test_config");
      expect(res.kind).toBe("json");
      if (res.kind === "json") {
        expect((res.data as { author: string }).author).toBe("SmallWorldMachine");
        expect(res.name).toBe("test_config.json");
      }
    });

    it("routes raw plain text to kind text", async () => {
      const text = "Hello Small World Machine 3D!";
      const res = await router.routeText(text, "greeting");
      expect(res.kind).toBe("text");
      if (res.kind === "text") {
        expect(res.text).toBe("Hello Small World Machine 3D!");
      }
    });

    it("routes multi-file PBR texture batch to kind pbr-set", async () => {
      const albedoFile = new File([new Uint8Array([0])], "cobblestone_albedo.png", {
        type: "image/png",
      });
      const normalFile = new File([new Uint8Array([0])], "cobblestone_normal.png", {
        type: "image/png",
      });
      const roughFile = new File([new Uint8Array([0])], "cobblestone_roughness.png", {
        type: "image/png",
      });

      const res = await router.routeFiles([albedoFile, normalFile, roughFile]);
      expect(res.kind).toBe("pbr-set");
      if (res.kind === "pbr-set") {
        expect(res.name).toBe("cobblestone");
        expect(res.pbrSet.albedo).toBe(albedoFile);
        expect(res.pbrSet.normal).toBe(normalFile);
        expect(res.pbrSet.roughness).toBe(roughFile);
      }
    });

    it("routes ZIP package containing glTF to kind gltf", async () => {
      const zipData = zipSync({
        "robot.gltf": new TextEncoder().encode('{"asset": {"version": "2.0"}}'),
        "robot.bin": new Uint8Array([0, 1, 2]),
      });

      const res = await router.routeZipArchive(zipData, "robot_model.zip");
      expect(res.kind).toBe("gltf");
      if (res.kind === "gltf") {
        expect(res.mainFile).toBe("robot.gltf");
        expect(res.name).toBe("robot");
      }
    });

    it("routes ZIP package containing PBR maps to kind pbr-set", async () => {
      const zipData = zipSync({
        "wood_albedo.png": new Uint8Array([0]),
        "wood_normal.png": new Uint8Array([0]),
        "wood_roughness.png": new Uint8Array([0]),
      });

      const res = await router.routeZipArchive(zipData, "wood_pack.zip");
      expect(res.kind).toBe("pbr-set");
      if (res.kind === "pbr-set") {
        expect(res.name).toBe("wood");
        expect(res.pbrSet.albedo?.size).toBe(1);
        expect(res.pbrSet.normal?.size).toBe(1);
        expect(res.pbrSet.height).toBeUndefined();
      }
    });
  });
});
