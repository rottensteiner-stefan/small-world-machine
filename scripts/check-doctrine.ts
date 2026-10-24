#!/usr/bin/env node
/**
 * scripts/check-doctrine.ts
 *
 * Whack-a-Mole doctrine lint ("Doktrin == statisch prüfbar") — ADR 0047. Validates the Class-A
 * correctness-contract markers the doctrine introduces in engine source and docs, and reports
 * Class-B heuristics advisory-first behind flags.
 *
 * Marker syntax (defined verbatim in ADR 0047, §"Marker-Syntax"; mirrors the repo JSDoc
 * convention: tag text lives on the SAME line, cf. check-verified-markers.js style):
 *
 *   @domain  <physikalische/künstlerische Größe + Einheit/Wertebereich>
 *   @derived <aus welcher Domänengröße/Geometrie abgeleitet>
 *   @fixed   <Begründung, warum bewusst eingefroren (Standard)>
 *   @invariant <ID>: <Relation>          ID must exist in the committed registry seed below
 *   // doctrine-ignore: <regel> <Pflicht-Begründung>
 *
 * HARD tier (error, exit 1) — fires ONLY on markers that EXIST and are malformed. On the current
 * HEAD baseline there are ZERO doctrine markers in packages/engine/src (verified: grep for
 * @domain|@derived|@fixed|@invariant returns nothing), so the first run is guaranteed clean
 * (zero-false-positives rule, ADR 0047 §D8). Hard rules:
 *   - classification-typo: a JSDoc/comment `@tag` starting with the doctrine prefix
 *     (domain|derived|fixed|invariant) that is not an exact spelling -> typo.
 *   - classification-blank: @domain/@derived/@fixed with no non-empty text on the same line.
 *   - invariant-id: @invariant with no ID token, or an ID not in the committed registry seed.
 *   - escape-hatch: // doctrine-ignore: <rule> <reason> with empty reason or unknown rule name.
 *   - adr-compliance (A4): ADR files numbered >= 0047 must contain a "## Doctrine Compliance"
 *     heading (the mandatory template section). No current ADR below 47 is affected.
 *
 * ADVISORY tier (warning, exit 2) — Class-B heuristics behind --enable-advisory; report-only,
 * never block by default:
 *   - untagged-param   : public scalar member in the audited hot scope without classification /
 *                        @inheritdoc / @deprecated preceding it (M1b).
 *   - dead-knob        : declared-unread public member (member name appears only in its
 *                        declaration) (M1b).
 *   - sentinel-identity: object-identity comparisons (`===`/`!==`) where one side is a `.target`/
 *                        `.position`/`.rotation` member access and the other a bare identifier (M3b).
 *   - unguarded-division: `= <expr> / <bareIdentifier>` divisions in audited scope (M5b review list).
 *
 * The ADR explicitly does NOT automate the boundary-test-name scan (M5), the ADR Rule-of-Three
 * consumer list (M2) or the transition-test count (M3) in v1 — those stay review obligations so
 * the error tier stays free of noise.
 *
 * USAGE:
 *   npm run check:doctrine                      # hard checks only
 *   npm run check:doctrine -- --enable-advisory # hard + advisory heuristics (report + exit 2)
 *   npm run check:doctrine -- --list-invariants # print the invariant registry seed
 *   npm run check:doctrine -- --not-audited     # (single-file override, undeveloped — see below)
 *
 * EXIT CODES:
 *   0  all checks clean (advisory tier disabled, or enabled and no findings)
 *   1  at least one HARD (error-tier) violation
 *   2  advisory tier enabled and at least one advisory finding (no hard violation), or a
 *      technical error (bad flags, unreadable root).
 *
 * Unlike check-verified-markers.js this script does NOT wire itself into CI: CI wiring is a
 * separate, post-gate step per the P1 gate dossier (§13.3).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");

// ---------------------------------------------------------------------------
// Doctrine constants (ADR 0047 — keep in sync with the ADR tables)
// ---------------------------------------------------------------------------

/** Exact spellings the checker recognizes. */
const CLASSIFICATION_TAGS: readonly string[] = ["@domain", "@derived", "@fixed"];
const INVARIANT_TAG = "@invariant";
const DOCTRINE_TAGS: ReadonlySet<string> = new Set<string>([...CLASSIFICATION_TAGS, INVARIANT_TAG]);

/** Typo detection: any tag in this prefix space that is not exact is a misspelling. */
const DOCTRINE_TAG_PREFIX: ReadonlySet<string> = new Set<string>([
  "@domain",
  "@derived",
  "@fixed",
  "@invariant",
]);

