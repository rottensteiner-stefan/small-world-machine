import { describe, it, expect } from "vitest";
import {
  formatValidationIssue,
  formatValidationReport,
  formatValidationVerdict,
} from "../../src/common/io/validationReportText.js";

describe("validationReportText", () => {
  it("formats an issue with and without a path", () => {
    expect(
      formatValidationIssue({ severity: "error", message: "bad", path: "items[0].path" }),
    ).toBe("[error] bad (items[0].path)");
    expect(formatValidationIssue({ severity: "warning", message: "meh" })).toBe("[warning] meh");
  });

  it("pluralises the verdict and flips OK/INVALID with validity", () => {
    expect(formatValidationVerdict({ valid: true, issues: [] }, "kit")).toBe("OK (kit, 0 issues)");
    expect(
      formatValidationVerdict(
        { valid: false, issues: [{ severity: "error", message: "x" }] },
        "kit",
      ),
    ).toBe("INVALID (kit, 1 issue)");
  });

  it("lists every issue before the verdict", () => {
    const text = formatValidationReport(
      {
        valid: false,
        issues: [
          { severity: "error", message: "a", path: "p" },
          { severity: "info", message: "b" },
        ],
      },
      "demo",
    );

    expect(text).toBe("[error] a (p)\n[info] b\nINVALID (demo, 2 issues)");
  });
});
