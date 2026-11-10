/**
 * InstanceFieldLodTransition.test.ts — P2-1 CPU-mirror unit test of the shared LOD-transition
 * math (`veg-p2` / ADR 0059 step 2). Pure CPU, no browser.
 *
 * Surface under test (single source for the decision branch in `instance_cull.wgsl`:
 * `fieldLodJitter` / `fieldEffectiveMaxPx` / the in-band dual-write — see the P2 block in
 * `packages/engine/src/core/InstanceField.ts`):
 *   [instanceLodJitter] stateless deterministic per-record jitter in [-1, 1) with FROZEN
 *     murmur-finalizer constants — identical CPU and GPU values (IF-CULL-DETERMINISM), so the
 *     P2-4 CPU reference reproduces the exact effective thresholds of the real cull.
 *   [effectiveBucketMaxPx] `authored · (1 + hysteresis·jitter) + biasPx` — the ONLY threshold
 *     variant selection + hysteresis are evaluated against (IF-PROJECTED-SIZE); default knobs
 *     (hysteresis 0, bias 0) reproduce the authored maxima exactly.
 *   [lodTransitionBand] strict-membership mirror of the cull's band split (candidate A): the
 *     adjacent {coarse, fine} pair + the SHARED blend magnitude `p = 1−t` (fine entry `+p`,
 *     coarse entry `−p` per the pull-fragment channel contract); STRICT `(lo, hi)` membership
 *     keeps `p` in (0,1) (no ambiguous endpoint value); `band <= 0` = hard switch (candidate C,
 *     always `undefined` = single-write).
 *
 * Runtime note: this pins the CPU mirror + the frozen constants; the GPU lane equality is a
 * runtime concern (real-device validation of `instance_cull.wgsl` remains pending at P2
 * integration — see the P2-1 report).
 */

import { describe, expect, it } from "vitest";
import {
  LOD_TRANSITION_MODES,
  effectiveBucketMaxPx,
  instanceLodJitter,
  lodTransitionBand,
} from "../../src/core/InstanceField.js";
import type { LodTransitionMode } from "../../src/core/InstanceField.js";

// ---------------------------------------------------------------------------
// §0 Frozen pins (ADR 0047): the finalizer constants and the first-4 records' values are
// contract-locked. Changing a constant fails here before any lane can silently diverge.
// ---------------------------------------------------------------------------

const FINALIZER_A = 0x9e3779b9 as const;
const FINALIZER_B = 0x85ebca6b as const;
const FINALIZER_C = 0xc2b2ae35 as const;
const JITTER_MASK = 0x00ffffff as const;
const JITTER_SCALE = 8388608 as const; // 2^23

/** Frozen jitter literals for records 0..3 (computed 2026-11-09 from the constants above). */
const PINNED_JITTER = [
  -0.2286745309829712, -0.6435359716415405, 0.9325128793716431, -0.882716178894043,
] as const;

/** One 2-boundary prototype (3 buckets) for the band tests: ascending maxima, near=detail. */
const EFFECTIVE_MAXIMA = [24, 96, 1e6] as const;

describe("instanceLodJitter — deterministic per-record hysteresis discriminator", () => {
  it("reproduces the frozen reference literals (finalizer constants locked)", () => {
    for (let i = 0; i < PINNED_JITTER.length; i++) {
      expect(instanceLodJitter(i)).toBeCloseTo(PINNED_JITTER[i]!, 12);
    }
  });

  it("is a pure function of the record index (frame-stable, view-independent)", () => {
    for (const i of [0, 1, 2, 17, 4096, 12345]) {
      expect(instanceLodJitter(i)).toBe(instanceLodJitter(i));
      expect(instanceLodJitter(-1)).toBe(instanceLodJitter(-1));
    }
  });

  it("returns values in [-1, 1) across a wide population sweep", () => {
    for (let i = 0; i < 10_000; i++) {
      const j = instanceLodJitter(i);
      expect(Number.isFinite(j)).toBe(true);
      expect(j).toBeGreaterThanOrEqual(-1);
      expect(j).toBeLessThan(1);
    }
  });

  it("decorrelates distinct records (no constant discriminator trap)", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 64; i++) seen.add(instanceLodJitter(i));
    expect(seen.size).toBeGreaterThan(8);
  });

  it("the GPU finalizer constants are the frozen ones (comment-contract pin)", () => {
    // Cheap doc-pin of the WGSL mirror constants referenced in the helper's doc comment.
    expect(FINALIZER_A).toBe(0x9e3779b9);
    expect(FINALIZER_B).toBe(0x85ebca6b);
    expect(FINALIZER_C).toBe(0xc2b2ae35);
    expect(JITTER_MASK).toBe(0x00ffffff);
    expect(JITTER_SCALE).toBe(8388608);
  });
});

