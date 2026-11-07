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
import { globToRegExp } from "../common/io/globPattern.js";
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

/** Directory names never descended into when listing a kit folder (vendored / VCS trees). */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(["node_modules", ".git"]);

/**
 * Node-only `IAssetSource` over a local directory tree. Uses a lazy dynamic
 * `import("node:fs/promises")` so browser bundles never load a Node builtin; it only
 * runs when this factory is called.
 *
 * Lazy by design: only the relative file NAMES are listed (once, on first `list`/`has`);
 * file contents are read from disk on demand per `read*`, so `swm kit validate .` on a big
 * tree never holds the tree in RAM. `node_modules` and `.git` are skipped, symlinked
 * directories are not followed (no cycles, no `EISDIR`), and every access is confined to
 * `rootPath`.
 */
export async function createNodeDirectoryAssetSource(rootPath: string): Promise<IAssetSource> {
  const fs = await import("node:fs/promises");
  const nodePath = await import("node:path");
  const root = nodePath.resolve(rootPath);
  let names: Set<string> | undefined;

  const walk = async (dir: string, out: Set<string>): Promise<void> => {
    for (const dirent of await fs.readdir(dir, { withFileTypes: true })) {
      const full = nodePath.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(dirent.name)) await walk(full, out);
      } else if (dirent.isFile()) {
        out.add(nodePath.relative(root, full).split(nodePath.sep).join("/"));
      } else if (dirent.isSymbolicLink()) {
        const target = await fs.stat(full).catch(() => undefined);
        if (target?.isFile()) out.add(nodePath.relative(root, full).split(nodePath.sep).join("/"));
      }
    }
  };
  const listAll = async (): Promise<Set<string>> => {
    if (!names) {
      const out = new Set<string>();
      await walk(root, out);
      names = out;
    }
    return names;
  };
  /** Absolute path of `rel` inside the root, or undefined when it is not a listed file. */
  const resolveListed = async (rel: string): Promise<string | undefined> => {
    if (!(await listAll()).has(rel)) return undefined;
    const full = nodePath.resolve(root, rel);
    return full.startsWith(root + nodePath.sep) ? full : undefined;
  };
  const readBytes = async (path: string): Promise<Uint8Array> => {
    const full = await resolveListed(path);
    if (!full) throw new Error(`[NodeDirectoryAssetSource] File not found: ${path}`);
    return fs.readFile(full);
  };

  return {
    id: `node-dir:${rootPath}`,
    name: `Directory ${rootPath}`,
    async list(pattern?: string): Promise<string[]> {
      const all = Array.from(await listAll());
      if (!pattern) return all;
      const regex = globToRegExp(pattern);
      return all.filter((p) => regex.test(p));
    },
    async has(path: string): Promise<boolean> {
      return (await listAll()).has(path);
    },
    read: readBytes,
    async readText(path: string): Promise<string> {
      return new TextDecoder("utf-8").decode(await readBytes(path));
    },
    async readJson<T = unknown>(path: string): Promise<T> {
      return JSON.parse(new TextDecoder("utf-8").decode(await readBytes(path))) as T;
    },
    toFetch(): (url: string, init?: RequestInit) => Promise<Response> {
      return async (url: string): Promise<Response> => {
        const notFound = (): Response =>
          new Response("Not found", { status: 404, statusText: "Not Found" });
        let rel = url.split("?")[0]!;
        try {
          rel = decodeURIComponent(rel);
        } catch {
          return new Response("Bad request", { status: 400, statusText: "Bad Request" });
        }
        const full = await resolveListed(rel.startsWith("/") ? rel.slice(1) : rel);
        if (!full) return notFound();
        return new Response(new Uint8Array(await fs.readFile(full)), {
          status: 200,
          statusText: "OK",
        });
      };
    },
    dispose(): void {
      names = undefined;
    },
  };
}
