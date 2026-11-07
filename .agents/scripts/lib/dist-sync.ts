import fs from "fs";
import path from "path";

/**
 * Delete-semantics for the incremental `dist/` sync (`emptyOutDir: false` is deliberate: wiping
 * dist would re-copy ~1.5 GB of binaries on every build).
 */

/** Remove everything under `dest` that no longer exists under `src` (mirror prune, recursive).
 *  Only call for directories that are pure copies of `src` (no bundler output inside).
 *  Returns removed paths. Missing `dest` is a no-op; missing `src` prunes the whole `dest`. */
export function pruneStaleEntries(src: string, dest: string): string[] {
  const removed: string[] = [];
  if (!fs.existsSync(dest)) return removed;
  if (!fs.existsSync(src)) {
    fs.rmSync(dest, { recursive: true, force: true });
    return [dest];
  }
  const walk = (s: string, d: string): void => {
    for (const child of fs.readdirSync(d)) {
      const sc = path.join(s, child);
      const dc = path.join(d, child);
      if (!fs.existsSync(sc)) {
        fs.rmSync(dc, { recursive: true, force: true });
        removed.push(dc);
      } else if (fs.statSync(dc).isDirectory() && fs.statSync(sc).isDirectory()) {
        walk(sc, dc);
      }
    }
  };
  walk(src, dest);
  return removed;
}

/** Remove direct-child files of `dir` with the given extension (e.g. bundler-emitted `.html`
 *  entry pages that are regenerated each build, so removed entries do not linger). */
export function removeFilesWithExtension(dir: string, ext: string): string[] {
  const removed: string[] = [];
  if (!fs.existsSync(dir)) return removed;
  for (const child of fs.readdirSync(dir)) {
    const p = path.join(dir, child);
    if (child.endsWith(ext) && fs.statSync(p).isFile()) {
      fs.rmSync(p, { force: true });
      removed.push(p);
    }
  }
  return removed;
}
