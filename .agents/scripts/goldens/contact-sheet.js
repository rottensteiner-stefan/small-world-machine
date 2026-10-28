// scripts/goldens/contact-sheet.js (M5 der Goldens-Optimierung)
//
// Kontaktbogen-Galerie: Eine einzige, selbstständige HTML-Filmklappe aus einem Capture-Ordner,
// damit breite Screenshot-Sets (Dutzende bis hunderte Zellen) für Art-Review, Engine-vs-AI-
// Vergleiche oder Doku gesichtet werden können, ohne jede PNG einzeln zu öffnen.
//
//   node scripts/goldens/contact-sheet.js <dir> [--out <path>] [--title <text>]
//
// Eingebettet werden verkleinerte Thumbnails (Data-URIs); die Datei ist portabel und nicht-gating.

import fs from "node:fs";
import path from "node:path";
import { escapeHtml, thumbnailDataUri } from "./review-report.js";

function parseArgs(argv) {
  const args = { dir: null, out: null, title: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") {
      args.out = path.resolve(argv[i + 1]);
      i++;
    } else if (argv[i] === "--title") {
      args.title = argv[i + 1];
      i++;
    } else if (!args.dir) {
      args.dir = path.resolve(argv[i]);
    }
  }
  return args;
}

function collectPngs(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith(".png")) out.push(abs);
    }
  };
  walk(dir);
  return out.sort();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir || !fs.existsSync(args.dir) || !fs.statSync(args.dir).isDirectory()) {
    console.error("Usage: node scripts/goldens/contact-sheet.js <dir> [--out <path>] [--title <text>]");
    process.exit(1);
  }
  const pngs = collectPngs(args.dir);
  if (0 === pngs.length) {
    console.error(`${args.dir}: keine PNGs gefunden.`);
    process.exit(1);
  }

  const title = args.title ?? path.basename(args.dir);
  const tiles = pngs
    .map((file) => {
      const uri = thumbnailDataUri(file);
      if (!uri) return "";
      const label = path.relative(args.dir, file);
      return `<figure><img src="${uri}" alt="${escapeHtml(label)}"/><figcaption>${escapeHtml(
        label,
      )}</figcaption></figure>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)} — Kontaktbogen</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: ui-monospace, Menlo, monospace; margin: 2rem; background: #101318; color: #d7dce3; }
  h1 { font-size: 1.1rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem; margin-top: 1rem; }
  figure { margin: 0; }
  img { width: 100%; border: 1px solid #333a45; }
  figcaption { font-size: .7rem; color: #87909d; margin-top: .25rem; word-break: break-all; }
  footer { margin-top: 1rem; font-size: .75rem; color: #87909d; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p>${pngs.length} Zellen — generiert: ${new Date().toISOString()}</p>
<div class="grid">
${tiles}
</div>
<footer>Small World Machine — scripts/goldens/contact-sheet.js (M5)</footer>
</body>
</html>`;

  const outPath = args.out ?? path.join(args.dir, "contact-sheet.html");
  fs.writeFileSync(outPath, html);
  console.log(`Kontaktbogen: ${outPath} (${pngs.length} Zellen)`);
}

main();
