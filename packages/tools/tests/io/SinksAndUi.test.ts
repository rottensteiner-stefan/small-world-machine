// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DirectoryAssetSink } from "../../src/common/io/sinks/DirectoryAssetSink.js";
import { DownloadAssetSink } from "../../src/common/io/sinks/DownloadAssetSink.js";
import { ToastManager } from "../../src/common/io/ui/ToastManager.js";
import { ToolDropOverlay } from "../../src/common/io/ui/ToolDropOverlay.js";
import { ValidationReportModal } from "../../src/common/io/ui/ValidationReportModal.js";
import { bindToolShortcuts } from "../../src/common/io/ui/bindToolShortcuts.js";

beforeEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

function fakeDirectory(written: Map<string, string>, prefix = ""): FileSystemDirectoryHandle {
  return {
    getDirectoryHandle: async (name: string): Promise<FileSystemDirectoryHandle> =>
      fakeDirectory(written, `${prefix}${name}/`),
    getFileHandle: async (name: string): Promise<unknown> => ({
      createWritable: async (): Promise<unknown> => ({
        write: async (data: string | ArrayBuffer): Promise<void> => {
          written.set(
            `${prefix}${name}`,
            typeof data === "string" ? data : new TextDecoder().decode(data),
          );
        },
        close: async (): Promise<void> => {},
      }),
    }),
  } as unknown as FileSystemDirectoryHandle;
}

describe("DirectoryAssetSink", () => {
  it("creates nested folders and sanitizes traversal", async () => {
    const written = new Map<string, string>();
    const sink = new DirectoryAssetSink(fakeDirectory(written));
    await sink.write("props/a/kit.json", "{}");
    await sink.write("../../escape.txt", new TextEncoder().encode("x"));
    await sink.finalize();
    expect([...written.keys()].sort()).toEqual(["escape.txt", "props/a/kit.json"]);
  });
});

describe("DownloadAssetSink", () => {
  it("downloads the single written file and rejects a second one", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const sink = new DownloadAssetSink("out.json");
    await sink.write("out.json", "{}");
    await expect(sink.write("again.json", "{}")).rejects.toThrow(/second one/);
    const blob = await sink.finalize();
    expect(blob.type).toBe("application/json");
    expect(click).toHaveBeenCalledOnce();
  });

  it("throws when nothing was written", async () => {
    await expect(new DownloadAssetSink("x.json").finalize()).rejects.toThrow(/Nothing/);
  });
});

describe("ToastManager", () => {
  it("shows, dismisses on click and disposes without a global instance", () => {
    const a = new ToastManager();
    const b = new ToastManager();
    a.error("boom");
    const toast = document.querySelector(".sw-io-toast") as HTMLElement;
    expect(toast.dataset["kind"]).toBe("error");
    expect(toast.textContent).toBe("boom");
    toast.click();
    expect(document.querySelector(".sw-io-toast")).toBeNull();
    a.dispose();
    b.dispose();
    expect(document.querySelector(".sw-io-toasts")).toBeNull();
  });
});

describe("ToolDropOverlay", () => {
  function dragEvent(type: string, types: string[]): DragEvent {
    const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, "dataTransfer", { value: { types, items: [] } });
    return event;
  }

  it("activates only for file drags and balances enter/leave", () => {
    const overlay = new ToolDropOverlay({
      label: "Drop",
      onSource: (): void => {},
      onError: (): void => {},
    });
    document.dispatchEvent(dragEvent("dragenter", ["text/plain"]));
    expect(overlay.isActive).toBe(false);
    document.dispatchEvent(dragEvent("dragenter", ["Files"]));
    document.dispatchEvent(dragEvent("dragenter", ["Files"]));
    expect(overlay.isActive).toBe(true);
    document.dispatchEvent(dragEvent("dragleave", ["Files"]));
    expect(overlay.isActive).toBe(true);
    document.dispatchEvent(dragEvent("dragleave", ["Files"]));
    expect(overlay.isActive).toBe(false);
    overlay.dispose();
  });

  it("prevents the default navigation on dragover with files", () => {
    const overlay = new ToolDropOverlay({
      label: "Drop",
      onSource: (): void => {},
      onError: (): void => {},
    });
    const event = dragEvent("dragover", ["Files"]);
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    overlay.dispose();
  });
});

describe("ValidationReportModal", () => {
  it("lists issues and closes on Escape", async () => {
    const closed = ValidationReportModal.show(
      {
        valid: false,
        issues: [{ severity: "error", message: "kit.json invalid", path: "bunker/kit.json" }],
      },
      "Import report",
    );
    expect(document.querySelector(".sw-io-modal li")?.textContent).toContain("kit.json invalid");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await closed;
    expect(document.querySelector(".sw-io-modal")).toBeNull();
  });
});

describe("bindToolShortcuts", () => {
  it("fires open/save/export for the chords and swallows the browser default", () => {
    const open = vi.fn();
    const save = vi.fn();
    const exportAll = vi.fn();
    const unbind = bindToolShortcuts({ open, save, exportAll });
    const press = (init: KeyboardEventInit): KeyboardEvent => {
      const event = new KeyboardEvent("keydown", { cancelable: true, ...init });
      document.dispatchEvent(event);
      return event;
    };
    expect(press({ key: "o", metaKey: true }).defaultPrevented).toBe(true);
    press({ key: "s", ctrlKey: true });
    press({ key: "E", ctrlKey: true, shiftKey: true });
    press({ key: "o" });
    press({ key: "s", ctrlKey: true, shiftKey: true });
    expect([open.mock.calls.length, save.mock.calls.length, exportAll.mock.calls.length]).toEqual([
      1, 1, 1,
    ]);
    unbind();
    press({ key: "o", metaKey: true });
    expect(open).toHaveBeenCalledOnce();
  });
});
