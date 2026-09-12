// Preflight: proves every path a slot can take BEFORE anything runs for real.
// Runs at the start of every slot and on every push. No model calls, no state writes.
// usage: node preflight.mjs [--offline]
import fs from 'node:fs';
import path from 'node:path';

const offline = process.argv.includes('--offline');
const fails = [];
const ok = (msg) => console.log('  ok  ' + msg);
const fail = (msg) => { fails.push(msg); console.log('  FAIL ' + msg); };

console.log('preflight: files');
for (const f of ['config.json', 'sources.json', 'schedule.json', 'stories-bank.json', 'run-slot.mjs', 'curate.mjs', 'compose.mjs', 'roundup.mjs', 'story.mjs', 'handoff.mjs', 'publish.mjs', 'replenish.mjs', 'lib/feeds.mjs', 'lib/article.mjs', 'lib/wiki.mjs', 'lib/claude.mjs', '../renderer/render.mjs', '../renderer/brand.json', '../renderer/assets/logo-cream.png', '../renderer/assets/logo-dark.png']) {
  fs.existsSync(f) ? ok(f) : fail('missing ' + f);
}
for (const t of ['facts-cover.html', 'news-cover.html', 'detail.html', 'detail-photo.html', 'closer.html', 'roundup-cover.html', 'roundup-item.html']) {
  fs.existsSync(path.join('../renderer/templates', t)) ? ok('template ' + t) : fail('missing template ' + t);
}

console.log('preflight: schedule -> handlers');
const schedule = JSON.parse(fs.readFileSync('schedule.json', 'utf8'));
const runSlot = fs.readFileSync('run-slot.mjs', 'utf8');
const sources = JSON.parse(fs.readFileSync('sources.json', 'utf8'));
for (const [cron, slot] of Object.entries(schedule)) {
  if (cron.startsWith('_')) continue;
  const c = slot.category;
  const handled = c === 'story' || c === 'fact' || c === 'replenish' || /^roundup-(morning|evening)$/.test(c) || c === 'science-or-story' || Object.keys(sources).includes(c);
  handled ? ok(`${slot.ist} IST -> ${c}`) : fail(`schedule category "${c}" has no handler / no sources`);
  if (!['handoff', 'publish', 'dry', 'render-only'].includes(slot.mode)) fail(`bad mode ${slot.mode} for ${c}`);
}
if (!/category === 'story'/.test(runSlot)) fail('run-slot has no story branch');

console.log('preflight: story picker (same logic as story.mjs, no side effects)');
const bank = JSON.parse(fs.readFileSync('stories-bank.json', 'utf8'));
const used = fs.existsSync('state/stories-used.json') ? JSON.parse(fs.readFileSync('state/stories-used.json', 'utf8')) : [];
const TYPE_ORDER = ['origin', 'turning-point', 'failure', 'ai-history'];
const unused = bank.filter(s => !used.includes(s.slug));
unused.length >= 6 ? ok(`bank ${bank.length}, unused ${unused.length}`) : fail(`bank nearly exhausted: ${unused.length} unused`);
for (const s of bank) {
  if (!s.slug || !s.subject || !s.angle || !Array.isArray(s.images) || !s.images.length || !TYPE_ORDER.includes(s.type)) fail(`bad bank entry ${s.slug ?? '(no slug)'}`);
}
const lastType = used.length ? bank.find(s => s.slug === used[used.length - 1])?.type : null;
const nextTypes = TYPE_ORDER.slice(TYPE_ORDER.indexOf(lastType) + 1).concat(TYPE_ORDER);
const pick = nextTypes.map(t => unused.find(s => s.type === t)).find(Boolean);
pick ? ok(`next story would be: ${pick.slug} (${pick.type})`) : fail('story picker returns nothing');
// the exact bug from 2026-09-12: argv[0] must never be treated as a slug
const storySrc = fs.readFileSync('story.mjs', 'utf8');
/indexOf\('--slug'\)\s*\+\s*1\]/.test(storySrc) ? fail('story.mjs --slug parsing regression') : ok('--slug parsing safe');

console.log('preflight: syntax');
const { execFileSync } = await import('node:child_process');
for (const f of ['run-slot.mjs', 'curate.mjs', 'compose.mjs', 'roundup.mjs', 'story.mjs', 'handoff.mjs', 'publish.mjs', 'replenish.mjs', '../renderer/render.mjs']) {
  try { execFileSync('node', ['--check', f], { stdio: 'pipe' }); ok('syntax ' + f); } catch (e) { fail('syntax error in ' + f); }
}

if (!offline) {
  console.log('preflight: network');
  const { wikiText, commonsPhotos } = await import('./lib/wiki.mjs');
  try { const w = await wikiText(pick.subject); w.text.length > 800 ? ok(`wikipedia "${w.title}" ${w.text.length} chars`) : fail('wikipedia text too thin for ' + pick.subject); } catch (e) { fail('wikipedia: ' + e.message); }
  try { const p = await commonsPhotos(pick.images[0]); p.length ? ok(`commons "${pick.images[0]}" ${p.length} photos`) : fail('no commons photos for ' + pick.images[0]); } catch (e) { fail('commons: ' + e.message); }
  const { fetchAllFeeds } = await import('./lib/feeds.mjs');
  const { candidates, errors } = await fetchAllFeeds(sources, { freshHours: 48 });
  const total = Object.values(sources).flat().length;
  const dead = errors.length;
  candidates.length >= 20 && dead < total / 2 ? ok(`feeds: ${candidates.length} fresh items, ${total - dead}/${total} feeds alive`) : fail(`feeds unhealthy: ${candidates.length} items, ${dead}/${total} feeds failing`);
  if (errors.length) console.log('       feed errors: ' + errors.map(e => e.source).join(', '));
  try { execFileSync('claude', ['--version'], { stdio: 'pipe' }); ok('claude CLI present'); } catch { fail('claude CLI missing'); }
}

console.log(fails.length ? `\nPREFLIGHT FAILED (${fails.length}):\n - ${fails.join('\n - ')}` : '\nPREFLIGHT OK');
process.exit(fails.length ? 1 : 0);
