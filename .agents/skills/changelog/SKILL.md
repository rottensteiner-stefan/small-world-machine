---
name: Changelog & Release Standard
description: Defines the strict formatting rules for CHANGELOG.md entries and Git release commits.
---

# Changelog & Release Standards

Small World Machine uses a highly stylized, poetic approach to version releases. Every new version is accompanied by a profound quote (philosophical, mathematical, scientific, or literary) that loosely reflects the nature of the update.

## 1. CHANGELOG.md Format

Every entry in the `CHANGELOG.md` MUST strictly follow this exact structure:

```markdown
## [0.63.0] - 2026-07-18

### "Pure mathematics is, in its way, the poetry of logical ideas." - Albert Einstein

- **Features:**
  - Description of new features, showcases, or visual additions.
- **Architecture & Bugfixes:**
  - Description of core engine changes, math fixes, or resolved crashes.
- **Housekeeping & Docs:**
  - Code cleanups, linting rules, or documentation updates.
```

**Rules for the Changelog:**

1. **No Extra Titles & No `[Unreleased]`:** Do NOT invent update names (like `"The Shader Update"`) and NEVER leave an `## [Unreleased]` section. Version headers MUST strictly match `## [x.y.z] - YYYY-MM-DD` in strictly descending semver order. The subheader (H3 `###`) MUST be `"Quote" - Author`.
2. **Unique Quotes Everywhere:** Every release quote MUST be unique across `CHANGELOG.md`, `docs/CHANGELOG-ARCHIVE.md`, and every commit message in `git log`. Always search both files and `git log --all` before choosing a quote.
3. **Strict Categories:** Always use only these three categories: `- **Features:**`, `- **Architecture & Bugfixes:**`, and `- **Housekeeping & Docs:**`. Omit empty categories cleanly — NEVER leave an empty category heading, duplicate a category within one release, or append trailing `- Version x.y.z.` lines.
4. **Concise Technical English & Length Budget:** Write all entries in compact, high-density technical English (`_Topic:_ ...` prefix, `1–3` crisp sentences per bullet, max `480` characters per line). Preserve all breaking/behaviour notices, ADRs, invariant IDs, and concrete metrics without narrative filler.
5. **Preserve History via Archive Split:** Active `CHANGELOG.md` covers `0.100.0+` and links to [docs/CHANGELOG-ARCHIVE.md](../../../docs/CHANGELOG-ARCHIVE.md) (`0.8.46 – 0.99.0`, excluded in `docs/.vitepress/config.mts` via `srcExclude`). NEVER delete historical releases; always prepend new versions directly under the top archive note.
6. **Automated Enforcement:** Format, category rules, descending semver, active English/length bounds, and cross-file quote uniqueness are guarded by `tests/scripts/changelogFormat.test.ts` in `npm test` and CI `verify`.

## 2. Git Commit Rule

**CRITICAL MANDATE — Git Commit Rule (reconciled with AGENTS.md):** Do NOT commit or push after
every single micro-edit, and do NOT commit on pure speculation. The controlling rule in this repo
is AGENTS.md: *the agent is explicitly authorized to run git operations without asking*, but only
commits when a feature or milestone is cohesively rounded off (or the user signals a commit).
(ORIGINAL text of this skill — superseded by AGENTS.md: "NEVER make a commit or push without
explicit user request... Either the user explicitly requests a commit, or no commit happens." —)
Micro-edits stay uncommitted until a milestone is done.

EVERY single Git commit (not just version bumps) MUST use this unconventional format.
The commit message MUST be **exactly a quote**, but **WITHOUT the author** and **WITHOUT the surrounding quotation marks**. Do NOT use standard Conventional Commits (like `feat: added something` or `docs: fixed typo`).

**Example:**
If you want to commit a layout refactoring, use an appropriate quote:
`git commit -m "Perfection is achieved, not when there is nothing more to add, but when there is nothing left to take away."`

Never use anything else for any commit.
