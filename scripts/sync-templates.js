import fs from 'fs';
import path from 'path';

const showcasesDir = path.join(process.cwd(), 'apps/showcases');

// Read all subdirectories in apps/showcases/
const dirs = fs.readdirSync(showcasesDir, { withFileTypes: true })
  .filter(dirent => dirent.isDirectory())
  .map(dirent => dirent.name);

let updatedCount = 0;

for (const dir of dirs) {
  const htmlPath = path.join(showcasesDir, dir, 'index.html');
  if (!fs.existsSync(htmlPath)) continue;

  const content = fs.readFileSync(htmlPath, 'utf8');

  // Extract <title>
  const titleMatch = content.match(/<title>(.*?)<\/title>/s);
  const title = titleMatch ? titleMatch[1].trim() : `Small World Machine - Showcase ${dir}`;

  // Extract <style> if any
  const styleMatch = content.match(/<style>(.*?)<\/style>/s);
  const styleContent = styleMatch ? `\n    <style>\n${styleMatch[1]}\n    </style>` : '';

  // Extract <body> content
  const bodyMatch = content.match(/<body[^>]*>(.*?)<\/body>/s);
  let bodyContent = bodyMatch ? bodyMatch[1] : '';

  // Remove any leading/trailing whitespace
  bodyContent = bodyContent.trim();

  // Determine path to shared.css
  // Note: some showcases had href="../../public/assets/shared.css", some had "/assets/shared.css"
  // Vite can resolve absolute paths from public root. We'll use absolute path.
  const sharedCssPath = '/assets/shared.css';

  const newHtml = `<!doctype html>
<html lang="en">
  <head>
    <link rel="icon" type="image/webp" href="/favicon.webp" />
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <link rel="stylesheet" href="${sharedCssPath}" />${styleContent}
  </head>
  <body>
    ${bodyContent}
  </body>
</html>
`;

  if (content !== newHtml) {
    fs.writeFileSync(htmlPath, newHtml, 'utf8');
    updatedCount++;
    console.log(`Updated ${dir}/index.html`);
  }
}

console.log(`Done. Updated ${updatedCount} showcases.`);
