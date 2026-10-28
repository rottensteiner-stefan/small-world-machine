import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { ContentPackage, type ContentPackageData } from "../content/ContentPackage.js";

const realDePath = path.resolve(__dirname, "../content/de.json");
const realEnPath = path.resolve(__dirname, "../content/en.json");

describe("ContentPackage (ADR 0041 Stufe 4)", () => {
  it("parses the real de.json and resolves a stable story text id", () => {
    const data = JSON.parse(fs.readFileSync(realDePath, "utf8")) as ContentPackageData;
    const pkg = ContentPackage.fromJSON(data);
    expect(pkg.language).toBe("de");
    expect(pkg.t("hotspot.koje42.grinder.title")).toBe("Františeks Kaffeemühle");
    expect(pkg.has("ui.terminal.akte")).toBe(true);
  });

  it("parses the real en.json and resolves the same story text id (localization possible)", () => {
    const data = JSON.parse(fs.readFileSync(realEnPath, "utf8")) as ContentPackageData;
    const pkg = ContentPackage.fromJSON(data);
    expect(pkg.language).toBe("en");
    expect(pkg.t("hotspot.koje42.grinder.title")).toBe("František's Coffee Grinder");
  });

  it("fails fast on an unknown text id", () => {
    const pkg = ContentPackage.fromJSON({
      id: "the-whisper",
      language: "de",
      version: "1.0.0",
      texts: { "ui.hotspot.thought": "Gedanke" },
    });
    expect(pkg.t("ui.hotspot.thought")).toBe("Gedanke");
    expect(() => pkg.t("typo.id")).toThrow(/unknown text id 'typo\.id'/);
  });

  it("rejects empty or non-string texts", () => {
    expect(() =>
      ContentPackage.fromJSON({
        id: "the-whisper",
        language: "de",
        version: "1.0.0",
        texts: { "empty.id": "" },
      } as ContentPackageData),
    ).toThrow(/non-empty string/);
  });
});
