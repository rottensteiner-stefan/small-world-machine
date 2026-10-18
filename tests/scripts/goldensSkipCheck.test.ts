import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../../scripts/goldens/skip-check.js");

interface RunResult {
  status: number | null;
  output: string;
}

function runSkip(cwd: string, extraArgs: string[] = []): RunResult {
  const result = spawnSync("node", [SCRIPT, ...extraArgs], {
    cwd,
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function runSkipEmit(cwd: string, env: Record<string, string>): RunResult {
  const result = spawnSync("node", [SCRIPT, "--emit-status"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("scripts/goldens/skip-check.js", () => {
  let repo: string;

  const git = (args: string[], opts: { expectOk?: boolean } = {}): void => {
    const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    if (opts.expectOk === false && r.status === 0) {
      throw new Error(`git ${args.join(" ")} unexpectedly succeeded: ${r.stdout}`);
    }
    if (opts.expectOk !== false && r.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    }
  };

  const write = (rel: string, content: string): void => {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };

  const commitAll = (message: string): void => {
    git(["add", "-A"]);
    git(["commit", "-q", "-m", message]);
  };

  /** Builds a repo with a tracked baseline and a sample output-relevant source file. */
  const seedBaselineRepo = (): void => {
    write("README.md", "readme\n");
    write(".agents/goldens/liquid/baseline/clear-water__top.png", "img\n");
    write("apps/showcases/10/index.html", "<html></html>\n");
    commitAll("baseline + sources");
  };

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "goldens-skip-"));
    git(["init", "-q"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Golden Gate Test"]);
    git(["config", "commit.gpgsign", "false"]);
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("skips when only non-build-input files changed since the baseline commit", () => {
    seedBaselineRepo();
    write("README.md", "readme v2\n");
    commitAll("docs only");

    const { status, output } = runSkip(repo);

    expect(status).toBe(0);
    expect(output).toContain("SKIP");
  });

  it("runs when a build-input path changed since the baseline commit", () => {
    seedBaselineRepo();
    write("packages/engine/src/renderers/NewShader.ts", "export {};\n");
    commitAll("new shader source");

    const { status, output } = runSkip(repo);

    expect(status).toBe(1);
    expect(output).toContain("RUN");
    expect(output).toContain("packages/engine/src/renderers/NewShader.ts");
  });

  it("runs when a root dependency manifest changed", () => {
    seedBaselineRepo();
    write("package-lock.json", "{}\n");
    commitAll("dependency bump");

    const { status } = runSkip(repo);

    expect(status).toBe(1);
  });

  it("runs when a build-input path is changed but not committed", () => {
    seedBaselineRepo();
    write("packages/engine/src/ping.js", "// dirty worktree\n");

    const { status } = runSkip(repo);

    expect(status).toBe(1);
  });

  it("runs when the baseline is not tracked in git", () => {
    write("README.md", "no baseline yet\n");
    commitAll("readme only");

    const { status, output } = runSkip(repo);

    expect(status).toBe(1);
    expect(output).toContain("RUN");
  });

  it("runs when git reports nothing changed after the baseline commit", () => {
    // HEAD is exactly the baseline commit: empty diff, no build-input change -> must SKIP.
    seedBaselineRepo();

    const { status, output } = runSkip(repo);

    expect(status).toBe(0);
    expect(output).toContain("SKIP");
  });

  it("CI contract: --emit-status ends with exit 0 and signals RUN only via should_run=true", () => {
    // Regression für den ersten realen Dispatch (39129094684): ein RUN mit Exit 1 markierte den
    // CI-Step als fehlgeschlagen, GitHub verwirft die Outputs, alle `if:`-Gates liefen leer und der
    // Fail-Closed-Guard schlug fälschlich an. Im CI-Modus muss die Entscheidung AUSSCHLIESSLICH über
    // $GITHUB_OUTPUT laufen, nie über den Exit-Code.
    seedBaselineRepo();
    write("packages/engine/src/renderers/NewShader.ts", "export {};\n");
    commitAll("new shader source");

    const ghOut = path.join(repo, "gh-out.txt");
    const { status, output } = runSkipEmit(repo, { GITHUB_OUTPUT: ghOut });

    expect(status).toBe(0);
    expect(output).toContain("RUN");
    expect(fs.readFileSync(ghOut, "utf8")).toContain("should_run=true");
  });

  it("CI contract: --emit-status ends with exit 0 and signals SKIP only via should_run=false", () => {
    seedBaselineRepo();
    write("README.md", "readme v2\n");
    commitAll("docs only");

    const ghOut = path.join(repo, "gh-out.txt");
    const { status, output } = runSkipEmit(repo, { GITHUB_OUTPUT: ghOut });

    expect(status).toBe(0);
    expect(output).toContain("SKIP");
    expect(fs.readFileSync(ghOut, "utf8")).toContain("should_run=false");
  });
});
