import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { LevelDescriptor } from "../../src/loaders/kit/KitTypes.js";

function findRepoRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    if (
      fs.existsSync(path.join(current, "pnpm-workspace.yaml")) ||
      fs.existsSync(path.join(current, "package.json"))
    ) {
      if (fs.existsSync(path.join(current, "public", "schemas", "level.schema.json"))) {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Could not find repository root containing public/schemas/level.schema.json");
    }
    current = parent;
  }
}

function findLevelFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git" && entry.name !== "dist") {
        results.push(...findLevelFiles(full));
      }
    } else if (entry.name.endsWith(".level.json")) {
      results.push(full);
    }
  }
  return results;
}

describe("Level Schema & Level Manifest Validation", () => {
  const repoRoot = findRepoRoot(__dirname);
  const schemaPath = path.join(repoRoot, "public", "schemas", "level.schema.json");
  const levelFiles = findLevelFiles(path.join(repoRoot, "apps"));

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const schemaJson = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as Record<string, unknown>;
  const validateLevel: ValidateFunction = ajv.compile(schemaJson);

  it("finds at least one .level.json in the repository", () => {
    expect(levelFiles.length).toBeGreaterThan(0);
  });

  for (const levelPath of levelFiles) {
    const relPath = path.relative(repoRoot, levelPath);

    describe(`Level: ${relPath}`, () => {
      const rawContent = fs.readFileSync(levelPath, "utf8");
      let levelData: LevelDescriptor;

      it("parses as valid JSON", () => {
        expect(() => {
          levelData = JSON.parse(rawContent) as LevelDescriptor;
        }).not.toThrow();
      });

      it("conforms strictly to public/schemas/level.schema.json", () => {
        levelData = JSON.parse(rawContent) as LevelDescriptor;
        const valid = validateLevel(levelData);
        if (!valid) {
          const errors = (validateLevel.errors ?? [])
            .map((e) => `  ${e.instancePath || "/"} ${e.message}`)
            .join("\n");
          expect.fail(`Schema validation errors in ${relPath}:\n${errors}`);
        }
      });

      it("references existing kit props in public/assets/kits/", () => {
        levelData = JSON.parse(rawContent) as LevelDescriptor;
        const kitsRoot = path.join(repoRoot, "public", "assets", "kits");

        for (const prop of levelData.props) {
          const [kitId] = prop.kitProp.split("/");
          expect(kitId).toBeDefined();
          const kitManifestPath = path.join(kitsRoot, kitId!, "kit.json");
          expect(
            fs.existsSync(kitManifestPath),
            `Referenced kit '${kitId}' in prop '${prop.id}' does not exist at ${kitManifestPath}`,
          ).toBe(true);

          const kitManifest = JSON.parse(fs.readFileSync(kitManifestPath, "utf8")) as {
            items: Array<{ id: string; meta: string }>;
          };
          const item = kitManifest.items.find(
            (it) => it.id === prop.kitProp || it.id.endsWith(prop.kitProp),
          );
          expect(
            item,
            `Prop '${prop.kitProp}' not declared in kit manifest ${kitManifestPath}`,
          ).toBeDefined();

          if (item) {
            const metaPath = path.join(kitsRoot, kitId!, item.meta);
            expect(
              fs.existsSync(metaPath),
              `Meta file '${item.meta}' for prop '${prop.kitProp}' missing at ${metaPath}`,
            ).toBe(true);
          }
        }
      });

      it("references existing kit decals and their map files", () => {
        levelData = JSON.parse(rawContent) as LevelDescriptor;
        const kitsRoot = path.join(repoRoot, "public", "assets", "kits");
        const propIds = new Set(levelData.props.map((prop) => prop.id));

        for (const decal of levelData.decals ?? []) {
          if (decal.parent !== undefined) {
            expect(
              propIds.has(decal.parent),
              `Decal '${decal.id}' has unknown parent prop '${decal.parent}'`,
            ).toBe(true);
          }
          const [kitId] = decal.kitDecal.split("/");
          const kitManifestPath = path.join(kitsRoot, kitId!, "kit.json");
          expect(
            fs.existsSync(kitManifestPath),
            `Kit '${kitId}' of decal '${decal.id}' does not exist at ${kitManifestPath}`,
          ).toBe(true);

          const kitManifest = JSON.parse(fs.readFileSync(kitManifestPath, "utf8")) as {
            decals?: Array<{
              id: string;
              file: string;
              normal?: string;
              orm?: string;
              emission?: string;
            }>;
          };
          const item = (kitManifest.decals ?? []).find((it) => it.id === decal.kitDecal);
          expect(
            item,
            `Decal '${decal.kitDecal}' not declared in kit manifest ${kitManifestPath}`,
          ).toBeDefined();

          for (const file of [item?.file, item?.normal, item?.orm, item?.emission]) {
            if (file === undefined) continue;
            const mapPath = path.join(kitsRoot, kitId!, "decals", file);
            expect(
              fs.existsSync(mapPath),
              `Map '${file}' of decal '${decal.kitDecal}' missing at ${mapPath}`,
            ).toBe(true);
          }
        }
      });
    });
  }
});
