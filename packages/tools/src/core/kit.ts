/**
 * Headless kit validation/inspection surface, strictly wrapping the existing pure
 * `KitManifestValidator` (`common/io/KitManifestValidator.ts`). Operates either on an
 * `IAssetSource` (any DOM-free source) or on raw ZIP bytes via `ZipAssetSource`; a Node
 * directory walk adapter is provided for the future `swm kit` commands. No DOM anywhere.
 */

import {
  validateKitManifest,
  validateKitManifestStructure,
} from "../common/io/KitManifestValidator.js";
import { ZipAssetSource } from "../common/io/sources/ZipAssetSource.js";
import type { IAssetSource, ValidationReport } from "../common/io/types.js";

export interface KitValidationResult {
  report: ValidationReport;
  manifest: Record<string, unknown> | null;
  dir: string;
}

/** Validates parsed `kit.json` structure in isolation (no file system involved). */
export function validateKitStructure(json: unknown): ValidationReport {
  return validateKitManifestStructure(json);
}

/** Full manifest validation against any `IAssetSource` (structure + referenced files). */
export function validateKitSource(source: IAssetSource): Promise<KitValidationResult> {
  return validateKitManifest(source);
}

/** Validation of raw ZIP bytes: unpacked with Zip-Slip/size limits, then validated. */
export async function validateKitZip(bytes: Uint8Array): Promise<KitValidationResult> {
  const source = await ZipAssetSource.fromBytes(bytes);
  try {
    return await validateKitManifest(source);
  } finally {
    source.dispose();
  }
}

/**
 * Node-only `IAssetSource` over a local directory tree. Uses a lazy dynamic
 * `import("node:fs/promises")` so browser bundles never load a Node builtin; it only
 * runs when this factory is called.
 */
export async function createNodeDirectoryAssetSource(rootPath: string): Promise<IAssetSource> {
  const fs = await import("node:fs/promises");
  const nodePath = await import("node:path");
  const files = new Map<string, Uint8Array>();

  const walk = async (dir: string): Promise<void> => {
    for (const dirent of await fs.readdir(dir, { withFileTypes: true })) {
      const full = nodePath.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        await walk(full);
      } else {
        const rel = nodePath.relative(rootPath, full).split(nodePath.sep).join("/");
        files.set(rel, await fs.readFile(full));
      }
    }
  };
  await walk(rootPath);

  return {
    id: `node-dir:${rootPath}`,
    name: `Directory ${rootPath}`,
    async list(pattern?: string): Promise<string[]> {
      const all = Array.from(files.keys());
      if (!pattern) return all;
      const regex = new RegExp(pattern.replace(/\*/g, ".*"));
      return all.filter((p) => regex.test(p));
    },
    async has(path: string): Promise<boolean> {
      return files.has(path);
    },
    async read(path: string): Promise<Uint8Array> {
      const data = files.get(path);
      if (!data) throw new Error(`[NodeDirectoryAssetSource] File not found: ${path}`);
      return data;
    },
    async readText(path: string): Promise<string> {
      const data = files.get(path);
      if (!data) throw new Error(`[NodeDirectoryAssetSource] File not found: ${path}`);
      return new TextDecoder("utf-8").decode(data);
    },
    async readJson<T = unknown>(path: string): Promise<T> {
      const data = files.get(path);
      if (!data) throw new Error(`[NodeDirectoryAssetSource] File not found: ${path}`);
      return JSON.parse(new TextDecoder("utf-8").decode(data)) as T;
    },
    toFetch(): (url: string, init?: RequestInit) => Promise<Response> {
      return async (url: string): Promise<Response> => {
        const rel = decodeURIComponent(url.split("?")[0]!);
        const data = files.get(rel.startsWith("/") ? rel.slice(1) : rel);
        if (!data) {
          return new Response("Not found", { status: 404, statusText: "Not Found" });
        }
        return new Response(new Uint8Array(data), { status: 200, statusText: "OK" });
      };
    },
    dispose(): void {
      files.clear();
    },
  };
}
