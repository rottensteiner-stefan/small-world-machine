export interface BackgroundRemovalOptions {
  tolerance?: number; // 0-100 (default 25)
  feather?: number; // 0-10 (default 1)
  keyColor?: { r: number; g: number; b: number }; // Optional manual chroma key
}

function makeImageData(width: number, height: number, data?: Uint8ClampedArray): ImageData {
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

/**
 * Smart Edge-Preserving Alpha Matting for local zero-latency background removal.
 * Automatically samples 4 corners if keyColor is not specified.
 */
export function removeBackground(
  imageData: ImageData,
  options: BackgroundRemovalOptions = {},
): ImageData {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const output = makeImageData(width, height, new Uint8ClampedArray(data));
  const outData = output.data;

  let keyR: number;
  let keyG: number;
  let keyB: number;

  if (options.keyColor) {
    keyR = options.keyColor.r;
    keyG = options.keyColor.g;
    keyB = options.keyColor.b;
  } else {
    // Sample 4 corners
    const corners = [
      0, // top-left
      (width - 1) * 4, // top-right
      (height - 1) * width * 4, // bottom-left
      ((height - 1) * width + (width - 1)) * 4, // bottom-right
    ];

    let rSum = 0,
      gSum = 0,
      bSum = 0;
    for (const c of corners) {
      rSum += data[c]!;
      gSum += data[c + 1]!;
      bSum += data[c + 2]!;
    }
    keyR = rSum / 4;
    keyG = gSum / 4;
    keyB = bSum / 4;
  }

  const tolerance = (options.tolerance ?? 25) * 4.41; // map 0-100 to Euclidean distance (~441 max dist in RGB)
  const feather = Math.max(1, (options.feather ?? 2) * 4);

  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i]! - keyR;
    const dg = data[i + 1]! - keyG;
    const db = data[i + 2]! - keyB;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);

    if (dist < tolerance) {
      // Solid background -> full transparent
      outData[i + 3] = 0;
    } else if (dist < tolerance + feather) {
      // Feathered transition edge
      const factor = (dist - tolerance) / feather;
      outData[i + 3] = Math.round(data[i + 3]! * factor);
    }
  }

  return output;
}

/**
 * Generates a Tangent Space Normal Map from an input height/luminance image using Sobel operators.
 */
export function generateNormalMap(imageData: ImageData, strength: number = 2.0): ImageData {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const output = makeImageData(width, height);
  const outData = output.data;

  function getLuminance(x: number, y: number): number {
    const cx = Math.max(0, Math.min(width - 1, x));
    const cy = Math.max(0, Math.min(height - 1, y));
    const idx = (cy * width + cx) * 4;
    return (0.299 * data[idx]! + 0.587 * data[idx + 1]! + 0.114 * data[idx + 2]!) / 255;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Sobel kernel for dX and dY
      const tl = getLuminance(x - 1, y - 1);
      const t = getLuminance(x, y - 1);
      const tr = getLuminance(x + 1, y - 1);
      const l = getLuminance(x - 1, y);
      const r = getLuminance(x + 1, y);
      const bl = getLuminance(x - 1, y + 1);
      const b = getLuminance(x, y + 1);
      const br = getLuminance(x + 1, y + 1);

      const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      const dz = 1.0;

      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const nx = -dx / len;
      const ny = -dy / len;
      const nz = dz / len;

      const outIdx = (y * width + x) * 4;
      outData[outIdx] = Math.round((nx * 0.5 + 0.5) * 255);
      outData[outIdx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      outData[outIdx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      outData[outIdx + 3] = data[outIdx + 3]!;
    }
  }

  return output;
}

/**
 * Generates a Depth/Height Map from an input image based on luminance.
 */
export function generateDepthMap(imageData: ImageData, invert: boolean = false): ImageData {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const output = makeImageData(width, height);
  const outData = output.data;

  for (let i = 0; i < data.length; i += 4) {
    let lum = Math.round(0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!);
    if (invert) lum = 255 - lum;

    outData[i] = lum;
    outData[i + 1] = lum;
    outData[i + 2] = lum;
    outData[i + 3] = data[i + 3]!;
  }

  return output;
}
