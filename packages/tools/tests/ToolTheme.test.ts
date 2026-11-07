// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { installToolTheme, readToolThemeCss } from "./toolThemeFixture.js";

/** Tokens the components section already uses but Alice has not yet defined in `:root` (requested in the topic document). */
const REQUESTED_TOKENS: readonly string[] = ["--tool-inset", "--tool-hover"];

describe("tool-theme.css", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  it("resolves --tool-accent in the document once the fixture installed it", () => {
    expect(getComputedStyle(document.documentElement).getPropertyValue("--tool-accent")).toBe("");
    installToolTheme(document);
    expect(
      getComputedStyle(document.documentElement).getPropertyValue("--tool-accent").trim(),
    ).toBe("#ffb84d");
  });

  it("uses only tokens that are defined in :root (or explicitly requested)", () => {
    const css: string = readToolThemeCss();
    const rootBlock: string = css.slice(css.indexOf(":root"), css.indexOf("/* components */"));
    const defined: Set<string> = new Set(
      Array.from(rootBlock.matchAll(/(--tool-[a-z0-9-]+)\s*:/g), (m) => m[1] as string),
    );
    const components: string = css.slice(css.indexOf("/* components */"));
    const used: Set<string> = new Set(
      Array.from(components.matchAll(/var\((--tool-[a-z0-9-]+)\)/g), (m) => m[1] as string),
    );
    const unknown: string[] = Array.from(used).filter(
      (t) => !defined.has(t) && !REQUESTED_TOKENS.includes(t),
    );
    expect(unknown).toEqual([]);
  });

  it("keeps the components section free of literal colors and fallbacks", () => {
    const css: string = readToolThemeCss();
    const components: string = css
      .slice(css.indexOf("/* components */"))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(components).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(components).not.toMatch(/\brgba?\(/);
    expect(components).not.toMatch(/var\(--tool-[a-z0-9-]+\s*,/);
  });

  it("covers the Firefox range pseudo-elements", () => {
    expect(readToolThemeCss()).toContain("::-moz-range-thumb");
    expect(readToolThemeCss()).toContain("::-webkit-slider-thumb");
  });
});
