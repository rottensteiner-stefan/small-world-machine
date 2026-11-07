export enum GpuClass {
  LOW = "LOW",
  UNKNOWN = "UNKNOWN",
  HIGH = "HIGH",
}

/**
 * Renderer strings are matched case-insensitively against the unmasked WebGL renderer, which
 * Chrome wraps as `ANGLE (Vendor, Model Direct3D11 ..., D3D11)`. A GPU that matches neither list
 * stays UNKNOWN and is scored neutrally: a wrong guess is worse than no guess, and Safari only
 * reports a generic "Apple GPU" that cannot tell an M-series from an old A-series chip.
 */
const LOW_GPU_PATTERNS: readonly RegExp[] = [
  /mali-(4\d\d|t\d+|g31|g51|g52|g57)/,
  /adreno[^0-9]*(3\d\d|4\d\d|5\d\d|60\d|61\d)\b/,
  /powervr/,
  /intel[^,]*\b(hd|uhd) graphics/,
  /swiftshader|llvmpipe|software/,
];

const HIGH_GPU_PATTERNS: readonly RegExp[] = [
  /geforce (rtx|gtx (9|1)\d{2,3})/,
  /radeon (rx|pro)/,
  /apple m\d/,
  /adreno[^0-9]*[78]\d\d\b/,
  /mali-g(6[1-9]\d|7\d\d)/,
];

export function classifyGpu(renderer: string): GpuClass {
  const normalized = renderer.toLowerCase();
  if (LOW_GPU_PATTERNS.some((pattern) => pattern.test(normalized))) return GpuClass.LOW;
  if (HIGH_GPU_PATTERNS.some((pattern) => pattern.test(normalized))) return GpuClass.HIGH;
  return GpuClass.UNKNOWN;
}
