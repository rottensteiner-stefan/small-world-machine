import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Object3D, StandardMaterial, Cube, WorldWriter } from "@small-world-machine/engine";
import { GltfBinaryParser } from "@small-world-machine/engine/loaders/gltf/GltfBinaryParser.js";
import { runSwm, type CliIo } from "../../src/cli/index.js";

function captureIo(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      out: (line: string) => out.push(line),
      err: (line: string) => err.push(line),
      readStdin: async () => "",
    },
  };
}

describe("swm glb CLI", () => {
  it("packs a .gltf with embedded data URI into a parseable .glb with --binary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "swm-glb-cli-"));
    try {
      const mesh = new Object3D("Crate");
      mesh.geometry = new Cube({ size: 1 }).getGeometryData();
      mesh.material = new StandardMaterial();
      const doc = new WorldWriter().writeSingle(mesh);
      const inPath = join(dir, "crate.gltf");
      const outPath = join(dir, "crate.glb");
      writeFileSync(inPath, JSON.stringify(doc), "utf8");

      const cap = captureIo();
      const code = await runSwm(["glb", "--binary", inPath, outPath], cap.io);
      expect(code).toBe(0);
      expect(cap.err).toEqual([]);

      const bytes = readFileSync(outPath);
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const parsed = GltfBinaryParser.parseGlb(ab);
      expect(parsed.json.nodes?.[0]?.name).toBe("Crate");
      expect(parsed.json.buffers?.[0]?.uri).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns exit code 1 when <input.gltf> is missing", async () => {
    const cap = captureIo();
    const code = await runSwm(["glb"], cap.io);
    expect(code).toBe(1);
    expect(cap.err.some((l) => l.includes("missing"))).toBe(true);
  });
});
