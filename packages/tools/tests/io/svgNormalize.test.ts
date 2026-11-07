import { describe, it, expect } from "vitest";
import { normalizeSvg } from "../../src/common/io/svgNormalize.js";

describe("normalizeSvg", () => {
  it("sizes an SVG without any size to the target long edge (browser default aspect 2:1)", () => {
    const out = normalizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
    );
    expect(out.width).toBe(1024);
    expect(out.height).toBe(512);
    expect(out.text).toContain('width="1024" height="512" viewBox="0 0 300 150"');
  });

  it("derives size and aspect from the viewBox", () => {
    const out = normalizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle r="10"/></svg>',
    );
    expect(out.width).toBe(1024);
    expect(out.height).toBe(1024);
    expect(out.text).toContain('viewBox="0 0 24 24"');
  });

  it("scales explicit sizes to the target and keeps the aspect ratio", () => {
    const out = normalizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"></svg>',
      512,
    );
    expect(out.width).toBe(512);
    expect(out.height).toBe(256);
    expect(out.text).toContain('viewBox="0 0 64 32"');
  });

  it("keeps the intrinsic size when the target long edge is 0", () => {
    const out = normalizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24"></svg>',
      0,
    );
    expect([out.width, out.height]).toEqual([48, 24]);
  });

  it("converts physical units to px", () => {
    const out = normalizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1in" height="0.5in"></svg>',
      0,
    );
    expect([out.width, out.height]).toEqual([96, 48]);
  });

  it("uses one declared edge together with the viewBox aspect", () => {
    const out = normalizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" viewBox="0 0 10 20"></svg>',
      0,
    );
    expect([out.width, out.height]).toEqual([100, 200]);
  });

  it("ignores percentage sizes and falls back to the viewBox", () => {
    const out = normalizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 40 20"></svg>',
      0,
    );
    expect([out.width, out.height]).toEqual([40, 20]);
  });

  it("adds missing xmlns and xlink declarations", () => {
    const out = normalizeSvg('<svg viewBox="0 0 10 10"><use xlink:href="#a"/></svg>');
    expect(out.text).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out.text).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
  });

  it("does not duplicate an existing xmlns", () => {
    const out = normalizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>');
    expect(out.text.match(/xmlns="/g)?.length).toBe(1);
  });

  it("does not touch stroke-width and keeps the rest of the document", () => {
    const out = normalizeSvg(
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" stroke-width="2" viewBox="0 0 8 8"><path d="M0 0h8"/></svg>',
    );
    expect(out.text.startsWith('<?xml version="1.0"?><svg')).toBe(true);
    expect(out.text).toContain('stroke-width="2"');
    expect(out.text.endsWith('<path d="M0 0h8"/></svg>')).toBe(true);
  });

  it("tolerates > inside quoted attribute values and single quotes", () => {
    const out = normalizeSvg(
      "<svg xmlns='http://www.w3.org/2000/svg' data-x='a>b' viewBox='0 0 4 2'></svg>",
      0,
    );
    expect([out.width, out.height]).toEqual([4, 2]);
    expect(out.text).toContain("data-x='a>b'");
  });

  it("caps huge targets", () => {
    const out = normalizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
      100000,
    );
    expect(out.width).toBe(8192);
  });

  it("throws for input without an svg root", () => {
    expect(() => normalizeSvg("<html></html>")).toThrow("SVG");
  });
});
