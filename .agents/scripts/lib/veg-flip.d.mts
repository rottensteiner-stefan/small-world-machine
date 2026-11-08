export interface FlipResult {
  mean: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
  meanPixelsAffected: number;
}
export function defaultPpd(): number;
export interface FlipOptions {
  ppd?: number | undefined;
}
export function computeFlip(pngRef: Buffer, pngTest: Buffer, opts?: FlipOptions): FlipResult;
export function computeFlipWithMap(pngRef: Buffer, pngTest: Buffer, opts?: FlipOptions): FlipResult & { map: Float32Array; width: number; height: number };
export function encodeFlipHeatmap(map: ArrayLike<number>, width: number): Buffer;
