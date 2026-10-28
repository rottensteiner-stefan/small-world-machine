#!/usr/bin/env node
/**
 * scripts/check-verified-markers.js
 *
 * G4 marker lint ("Claims == Code"). Validates `[VERIFIED: ...]` markers in the liquid
 * roadmap / research docs against the actual repository state so that documentation can
 * never again claim a verified fact that does not exist on HEAD.
 *
 * Marker format (strict, enforced here):
 *
 *   [VERIFIED: <rel-path>:<line>; test=<test-identifier>]
 *
 * where
 *   - <rel-path>        is repo-root-relative path to an existing file,
 *   - <line>            is a line number within that file (1-based, must be in range),
 *   - <test-identifier> resolves to a real test file under packages/engine/tests or
 *                       packages/liquid-extras/tests (full path, nested path, or an
 *                       unambiguous bare file name), OR to a describe()/it() name that
 *                       literally occurs in one of those test files.
 *
 * Optional free text after the closing `]` is allowed and ignored.
 *
 * LIMITS (read before trusting a green run): this lint only checks that the referenced file,
 * line number and test name EXIST. It says nothing about whether the cited line still contains
 * the claimed fact, or whether the cited test actually asserts it or passes. A marker is a
 * pointer that must be kept honest by the author, not a proof of truth.
 *
 * Usage:
 *   node scripts/check-verified-markers.js
 *   node scripts/check-verified-markers.js --refs .agents/collaborate/liquid-roadmap*.md
 *   node scripts/check-verified-markers.js --refs <glob...>
 *
 * Exit codes:
 *   0  all markers valid (or no markers present),
 *   1  at least one marker violated,
 *   2  technical error (bad globs, unreadable files).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..", "..");

const DEFAULT_GLOBS = [
  ".agents/collaborate/liquid-roadmap*.md",
  "docs/research/stylized-water/*.md",
  "docs/adr/*liquid*",
];

const TEST_ROOTS = ["packages/engine/tests", "packages/liquid-extras/tests"];

// Strict marker syntax: [VERIFIED: <path>:<line>; test=<identifier>]
const MARKER_RE = /\[VERIFIED:\s*([^\s\]:]+):(\d+)\s*;\s*test=([^\]]+)\]/g;

function isWithin(relativePath) {
  const abs = path.resolve(ROOT, relativePath);
  return TEST_ROOTS.some((root) => abs === path.resolve(ROOT, root) || abs.startsWith(path.resolve(ROOT, root) + path.sep));
}

function countFileLines(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r\n|\r|\n/);
  // A trailing newline does not create an extra physical line; only count complete lines.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

function collectTestFiles() {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(test|spec)\.(ts|tsx|js|mjs)$/.test(entry.name)) {
        files.push(full);
      }
    }
  };
  for (const root of TEST_ROOTS) {
    walk(path.join(ROOT, root));
  }
  return files;
}

const testFiles = collectTestFiles();
const testFileContent = new Map();
const testFilesByBasename = new Map();
for (const file of testFiles) {
  const rel = path.relative(ROOT, file);
  testFileContent.set(rel, fs.readFileSync(file, "utf8"));
  const base = path.posix.basename(rel);
  const bucket = testFilesByBasename.get(base) ?? [];
  bucket.push(rel);
  testFilesByBasename.set(base, bucket);
}

function resolveTestReference(identifierRaw) {
  const id = identifierRaw.trim();
  if (id.length === 0) {
    return { ok: false, reason: "empty test identifier" };
  }

  // 1) Identifier given as a path: repo-root-relative or relative to a test root.
  const candidates = [path.resolve(ROOT, id), ...TEST_ROOTS.map((r) => path.resolve(ROOT, r, id))];
  const existing = [...new Set(candidates)].filter((p) => {
    try {
      return fs.existsSync(p) && fs.statSync(p).isFile() && isWithin(path.relative(ROOT, p));
    } catch {
      return false;
    }
  });
  if (existing.length === 1) {
    return { ok: true, resolved: path.relative(ROOT, existing[0]) };
  }
  if (existing.length > 1) {
    return {
      ok: false,
      reason: `ambiguous path match: ${existing.map((p) => path.relative(ROOT, p)).join(", ")}`,
    };
  }

  // 2) Bare file name without path — accepted when unambiguous.
  const base = path.posix.basename(id);
  const matches = testFilesByBasename.get(base) ?? [];
  if (matches.length === 1) {
    return { ok: true, resolved: matches[0] };
  }
  if (matches.length > 1) {
    return { ok: false, reason: `ambiguous bare name "${base}": ${matches.join(", ")}` };
  }

  // 3) describe()/it() name — accepted if the literal string occurs in any test file.
  const hits = testFiles.filter((file) =>
    testFileContent.get(path.relative(ROOT, file))?.includes(id),
  );
  if (hits.length > 0) {
    return { ok: true, resolved: path.relative(ROOT, hits[0]), note: "matched describe/it name (grep)" };
  }

  return {
    ok: false,
    reason: `no test file or describe/it name found for "${id}" (checked packages/engine/tests and packages/liquid-extras/tests)`,
  };
}

function expandGlobs(globs) {
  const files = [];
  for (const pattern of globs) {
    let hits;
    try {
      hits = fs.globSync(pattern, { cwd: ROOT });
    } catch (err) {
      throw new Error(`invalid glob "${pattern}": ${err.message}`, { cause: err });
    }
    files.push(...hits.sort());
  }
  return [...new Set(files)];
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: node scripts/check-verified-markers.js [--refs <glob...>]");
  console.log("Scans default targets unless --refs is provided.");
  process.exit(0);
}

const refsIndex = args.indexOf("--refs");
const globs = refsIndex >= 0 ? args.slice(refsIndex + 1) : DEFAULT_GLOBS;
if (globs.length === 0 || (refsIndex >= 0 && globs.length === 0)) {
  console.error("check-verified-markers: --refs requires at least one glob pattern");
  process.exit(2);
}

let scannedFiles;
try {
  scannedFiles = expandGlobs(globs);
} catch (err) {
  console.error(`check-verified-markers: ${err.message}`);
  process.exit(2);
}

if (scannedFiles.length === 0) {
  console.error("check-verified-markers: no files matched the scan globs");
  process.exit(2);
}

const violations = [];
let markerCount = 0;

for (const docRel of scannedFiles) {
  const docAbs = path.join(ROOT, docRel);
  let content;
  try {
    content = fs.readFileSync(docAbs, "utf8");
  } catch (err) {
    violations.push({
      doc: docRel,
      line: null,
      message: `cannot read file: ${err.message}`,
    });
    continue;
  }

  MARKER_RE.lastIndex = 0;
  let match;
  while ((match = MARKER_RE.exec(content)) !== null) {
    const [, targetPath, targetLineRaw, testId] = match;
    const targetLine = Number(targetLineRaw);
    markerCount++;

    if (MARKER_RE.lastIndex === match.index) MARKER_RE.lastIndex++;

    if (!fs.existsSync(path.join(ROOT, targetPath)) || !fs.statSync(path.join(ROOT, targetPath)).isFile()) {
      violations.push({
        doc: docRel,
        marker: match[0],
        message: `target file does not exist: "${targetPath}"`,
      });
      continue;
    }

    const fileLineCount = countFileLines(path.join(ROOT, targetPath));
    if (targetLine < 1 || targetLine > fileLineCount) {
      violations.push({
        doc: docRel,
        marker: match[0],
        message: `line ${targetLine} is out of range for "${targetPath}" (file has ${fileLineCount} lines)`,
      });
      continue;
    }

    const testRef = resolveTestReference(testId);
    if (!testRef.ok) {
      violations.push({
        doc: docRel,
        marker: match[0],
        message: `invalid test reference: ${testRef.reason}`,
      });
    }
  }
}

for (const v of violations) {
  console.error(
    `[MARKER VIOLATION] ${v.doc}${v.marker ? ` :: ${v.marker}` : ""}${v.line ? ` (line ${v.line})` : ""}`,
  );
  console.error(`  -> ${v.message}`);
}

console.log(
  `check-verified-markers: scanned ${scannedFiles.length} doc(s), found ${markerCount} marker(s), ${violations.length} violation(s).`,
);

if (violations.length > 0) {
  process.exit(1);
}
process.exit(0);
