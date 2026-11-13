// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DirectoryAssetSink } from "../../src/common/io/sinks/DirectoryAssetSink.js";
import { DownloadAssetSink } from "../../src/common/io/sinks/DownloadAssetSink.js";

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
