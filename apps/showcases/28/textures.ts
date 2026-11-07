import { SPECTRUM } from "./optics.js";
import { Texture, TextureFilter, TextureWrap } from "@small-world-machine/engine";

/** Bakes a high-resolution chromatic caustic dispersion texture for the bench surface under the rays (P2-1). */
export function createCausticGradientTexture(): Texture {
  const width = 512;
  const height = 256;
  const cv = document.createElement("canvas");
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error("[Showcase28] 2D canvas context unavailable for caustic.");

  // Base horizontal spectrum gradient across the 7 wavelengths
  const grad = ctx.createLinearGradient(0, 0, width, 0);
  for (let i = 0; i < SPECTRUM.length; i++) {
    const c = SPECTRUM[i]!.color;
    const uCenter = (i + 0.5) / SPECTRUM.length;
    grad.addColorStop(
      Math.min(1.0, Math.max(0.0, uCenter)),
      `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`,
    );
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Apply optical dispersion falloff and longitudinal attenuation
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1); // 0 at prism exit, 1 at detector impact
    // Longitudinal envelope: smooth quadratic emergence from prism base, bright core, gentle fade at boundary
    const leadIn = Math.min(1.0, v / 0.08);
    const leadInFalloff = leadIn * (2 - leadIn);
    const tailOff = v < 0.75 ? 1.0 : Math.max(0.0, 1.0 - (v - 0.75) / 0.25);
    const tailFalloff = tailOff * tailOff;
    const vProfile = leadInFalloff * tailFalloff;

    for (let x = 0; x < width; x++) {
      const u = x / (width - 1); // 0 (Red) -> 1 (Violet)
      // High-frequency optical caustic striations / micro-refraction filaments
      const striations = 0.88 + 0.12 * Math.sin(u * 140.0 + v * 8.0);
      // Intra-band caustic focus core: peaks gently along each ray centerline
      const quadFrac = (u * 7.0) % 1.0;
      const quadCenter = 1.0 - 4.0 * (quadFrac - 0.5) * (quadFrac - 0.5);
      const corePeak = 0.75 + 0.25 * Math.max(0.0, quadCenter);

      // Edge fade at the extreme outer flanks of Red and Violet
      const uFlank = Math.sin(u * Math.PI);
      const flankFade = Math.min(1.0, uFlank * 4.0);

      const alpha = Math.min(
        1.0,
        Math.max(0.0, vProfile * striations * corePeak * flankFade * 0.72),
      );
      const idx = (y * width + x) * 4;
      data[idx + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(imgData, 0, 0);

  return Texture.fromCanvas(cv, {
    generateMipmaps: false,
    magFilter: TextureFilter.LINEAR,
    minFilter: TextureFilter.LINEAR,
    addressModeU: TextureWrap.CLAMP_TO_EDGE,
    addressModeV: TextureWrap.CLAMP_TO_EDGE,
  });
}

/** Bakes the calibrated red->violet spectral ramp into a 1D emissive map. */
export function createBandGradientTexture(): Texture {
  const width = 256;
  const height = 8;
  const cv = document.createElement("canvas");
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error("[Showcase28] 2D canvas context unavailable for the band gradient.");
  const grad = ctx.createLinearGradient(0, 0, width, 0);
  for (let i = 0; i < SPECTRUM.length; i++) {
    const c = SPECTRUM[i]!.color;
    // Saturation boost: the raw piecewise rgb() stops wash out through white-ish mixes in the
    // mid-spectrum once drawn as a canvas gradient, so exaggerate each stop around its luma to
    // keep every channel under 1 and the band's chromatic identity intact (no white/pink core).
    const gray = (c.r + c.g + c.b) / 3;
    const sat = 1.7;
    const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
    const sr = clamp01(gray + (c.r - gray) * sat);
    const sg = clamp01(gray + (c.g - gray) * sat);
    const sb = clamp01(gray + (c.b - gray) * sat);
    grad.addColorStop(
      i / (SPECTRUM.length - 1),
      `rgb(${Math.round(sr * 255)}, ${Math.round(sg * 255)}, ${Math.round(sb * 255)})`,
    );
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  return Texture.fromCanvas(cv, {
    generateMipmaps: false,
    magFilter: TextureFilter.LINEAR,
    minFilter: TextureFilter.LINEAR,
    addressModeU: TextureWrap.CLAMP_TO_EDGE,
    addressModeV: TextureWrap.CLAMP_TO_EDGE,
  });
}

/** Bakes the calibrated auxiliary reference detector readout scale texture. */
export function createRefSensorTexture(): Texture {
  const width = 512;
  const height = 128;
  const cv = document.createElement("canvas");
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error("[Showcase28] 2D canvas context unavailable for ref sensor.");

  // Dark instrument display background
  ctx.fillStyle = "#0a0e14";
  ctx.fillRect(0, 0, width, height);

  // Subtle measurement border & center rail
  ctx.strokeStyle = "rgba(0, 210, 255, 0.45)";
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 8, width - 16, height - 16);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(16, 64);
  ctx.lineTo(width - 16, 64);
  ctx.stroke();

  // Scale ticks and labels along X
  ctx.fillStyle = "rgba(0, 220, 255, 0.85)";
  ctx.font = "bold 13px monospace";
  ctx.textAlign = "center";
  ctx.fillText("AUX REF PHOTODETECTOR  |  50.0% BEAM SPLIT", 256, 28);

  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.font = "11px monospace";
  for (let x = 32; x <= width - 32; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 56);
    ctx.lineTo(x, 72);
    ctx.stroke();
    const val = Math.round((x - 256) / 3.2);
    ctx.fillText(`${val > 0 ? "+" : ""}${val}mm`, x, 92);
  }

  // Invert vertically so that texture mapping on the 3D detector face renders right-side up
  const flippedCanvas = document.createElement("canvas");
  flippedCanvas.width = width;
  flippedCanvas.height = height;
  const fCtx = flippedCanvas.getContext("2d");
  if (fCtx) {
    fCtx.translate(0, height);
    fCtx.scale(1, -1);
    fCtx.drawImage(cv, 0, 0);
  }

  return Texture.fromCanvas(flippedCanvas, {
    generateMipmaps: false,
    magFilter: TextureFilter.LINEAR,
    minFilter: TextureFilter.LINEAR,
    addressModeU: TextureWrap.CLAMP_TO_EDGE,
    addressModeV: TextureWrap.CLAMP_TO_EDGE,
  });
}
