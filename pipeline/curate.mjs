// Gate 1 (hard filters) + Gate 2 (LLM scoring). Writes work/scored.json.
import fs from 'node:fs';
import { fetchAllFeeds } from './lib/feeds.mjs';
import { askClaude, extractJson } from './lib/claude.mjs';

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const sources = JSON.parse(fs.readFileSync('sources.json', 'utf8'));
const seenPath = 'state/seen.json';
const seen = fs.existsSync(seenPath) ? JSON.parse(fs.readFileSync(seenPath, 'utf8')) : { keys: [] };

console.log('fetching feeds...');
const { candidates, errors } = await fetchAllFeeds(sources, config);
if (errors.length) console.log('feed errors:', errors.map(e => `${e.source}: ${e.error}`).join(' | '));
console.log(`fetched ${candidates.length} fresh items`);

// Gate 1: not already posted/seen
const fresh = candidates.filter(c => !seen.keys.includes(c.key));
// cap what we send to the model — newest first, spread across categories
const byCat = {};
for (const c of fresh) (byCat[c.category] ??= []).push(c);
const capped = Object.values(byCat).flatMap(list =>
  list.sort((a, b) => a.ageH - b.ageH).slice(0, Math.ceil(config.maxCandidatesToScore / Object.keys(byCat).length))
);
capped.forEach((c, i) => (c.id = i + 1));
fs.mkdirSync('work', { recursive: true });
fs.writeFileSync('work/candidates.json', JSON.stringify(capped, null, 2));
if (process.argv.includes('--fetch-only')) { console.log(`wrote work/candidates.json (${capped.length} candidates) — fetch-only, skipping scoring`); process.exit(0); }
console.log(`scoring ${capped.length} candidates (${Object.entries(byCat).map(([k, v]) => `${k}:${v.length}`).join(', ')})`);

const prompt = `You are the editor of an Instagram page about AI and startups, read by founders, builders, investors and people who work in tech (India and global). Score each candidate 1-10 on ONE question: would one of those readers stop scrolling and swipe through the slides on this?

High scores need: a concrete number or a genuine surprise; a story that can be explained in a few slides; something a builder or investor would want to know or share. Best content: AI model and product launches, AI research with a clear real-world result, AI startup funding rounds and valuations, big founder or executive moves, AI changing jobs or an industry, startup wins and failures with numbers, Indian startup news with a real number.
Score 1 always: shopping deals, discount codes, product roundups, buying guides, sponsored content, gadget reviews, event promos and conference tickets, politics, sports, crime, celebrity, generic "how to" listicles. Low scores (2-4): incremental version updates with no clear result, small funding rounds under $5M with no story, insider jargon, opinion pieces without new facts, duplicate angles on one event (keep the best, score the rest low).

Candidates (JSON):
${JSON.stringify(capped.map(({ id, category, source, title, snippet, ageH, image }) => ({ id, category, source, title, snippet, ageH, hasImage: !!image })))}

Reply with ONLY a JSON array: [{"id":1,"score":7,"reason":"<max 10 words>"}] — one entry per candidate, no other text.`;

let raw;
try {
  raw = await askClaude(prompt, { model: config.scoreModel });
} catch (e) {
  console.error(`\nscoring failed: ${e.message}`);
  console.error('candidates are saved in work/candidates.json — if this is an auth error, run `claude` in a terminal once to log the CLI back in, then re-run: node curate.mjs');
  process.exit(1);
}
const scores = extractJson(raw);
const scored = capped
  .map(c => ({ ...c, ...(scores.find(s => s.id === c.id) ?? { score: 0, reason: 'unscored' }) }))
  .sort((a, b) => b.score - a.score);

fs.writeFileSync('work/scored.json', JSON.stringify(scored, null, 2));
console.log('\ntop 10:');
for (const c of scored.slice(0, 10)) console.log(`  ${String(c.score).padStart(2)}  [${c.category}/${c.source}] ${c.title.slice(0, 80)} — ${c.reason}`);
console.log('\nwrote work/scored.json');
process.exit(0); // stalled feed sockets must not keep the process alive (CI hang, 2026-09-11)
