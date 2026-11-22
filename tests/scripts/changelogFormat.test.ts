import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const ACTIVE_PATH = path.join(ROOT, "CHANGELOG.md");
const ARCHIVE_PATH = path.join(ROOT, "docs/CHANGELOG-ARCHIVE.md");

const ALLOWED_CATEGORIES = new Set([
  "- **Features:**",
  "- **Architecture & Bugfixes:**",
  "- **Housekeeping & Docs:**",
]);

const VERSION_HEADER_RE = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/;
const QUOTE_HEADER_RE = /^### "(.+)" - (.+)$/;
const MAX_ACTIVE_LINE_LENGTH = 480;

// Common German function words and umlauts that must not leak back into active CHANGELOG prose.
const GERMAN_PROSE_RE =
  /[äöüßÄÖÜ]|(?:^|\s)(?:und|für|über|nicht|wird|sind|wurde|wurden|mit|ohne|gegenüber|zwischen|beim|aufgebaut|aktualisiert)(?=\s|[.,:;]|$)/i;

interface VersionBlock {
  version: string;
  date: string;
  line: number;
  lines: string[];
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

function parseVersionBlocks(filePath: string): { rawLines: string[]; blocks: VersionBlock[] } {
  const rawLines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const blocks: VersionBlock[] = [];
  let current: VersionBlock | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]!;
    const match = line.match(VERSION_HEADER_RE);
    if (match) {
      current = {
        version: match[1]!,
        date: match[2]!,
        line: i + 1,
        lines: [],
      };
      blocks.push(current);
      continue;
    }
    if (current) {
      current.lines.push(line);
    }
  }

  return { rawLines, blocks };
}

function normalizeQuote(quote: string): string {
  return quote.trim().toLowerCase();
}

