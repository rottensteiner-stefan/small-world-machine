/**
 * Unwraps the result of a `gl.create*()` call. The browser returns `null` when the context is
 * lost (or the GPU is out of memory); asserting it away with `!` only moves the failure to some
 * unrelated later call. Failing here names the resource and the likely cause instead.
 */
export function requireGlObject<T>(object: T | null, what: string): T {
  if (object === null) {
    throw new Error(
      `[WebGL] Failed to create ${what} (the context is lost or the GPU is out of memory).`,
    );
  }
  return object;
}
