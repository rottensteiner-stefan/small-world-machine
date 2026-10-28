import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AppManifest } from "../../src/loaders/kit/KitTypes.js";

function findRepoRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    if (
      fs.existsSync(path.join(current, "package.json")) &&
      fs.existsSync(path.join(current, "public", "schemas", "app.schema.json"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Could not find repository root containing public/schemas/app.schema.json");
    }
    current = parent;
  }
}

interface ContentFile {
  readonly appName: string;
  readonly language: string;
  readonly filePath: string;
  readonly packageData: unknown;
}

function readContentFiles(appDir: string, appName: string): ContentFile[] {
  const contentDir = path.join(appDir, "content");
  if (!fs.existsSync(contentDir)) return [];
  const found: ContentFile[] = [];
  for (const entry of fs.readdirSync(contentDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    found.push({
      appName,
      language: entry.name.replace(/\.json$/, ""),
      filePath: path.join(contentDir, entry.name),
      packageData: JSON.parse(fs.readFileSync(path.join(contentDir, entry.name), "utf8")),
    });
  }
  return found;
}

describe("Content Package Validation (ADR 0041 Stufe 4)", () => {
  const repoRoot = findRepoRoot(__dirname);
  const sampleAppsDir = path.join(repoRoot, "apps", "sample-apps");

  const appDirs = fs
    .readdirSync(sampleAppsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .map((entry) => entry.name)
    .sort();

  const declared: Array<{ appName: string; languages: string[] }> = [];
  for (const appName of appDirs) {
    const manifestPath = path.join(sampleAppsDir, appName, "app.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as AppManifest;
    if (manifest.content !== undefined) {
      declared.push({ appName, languages: manifest.content.languages });
    }
  }

  it("detects at least the-whisper as a content-declaring app", () => {
    expect(declared.map((d) => d.appName)).toContain("the-whisper");
  });

  for (const app of declared) {
    const appDir = path.join(sampleAppsDir, app.appName);
    const foundFiles = readContentFiles(appDir, app.appName);

    it(`${app.appName}: every declared language ships as content/<lang>.json (compiles against the manifest)`, () => {
      for (const language of app.languages) {
        expect(
          foundFiles.some((f) => f.language === language),
          `Declared language '${language}' of ${app.appName} has no content/${language}.json`,
        ).toBe(true);
      }
    });

    it(`${app.appName}: no orphan content files (not loose; every pack is manifest-bound)`, () => {
      for (const file of foundFiles) {
        expect(
          app.languages,
          `Orphan content/${file.language}.json in ${app.appName} is not declared in app.json`,
        ).toContain(file.language);
      }
    });

    it(`${app.appName}: content files are well-formed with id/language/version/texts`, () => {
      for (const file of foundFiles) {
        expect(file.packageData, file.filePath).toBeTypeOf("object");
        const data = file.packageData as Record<string, unknown>;
        expect(Object.keys(data).sort()).toEqual(["id", "language", "texts", "version"]);
        expect(data["id"], file.filePath).toBe(app.appName);
        expect(data["language"], file.filePath).toBe(file.language);
        expect(typeof data["version"], file.filePath).toBe("string");
      }
    });

    it(`${app.appName}: every text id maps to a non-empty string`, () => {
      for (const file of foundFiles) {
        const texts = (file.packageData as { texts: Record<string, unknown> }).texts;
        expect(texts, file.filePath).toBeTruthy();
        for (const [id, value] of Object.entries(texts)) {
          expect(id.length, `${file.filePath}: text id must be non-empty`).toBeGreaterThan(0);
          expect(value, `${file.filePath}: text '${id}' must be a non-empty string`).toBeTypeOf(
            "string",
          );
          expect(
            (value as string).length,
            `${file.filePath}: text '${id}' is empty`,
          ).toBeGreaterThan(0);
        }
      }
    });

    it(`${app.appName}: all language packs share identical text-ID key sets (mutual key check §12a-7)`, () => {
      const sets = foundFiles.map((f) => ({
        language: f.language,
        keys: Object.keys((f.packageData as { texts: Record<string, string> }).texts).sort(),
      }));
      const reference = sets[0]!;
      for (const candidate of sets.slice(1)) {
        const missing = reference.keys.filter((k) => !candidate.keys.includes(k));
        const extra = candidate.keys.filter((k) => !reference.keys.includes(k));
        expect(
          missing,
          `${app.appName}: ${candidate.language} is missing keys (have them in ${reference.language}): ${missing.join(", ")}`,
        ).toEqual([]);
        expect(
          extra,
          `${app.appName}: ${candidate.language} has extra keys vs ${reference.language}: ${extra.join(", ")}`,
        ).toEqual([]);
      }
    });
  }
});
