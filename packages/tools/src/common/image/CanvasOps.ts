import { autocropRgba, cropRgba, flipRgba, padToPowerOfTwoRgba } from "../../core/sprite.js";

export interface AdjustOptions {
  brightness?: number; // Multiplier, 1.0 is default (e.g. 1.2 = +20%)
  contrast?: number; // Multiplier, 1.0 is default (e.g. 1.2 = +20%)
  saturation?: number; // Multiplier, 1.0 is default (0.0 = grayscale, 1.5 = saturated)
  hue?: number; // Degrees shift, 0-360 (default 0)
  gamma?: number; // Gamma curve, 1.0 is default
}

export function makeImageData(width: number, height: number, data?: Uint8ClampedArray): ImageData {
  if (typeof ImageData !== "undefined") {
    return data
      ? new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height)
      : new ImageData(width, height);
  }
  return {
    width,
    height,
    data: data || new Uint8ClampedArray(width * height * 4),
    colorSpace: "srgb",
  } as unknown as ImageData;
}

export function hexToRgb(hex: string): [number, number, number] {
  let clean = hex.replace(/^#/, "");
  if (clean.length === 3) {
    clean = clean
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const val = parseInt(clean, 16);
  if (isNaN(val)) return [0, 0, 0];
  return [(val >> 16) & 255, (val >> 8) & 255, val & 255];
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case rNorm:
        h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0);
        break;
      case gNorm:
        h = (bNorm - rNorm) / d + 2;
        break;
      case bNorm:
        h = (rNorm - gNorm) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h * 360, s, v];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hPrime = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  let r = 0,
    g = 0,
    b = 0;

  if (hPrime >= 0 && hPrime < 1) {
    r = c;
    g = x;
  } else if (hPrime >= 1 && hPrime < 2) {
    r = x;
    g = c;
  } else if (hPrime >= 2 && hPrime < 3) {
    g = c;
    b = x;
  } else if (hPrime >= 3 && hPrime < 4) {
    g = x;
    b = c;
  } else if (hPrime >= 4 && hPrime < 5) {
    r = x;
    b = c;
  } else if (hPrime >= 5 && hPrime < 6) {
    r = c;
    b = x;
  }

  const m = v - c;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * Crops an ImageData to the specified rectangle.
 * Pure implementation lives in `core/sprite.ts` (`cropRgba`).
 */
export function cropImage(src: ImageData, x: number, y: number, w: number, h: number): ImageData {
  const out = cropRgba({ width: src.width, height: src.height, data: src.data }, x, y, w, h);
  return makeImageData(out.width, out.height, out.data);
}

/**
 * Autocrops transparent padding around the image.
 */
export function autocropImage(src: ImageData, alphaThreshold = 10): ImageData {
  const out = autocropRgba(
    { width: src.width, height: src.height, data: src.data },
    alphaThreshold,
  );
  return makeImageData(out.width, out.height, out.data);
}

/**
 * Flips image horizontally and/or vertically.
 */
export function flipImage(src: ImageData, horizontal = true, vertical = false): ImageData {
  const out = flipRgba(
    { width: src.width, height: src.height, data: src.data },
    horizontal,
    vertical,
  );
  return makeImageData(out.width, out.height, out.data);
}

/**
 * Rotates image by 90, 180, or 270 degrees.
 */
export function rotateImage(src: ImageData, angleDeg: number): ImageData {
  const angle = ((angleDeg % 360) + 360) % 360;
  if (angle === 0) return makeImageData(src.width, src.height, new Uint8ClampedArray(src.data));

  const w = src.width;
  const h = src.height;
  const sData = src.data;

  if (angle === 180) {
    return flipImage(src, true, true);
  }

  const outW = h;
  const outH = w;
  const out = makeImageData(outW, outH);
  const dData = out.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sIdx = (y * w + x) * 4;
      let dX = 0;
      let dY = 0;
      if (angle === 90) {
        // Clockwise: (x, y) -> (h - 1 - y, x)
        dX = h - 1 - y;
        dY = x;
      } else if (angle === 270) {
        // Counter-clockwise: (x, y) -> (y, w - 1 - x)
        dX = y;
        dY = w - 1 - x;
      }
      const dIdx = (dY * outW + dX) * 4;
      dData[dIdx] = sData[sIdx]!;
      dData[dIdx + 1] = sData[sIdx + 1]!;
      dData[dIdx + 2] = sData[sIdx + 2]!;
      dData[dIdx + 3] = sData[sIdx + 3]!;
    }
  }
  return out;
}