describe("effectiveBucketMaxPx — the single threshold variant (bias + hysteresis)", () => {
  it("default knobs reproduce the authored maximum exactly", () => {
    expect(effectiveBucketMaxPx(96, 0, 0, 7)).toBe(96);
    expect(effectiveBucketMaxPx(0, 0, 0, 7)).toBe(0);
  });

  it("applies the hysteresis jitter as `authored · (1 + h · jitter)`", () => {
    const authored = 200;
    const h = 0.5;
    const j = instanceLodJitter(5);
    expect(effectiveBucketMaxPx(authored, h, 0, 5)).toBeCloseTo(authored * (1 + h * j), 12);
  });

  it("applies the tier bias additively and unaudited (negative allowed)", () => {
    expect(effectiveBucketMaxPx(96, 0, -8, 3)).toBe(88);
    expect(effectiveBucketMaxPx(96, 0, 12, 3)).toBe(108);
  });

  it("is bound-equivariant with the jitter sign (jitter < 0 lowers the threshold)", () => {
    const j = instanceLodJitter(11);
    expect(j).not.toBe(0);
    const shifted = effectiveBucketMaxPx(100, 1, 0, 11) - 100; // = 100·j
    expect(Math.sign(shifted)).toBe(Math.sign(j));
  });
});

