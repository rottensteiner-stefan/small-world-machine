import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  pruneStaleEntries,
  removeFilesWithExtension,
} from "../../.agents/scripts/lib/dist-sync.js";

let tmp: string;
const put = (rel: string): void => {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "x");
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dist-sync-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("dist-sync", () => {
  it("pruneStaleEntries removes dest-only files/dirs and keeps mirrored ones", () => {
    put("src/a.png");
    put("src/sub/b.png");
    put("dest/a.png");
    put("dest/sub/b.png");
    put("dest/old.png");
    put("dest/sub/gone.png");
    put("dest/gonedir/c.png");
    const removed = pruneStaleEntries(path.join(tmp, "src"), path.join(tmp, "dest"));
    expect(removed.length).toBe(3);
    expect(fs.existsSync(path.join(tmp, "dest/a.png"))).toBe(true);
    expect(fs.existsSync(path.join(tmp, "dest/sub/b.png"))).toBe(true);
    expect(fs.existsSync(path.join(tmp, "dest/old.png"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, "dest/sub/gone.png"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, "dest/gonedir"))).toBe(false);
  });

  it("pruneStaleEntries tolerates missing dest", () => {
    expect(pruneStaleEntries(path.join(tmp, "s"), path.join(tmp, "d"))).toEqual([]);
  });

  it("removeFilesWithExtension drops stale tool pages only", () => {
    put("tools/pixler.html");
    put("tools/maker.html");
    put("tools/keep.json");
    removeFilesWithExtension(path.join(tmp, "tools"), ".html");
    expect(fs.readdirSync(path.join(tmp, "tools"))).toEqual(["keep.json"]);
  });
});
