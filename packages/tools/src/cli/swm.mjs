#!/usr/bin/env node
/* global process */

// Executes the `swm` TypeScript CLI through `tsx` (the repo convention for
// Node-side TypeScript, e.g. `npm run ibl:bake`). Plain-Node type stripping
// cannot resolve the headless-core `.js`-specifier closure (and the engine
// enum weights), so this committed ESM shim registers the `tsx` loader first
// and then imports the CLI in-process.

async function main() {
  const { register } = await import("tsx/esm/api");
  await register();
  const { runSwm } = await import("./index.ts");
  return runSwm(process.argv.slice(2));
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`swm: fatal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
