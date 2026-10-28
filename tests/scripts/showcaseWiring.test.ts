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

describe("showcase wiring (gallery + prev/next chain)", () => {
  const ids = showcaseIds();

  it("every showcase is linked from the launcher gallery", () => {
    const gallery = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
    const missing = ids.filter((id) => !gallery.includes(`./apps/showcases/${id}/index.html`));
    expect(missing).toEqual([]);
  });

  it("the gallery section counter matches the number of showcases", () => {
    const gallery = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
    expect(gallery).toContain(`<span class="section-count">${ids.length} Demos</span>`);
  });

  it("every showcase declares prev and next, forming one closed ring over the existing ids", () => {
    ids.forEach((id, i) => {
      const expectedPrev = ids[(i - 1 + ids.length) % ids.length];
      const expectedNext = ids[(i + 1) % ids.length];
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
  const b64 = Buffer.from("<p>Hello</p>").toString("base64");

  it("accepts any attribute order and a missing next", () => {
    const layout = parseShowcaseLayout(
      `<showcase-layout\n prev="../1/index.html"\n subtitle-b64="${b64}"\n title="T"\n></showcase-layout>`,
    );
    expect(layout?.title).toBe("T");
    expect(layout?.subtitle).toBe("<p>Hello</p>");
  });

  it("returns null without the required attributes or without a tag", () => {
    expect(parseShowcaseLayout(`<showcase-layout title="T"></showcase-layout>`)).toBeNull();
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
