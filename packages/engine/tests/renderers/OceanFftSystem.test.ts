import { describe, expect, it } from "vitest";
import spectrumInitWGSL from "../../src/renderers/shaders/source/web_gpu/compute/ocean_spectrum_init.wgsl?raw";
import spectrumStepWGSL from "../../src/renderers/shaders/source/web_gpu/compute/ocean_spectrum_step.wgsl?raw";
import ifftPassWGSL from "../../src/renderers/shaders/source/web_gpu/compute/ocean_ifft_pass.wgsl?raw";
import assembleWGSL from "../../src/renderers/shaders/source/web_gpu/compute/ocean_assemble.wgsl?raw";
import { OCEAN_FFT_RESOLUTION } from "../../src/renderers/WebGPU/managers/OceanFftSystem.js";

const OCEAN_PI = Math.PI;
const OCEAN_G = 9.81;

function reverseBits8(x: number): number {
  let y = 0;
  for (let b = 0; b < 8; b++) {
    y = (y << 1) | ((x >> b) & 1);
  }
  return y;
}

/** CPU mirror of the 256-point Radix-2 Cooley-Tukey DIT IFFT in ocean_ifft_pass.wgsl. */
function runIfft256(
  reIn: Float64Array,
  imIn: Float64Array,
): { re: Float64Array; im: Float64Array } {
  const n = OCEAN_FFT_RESOLUTION;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const rev = reverseBits8(i);
    re[rev] = reIn[i]!;
    im[rev] = imIn[i]!;
  }

  for (let stage = 0; stage < 8; stage++) {
    const m = 2 << stage;
    const halfM = 1 << stage;
    for (let i = 0; i < 128; i++) {
      const k = i & (halfM - 1);
      const base = ((i >> stage) << (stage + 1)) + k;
      const pair = base + halfM;

      const angle = (2.0 * OCEAN_PI * k) / m;
      const wr = Math.cos(angle);
      const wi = Math.sin(angle);

      const ar = re[base]!;
      const ai = im[base]!;
      const br = re[pair]!;
      const bi = im[pair]!;

      const wbr = wr * br - wi * bi;
      const wbi = wr * bi + wi * br;

      re[base] = ar + wbr;
      im[base] = ai + wbi;
      re[pair] = ar - wbr;
      im[pair] = ai - wbi;
    }
  }
  return { re, im };
}

/** CPU mirror of JONSWAP spectral bin variance in ocean_spectrum_init.wgsl. */
function evalJonswapBinVariance(
  kxInt: number,
  kzInt: number,
  patchSize: number,
  windSpeed: number,
  windDirX: number,
  windDirZ: number,
): number {
  if (kxInt === 0 && kzInt === 0) return 0;
  const dk = (2.0 * OCEAN_PI) / Math.max(patchSize, 1.0);
  const kx = kxInt * dk;
  const kz = kzInt * dk;
  const kMag = Math.hypot(kx, kz);
  if (kMag < 1e-5) return 0;

  const omega = Math.sqrt(OCEAN_G * kMag);
  const u10 = Math.min(26.0, Math.max(4.0, 7.5 + windSpeed * 6.5));
  const fetch = 85000.0;
  const dimFetch = (OCEAN_G * fetch) / (u10 * u10);
  const alpha = 0.076 * Math.pow(dimFetch, -0.22);
  const omegaP = 2.0 * OCEAN_PI * 3.5 * (OCEAN_G / u10) * Math.pow(dimFetch, -0.33);

  const sigma = omega <= omegaP ? 0.07 : 0.09;
  const rExp = (omega - omegaP) / (sigma * omegaP);
  const r = Math.exp(-0.5 * rExp * rExp);
  const peakBoost = Math.pow(3.3, r);
  const wRatio = omegaP / Math.max(omega, 1e-4);
  const wRatio4 = wRatio ** 4;
  const omega5 = omega ** 5;
  const sJonswap =
    ((alpha * OCEAN_G * OCEAN_G) / Math.max(omega5, 1e-6)) * Math.exp(-1.25 * wRatio4) * peakBoost;

  const wLen = Math.hypot(windDirX, windDirZ);
  const ux = wLen > 1e-4 ? windDirX / wLen : 0.84;
  const uz = wLen > 1e-4 ? windDirZ / wLen : 0.54;
  const cosTheta = (kx / kMag) * ux + (kz / kMag) * uz;
  const halfCos = Math.max(0.5 + 0.5 * cosTheta, 0.0);
  const dWind = 0.695 * Math.pow(halfCos, 6.0);
  const dRefl = 0.025 / (2.0 * OCEAN_PI);
  const dirSpread = dRefl * 0.06 + (dWind + dRefl) * 0.94;

  const dOmegaDk = OCEAN_G / (2.0 * omega);
  const shortCut = (patchSize / OCEAN_FFT_RESOLUTION) * 0.45;
  const capDamp = Math.exp(-kMag * kMag * shortCut * shortCut);
  return Math.max(sJonswap * dirSpread * (dOmegaDk / kMag) * (dk * dk) * capDamp, 0.0);
}

