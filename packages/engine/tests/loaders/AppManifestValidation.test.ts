import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import {
  APP_SCHEMA_VERSION,
  assertAppManifest,
  assertNoRetiredIdReuse,
  assertUniqueLevelEntityIds,
  type AppManifest,
  type LevelDescriptor,
} from "../../src/loaders/kit/KitRegistry.js";

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

function findLevelDescriptorsInApp(appDir: string): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".git" && entry.name !== "dist") {
          walk(full);
        }
      } else if (entry.name.endsWith(".level.json")) {
        const parsed = JSON.parse(fs.readFileSync(full, "utf8")) as LevelDescriptor;
        found.set(parsed.id, full);
      }
    }
  };
  walk(appDir);
  return found;
}

describe("Application Manifests & Schema Validation (ADR 0041 Stufe 1)", () => {
  const repoRoot = findRepoRoot(__dirname);
  const schemasDir = path.join(repoRoot, "public", "schemas");
  const appSchemaPath = path.join(schemasDir, "app.schema.json");
  const sampleAppsDir = path.join(repoRoot, "apps", "sample-apps");
  const kitsRootDir = path.join(repoRoot, "public", "assets", "kits");

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const appSchema = JSON.parse(fs.readFileSync(appSchemaPath, "utf8")) as Record<string, unknown>;
  const validateApp: ValidateFunction = ajv.compile(appSchema);

  const appDirs = fs
    .readdirSync(sampleAppsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .map((entry) => entry.name)
    .sort();

  it("discovers sample applications under apps/sample-apps/", () => {
    expect(appDirs.length).toBeGreaterThanOrEqual(4);
    expect(appDirs).toEqual(
      expect.arrayContaining(["the-whisper", "yad", "light-cycle-arena", "voxel-prototype"]),
    );
  });

  describe.each(appDirs)("app: %s", (appName) => {
    const appDir = path.join(sampleAppsDir, appName);
    const manifestPath = path.join(appDir, "app.json");

    it("has an app.json manifest", () => {
      expect(fs.existsSync(manifestPath), `Missing app.json in ${appDir}`).toBe(true);
    });

    it("conforms strictly to public/schemas/app.schema.json and assertAppManifest", () => {
      const raw: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const valid = validateApp(raw);
      if (!valid) {
        const errors = (validateApp.errors ?? [])
          .map((e) => `  ${e.instancePath || "/"} ${e.message}`)
          .join("\n");
        expect.fail(`Schema validation errors in ${appName}/app.json:\n${errors}`);
      }
      assertAppManifest(raw, appName);
      expect(raw.id).toBe(appName);
      expect(raw.schemaVersion).toBe(APP_SCHEMA_VERSION);
    });

    it("resolves its $schema pointer to public/schemas/app.schema.json", () => {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as AppManifest;
      expect(manifest.$schema).toBeDefined();
      const resolved = path.resolve(appDir, manifest.$schema!);
      expect(fs.existsSync(resolved), `$schema does not resolve: ${manifest.$schema}`).toBe(true);
      expect(resolved).toBe(appSchemaPath);
    });

    it("resolves entry, code.module, kits, and levels to real files", () => {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as AppManifest;
      expect(
        fs.existsSync(path.join(appDir, manifest.entry)),
        `Entry '${manifest.entry}' missing in ${appName}`,
      ).toBe(true);

      if (manifest.code !== undefined) {
        expect(
          fs.existsSync(path.join(appDir, manifest.code.module)),
          `code.module '${manifest.code.module}' missing in ${appName}`,
        ).toBe(true);
      }

      for (const kitDep of manifest.kits) {
        const kitManifestPath = path.join(kitsRootDir, kitDep.id, "kit.json");
        expect(
          fs.existsSync(kitManifestPath),
          `Referenced kit '${kitDep.id}' in ${appName}/app.json does not exist at ${kitManifestPath}`,
        ).toBe(true);
      }

      const discoveredLevels = findLevelDescriptorsInApp(appDir);
      for (const levelId of manifest.levels) {
        expect(
          discoveredLevels.has(levelId),
          `Level '${levelId}' declared in ${appName}/app.json was not found as a .level.json in ${appName}`,
        ).toBe(true);
      }
      // Every .level.json in the app must be accounted for in app.json (no orphan levels).
      const allEntityIds = new Set<string>();
      for (const [discoveredId, filePath] of discoveredLevels) {
        expect(
          manifest.levels,
          `Orphan level '${discoveredId}' (${path.relative(repoRoot, filePath)}) not listed in ${appName}/app.json`,
        ).toContain(discoveredId);

        const levelDesc = JSON.parse(fs.readFileSync(filePath, "utf8")) as LevelDescriptor;
        assertUniqueLevelEntityIds(levelDesc, appName);
        for (const p of levelDesc.props) allEntityIds.add(p.id);
        for (const d of levelDesc.decals ?? []) allEntityIds.add(d.id);
        for (const l of levelDesc.lights ?? []) allEntityIds.add(l.name);
        for (const h of levelDesc.hotspots ?? []) allEntityIds.add(h.id);
      }

      const allTextIds = new Set<string>();
      for (const lang of manifest.content?.languages ?? []) {
        const langPath = path.join(appDir, "content", `${lang}.json`);
        if (fs.existsSync(langPath)) {
          const catalog = JSON.parse(fs.readFileSync(langPath, "utf8")) as Record<string, unknown>;
          for (const key of Object.keys(catalog)) {
            if (key !== "$schema") allTextIds.add(key);
          }
        }
      }

      assertNoRetiredIdReuse(
        manifest,
        {
          levels: discoveredLevels.keys(),
          characters: manifest.characters,
          props: allEntityIds,
          texts: allTextIds,
        },
        appName,
      );
    });
  });

  describe("schemaVersion fail-fast & additionalProperties guard", () => {
    const validFixture: AppManifest = {
      id: "demo-app",
      name: "Demo App",
      version: "0.1.0",
      schemaVersion: 1,
      entry: "index.html",
      levels: [],
      characters: [],
      kits: [],
    };

    it("rejects unknown fields in app.schema.json (additionalProperties: false)", () => {
      expect(validateApp({ ...validFixture, extraField: true })).toBe(false);
    });

    it.each([0, 2, 99, -1, 1.5])(
      "rejects unsupported schemaVersion=%s in both schema and assertAppManifest",
      (badVersion) => {
        const bad = { ...validFixture, schemaVersion: badVersion };
        expect(validateApp(bad)).toBe(false);
        expect(() => assertAppManifest(bad)).toThrow(/Unsupported app\.json schemaVersion/);
      },
    );
  });
});
