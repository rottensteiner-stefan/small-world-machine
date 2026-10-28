#!/usr/bin/env node
// Creates the git worktree for a long or disruptive session: branch + worktree next to the main checkout,
// `npm ci`, and the shared `.agents/scratches` link (so the session mailbox stays one file for everyone).
// Rules and reasons: .agents/skills/collaborate/implementation-phase.md, section 9.4.
//
//   node scripts/worktree-new.mjs <topic> [--base <ref>] [--dir <path>] [--no-install] [--dry-run]
//   npm run worktree:new -- <topic>
//
// Removing it later: git worktree remove <dir>; git branch -d <topic> (after the merge).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const USAGE = `Usage: node scripts/worktree-new.mjs <topic> [--base <ref>] [--dir <path>] [--no-install] [--dry-run]

  <topic>        branch name and directory suffix, lowercase letters, digits and dashes (e.g. big-merge)
  --base <ref>   start point of the new branch (default: main)
  --dir <path>   worktree directory (default: ../<repo>-<topic> next to the main checkout)
  --no-install   skip \`npm ci\`
  --dry-run      print what would happen and change nothing`;

/**
 * @param {string[]} argv
 * @returns {{ topic: string, base: string, dir: string | null, install: boolean, dryRun: boolean }}
 */
export function parseArgs(argv) {
  const args = { topic: "", base: "main", dir: null, install: true, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ("--base" === arg || "--dir" === arg) {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} needs a value`);
      if ("--base" === arg) args.base = value;
      else args.dir = value;
    } else if ("--no-install" === arg) {
      args.install = false;
    } else if ("--dry-run" === arg) {
      args.dryRun = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (args.topic) {
      throw new Error(`Only one topic allowed, got "${args.topic}" and "${arg}"`);
    } else {
      args.topic = arg;
    }
  }
  if (!args.topic) throw new Error("Missing <topic>");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(args.topic)) {
    throw new Error(`Invalid topic "${args.topic}": lowercase letters, digits and dashes only`);
  }
  return args;
}

/**
 * The first entry of `git worktree list` is always the main working tree, also when this runs inside another worktree.
 * @param {string} porcelain output of `git worktree list --porcelain`
 * @returns {string}
 */
export function mainWorktreePath(porcelain) {
  const line = porcelain.split("\n").find((l) => l.startsWith("worktree "));
  if (!line) throw new Error("Could not find the main working tree (is this a git repository?)");
  return line.slice("worktree ".length).trim();
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string} trimmed stdout
 */
function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** @returns {boolean} whether the git command succeeded */
function gitOk(cwd, args) {
  try {
    git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const args = parseArgs(argv);
  const mainPath = mainWorktreePath(git(process.cwd(), ["worktree", "list", "--porcelain"]));
  const repoName = path.basename(mainPath);
  const dir = path.resolve(args.dir ?? path.join(mainPath, "..", `${repoName}-${args.topic}`));

  if (fs.existsSync(dir)) throw new Error(`${dir} already exists`);
  if (gitOk(mainPath, ["show-ref", "--verify", "--quiet", `refs/heads/${args.topic}`])) {
    throw new Error(`Branch "${args.topic}" already exists`);
  }
  if (!gitOk(mainPath, ["rev-parse", "--verify", "--quiet", `${args.base}^{commit}`])) {
    throw new Error(`Base "${args.base}" is not a known commit`);
  }

  const mainScratches = path.join(mainPath, ".agents", "scratches");
  const link = path.join(dir, ".agents", "scratches");
  const commonDir = path.resolve(mainPath, git(mainPath, ["rev-parse", "--git-common-dir"]));
  const excludeFile = path.join(commonDir, "info", "exclude");

  console.log(`main checkout : ${mainPath}`);
  console.log(`worktree      : ${dir}`);
  console.log(`branch        : ${args.topic} (from ${args.base})`);
  console.log(`mailbox link  : ${link} -> ${path.relative(path.dirname(link), mainScratches)}`);
  if (args.dryRun) {
    console.log(
      `\n--dry-run: nothing changed. It would also exclude ".agents/scratches" locally${args.install ? " and run npm ci" : ""}.`,
    );
    return;
  }

  git(mainPath, ["worktree", "add", dir, "-b", args.topic, args.base]);
  console.log("\ngit worktree add: done");

  fs.mkdirSync(mainScratches, { recursive: true });
  fs.mkdirSync(path.dirname(link), { recursive: true });
  try {
    fs.symlinkSync(path.relative(path.dirname(link), mainScratches), link, "dir");
    console.log("mailbox link: done");
  } catch (err) {
    console.warn(
      `Could not create the mailbox link (${err.message}). Link it by hand: ${link} -> ${mainScratches}`,
    );
  }

  // A symlink is not matched by the directory pattern `.agents/scratches/` in .gitignore; excluding it locally
  // (shared by all worktrees) keeps `git status` clean without touching tracked files.
  const existing = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, "utf8") : "";
  if (!existing.split("\n").includes(".agents/scratches")) {
    fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
    fs.appendFileSync(
      excludeFile,
      `${existing && !existing.endsWith("\n") ? "\n" : ""}.agents/scratches\n`,
    );
    console.log("local exclude: added .agents/scratches");
  }

  if (args.install) {
    console.log("\nnpm ci (this takes a minute) ...");
    execFileSync("npm", ["ci"], { cwd: dir, stdio: "inherit" });
  }

  console.log(`
Ready. Next steps:
  cd ${dir}
  npm run dev -- --port <a free port>          # own dev server, the main checkout keeps its own
  git merge main                                # at milestone boundaries
  # move uncommitted work out of the shared checkout only with its owner, agents and editors stopped:
  #   (main checkout)  git stash push -u -m ${args.topic}-wip ; git stash list      # yours must be stash@{0}
  #   (worktree)       git stash pop stash@{0}
  # when the session is done and merged:
  #   git worktree remove ${dir} ; git branch -d ${args.topic}`);
}

// Run only when executed directly, not when imported (the parsing helpers are unit-testable).
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  try {
    main();
  } catch (err) {
    console.error(`worktree-new: ${err.message}\n\n${USAGE}`);
    process.exit(1);
  }
}
