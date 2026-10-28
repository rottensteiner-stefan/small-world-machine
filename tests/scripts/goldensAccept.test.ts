import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

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

function setup(): {
  root: string;
  baseline: string;
  current: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "goldens-accept-"));
  const baseline = path.join(root, "baseline");
  const current = path.join(root, "current");
  fs.mkdirSync(baseline);
  fs.mkdirSync(current);
  return { root, baseline, current };
}

function writeCurrentMetadata(current: string, browser: string): void {
  fs.writeFileSync(
    path.join(current, "manifest.json"),
    JSON.stringify([
      {
        poolKey: "a",
        view: "top",
        file: "a__top.png",
        blank: false,
        width: 4,
        height: 4,
        sha256: "current",
      },
    ]),
  );
  fs.writeFileSync(
    path.join(current, "summary.json"),
    JSON.stringify({ browser, frames: 60, generatedAt: "2026-10-18" }),
  );
}

describe("scripts/goldens/compare.js --accept (M4)", () => {
  it("adopts comparable divergent cells into the baseline and refreshes summary browser", () => {
    const { root, baseline, current } = setup();
    writePng(baseline, "a__top.png", 10);
    writePng(current, "a__top.png", 200);
    writeCurrentMetadata(current, "Chrome/152-test");

    const { status, output } = runCompare([
      "--baseline",
      baseline,
      "--current",
      current,
      "--accept",
    ]);

    expect(output).toContain("Accept: 1 Zelle");
    expect(status).toBe(0); // drift was accepted
    expect(fs.readFileSync(path.join(baseline, "a__top.png"))).toEqual(
      fs.readFileSync(path.join(current, "a__top.png")),
    );
    const manifest = fs.readFileSync(path.join(baseline, "manifest.json"), "utf8");
    expect(manifest).toContain('"file": "a__top.png"');
    expect(manifest).toContain('"sha256": "current"');
    expect(JSON.parse(fs.readFileSync(path.join(baseline, "summary.json"), "utf8")).browser).toBe(
      "Chrome/152-test",
    );
    void root;
  });

  it("skips ERR cells so an unreadable/blank current cell never clobbers the baseline", () => {
    const { root, baseline, current } = setup();
    const before = PNG.sync.write(new PNG({ width: 4, height: 4 }));
    fs.writeFileSync(path.join(baseline, "a__top.png"), before);
    writePng(current, "a__top.png", 100);
    fs.writeFileSync(
      path.join(current, "manifest.json"),
      JSON.stringify([{ poolKey: "a", view: "top", file: "a__top.png", blank: true, stddev: 0.1 }]),
    );
    fs.writeFileSync(path.join(current, "summary.json"), JSON.stringify({ browser: "Chrome/152" }));

    const { status, output } = runCompare([
      "--baseline",
      baseline,
      "--current",
      current,
      "--accept",
    ]);

    expect(status).toBe(1); // technical error still fails even with --accept
    expect(output).toContain("Accept:");
    expect(fs.readFileSync(path.join(baseline, "a__top.png"))).toEqual(before);
    void root;
  });

  it("without --accept a drift violation still exits 2", () => {
    const { root, baseline, current } = setup();
    writePng(baseline, "a__top.png", 10);
    writePng(current, "a__top.png", 200);
    writeCurrentMetadata(current, "Chrome/152");

    const { status } = runCompare(["--baseline", baseline, "--current", current]);

    expect(status).toBe(2);
    void root;
  });
});

describe("scripts/goldens/compare.js --report-html (M4)", () => {
  it("embeds media only for divergent cells, identical cells stay text-only", () => {
    const { root, baseline, current } = setup();
    const report = path.join(root, "review.html");
    // Divergent cell: FAIL
    writePng(baseline, "a__top.png", 10);
    writePng(current, "a__top.png", 200);
    // Identical cell: OK (must not carry media)
    writePng(baseline, "b__top.png", 80);
    writePng(current, "b__top.png", 80);
    fs.writeFileSync(
      path.join(current, "manifest.json"),
      JSON.stringify([
        { poolKey: "a", view: "top", file: "a__top.png", blank: false },
        { poolKey: "b", view: "top", file: "b__top.png", blank: false },
      ]),
    );
    fs.writeFileSync(path.join(current, "summary.json"), JSON.stringify({ browser: "Chrome/152" }));

    const { status, output } = runCompare([
      "--baseline",
      baseline,
      "--current",
      current,
      "--report-html",
      report,
    ]);

    // a drifts -> FAIL (2), the report is still written.
    expect(status).toBe(2);
    expect(output).toContain("Review report:");
    expect(fs.existsSync(report)).toBe(true);
    const html = fs.readFileSync(report, "utf8");
    expect(html).toContain("a__top");
    expect(html).toContain("b__top");
    // exactly one divergent cell -> baseline+current+diff thumbnails = 3 images total
    expect((html.match(/<img /g) ?? []).length).toBe(3);
  });
});
