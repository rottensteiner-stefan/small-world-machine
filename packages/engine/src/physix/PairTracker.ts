import { Vector3D } from "../math/index.js";
import type { EventDispatcherImpl } from "../core/events/EventDispatcherImpl.js";
import type { Collidable } from "../interfaces/index.js";

/** A resolved contact pair between two world colliders. */
export interface ContactPair {
  first: Collidable;
  second: Collidable;
  idA: number;
  idB: number;
  colliding: boolean;
  normal: Vector3D;
  depth: number;
}

/** A persistent pair state used to derive enter/stay/exit events across frames. */
export interface ContactPairState {
  objectA: Collidable;
  objectB: Collidable;
  normal: Vector3D;
  depth: number;
  impulse: number;
}

/**
 * 64-bit pair key combining two ids using BigInt to prevent precision loss above 2^21.
 * Symmetric canonical ordering: `key(a, b) === key(b, a)`. This is the single pair key
 * implementation in the engine; every pair consumer (discovery dedup, lifecycle state)
 * derives its identities from here.
 */
export function pairKey(idA: number, idB: number): bigint {
  const a = idA < idB ? idA : idB;
  const b = idA < idB ? idB : idA;
  return (BigInt(a) << 32n) | BigInt(b);
}

/**
 * Single owner of pair identity and lifecycle for one physics step.
 *
 * This consolidates everything that used to be split across the owner system and the contact
 * solver: the pair-key implementation, the per-step discovery dedup set, the pooled
 * `ContactPair` entries fed to the solve step, and the pooled enter/stay/exit `ContactPairState`
 * bookkeeping used to derive trigger/collision events across frames. The pools are returned to
 * the tracker after every step, so a leaked or double-held pair cannot grow the pool unboundedly.
 *
 * The tracker is not re-entrant: one instance is used by one solve pass at a time.
 */
export class PairTracker {
  // --- Per-step discovery dedup -------------------------------------------------------------
  private readonly _seenKeys = new Set<bigint>();

  // --- Pooled ContactPair entries (owned by the broadphase discovery, consumed by the solver) --
  private readonly _pairPool: ContactPair[] = [];
  private _activePairs: ContactPair[] = [];

  // --- Pooled enter/stay/exit state (owned by the solver's lifecycle bookkeeping) ------------
  private readonly _statePool: ContactPairState[] = [];
  private _currentTriggerPairs = new Map<bigint, ContactPairState>();
  private _prevTriggerPairs = new Map<bigint, ContactPairState>();
  private _currentCollisionPairs = new Map<bigint, ContactPairState>();
  private _prevCollisionPairs = new Map<bigint, ContactPairState>();

  /** The pairs discovered this step (sorted in place by the caller before solving). */
  public get activePairs(): ContactPair[] {
    return this._activePairs;
  }

  /** Call at the start of a physics step so the previous discovery set is forgotten. */
  public beginDiscovery(): void {
    this._seenKeys.clear();
  }

  /**
   * Marks a pair as part of this step's discovery. Returns `true` only the first time the pair
   * is seen within the step, so the broadphase discovers each unordered pair exactly once.
   */
  public markDiscovered(idA: number, idB: number): boolean {
    const key = pairKey(idA, idB);
    if (this._seenKeys.has(key)) return false;
    this._seenKeys.add(key);
    return true;
  }

  /** Acquires a pooled ContactPair entry and registers it as an active pair for this step. */
  public acquirePair(first: Collidable, second: Collidable, idA: number, idB: number): ContactPair {
    const pair = this._pairPool.pop();
    let entry: ContactPair;
    if (pair) {
      pair.first = first;
      pair.second = second;
      pair.idA = idA;
      pair.idB = idB;
      pair.colliding = false;
      pair.normal.set(0, 0, 0);
      pair.depth = 0;
      entry = pair;
    } else {
      entry = {
        first,
        second,
        idA,
        idB,
        colliding: false,
        normal: new Vector3D(),
        depth: 0,
      };
    }
    this._activePairs.push(entry);
    return entry;
  }

