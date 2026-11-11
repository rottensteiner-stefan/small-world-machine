import { describe, expect, it, vi } from "vitest";
import {
  defineShowcaseParams,
  formatShowcaseParams,
  readShowcaseParams,
} from "../../../src/core/showcase/ShowcaseParams.js";

const SPEC = defineShowcaseParams({
  mode: {
    type: "enum",
    values: ["a", "b", "field"],
    default: "a",
    interactive: "field",
    doc: "lane",
  },
  n: { type: "int", default: 100, interactive: 10, min: 0, max: 1000, doc: "count" },
  density: { type: "number", default: 5, min: 0.1, max: 8, doc: "density" },
  shadows: { type: "bool", default: true, doc: "sun shadows" },
  hbao: { type: "bool", default: false, interactive: true, doc: "ao" },
  tree: {
    type: "string",
    default: "none",
    interactive: "jacaranda",
    pattern: /^[a-z0-9_]+$/,
    doc: "species",
  },
  pausedAt: { type: "number?", min: 0, max: 1, doc: "freeze" },
});

describe("readShowcaseParams", () => {
  it("uses interactive defaults without automation flags and plain defaults with them", () => {
    const i = readShowcaseParams(SPEC, "");
    expect(i.interactive).toBe(true);
    expect([i.values.mode, i.values.n, i.values.hbao, i.values.tree]).toEqual([
      "field",
      10,
      true,
      "jacaranda",
    ]);
    const a = readShowcaseParams(SPEC, "?frames=30");
    expect(a.interactive).toBe(false);
    expect([a.values.mode, a.values.n, a.values.hbao, a.values.tree]).toEqual([
      "a",
      100,
      false,
      "none",
    ]);
    expect(readShowcaseParams(SPEC, "?qa=1").interactive).toBe(false);
  });

  it("parses, floors and clamps numbers; optional numbers stay undefined when absent", () => {
    const r = readShowcaseParams(SPEC, "?n=5000.7&density=0&pausedAt=0.4");
    expect(r.values.n).toBe(1000);
    expect(r.values.density).toBe(0.1);
    expect(r.values.pausedAt).toBe(0.4);
    expect(readShowcaseParams(SPEC, "").values.pausedAt).toBeUndefined();
  });

  it("accepts 1/0, on/off, true/false and a bare key for bools", () => {
    expect(readShowcaseParams(SPEC, "?shadows=off").values.shadows).toBe(false);
    expect(readShowcaseParams(SPEC, "?hbao").values.hbao).toBe(true);
    expect(readShowcaseParams(SPEC, "?hbao=0").values.hbao).toBe(false);
  });

  it("warns and falls back on invalid enum / string / number values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = readShowcaseParams(SPEC, "?mode=xyz&tree=Bad!&n=abc&frames=1");
    expect([r.values.mode, r.values.tree, r.values.n]).toEqual(["a", "none", 100]);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it("reports explicit keys via has()", () => {
    const r = readShowcaseParams(SPEC, "?n=3");
    expect(r.has("n")).toBe(true);
    expect(r.has("mode")).toBe(false);
  });
});

describe("formatShowcaseParams", () => {
  it("lists every key with type/range, defaults and doc", () => {
    const text = formatShowcaseParams(SPEC);
    expect(text.split("\n")).toHaveLength(Object.keys(SPEC).length);
    expect(text).toContain("?mode");
    expect(text).toContain("a|b|field");
    expect(text).toContain("int [0..1000]");
    expect(text).toContain("(interactive field)");
  });
});