/**
 * Committed invariant registry seed (version 1) — ADR 0047 §"Invarianten-Registry". Only
 * invariants verifiably anchored on HEAD are listed; the S4 matrix (IDs 1.1–3.2) is merged at the
 * P5 gate. Extend the seed by editing this list AND the ADR table.
 */
const INVARIANT_REGISTRY: readonly string[] = [
  "CAM-POSITION-OWNERSHIP",
  "CAM-STRATEGY-CLAMP",
  "CAM-NATURAL-PITCH",
  "CAM-STRATEGY-TRANSITION",
  "BOUNDS-CONTAINMENT",
  "STATIC-INTENT",
  "PROJECTION-INVERTIBILITY",
];
const INVARIANT_REGISTRY_SET: ReadonlySet<string> = new Set<string>(INVARIANT_REGISTRY);

/** Escape-hatch rule names (ADR 0047 §"Escape-Hatch"). */
const ESCAPE_RULES: ReadonlySet<string> = new Set<string>([
  "any",
  "classification",
  "classification-typo",
  "classification-blank",
  "invariant-id",
  "adr-compliance",
  "dead-knob",
  "sentinel-identity",
  "untagged-param",
  "unguarded-division",
]);

/** Audited hot scope (ADR 0047 §"Scope"), repo-root-relative, forward slashes. */
const AUDITED_SCOPE_DIRS: readonly string[] = [
  "packages/engine/src/core/cameras",
  "packages/engine/src/core/controllers",
  "packages/engine/src/core/behaviors",
  "packages/engine/src/core/culling",
  "packages/engine/src/core/lights",
  "packages/engine/src/core/materials",
  "packages/engine/src/physix",
  "packages/engine/src/renderers",
];
const AUDITED_SCOPE_FILES: ReadonlySet<string> = new Set<string>([
  "packages/engine/src/core/objects/Object3D.ts",
]);

const ENGINE_SRC = "packages/engine/src";
const ADR_DIR = "docs/adr";
const HARD_ADR_FROM_NUMBER = 47; // ADRs numbered >= 47 must carry the Doctrine Compliance section.

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Recursively collect repo-root-relative file paths whose basename matches the predicate. */
function collectFiles(dirRel: string, matcher: (name: string) => boolean): string[] {
  const found: string[] = [];
  const walk = (rel: string): void => {
    const abs = path.join(ROOT, rel);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) {
        walk(child);
      } else if (matcher(entry.name)) {
        found.push(child);
      }
    }
  };
  walk(dirRel);
  return found;
}

function readFileSafe(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** True when the repo-root-relative path lies inside the audited hot scope. */
function isAudited(rel: string): boolean {
  if (AUDITED_SCOPE_FILES.has(rel)) return true;
  return AUDITED_SCOPE_DIRS.some((dir) => rel === dir || rel.startsWith(dir + "/"));
}

// ---------------------------------------------------------------------------
// Escape-hatch parsing (single-line directive, any comment style)
// ---------------------------------------------------------------------------

interface EscapeDirective {
  rule: string;
  reason: string;
}

const ESCAPE_RE =
  /doctrine-ignore:\s*([a-z][a-z0-9-]*)\s+([^\r\n>*/]+?)\s*(?:-->\s*)?(?:\*\/)?(?:\r?$)/;
const ESCAPE_RULE_ONLY_RE = /doctrine-ignore:\s*([a-z][a-z0-9-]*)\s*$/;
const ESCAPE_TOKEN_RE = /doctrine-ignore:\s*([^\s>*/]+)/;
const HTML_COMMENT_RE = /<!--([\s\S]*?)-->/g;

/** 1-based line number of the character at `index` within `content`. */
function lineNumberOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

/**
 * CODE MODE: every `doctrine-ignore:` occurrence in engine source is a directive and is strictly
 * validated (hard errors for unknown rule names / missing mandatory reasons). Occurrences whose
 * first token is not a lowercase rule name (`<regel>`, "...", …) are prose-safe and ignored.
 */
function parseEscapesCode(rel: string, content: string, errors: string[]): EscapeDirective[] {
  const directives: EscapeDirective[] = [];
  const lines: string[] = content.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (!line.includes("doctrine-ignore:")) continue;
    const at = `${rel}:${i + 1}`;
    const allowed = `[${[...ESCAPE_RULES].sort().join(", ")}]`;
    ESCAPE_RE.lastIndex = 0;
    const match = ESCAPE_RE.exec(line);
    if (match !== null) {
      const rule = match[1] as string;
      const reason = (match[2] as string).trim();
      if (!ESCAPE_RULES.has(rule)) {
        errors.push(
          `${at}: unbekannter doctrine-ignore-Regelname "${rule}" (zulässig: ${allowed})`,
        );
      } else if (reason.length === 0) {
        errors.push(`${at}: doctrine-ignore "${rule}" ohne Pflicht-Begründung`);
      } else {
        directives.push({ rule, reason });
      }
      continue;
    }
    // Directive present but not parseable by the rich rule — diagnose precisely.
    const ruleOnly = ESCAPE_RULE_ONLY_RE.exec(line);
    if (ruleOnly !== null) {
      const rule = ruleOnly[1] as string;
      errors.push(
        ESCAPE_RULES.has(rule)
          ? `${at}: doctrine-ignore "${rule}" ohne Pflicht-Begründung`
          : `${at}: unbekannter doctrine-ignore-Regelname "${rule}" (zulässig: ${allowed})`,
      );
      continue;
    }
    const token = ESCAPE_TOKEN_RE.exec(line);
    const tokenName = token !== null ? (token[1] ?? "") : "";
    // A non-lowercase first token means prose / syntax documentation (e.g. `<regel>`) — skip.
    if (/^[a-z]/.test(tokenName)) {
      errors.push(
        `${at}: doctrine-ignore ohne parsebares Regeltoken (Syntax: doctrine-ignore: <regel> <pflicht-begründung>; gefunden: "${tokenName}")`,
      );
    }
  }
  return directives;
}

