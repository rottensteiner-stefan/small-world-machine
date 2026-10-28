// Type declarations for scripts/goldens/skip-check.js — allows typed imports in tests
// (the script itself runs as a plain Node CLI; this file is types-only, never emitted).

export interface SkipDecideInput {
  /** Resolved baseline commit (shortest SHA) or "" when unresolvable. */
  baselineCommit: string;
  /** Current HEAD SHA. */
  head: string;
  /** True when the repository is a shallow clone (git rev-parse --is-shallow-repository). */
  shallow: boolean;
  /** Paths changed since the baseline commit (committed + worktree). */
  changed: string[];
}

export interface SkipDecideResult {
  /** True = run, false = skip. */
  shouldRun: boolean;
  reason: string;
}

export function decide(input: SkipDecideInput): SkipDecideResult;