/**
 * Scales image using crisp Nearest Neighbor (pixel art) or simple Bilinear sampling.
 */
export function scaleImage(src: ImageData, factor: number): ImageData {
  const safeFactor = Math.max(0.1, Math.min(16, factor));
  const outW = Math.max(1, Math.round(src.width * safeFactor));
  const outH = Math.max(1, Math.round(src.height * safeFactor));
  const out = makeImageData(outW, outH);
  const sData = src.data;
  const dData = out.data;
  const srcW = src.width;
  const srcH = src.height;

  for (let y = 0; y < outH; y++) {
    const srcY = Math.min(srcH - 1, Math.floor(y / safeFactor));
    for (let x = 0; x < outW; x++) {
      const srcX = Math.min(srcW - 1, Math.floor(x / safeFactor));
      const sIdx = (srcY * srcW + srcX) * 4;
      const dIdx = (y * outW + x) * 4;
      dData[dIdx] = sData[sIdx]!;
      dData[dIdx + 1] = sData[sIdx + 1]!;
      dData[dIdx + 2] = sData[sIdx + 2]!;
      dData[dIdx + 3] = sData[sIdx + 3]!;
    }
  }
  return out;
}

/**
 * Pads canvas to next Power-of-Two dimensions (e.g. 64, 128, 256, 512, 1024, 2048).
 * Pure implementation lives in `core/sprite.ts` (`padToPowerOfTwoRgba`).
 */
export function padToPowerOfTwo(src: ImageData): ImageData {
  const out = padToPowerOfTwoRgba({ width: src.width, height: src.height, data: src.data });
  return makeImageData(out.width, out.height, out.data);
}

/**
 * Replaces a source color with a target color within Euclidean RGB tolerance.
 */
export function recolorImage(
  src: ImageData,
  fromHex: string,
  toHex: string,
  tolerance = 35,
): ImageData {
  const [fromR, fromG, fromB] = hexToRgb(fromHex);
  const [toR, toG, toB] = hexToRgb(toHex);
  const out = makeImageData(src.width, src.height, new Uint8ClampedArray(src.data));
  const data = out.data;
  const tolSq = tolerance * tolerance;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const dr = data[i]! - fromR;
    const dg = data[i + 1]! - fromG;
    const db = data[i + 2]! - fromB;
    const distSq = dr * dr + dg * dg + db * db;
    if (distSq <= tolSq) {
      data[i] = toR;
      data[i + 1] = toG;
      data[i + 2] = toB;
    }
  }
  return out;
}

/**
 * Applies brightness, contrast, saturation, hue shift, and gamma adjustments.
 */
export function adjustImage(src: ImageData, opts: AdjustOptions): ImageData {
  const out = makeImageData(src.width, src.height, new Uint8ClampedArray(src.data));
  const data = out.data;
  const brightness = opts.brightness ?? 1.0;
  const contrast = opts.contrast ?? 1.0;
  const saturation = opts.saturation ?? 1.0;
  const hueShift = opts.hue ?? 0;
  const gamma = opts.gamma ?? 1.0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;

    let r = data[i]!;
    let g = data[i + 1]!;
    let b = data[i + 2]!;

    // Brightness
    if (brightness !== 1.0) {
      r *= brightness;
      g *= brightness;
      b *= brightness;
    }

    // Contrast
    if (contrast !== 1.0) {
      r = ((r / 255 - 0.5) * contrast + 0.5) * 255;
      g = ((g / 255 - 0.5) * contrast + 0.5) * 255;
      b = ((b / 255 - 0.5) * contrast + 0.5) * 255;
    }

    // Gamma
    if (gamma !== 1.0 && gamma > 0) {
      const invGamma = 1 / gamma;
      r = Math.pow(Math.max(0, r / 255), invGamma) * 255;
      g = Math.pow(Math.max(0, g / 255), invGamma) * 255;
      b = Math.pow(Math.max(0, b / 255), invGamma) * 255;
    }

    // Hue and Saturation
    if (saturation !== 1.0 || hueShift !== 0) {
      const [h, s, v] = rgbToHsv(
        Math.max(0, Math.min(255, r)),
        Math.max(0, Math.min(255, g)),
        Math.max(0, Math.min(255, b)),
      );
      const newH = (h + hueShift + 360) % 360;
      const newS = Math.max(0, Math.min(1, s * saturation));
      const [newR, newG, newB] = hsvToRgb(newH, newS, v);
      r = newR;
      g = newG;
      b = newB;
    }

    data[i] = Math.max(0, Math.min(255, Math.round(r)));
    data[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
    data[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
  }
  return out;
}

/**
 * Converts image to grayscale.
 */
export function grayscaleImage(src: ImageData): ImageData {
  const out = makeImageData(src.width, src.height, new Uint8ClampedArray(src.data));
  const data = out.data;
  for (let i = 0; i < data.length; i += 4) {
    const lum = Math.round(0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!);
    data[i] = lum;
    data[i + 1] = lum;
    data[i + 2] = lum;
  }
  return out;
}

/**
 * Inverts RGB colors (preserves alpha).
 */
export function invertImage(src: ImageData): ImageData {
  const out = makeImageData(src.width, src.height, new Uint8ClampedArray(src.data));
  const data = out.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i]!;
    data[i + 1] = 255 - data[i + 1]!;
    data[i + 2] = 255 - data[i + 2]!;
  }
  return out;
}

