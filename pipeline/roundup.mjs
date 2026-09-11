// Build a "N stories in N swipes" roundup carousel from work/scored.json.
// Each middle slide = one news item with its own photo. usage: node roundup.mjs [--edition morning|evening]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { askClaude, extractJson } from './lib/claude.mjs';
import { fetchArticle, downloadImage } from './lib/article.mjs';

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const args = process.argv.slice(2);
const edition = args[args.indexOf('--edition') + 1] || (new Date().getUTCHours() < 9 ? 'morning' : 'evening');
const WANT = 5;

const scored = JSON.parse(fs.readFileSync('work/scored.json', 'utf8'));
const seenPath = 'state/seen.json';
const seen = fs.existsSync(seenPath) ? JSON.parse(fs.readFileSync(seenPath, 'utf8')) : { keys: [] };

// Pick top-scored, one per source, spread across categories, skip already-posted, need a photo.
const usedSources = new Set(), usedCats = new Map();
const items = [];
const dir = path.join('queue', `${new Date().toISOString().slice(0, 10)}-roundup-${edition}`);
fs.mkdirSync(dir, { recursive: true });

for (const c of scored.filter(c => c.score >= 5 && !seen.keys.includes(c.key))) {
  if (items.length >= WANT) break;
  if (usedSources.has(c.source)) continue;
  if ((usedCats.get(c.category) ?? 0) >= 2) continue;
  try {
    const art = await fetchArticle(c.link);
    if (art.text.length < 300) continue;
    const img = art.ogImage || c.image;
    if (!img) continue;
    const photo = `photo-${items.length + 1}.jpg`;
    await downloadImage(img, path.join(dir, photo), { minBytes: config.minPhotoBytes });
    items.push({ ...c, photo, text: art.text.slice(0, 1500) });
    usedSources.add(c.source);
    usedCats.set(c.category, (usedCats.get(c.category) ?? 0) + 1);
    console.log(`  + [${c.category}/${c.source}] ${c.title.slice(0, 70)}`);
  } catch (e) { console.log(`  skip (${e.message.slice(0, 60)}): ${c.title.slice(0, 60)}`); }
}
if (items.length < 4) { console.error(`only ${items.length} usable items, need 4+`); process.exit(1); }

const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const prompt = `You write a daily news roundup carousel for an Indian Instagram page. One slide per story. Use ONLY facts from the article texts below. Never invent.

LANGUAGE (most important): write like you are telling a smart 14-year-old. Short common words. One idea per sentence. No jargon, no abbreviations unless everyone knows them. Give big numbers a human scale. Indian English. NEVER use em dashes or en dashes; use periods, commas or colons. Ranges use hyphens.

STORIES:
${items.map((it, i) => `--- STORY ${i + 1} (source: ${it.source}, category: ${it.category}) ---\nTITLE: ${it.title}\n${it.text}`).join('\n\n')}

Return for each story, in the same order:
- headline: max 10 words, plain, the single most interesting fact. Wrap the key number or surprise in ==double equals==. Exactly one highlight.
- line: max 20 words, one sentence, the one extra thing worth knowing.
- short: max 5 words, a label for the cover list (e.g. "Apple's folding iPhone").
- category: one word for the tag (India, World, Tech, AI, Money, Science, Startups).
Also:
- cover: max 8 words, e.g. "${items.length} things that happened today" or a sharper version. Wrap the number in ==double equals==.
- caption, blocks separated by blank lines: 1) HOOK one line max 12 words; 2) the ${items.length} stories as short numbered lines, each adding one fact NOT on the slides; 3) one question to the reader ending with 👇; 4) exactly "Follow @wortins.news for news that actually sticks."; 5) 7-9 hashtags on one line including #wortins.

Reply with ONLY JSON:
{"cover":"...","items":[{"headline":"...","line":"...","short":"...","category":"..."}],"caption":"..."}`;

const raw = await askClaude(prompt, { model: config.composeModel });
const out = extractJson(raw);
if (!Array.isArray(out.items) || out.items.length !== items.length) { console.error('model returned wrong item count'); process.exit(1); }

const story = {
  type: 'roundup',
  edition,
  category: edition === 'morning' ? `Morning brief · ${dateStr}` : `Evening brief · ${dateStr}`,
  headline: out.cover,
  items: items.map((it, i) => ({
    headline: out.items[i].headline, line: out.items[i].line, short: out.items[i].short,
    category: out.items[i].category, source: it.source, photo: it.photo, photoCredit: `Photo: ${it.source}`, articleUrl: it.link,
  })),
  caption: out.caption,
};
fs.writeFileSync(path.join(dir, 'story.json'), JSON.stringify(story, null, 2));
console.log('rendering...');
execFileSync('node', ['../renderer/render.mjs', path.join(dir, 'story.json'), dir], { stdio: 'inherit' });
console.log(`\nDONE -> ${dir}\ncaption:\n${story.caption}`);
