// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { ToolModeHost } from "../../src/maker/ToolModeHost.js";
import type { ToolMode } from "../../src/maker/ToolMode.js";

interface FakeMode extends ToolMode {
  mounts: HTMLElement[];
  mountsCount: number;
  unmountsCount: number;
  initializeCount: number;
}

function fakeMode(id: string): FakeMode {
  const mode: FakeMode = {
    modeId: id,
    mounts: [],
    mountsCount: 0,
    unmountsCount: 0,
    initializeCount: 0,
    initialize(): void {
      mode.initializeCount += 1;
    },
    mount(hostEl: HTMLElement): void {
      mode.mounts.push(hostEl);
      mode.mountsCount += 1;
    },
    unmount(): void {
      mode.unmountsCount += 1;
    },
    getState(): unknown {
      return undefined;
    },
    setState(_state: unknown): void {},
  };
  return mode;
}

describe("ToolModeHost", () => {
  it("starts with no active mode and empty mode list", () => {
    const hostEl = document.createElement("div");
    const host = new ToolModeHost(hostEl);
    expect(host.activeModeId).toBeUndefined();
    expect(host.modeIds).toEqual([]);
  });

  it("registers and lazily mounts a mode into the host element on activation", () => {
    const hostEl = document.createElement("div");
    const host = new ToolModeHost(hostEl);
    const mode = fakeMode("foo");
    host.register(mode);

    expect(host.has("foo")).toBe(true);
    expect(mode.mountsCount).toBe(0);

    host.activate("foo");

    expect(host.activeModeId).toBe("foo");
    expect(mode.mountsCount).toBe(1);
    expect(mode.mounts[0]).toBe(hostEl);
  });

  it("does not re-mount a mode that is already active", () => {
    const host = new ToolModeHost(document.createElement("div"));
    const mode = fakeMode("foo");
    host.register(mode);

    host.activate("foo");
    host.activate("foo");

    expect(host.activeModeId).toBe("foo");
    expect(mode.mountsCount).toBe(1);
    expect(mode.unmountsCount).toBe(0);
  });

  it("enforces exactly one active mode and unmounts the previous one on switch", () => {
    const host = new ToolModeHost(document.createElement("div"));
    const a = fakeMode("a");
    const b = fakeMode("b");
    host.register(a);
    host.register(b);

    host.activate("a");
    host.activate("b");

    expect(host.activeModeId).toBe("b");
    expect(a.unmountsCount).toBe(1);
    expect(b.mountsCount).toBe(1);
    expect(b.unmountsCount).toBe(0);
  });

  it("initializes each mode exactly once across mount/unmount cycles", () => {
    const host = new ToolModeHost(document.createElement("div"));
    const a = fakeMode("a");
    const b = fakeMode("b");
    host.register(a);
    host.register(b);

    host.activate("a");
    host.activate("b");
    host.activate("a");
    host.activate("b");
    host.activate("a");

    expect(a.initializeCount).toBe(1);
    expect(b.initializeCount).toBe(1);
    expect(a.mountsCount).toBe(3);
    expect(b.mountsCount).toBe(2);
  });

  it("fails fast when an unknown mode is activated", () => {
    const host = new ToolModeHost(document.createElement("div"));
    expect(() => host.activate("nope")).toThrow(/unknown mode 'nope'/);
  });

  it("fails fast on duplicate registration", () => {
    const host = new ToolModeHost(document.createElement("div"));
    host.register(fakeMode("foo"));
    expect(() => host.register(fakeMode("foo"))).toThrow(/already registered/);
  });

  it("unmounts and clears the active mode on unregister", () => {
    const host = new ToolModeHost(document.createElement("div"));
    const mode = fakeMode("foo");
    host.register(mode);
    host.activate("foo");

    host.unregister("foo");

    expect(host.activeModeId).toBeUndefined();
    expect(mode.unmountsCount).toBe(1);
    expect(host.has("foo")).toBe(false);
  });

  it("is a silent no-op when unregistering an unknown mode", () => {
    const host = new ToolModeHost(document.createElement("div"));
    host.register(fakeMode("foo"));
    expect(() => host.unregister("nope")).not.toThrow();
    expect(host.modeIds).toEqual(["foo"]);
  });
});