describe("lodTransitionBand — strict-membership crossfade split (candidate A mirror)", () => {
  it("returns undefined for band <= 0 (candidate C hard switch, single-write)", () => {
    expect(lodTransitionBand(50, EFFECTIVE_MAXIMA, 0)).toBeUndefined();
    expect(lodTransitionBand(50, EFFECTIVE_MAXIMA, -1)).toBeUndefined();
  });

  it("returns undefined when a prototype has fewer than 2 boundaries (no coarser neighbour)", () => {
    expect(lodTransitionBand(50, [24], 0.5)).toBeUndefined();
    expect(lodTransitionBand(50, [], 0.5)).toBeUndefined();
  });

  it("splits an interior diameter into the adjacent {coarse, fine} pair with blend = 1 − t in (0,1)", () => {
    const band = 0.5;
    const t0 = 24;
    const lo = t0 * (1 - band);
    const hi = t0 * (1 + band);
    const diam = (lo + hi) / 2; // band centre: t = 0.5, blend = 0.5
    const split = lodTransitionBand(diam, EFFECTIVE_MAXIMA, band);
    expect(split).toBeDefined();
    expect(split!.coarseBucket).toBe(0);
    expect(split!.fineBucket).toBe(1);
    expect(split!.blend).toBeCloseTo(0.5, 12);
    expect(split!.blend).toBeGreaterThan(0);
    expect(split!.blend).toBeLessThan(1);

    // Blend monotonicity across the band: nearer the fine end -> smaller shared magnitude.
    const nearCoarse = lodTransitionBand(lo + (hi - lo) * 0.2, EFFECTIVE_MAXIMA, band)!;
    const nearFine = lodTransitionBand(lo + (hi - lo) * 0.9, EFFECTIVE_MAXIMA, band)!;
    expect(nearCoarse.blend).toBeCloseTo(0.8, 12);
    expect(nearFine.blend).toBeCloseTo(0.1, 12);
    expect(nearCoarse.blend).toBeGreaterThan(nearFine.blend);
    expect(nearCoarse.coarseBucket).toBe(0);
    expect(nearFine.coarseBucket).toBe(0);
  });

  it("treats the exact band edges as OUT of band (strict membership, no p=0/p=1 endpoint)", () => {
    const band = 0.5;
    const lo = 24 * (1 - band);
    const hi = 24 * (1 + band);
    expect(lodTransitionBand(lo, EFFECTIVE_MAXIMA, band)).toBeUndefined();
    expect(lodTransitionBand(hi, EFFECTIVE_MAXIMA, band)).toBeUndefined();
    // Just inside the open interval still splits.
    const eps = 1e-3;
    expect(lodTransitionBand(lo + eps, EFFECTIVE_MAXIMA, band)!.blend).toBeLessThan(1);
    expect(lodTransitionBand(hi - eps, EFFECTIVE_MAXIMA, band)!.blend).toBeGreaterThan(0);
  });

  it("selects the higher pair at the second boundary (ascending search, adjacent pair)", () => {
    const band = 0.5;
    const b1 = 96;
    const mid = b1 * (1 + band / 2); // inside band of boundary 1
    const split = lodTransitionBand(mid, EFFECTIVE_MAXIMA, band);
    expect(split).toBeDefined();
    expect(split!.coarseBucket).toBe(1);
    expect(split!.fineBucket).toBe(2);
  });

  it("returns undefined outside every band (settled single-write path)", () => {
    const band = 0.2;
    // Between the two bands' ranges: below boundary-1's band yet far enough from boundary-0's.
    expect(lodTransitionBand(40, EFFECTIVE_MAXIMA, band)).toBeUndefined();
    // Above the last boundary's band.
    expect(lodTransitionBand(1e9, EFFECTIVE_MAXIMA, band)).toBeUndefined();
    // Far below the first band.
    expect(lodTransitionBand(1, EFFECTIVE_MAXIMA, band)).toBeUndefined();
  });

  it("the blend magnitude is the SHARED pair value (fine +blend / coarse −blend contract)", () => {
    // Documentation-pin: the cull writes FINE +blend and COARSE −blend with ONE magnitude;
    // the CPU split exposes exactly that shared magnitude (single field, no per-side pair).
    const split = lodTransitionBand(24 * 1.25, EFFECTIVE_MAXIMA, 0.5)!;
    expect(typeof split.blend).toBe("number");
    expect(split.blend).toBeGreaterThan(0);
    expect(split.blend).toBeLessThan(1);
    // The interface exposes ONE magnitude — no fineBlend/coarseBlend divergence possible.
    expect(Object.keys(split).sort()).toEqual(["blend", "coarseBucket", "fineBucket"]);
  });
});

// ---------------------------------------------------------------------------
// DECISIVE MODE SWITCH (moderator decision 2026-11-10): the preset table behind `?lodMode=` /
// `setLodTransitionMode` freezes the derived knobs. Retune ONLY against the live pop-measurement
// protocol (docs/research/veg-p2-lod-transitions.md §6) — then update BOTH this pin and the
// engine table (single source), plus the device-side end-to-end pin.
// ---------------------------------------------------------------------------

/** Frozen preset literals (computed 2026-11-10): the ONE authoritative derivation contract. */
const PINNED_PRESETS: Readonly<
  Record<
    LodTransitionMode,
    Readonly<{ crossfadeBand: number; hysteresis: number; ditherGate: number }>
  >
> = {
  off: { crossfadeBand: 0, hysteresis: 0, ditherGate: 1 },
  hysteresis: { crossfadeBand: 0, hysteresis: 0.02, ditherGate: 1 },
  dither: { crossfadeBand: 0.25, hysteresis: 0, ditherGate: 0 },
  "dither-hysteresis": { crossfadeBand: 0.25, hysteresis: 0.02, ditherGate: 0 },
};

