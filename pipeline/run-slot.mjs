// One scheduled slot, end to end: pick content for a category, render, publish.
// usage: node run-slot.mjs <category|fact|science-or-story> [--publish|--dry]
// Default (no flag) stops after rendering: queue dir is created but nothing is uploaded.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const category = process.argv[2];
if (!category) { console.error('usage: node run-slot.mjs <category> [--publish|--dry]'); process.exit(1); }
const mode = process.argv.includes('--publish') ? 'publish' : process.argv.includes('--handoff') ? 'handoff' : process.argv.includes('--dry') ? 'dry' : 'render-only';

fs.mkdirSync('queue', { recursive: true });
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });
const newestQueueDir = () => fs.readdirSync('queue')
  .filter(d => fs.existsSync(path.join('queue', d, 'story.json')))
  .map(d => ({ d, t: fs.statSync(path.join('queue', d)).mtimeMs }))
  .sort((a, b) => b.t - a.t)[0]?.d;

const before = newestQueueDir();

if (category === 'fact') {
  run('node', ['run-fact.mjs']);
} else {
  const tryCats = category === 'science-or-story' ? ['science', 'story'] : [category];
  run('node', ['curate.mjs']);
  let ok = false;
  for (const cat of tryCats) {
    try { run('node', ['compose.mjs', '--category', cat]); ok = true; break; }
    catch { console.log(`compose failed for ${cat}, trying next...`); }
  }
  if (!ok) { console.error('no publishable story for ' + tryCats.join('/')); process.exit(1); }
}

const dir = newestQueueDir();
if (!dir || dir === before) { console.error('no new carousel produced'); process.exit(1); }
console.log(`carousel ready: queue/${dir} (mode: ${mode})`);
if (mode === 'publish') run('node', ['publish.mjs', path.join('queue', dir)]);
else if (mode === 'handoff') run('node', ['handoff.mjs', path.join('queue', dir)]);
else if (mode === 'dry') run('node', ['publish.mjs', path.join('queue', dir), '--dry']);
run('node', ['review.mjs']);
