import { describe, it, expect } from "vitest";
import { globToRegExp } from "../../src/common/io/globPattern.js";

describe("globToRegExp", () => {
  it("anchors and escapes", () => {
    const re = globToRegExp("*.png");
    expect(re.test("a.png")).toBe(true);
    expect(re.test("a.png.bak")).toBe(false);
    expect(re.test("aXpng")).toBe(false);
  });
  it("does not throw on regex metacharacters", () => {
    expect(() => globToRegExp("(")).not.toThrow();
    expect(globToRegExp("a+b").test("a+b")).toBe(true);
    expect(globToRegExp("a+b").test("aab")).toBe(false);
  });
});
