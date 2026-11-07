// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { zipSync } from "fflate";
import { SecurityValidator } from "../../src/common/io/Security.js";
import { FileAssetSource, stripSharedRoot } from "../../src/common/io/sources/FileAssetSource.js";
import { DirectoryAssetSource } from "../../src/common/io/sources/DirectoryAssetSource.js";
import { DropAssetSource } from "../../src/common/io/sources/DropAssetSource.js";

function file(name: string, content: string): File {
  return new File([content], name);
}

describe("FileAssetSource", () => {
  it("serves files lazily by sanitized path and resolves virtual fetch URLs", async () => {
    const source = new FileAssetSource(
      [{ path: "props/a.json", file: file("a.json", '{"x":1}') }],
      { id: "t" },
    );
    expect(await source.has("props/a.json")).toBe(true);
    expect(await source.has("props/missing.json")).toBe(false);
    expect(await source.readJson<{ x: number }>("props/a.json")).toEqual({ x: 1 });

    const fetcher = source.toFetch();
    const ok = await fetcher("sw-asset://t/props/a.json");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("application/json");
    expect((await fetcher("sw-asset://t/nope.json")).status).toBe(404);
  });

  it("skips traversal paths", async () => {
    const source = new FileAssetSource([
      { path: "../evil.json", file: file("evil.json", "{}") },
      { path: "ok.json", file: file("ok.json", "{}") },
    ]);
    expect(await source.list()).toEqual(["ok.json"]);
  });

  it("accepts oversized files at open time and only refuses to read them", async () => {
    const security = new SecurityValidator({ maxFileBytes: 10 });
    const source = new FileAssetSource(
      [
        { path: "work/source.fbx", file: new File([new Uint8Array(20)], "source.fbx") },
        { path: "kit.json", file: file("kit.json", "{}") },
      ],
      { id: "t", security },
    );
    expect((await source.list()).sort()).toEqual(["kit.json", "work/source.fbx"]);
    expect(await source.readJson("kit.json")).toEqual({});
    await expect(source.read("work/source.fbx")).rejects.toThrow(
      /exceeds limit.*work\/source\.fbx/,
    );
    expect((await source.toFetch()("sw-asset://t/work/source.fbx")).status).toBe(413);
  });

  it("strips a single shared top-level folder only", () => {
    const f = file("x", "");
    expect(
      stripSharedRoot([
        { path: "bunker/kit.json", file: f },
        { path: "bunker/a/b.png", file: f },
      ]).map((e) => e.path),
    ).toEqual(["kit.json", "a/b.png"]);
    expect(
      stripSharedRoot([
        { path: "bunker/kit.json", file: f },
        { path: "other.txt", file: f },
      ]).map((e) => e.path),
    ).toEqual(["bunker/kit.json", "other.txt"]);
  });
});

describe("DirectoryAssetSource.fromFileList", () => {
  it("uses webkitRelativePath and drops the picked folder's own name", async () => {
    const f = file("kit.json", "{}");
    Object.defineProperty(f, "webkitRelativePath", { value: "bunker/kit.json" });
    const source = DirectoryAssetSource.fromFileList([f] as unknown as FileList);
    expect(await source.list()).toEqual(["kit.json"]);
  });
});

interface FakeEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file?: (ok: (f: File) => void) => void;
  createReader?: () => { readEntries: (ok: (e: FakeEntry[]) => void) => void };
}

function fakeFile(name: string, content: string | Uint8Array): FakeEntry {
  const f = new File([content as BlobPart], name);
  return { name, isFile: true, isDirectory: false, file: (ok) => ok(f) };
}

function fakeDir(name: string, children: FakeEntry[]): FakeEntry {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: (): { readEntries: (ok: (e: FakeEntry[]) => void) => void } => {
      let done = false;
      return {
        readEntries: (ok: (e: FakeEntry[]) => void): void => {
          ok(done ? [] : children);
          done = true;
        },
      };
    },
  };
}

function dataTransfer(entries: FakeEntry[]): DataTransfer {
  return {
    types: ["Files"],
    items: entries.map((entry) => ({
      kind: "file",
      webkitGetAsEntry: () => entry,
      getAsFile: () => null,
    })),
  } as unknown as DataTransfer;
}

describe("DropAssetSource", () => {
  it("walks dropped folders recursively, including batched readEntries", async () => {
    const dt = dataTransfer([
      fakeDir("bunker", [fakeFile("kit.json", "{}"), fakeDir("props", [fakeFile("a.glb", "x")])]),
    ]);
    const source = await DropAssetSource.fromDataTransfer(dt);
    expect((await source?.list())?.sort()).toEqual(["kit.json", "props/a.glb"]);
  });

  it("unpacks a single dropped ZIP", async () => {
    const zipped = zipSync({ "kit.json": new TextEncoder().encode("{}") });
    const dt = dataTransfer([fakeFile("kit.zip", zipped)]);
    const source = await DropAssetSource.fromDataTransfer(dt);
    expect(await source?.list()).toEqual(["kit.json"]);
  });

  it("rejects an oversized ZIP before it reaches the worker", async () => {
    const security = new SecurityValidator({ maxFileBytes: 10 });
    const dt = dataTransfer([fakeFile("big.zip", new Uint8Array(20))]);
    await expect(DropAssetSource.fromDataTransfer(dt, { security })).rejects.toThrow(
      /exceeds limit/,
    );
  });

  it("returns undefined for drops without files", async () => {
    expect(await DropAssetSource.fromDataTransfer(dataTransfer([]))).toBeUndefined();
    expect(DropAssetSource.hasFiles({ types: ["text/plain"] } as unknown as DataTransfer)).toBe(
      false,
    );
  });
});
