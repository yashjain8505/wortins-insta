// Turn the best scored candidate into a rendered carousel in queue/.
// usage: node compose.mjs [--category india|global|ai|story] [--id N]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { askClaude, extractJson } from './lib/claude.mjs';
import { fetchArticle, downloadPhotoSet } from './lib/article.mjs';

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const args = process.argv.slice(2);
const argOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const wantCat = argOf('--category');
const wantId = argOf('--id');

const scored = JSON.parse(fs.readFileSync('work/scored.json', 'utf8'));
const pool = scored.filter(c => (wantCat ? c.category === wantCat : true) && (wantId ? c.id === Number(wantId) : true)).slice(0, 4);
if (!pool.length) { console.error('no candidates match'); process.exit(1); }
console.log(`compose: category=${wantCat ?? 'any'}, trying up to ${pool.length} candidates, model=${config.composeModel}`);

const seenPath = 'state/seen.json';
const seen = fs.existsSync(seenPath) ? JSON.parse(fs.readFileSync(seenPath, 'utf8')) : { keys: [] };

for (const pick of pool) {
  console.log(`\ntrying: [${pick.category}/${pick.source}] ${pick.title}`);
  try {
    const article = await fetchArticle(pick.link);
    if (article.text.length < 400) throw new Error('article text too thin');
    const slug = pick.key.split(' ').slice(0, 5).join('-');
    const dir = path.join('queue', `${new Date().toISOString().slice(0, 10)}-${slug}`);
    fs.mkdirSync(dir, { recursive: true });
    const photos = await downloadPhotoSet([...(article.images ?? []), pick.image].filter(Boolean), dir, 4, { minBytes: config.minPhotoBytes });
    if (!photos.length) throw new Error('no usable image');
    console.log(`  photos: ${photos.length}`);

    const prompt = `You write Instagram carousels about AI and startups for founders, builders, investors and people who work in tech (India and global). Turn this article into a carousel story. Use ONLY facts stated in the article text below — never invent numbers, names or claims. If the article lacks a concrete hook, still write the strongest honest version.

ARTICLE (from ${pick.source}): ${pick.title}
${article.text.slice(0, 4000)}

Rules:
- LANGUAGE (most important rule): write like you are telling a smart 14-year-old. Short, common words. One idea per sentence. Sentences under 12 words wherever possible. No jargon, no abbreviations unless everyone knows them (UPI, AI, GDP are fine). If a technical term is unavoidable, explain it in a few words right there. Give big numbers a human scale ("$500 million, about ₹4,200 crore"). Indian English, no slang. NEVER use em dashes or en dashes. Use periods, commas or colons instead. Ranges use hyphens ("2-3").
- headline: max 12 words, punchy, plain English. Wrap THE key phrase (a number or the surprise) in ==double equals== for highlight. Exactly one highlight.
- 3 or 4 detail slides (4 when the article has enough real substance, 3 otherwise). Each slide = ONE idea. Order them as a story: what happened, the key detail or number, why it matters to a normal person, what happens next or the catch. Slide labels: short ("What happened", "The number", "Why it matters", "The catch", "What's next"). heading: max 14 words, may use one ==highlight==. body: max 2 short sentences, conversational, no jargon.
- kicker: "<Topic> · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}"
- category: one word for the corner tag (e.g. India, World, Tech, Money).
- caption: the second layer of the post, for people who want more. Build it EXACTLY in this order, blocks separated by blank lines:
  1) HOOK: one line, max 12 words, a surprising angle that is NOT the headline restated.
  2) SUBSTANCE: 2-3 short paragraphs of extra facts from the article that are NOT on the slides. Real numbers, context, the wild detail. It must teach something the slides did not.
  3) QUESTION: one question to the reader, ending with the emoji 👇
  4) CTA: exactly "Follow @wortins.news for AI and startup news that actually sticks."
  5) HASHTAGS: 7-9 on one line, mix of big and niche, always include #ai #startups #wortins.
- source: "${pick.source}"

Reply with ONLY JSON:
{"type":"news","category":"...","kicker":"...","headline":"...","slides":[{"label":"...","heading":"...","body":"..."},{"label":"...","heading":"...","body":"..."},{"label":"...","heading":"...","body":"..."}],"source":"...","caption":"..."}`;

    const raw = await askClaude(prompt, { model: config.composeModel });
    const story = extractJson(raw);
    // validate
    const bad =
      story.type !== 'news' ? 'type' :
      !story.headline || story.headline.length > 110 ? 'headline' :
      !Array.isArray(story.slides) || story.slides.length < 3 || story.slides.length > 4 ? 'slides' :
      story.slides.some(s => !s.label || !s.heading || !s.body || s.heading.length > 130 || s.body.length > 260) ? 'slide fields' :
      !story.source ? 'source' : null;
    if (bad) throw new Error(`story validation failed: ${bad}`);

    story.photo = photos[0];
    story.photos = photos;
    story.photoCredit = `Photo: ${pick.source}`;
    // Spread photos across the detail slides. Extra article photos go on slides in order;
    // with only one photo, reuse it on the first and last detail slide with different crops.
    const extra = photos.slice(1);
    story.slides.forEach((s, i) => {
      if (extra.length) { s.photo = extra[i % extra.length]; s.photoPos = 'center'; }
      else if (i === 0) { s.photo = photos[0]; s.photoPos = 'center 15%'; }
      else if (i === story.slides.length - 1) { s.photo = photos[0]; s.photoPos = 'center 85%'; }
    });
    story.articleUrl = pick.link;
    fs.writeFileSync(path.join(dir, 'story.json'), JSON.stringify(story, null, 2));

    console.log('rendering...');
    execFileSync('node', ['../renderer/render.mjs', path.join(dir, 'story.json'), dir], { stdio: 'inherit' });

    seen.keys.push(pick.key);
    fs.writeFileSync(seenPath, JSON.stringify(seen, null, 2));
    console.log(`\nDONE -> ${dir}`);
    console.log(`caption:\n${story.caption}`);
    process.exit(0);
  } catch (e) {
    if (String(e.message).includes('render.mjs')) {
      console.error(`render failed (systemic, not a content problem): ${e.message}`);
      process.exit(2);
    }
    console.log(`  skipped: ${e.message}`);
  }
}
console.error('all candidates failed');
process.exit(1);
