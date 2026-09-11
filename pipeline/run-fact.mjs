// Render the next unused fact from the bank into queue/.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const bank = JSON.parse(fs.readFileSync('facts-bank.json', 'utf8'));
const usedPath = 'state/facts-used.json';
const used = fs.existsSync(usedPath) ? JSON.parse(fs.readFileSync(usedPath, 'utf8')) : [];
const next = bank.find(f => !used.includes(f.slug));
if (!next) { console.error('facts bank exhausted — time to top it up'); process.exit(1); }

const dir = path.join('queue', `${new Date().toISOString().slice(0, 10)}-fact-${next.slug}`);
fs.mkdirSync(dir, { recursive: true });
const { slug, ...story } = next;
fs.writeFileSync(path.join(dir, 'story.json'), JSON.stringify(story, null, 2));
execFileSync('node', ['../renderer/render.mjs', path.join(dir, 'story.json'), dir], { stdio: 'inherit' });
used.push(next.slug);
fs.writeFileSync(usedPath, JSON.stringify(used, null, 2));
console.log(`DONE -> ${dir}\ncaption:\n${story.caption ?? '(none)'}`);
