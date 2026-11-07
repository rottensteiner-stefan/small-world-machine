import { describe, expect, it } from "vitest";
import { preprocessConditionals } from "../../src/renderers/shaders/preprocessConditionals.js";

const lines = (text: string): string =>
  text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .join("\n");

describe("preprocessConditionals", () => {
  it("keeps the active #ifdef branch and drops the directive lines", () => {
    const src = "a\n#ifdef USE_X\nb\n#endif\nc";

    expect(preprocessConditionals(src, ["USE_X"])).toBe("a\nb\nc");
    expect(preprocessConditionals(src, [])).toBe("a\nc");
  });

  it("handles #ifndef and #else for both outcomes", () => {
    const src = "#ifdef USE_X\nyes\n#else\nno\n#endif";

    expect(preprocessConditionals(src, new Set(["USE_X"]))).toBe("yes");
    expect(preprocessConditionals(src, new Set())).toBe("no");
    expect(preprocessConditionals("#ifndef USE_X\nabsent\n#endif", [])).toBe("absent");
    expect(preprocessConditionals("#ifndef USE_X\nabsent\n#endif", ["USE_X"])).toBe("");
  });

  it("nests blocks and never revives an inner branch under an inactive parent", () => {
    const src = [
      "#ifdef A",
      "a",
      "#ifdef B",
      "ab",
      "#else",
      "a-not-b",
      "#endif",
      "#else",
      "not-a",
      "#endif",
    ].join("\n");

    expect(lines(preprocessConditionals(src, ["A", "B"]))).toBe("a\nab");
    expect(lines(preprocessConditionals(src, ["A"]))).toBe("a\na-not-b");
    expect(lines(preprocessConditionals(src, ["B"]))).toBe("not-a");
    expect(lines(preprocessConditionals(src, []))).toBe("not-a");
  });

  it("tolerates indentation and spaces after the hash", () => {
    expect(preprocessConditionals("  #  ifdef USE_X\n  inner\n  #endif", ["USE_X"])).toBe(
      "  inner",
    );
  });

  it("passes every other line through, including WGSL comments and unrelated # lines", () => {
    const src = "// #ifdef not a directive\nfn f() {}\n#pragma keep";

    expect(preprocessConditionals(src, [])).toBe(src);
  });

  it("rejects unbalanced directives instead of emitting a half-stripped shader", () => {
    expect(() => preprocessConditionals("#ifdef A\nx", [])).toThrow(/unterminated/);
    expect(() => preprocessConditionals("x\n#endif", [])).toThrow(/#endif without/);
    expect(() => preprocessConditionals("#else\nx", [])).toThrow(/#else without/);
  });

  it("accepts trailing comments on directive lines (H02) instead of leaking them into WGSL", () => {
    // `#endif // USE_X` is a real-world pattern; before the fix the DIRECTIVE regex required
    // the line to END after the optional macro name, so the `// …` suffix fell through to WGSL,
    // where `[UPPER_ID]`-style tokens get re-spliced by the chunk assembler.
    const src = "a\n#ifdef USE_X\nb\n#endif // USE_X\nc";

    expect(preprocessConditionals(src, ["USE_X"])).toBe("a\nb\nc");
    expect(preprocessConditionals(src, [])).toBe("a\nc");
  });

  it("still strips a trailing comment-bearing #else / #ifndef (H02)", () => {
    const src = "#ifdef USE_X\nx\n#else // fallback\nnot\n#endif";

    expect(preprocessConditionals(src, [])).toBe("not");
    expect(preprocessConditionals(src, ["USE_X"])).toBe("x");
  });
});
