// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UnifiedIngestPanel } from "../src/common/io/ui/UnifiedIngestPanel.js";

describe("UnifiedIngestPanel", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("renders 3 tabs and switches modes properly", () => {
    const onFile = vi.fn();
    const onUrl = vi.fn();
    const onText = vi.fn();

    const panel = new UnifiedIngestPanel({
      container,
      modes: ["file", "url", "text"],
      defaultMode: "file",
      onFile,
      onUrl,
      onText,
    });

    expect(panel.activeMode).toBe("file");
    const tabs = container.querySelectorAll<HTMLButtonElement>(".dropzone-tab");
    expect(tabs.length).toBe(3);

    // Switch to URL
    panel.setMode("url");
    expect(panel.activeMode).toBe("url");
    const activePanel = container.querySelector<HTMLElement>(".dropzone-panel.active");
    expect(activePanel?.dataset["mode"]).toBe("url");

    panel.dispose();
  });

  it("triggers onUrl on enter or button click", () => {
    const onUrl = vi.fn();
    const panel = new UnifiedIngestPanel({
      container,
      modes: ["url"],
      onUrl,
    });

    const input = container.querySelector<HTMLInputElement>(".dropzone-input")!;
    const btn = container.querySelector<HTMLButtonElement>(".dropzone-btn")!;

    input.value = "https://example.com/asset.json";
    btn.click();
    expect(onUrl).toHaveBeenCalledWith("https://example.com/asset.json");

    panel.dispose();
  });

  it("triggers onText on apply button click", () => {
    const onText = vi.fn();
    const panel = new UnifiedIngestPanel({
      container,
      modes: ["text"],
      onText,
    });

    const textarea = container.querySelector<HTMLTextAreaElement>(".dropzone-textarea")!;
    const btn = container.querySelector<HTMLButtonElement>(".dropzone-btn")!;

    textarea.value = "WWWW\nW..W\nWWWW";
    btn.click();
    expect(onText).toHaveBeenCalledWith("WWWW\nW..W\nWWWW");

    panel.dispose();
  });

  it("handles clipboard paste when enablePaste is true", () => {
    const onText = vi.fn();
    const panel = new UnifiedIngestPanel({
      container,
      modes: ["text"],
      enablePaste: true,
      onText,
    });

    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        items: [] as DataTransferItem[],
        getData: (type: string): string => (type === "text" ? "WWWW\nW..W\nWWWW" : ""),
      },
    });

    window.dispatchEvent(pasteEvent);
    expect(onText).toHaveBeenCalledWith("WWWW\nW..W\nWWWW");

    panel.dispose();
  });
});
