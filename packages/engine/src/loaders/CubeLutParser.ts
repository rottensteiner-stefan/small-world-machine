import { Lut3D } from "../core/textures/Lut3D.js";

/**
 * Result of parsing a .cube LUT file.
 */
export interface ParsedCubeLut {
  lut: Lut3D;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
}

/**
 * Parser for Adobe / DaVinci .cube 3D LUT files.
 * Follows the Adobe Cube Color Lookup Table Specification.
 */
export class CubeLutParser {
  /**
   * Parses the text contents of a .cube file into a {@link Lut3D}.
   * @param text The .cube file content string.
   * @returns The parsed Lut3D.
   */
  public static parse(text: string): Lut3D {
    const parsed = this.parseDetailed(text);
    return parsed.lut;
  }

  /**
   * Parses the text contents of a .cube file, returning the {@link Lut3D} along with domain bounds.
   * @param text The .cube file content string.
   */
  public static parseDetailed(text: string): ParsedCubeLut {
    const lines = text.split(/\r?\n/);
    let title: string | undefined;
    let size: number | undefined;
    const domainMin: [number, number, number] = [0.0, 0.0, 0.0];
    const domainMax: [number, number, number] = [1.0, 1.0, 1.0];

    let data: Float32Array | undefined;
    let readCount = 0;
    let expectedCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i]!;
      const trimmed = rawLine.trim();

      // Skip comments and empty lines
      if (trimmed.length === 0 || trimmed.startsWith("#")) {
        continue;
      }

      // Handle keywords before data reading
      if (data === undefined) {
        const upper = trimmed.toUpperCase();
        if (upper.startsWith("TITLE")) {
          const match = trimmed.match(/^TITLE\s+"?([^"]+)"?/i);
          if (match) {
            title = match[1];
          }
          continue;
        }

        if (upper.startsWith("LUT_3D_SIZE")) {
          const parts = trimmed.split(/\s+/);
          const parsedSize = parseInt(parts[1] ?? "", 10);
          if (isNaN(parsedSize) || parsedSize < 2) {
            throw new Error(`CubeLutParser: invalid LUT_3D_SIZE '${parts[1]}' at line ${i + 1}`);
          }
          size = parsedSize;
          expectedCount = size * size * size;
          data = new Float32Array(expectedCount * 4);
          continue;
        }

        if (upper.startsWith("LUT_1D_SIZE")) {
          throw new Error(
            `CubeLutParser: 1D LUTs (LUT_1D_SIZE) are not supported at line ${i + 1}; expected LUT_3D_SIZE`,
          );
        }

        if (upper.startsWith("DOMAIN_MIN")) {
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 4) {
            domainMin[0] = parseFloat(parts[1]!);
            domainMin[1] = parseFloat(parts[2]!);
            domainMin[2] = parseFloat(parts[3]!);
          }
          continue;
        }

        if (upper.startsWith("DOMAIN_MAX")) {
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 4) {
            domainMax[0] = parseFloat(parts[1]!);
            domainMax[1] = parseFloat(parts[2]!);
            domainMax[2] = parseFloat(parts[3]!);
          }
          continue;
        }
      }

      // If we reach here and data is defined, it must be an RGB table entry
      if (data !== undefined) {
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 3) {
          const r = parseFloat(parts[0]!);
          const g = parseFloat(parts[1]!);
          const b = parseFloat(parts[2]!);

          if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
            if (readCount < expectedCount) {
              const idx = readCount * 4;
              data[idx] = r;
              data[idx + 1] = g;
              data[idx + 2] = b;
              data[idx + 3] = 1.0;
              readCount++;
            }
          }
        }
      }
    }

    if (size === undefined || data === undefined) {
      throw new Error("CubeLutParser: missing LUT_3D_SIZE header tag in .cube file");
    }

    if (readCount !== expectedCount) {
      throw new Error(
        `CubeLutParser: truncated .cube data -- expected ${expectedCount} entries for size ${size}^3, but read ${readCount}`,
      );
    }

    const lut = new Lut3D(data, size, { title });
    return { lut, domainMin, domainMax };
  }
}
