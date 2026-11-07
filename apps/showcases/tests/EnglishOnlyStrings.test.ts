// @vitest-environment node
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** Showcases at or below this number are already English-only. Raise as folders get translated. */
const MAX_ENGLISH_ONLY_NUMBER = 46;
/** Override for verification against an older checkout. */
const ROOT = process.env["SHOWCASES_ROOT"] ?? fileURLToPath(new URL("..", import.meta.url));
const SKIPPED_DIRS = new Set(["docs", "tests", "node_modules", "dist", "assets"]);
/** Proper names that legitimately contain umlauts (not translatable). */
const PROPER_NAMES = /Möbius|Lohm(?:ü|&uuml;)ller/g;
const GERMAN_CHARS = /[äöüÄÖÜß]|&[aouAOU]uml;|&szlig;/;

/** Scans `apps/showcases/*` (no hand-kept registry): numbered folders up to the limit plus all non-numbered ones. */
export function englishOnlyScope(root: string = ROOT): string[] {
  return readdirSync(root)
    .filter((name) => {
      const full = join(root, name);
      if (statSync(full).isDirectory()) {
        if (SKIPPED_DIRS.has(name)) return false;
        return !/^\d+$/.test(name) || Number(name) <= MAX_ENGLISH_ONLY_NUMBER;
      }
      return name === "index.html";
    })
    .map((name) => join(root, name));
}

function collectFiles(path: string): string[] {
  if (statSync(path).isFile()) return /\.(ts|html)$/.test(path) ? [path] : [];
  return readdirSync(path).flatMap((entry) =>
    SKIPPED_DIRS.has(entry) ? [] : collectFiles(join(path, entry)),
  );
}

/** Drops comment lines and trailing `//` comments (code comments are out of scope). */
function stripComments(source: string): string[] {
  let inBlock = false;
  return source.split("\n").map((line) => {
    let out = line;
    if (inBlock) {
      const end = out.indexOf("*/");
      if (end === -1) return "";
      inBlock = false;
      out = out.slice(end + 2);
    }
    out = out.replace(/\/\*.*?\*\//g, "");
    const start = out.indexOf("/*");
    if (start !== -1 && !out.includes("*/", start)) {
      inBlock = true;
      out = out.slice(0, start);
    }
    return out.replace(/(^|\s)\/\/.*$/, "$1").replace(/<!--.*?-->/g, "");
  });
}

describe("showcases are English-only (user-facing strings)", () => {
  it("scope scan finds numbered and shared folders", () => {
    const scope = englishOnlyScope().map((p) => relative(ROOT, p));
    expect(scope).toContain("1");
    expect(scope).toContain("shared");
    expect(scope).toContain("index.html");
  });

  it("contains no German umlauts or sharp s outside comments", () => {
    const offenders: string[] = [];
    for (const entry of englishOnlyScope()) {
      if (!existsSync(entry)) continue;
      for (const file of collectFiles(entry)) {
        stripComments(readFileSync(file, "utf8")).forEach((line, index) => {
          if (GERMAN_CHARS.test(line.replace(PROPER_NAMES, ""))) {
            offenders.push(`${relative(ROOT, file)}:${index + 1}: ${line.trim().slice(0, 120)}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
