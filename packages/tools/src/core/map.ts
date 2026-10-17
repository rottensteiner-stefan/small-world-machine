/**
 * Headless map-format conversion (`MapDefConverter`), extracted from
 * `MapGenerator.ts`. Pure ASCII<->grid helpers (`getMapString`/`loadMapString`,
 * MapGenerator.ts:466-493) plus the image->ASCII quantize loop that used to live in
 * `MapGenerator.loadFromImage` (MapGenerator.ts:624-674) with a canvas as input.
 *
 * Here the quantize input is a raw RGBA buffer (`RgbaImage`), never a canvas; scaling
 * stays a browser concern (the panel keeps `drawImage` for that step only and feeds
 * the resulting RGBA into `quantizeImageToGrid` -- resolution (b) of Finding F1).
 */

import type { RgbaImage } from "./RasterIO.js";

export interface MapLegendEntry {
  color: string;
  /** Optional human-readable label (tool palettes carry it; not used by quantize). */
  label?: string;
}

/**
 * ASCII legend for map quantization: the record key is the draw character, the entry
 * carries the hex color. Structurally compatible with the MapGenerator tool palette
 * (`Record<string, { color, label }>`).
 */
export type MapLegend = Record<string, MapLegendEntry>;

/** Serializes a grid back to an ASCII map string (rows joined by newlines). */
export function mapToString(grid: string[][]): string {
  return grid.map((row) => row.join("")).join("\n");
}

/**
 * Parses an ASCII map string into a grid. Preserves the exact semantics of the
 * original tool implementation: empty strings yield an empty grid, embedded literal
 * "\\n" sequences are normalized, every line is trimmed, and all rows are padded to
 * the width of the first line.
 */
export function stringToMap(mapStr: string): string[][] {
  if (!mapStr.trim()) return [];
  const normalized =
    mapStr.includes("\\n") && !mapStr.includes("\n") ? mapStr.replace(/\\n/g, "\n") : mapStr;
  const lines = normalized
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim());
  if (lines.length === 0) return [];

  const width = lines[0]!.length;
  const grid: string[][] = [];
  for (let y = 0; y < lines.length; y++) {
    const row = lines[y]!.split("");
    while (row.length < width) row.push(".");
    grid.push(row);
  }
  return grid;
}

/**
 * Ports the palette-quantize loop of `MapGenerator.loadFromImage` onto a RGBA buffer.
 * `legend` maps draw chars to hex colors exactly like the tool palette; the entry whose
 * char equals `emptyChar` is skipped and transparent/bright pixels resolve to it.
 */
export function quantizeImageToGrid(
  image: RgbaImage,
  legend: MapLegend,
  emptyChar = ".",
): string[][] {
  const targetW = image.width;
  const targetH = image.height;
  const data = image.data;

  const paletteRgb: Array<{ char: string; r: number; g: number; b: number }> = [];
  for (const [char, meta] of Object.entries(legend)) {
    if (char === emptyChar) continue;
    const hex = meta.color.replace("#", "");
    let r = 0;
    let g = 0;
    let b = 0;
    if (hex.length === 6) {
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    }
    paletteRgb.push({ char, r, g, b });
  }

  const rows: string[][] = [];
  for (let y = 0; y < targetH; y++) {
    const row: string[] = [];
    for (let x = 0; x < targetW; x++) {
      const idx = (y * targetW + x) * 4;
      const r = data[idx] ?? 0;
      const g = data[idx + 1] ?? 0;
      const b = data[idx + 2] ?? 0;
      const a = data[idx + 3] ?? 0;

      if (a < 64) {
        row.push(emptyChar);
        continue;
      }

      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      let bestChar = lum < 120 ? "W" : emptyChar;
      let bestDist = Infinity;
      for (const p of paletteRgb) {
        const dr = r - p.r;
        const dg = g - p.g;
        const db = b - p.b;
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          bestChar = p.char;
        }
      }

      if (lum > 200 && bestDist > 2000) {
        row.push(emptyChar);
      } else {
        row.push(bestChar);
      }
    }
    rows.push(row);
  }
  return rows;
}
