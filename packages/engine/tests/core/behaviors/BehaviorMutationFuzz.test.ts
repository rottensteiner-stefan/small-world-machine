import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { Camera } from "../../../src/core/cameras/Camera.js";
import { PerspectiveProjection } from "../../../src/math/projections/PerspectiveProjection.js";
import { Scene } from "../../../src/core/Scene.js";
import { Object3D } from "../../../src/core/Object3D.js";
import { Behavior } from "../../../src/core/behaviors/Behavior.js";
import { Vector3D } from "../../../src/math/index.js";

/**
 * @invariant BEHAVIOR-MUTATION-SAFETY: Beliebige detach/remove-append-Sequenzen auf den
 *   Behavior-Listen von Scene UND Camera während `update()` sind sicher und folgen exakt der
 *   dokumentierten Slot-Revisit-Semantik (S3 DP-6A): kein Skip, kein Doppel-Run, kein Crash.
 *   Diskretisiert als Äquivalenz zu einem unabhängigen Referenz-Interpreter des Slice-Guard-
 *   Vertrags über property-generierte Mutationsskripte. Seed-gepinnt (PBT nach ADR-0047-D11 /
 *   E5) — `numRuns` klein, deterministisch reproduzierbar.
 */

interface ScriptStep {
  kind: "OBSERVER" | "SELF_REMOVE" | "REMOVE_SIBLING" | "APPEND";
  /** fuzzId des zu entfernenden Ziels (nur REMOVE_SIBLING). */
  target?: number;
}

interface RefResult {
  runs: Map<number, number>;
  finish: number[];
}

/** Unabhängiger Referenz-Interpreter des Slice-Revisit-Vertrags (explizite Positionsverwaltung,
 * NICHT die Engine-Schleife): Identität am aktuellen Slot geändert => Slot wird REBESUCHT. */
function referencePass(script: ScriptStep[]): RefResult {
  const beams: { id: number; step: ScriptStep }[] = script.map((s, i) => ({ id: i, step: s }));
  const runs = new Map<number, number>();
  const indexById = new Map<number, number>();
  beams.forEach((b, i) => indexById.set(b.id, i));
  let nextFresh = 100000;
  let i = 0;
  while (i >= 0 && i < beams.length) {
    const cur = beams[i]!;
    runs.set(cur.id, (runs.get(cur.id) ?? 0) + 1);

    const step = cur.step;
    if (step.kind === "SELF_REMOVE") {
      const idx = indexById.get(cur.id)!;
      beams.splice(idx, 1);
      for (let k = idx; k < beams.length; k++) indexById.set(beams[k]!.id, k);
      indexById.delete(cur.id);
      if (idx <= i) i -= 1; // Identität am Slot i geändert -> Revisit
    } else if (step.kind === "REMOVE_SIBLING" && step.target !== undefined) {
      const tIdx = indexById.get(step.target);
      if (tIdx !== undefined && tIdx !== i) {
        beams.splice(tIdx, 1);
        for (let k = tIdx; k < beams.length; k++) indexById.set(beams[k]!.id, k);
        indexById.delete(step.target);
        if (tIdx < i) i -= 1; // Vorgänger-Slot entfernt -> ein Slot nach vorne
      }
    } else if (step.kind === "APPEND") {
      const fresh: { id: number; step: ScriptStep } = {
        id: nextFresh++,
        step: { kind: "OBSERVER" },
      };
      beams.push(fresh);
      indexById.set(fresh.id, beams.length - 1);
    }

    i += 1;
  }
  return { runs, finish: beams.map((b) => b.id) };
}

interface BehaviorOwner {
  behaviors: Behavior[];
  addBehavior(b: Behavior): unknown;
  removeBehavior(b: Behavior): unknown;
}

