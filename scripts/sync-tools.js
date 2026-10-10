import fs from 'fs';
import path from 'path';

const toolsDir = path.join(process.cwd(), 'public', 'tools');
const htmlFiles = fs.readdirSync(toolsDir).filter(f => f.endsWith('.html'));

let updatedCount = 0;

for (const file of htmlFiles) {
  const htmlPath = path.join(toolsDir, file);
  const content = fs.readFileSync(htmlPath, 'utf8');

  // Extract <title>
  const titleMatch = content.match(/<title>(.*?)<\/title>/s);
  const title = titleMatch ? titleMatch[1].trim() : `Small World Machine Tool`;

  // Extract <style> blocks
  const styles = [];
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch;
  while ((styleMatch = styleRegex.exec(content)) !== null) {
    // remove existing header/body styles if they conflict, or just keep them
    // actually, let's just keep them all, but maybe strip out duplicate body margins later if needed
    let css = styleMatch[1];
    // Optional: strip old header/footer styles to avoid clashes
    css = css.replace(/header\s*\{[^}]+\}/g, '');
    css = css.replace(/body\s*\{[^}]+\}/g, 'body { margin: 0; font-family: "Rajdhani", sans-serif; background-color: var(--bg-color, #0b0f19); color: var(--text-color, #e0e0e0); display: flex; flex-direction: column; height: 100vh; overflow: hidden; }');
    styles.push(`<style>\n${css.trim()}\n    </style>`);
  }

  // Extract <link> tags (except favicon and shared.css)
  const links = [];
  const linkRegex = /<link([^>]+)>/gi;
  let lMatch;
  while ((lMatch = linkRegex.exec(content)) !== null) {
    const l = lMatch[0];
    if (!l.includes('favicon.webp') && !l.includes('shared.css')) {
      links.push(l);
    }
  }

  // Extract scripts
  const scripts = [];
  const scriptRegex = /<script([\s\S]*?)<\/script>/gi;
  let scMatch;
  while ((scMatch = scriptRegex.exec(content)) !== null) {
    scripts.push(scMatch[0]);
  }

  // Extract <body> content, ignoring header and footer and scripts
  const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let bodyContent = bodyMatch ? bodyMatch[1] : '';

  // Remove <header>
  bodyContent = bodyContent.replace(/<header[^>]*>([\s\S]*?)<\/header>/gi, '');
  // Remove <footer>
  bodyContent = bodyContent.replace(/<footer[^>]*>([\s\S]*?)<\/footer>/gi, '');
  // Remove <script> from bodyContent (we already extracted them)
  bodyContent = bodyContent.replace(/<script([\s\S]*?)<\/script>/gi, '');

  bodyContent = bodyContent.trim();

  // Reconstruct unified HTML
  const newHtml = `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/webp" href="/favicon.webp" />
    <link rel="stylesheet" href="/assets/shared.css" />
    ${links.length ? links.join('\n    ') + '\n    ' : ''}<title>${title}</title>
    ${styles.join('\n    ')}
  </head>
  <body>
    <header class="tool-header">
      <h1>${title}</h1>
      <a href="/" class="nav-btn">Back to Engine</a>
    </header>
    
    ${bodyContent}

    <footer class="app-footer">Copyright 2026 Stefan Rottensteiner // Small World Machine</footer>

    ${scripts.join('\n    ')}
  </body>
</html>
`;

  if (content !== newHtml) {
    fs.writeFileSync(htmlPath, newHtml, 'utf8');
    updatedCount++;
    console.log(`Updated ${file}`);
  }
}

console.log(`Done. Updated ${updatedCount} tools.`);
