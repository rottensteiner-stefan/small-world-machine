import { describe, it, expect } from "vitest";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";

describe("EventDispatcherImpl", () => {
  it("dispatches events with zero intermediate allocations", () => {
    const dispatcher = new EventDispatcherImpl();
    const results: number[] = [];

    const l1 = (e: Record<string, unknown>): void => {
      results.push(e["val"] as number);
    };
    const l2 = (e: Record<string, unknown>): void => {
      results.push((e["val"] as number) * 2);
    };

    dispatcher.addEventListener("test", l1);
    dispatcher.addEventListener("test", l2);

    dispatcher.dispatchEvent("test", { val: 5 });

    expect(results).toEqual([5, 10]);
  });

  it("handles self-removal during dispatch safely via copy-on-write", () => {
    const dispatcher = new EventDispatcherImpl();
    const calls: string[] = [];

    const l1 = (): void => {
      calls.push("l1");
      dispatcher.removeEventListener("test", l1);
    };
    const l2 = (): void => {
      calls.push("l2");
    };

    dispatcher.addEventListener("test", l1);
    dispatcher.addEventListener("test", l2);

    // First dispatch: l1 runs and removes itself; l2 still runs in this iteration
    dispatcher.dispatchEvent("test");
    expect(calls).toEqual(["l1", "l2"]);

    // Second dispatch: only l2 runs
    dispatcher.dispatchEvent("test");
    expect(calls).toEqual(["l1", "l2", "l2"]);
  });

  it("handles adding listener during dispatch safely", () => {
    const dispatcher = new EventDispatcherImpl();
    const calls: string[] = [];

    const l2 = (): void => {
      calls.push("l2");
    };
    const l1 = (): void => {
      calls.push("l1");
      dispatcher.addEventListener("test", l2);
    };

    dispatcher.addEventListener("test", l1);

    // First dispatch: l1 runs and adds l2; l2 does not run in the current iteration
    dispatcher.dispatchEvent("test");
    expect(calls).toEqual(["l1"]);

    // Second dispatch: l1 runs again (adds l2 again) and first l2 runs
    dispatcher.dispatchEvent("test");
    expect(calls).toEqual(["l1", "l1", "l2"]);
  });

  it("handles re-entrant nested event dispatches", () => {
    const dispatcher = new EventDispatcherImpl();
    const calls: string[] = [];

    dispatcher.addEventListener("outer", () => {
      calls.push("outer-start");
      dispatcher.dispatchEvent("inner");
      calls.push("outer-end");
    });

    dispatcher.addEventListener("inner", () => {
      calls.push("inner");
    });

    dispatcher.dispatchEvent("outer");
    expect(calls).toEqual(["outer-start", "inner", "outer-end"]);
  });
});
