import { describe, expect, it } from "vitest";
import { TextureHoldings } from "../../src/renderers/TextureHoldings.js";

type Tex = { id: number };
type Rec = Record<string, Tex | undefined>;

function makeHoldings(): {
  holdings: TextureHoldings<Tex>;
  counts: Map<Tex, number>;
  ops: { n: number };
} {
  const counts = new Map<Tex, number>();
  const ops = { n: 0 };
  const holdings = new TextureHoldings<Tex>(
    (t) => {
      ops.n++;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    },
    (t) => {
      ops.n++;
      const c = (counts.get(t) ?? 0) - 1;
      if (c <= 0) counts.delete(t);
      else counts.set(t, c);
    },
  );
  return { holdings, counts, ops };
}

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("TextureHoldings", () => {
  it("skips the per-key diff for objects already holding the record's current version", () => {
    const { holdings, counts, ops } = makeHoldings();
    const a = { id: 1 };
    const rec: Rec = { u_diffuseMap: a, u_normalMap: undefined };
    const objects = Array.from({ length: 100 }, () => ({}));

    let v = holdings.setVersion(rec);
    for (const o of objects) holdings.acquire(o, rec, v);
    expect(counts.get(a)).toBe(100);
    const opsAfterFirst = ops.n;

    // Next frame, unchanged record: same version, no refcount traffic.
    expect(holdings.setVersion(rec)).toBe(v);
    for (const o of objects) holdings.acquire(o, rec, v);
    expect(ops.n).toBe(opsAfterFirst);

    // Texture swap on the material: new version, every object moves its reference.
    const b = { id: 2 };
    rec["u_diffuseMap"] = b;
    v = holdings.setVersion(rec);
    for (const o of objects) holdings.acquire(o, rec, v);
    expect(counts.has(a)).toBe(false);
    expect(counts.get(b)).toBe(100);
  });

  it("keeps the merged snapshot when a narrower record (depth pass) is acquired", () => {
    const { holdings, counts } = makeHoldings();
    const albedo = { id: 1 };
    const normal = { id: 2 };
    const main: Rec = { u_diffuseMap: albedo, u_normalMap: normal };
    const depth: Rec = { u_diffuseMap: albedo };
    const obj = {};
    for (let frame = 0; frame < 3; frame++) {
      holdings.acquire(obj, main, holdings.setVersion(main));
      holdings.acquire(obj, depth, holdings.setVersion(depth));
    }
    expect(counts.get(albedo)).toBe(1);
    expect(counts.get(normal)).toBe(1);
    holdings.releaseObject(obj);
    expect(counts.size).toBe(0);
  });

  it("matches the unversioned full diff under random record edits, acquires and removals", () => {
    const fast = makeHoldings();
    const slow = makeHoldings();
    const random = rng(59);
    const texs: Tex[] = Array.from({ length: 6 }, (_, i) => ({ id: i }));
    const keys = ["u_diffuseMap", "u_normalMap", "u_aoMap", "u_alphaMap"];
    const records: Rec[] = [{}, {}, {}];
    let objects: object[] = Array.from({ length: 12 }, () => ({}));
    const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;

    for (let step = 0; step < 20000; step++) {
      const r = random();
      if (r < 0.15) {
        const rec = pick(records);
        const key = pick(keys);
        const roll = random();
        if (roll < 0.2) delete rec[key];
        else if (roll < 0.35) rec[key] = undefined;
        else rec[key] = pick(texs);
      } else if (r < 0.95) {
        // One batch: version once, then several objects.
        const rec = pick(records);
        const version = fast.holdings.setVersion(rec);
        const n = 1 + Math.floor(random() * 4);
        for (let i = 0; i < n; i++) {
          const obj = pick(objects);
          fast.holdings.acquire(obj, rec, version);
          slow.holdings.acquire(obj, rec);
        }
      } else {
        const obj = pick(objects);
        fast.holdings.releaseObject(obj);
        slow.holdings.releaseObject(obj);
        objects = objects.map((o) => (o === obj ? {} : o));
      }
      if (step % 50 === 0) expect(fast.counts).toEqual(slow.counts);
    }
    expect(fast.counts).toEqual(slow.counts);
    for (const o of objects) {
      fast.holdings.releaseObject(o);
      slow.holdings.releaseObject(o);
    }
    expect(fast.counts.size).toBe(0);
    expect(slow.counts.size).toBe(0);
  });
});