describe("OceanFftSystem (Phase 2 JONSWAP 2D IFFT)", () => {
  it("matches direct 256-point IDFT for the Radix-2 Cooley-Tukey DIT butterfly kernel", () => {
    const n = OCEAN_FFT_RESOLUTION;
    const reIn = new Float64Array(n);
    const imIn = new Float64Array(n);

    // Build an arbitrary Hermitian-symmetric frequency vector so the IDFT output must be strictly real.
    for (let k = 1; k < n / 2; k++) {
      const a = Math.sin(k * 0.37) / (1 + k * 0.15);
      const b = Math.cos(k * 0.61) / (1 + k * 0.15);
      reIn[k] = a;
      imIn[k] = b;
      reIn[n - k] = a;
      imIn[n - k] = -b;
    }

    const { re: fftRe, im: fftIm } = runIfft256(reIn, imIn);

    for (let x = 0; x < n; x++) {
      let refRe = 0;
      let refIm = 0;
      for (let k = 0; k < n; k++) {
        const ang = (2 * Math.PI * k * x) / n;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        refRe += reIn[k]! * c - imIn[k]! * s;
        refIm += reIn[k]! * s + imIn[k]! * c;
      }
      expect(fftRe[x]!).toBeCloseTo(refRe, 9);
      expect(fftIm[x]!).toBeCloseTo(refIm, 9);
      // Hermitian symmetry guarantees zero imaginary part in the spatial height/displacement field.
      expect(Math.abs(fftIm[x]!)).toBeLessThan(1e-10);
    }
  });

  it("concentrates JONSWAP spectral energy near omega_p and aligns spread downwind", () => {
    const patchSize = 180;
    const windSpeed = 1.28;
    const dk = (2 * OCEAN_PI) / patchSize;
    const u10 = 7.5 + windSpeed * 6.5;
    const dimFetch = (OCEAN_G * 85000) / (u10 * u10);
    const omegaP = 2 * OCEAN_PI * 3.5 * (OCEAN_G / u10) * Math.pow(dimFetch, -0.33);
    const kpInt = Math.max(1, Math.round((omegaP * omegaP) / (OCEAN_G * dk)));

    const peakEnergy = evalJonswapBinVariance(kpInt, 0, patchSize, windSpeed, 1, 0);
    const upwindEnergy = evalJonswapBinVariance(-kpInt, 0, patchSize, windSpeed, 1, 0);
    const highFreqEnergy = evalJonswapBinVariance(96, 0, patchSize, windSpeed, 1, 0);

    expect(peakEnergy).toBeGreaterThan(0);
    expect(peakEnergy).toBeGreaterThan(upwindEnergy * 10);
    expect(peakEnergy).toBeGreaterThan(highFreqEnergy * 100);
  });

  it("pins WGSL compute shaders for 256-pt Hermitian FFT safety and aligned uniform layouts", () => {
    expect(OCEAN_FFT_RESOLUTION).toBe(256);
    expect(spectrumInitWGSL).toContain("gid.x == halfN || gid.y == halfN");
    expect(spectrumStepWGSL).toContain("sqrt(OCEAN_G * kMag)");
    expect(ifftPassWGSL).toContain("@workgroup_size(256, 1, 1)");
    expect(ifftPassWGSL).toContain("reverseBits(i) >> 24u");
    expect(ifftPassWGSL).toContain("workgroupBarrier()");
    expect(assembleWGSL).toContain("texture_storage_2d<rgba16float, write>");
  });
});
