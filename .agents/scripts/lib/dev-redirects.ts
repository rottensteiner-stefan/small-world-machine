import fs from "fs";
import path from "path";

const SHOWCASES_PATHS = new Set([
  "/apps/showcases",
  "/apps/showcases/",
  "/apps/showcases/index.html",
]);

/**
 * `/apps/showcases[/[index.html]]` -> the launcher root with the Showcases tab pre-selected.
 * Returns the redirect target (query string merged), or null when the path is not a showcases URL.
 */
export function showcasesRedirectTarget(
  pathname: string,
  search: string | undefined,
): string | null {
  if (!SHOWCASES_PATHS.has(pathname)) {
    return null;
  }
  const query = search ? "&" + (search.startsWith("?") ? search.slice(1) : search) : "";
  return "/?filter=showcases" + query;
}

/** True when `candidate` is `root` itself or lies below it (after normalisation). */
export function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Extensionless request path that names a directory containing an index.html -> the same URL with
 * a trailing slash (so relative asset URLs resolve). Malformed percent escapes and paths that
 * escape the search roots yield null instead of throwing / probing the filesystem.
 */
export function directoryRedirectTarget(
  root: string,
  pathname: string,
  search: string | undefined,
): string | null {
  if (pathname.endsWith("/")) {
    return null;
  }
  let cleanPath: string;
  try {
    cleanPath = decodeURIComponent(pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }
  const searchRoots = [root, path.resolve(root, "public")];
  for (const searchRoot of searchRoots) {
    const candidate = path.resolve(searchRoot, cleanPath);
    if (!isInsideRoot(searchRoot, candidate)) {
      continue;
    }
    try {
      if (
        fs.statSync(candidate).isDirectory() &&
        fs.existsSync(path.join(candidate, "index.html"))
      ) {
        return pathname + "/" + (search ? "?" + search : "");
      }
    } catch {
      // Missing path or unreadable entry: not a directory redirect.
    }
  }
  return null;
}

export interface ShowcaseLayout {
  /** The full `<showcase-layout ...></showcase-layout>` source text. */
  tag: string;
  title: string;
  subtitle: string;
  /** Previous stop of the curated tour (relative URL), drives the in-scene ◀ button. */
  prev: string | undefined;
  /** Next stop of the curated tour (relative URL), drives the in-scene ▶ button. */
  next: string | undefined;
}

/**
 * Parses the `<showcase-layout>` placeholder of a showcase index.html. The subtitle is the element
 * body (plain HTML, no base64). Attribute order is free and `prev`/`next` are optional (the
 * placeholder only needs title), so a showcase that forgets one still gets its header and footer
 * instead of an unknown element.
 */
export function parseShowcaseLayout(html: string): ShowcaseLayout | null {
  const match = html.match(/<showcase-layout\b\s*([^>]*?)\s*>\s*([\s\S]*?)\s*<\/showcase-layout>/i);
  if (!match) {
    return null;
  }
  const attributes = new Map<string, string>();
  for (const attribute of (match[1] ?? "").matchAll(/([\w-]+)="([^"]*)"/g)) {
    attributes.set(attribute[1] as string, attribute[2] as string);
  }
  const title = attributes.get("title");
  if (title === undefined) {
    return null;
  }
  return {
    tag: match[0],
    title,
    subtitle: match[2] ?? "",
    prev: attributes.get("prev"),
    next: attributes.get("next"),
  };
}

/**
 * Vite build inputs for every numbered showcase folder (`apps/showcases/<n>/index.html`), so a new
 * showcase needs no hand-kept registry entry.
 */
export function showcaseInputs(root: string): Record<string, string> {
  const dir = path.join(root, "apps/showcases");
  const inputs: Record<string, string> = {};
  for (const name of fs.readdirSync(dir)) {
    const index = path.join(dir, name, "index.html");
    if (/^\d+$/.test(name) && fs.existsSync(index)) {
      inputs[`showcase${name}`] = index;
    }
  }
  return inputs;
}
