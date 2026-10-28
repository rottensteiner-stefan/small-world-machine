import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const COMPARE_SCRIPT = path.resolve(__dirname, "../../.agents/scripts/goldens/compare.js");

function writePng(dir: string, name: string, shade: number): void {
  const png = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = shade;
    png.data[i + 1] = shade;
    png.data[i + 2] = shade;
    png.data[i + 3] = 255;
  }
  fs.writeFileSync(path.join(dir, name), PNG.sync.write(png));
}

function runCompare(args: string[]): { status: number | null; output: string } {
  const result = spawnSync("node", [COMPARE_SCRIPT, ...args], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("scripts/goldens/compare.js", () => {
  let root: string;
  let baseline: string;
  let current: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "goldens-compare-"));
    baseline = path.join(root, "baseline");
    current = path.join(root, "current");
    fs.mkdirSync(baseline);
    fs.mkdirSync(current);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("refuses to run without --current instead of comparing the baseline with itself", () => {
    writePng(baseline, "a__top.png", 10);

    const { status, output } = runCompare(["--baseline", baseline]);

    expect(status).toBe(1);
    expect(output).toContain("--current");
  });

  it("passes identical directories", () => {
    writePng(baseline, "a__top.png", 10);
    writePng(current, "a__top.png", 10);

    expect(runCompare(["--baseline", baseline, "--current", current]).status).toBe(0);
  });

  it("flags a baseline cell that is absent from the current manifest", () => {
    writePng(baseline, "a__top.png", 10);
    writePng(baseline, "b__top.png", 10);
    writePng(current, "a__top.png", 10);
    fs.writeFileSync(
      path.join(current, "manifest.json"),
      JSON.stringify([{ poolKey: "a", view: "top", file: "a__top.png", blank: false }]),
    );

    const { status, output } = runCompare(["--baseline", baseline, "--current", current]);

    expect(status).toBe(1);
    expect(output).toMatch(/ERR\s+b__top\s+.*current image missing/);
  });

  it("limits the missing-cell check to --pool", () => {
    writePng(baseline, "a__top.png", 10);
    writePng(baseline, "b__top.png", 10);
    writePng(current, "a__top.png", 10);
    fs.writeFileSync(
      path.join(current, "manifest.json"),
      JSON.stringify([{ poolKey: "a", view: "top", file: "a__top.png", blank: false }]),
    );

    expect(runCompare(["--baseline", baseline, "--current", current, "--pool", "a"]).status).toBe(
      0,
    );
  });
});
