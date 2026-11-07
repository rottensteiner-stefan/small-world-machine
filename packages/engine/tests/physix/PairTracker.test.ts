import { describe, it, expect } from "vitest";
import { PairTracker, pairKey, PAIR_ID_LIMIT } from "../../src/physix/PairTracker.js";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";
import { Object3D } from "../../src/core/Object3D.js";

describe("PairTracker", () => {
  describe("pairKey", () => {
    it("is symmetric and collision-free for ids above 2^21", () => {
      const a = 33554432; // first internal collider id (2^25)
      const b = 33554433;
      const c = 33554434;
      expect(pairKey(a, b)).toBe(pairKey(b, a));
      expect(pairKey(a, b)).not.toBe(pairKey(a, c));
      expect(pairKey(b, c)).not.toBe(pairKey(a, c));
    });

    it("produces no collisions for 4096 distinct pairs beyond 2^21 (2,097,152)", () => {
      const base = 2097152 + 777;
      const keys = new Set<number>();
      for (let i = 0; i < 4096; i++) {
        keys.add(pairKey(base + i, base + i + 1000));
      }
      expect(keys.size).toBe(4096);
    });
  });

  describe("pairKey range", () => {
    it("is exact at the upper id bound and returns a plain number (no BigInt)", () => {
      const max = PAIR_ID_LIMIT - 1;
      expect(typeof pairKey(max - 1, max)).toBe("number");
      expect(pairKey(max - 1, max)).not.toBe(pairKey(max - 2, max));
      expect(pairKey(max - 1, max)).not.toBe(pairKey(max - 1, max - 2));
      expect(Number.isSafeInteger(pairKey(max - 1, max))).toBe(true);
    });

    it("fails fast instead of aliasing for ids outside the exact range", () => {
      expect(() => pairKey(1, PAIR_ID_LIMIT)).toThrow(RangeError);
      expect(() => pairKey(-1, 5)).toThrow(RangeError);
      expect(() => pairKey(1.5, 5)).toThrow(RangeError);
    });
  });

  describe("discovery", () => {
    it("deduplicates an unordered pair within one step", () => {
      const t = new PairTracker();
      t.beginDiscovery();
      expect(t.markDiscovered(3, 7)).toBe(true);
      expect(t.markDiscovered(7, 3)).toBe(false);
      expect(t.markDiscovered(3, 7)).toBe(false);
      expect(t.markDiscovered(3, 8)).toBe(true);
    });

    it("re-enables a pair after the next beginDiscovery", () => {
      const t = new PairTracker();
      t.beginDiscovery();
      expect(t.markDiscovered(3, 7)).toBe(true);
      t.beginDiscovery();
      expect(t.markDiscovered(3, 7)).toBe(true);
    });
  });

  describe("pair pooling", () => {
    it("reuses the pooled pair entry across steps", () => {
      const t = new PairTracker();
      const a = new Object3D("A");
      const b = new Object3D("B");
      t.acquirePair(a, b, 1, 2);
      t.releasePairs();
      const recycled = t.acquirePair(a, b, 1, 2);
      expect(recycled).toBeDefined();
      expect(recycled!.first).toBe(a);
      expect(recycled!.second).toBe(b);
    });

    it("resets pair fields when an entry is reused", () => {
      const t = new PairTracker();
      const a = new Object3D("A");
      const b = new Object3D("B");
      const pair = t.acquirePair(a, b, 1, 2);
      pair.colliding = true;
      pair.depth = 0.5;
      pair.normal.set(0, 1, 0);
      t.releasePairs();
      const reused = t.acquirePair(a, b, 1, 2);
      expect(reused!.colliding).toBe(false);
      expect(reused!.depth).toBe(0);
      expect(reused!.normal.length()).toBe(0);
    });
  });

  describe("lifecycle", () => {
    it("derives wasPresent from the previous step's persistence", () => {
      const events = new EventDispatcherImpl();
      const t = new PairTracker();
      const a = new Object3D("A");
      const b = new Object3D("B");
      const key = pairKey(1, 2);

      t.beginDiscovery();
      const step1 = t.trackTrigger(key);
      step1.objectA = a;
      step1.objectB = b;
      expect(step1.wasPresent).toBe(false);
      t.endStep(events);

      t.beginDiscovery();
      const step2 = t.trackTrigger(key);
      step2.objectA = a;
      step2.objectB = b;
      expect(step2.wasPresent).toBe(true);
      t.endStep(events);
    });

    it("dispatches exit only for pairs absent in the next step", () => {
      const events = new EventDispatcherImpl();
      const t = new PairTracker();
      const a = new Object3D("A");
      const b = new Object3D("B");
      const key = pairKey(1, 2);

      const exits: Array<{ objectA: Object3D; objectB: Object3D }> = [];
      events.addEventListener("physics:trigger-exit", (e) => {
        exits.push(e as { objectA: Object3D; objectB: Object3D });
      });
      events.addEventListener("physics:collision-exit", (e) => {
        exits.push(e as { objectA: Object3D; objectB: Object3D });
      });

      t.beginDiscovery();
      const step1 = t.trackTrigger(key);
      step1.objectA = a;
      step1.objectB = b;
      t.endStep(events);

      t.beginDiscovery();
      const stay = t.trackTrigger(key);
      stay.objectA = a;
      stay.objectB = b;
      t.endStep(events);
      expect(exits.length).toBe(0);

      t.beginDiscovery();
      t.endStep(events);
      expect(exits.length).toBe(1);
      expect(exits[0]!.objectA).toBe(a);
      expect(exits[0]!.objectB).toBe(b);
      expect(exits[0]!.objectA).toBe(a);
    });

    it("returns exited state to the pool and recycles it for a later pair", () => {
      const events = new EventDispatcherImpl();
      const t = new PairTracker();
      const key = pairKey(5, 6);

      t.beginDiscovery();
      const first = t.trackTrigger(key);
      first.objectA = new Object3D("A");
      first.objectB = new Object3D("B");
      t.endStep(events);

      // Pair not present next step -> its state is released back into the pool.
      t.beginDiscovery();
      t.endStep(events);

      // A brand-new pair reuses the released state entry.
      t.beginDiscovery();
      const second = t.trackTrigger(key);
      expect(second).toBe(first);
      expect(second.wasPresent).toBe(false);
      t.endStep(events);
    });

    it("fires exits on a step that discovers no pairs at all", () => {
      const events = new EventDispatcherImpl();
      const t = new PairTracker();
      let exits = 0;
      events.addEventListener("physics:collision-exit", () => exits++);
      const key = pairKey(1, 2);
      t.beginDiscovery();
      const st = t.trackCollision(key);
      st.objectA = new Object3D("A");
      st.objectB = new Object3D("B");
      t.endStep(events);
      expect(exits).toBe(0);
      t.beginDiscovery();
      t.endStep(events); // empty step
      expect(exits).toBe(1);
      t.beginDiscovery();
      t.endStep(events);
      expect(exits).toBe(1); // exit fires exactly once
    });

    it("clear() releases all retained state", () => {
      const events = new EventDispatcherImpl();
      const t = new PairTracker();
      t.beginDiscovery();
      const first = t.trackTrigger(pairKey(9, 10));
      first.objectA = new Object3D("A");
      first.objectB = new Object3D("B");
      t.endStep(events);
      expect(t.activePairs.length).toBe(0);

      t.beginDiscovery();
      const placeholder = t.acquirePair(new Object3D("A"), new Object3D("B"), 9, 10);
      t.releasePairs();
      expect(placeholder).toBeDefined();
      t.clear();
      t.beginDiscovery();
      const recycled = t.trackTrigger(pairKey(9, 10));
      expect(recycled).toBe(first);
    });
  });
});
