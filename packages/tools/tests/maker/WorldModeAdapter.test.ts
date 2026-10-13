// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { DEFAULT_MODE_ID } from "../../src/maker/ToolMode.js";
import { ToolModeHost } from "../../src/maker/ToolModeHost.js";
import { WorldModeAdapter } from "../../src/maker/WorldModeAdapter.js";

describe("WorldModeAdapter", () => {
  it("uses the reserved default world mode id", () => {
    expect(new WorldModeAdapter().modeId).toBe(DEFAULT_MODE_ID);
  });

  it("is stateless and keeps its lifecycle inert", () => {
    const adapter = new WorldModeAdapter();
    const hostEl = document.createElement("div");

    expect(() => {
      adapter.initialize();
      adapter.mount(hostEl);
      adapter.unmount();
    }).not.toThrow();
    expect(adapter.getState()).toBeUndefined();
    expect(() => adapter.setState({ any: "state" })).not.toThrow();
  });

  it("registers and activates as the default mode in a host", () => {
    const host = new ToolModeHost(document.createElement("div"));
    host.register(new WorldModeAdapter());

    host.activate(DEFAULT_MODE_ID);

    expect(host.activeModeId).toBe(DEFAULT_MODE_ID);
    expect(host.modeIds).toEqual([DEFAULT_MODE_ID]);
  });
});
