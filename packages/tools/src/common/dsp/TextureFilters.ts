import { NormalMapFormat } from "@small-world-machine/engine/enums/NormalMapFormat.js";

/**
 * WHY: the 4-neighbour Laplacian returns roughly trowel-scale values; this fixed gain lifts
 * crevice detail into a visible occlusion range instead of a flat ~0 response.
 */
const FINE_CREVICE_GAIN = 2.0;

/** In-place two-pass (horizontal + vertical) sliding-window box blur on RGBA pixel data, edge-clamped. */
export function fastBoxBlur(src: Uint8ClampedArray, w: number, h: number, r: number): void {
  if (r <= 0) return;

  const tmp = new Uint8ClampedArray(src.length);

  // Horizontal pass
  const valCount = r * 2 + 1;
  const invCount = 1 / valCount;

  for (let y = 0; y < h; y++) {
    let rSum = 0,
      gSum = 0,
      bSum = 0;
    const rowStart = y * w * 4;

    // Initial window sum
    for (let x = -r; x <= r; x++) {
      const cx = Math.max(0, Math.min(w - 1, x));
      const idx = rowStart + cx * 4;
      rSum += src[idx]!;
      gSum += src[idx + 1]!;
      bSum += src[idx + 2]!;
    }

    // Slid window
    for (let x = 0; x < w; x++) {
      const outIdx = rowStart + x * 4;
      tmp[outIdx] = Math.round(rSum * invCount);
      tmp[outIdx + 1] = Math.round(gSum * invCount);
      tmp[outIdx + 2] = Math.round(bSum * invCount);
      tmp[outIdx + 3] = src[outIdx + 3]!;

      // Outgoing pixel
      const outX = Math.max(0, x - r);
      const outPixelIdx = rowStart + outX * 4;
      rSum -= src[outPixelIdx]!;
      gSum -= src[outPixelIdx + 1]!;
      bSum -= src[outPixelIdx + 2]!;

      // Incoming pixel
      const inX = Math.min(w - 1, x + r + 1);
      const inPixelIdx = rowStart + inX * 4;
      rSum += src[inPixelIdx]!;
      gSum += src[inPixelIdx + 1]!;
      bSum += src[inPixelIdx + 2]!;
    }
  }

  // Vertical pass (applied on temp, saved to src)
  for (let x = 0; x < w; x++) {
    let rSum = 0,
      gSum = 0,
      bSum = 0;

    // Initial window sum
    for (let y = -r; y <= r; y++) {
      const cy = Math.max(0, Math.min(h - 1, y));
      const idx = (cy * w + x) * 4;
      rSum += tmp[idx]! || 0;
      gSum += tmp[idx + 1]! || 0;
      bSum += tmp[idx + 2]! || 0;
    }

    // Slid window
    for (let y = 0; y < h; y++) {
      const outIdx = (y * w + x) * 4;
      src[outIdx]! = Math.round(rSum * invCount);
      src[outIdx + 1]! = Math.round(gSum * invCount);
      src[outIdx + 2]! = Math.round(bSum * invCount);
      src[outIdx + 3] = tmp[outIdx + 3]!;

      // Outgoing pixel
      const outY = Math.max(0, y - r);
      const outPixelIdx = (outY * w + x) * 4;
      rSum -= tmp[outPixelIdx]! || 0;
      gSum -= tmp[outPixelIdx + 1]! || 0;
      bSum -= tmp[outPixelIdx + 2]! || 0;

      // Incoming pixel
      const inY = Math.min(h - 1, y + r + 1);
      const inPixelIdx = (inY * w + x) * 4;
      rSum += tmp[inPixelIdx]! || 0;
      gSum += tmp[inPixelIdx + 1]! || 0;
      bSum += tmp[inPixelIdx + 2]! || 0;
    }
  }
}

/** Applies a logistic-sigmoid contrast/threshold curve to a single normalized [0,1] value. */
export function sigmoidalContrast(x: number, contrast: number, threshold: number): number {
  if (contrast === 0) return x;
  const a = 1.0 / (1.0 + Math.exp(contrast * threshold));
  const b = 1.0 / (1.0 + Math.exp(-contrast * (1.0 - threshold)));
  const y = 1.0 / (1.0 + Math.exp(-contrast * (x - threshold)));
  return (y - a) / (b - a);
}