/**
 * DOC MODE (ADRs, committed docs): only `doctrine-ignore:` directives inside real HTML comments
 * (`<!-- ... -->`) are honored and strictly validated; bare prose/code-span occurrences are syntax
 * documentation and ignored (zero false positives against the ADR's own example text).
 */
function parseEscapesDocMode(rel: string, content: string, errors: string[]): EscapeDirective[] {
  const directives: EscapeDirective[] = [];
  HTML_COMMENT_RE.lastIndex = 0;
  let block: RegExpExecArray | null;
  while ((block = HTML_COMMENT_RE.exec(content)) !== null) {
    const blockText = block[1] ?? "";
    const lines: string[] = blockText.split(/\r\n|\r|\n/);
    const startLine = lineNumberOf(content, block.index);
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j] as string;
      if (!line.includes("doctrine-ignore:")) continue;
      const at = `${rel}:${startLine + j}`;
      const allowed = `[${[...ESCAPE_RULES].sort().join(", ")}]`;
      ESCAPE_RE.lastIndex = 0;
      const match = ESCAPE_RE.exec(line);
      if (match !== null) {
        const rule = match[1] as string;
        const reason = (match[2] as string).trim();
        if (!ESCAPE_RULES.has(rule)) {
          errors.push(
            `${at}: unbekannter doctrine-ignore-Regelname "${rule}" (zulässig: ${allowed})`,
          );
        } else if (reason.length === 0) {
          errors.push(`${at}: doctrine-ignore "${rule}" ohne Pflicht-Begründung`);
        } else {
          directives.push({ rule, reason });
        }
      }
    }
  }
  return directives;
}

/**
 * Collect and VALIDATE escape directives. Code = strict (every occurrence is a directive); docs =
 * only HTML-comment directives. Empty reasons and unknown rule names are always HARD errors.
 */
function parseEscapes(
  rel: string,
  content: string,
  errors: string[],
  mode: "code" | "doc",
): EscapeDirective[] {
  return mode === "doc"
    ? parseEscapesDocMode(rel, content, errors)
    : parseEscapesCode(rel, content, errors);
}

function suppresses(directives: EscapeDirective[], rule: string): boolean {
  return directives.some((d) => d.rule === "any" || d.rule === rule);
}

// ---------------------------------------------------------------------------
// Engine source scan (hard: marker syntax + invariant IDs)
// ---------------------------------------------------------------------------

/** True when the line looks like a JSDoc or `//` comment line (safe context for tags). */
function isCommentishLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("/**") || t.startsWith("//");
}

const TAG_LINE_RE = /@([A-Za-z][A-Za-z0-9_-]*)/g;
const CLASS_TAG_ON_LINE_RE = /@(domain|derived|fixed)\b/g;
const CLASSIFICATION_LINE_RE = /(@domain|@derived|@fixed)(?:\s+(.*))?$/;
const INVARIANT_TAG_ON_LINE_RE = /@invariant\s/;
const INVARIANT_LINE_RE = /@invariant\s+([A-Za-z0-9._-]+)(?:\s*:\s*(.*))?$/;

