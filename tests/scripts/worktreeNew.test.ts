import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../../.agents/scripts/worktree-new.mjs");

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(cwd: string, args: string[]): RunResult {
  const r = spawnSync("node", [SCRIPT, ...args], { cwd, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function git(cwd: string, args: string[]): string {
  return spawnSync("git", args, { cwd, encoding: "utf8" }).stdout.trim();
}

describe("scripts/worktree-new.mjs", () => {
  let base: string;
  let repo: string;

  beforeEach(() => {
    // realpath: on macOS the temp dir is a symlink, and the script reports resolved paths.
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "worktree-new-")));
    repo = path.join(base, "repo");
    fs.mkdirSync(repo);
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "Test"]);
    fs.writeFileSync(path.join(repo, "README.md"), "x\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "init"]);
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it("--dry-run reports the plan and changes nothing", () => {
    const r = run(repo, ["demo", "--dry-run", "--no-install"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--dry-run: nothing changed");
    expect(fs.existsSync(path.join(base, "repo-demo"))).toBe(false);
    expect(git(repo, ["branch", "--list", "demo"])).toBe("");
  });

  it("creates the branch and worktree next to the main checkout and links the shared mailbox directory", () => {
    const r = run(repo, ["demo", "--no-install"]);
    expect(r.status).toBe(0);
    const dir = path.join(base, "repo-demo");
    expect(git(dir, ["branch", "--show-current"])).toBe("demo");

    const link = path.join(dir, ".agents", "scratches");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(path.join(repo, ".agents", "scratches")));

    // The symlink is excluded locally, so it never shows up in `git status`.
    expect(git(dir, ["status", "--short"])).not.toContain(".agents/scratches");
    const exclude = fs.readFileSync(path.join(repo, ".git", "info", "exclude"), "utf8");
    expect(exclude.split("\n")).toContain(".agents/scratches");
  });

  it("does not add the exclude line twice", () => {
    run(repo, ["one", "--no-install"]);
    run(repo, ["two", "--no-install"]);
    const exclude = fs.readFileSync(path.join(repo, ".git", "info", "exclude"), "utf8");
    expect(exclude.split("\n").filter((l) => ".agents/scratches" === l)).toHaveLength(1);
  });

  it("started from inside another worktree it still puts the new one next to the MAIN checkout", () => {
    run(repo, ["first", "--no-install"]);
    const r = run(path.join(base, "repo-first"), ["second", "--no-install"]);
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(base, "repo-second"))).toBe(true);
    expect(fs.existsSync(path.join(base, "repo-first-second"))).toBe(false);
  });

  it("honours --dir", () => {
    const target = path.join(base, "elsewhere");
    const r = run(repo, ["demo", "--dir", target, "--no-install"]);
    expect(r.status).toBe(0);
    expect(git(target, ["branch", "--show-current"])).toBe("demo");
  });

  it("refuses an existing directory, an existing branch, a bad topic, an unknown base and a missing topic", () => {
    expect(run(repo, ["demo", "--no-install"]).status).toBe(0);

    const sameDir = run(repo, ["demo", "--no-install"]);
    expect(sameDir.status).toBe(1);
    expect(sameDir.stderr).toContain("already exists");

    git(repo, ["branch", "taken"]);
    const sameBranch = run(repo, ["taken", "--no-install"]);
    expect(sameBranch.status).toBe(1);
    expect(sameBranch.stderr).toContain('Branch "taken" already exists');

    expect(run(repo, ["Bad_Topic", "--no-install"]).stderr).toContain("Invalid topic");
    expect(run(repo, ["ok", "--base", "no-such-ref", "--no-install"]).stderr).toContain(
      "is not a known commit",
    );
    expect(run(repo, ["--no-install"]).stderr).toContain("Missing <topic>");
    expect(run(repo, ["ok", "--bogus"]).stderr).toContain("Unknown option");
  });
});
