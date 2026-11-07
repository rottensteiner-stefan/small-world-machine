import type { ValidationIssue, ValidationReport } from "./types.js";

/** One finding as a line: `[error] message (path)`. */
export function formatValidationIssue(issue: ValidationIssue): string {
  const where = issue.path === undefined ? "" : ` (${issue.path})`;
  return `[${issue.severity}] ${issue.message}${where}`;
}

/** Verdict line: `OK (label, 2 issues)` or `INVALID (label, 1 issue)`. */
export function formatValidationVerdict(report: ValidationReport, label: string): string {
  const count = report.issues.length;
  return `${report.valid ? "OK" : "INVALID"} (${label}, ${count} issue${count === 1 ? "" : "s"})`;
}

/** The whole report as plain text: every finding, then the verdict (the shape `swm kit validate` prints). */
export function formatValidationReport(report: ValidationReport, label: string): string {
  return [...report.issues.map(formatValidationIssue), formatValidationVerdict(report, label)].join(
    "\n",
  );
}