/**
 * Scan one engine source file for the Class-A markers. Only markers that EXIST are validated;
 * absence is never a hard fault (historical members are exempt).
 */
function scanEngineFile(rel: string, content: string, errors: string[]): void {
  const escapes = parseEscapes(rel, content, errors, "code");
  const lines: string[] = content.split(/\r\n|\r|\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (!isCommentishLine(line)) continue;

    // 1) Typo detection: doctrine-prefix tag that is not an exact spelling.
    TAG_LINE_RE.lastIndex = 0;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = TAG_LINE_RE.exec(line)) !== null) {
      const tag = tagMatch[1] as string;
      const withAt = `@${tag}`;
      if (DOCTRINE_TAG_PREFIX.has(withAt) && !DOCTRINE_TAGS.has(withAt)) {
        if (!suppresses(escapes, "classification-typo") && !suppresses(escapes, "any")) {
          errors.push(
            `${rel}:${i + 1}: Doktrin-Klassifikations-Tag "@${tag}" (Schreibfehler?) — erwartet genau ${[...DOCTRINE_TAGS].join(" | ")}`,
          );
        }
      }
    }

    // 1b) Same-line conflict: two DIFFERENT classification tags on one line are unambiguous.
    //     (Block-level multi-class stays advisory: a JSDoc block may legitimately document more
    //     than one parameter.)
    const classesOnLine: string[] = [];
    CLASS_TAG_ON_LINE_RE.lastIndex = 0;
    let classMatch: RegExpExecArray | null;
    while ((classMatch = CLASS_TAG_ON_LINE_RE.exec(line)) !== null) {
      classesOnLine.push(classMatch[1] as string);
    }
    const distinctClasses = new Set<string>(classesOnLine);
    if (
      distinctClasses.size > 1 &&
      !suppresses(escapes, "classification") &&
      !suppresses(escapes, "any")
    ) {
      errors.push(
        `${rel}:${i + 1}: zwei verschiedene Klassifikationen in einer Zeile: ${[...distinctClasses].join(" und ")} — genau eine Klasse pro Parameter`,
      );
    }

    // 2) Classification tags must carry non-empty text on the same line.
    const classification = CLASSIFICATION_LINE_RE.exec(line);
    if (classification !== null) {
      const tag = classification[1] as string;
      const meaning = (classification[2] ?? "").trim();
      if (
        meaning.length === 0 &&
        !suppresses(escapes, "classification-blank") &&
        !suppresses(escapes, "any")
      ) {
        errors.push(
          `${rel}:${i + 1}: ${tag} ohne einzeilige Bedeutung (Pflicht: physikalische Bedeutung/Ableitung/Einfrier-Grund in derselben Zeile)`,
        );
      }
    }

    // 3) Invariant references must carry exactly one registry ID that exists in the seed.
    //    The tag is mandatory; a bare `@invariant` or `@invariant <non-ID-token>` is malformed.
    if (INVARIANT_TAG_ON_LINE_RE.test(line)) {
      const invariant = INVARIANT_LINE_RE.exec(line);
      const allow = suppresses(escapes, "invariant-id") || suppresses(escapes, "any");
      if (invariant === null || (invariant[1] ?? "").trim().length === 0) {
        if (!allow)
          errors.push(
            `${rel}:${i + 1}: @invariant ohne Registry-ID (Syntax: @invariant <ID>: <Relation>)`,
          );
      } else {
        const id = (invariant[1] as string).trim();
        if (!INVARIANT_REGISTRY_SET.has(id) && !allow) {
          errors.push(
            `${rel}:${i + 1}: @invariant "${id}" nicht im Registry-Seed (ADR 0047). Seed erweitern oder doctrine-ignore mit Begründung.`,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// ADR compliance scan (A4): ADRs numbered >= 47 must carry the mandatory section.
// ---------------------------------------------------------------------------

const ADR_FILENAME_NUMBER_RE = /^(\d{4})-/;

/** Extract the leading 4-digit number of an ADR filename, or null. */
function adrNumber(filename: string): number | null {
  const match = ADR_FILENAME_NUMBER_RE.exec(filename);
  if (match === null || match[1] === undefined) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) ? parsed : null;
}

const ADR_HEADING_RE = /^#{1,4}\s*Doctrine\s+Compliance\s*$/im;

/**
 * Strip fenced code blocks (``` ... ```) so the A4 heading check counts a REAL section, not a
 * template literal or example sitting inside a code fence.
 */
function stripFencedBlocks(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, "");
}

function scanAdrCompliance(errors: string[]): void {
  const adrFiles: string[] = collectFiles(
    ADR_DIR,
    (name) => name.endsWith(".md") && name !== "index.md",
  );
  for (const rel of adrFiles) {
    const num = adrNumber(path.posix.basename(rel));
    if (num === null || num < HARD_ADR_FROM_NUMBER) continue;
    let content: string;
    try {
      content = readFileSafe(rel);
    } catch {
      errors.push(`${rel}: nicht lesbar`);
      continue;
    }
    const escapes = parseEscapes(rel, content, errors, "doc");
    const realSectionPresent = ADR_HEADING_RE.test(stripFencedBlocks(content));
    if (
      !realSectionPresent &&
      !suppresses(escapes, "adr-compliance") &&
      !suppresses(escapes, "any")
    ) {
      errors.push(
        `${rel}: ab ADR ${HARD_ADR_FROM_NUMBER} Pflichtabschnitt "## Doctrine Compliance" fehlt (ADR 0047, Vorlage). Escape nur mit Begründung.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Advisory heuristics (Class B, flag-gated; report-only, exit 2 when enabled)
// ---------------------------------------------------------------------------

interface Advisory {
  rule: string;
  rel: string;
  line: number;
  message: string;
}

const PUBLIC_MEMBER_RE =
  /\bpublic\s+(?!(?:override|readonly|get|set)\b)([A-Za-z_$][\w$]*)\s*:(?!\s*\()/g;
const IDENTITY_COMPARE_RE = /\b(\w+(?:\.\w+)*)\s*(===|!==)\s*(\w+(?:\.\w+)*)\b/g;
const UNGUARDED_DIVISION_RE = /\b(\w[\w$]*)\s*=\s*[^;=]*\/\s*([A-Za-z_$][\w$]*)(?!\.)(?!\s*[=<>])/g;

function hasPrecedingMarker(lines: string[], index: number): boolean {
  // One blank line may separate the JSDoc block from the declaration; other lines end the block.
  let i = index - 1;
  while (i >= 0) {
    const line = (lines[i] as string).trim();
    if (line.length === 0) {
      i--;
      continue;
    }
    if (line.startsWith("*") || line.startsWith("/*")) {
      if (/@(domain|derived|fixed|inheritdoc|deprecated)\b/.test(line)) return true;
      i--;
      continue;
    }
    break;
  }
  return false;
}

/** Collect advisory candidates from the audited scope. Never affects exit code without the flag. */
function collectAdvisories(): Advisory[] {
  const advisories: Advisory[] = [];
  const srcFiles = collectFiles(ENGINE_SRC, (name) => name.endsWith(".ts"));
  const seenMembers = new Set<string>();

  for (const rel of srcFiles) {
    if (!isAudited(rel)) continue;
    let content: string;
    try {
      content = readFileSafe(rel);
    } catch {
      continue;
    }
    const lines: string[] = content.split(/\r\n|\r|\n/);
    const fileText = content;

    // untagged-param + dead-knob share the same candidate scan.
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      PUBLIC_MEMBER_RE.lastIndex = 0;
      let mm: RegExpExecArray | null;
      while ((mm = PUBLIC_MEMBER_RE.exec(line)) !== null) {
        const name = mm[1] as string;
        const key = `${rel}:${name}`;
        if (seenMembers.has(key)) continue;
        seenMembers.add(key);

        if (!hasPrecedingMarker(lines, i)) {
          advisories.push({
            rule: "untagged-param",
            rel,
            line: i + 1,
            message: `öffentliches Mitglied "${name}" im Hot-Scope ohne Klassifikation (@domain/@derived/@fixed) — mittelfristig klassifizieren oder als historisch befreit dokumentieren`,
          });
        }

        const occurrences = countOccurrences(fileText, name);
        if (occurrences === 1) {
          advisories.push({
            rule: "dead-knob",
            rel,
            line: i + 1,
            message: `öffentliches Mitglied "${name}" nur an der Deklaration lesbar — Dead-Knob-Verdacht (Prinzip 1)`,
          });
        }
      }
    }

    // sentinel-identity candidates.
    IDENTITY_COMPARE_RE.lastIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      let im: RegExpExecArray | null;
      while ((im = IDENTITY_COMPARE_RE.exec(line)) !== null) {
        const a = im[1] as string;
        const op = im[2] as string;
        const b = im[3] as string;
        const isMember = (s: string): boolean => /\.(target|position|rotation)$/.test(s);
        const isBare = (s: string): boolean => /^[A-Za-z_$][\w$]*$/.test(s);
        if ((isMember(a) && isBare(b)) || (isBare(a) && isMember(b))) {
          advisories.push({
            rule: "sentinel-identity",
            rel,
            line: i + 1,
            message: `Objektidentitäts-Vergleich "${a} ${op} ${b}" — Sentinel-Verdacht (implicit state, Prinzip 3); legitime Ressourcen-Identität mit Kommentar versehen`,
          });
        }
      }
    }

    // unguarded-division candidates in audited hot-path files.
    UNGUARDED_DIVISION_RE.lastIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      let dm: RegExpExecArray | null;
      while ((dm = UNGUARDED_DIVISION_RE.exec(line)) !== null) {
        const divisor = dm[2] as string;
        if (/^(?:this\.)?(?:epsilon|EPS|rad|scale)[\w$]*$/i.test(divisor)) continue; // obviously guarded/bounded locals
        advisories.push({
          rule: "unguarded-division",
          rel,
          line: i + 1,
          message:
            `Division durch abgeleitete Größe "${divisor}" ohne sichtbaren Nenner-Guard — Prinzip 5: ` +
            "`x = 1 / d` mit Hoffnung auf d≠0 vermeiden",
        });
      }
    }
  }

  return advisories;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

interface Options {
  enableAdvisory: boolean;
  listInvariants: boolean;
  help: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { enableAdvisory: false, listInvariants: false, help: false };
  for (const arg of argv) {
    if (arg === "--enable-advisory") options.enableAdvisory = true;
    else if (arg === "--list-invariants") options.listInvariants = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else {
      console.error(`check-doctrine: unbekanntes Argument "${arg}" (siehe --help)`);
      process.exit(2);
    }
  }
  return options;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log("check-doctrine — Whack-a-Mole-Doktrin (ADR 0047)");
    console.log("Usage: node scripts/check-doctrine.ts [--enable-advisory] [--list-invariants]");
    console.log(
      "Exit: 0 clean | 1 hard violation | 2 advisory (with --enable-advisory) or technical error",
    );
    console.log("Registry-Seed:");
    for (const id of INVARIANT_REGISTRY) console.log(`  - ${id}`);
    return;
  }

  if (options.listInvariants) {
    console.log("Invarianten-Registry (ADR 0047, versioniert):");
    for (const id of INVARIANT_REGISTRY) console.log(`  - ${id}`);
    console.log(
      "Erweitern: Checker-Konstante + ADR-0047-Tabelle; S4-Matrix-IDs werden am P5-Gate ergänzt.",
    );
    return;
  }

  const errors: string[] = [];

  // NOTE: markdown files are run through the SAME escape-parser as code, so ADR-internal
  // `status` or `doctrine-ignore` HTML-comment escapes are honored the same way.
  const engineFiles = collectFiles("packages/engine/src", (name) => name.endsWith(".ts"));
  for (const rel of engineFiles) {
    let content: string;
    try {
      content = readFileSafe(rel);
    } catch {
      continue;
    }
    scanEngineFile(rel, content, errors);
  }

  scanAdrCompliance(errors);

  if (errors.length > 0) {
    console.error(`check-doctrine: ${errors.length} HARTE(r) Doktrin-Verstoß(e):`);
    for (const err of errors) console.error(`  [DOCTRINE-ERR] ${err}`);
    process.exit(1);
  }

  if (options.enableAdvisory) {
    const advisories = collectAdvisories();
    if (advisories.length > 0) {
      console.warn(
        `check-doctrine: ${advisories.length} advisory Befund(e) (Klasse B, nicht blockierend — zur Review):`,
      );
      for (const adv of advisories) {
        console.warn(`  [DOCTRINE-ADV:${adv.rule}] ${adv.rel}:${adv.line} — ${adv.message}`);
      }
      process.exit(2);
    }
    console.log("check-doctrine: keine advisory Befunde im auditierten Hot-Scope.");
  } else {
    console.log(
      "check-doctrine: harte Checks sauber (advisory-Heuristiken deaktiviert — mit --enable-advisory aktivieren).",
    );
  }

  process.exit(0);
}

main();
