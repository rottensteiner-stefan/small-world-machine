#!/usr/bin/env node
/**
 * scripts/audit-css-tokens.js
 * Scans CSS files and HTML <style> blocks for hardcoded colors, radii, and shadows,
 * reporting occurrences and suggesting canonical Design Tokens (--tool-*, --tron-*, --swf-*).
 */
import fs from 'node:fs';

const KNOWN_TOKENS = {
  // Tool Theme Tokens
  '#07090e': '--tool-bg',
  'rgba(14,18,28,0.94)': '--tool-panel',
  '#0e121c': '--tool-panel-solid',
  'rgba(22,29,45,0.7)': '--tool-card',
  'rgba(32,43,68,0.9)': '--tool-card-hover',
  'rgba(255,184,77,0.12)': '--tool-card-active',
  'rgba(0,0,0,0.4)': '--tool-inset',
  'rgba(255,255,255,0.05)': '--tool-hover',
  'rgba(148,163,184,0.14)': '--tool-border',
  'rgba(255,184,77,0.5)': '--tool-border-active',
  '#f8fafc': '--tool-text',
  '#94a3b8': '--tool-text-muted',
  '#ffb84d': '--tool-accent',
  'rgba(255,184,77,0.25)': '--tool-accent-glow',
  '#00e5ff': '--tool-accent2 / --showcase-cyan',
  'rgba(0,229,255,0.2)': '--tool-accent2-glow / --showcase-cyan-dim',
  '#22c55e': '--tool-success',
  '#f59e0b': '--tool-warning',
  '#ef4444': '--tool-danger',
  '#38bdf8': '--tool-info',

  // Showcase Tokens
  '#050505': '--showcase-bg',
  '#b000ff': '--showcase-purple',
  '#7a00cc': '--showcase-purple-dark',
  'rgba(176,0,255,0.8)': '--showcase-purple-glow',
  'rgba(176,0,255,0.4)': '--showcase-purple-glow-outer',
  '#d1fdff': '--showcase-cyan-bright',
  '#88d4e0': '--showcase-cyan-text',
  '#559da8': '--showcase-cyan-muted',
  'rgba(0,229,255,0.5)': '--showcase-cyan-glow',
  'rgba(0,229,255,0.1)': '--showcase-cyan-subtle',
  'rgba(0,10,20,0.85)': '--showcase-footer-bg',
  'rgba(0,15,25,0.6)': '--showcase-nav-bg',
};

const CSS_FILES = [
  'public/assets/shared.css',
  'public/assets/tool-theme.css',
  'public/assets/fonts.css',
];

const TOOL_HTML_FILES = [
  'public/tools/pbr-gen.html',
  'public/tools/splatter-gen.html',
  'public/tools/xtractor.html',
  'public/tools/pixler.html',
  'public/tools/kit-inspector.html',
  'public/tools/ibl-gen.html',
  'public/tools/maker.html',
  'public/tools/map-gen.html',
  'public/tools/gamepad-test.html',
];

function normColor(c) {
  return c.toLowerCase().replace(/\s+/g, '');
}

function auditFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  let targetContent = content;

  if (filePath.endsWith('.html')) {
    const styleBlocks = content.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
    targetContent = styleBlocks.join('\n');
  }

  // Strip comments and :root definitions to find actual usages in rules
  const stripped = targetContent
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/:root\s*\{[\s\S]*?\}/g, '');

  const colorMatches = stripped.match(/#(?:[0-9a-fA-F]{3,8})\b|rgba?\([^)]+\)/g) || [];
  const findings = {};

  for (const c of colorMatches) {
    const norm = normColor(c);
    if (!findings[norm]) {
      findings[norm] = { raw: c, count: 0, token: KNOWN_TOKENS[norm] || null };
    }
    findings[norm].count++;
  }

  return { filePath, totalLiterals: colorMatches.length, findings };
}

console.log('════════════════════════════════════════════════════════════════════');
console.log(' 🎨 Small World Machine CSS Design Token Audit & Hardcoded Literal Scanner');
console.log('════════════════════════════════════════════════════════════════════\n');

let totalIssues = 0;
const allFiles = [...CSS_FILES, ...TOOL_HTML_FILES];

for (const file of allFiles) {
  const res = auditFile(file);
  if (!res) continue;

  const entries = Object.values(res.findings);
  if (entries.length === 0) {
    console.log(`✅ \x1b[32m${file}\x1b[0m: 0 hardcoded color literals.`);
  } else {
    totalIssues += res.totalLiterals;
    console.log(`⚠️  \x1b[33m${file}\x1b[0m (${res.totalLiterals} literals):`);
    for (const e of entries.sort((a, b) => b.count - a.count)) {
      const tokenHint = e.token ? ` → suggestion: \x1b[36mvar(${e.token})\x1b[0m` : ' (no standard token)';
      console.log(`   - \x1b[1m${e.raw}\x1b[0m: used ${e.count}x${tokenHint}`);
    }
    console.log('');
  }
}

console.log('────────────────────────────────────────────────────────────────────');
console.log(`Total hardcoded color occurrences found: \x1b[1m${totalIssues}\x1b[0m\n`);