/** Clamped point-sample of a grayscale height map stored as RGBA (reads the red channel). */
function sampleClampedHeight(
  heightPixels: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
): number {
  const cx = Math.max(0, Math.min(w - 1, x));
  const cy = Math.max(0, Math.min(h - 1, y));
  return (heightPixels[(cy * w + cx) * 4]! || 0) / 255.0;
}

export interface HeightMapParams {
  blur: number;
  contrast: number;
  invert: boolean;
}

/** Grayscale conversion (luminance-weighted) with contrast, invert, and optional blur. */
export function generateHeightMap(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  { blur, contrast, invert }: HeightMapParams,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length);

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i] || 0;
    const g = pixels[i + 1] || 0;
    const b = pixels[i + 2] || 0;

    // Grayscale conversion (luminance weight)
    let gray = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;

    // Height Contrast
    gray = Math.max(0, Math.min(1, (gray - 0.5) * contrast + 0.5));

    // Height Invert
    if (invert) {
      gray = 1.0 - gray;
    }

    const gVal = Math.round(gray * 255);
    out[i] = gVal;
    out[i + 1] = gVal;
    out[i + 2] = gVal;
    out[i + 3] = 255;
  }

  if (blur > 0) {
    fastBoxBlur(out, w, h, blur);
  }

  return out;
}

export interface NormalMapParams {
  strength: number;
  format: NormalMapFormat;
  invertR: boolean;
}

/** Sobel-gradient normal map derived from a grayscale height map. */
export function generateNormalMap(
  heightPixels: Uint8ClampedArray,
  w: number,
  h: number,
  { strength, format, invertR }: NormalMapParams,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const getHeight = (x: number, y: number): number => sampleClampedHeight(heightPixels, w, h, x, y);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;

      // Sobel operator for derivatives
      const tl = getHeight(x - 1, y - 1);
      const t = getHeight(x, y - 1);
      const tr = getHeight(x + 1, y - 1);
      const l = getHeight(x - 1, y);
      const r = getHeight(x + 1, y);
      const bl = getHeight(x - 1, y + 1);
      const b = getHeight(x, y + 1);
      const br = getHeight(x + 1, y + 1);

      // Horizontal gradient
      let dx = tr + 2 * r + br - (tl + 2 * l + bl);
      // Vertical gradient
      let dy = bl + 2 * b + br - (tl + 2 * t + tr);

      // Inverts
      if (invertR) dx = -dx;
      if (format === NormalMapFormat.DIRECTX) dy = -dy; // DirectX expects -Y (inverted green)

      // Scaling normal vectors
      const nx = -dx * strength;
      const ny = -dy * strength;
      const nz = 1.0;

      // Normalize normal vector
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

      out[idx] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      out[idx + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      out[idx + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      out[idx + 3] = 255;
    }
  }

  return out;
}

export interface SpecularMapParams {
  contrast: number;
  threshold: number;
  invert: boolean;
}

/** Specular map via sigmoidal-contrast applied to height values. */
export function generateSpecularMap(
  heightPixels: Uint8ClampedArray,
  { contrast, threshold, invert }: SpecularMapParams,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(heightPixels.length);

  for (let i = 0; i < heightPixels.length; i += 4) {
    const heightNorm = (heightPixels[i]! || 0) / 255.0;
    let spec = sigmoidalContrast(heightNorm, contrast, threshold);

    if (invert) {
      spec = 1.0 - spec;
    }

    const sVal = Math.round(spec * 255);
    out[i] = sVal;
    out[i + 1] = sVal;
    out[i + 2] = sVal;
    out[i + 3] = 255;
  }

  return out;
}

export interface RoughnessMapParams {
  gamma: number;
  invert: boolean;
}

