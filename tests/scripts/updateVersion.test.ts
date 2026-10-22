import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT_SOURCE = path.resolve(__dirname, "../../scripts/update-version.js");

function git(cwd: string, args: string[]): string {
  return spawnSync("git", args, { cwd, encoding: "utf8" }).stdout.trim();
}

describe("scripts/update-version.js", () => {
  let repo: string;

  function write(relative: string, content: string): void {
    const file = path.join(repo, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }

  function run(args: string[]): void {
    const r = spawnSync("node", [path.join(repo, "scripts/update-version.js"), ...args], {
      cwd: repo,
      encoding: "utf8",
    });
    expect(r.status, r.stderr).toBe(0);
  }

  beforeEach(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "update-version-")));
    write("scripts/update-version.js", fs.readFileSync(SCRIPT_SOURCE, "utf8"));
    write("package.json", '{ "name": "root", "version": "2.0.0" }\n');
    write("apps/showcases/package.json", '{ "name": "s", "version": "1.0.0" }\n');
    write("apps/sample-apps/package.json", '{ "name": "a", "version": "1.0.0" }\n');
    write(
      "packages/engine/src/core/SmallWorldMachine.ts",
      'export const ENGINE_VERSION = "1.0.0";\n',
    );
    git(repo, ["init", "-q"]);
    git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"]);
    git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("syncs engine constant and private app versions without touching the git index", () => {
    run([]);
    expect(
      fs.readFileSync(path.join(repo, "packages/engine/src/core/SmallWorldMachine.ts"), "utf8"),
    ).toContain('"2.0.0"');
    expect(fs.readFileSync(path.join(repo, "apps/showcases/package.json"), "utf8")).toContain(
      '"2.0.0"',
    );
    expect(git(repo, ["diff", "--cached", "--name-only"])).toBe("");
    expect(git(repo, ["diff", "--name-only"]).split("\n")).toHaveLength(3);
  });

  it("stages exactly the rewritten files with --stage (pre-commit hook)", () => {
    run(["--stage"]);
    expect(git(repo, ["diff", "--cached", "--name-only"]).split("\n").sort()).toEqual([
      "apps/sample-apps/package.json",
      "apps/showcases/package.json",
      "packages/engine/src/core/SmallWorldMachine.ts",
    ]);
  });
});
