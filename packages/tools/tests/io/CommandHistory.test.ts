// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { CommandHistory } from "../../src/common/io/ui/CommandHistory.js";

describe("CommandHistory", () => {
  it("defaults to max 100 entries", () => {
    const history = new CommandHistory();
    for (let i = 0; i < 150; i++) {
      history.push(`cmd_${i}`);
    }
    expect(history.entries.length).toBe(100);
    expect(history.entries[0]).toBe("cmd_50");
    expect(history.entries[99]).toBe("cmd_149");
  });

  it("deduplicates consecutive identical commands", () => {
    const history = new CommandHistory();
    history.push("rotate 90");
    history.push("rotate 90");
    history.push("flip");
    expect(history.entries).toEqual(["rotate 90", "flip"]);
  });

  it("navigates up and down through history with draft preservation", () => {
    const history = new CommandHistory();
    history.push("cmd 1");
    history.push("cmd 2");
    history.push("cmd 3");

    // Start with a draft
    expect(history.navigateUp("my draft")).toBe("cmd 3");
    expect(history.navigateUp("cmd 3")).toBe("cmd 2");
    expect(history.navigateUp("cmd 2")).toBe("cmd 1");
    // At oldest
    expect(history.navigateUp("cmd 1")).toBe("cmd 1");

    // Navigate down
    expect(history.navigateDown("cmd 1")).toBe("cmd 2");
    expect(history.navigateDown("cmd 2")).toBe("cmd 3");
    // Returns draft
    expect(history.navigateDown("cmd 3")).toBe("my draft");
  });

  it("navigates PageUp and PageDown by step", () => {
    const history = new CommandHistory({ pageStep: 5 });
    for (let i = 0; i < 20; i++) {
      history.push(`cmd_${i}`);
    }

    expect(history.navigatePageUp("current")).toBe("cmd_15");
    expect(history.navigatePageUp("cmd_15")).toBe("cmd_10");
    expect(history.navigatePageUp("cmd_10")).toBe("cmd_5");
    expect(history.navigatePageUp("cmd_5")).toBe("cmd_0");
    expect(history.navigatePageUp("cmd_0")).toBe("cmd_0");

    expect(history.navigatePageDown("cmd_0")).toBe("cmd_5");
    expect(history.navigatePageDown("cmd_5")).toBe("cmd_10");
    expect(history.navigatePageDown("cmd_10")).toBe("cmd_15");
    expect(history.navigatePageDown("cmd_15")).toBe("current");
  });

  it("binds to HTML input element and intercepts keys", () => {
    const history = new CommandHistory();
    history.push("first command");
    history.push("second command");

    const input = document.createElement("input");
    input.value = "partial typing";
    const unbind = history.bindInput(input);

    const upEvent = new KeyboardEvent("keydown", { key: "ArrowUp", cancelable: true });
    input.dispatchEvent(upEvent);
    expect(upEvent.defaultPrevented).toBe(true);
    expect(input.value).toBe("second command");

    const downEvent = new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true });
    input.dispatchEvent(downEvent);
    expect(downEvent.defaultPrevented).toBe(true);
    expect(input.value).toBe("partial typing");

    unbind();
  });
});