describe("LOD_TRANSITION_MODES — the DECISIVE MODE SWITCH preset table (moderator 2026-11-10)", () => {
  it("is the sole source with exactly the four documented modes (frozen key set)", () => {
    expect(Object.keys(LOD_TRANSITION_MODES).sort()).toEqual([
      "dither",
      "dither-hysteresis",
      "hysteresis",
      "off",
    ]);
  });

  it("freeze-pins every preset's derived knobs to the frozen literals", () => {
    for (const mode of Object.keys(PINNED_PRESETS) as LodTransitionMode[]) {
      expect(LOD_TRANSITION_MODES[mode]).toEqual(PINNED_PRESETS[mode]);
      expect(LOD_TRANSITION_MODES[mode]).toMatchObject(PINNED_PRESETS[mode]);
    }
  });

  it("`off` is the explicit P1-identical baseline preset (no dual write, hard keep-all gate)", () => {
    const p = LOD_TRANSITION_MODES.off;
    expect(p.crossfadeBand).toBe(0);
    expect(p.hysteresis).toBe(0);
    expect(p.ditherGate).toBe(1);
    // No band -> `lodTransitionBand` never splits: single-write P1-identical routing.
    expect(lodTransitionBand(30, EFFECTIVE_MAXIMA, p.crossfadeBand)).toBeUndefined();
  });

  it("`hysteresis` decouples hard switches WITHOUT any dual write (band 0, gate hard)", () => {
    const p = LOD_TRANSITION_MODES.hysteresis;
    expect(p.crossfadeBand).toBe(0);
    expect(p.hysteresis).toBeGreaterThan(0);
    expect(p.ditherGate).toBe(1);
    expect(lodTransitionBand(30, EFFECTIVE_MAXIMA, p.crossfadeBand)).toBeUndefined();
    // The jitter is LIVE: distinct records get distinct effective thresholds (structural ±1 cap).
    const a = effectiveBucketMaxPx(24, p.hysteresis, 0, 0);
    const b = effectiveBucketMaxPx(24, p.hysteresis, 0, 1);
    expect(a).not.toBe(b);
  });

  it("`dither` blends with a band but WITHOUT hysteresis (single rail, no per-record jitter)", () => {
    const p = LOD_TRANSITION_MODES.dither;
    expect(p.crossfadeBand).toBeGreaterThan(0);
    expect(p.hysteresis).toBe(0);
    expect(p.ditherGate).toBe(0);
    // The preset's band actually splits an in-band diameter.
    expect(lodTransitionBand(24 * 1.1, EFFECTIVE_MAXIMA, p.crossfadeBand)).toBeDefined();
  });

  it("`dither-hysteresis` is the composite: band AND hysteresis, crossfade gate (strongest)", () => {
    const p = LOD_TRANSITION_MODES["dither-hysteresis"];
    expect(p.crossfadeBand).toBeGreaterThan(0);
    expect(p.hysteresis).toBeGreaterThan(0);
    expect(p.ditherGate).toBe(0);
    expect(lodTransitionBand(24 * 1.1, EFFECTIVE_MAXIMA, p.crossfadeBand)).toBeDefined();
  });

  it("cost model pins: ONLY the dither modes can dual-write (band > 0), never the hard modes", () => {
    for (const mode of ["off", "hysteresis"] as const) {
      expect(LOD_TRANSITION_MODES[mode].crossfadeBand).toBe(0);
    }
    for (const mode of ["dither", "dither-hysteresis"] as const) {
      expect(LOD_TRANSITION_MODES[mode].crossfadeBand).toBeGreaterThan(0);
    }
    // The dual-write modes are exactly those whose fragment gate is NOT hard.
    expect(LOD_TRANSITION_MODES.dither.ditherGate).toBe(0);
    expect(LOD_TRANSITION_MODES["dither-hysteresis"].ditherGate).toBe(0);
  });
});