  /** Returns every active pair entry to the pool and empties the active list (end of step). */
  public releasePairs(): void {
    for (let i = 0; i < this._activePairs.length; i++) {
      this._pairPool.push(this._activePairs[i]!);
    }
    this._activePairs.length = 0;
  }

  /**
   * Registers a trigger pair for this step and returns its pooled state plus whether the pair
   * was already present last step (so the caller can dispatch enter vs. stay, then the shared
   * `physics:trigger` / `physics:collision` events).
   */
  public trackTrigger(key: bigint): { state: ContactPairState; wasPresent: boolean } {
    const wasPresent = this._prevTriggerPairs.has(key);
    let state = this._currentTriggerPairs.get(key);
    if (!state) {
      state = this._acquireState();
      this._currentTriggerPairs.set(key, state);
    }
    return { state, wasPresent };
  }

  /** See {@link trackTrigger} — the collision-pair counterpart. */
  public trackCollision(key: bigint): { state: ContactPairState; wasPresent: boolean } {
    const wasPresent = this._prevCollisionPairs.has(key);
    let state = this._currentCollisionPairs.get(key);
    if (!state) {
      state = this._acquireState();
      this._currentCollisionPairs.set(key, state);
    }
    return { state, wasPresent };
  }

  /**
   * Ends the step's lifecycle bookkeeping: dispatches `exit` events for every previously tracked
   * pair that did not recur, releases the previous states back to the pool and rolls the current
   * maps into the previous slot for the next step. Must be called exactly once per step.
   */
  public endStep(events: EventDispatcherImpl): void {
    for (const [key, state] of this._prevTriggerPairs) {
      if (!this._currentTriggerPairs.has(key)) {
        events.dispatchEvent("physics:trigger-exit", {
          objectA: state.objectA,
          objectB: state.objectB,
        });
      }
      this._releaseState(state);
    }
    this._prevTriggerPairs.clear();
    const tempTrig = this._prevTriggerPairs;
    this._prevTriggerPairs = this._currentTriggerPairs;
    this._currentTriggerPairs = tempTrig;

    for (const [key, state] of this._prevCollisionPairs) {
      if (!this._currentCollisionPairs.has(key)) {
        events.dispatchEvent("physics:collision-exit", {
          objectA: state.objectA,
          objectB: state.objectB,
        });
      }
      this._releaseState(state);
    }
    this._prevCollisionPairs.clear();
    const tempColl = this._prevCollisionPairs;
    this._prevCollisionPairs = this._currentCollisionPairs;
    this._currentCollisionPairs = tempColl;
  }

  /**
   * Releases all tracked pair state and resets the enter/stay/exit bookkeeping.
   */
  public clear(): void {
    for (const [, state] of this._prevTriggerPairs) {
      this._releaseState(state);
    }
    this._prevTriggerPairs.clear();
    for (const [, state] of this._currentTriggerPairs) {
      this._releaseState(state);
    }
    this._currentTriggerPairs.clear();
    for (const [, state] of this._prevCollisionPairs) {
      this._releaseState(state);
    }
    this._prevCollisionPairs.clear();
    for (const [, state] of this._currentCollisionPairs) {
      this._releaseState(state);
    }
    this._currentCollisionPairs.clear();
    this.releasePairs();
    this._seenKeys.clear();
  }

  private _acquireState(): ContactPairState {
    const s = this._statePool.pop();
    if (s) {
      s.depth = 0;
      s.impulse = 0;
      s.normal.set(0, 0, 0);
      return s;
    }
    return {
      objectA: undefined as unknown as Collidable,
      objectB: undefined as unknown as Collidable,
      normal: new Vector3D(),
      depth: 0,
      impulse: 0,
    };
  }

  private _releaseState(state: ContactPairState): void {
    state.objectA = undefined as unknown as Collidable;
    state.objectB = undefined as unknown as Collidable;
    this._statePool.push(state);
  }
}