/**
 * Applies warm retro Sepia tone.
 */
export function sepiaImage(src: ImageData): ImageData {
  const out = makeImageData(src.width, src.height, new Uint8ClampedArray(src.data));
  const data = out.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    data[i] = Math.min(255, Math.round(0.393 * r + 0.769 * g + 0.189 * b));
    data[i + 1] = Math.min(255, Math.round(0.349 * r + 0.686 * g + 0.168 * b));
    data[i + 2] = Math.min(255, Math.round(0.272 * r + 0.534 * g + 0.131 * b));
  }
  return out;
}

/**
 * Reduces color palette (posterization) for retro 8-bit / 16-bit look.
 */
export function posterizeImage(src: ImageData, levels = 4): ImageData {
  const safeLevels = Math.max(2, Math.min(64, levels));
  const step = 255 / (safeLevels - 1);
  const out = makeImageData(src.width, src.height, new Uint8ClampedArray(src.data));
  const data = out.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.round(Math.round(data[i]! / step) * step);
    data[i + 1] = Math.round(Math.round(data[i + 1]! / step) * step);
    data[i + 2] = Math.round(Math.round(data[i + 2]! / step) * step);
  }
  return out;
}

/**
 * Thresholds image to 1-bit high-contrast black & white.
 */
export function thresholdImage(src: ImageData, threshold = 128): ImageData {
  const out = makeImageData(src.width, src.height, new Uint8ClampedArray(src.data));
  const data = out.data;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
    const val = lum >= threshold ? 255 : 0;
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
  }
  return out;
}

/**
 * Auto-levels histogram expansion (normalizes dynamic range).
 */
export function autoLevelsImage(src: ImageData): ImageData {
  const data = src.data;
  let minLum = 255;
  let maxLum = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const lum = Math.round(0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!);
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
  }

  if (maxLum <= minLum) return makeImageData(src.width, src.height, new Uint8ClampedArray(data));

  const out = makeImageData(src.width, src.height, new Uint8ClampedArray(data));
  const outData = out.data;
  const range = maxLum - minLum;

  for (let i = 0; i < outData.length; i += 4) {
    if (outData[i + 3] === 0) continue;
    outData[i] = Math.max(0, Math.min(255, Math.round(((outData[i]! - minLum) / range) * 255)));
    outData[i + 1] = Math.max(
      0,
      Math.min(255, Math.round(((outData[i + 1]! - minLum) / range) * 255)),
    );
    outData[i + 2] = Math.max(
      0,
      Math.min(255, Math.round(((outData[i + 2]! - minLum) / range) * 255)),
    );
  }
  return out;
}

/**
 * Adds a crisp pixel-art outline around non-transparent pixels.
 */
export function outlineImage(src: ImageData, colorHex = "#000000", thickness = 1): ImageData {
  const [outR, outG, outB] = hexToRgb(colorHex);
  const w = src.width;
  const h = src.height;
  const out = makeImageData(w, h, new Uint8ClampedArray(src.data));
  const sData = src.data;
  const dData = out.data;
  const rad = Math.max(1, Math.min(10, Math.round(thickness)));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      // If current pixel is already solid, keep it
      if (sData[idx + 3]! > 180) continue;

      // Check if any neighboring pixel within radius is solid
      let hasSolidNeighbor = false;
      for (let dy = -rad; dy <= rad && !hasSolidNeighbor; dy++) {
        for (let dx = -rad; dx <= rad && !hasSolidNeighbor; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (dx * dx + dy * dy > rad * rad) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const nIdx = (ny * w + nx) * 4;
            if (sData[nIdx + 3]! > 180) {
              hasSolidNeighbor = true;
            }
          }
        }
      }

      if (hasSolidNeighbor) {
        dData[idx] = outR;
        dData[idx + 1] = outG;
        dData[idx + 2] = outB;
        dData[idx + 3] = 255;
      }
    }
  }
  return out;
}

