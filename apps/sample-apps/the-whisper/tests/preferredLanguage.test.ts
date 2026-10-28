/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { preferredLanguage } from "../content/preferredLanguage.js";

function withNavigatorLanguage(language: string, run: () => void): void {
  const original = navigator.language;
  Object.defineProperty(navigator, "language", { value: language, configurable: true });
  try {
    run();
  } finally {
    Object.defineProperty(navigator, "language", { value: original, configurable: true });
  }
}

describe("preferredLanguage (ADR 0041 Stufe 4 — Einstellung)", () => {
  it("honors an available browser language", () => {
    withNavigatorLanguage("en-US", () => {
      expect(preferredLanguage()).toBe("en");
    });
  });

  it("falls back to the primary content language for unsupported browsers", () => {
    withNavigatorLanguage("fr-FR", () => {
      expect(preferredLanguage()).toBe("de");
    });
  });
});
