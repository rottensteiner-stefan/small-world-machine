/** An SVG document with an explicit pixel size and a viewBox, ready for rasterising at any size. */
export interface NormalizedSvg {
  /** SVG source with explicit `width`/`height` (px), a `viewBox` and an `xmlns` declaration. */
  text: string;
  /** Pixel width the SVG renders at. */
  width: number;
  /** Pixel height the SVG renders at. */
  height: number;
}

/** Size browsers assume for an SVG without any width, height or viewBox. */
const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 150;
const MAX_LONG_EDGE = 8192;

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

const UNIT_TO_PX: Readonly<Record<string, number>> = {
  "": 1,
  px: 1,
  pt: 96 / 72,
  pc: 16,
  mm: 96 / 25.4,
  cm: 96 / 2.54,
  in: 96,
};

/** Matches the opening tag of the root `<svg>` element, tolerating `>` inside quoted values. */
const ROOT_TAG = /<svg\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i;
const ATTRIBUTE = /\s([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const SIZE_ATTRIBUTES = /\s(?:width|height|viewBox)\s*=\s*(?:"[^"]*"|'[^']*')/gi;

interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Parses an SVG length such as `24`, `24px`, `2cm`. Returns undefined for `%`, `em` and invalid values. */
function parseLength(value: string | undefined): number | undefined {
  if (undefined === value) return undefined;
  const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z%]*)\s*$/i.exec(value);
  if (null === match) return undefined;
  const factor = UNIT_TO_PX[(match[2] ?? "").toLowerCase()];
  if (undefined === factor) return undefined;
  const px = Number.parseFloat(match[1] ?? "") * factor;
  return Number.isFinite(px) && 0 < px ? px : undefined;
}

function parseViewBox(value: string | undefined): ViewBox | undefined {
  if (undefined === value) return undefined;
  const parts = value
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (4 !== parts.length || parts.some((p) => !Number.isFinite(p))) return undefined;
  const [x, y, width, height] = parts as [number, number, number, number];
  return 0 < width && 0 < height ? { x, y, width, height } : undefined;
}

function readAttributes(attributeText: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of attributeText.matchAll(ATTRIBUTE)) {
    attributes.set((match[1] ?? "").toLowerCase(), match[2] ?? match[3] ?? "");
  }
  return attributes;
}

/**
 * Gives an SVG an explicit pixel size so that consumers (canvas, `<img>`, texture tools) get a
 * predictable bitmap size instead of the browser default (300x150) or a tiny icon size.
 *
 * The intrinsic size comes from `width`/`height` (px, pt, mm, cm, in) or the `viewBox` aspect ratio.
 * The result is scaled so its longer edge equals `targetLongEdge` (vector content stays crisp);
 * `targetLongEdge` of 0 keeps the intrinsic size. Missing `xmlns` declarations are added, because an
 * SVG without them does not load as an image.
 *
 * @throws Error if the source contains no root `<svg>` element.
 */
export function normalizeSvg(source: string, targetLongEdge = 1024): NormalizedSvg {
  const root = ROOT_TAG.exec(source);
  if (null === root || undefined === root[1]) {
    throw new Error("Kein gültiges SVG: Wurzelelement <svg> nicht gefunden.");
  }

  const rawAttributes = root[1];
  const attributes = readAttributes(rawAttributes);
  const viewBox = parseViewBox(attributes.get("viewbox"));
  const declaredWidth = parseLength(attributes.get("width"));
  const declaredHeight = parseLength(attributes.get("height"));

  let intrinsicWidth: number;
  let intrinsicHeight: number;
  if (undefined !== declaredWidth && undefined !== declaredHeight) {
    intrinsicWidth = declaredWidth;
    intrinsicHeight = declaredHeight;
  } else if (undefined !== viewBox) {
    const aspect = viewBox.width / viewBox.height;
    if (undefined !== declaredWidth) {
      intrinsicWidth = declaredWidth;
      intrinsicHeight = declaredWidth / aspect;
    } else if (undefined !== declaredHeight) {
      intrinsicHeight = declaredHeight;
      intrinsicWidth = declaredHeight * aspect;
    } else {
      intrinsicWidth = viewBox.width;
      intrinsicHeight = viewBox.height;
    }
  } else {
    intrinsicWidth = declaredWidth ?? DEFAULT_WIDTH;
    intrinsicHeight = declaredHeight ?? DEFAULT_HEIGHT;
  }

  const longEdge = Math.max(intrinsicWidth, intrinsicHeight);
  const wantedLongEdge = 0 < targetLongEdge ? targetLongEdge : longEdge;
  const scale = Math.min(wantedLongEdge, MAX_LONG_EDGE) / longEdge;
  const width = Math.max(1, Math.round(intrinsicWidth * scale));
  const height = Math.max(1, Math.round(intrinsicHeight * scale));

  const box = viewBox ?? { x: 0, y: 0, width: intrinsicWidth, height: intrinsicHeight };
  const remaining = rawAttributes.replace(SIZE_ATTRIBUTES, "");
  const namespaces =
    (attributes.has("xmlns") ? "" : ` xmlns="${SVG_NS}"`) +
    (/\sxlink:/i.test(source) && !attributes.has("xmlns:xlink")
      ? ` xmlns:xlink="${XLINK_NS}"`
      : "");
  const openingTag = `<svg${namespaces} width="${width}" height="${height}" viewBox="${box.x} ${box.y} ${box.width} ${box.height}"${remaining}>`;

  return {
    text: source.slice(0, root.index) + openingTag + source.slice(root.index + root[0].length),
    width,
    height,
  };
}
