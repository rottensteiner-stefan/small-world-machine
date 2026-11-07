/**
 * AllocationHarness — C1 (T6), Charlie.
 *
 * Zero-allocation gate helper for vfx hot paths. Counts heap allocations via monkeypatched
 * typed-array / buffer constructors on `globalThis`, mirroring the Phase-A precedent
 * (`CurlNoiseAndSubEmitter.test.ts`) as a reusable, import-safe harness for all S3/S4 lanes.
 *
 * SCOPE (binding, S34 topic §3.2): typed-array ctors are the audited heap-allocation surface.
 * `ArrayBuffer` / `DataView` / `SharedArrayBuffer` are counted as diagnostics and asserted by
 * default; plain `new Array` objects are NOT counted (Phase-A fact: allocation counter via
 * monkeypatched typed-array ctors). Hot-path rules in this repo ban both anyway.
 *
 * Determinism guarantees:
 * - `install()` is a pure wrapper: trivial `construct` trap, `Reflect.construct` passthrough.
 * - Restoring the original ctors is exception-safe via the caller's `finally`.
 * - The tracker itself allocates nothing inside the measured callback (only `Map` bookkeeping
 *   outside the traced code).
 */
import { expect } from "vitest";

/** Constructor names traced by the harness (guarded at `install` time against platform absence). */
export const ALLOCATION_CTOR_NAMES: readonly string[] = [
  "Float32Array",
  "Float64Array",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Uint32Array",
  "BigInt64Array",
  "BigUint64Array",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
];

/** Constructor-shaped type used in place of `Function` (lint: no-unsafe-function-type). */
type Constructor = new (...args: never[]) => object;

export interface AllocationCounts {
  /** Per-constructor allocation counts (`name -> count`). */
  readonly byCtor: ReadonlyMap<string, number>;
  /** Sum across all traced constructors. */
  readonly total: number;
}

interface PatchedCtor {
  readonly original: Constructor;
}

/**
 * Counts `new <TypedArray|ArrayBuffer|DataView>` calls by temporarily wrapping the global
 * constructors in counting proxies. Install before entering the hot path, uninstall afterwards.
 */
export class AllocationTracker {
  private readonly _patched = new Map<string, PatchedCtor>();
  private readonly _counts = new Map<string, number>();
  private _installed = false;

  /** Counts every traced ctor on `globalThis` for its registered name. */
  public install(): void {
    if (this._installed) return;
    const holder = globalThis as unknown as Record<string, unknown>;
    for (const name of ALLOCATION_CTOR_NAMES) {
      const candidate = holder[name];
      if (typeof candidate !== "function") continue; // e.g. BigInt* absent on exotic platforms
      const counts = this._counts;
      const proxy = new Proxy(candidate as Constructor, {
        construct(target, args, newTarget): object {
          counts.set(name, (counts.get(name) ?? 0) + 1);
          return Reflect.construct(target as Constructor, args, newTarget as Constructor) as object;
        },
      }) as unknown as Constructor;
      holder[name] = proxy;
      this._patched.set(name, { original: candidate as Constructor });
    }
    this._installed = true;
  }

  /** Restores the original constructors (safe to call even when not installed). */
  public uninstall(): void {
    if (!this._installed) return;
    const holder = globalThis as unknown as Record<string, unknown>;
    for (const [name, { original }] of this._patched) {
      holder[name] = original;
    }
    this._patched.clear();
    this._counts.clear();
    this._installed = false;
  }

  /** Zeros all counters (external bookkeeping only — does not run inside the traced code). */
  public reset(): void {
    this._counts.clear();
  }

  /** Immutable snapshot of the tracked allocations so far. */
  public snapshot(): AllocationCounts {
    const byCtor = new Map<string, number>(this._counts);
    let total = 0;
    for (const count of byCtor.values()) total += count;
    return { byCtor, total };
  }
}

/** Runs `fn` once while counting tracked allocations. Returns counts; the tracker is uninstalled afterwards. */
export function countAllocations(fn: () => void): AllocationCounts {
  const tracker = new AllocationTracker();
  tracker.install();
  try {
    fn();
    return tracker.snapshot();
  } finally {
    tracker.uninstall();
  }
}

export interface ZeroAllocationRunOptions {
  /** Total frames to run including warmup (`countFromFrame` frames). Default 1000. */
  totalFrames?: number;
  /** Frames [0, countFromFrame) run unasserted as warmup/jit-up. Default 2 (assert frames 2..totalFrames). */
  countFromFrame?: number;
  /** Cap on reported failure lines (avoids huge assertion dumps). Default 25. */
  maxReportedFailures?: number;
}

/**
 * C1 contract gate: runs `frameFn` for `totalFrames` frames and asserts ZERO traced heap
 * allocations on every frame `[countFromFrame, totalFrames)`. A warmup prefix (framed 0 and 1
 * by default) absorbs one-time lazily-allocated state so steady-state hot paths are measured.
 *
 * Failure detail names the offending frame(s) and the ctor(s) that allocated — routing signal
 * for the file owner, per topic doc §6 (no unilateral reviewer fixes).
 */
export function assertZeroAllocationFrames(
  label: string,
  frameFn: (frame: number) => void,
  options: ZeroAllocationRunOptions = {},
): void {
  const totalFrames = options.totalFrames ?? 1000;
  const countFrom = options.countFromFrame ?? 2;
  const maxReported = options.maxReportedFailures ?? 25;
  const tracker = new AllocationTracker();
  const failures: string[] = [];

  tracker.install();
  try {
    for (let f = 0; f < countFrom; f++) frameFn(f);
    for (let f = countFrom; f < totalFrames; f++) {
      tracker.reset();
      frameFn(f);
      const counts = tracker.snapshot();
      if (counts.total === 0) continue;
      const detail = [...counts.byCtor.entries()]
        .filter(([, count]) => count > 0)
        .map(([name, count]) => `${name}×${count}`)
        .join(", ");
      failures.push(`frame ${f}: ${detail}`);
    }
  } finally {
    tracker.uninstall();
  }

  if (failures.length > 0) {
    const shown = failures.slice(0, maxReported);
    const omitted = failures.length - shown.length;
    const suffix = omitted > 0 ? ` (+${omitted} more failing frames)` : "";
    // Single assertion carrying the whole diagnostic — keeps the vitest failure actionable.
    expect.fail(
      `[C1] "${label}" allocated on hot-path frames — first failures: ${shown.join(" | ")}${suffix}`,
    );
    return;
  }
  // Frames ran atomically clean; single-sided expectation documents the invariant explicitly.
  expect(failures).toEqual([]);
}
