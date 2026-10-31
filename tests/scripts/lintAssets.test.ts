import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  lintAssets,
  lintKit,
  lintGlbModel,
  parseGlb,
  type GlbData,
  type PropMeta,
} from "../../.agents/scripts/lint-assets.js";

const SCRIPT_PATH = path.resolve(process.cwd(), ".agents/scripts/lint-assets.ts");
const TSX_CLI = path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");

describe("Asset Linter (scripts/lint-assets.ts)", () => {
  describe("Repository baseline audit", () => {
    it("runs cleanly on all kits in public/assets/kits/** with 0 errors", () => {
      const summary = lintAssets();
      expect(summary.scannedKits).toBe(3);
      expect(summary.errorCount).toBe(0);
      expect(summary.issues).toEqual([]);
    });

    it("CLI execution succeeds with exit code 0", () => {
      const res = spawnSync(process.execPath, [TSX_CLI, SCRIPT_PATH], { encoding: "utf8" });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("All kit assets passed 7/7 core checks cleanly");
    }, 20_000);

    it("CLI --help displays usage and all 7 core checks", () => {
      const res = spawnSync(process.execPath, [TSX_CLI, SCRIPT_PATH, "--help"], {
        encoding: "utf8",
      });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Geometrie-Vollständigkeit");
      expect(res.stdout).toContain("Degenerierte Dreiecke");
      expect(res.stdout).toContain("Root-Transform-Konformität");
      expect(res.stdout).toContain("Keine negativen Skalierungen");
      expect(res.stdout).toContain("Polycount-Budget");
      expect(res.stdout).toContain("Konsistenzcheck AABB");
      expect(res.stdout).toContain("Textur-Slot- und Namensverträge");
    }, 20_000);
  });

  describe("Unit & Mutation checks", () => {
    let tmpDir: string;
    const realBlastDoorGlb = path.resolve(
      process.cwd(),
      "public/assets/kits/flakturm/props/bunker_blast_door/model.glb",
    );
    const realBlastDoorMeta = JSON.parse(
      fs.readFileSync(
        path.resolve(
          process.cwd(),
          "public/assets/kits/flakturm/props/bunker_blast_door/meta.json",
        ),
        "utf8",
      ),
    ) as PropMeta;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "swm-lint-assets-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function createGlbBuffer(json: GlbData, bin: Buffer = Buffer.alloc(1024)): Buffer {
      const jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
      // Align JSON chunk to 4-byte boundary with spaces
      const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
      const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);

      // Align BIN chunk to 4-byte boundary
      const binPad = (4 - (bin.length % 4)) % 4;
      const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);

      const totalLength = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
      const header = Buffer.alloc(12);
      header.writeUInt32LE(0x46546c67, 0); // "glTF"
      header.writeUInt32LE(2, 4); // version 2
      header.writeUInt32LE(totalLength, 8);

      const chunk0Header = Buffer.alloc(8);
      chunk0Header.writeUInt32LE(jsonChunk.length, 0);
      chunk0Header.writeUInt32LE(0x4e4f534a, 4); // "JSON"

      const chunk1Header = Buffer.alloc(8);
      chunk1Header.writeUInt32LE(binChunk.length, 0);
      chunk1Header.writeUInt32LE(0x004e4942, 4); // "BIN\0"

      return Buffer.concat([header, chunk0Header, jsonChunk, chunk1Header, binChunk]);
    }

    it("rule 1: detects missing POSITION, NORMAL, TEXCOORD_0 and invalid TANGENT", () => {
      const fakeJson: GlbData = {
        asset: { version: "2.0" },
        meshes: [
          {
            primitives: [
              {
                attributes: {
                  // missing POSITION, NORMAL, TEXCOORD_0
                  TANGENT: 0,
                },
              },
            ],
          },
        ],
        accessors: [
          {
            bufferView: 0,
            componentType: 5126,
            count: 3,
            type: "VEC3", // invalid: tangent must be VEC4!
          },
        ],
        bufferViews: [{ buffer: 0, byteLength: 36 }],
        buffers: [{ byteLength: 36 }],
      };
      const glbBuf = createGlbBuffer(fakeJson);
      const testGlb = path.join(tmpDir, "incomplete.glb");
      fs.writeFileSync(testGlb, glbBuf);

      const issues = lintGlbModel(testGlb, "test/incomplete");
      const rules = issues.map((i) => i.rule);

      expect(rules).toContain("geometry-completeness");
      expect(issues.some((i) => i.message.includes("missing required POSITION"))).toBe(true);
      expect(issues.some((i) => i.message.includes("missing required NORMAL"))).toBe(true);
      expect(issues.some((i) => i.message.includes("missing required TEXCOORD_0"))).toBe(true);
      expect(issues.some((i) => i.message.includes("TANGENT must be VEC4"))).toBe(true);
    });

    it("rule 2: detects degenerate zero-area and duplicate-index triangles", () => {
      // Create a GLB with 3 vertices forming a zero-area / duplicate-index triangle
      const bin = Buffer.alloc(128);
      // Vertex 0: [0, 0, 0]
      bin.writeFloatLE(0, 0);
      bin.writeFloatLE(0, 4);
      bin.writeFloatLE(0, 8);
      // Vertex 1: [1, 0, 0]
      bin.writeFloatLE(1, 12);
      bin.writeFloatLE(0, 16);
      bin.writeFloatLE(0, 20);
      // Vertex 2: [2, 0, 0] (collinear with v0 and v1 -> area 0)
      bin.writeFloatLE(2, 24);
      bin.writeFloatLE(0, 28);
      bin.writeFloatLE(0, 32);

      // Indices: [0, 0, 1] (duplicate indices) + [0, 1, 2] (collinear)
      const indOffset = 36;
      bin.writeUInt16LE(0, indOffset);
      bin.writeUInt16LE(0, indOffset + 2);
      bin.writeUInt16LE(1, indOffset + 4);

      bin.writeUInt16LE(0, indOffset + 6);
      bin.writeUInt16LE(1, indOffset + 8);
      bin.writeUInt16LE(2, indOffset + 10);

      const fakeJson: GlbData = {
        asset: { version: "2.0" },
        meshes: [
          {
            primitives: [
              {
                attributes: {
                  POSITION: 0,
                  NORMAL: 1,
                  TEXCOORD_0: 2,
                },
                indices: 3,
              },
            ],
          },
        ],
        accessors: [
          {
            bufferView: 0,
            byteOffset: 0,
            componentType: 5126,
            count: 3,
            type: "VEC3",
            min: [0, 0, 0],
            max: [2, 0, 0],
          },
          { bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: "VEC3" },
          { bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: "VEC2" },
          { bufferView: 1, byteOffset: 0, componentType: 5123, count: 6, type: "SCALAR" },
        ],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: 36 },
          { buffer: 0, byteOffset: indOffset, byteLength: 12 },
        ],
        buffers: [{ byteLength: 128 }],
      };

      const glbBuf = createGlbBuffer(fakeJson, bin);
      const testGlb = path.join(tmpDir, "degen.glb");
      fs.writeFileSync(testGlb, glbBuf);

      const issues = lintGlbModel(testGlb, "test/degen");
      expect(issues.some((i) => i.rule === "degenerate-triangles")).toBe(true);
    });

    it("rule 3: detects non-identity root node transforms", () => {
      const parsed = parseGlb(fs.readFileSync(realBlastDoorGlb));
      // Inject non-identity translation on root node
      if (parsed.json.nodes && parsed.json.nodes[0]) {
        parsed.json.nodes[0].translation = [0, 1.5, 0];
      }
      const glbBuf = createGlbBuffer(parsed.json, parsed.bin);
      const testGlb = path.join(tmpDir, "root_trans.glb");
      fs.writeFileSync(testGlb, glbBuf);

      const issues = lintGlbModel(testGlb, "test/root_trans", realBlastDoorMeta);
      expect(issues.some((i) => i.rule === "root-transform")).toBe(true);
      expect(issues.find((i) => i.rule === "root-transform")?.message).toContain(
        "non-zero translation",
      );
    });

    it("rule 4: detects negative node scale (flipped winding order)", () => {
      const parsed = parseGlb(fs.readFileSync(realBlastDoorGlb));
      // Inject negative scale on node 1
      if (parsed.json.nodes && parsed.json.nodes[1]) {
        parsed.json.nodes[1].scale = [-100, 100, 100];
      }
      const glbBuf = createGlbBuffer(parsed.json, parsed.bin);
      const testGlb = path.join(tmpDir, "neg_scale.glb");
      fs.writeFileSync(testGlb, glbBuf);

      const issues = lintGlbModel(testGlb, "test/neg_scale", realBlastDoorMeta);
      expect(issues.some((i) => i.rule === "negative-scale")).toBe(true);
      expect(issues.find((i) => i.rule === "negative-scale")?.message).toContain("negative scale");
    });

    it("rule 5: detects polycount budget violation on non-grandfathered asset", () => {
      // realBlastDoorGlb has 13,092 triangles. If treated as a new asset with T1 dimensions (max 1500 tris):
      const newMeta: PropMeta = {
        ...realBlastDoorMeta,
        dimensions: { width: 0.2, height: 0.2, depth: 0.2 }, // T1: max 1500 tris
      };
      const issues = lintGlbModel(realBlastDoorGlb, "test/new_overbudget_prop", newMeta);
      expect(issues.some((i) => i.rule === "polycount-budget")).toBe(true);
      expect(issues.find((i) => i.rule === "polycount-budget")?.message).toContain(
        "exceeds budget",
      );
    });

    it("rule 6: catches the historic Bunker Blast Door scale & AABB discrepancy", () => {
      // The historic export error: measured mesh was a ~0.92 x 1.0 x 0.94m block,
      // while meta.json falsely claimed 1.8 x 2.2 x 0.25m (8x aspect ratio distortion).
      const historicMeta: PropMeta = {
        ...realBlastDoorMeta,
        dimensions: { width: 1.8, height: 2.2, depth: 0.25 },
      };
      const issues = lintGlbModel(realBlastDoorGlb, "flakturm/bunker_blast_door", historicMeta);
      const aabbIssue = issues.find((i) => i.rule === "aabb-consistency");
      expect(aabbIssue).toBeDefined();
      expect(aabbIssue?.message).toContain("Severe aspect-ratio mismatch");
      expect(aabbIssue?.message).toContain("ratio factor 8.1x > 3.0x");
    });

    it("rule 7: detects invalid texture slot tokens, non-webp maps, and missing files", () => {
      const kitDir = path.join(tmpDir, "bad_kit");
      fs.mkdirSync(kitDir);
      fs.mkdirSync(path.join(kitDir, "textures", "bad_mat"), { recursive: true });
      fs.mkdirSync(path.join(kitDir, "decals"), { recursive: true });

      fs.writeFileSync(path.join(kitDir, "textures", "bad_mat", "invalid_slot.png"), "dummy");
      fs.writeFileSync(path.join(kitDir, "decals", "decal_test.png"), "dummy");

      const kitJson = {
        id: "bad_kit",
        name: "Bad Kit",
        version: "1.0.0",
        description: "Test kit with contract violations",
        items: [],
        textures: [
          {
            id: "bad_kit/bad_mat",
            name: "Bad Mat",
            category: "walls",
            maps: ["invalid_slot.png", "missing_albedo.webp"],
          },
        ],
        decals: [
          {
            id: "bad_kit/bad_decal",
            name: "Bad Decal",
            file: "decal_test.png", // not .webp!
          },
        ],
        author: "Tester",
        license: "MIT",
      };
      fs.writeFileSync(path.join(kitDir, "kit.json"), JSON.stringify(kitJson, null, 2));

      const issues = lintKit(kitDir);
      expect(issues.some((i) => i.message.includes("does not match any recognized PBR slot"))).toBe(
        true,
      );
      expect(issues.some((i) => i.message.includes("is not in WebP format"))).toBe(true);
      expect(issues.some((i) => i.message.includes("missing on disk"))).toBe(true);
    });
  });
});
