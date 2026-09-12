// Top up stories-bank.json with new evergreen stories. The model proposes; Wikipedia + Commons verify.
// usage: node replenish.mjs [--count 12]
import fs from 'node:fs';
import { askClaude, extractJson } from './lib/claude.mjs';
import { wikiText, commonsPhotos } from './lib/wiki.mjs';

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const bank = JSON.parse(fs.readFileSync('stories-bank.json', 'utf8'));
const used = fs.existsSync('state/stories-used.json') ? JSON.parse(fs.readFileSync('state/stories-used.json', 'utf8')) : [];
const argCount = Number(process.argv[process.argv.indexOf('--count') + 1]) || 12;

const known = bank.map(s => `${s.slug} (${s.subject}: ${s.angle.slice(0, 60)})`).join('\n');
const prompt = `You curate an inventory of evergreen stories for an Instagram page about AI and startups (audience: founders, builders, investors, India and global). Propose ${argCount + 4} NEW stories that are NOT already in the inventory below and do not retell the same event from another angle.

Mix: roughly 40% founder origin stories, 20% turning points or near-deaths, 20% failures and scandals, 20% AI history and wild facts. Mostly global, about 1 in 4 Indian. Prefer stories with a jaw-dropping concrete number, a rejection, a near-bankruptcy, a famous decision, or a quote. Companies and people from any era, as long as a builder today would find it interesting.

Each story MUST be about a subject that has an English Wikipedia article. Give the EXACT Wikipedia article title (this is checked by machine; a wrong title is discarded).

ALREADY IN THE INVENTORY (do not repeat):
${known}

Reply with ONLY a JSON array:
[{"slug":"kebab-case-unique","type":"origin|turning-point|failure|ai-history","region":"global|india","subject":"Exact Wikipedia article title","angle":"One or two sentences: the specific story to tell, with the key facts you expect the article to contain.","images":["Wikimedia Commons search query for a person or place photo","second query"]}]`;

console.log(`asking for ~${argCount} new stories...`);
const raw = await askClaude(prompt, { model: config.storyModel ?? 'opus', timeoutMs: 300000 });
const proposals = extractJson(raw);
if (!Array.isArray(proposals)) { console.error('bad model output'); process.exit(1); }

const slugs = new Set([...bank.map(s => s.slug), ...used]);
const subjects = new Set(bank.map(s => s.subject.toLowerCase()));
const added = [];
for (const p of proposals) {
  if (added.length >= argCount) break;
  if (!p.slug || !p.subject || !p.angle || !Array.isArray(p.images) || !['origin','turning-point','failure','ai-history'].includes(p.type)) continue;
  if (slugs.has(p.slug) || subjects.has(String(p.subject).toLowerCase())) { console.log(`  dup: ${p.slug}`); continue; }
  try {
    const w = await wikiText(p.subject, { maxChars: 2000 });
    if (w.text.length < 800) throw new Error('article too thin');
    let photos = 0;
    for (const q of p.images.slice(0, 2)) photos += (await commonsPhotos(q, { limit: 2 })).length;
    if (!photos) throw new Error('no Commons photos');
    added.push({ slug: p.slug, type: p.type, region: p.region === 'india' ? 'india' : 'global', subject: w.title, angle: p.angle, images: p.images.slice(0, 3) });
    slugs.add(p.slug); subjects.add(w.title.toLowerCase());
    console.log(`  + ${p.slug} [${p.type}/${p.region}] ${w.title}`);
  } catch (e) { console.log(`  x ${p.slug}: ${e.message.slice(0, 60)}`); }
}
if (!added.length) { console.error('nothing verified, bank unchanged'); process.exit(1); }
fs.writeFileSync('stories-bank.json', JSON.stringify([...bank, ...added], null, 1));
console.log(`\nbank: ${bank.length} -> ${bank.length + added.length} stories (${bank.length + added.length - used.length} unused)`);
