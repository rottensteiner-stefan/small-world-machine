import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../../scripts/goldens/contact-sheet.js");

function writePng(dir: string, rel: string, shade: number): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const png = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = shade;
    png.data[i + 1] = shade;
    png.data[i + 2] = shade;
    png.data[i + 3] = 255;
  }
  fs.writeFileSync(abs, PNG.sync.write(png));
}

describe("scripts/goldens/contact-sheet.js (M5)", () => {
  it("renders every PNG as an embedded thumbnail into a single portable HTML file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goldens-sheet-"));
    try {
      writePng(dir, "a__top.png", 10);
      writePng(dir, path.join("nested", "b__oblique.png"), 60);

      const result = spawnSync("node", [SCRIPT, dir], { encoding: "utf8" });

      expect(result.status).toBe(0);
      const out = path.join(dir, "contact-sheet.html");
      expect(fs.existsSync(out)).toBe(true);
      const html = fs.readFileSync(out, "utf8");
      expect(html).toContain("a__top.png");
      expect(html).toContain("b__oblique.png");
      expect((html.match(/<img /g) ?? []).length).toBe(2);
      expect(html).toContain("data:image/png;base64,");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("errors on an empty or missing folder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goldens-sheet-empty-"));
    try {
      const result = spawnSync("node", [SCRIPT, dir], { encoding: "utf8" });
      expect(result.status).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
