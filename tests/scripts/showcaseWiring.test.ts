import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  directoryRedirectTarget,
  isInsideRoot,
  parseShowcaseLayout,
  showcasesRedirectTarget,
} from "../../.agents/scripts/lib/dev-redirects.js";

const ROOT = path.resolve(__dirname, "../..");
const SHOWCASES = path.join(ROOT, "apps/showcases");

function showcaseIds(): number[] {
  return fs
    .readdirSync(SHOWCASES)
    .filter((name) => /^\d+$/.test(name) && fs.existsSync(path.join(SHOWCASES, name, "index.html")))
    .map(Number)
    .sort((a, b) => a - b);
}

function layoutOf(id: number): { prev: string | undefined; next: string | undefined } {
  const html = fs.readFileSync(path.join(SHOWCASES, String(id), "index.html"), "utf8");
  const tag = html.match(/<showcase-layout\b[^>]*>/)?.[0] ?? "";
  return {
    prev: tag.match(/\bprev="([^"]*)"/)?.[1],
    next: tag.match(/\bnext="([^"]*)"/)?.[1],
  };
}

describe("showcase wiring (gallery + curated prev/next tour)", () => {
  const ids = showcaseIds();

  it("every showcase is linked from the launcher gallery", () => {
    const gallery = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
    const missing = ids.filter((id) => !gallery.includes(`./apps/showcases/${id}/index.html`));
    expect(missing).toEqual([]);
  });

  it("every showcase is in the hand-kept registries (in-scene ◀/▶ buttons, smoke test, build)", () => {
    const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), "utf8");
    const navList = read("packages/engine/src/core/showcase/AbstractShowcase.ts").match(
      /const VALID_SHOWCASE_IDS = \[([^\]]*)\]/,
    )?.[1];
    const smokeList = read(".agents/scripts/check-showcases.js").match(
      /const numberedShowcases = \[([^\]]*)\]/,
    )?.[1];
    const numbers = (list: string | undefined): number[] =>
      (list ?? "")
        .match(/\d+/g)
        ?.map(Number)
        .sort((a, b) => a - b) ?? [];
    expect(numbers(navList)).toEqual(ids);
    expect(numbers(smokeList)).toEqual(ids);
    const viteConfig = read("vite.config.ts");
    expect(ids.filter((id) => !viteConfig.includes(`apps/showcases/${id}/index.html`))).toEqual([]);
  });

  it("the gallery section counter matches the number of showcases", () => {
    const gallery = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
    expect(gallery).toContain(`<span class="section-count">${ids.length} Demos</span>`);
  });

  it("every showcase declares prev and next forming the curated didactic tour (closed ring)", () => {
    // Kuratierte Tour (didaktische Reihung, siehe .agents/notes/codebase-search-knowledge.md §7).
    // IDs/Ordner bleiben stabil; die Reihenfolge lebt in prev/next + Gallery.
    const tour = [
      11, 1, 2, 6, 7, 8, 26, 3, 5, 19, 13, 20, 9, 4, 23, 21, 22, 35, 36, 16, 15, 12, 10, 30, 32, 27,
      29, 31, 37, 39, 38, 28, 17, 18, 33, 34, 44, 45, 24, 14, 40, 42, 43, 41,
    ];
    // Tour muss vollständig sein und exakt die vorhandenen Showcase-IDs enthalten.
    expect(tour).toHaveLength(ids.length);
    expect([...new Set(tour)].sort((a, b) => a - b)).toEqual(ids);

    ids.forEach((id) => {
      const idx = tour.indexOf(id);
      const expectedPrev = tour[(idx - 1 + tour.length) % tour.length];
      const expectedNext = tour[(idx + 1) % tour.length];
      const { prev, next } = layoutOf(id);
      expect({ id, prev, next }).toEqual({
        id,
        prev: `../${expectedPrev}/index.html`,
        next: `../${expectedNext}/index.html`,
      });
    });
  });

  it("every showcase index.html is parsed by the showcase-layout plugin", () => {
    for (const id of ids) {
      const html = fs.readFileSync(path.join(SHOWCASES, String(id), "index.html"), "utf8");
      expect(parseShowcaseLayout(html), `showcase ${id}`).not.toBeNull();
    }
  });
});

describe("parseShowcaseLayout", () => {
  it("accepts any attribute order and reads the subtitle from the element body", () => {
    const layout = parseShowcaseLayout(
      `<showcase-layout\n prev="../1/index.html"\n title="T">\n  <p>Hello</p>\n</showcase-layout>`,
    );
    expect(layout?.title).toBe("T");
    expect(layout?.subtitle).toContain("Hello");
  });

  it("keeps arbitrary HTML (widget markup) in the subtitle body", () => {
    const layout = parseShowcaseLayout(
      `<showcase-layout title="T"><div id="scoreDisplay" style="x">1 / 10</div></showcase-layout>`,
    );
    expect(layout?.subtitle).toContain('id="scoreDisplay"');
    expect(layout?.subtitle).toContain("1 / 10");
  });

  it("returns null without the required title attribute or without a tag", () => {
    expect(
      parseShowcaseLayout(`<showcase-layout prev="../1/index.html"></showcase-layout>`),
    ).toBeNull();
    expect(parseShowcaseLayout("<html></html>")).toBeNull();
  });
});

describe("dev server redirects", () => {
  it("redirects /apps/showcases to the launcher and merges the query", () => {
    expect(showcasesRedirectTarget("/apps/showcases/", undefined)).toBe("/?filter=showcases");
    expect(showcasesRedirectTarget("/apps/showcases", "debug=1")).toBe(
      "/?filter=showcases&debug=1",
    );
    expect(showcasesRedirectTarget("/apps/showcases/1/index.html", undefined)).toBeNull();
  });

  it("appends the trailing slash for a directory with index.html", () => {
    expect(directoryRedirectTarget(ROOT, "/apps/showcases/41", "a=1")).toBe(
      "/apps/showcases/41/?a=1",
    );
    expect(directoryRedirectTarget(ROOT, "/apps/showcases/41/", undefined)).toBeNull();
  });

  it("does not throw on malformed percent escapes", () => {
    expect(directoryRedirectTarget(ROOT, "/%E0%A4%A", undefined)).toBeNull();
  });

  it("never probes outside the root (no directory-existence oracle)", () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dev-redirect-")));
    try {
      const root = path.join(base, "root");
      const outside = path.join(base, "outside");
      fs.mkdirSync(root);
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, "index.html"), "x");
      expect(directoryRedirectTarget(root, "/..%2foutside", undefined)).toBeNull();
      expect(directoryRedirectTarget(root, "/../outside", undefined)).toBeNull();
      expect(isInsideRoot(root, outside)).toBe(false);
      expect(isInsideRoot(root, root)).toBe(true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
