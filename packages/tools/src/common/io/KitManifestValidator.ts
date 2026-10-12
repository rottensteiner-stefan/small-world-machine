import type { IAssetSource, ValidationIssue, ValidationReport } from "./types.js";

/**
 * Structural validation of a `kit.json` manifest against the rules of `public/schemas/kit.schema.json`
 * (ADR 0011). No JSON-Schema runtime dependency — the checks mirror the schema contract directly.
 *
 * Strictness follows the consensus of the tool-I/O session (P1 Punkt 4): `kit.json` itself is
 * validated strictly (structural errors reject the import), while referenced optional files
 * (previews, textures, glb assets, meta.json) are checked tolerantly and reported as warnings.
 */

const KIT_ID_PATTERN = /^[a-z][a-z0-9_-]*$/;
const NAMESPACED_ID_PATTERN = /^[a-z][a-z0-9_-]*\/[a-z][a-z0-9_]*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const GLB_PATTERN = /\.glb$/i;
const IMAGE_PATTERN = /\.(jpg|jpeg|png)$/i;
const JSON_PATTERN = /\.json$/i;
const PNG_PATTERN = /\.png$/i;

function error(message: string, path?: string): ValidationIssue {
  const issue: ValidationIssue = { message, severity: "error" };
  if (path !== undefined) issue.path = path;
  return issue;
}

