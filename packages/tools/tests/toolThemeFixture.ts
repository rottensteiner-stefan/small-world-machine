import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Relative to this file; `import.meta.url` is not a file URL in the jsdom environment, `__dirname` is (as in the other repo tests). */
const TOOL_THEME_PATH: string = resolve(__dirname, "../../../public/assets/tool-theme.css");

/** Returns the raw content of the shared tool stylesheet (the one and only token source). */
export function readToolThemeCss(): string {
  return readFileSync(TOOL_THEME_PATH, "utf-8");
}

/**
 * Puts the content of `public/assets/tool-theme.css` into the document so that
 * `getComputedStyle(documentElement).getPropertyValue("--tool-accent")` resolves, like on a real page that
 * links the file. Reads the real file; defines no second palette. The `@import` of the font file is dropped,
 * because jsdom has nothing to fetch it from.
 */
export function installToolTheme(doc: Document): void {
  const css: string = readToolThemeCss().replace(/@import[^;]*;/g, "");
  const style: HTMLStyleElement = doc.createElement("style");
  style.id = "test-tool-theme";
  style.textContent = css;
  doc.head.appendChild(style);
}
