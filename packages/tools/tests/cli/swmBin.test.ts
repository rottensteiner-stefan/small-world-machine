import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const SWM_BIN = fileURLToPath(new URL("../../src/cli/swm.mjs", import.meta.url));

// Smoke gate for the packaged entry (ADR 0034): `runSwm` tests import the CLI through Vite, which
// resolves `?raw` shaders and engine enums. Only the real `bin` shim shows whether plain Node + tsx
// can load everything a command imports (an engine import from a core module breaks it with
// "Unknown file extension .glsl").
describe("swm bin shim (plain Node + tsx)", () => {
  it("answers --version", async () => {
    const { stdout } = await run("node", [SWM_BIN, "--version"]);
    expect(stdout.trim()).toMatch(/^swm \d+\.\d+\.\d+/);
  });

  it("renders a splatter PNG end to end", async () => {
    const dir = await mkdtemp(join(tmpdir(), "swm-bin-"));
    try {
      const out = join(dir, "decal.png");
      await run("node", [SWM_BIN, "splatter", "--size", "32", "--seed", "5", out]);
      expect((await readFile(out)).subarray(1, 4).toString("latin1")).toBe("PNG");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("derives PBR material maps and generates an IBL panorama end to end", async () => {
    const dir = await mkdtemp(join(tmpdir(), "swm-bin-mat-ibl-"));
    try {
      const iblDir = join(dir, "ibl");
      await run("node", [
        SWM_BIN,
        "ibl",
        "--seed",
        "3",
        "--width",
        "16",
        "--height",
        "8",
        "--panorama-only",
        iblDir,
      ]);
      const inputPng = join(iblDir, "input.png");
      expect((await readFile(inputPng)).subarray(1, 4).toString("latin1")).toBe("PNG");

      const matDir = join(dir, "mat");
      await run("node", [
        SWM_BIN,
        "material",
        "gen",
        "--preset",
        "stone",
        "--maps",
        "normal,roughness",
        inputPng,
        matDir,
      ]);
      expect(
        (await readFile(join(matDir, "input_normal.png"))).subarray(1, 4).toString("latin1"),
      ).toBe("PNG");
      expect(
        (await readFile(join(matDir, "input_roughness.png"))).subarray(1, 4).toString("latin1"),
      ).toBe("PNG");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("validates a kit directory", async () => {
    await expect(
      run("node", [SWM_BIN, "kit", "validate", "/definitely/not/a/dir"]),
    ).rejects.toMatchObject({
      code: 1,
    });
  });
});