/** Basis-Zähler für ALLE Fuzz-Subklassen (Engine-Messung == Referenz-Zählung je Instanz). */
class FuzzBehavior extends Behavior {
  public runs = 0;
  constructor(public readonly fuzzId: number) {
    super();
  }
  /** Urmodell: no-op update, damit die abstrakte Basis erfüllt ist. */
  public override update(_deltaTime: number): void {
    /* no-op base; subclasses override */
  }
}

class ObserverBehavior extends FuzzBehavior {
  public override update(): void {
    this.runs++;
  }
}

class SelfRemoveBehavior extends FuzzBehavior {
  constructor(
    fuzzId: number,
    private readonly _owner: BehaviorOwner,
  ) {
    super(fuzzId);
  }
  public override update(): void {
    this.runs++;
    this._owner.removeBehavior(this);
  }
}

class RemoveSiblingBehavior extends FuzzBehavior {
  constructor(
    fuzzId: number,
    private readonly _owner: BehaviorOwner,
    private readonly _targetFuzzId: number,
  ) {
    super(fuzzId);
  }
  public override update(): void {
    this.runs++;
    const target = this._owner.behaviors.find(
      (b) => (b as FuzzBehavior).fuzzId === this._targetFuzzId && b !== this,
    );
    if (target) this._owner.removeBehavior(target);
  }
}

class AppendObserverBehavior extends FuzzBehavior {
  constructor(
    fuzzId: number,
    private readonly _owner: BehaviorOwner,
  ) {
    super(fuzzId);
  }
  public override update(): void {
    this.runs++;
    // Frische Observer-IDs werden zur LAUFZEIT vergeben (Reihenfolge == Ausführungsreihenfolge),
    // exakt wie der Referenz-Interpreter (nextFresh pro ausgeführten APPEND).
    const fresh = new ObserverBehavior(runtimeFreshCounter++);
    _trackedFuzz.push(fresh);
    this._owner.addBehavior(fresh);
  }
}

// Referenz: frisch erzeugte Observer-Elemente bekommen Laufzeit-IDs in AUSFÜHRUNGS-Reihenfolge.
let runtimeFreshCounter = 100000;
let _trackedFuzz: FuzzBehavior[] = [];

const FUZZ_SEED = 0xf00d5eed;

const scriptArb: fc.Arbitrary<ScriptStep[]> = fc.array(
  fc.oneof(
    { weight: 4, arbitrary: fc.constant<ScriptStep>({ kind: "OBSERVER" }) },
    { weight: 2, arbitrary: fc.constant<ScriptStep>({ kind: "SELF_REMOVE" }) },
    {
      weight: 2,
      arbitrary: fc
        .integer({ min: 0, max: 7 })
        .map((target) => ({ kind: "REMOVE_SIBLING", target }) as ScriptStep),
    },
    { weight: 2, arbitrary: fc.constant<ScriptStep>({ kind: "APPEND" }) },
  ),
  { minLength: 4, maxLength: 10 },
);

/** Instanziiert reale Behaviors zu einem Skript; fuzzId = Array-Index. */
function instantiate(
  script: ScriptStep[],
  owner: BehaviorOwner,
): { bs: FuzzBehavior[]; tracked: FuzzBehavior[] } {
  runtimeFreshCounter = 100000;
  _trackedFuzz = [];
  const out: FuzzBehavior[] = [];
  for (let idx = 0; idx < script.length; idx++) {
    const s = script[idx]!;
    let b: FuzzBehavior;
    if (s.kind === "OBSERVER") b = new ObserverBehavior(idx);
    else if (s.kind === "SELF_REMOVE") b = new SelfRemoveBehavior(idx, owner);
    else if (s.kind === "REMOVE_SIBLING") b = new RemoveSiblingBehavior(idx, owner, s.target!);
    else b = new AppendObserverBehavior(idx, owner);
    _trackedFuzz.push(b);
    out.push(b);
  }
  return { bs: out, tracked: _trackedFuzz };
}

/** Sammelt die tatsächlichen Run-Counts ALLER Instanzen (Originale UND frisch Erzeugte). */
function collectEngineRuns(tracked: FuzzBehavior[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const f of tracked) map.set(f.fuzzId, f.runs);
  return map;
}

