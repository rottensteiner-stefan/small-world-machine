// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { TestForgeTool } from "./testForgeTool.js";

describe("ForgeTool", () => {
  it("should create a full-size container div", () => {
    const tool = new TestForgeTool();
    const container = tool.getContainer();
    expect(container.style.width).toBe("100%");
    expect(container.style.height).toBe("100%");
  });

  it("should auto-mount into a parent when provided in options", () => {
    const parent = document.createElement("div");
    const tool = new TestForgeTool({ parent });
    expect(parent.contains(tool.getContainer())).toBe(true);
  });

  it("should mount into a given parent", () => {
    const tool = new TestForgeTool();
    const parent = document.createElement("div");
    tool.mount(parent);
    expect(parent.contains(tool.getContainer())).toBe(true);
  });

  it("should unmount from its parent", () => {
    const parent = document.createElement("div");
    const tool = new TestForgeTool({ parent });
    tool.unmount();
    expect(parent.contains(tool.getContainer())).toBe(false);
  });

  it("should not throw when unmounting a tool that was never mounted", () => {
    const tool = new TestForgeTool();
    expect(() => tool.unmount()).not.toThrow();
  });

  it("should round-trip custom state through get/setState", () => {
    const tool = new TestForgeTool();
    tool.setState({ foo: "bar" });
    expect(tool.getState()).toEqual({ foo: "bar" });
  });
});
