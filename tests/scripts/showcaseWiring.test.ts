import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  directoryRedirectTarget,
  isInsideRoot,
  parseShowcaseLayout,
  showcaseInputs,
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

  it("every showcase folder becomes a build input (no hand-kept registry)", () => {
    const inputs = showcaseInputs(ROOT);
    expect(
      Object.keys(inputs)
        .map((key) => Number(key.replace("showcase", "")))
        .sort((a, b) => a - b),
    ).toEqual(ids);
    expect(inputs["showcase45"]).toBe(path.join(SHOWCASES, "45", "index.html"));
  });

  it("hands the curated prev/next tour to the in-scene ◀/▶ buttons", () => {
    expect(
      parseShowcaseLayout(
        `<showcase-layout title="T" prev="../44/index.html" next="../24/index.html"></showcase-layout>`,
      ),
    ).toMatchObject({ prev: "../44/index.html", next: "../24/index.html" });
    const vite = fs.readFileSync(path.join(ROOT, "vite.config.ts"), "utf8");
    expect(vite).toContain('data-prev="${layout.prev}"');
    expect(vite).toContain('data-next="${layout.next}"');
    const showcase = fs.readFileSync(
      path.join(ROOT, "packages/engine/src/core/showcase/AbstractShowcase.ts"),
      "utf8",
    );
    expect(showcase).toContain('dataset["prev"]');
    expect(showcase).not.toMatch(/SHOWCASE_IDS/);
  });

  it("the gallery section counter matches the number of showcases", () => {
    const gallery = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
    expect(gallery).toContain(`<span class="section-count">${ids.length} Demos</span>`);
  });

  it("every showcase declares prev and next forming one closed ring over all showcases", () => {
    // The curated order lives in the prev/next metadata of the showcases themselves; derive the tour
    // by walking `next` from the first showcase instead of keeping a second hand-kept list here.
    const idOf = (href: string | undefined): number => {
      const match = href?.match(/^\.\.\/(\d+)\/index\.html$/);
      return match ? Number(match[1]) : Number.NaN;
    };
    const tour: number[] = [];
    let current = ids[0]!;
    do {
      expect(tour, `tour revisits ${current} before closing`).not.toContain(current);
      tour.push(current);
      const next = idOf(layoutOf(current).next);
      expect(ids, `showcase ${current} has a dangling next`).toContain(next);
      current = next;
    } while (current !== ids[0] && tour.length <= ids.length);

    // The ring must cover every showcase exactly once and close back at the start.
    expect([...tour].sort((a, b) => a - b)).toEqual(ids);
    tour.forEach((id, idx) => {
      const expectedPrev = tour[(idx - 1 + tour.length) % tour.length];
      expect({ id, prev: idOf(layoutOf(id).prev) }).toEqual({ id, prev: expectedPrev });
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
