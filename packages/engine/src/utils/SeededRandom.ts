/**
 * A deterministic 32-bit PRNG (mulberry32): the same seed always yields the same sequence in [0, 1).
 * @param seed 32-bit integer seed.
 * @returns A function returning the next pseudo-random number.
 */
export function mulberry32(seed: number): () => number {
  let a: number = seed;
  return (): number => {
    let t: number = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