describe("CHANGELOG format and archive invariants", () => {
  const active = parseVersionBlocks(ACTIVE_PATH);
  const archive = parseVersionBlocks(ARCHIVE_PATH);

  it("links active CHANGELOG.md to docs/CHANGELOG-ARCHIVE.md and omits [Unreleased]", () => {
    const content = active.rawLines.join("\n");
    expect(content).toContain("docs/CHANGELOG-ARCHIVE.md");
    expect(active.rawLines.filter((l) => /^##\s+\[?Unreleased\]?/i.test(l))).toEqual([]);
  });

  it("uses valid ## [x.y.z] - YYYY-MM-DD headers in strictly descending order in CHANGELOG.md", () => {
    const allH2 = active.rawLines.filter((l) => /^##\s/.test(l));
    const malformedH2 = allH2.filter((l) => !VERSION_HEADER_RE.test(l));
    expect(malformedH2).toEqual([]);
    expect(active.blocks.length).toBeGreaterThan(0);

    for (let i = 1; i < active.blocks.length; i++) {
      const prev = active.blocks[i - 1]!;
      const curr = active.blocks[i]!;
      expect(
        compareSemver(prev.version, curr.version),
        `${prev.version} (line ${prev.line}) must be > ${curr.version} (line ${curr.line})`,
      ).toBeGreaterThan(0);
    }
  });

  it("uses valid ## [x.y.z] - YYYY-MM-DD headers and preserves descending order in >= 0.63.0 archive", () => {
    const allH2 = archive.rawLines.filter((l) => /^##\s/.test(l));
    const malformedH2 = allH2.filter((l) => !VERSION_HEADER_RE.test(l));
    expect(malformedH2).toEqual([]);

    const modernBlocks = archive.blocks.filter((b) => compareSemver(b.version, "0.63.0") >= 0);
    expect(modernBlocks.length).toBeGreaterThan(0);

    for (let i = 1; i < modernBlocks.length; i++) {
      const prev = modernBlocks[i - 1]!;
      const curr = modernBlocks[i]!;
      expect(
        compareSemver(prev.version, curr.version),
        `Archive ${prev.version} (line ${prev.line}) must be > ${curr.version} (line ${curr.line})`,
      ).toBeGreaterThan(0);
    }
  });

  it("enforces exactly one unique, attributed ### quote per release across active + archive", () => {
    const seen = new Map<string, string>();
    const duplicates: Array<{ quote: string; first: string; second: string }> = [];

    for (const [label, parsed] of [
      ["CHANGELOG.md", active],
      ["docs/CHANGELOG-ARCHIVE.md", archive],
    ] as const) {
      for (const block of parsed.blocks) {
        const h3Lines = block.lines.filter((l) => /^###\s/.test(l));
        expect(
          h3Lines,
          `${label} ${block.version} (line ${block.line}) must contain exactly 1 ### quote`,
        ).toHaveLength(1);

        const match = h3Lines[0]!.match(QUOTE_HEADER_RE);
        expect(match, `${label} ${block.version}: malformed quote "${h3Lines[0]}"`).not.toBeNull();

        const quoteText = match![1]!.trim();
        const author = match![2]!.trim();
        expect(quoteText.length, `${label} ${block.version} empty quote`).toBeGreaterThan(0);
        expect(author.length, `${label} ${block.version} empty author`).toBeGreaterThan(0);

        const key = normalizeQuote(quoteText);
        const loc = `${label} ${block.version}`;
        const prev = seen.get(key);
        if (prev) {
          duplicates.push({ quote: quoteText, first: prev, second: loc });
        } else {
          seen.set(key, loc);
        }
      }
    }

    expect(duplicates).toEqual([]);
  });

  it("enforces standard categories, non-empty sections, and no version slop in active and >= 0.63.0 archive", () => {
    const targets: Array<{ label: string; blocks: VersionBlock[] }> = [
      { label: "CHANGELOG.md", blocks: active.blocks },
      {
        label: "docs/CHANGELOG-ARCHIVE.md",
        blocks: archive.blocks.filter((b) => compareSemver(b.version, "0.63.0") >= 0),
      },
    ];

    for (const { label, blocks } of targets) {
      for (const block of blocks) {
        const seenCategories = new Set<string>();
        let currentCategory: string | null = null;
        let currentBullets = 0;

        for (const line of block.lines) {
          expect(line, `${label} ${block.version}: remove trailing Version line`).not.toMatch(
            /^- Version \d+\.\d+\.\d+/,
          );

          if (/^- \*\*/.test(line)) {
            if (currentCategory !== null) {
              expect(
                currentBullets,
                `${label} ${block.version}: empty category ${currentCategory}`,
              ).toBeGreaterThan(0);
            }
            expect(
              ALLOWED_CATEGORIES.has(line),
              `${label} ${block.version}: non-standard category "${line}"`,
            ).toBe(true);
            expect(
              seenCategories.has(line),
              `${label} ${block.version}: duplicate category "${line}"`,
            ).toBe(false);
            seenCategories.add(line);
            currentCategory = line;
            currentBullets = 0;
            continue;
          }

          if (currentCategory !== null && /^ {2}- /.test(line)) {
            currentBullets++;
          }
        }

        if (currentCategory !== null) {
          expect(
            currentBullets,
            `${label} ${block.version}: empty category ${currentCategory}`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it("keeps active CHANGELOG.md bullets in concise technical English within the line-length budget", () => {
    const violations: Array<{ version: string; line: number; issue: string }> = [];

    for (const block of active.blocks) {
      block.lines.forEach((line, idx) => {
        const lineNo = block.line + idx + 1;
        if (line.length > MAX_ACTIVE_LINE_LENGTH) {
          violations.push({
            version: block.version,
            line: lineNo,
            issue: `length ${line.length} > ${MAX_ACTIVE_LINE_LENGTH}`,
          });
        }
        // Check non-quote lines for accidental German prose regressions.
        if (!QUOTE_HEADER_RE.test(line) && GERMAN_PROSE_RE.test(line)) {
          violations.push({
            version: block.version,
            line: lineNo,
            issue: `possible German prose: ${line.slice(0, 80)}`,
          });
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it("enforces valid CHANGELOG.md in every package with top version matching package.json", () => {
    const packagesDir = path.join(ROOT, "packages");
    const entries = fs.readdirSync(packagesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkgJsonPath = path.join(packagesDir, entry.name, "package.json");
      if (!fs.existsSync(pkgJsonPath)) continue;

      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
      const changelogPath = path.join(packagesDir, entry.name, "CHANGELOG.md");

      expect(
        fs.existsSync(changelogPath),
        `Missing CHANGELOG.md in packages/${entry.name}. Every package must have a CHANGELOG.md.`,
      ).toBe(true);

      const content = fs.readFileSync(changelogPath, "utf8");

      // Core engine is a pointer to the root CHANGELOG.md
      if (entry.name === "engine") {
        expect(
          content,
          "packages/engine/CHANGELOG.md must point to the root CHANGELOG.md",
        ).toContain("CHANGELOG.md");
        continue;
      }

      // Satellite packages have independent semver blocks
      const parsed = parseVersionBlocks(changelogPath);
      expect(
        parsed.blocks.length,
        `packages/${entry.name}/CHANGELOG.md has no valid "## [x.y.z] - YYYY-MM-DD" version blocks.`,
      ).toBeGreaterThan(0);

      const topBlock = parsed.blocks[0]!;
      expect(
        topBlock.version,
        `packages/${entry.name}/package.json version is "${pkgJson.version}", but top CHANGELOG.md version is "${topBlock.version}". ` +
          `Did you forget to add a "## [${pkgJson.version}] - YYYY-MM-DD" entry?`,
      ).toBe(pkgJson.version);

      // Verify descending order
      for (let i = 1; i < parsed.blocks.length; i++) {
        const prev = parsed.blocks[i - 1]!;
        const curr = parsed.blocks[i]!;
        expect(
          compareSemver(prev.version, curr.version),
          `packages/${entry.name}/CHANGELOG.md: ${prev.version} must be > ${curr.version}`,
        ).toBeGreaterThan(0);
      }
    }
  });
});