describe("BEHAVIOR-MUTATION-SAFETY (seed-pinned mutation fuzz, Scene + Camera)", () => {
  const driver = fc.property(scriptArb, (script: ScriptStep[]) => {
    // REMOVE_SIBLING-Ziele auf existierende fuzzIds begrenzen.
    const bounded: ScriptStep[] = script.map((s) =>
      s.kind === "REMOVE_SIBLING" ? { ...s, target: Math.min(s.target!, script.length - 1) } : s,
    );

    // ---- Referenz-Erwartung ----
    const expected = referencePass(bounded);

    // ---- Scene-Pfad ----
    const scene = new Scene();
    const host = new Object3D("FuzzHost");
    scene.add(host);
    const sceneI = instantiate(bounded, host);
    for (const b of sceneI.bs) host.addBehavior(b);
    expect(() =>
      (
        scene as unknown as { _updateBehaviorsRecursive(o: Object3D, d: number): void }
      )._updateBehaviorsRecursive(host, 0.016),
    ).not.toThrow();

    // ---- Camera-Pfad ----
    const camera = new Camera(
      new PerspectiveProjection({ fov: Math.PI / 3, aspect: 1.5, near: 0.1, far: 1000 }),
    );
    const camI = instantiate(bounded, camera);
    for (const b of camI.bs) camera.addBehavior(b);
    expect(() => camera.update(new Vector3D(), 0, 0, 0.016)).not.toThrow();

    // ---- Äquivalenz zum Referenzvertrag: identische Run-Counts (kein Skip, kein Doppel-Run). ----
    const sceneRuns = collectEngineRuns(sceneI.tracked);
    const camRuns = collectEngineRuns(camI.tracked);

    // Alle Referenz-Runs (Original UND fresh) müssen exakt im Engine-Trace auftauchen.
    for (const [id, expectedRuns] of expected.runs) {
      expect(sceneRuns.get(id)).toBe(expectedRuns);
      expect(camRuns.get(id)).toBe(expectedRuns);
    }
    // Keine ausführbaren Engine-Runs außerhalb der Referenz (keine Geister-Runs); nicht
    // ausführbar entfernte Verhalten (runs === 0) sind keine Runs und daher ausgenommen.
    for (const [id, runs] of sceneRuns) if (runs > 0) expect(expected.runs.has(id)).toBe(true);
    for (const [id, runs] of camRuns) if (runs > 0) expect(expected.runs.has(id)).toBe(true);
    // Jedes am Ende noch vorhandene Verhalten wurde mindestens einmal ausgeführt.
    for (const id of expected.finish) expect(expected.runs.get(id) ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("is crash-free and matches the reference slot-revisit semantics for both Scene and Camera (seed-pinned)", () => {
    fc.assert(driver, { numRuns: 100, seed: FUZZ_SEED });
  });

  it("is deterministically reproducible from a fixed literal script", () => {
    // Zwei unabhängige, identische Skripte (fester Literal) müssen bit-identische Traces liefern.
    const SCRIPT: ScriptStep[] = [
      { kind: "OBSERVER" },
      { kind: "REMOVE_SIBLING", target: 0 },
      { kind: "SELF_REMOVE" },
      { kind: "APPEND" },
      { kind: "OBSERVER" },
    ];
    const runOnce = (): string => {
      const camera = new Camera(
        new PerspectiveProjection({ fov: Math.PI / 3, aspect: 1.5, near: 0.1, far: 1000 }),
      );
      const { bs, tracked } = instantiate(SCRIPT, camera);
      for (const b of bs) camera.addBehavior(b);
      camera.update(new Vector3D(), 0, 0, 0.016);
      return JSON.stringify([...collectEngineRuns(tracked).entries()].sort((a, b) => a[0] - b[0]));
    };
    expect(runOnce()).toBe(runOnce());
  });
});
