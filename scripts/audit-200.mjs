import fs from 'fs';
import path from 'path';

const items = JSON.parse(fs.readFileSync('scripts/parsed-items.json', 'utf-8'));

function cleanPath(raw) {
  return raw.replace(/[`'"*]/g, '').trim();
}

function extractPaths(text) {
  const matches = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m;
  while ((m = linkRegex.exec(text)) !== null) {
    let p = m[2];
    if (p.startsWith('file:///')) {
      p = p.replace(/^file:\/\/\/[a-zA-Z]:\/Users\/[^\/]+\/GitHub\/JobForge\/JobForge\//, '');
    }
    p = p.split('#')[0];
    matches.push(cleanPath(p));
  }
  const codeRegex = /`([^`]+)`/g;
  while ((m = codeRegex.exec(text)) !== null) {
    let p = m[1];
    if ((p.includes('/') || p.includes('.')) && !p.includes(' ') && !p.startsWith('pnpm') && !p.startsWith('export')) {
      matches.push(cleanPath(p));
    }
  }
  return matches;
}

const missing = [];
for (const item of items) {
  const paths = [...extractPaths(item.location), ...extractPaths(item.gap)];
  const itemMissing = [];
  for (const p of paths) {
    if (!p || p.startsWith('http') || p.includes('<') || p.includes('$')) continue;
    if (!fs.existsSync(p)) {
      itemMissing.push(p);
    }
  }
  if (itemMissing.length > 0) {
    missing.push({ num: item.num, subsystem: item.subsystem, missing: itemMissing, gap: item.gap });
  }
}

console.log('Truly missing items count:', missing.length);
for (const m of missing) {
  console.log(`#${m.num} [${m.subsystem}]:`, m.missing.join(', '));
}
