// Resolve a rebase conflict on state files by UNION (arrays and {keys:[]}), never by picking a side.
// usage (inside a conflicted rebase): node pipeline/merge-state.mjs
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const conflicted = execSync('git diff --name-only --diff-filter=U', { encoding: 'utf8' }).split('\n').filter(Boolean);
for (const file of conflicted) {
  if (!/pipeline\/(state\/.*\.json|stories-bank\.json)$/.test(file)) { console.error('unexpected conflict in ' + file); process.exit(1); }
  const side = (n) => { try { return JSON.parse(execSync(`git show :${n}:${file}`, { encoding: 'utf8' })); } catch { return null; } };
  const a = side(2) ?? side(3), b = side(3) ?? side(2);
  let merged;
  if (Array.isArray(a) && Array.isArray(b)) {
    const key = (x) => typeof x === 'object' && x ? (x.slug ?? x.runId ?? JSON.stringify(x)) : String(x);
    const seen = new Set(); merged = [];
    for (const x of [...a, ...b]) { const k = key(x); if (!seen.has(k)) { seen.add(k); merged.push(x); } }
  } else if (a && b && Array.isArray(a.keys) && Array.isArray(b.keys)) {
    merged = { keys: [...new Set([...a.keys, ...b.keys])] };
  } else { merged = b ?? a; }
  fs.writeFileSync(file, JSON.stringify(merged, null, 2));
  execSync(`git add "${file}"`);
  console.log(`merged ${file}`);
}