/** Roughness map: inverted specular with a gamma curve. */
export function generateRoughnessMap(
  specPixels: Uint8ClampedArray,
  { gamma, invert }: RoughnessMapParams,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(specPixels.length);

  for (let i = 0; i < specPixels.length; i += 4) {
    const specVal = (specPixels[i]! || 0) / 255.0;

    // Base roughness is inverted specular
    let rough = 1.0 - specVal;

    // Apply gamma curve
    rough = Math.pow(rough, 1.0 / gamma);

    if (invert) {
      rough = 1.0 - rough;
    }

    const rVal = Math.round(rough * 255);
    out[i] = rVal;
    out[i + 1] = rVal;
    out[i + 2] = rVal;
    out[i + 3] = 255;
  }

  return out;
}

export interface AOMapParams {
  soft: number;
  fine: number;
  level: number;
}

/** Ambient-occlusion map: soft macro shadow (blurred height) combined with fine crevice detection. */
export function generateAOMap(
  heightPixels: Uint8ClampedArray,
  w: number,
  h: number,
  { soft, fine, level }: AOMapParams,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(heightPixels.length);
  const getHeight = (x: number, y: number): number => sampleClampedHeight(heightPixels, w, h, x, y);

  // Duplicate height pixels to create soft shadows via blur
  const softHeightPixels = new Uint8ClampedArray(heightPixels);
  fastBoxBlur(softHeightPixels, w, h, soft);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;

      // Local detail crevice detection via a Laplacian-style edge kernel on height map
      // 4*center - sum of 4 neighbors
      const center = getHeight(x, y);
      const top = getHeight(x, y - 1);
      const bottom = getHeight(x, y + 1);
      const left = getHeight(x - 1, y);
      const right = getHeight(x + 1, y);

      // Positive value means center is a valley (dark crevice)
      const laplacian = (top + bottom + left + right) / 4.0 - center;
      const fineCrevice = Math.max(0, laplacian * FINE_CREVICE_GAIN);

      // Soft macro shadow (darker inside deeper valleys of soft height map)
      const softDepth = (softHeightPixels[idx]! || 0) / 255.0;
      const softShadow = Math.min(1.0, softDepth + level); // Shift level

      // Combine fine and soft AO
      let ao = softShadow * (1.0 - fineCrevice * fine);
      ao = Math.max(0, Math.min(1, ao));

      const aoVal = Math.round(ao * 255);
      out[idx] = aoVal;
      out[idx + 1] = aoVal;
      out[idx + 2] = aoVal;
      out[idx + 3] = 255;
    }
  }

  return out;
}

export interface EdgeMapParams {
  threshold: number;
  thickness: number;
  invert: boolean;
}

/** Edge map: Sobel gradient magnitude, thresholded, with optional thickness blur. */
export function generateEdgeMap(
  heightPixels: Uint8ClampedArray,
  w: number,
  h: number,
  { threshold, thickness, invert }: EdgeMapParams,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(heightPixels.length);
  const getHeight = (x: number, y: number): number => sampleClampedHeight(heightPixels, w, h, x, y);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;

      // Sample surrounding values
      const tl = getHeight(x - 1, y - 1);
      const t = getHeight(x, y - 1);
      const tr = getHeight(x + 1, y - 1);
      const l = getHeight(x - 1, y);
      const r = getHeight(x + 1, y);
      const bl = getHeight(x - 1, y + 1);
      const b = getHeight(x, y + 1);
      const br = getHeight(x + 1, y + 1);

      const dx = tr + 2 * r + br - (tl + 2 * l + bl);
      const dy = bl + 2 * b + br - (tl + 2 * t + tr);

      const mag = Math.sqrt(dx * dx + dy * dy);

      // Threshold edge lines
      let edge = mag > (1.0 - threshold) * 1.5 ? 1.0 : 0.0;

      if (invert) {
        edge = 1.0 - edge;
      }

      const eVal = Math.round(edge * 255);
      out[idx] = eVal;
      out[idx + 1] = eVal;
      out[idx + 2] = eVal;
      out[idx + 3] = 255;
    }
  }

  // Apply thickness blur if requested
  if (thickness > 1) {
    fastBoxBlur(out, w, h, thickness - 1);
  }

  return out;
}