function warning(message: string, path?: string): ValidationIssue {
  const issue: ValidationIssue = { message, severity: "warning" };
  if (path !== undefined) issue.path = path;
  return issue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates the parsed `kit.json` structure strictly. Does not inspect file existence. */
export function validateKitManifestStructure(json: unknown): ValidationReport {
  const issues: ValidationIssue[] = [];
  if (!isRecord(json)) {
    issues.push(error("kit.json is not a JSON object."));
    return { valid: false, issues };
  }

  const required: Array<[string, "string"]> = [
    ["id", "string"],
    ["name", "string"],
    ["version", "string"],
    ["description", "string"],
    ["author", "string"],
    ["license", "string"],
  ];
  for (const [key] of required) {
    if (json[key] === undefined) {
      issues.push(error(`Required field '${key}' is missing.`, key));
    } else if (typeof json[key] !== "string" || (json[key] as string).length === 0) {
      issues.push(error(`Field '${key}' must be a non-empty string.`, key));
    }
  }

  const id = json["id"];
  if (typeof id === "string" && !KIT_ID_PATTERN.test(id)) {
    issues.push(error("Field 'id' must match ^[a-z][a-z0-9_-]*$ (lowercase, no slash).", "id"));
  }

  const version = json["version"];
  if (typeof version === "string" && !SEMVER_PATTERN.test(version)) {
    issues.push(error("Field 'version' must be semver (X.Y.Z).", "version"));
  }

  for (const key of Object.keys(json)) {
    if (
      ![
        "$schema",
        "id",
        "name",
        "version",
        "description",
        "author",
        "license",
        "items",
        "textures",
        "decals",
      ].includes(key)
    ) {
      issues.push(
        warning(
          `Unknown top-level field '${key}' (schema allows additionalProperties: false).`,
          key,
        ),
      );
    }
  }

  const validateNamespaced = (entry: unknown, kind: string, index: number): void => {
    if (!isRecord(entry)) {
      issues.push(error(`Entry #${index} in '${kind}' must be an object.`, `${kind}[${index}]`));
      return;
    }
    if (typeof entry["id"] === "string" && !NAMESPACED_ID_PATTERN.test(entry["id"])) {
      issues.push(
        error(
          `Field 'id' must match '<kit-id>/<slug>' (pattern ^[a-z][a-z0-9_-]*/[a-z][a-z0-9_]*$).`,
          `${kind}[${index}].id`,
        ),
      );
    }
  };

  if (json["items"] !== undefined) {
    if (!Array.isArray(json["items"])) {
      issues.push(error("Field 'items' must be an array.", "items"));
    } else {
      json["items"].forEach((entry, index) => {
        if (!isRecord(entry)) {
          issues.push(error(`item #${index} must be an object.`, `items[${index}]`));
          return;
        }
        const requiredProps = ["id", "name", "category", "path", "preview", "meta"];
        for (const prop of requiredProps) {
          if (typeof entry[prop] !== "string" || (entry[prop] as string).length === 0) {
            issues.push(
              error(
                `item #${index} field '${prop}' must be a non-empty string.`,
                `items[${index}].${prop}`,
              ),
            );
          }
        }
        validateNamespaced(entry, "items", index);
        if (typeof entry["path"] === "string" && !GLB_PATTERN.test(entry["path"])) {
          issues.push(
            error(`item #${index} field 'path' must end with .glb.`, `items[${index}].path`),
          );
        }
        if (typeof entry["preview"] === "string" && !IMAGE_PATTERN.test(entry["preview"])) {
          issues.push(
            error(
              `item #${index} field 'preview' must be a .jpg/.jpeg/.png image.`,
              `items[${index}].preview`,
            ),
          );
        }
        if (typeof entry["meta"] === "string" && !JSON_PATTERN.test(entry["meta"])) {
          issues.push(
            error(`item #${index} field 'meta' must end with .json.`, `items[${index}].meta`),
          );
        }
      });
    }
  }

  if (json["textures"] !== undefined) {
    if (!Array.isArray(json["textures"])) {
      issues.push(error("Field 'textures' must be an array.", "textures"));
    } else {
      json["textures"].forEach((entry, index) => {
        if (!isRecord(entry)) {
          issues.push(error(`texture #${index} must be an object.`, `textures[${index}]`));
          return;
        }
        const requiredProps = ["id", "name", "category", "maps"];
        for (const prop of requiredProps) {
          if (prop === "maps") continue;
          if (typeof entry[prop] !== "string" || (entry[prop] as string).length === 0) {
            issues.push(
              error(
                `texture #${index} field '${prop}' must be a non-empty string.`,
                `textures[${index}].${prop}`,
              ),
            );
          }
        }
        validateNamespaced(entry, "textures", index);
        if (!Array.isArray(entry["maps"]) || entry["maps"].length < 1) {
          issues.push(
            error(
              `texture #${index} field 'maps' must be a non-empty array.`,
              `textures[${index}].maps`,
            ),
          );
        } else {
          (entry["maps"] as unknown[]).forEach((map, mapIndex) => {
            if (typeof map !== "string" || !PNG_PATTERN.test(map)) {
              issues.push(
                error(
                  `texture #${index} map must be a .png filename.`,
                  `textures[${index}].maps[${mapIndex}]`,
                ),
              );
            }
          });
        }
      });
    }
  }

  if (json["decals"] !== undefined) {
    if (!Array.isArray(json["decals"])) {
      issues.push(error("Field 'decals' must be an array.", "decals"));
    } else {
      json["decals"].forEach((entry, index) => {
        if (!isRecord(entry)) {
          issues.push(error(`decal #${index} must be an object.`, `decals[${index}]`));
          return;
        }
        const requiredProps = ["id", "name", "file"];
        for (const prop of requiredProps) {
          if (typeof entry[prop] !== "string" || (entry[prop] as string).length === 0) {
            issues.push(
              error(
                `decal #${index} field '${prop}' must be a non-empty string.`,
                `decals[${index}].${prop}`,
              ),
            );
          }
        }
        validateNamespaced(entry, "decals", index);
        if (typeof entry["file"] === "string" && !PNG_PATTERN.test(entry["file"])) {
          issues.push(
            error(`decal #${index} field 'file' must end with .png.`, `decals[${index}].file`),
          );
        }
        for (const prop of ["normal", "orm", "emission"]) {
          const value = entry[prop];
          if (value === undefined) continue;
          if (typeof value !== "string" || !PNG_PATTERN.test(value)) {
            issues.push(
              error(
                `decal #${index} field '${prop}' must be a string ending with .png.`,
                `decals[${index}].${prop}`,
              ),
            );
          }
        }
        const size = entry["size"];
        if (
          size !== undefined &&
          (!Array.isArray(size) ||
            size.length !== 3 ||
            !size.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0))
        ) {
          issues.push(
            error(
              `decal #${index} field 'size' must be an array of 3 positive numbers.`,
              `decals[${index}].size`,
            ),
          );
        }
        if (entry["unlit"] !== undefined && typeof entry["unlit"] !== "boolean") {
          issues.push(
            error(`decal #${index} field 'unlit' must be a boolean.`, `decals[${index}].unlit`),
          );
        }
      });
    }
  }

  return { valid: issues.filter((i) => i.severity === "error").length === 0, issues };
}

