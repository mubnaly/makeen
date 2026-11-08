import fs from 'node:fs';
import path from 'node:path';

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist' && entry.name !== 'target') {
        walk(full);
      }
    } else if (/\.(svelte|js|mjs|ts|json|md)$/.test(entry.name)) {
      const raw = fs.readFileSync(full, 'utf8');
      if (raw.includes('\r\n')) {
        fs.writeFileSync(full, raw.replace(/\r\n/g, '\n'), 'utf8');
      }
    }
  }
}

walk('src');
walk('src-tauri');
console.log('Normalized line endings');
