// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { ForgeToolMode } from "../../src/maker/ForgeToolMode.js";
import { ToolModeHost } from "../../src/maker/ToolModeHost.js";
import { TestForgeTool } from "../testForgeTool.js";

function surface(): HTMLElement {
  const el = document.createElement("div");
  el.hidden = true;
  return el;
}

describe("ForgeToolMode", () => {
  it("shows the surface and mounts a fresh tool into it", () => {
    const el = surface();
    const mode = new ForgeToolMode("t", (parent) => new TestForgeTool({ parent }));

    mode.mount(el);

    expect(el.hidden).toBe(false);
    expect(el.dataset["mode"]).toBe("t");
    expect(el.children.length).toBe(1);
  });

  it("removes the tool and hides the surface on unmount", () => {
    const el = surface();
    const mode = new ForgeToolMode("t", (parent) => new TestForgeTool({ parent }));

    mode.mount(el);
    mode.unmount();

    expect(el.hidden).toBe(true);
    expect(el.dataset["mode"]).toBeUndefined();
    expect(el.children.length).toBe(0);
  });

  it("restores the document into a new tool instance after a round trip", () => {
    const el = surface();
    const created: TestForgeTool[] = [];
    const mode = new ForgeToolMode("t", (parent) => {
      const tool = new TestForgeTool({ parent });
      created.push(tool);
      return tool;
    });

    mode.mount(el);
    created[0]!.state = "document-1";
    mode.unmount();
    mode.mount(el);

    expect(created.length).toBe(2);
    expect(created[1]).not.toBe(created[0]);
    expect(created[1]!.state).toBe("document-1");
  });

  it("parks state set while unmounted and applies it on the next mount", () => {
    const el = surface();
    let tool: TestForgeTool | undefined;
    const mode = new ForgeToolMode("t", (parent) => (tool = new TestForgeTool({ parent })));

    mode.setState("handed-over");
    expect(mode.getState()).toBe("handed-over");
    mode.mount(el);

    expect(tool!.state).toBe("handed-over");
  });

  it("passes a null snapshot through without calling setState", () => {
    const el = surface();
    const tools: TestForgeTool[] = [];
    const mode = new ForgeToolMode("t", (parent) => {
      const tool = new TestForgeTool({ parent });
      vi.spyOn(tool, "setState");
      tools.push(tool);
      return tool;
    });

    mode.mount(el);
    mode.unmount();
    mode.mount(el);

    expect(tools[1]!.setState).not.toHaveBeenCalled();
  });

  it("runs the extra disposer after the tool unmounted", () => {
    const order: string[] = [];
    const mode = new ForgeToolMode(
      "t",
      (parent) => {
        const tool = new TestForgeTool({ parent });
        vi.spyOn(tool, "unmount").mockImplementation(() => {
          order.push("unmount");
        });
        return tool;
      },
      () => order.push("dispose"),
    );

    mode.mount(surface());
    mode.unmount();

    expect(order).toEqual(["unmount", "dispose"]);
  });

  it("swaps cleanly between two modes inside a ToolModeHost sharing one surface", () => {
    const el = surface();
    const host = new ToolModeHost(el);
    host.register(new ForgeToolMode("a", (parent) => new TestForgeTool({ parent })));
    host.register(new ForgeToolMode("b", (parent) => new TestForgeTool({ parent })));

    host.activate("a");
    host.activate("b");

    expect(el.dataset["mode"]).toBe("b");
    expect(el.hidden).toBe(false);
    expect(el.children.length).toBe(1);
  });
});