/**
 * Locates `kit.json` inside a source (at its root or in the shallowest single folder) and
 * returns the relative directory containing it plus the manifest's relative path.
 */
export async function findKitManifestDir(
  source: IAssetSource,
): Promise<{ dir: string; manifestPath: string } | null> {
  const files = await source.list();
  if (files.includes("kit.json")) {
    return { dir: "", manifestPath: "kit.json" };
  }
  const candidates = files
    .filter((f) => f.endsWith("/kit.json"))
    .sort((a, b) => a.split("/").length - b.split("/").length);
  const shallowest = candidates[0];
  if (!shallowest) return null;
  return {
    dir: shallowest.slice(0, -"kit.json".length).replace(/\/$/, ""),
    manifestPath: shallowest,
  };
}

/** Full import validation: strict structure + tolerant referenced-file existence warnings. */
export async function validateKitManifest(source: IAssetSource): Promise<{
  report: ValidationReport;
  manifest: Record<string, unknown> | null;
  dir: string;
}> {
  const found = await findKitManifestDir(source);
  if (!found) {
    return {
      report: {
        valid: false,
        issues: [error("No kit.json manifest found at the root or one folder deep.")],
      },
      manifest: null,
      dir: "",
    };
  }
  const { dir, manifestPath } = found;
  const parsed: unknown = await source.readJson(manifestPath);
  const report = validateKitManifestStructure(parsed);
  if (!report.valid || !isRecord(parsed)) {
    return { report, manifest: isRecord(parsed) ? parsed : null, dir };
  }

  const prefix = (path: string): string => (dir ? `${dir}/${path}` : path);
  const warns: ValidationIssue[] = [];

  // Tolerant existence checks for every referenced file.
  if (Array.isArray(parsed["items"])) {
    for (const [i, item] of (parsed["items"] as unknown[]).entries()) {
      if (!isRecord(item)) continue;
      for (const field of ["path", "preview", "meta"]) {
        const value = item[field];
        if (typeof value === "string" && !(await source.has(prefix(value as string)))) {
          warns.push(
            warning(
              `item #${i}: referenced file '${String(value)}' is missing.`,
              `items[${i}].${field}`,
            ),
          );
        }
      }
    }
  }
  if (Array.isArray(parsed["textures"])) {
    for (const [i, tex] of (parsed["textures"] as unknown[]).entries()) {
      if (!isRecord(tex)) continue;
      const slug = typeof tex["id"] === "string" ? String(tex["id"]).split("/").pop() : undefined;
      const maps = Array.isArray(tex["maps"]) ? (tex["maps"] as unknown[]) : [];
      for (const [m, map] of maps.entries()) {
        if (typeof map === "string" && slug) {
          const path = prefix(`textures/${slug}/${map}`);
          if (!(await source.has(path))) {
            warns.push(
              warning(
                `texture #${i}: referenced map '${String(map)}' is missing (${path}).`,
                `textures[${i}].maps[${m}]`,
              ),
            );
          }
        }
      }
    }
  }
  if (Array.isArray(parsed["decals"])) {
    for (const [i, decal] of (parsed["decals"] as unknown[]).entries()) {
      if (!isRecord(decal)) continue;
      for (const prop of ["file", "normal", "orm", "emission"]) {
        const file = decal[prop];
        if (typeof file !== "string") continue;
        const path = prefix(`decals/${file}`);
        if (!(await source.has(path))) {
          warns.push(
            warning(
              `decal #${i}: referenced ${prop} '${file}' is missing (${path}).`,
              `decals[${i}].${prop}`,
            ),
          );
        }
      }
    }
  }

  report.issues.push(...warns);
  return { report, manifest: parsed, dir };
}
