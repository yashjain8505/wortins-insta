// Evergreen story carousel from stories-bank.json: founder origins, turning points, failures, AI history.
// Facts are grounded in the Wikipedia article for the subject; photos come from Wikimedia Commons.
// usage: node story.mjs [--slug <slug>]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { askClaude, extractJson } from './lib/claude.mjs';
import { wikiText, commonsPhotos } from './lib/wiki.mjs';
import { downloadImage } from './lib/article.mjs';

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const bank = JSON.parse(fs.readFileSync('stories-bank.json', 'utf8'));
const usedPath = 'state/stories-used.json';
const used = fs.existsSync(usedPath) ? JSON.parse(fs.readFileSync(usedPath, 'utf8')) : [];
const argSlug = process.argv[process.argv.indexOf('--slug') + 1];
if (bank.filter(s => !used.includes(s.slug)).length < (config.bankMinUnused ?? 12)) {
  console.log('story bank running low, replenishing first...');
  try { execFileSync('node', ['replenish.mjs'], { stdio: 'inherit' }); } catch (e) { console.log('replenish failed, continuing with what is left'); }
}
const bankNow = JSON.parse(fs.readFileSync('stories-bank.json', 'utf8'));

// Rotate types so three stories in a day are not all the same flavour; "mostly global, some India".
const TYPE_ORDER = ['origin', 'turning-point', 'failure', 'ai-history'];
const lastType = used.length ? bank.find(s => s.slug === used[used.length - 1])?.type : null; // bank read before replenish is fine here
const nextTypes = TYPE_ORDER.slice(TYPE_ORDER.indexOf(lastType) + 1).concat(TYPE_ORDER);
const pick = argSlug
  ? bankNow.find(s => s.slug === argSlug)
  : nextTypes.map(t => bankNow.find(s => s.type === t && !used.includes(s.slug))).find(Boolean);
if (!pick) { console.error('story bank exhausted, top it up'); process.exit(1); }
console.log(`story: [${pick.type}/${pick.region}] ${pick.subject}`);

const TYPE_LABEL = { origin: 'Origin story', 'turning-point': 'Turning point', failure: 'What went wrong', 'ai-history': 'AI history' };
const dir = path.join('queue', `${new Date().toISOString().slice(0, 10)}-story-${pick.slug}`);
fs.mkdirSync(dir, { recursive: true });

// Grounding text
const wiki = await wikiText(pick.subject);
let text = wiki.text;
for (const extra of pick.extraSubjects ?? []) { try { text += '\n\n' + (await wikiText(extra, { maxChars: 3000 })).text; } catch {} }

// Photos: up to 4 across the search queries, 2 per query
const photos = [];
for (const q of pick.images) {
  if (photos.length >= 4) break;
  let got = 0;
  for (const cand of await commonsPhotos(q)) {
    if (got >= 2 || photos.length >= 4) break;
    const name = photos.length === 0 ? 'photo.jpg' : `photo-${photos.length + 1}.jpg`;
    try { await downloadImage(cand.url, path.join(dir, name), { minBytes: 30000, minWidth: 900 }); photos.push({ file: name, credit: cand.credit }); got++; }
    catch { /* skip */ }
  }
}
if (!photos.length) { console.error('no usable Commons photos for ' + pick.slug); process.exit(1); }
console.log(`  photos: ${photos.length}`);