/**
 * Chromakeys (removes) a specific background color with tolerance.
 */
export function chromaKeyImage(src: ImageData, colorHex: string, tolerance = 35): ImageData {
  const [keyR, keyG, keyB] = hexToRgb(colorHex);
  const out = makeImageData(src.width, src.height, new Uint8ClampedArray(src.data));
  const data = out.data;
  const tolSq = tolerance * tolerance;

  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i]! - keyR;
    const dg = data[i + 1]! - keyG;
    const db = data[i + 2]! - keyB;
    if (dr * dr + dg * dg + db * db <= tolSq) {
      data[i + 3] = 0;
    }
  }
  return out;
}

/**
 * Removes isolated stray single pixels (noise cleaning).
 */
export function despeckleImage(src: ImageData, minNeighbors = 1): ImageData {
  const w = src.width;
  const h = src.height;
  const out = makeImageData(w, h, new Uint8ClampedArray(src.data));
  const sData = src.data;
  const dData = out.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (sData[idx + 3]! < 50) continue;

      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            if (sData[(ny * w + nx) * 4 + 3]! >= 50) {
              neighbors++;
            }
          }
        }
      }

      if (neighbors < minNeighbors) {
        dData[idx + 3] = 0;
      }
    }
  }
  return out;
}

/**
 * Generates an Emissive map isolating bright pixels.
 */
export function generateEmissiveMap(src: ImageData, threshold = 200): ImageData {
  const out = makeImageData(src.width, src.height);
  const sData = src.data;
  const dData = out.data;

  for (let i = 0; i < sData.length; i += 4) {
    if (sData[i + 3] === 0) {
      dData[i] = 0;
      dData[i + 1] = 0;
      dData[i + 2] = 0;
      dData[i + 3] = 255;
      continue;
    }
    const lum = 0.2126 * sData[i]! + 0.7152 * sData[i + 1]! + 0.0722 * sData[i + 2]!;
    if (lum >= threshold) {
      dData[i] = sData[i]!;
      dData[i + 1] = sData[i + 1]!;
      dData[i + 2] = sData[i + 2]!;
    } else {
      dData[i] = 0;
      dData[i + 1] = 0;
      dData[i + 2] = 0;
    }
    dData[i + 3] = 255;
  }
  return out;
}

/**
 * Generates a Specular/Roughness map.
 */
export function generateSpecularMap(src: ImageData, invert = false): ImageData {
  const out = makeImageData(src.width, src.height);
  const sData = src.data;
  const dData = out.data;

  for (let i = 0; i < sData.length; i += 4) {
    const lum = Math.round(0.2126 * sData[i]! + 0.7152 * sData[i + 1]! + 0.0722 * sData[i + 2]!);
    const val = invert ? 255 - lum : lum;
    dData[i] = val;
    dData[i + 1] = val;
    dData[i + 2] = val;
    dData[i + 3] = 255;
  }
  return out;
}

/**
 * Generates a Contact Ambient Occlusion map from the sprite silhouette.
 */
export function generateAoMap(src: ImageData, radius = 4): ImageData {
  const w = src.width;
  const h = src.height;
  const out = makeImageData(w, h);
  const sData = src.data;
  const dData = out.data;
  const rad = Math.max(1, Math.min(16, radius));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (sData[idx + 3] === 0) {
        dData[idx] = 255;
        dData[idx + 1] = 255;
        dData[idx + 2] = 255;
        dData[idx + 3] = 255;
        continue;
      }

      let total = 0;
      let solid = 0;
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (dx * dx + dy * dy > rad * rad) continue;
          const nx = x + dx;
          const ny = y + dy;
          total++;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            if (sData[(ny * w + nx) * 4 + 3]! > 100) {
              solid++;
            }
          }
        }
      }

      const occlusion = solid / total;
      const aoVal = Math.round((0.5 + 0.5 * occlusion) * 255);
      dData[idx] = aoVal;
      dData[idx + 1] = aoVal;
      dData[idx + 2] = aoVal;
      dData[idx + 3] = 255;
    }
  }
  return out;
}

export interface ParsedAiAction {
  type: string;
  label: string;
  icon: string;
  apply: (src: ImageData) =>
    | ImageData
    | {
        newWidth: number;
        newHeight: number;
        sliceCount?: number;
        isNormal?: boolean;
        isDepth?: boolean;
      };
}