const prompt = `You write Instagram story carousels about AI and startups for founders, builders, investors and people who work in tech. This is an evergreen STORY, not today's news. Use ONLY facts stated in the source text below. Never invent numbers, dates, names or quotes. If a detail in the angle is not in the text, leave it out.

STORY TYPE: ${TYPE_LABEL[pick.type]}
ANGLE: ${pick.angle}

SOURCE TEXT (Wikipedia: ${wiki.title}):
${text}

HOW TO MAKE IT GREAT (this is what separates a post people share from one they scroll past):
- First, list the 6-8 most surprising CONCRETE facts in the text: exact numbers, dates, names, places, quotes, decisions, near-misses. Put them in "facts". Build the slides only from those.
- Every slide must carry at least one concrete detail. Never write a summary sentence like "they chose a hard problem" or "the company grew". Say what was risked, what was said, what it cost, how close it came to dying.
- Tension is the story. Show the moment it could have failed: the rejection, the bankruptcy scare, the bet everyone doubted, the deal that almost did not happen.
- The LAST slide is always THEN vs NOW: the smallest number at the start against the biggest number today, from the text (e.g. "$40,000 in 1993. Over $3 trillion today."). Contrast is the payoff.
- If the text has a real quote from a founder, use it on a slide, word for word, in quotation marks.
- Lead each slide with the fact, not the setup.

Rules:
- LANGUAGE: write like you are telling a smart 14-year-old. Short common words. One idea per sentence. Sentences under 12 words wherever possible. No jargon. Give big numbers a human scale. Indian English. NEVER use em dashes or en dashes. Use periods, commas or colons. Ranges use hyphens.
- headline: max 12 words, the hook, built on the single most surprising fact. Wrap THE key phrase in ==double equals==. Exactly one highlight.
- 4 detail slides, each ONE beat of the story in order, ending with THEN vs NOW. Labels: short ("The start", "The rejection", "30 days from dead", "The bet", "The quote", "Then vs now"). heading: max 14 words, may use one ==highlight==. body: max 2 short sentences, both carrying a concrete detail.
- category: exactly "${TYPE_LABEL[pick.type]}".
- kicker: a short time and place anchor from the text, e.g. "1993 · Santa Clara".
- caption, blocks separated by blank lines: 1) HOOK one line max 12 words, not the headline restated; 2) SUBSTANCE 2-3 short paragraphs with the best facts NOT on the slides; 3) one question to the reader ending with 👇; 4) exactly "Follow @wortins.news for AI and startup news that actually sticks."; 5) 7-9 hashtags on one line including #ai #startups #wortins.

Reply with ONLY JSON:
{"facts":["...","..."],"type":"news","category":"...","kicker":"...","headline":"...","slides":[{"label":"...","heading":"...","body":"..."},{"label":"...","heading":"...","body":"..."},{"label":"...","heading":"...","body":"..."},{"label":"...","heading":"...","body":"..."}],"caption":"..."}`;

const raw = await askClaude(prompt, { model: config.storyModel ?? config.composeModel, timeoutMs: 300000 });
const story = extractJson(raw);
const bad =
  !story.headline || story.headline.length > 110 ? 'headline' :
  !Array.isArray(story.slides) || story.slides.length < 3 || story.slides.length > 4 ? 'slides' :
  story.slides.some(s => !s.label || !s.heading || !s.body || s.heading.length > 130 || s.body.length > 260) ? 'slide fields' : null;
if (bad) { console.error('story validation failed: ' + bad); process.exit(1); }

story.type = 'news';
story.storyType = pick.type;
story.source = 'Wikipedia';
story.articleUrl = wiki.url;
story.photo = photos[0].file;
story.photoCredit = photos[0].credit;
story.photos = photos.map(p => p.file);
const extra = photos.slice(1);
story.slides.forEach((s, i) => {
  if (extra.length) { const p = extra[i % extra.length]; s.photo = p.file; s.photoCredit = p.credit; s.photoPos = 'center 20%'; }
  else if (i === 0) { s.photo = photos[0].file; s.photoPos = 'center 15%'; }
  else if (i === story.slides.length - 1) { s.photo = photos[0].file; s.photoPos = 'center 85%'; }
});
fs.writeFileSync(path.join(dir, 'story.json'), JSON.stringify(story, null, 2));
console.log('rendering...');
execFileSync('node', ['../renderer/render.mjs', path.join(dir, 'story.json'), dir], { stdio: 'inherit' });
used.push(pick.slug);
fs.writeFileSync(usedPath, JSON.stringify(used, null, 2));
console.log(`\nDONE -> ${dir}\ncaption:\n${story.caption}`);
