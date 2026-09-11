// Turn the best scored candidate into a rendered carousel in queue/.
// usage: node compose.mjs [--category india|global|ai|story] [--id N]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { askClaude, extractJson } from './lib/claude.mjs';
import { fetchArticle, downloadImage } from './lib/article.mjs';

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const args = process.argv.slice(2);
const argOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const wantCat = argOf('--category');
const wantId = argOf('--id');

const scored = JSON.parse(fs.readFileSync('work/scored.json', 'utf8'));
const pool = scored.filter(c => (wantCat ? c.category === wantCat : true) && (wantId ? c.id === Number(wantId) : true));
if (!pool.length) { console.error('no candidates match'); process.exit(1); }

const seenPath = 'state/seen.json';
const seen = fs.existsSync(seenPath) ? JSON.parse(fs.readFileSync(seenPath, 'utf8')) : { keys: [] };

for (const pick of pool) {
  console.log(`\ntrying: [${pick.category}/${pick.source}] ${pick.title}`);
  try {
    const article = await fetchArticle(pick.link);
    if (article.text.length < 400) throw new Error('article text too thin');
    const imageUrl = article.ogImage || pick.image;
    if (!imageUrl) throw new Error('no image available');

    const slug = pick.key.split(' ').slice(0, 5).join('-');
    const dir = path.join('queue', `${new Date().toISOString().slice(0, 10)}-${slug}`);
    fs.mkdirSync(dir, { recursive: true });
    await downloadImage(imageUrl, path.join(dir, 'photo.jpg'), { minBytes: config.minPhotoBytes });

    const prompt = `You write Instagram news carousels for an Indian general audience. Turn this article into a carousel story. Use ONLY facts stated in the article text below — never invent numbers, names or claims. If the article lacks a concrete hook, still write the strongest honest version.

ARTICLE (from ${pick.source}): ${pick.title}
${article.text.slice(0, 4000)}

Rules:
- STYLE (applies to every field): NEVER use em dashes or en dashes. Use periods, commas or colons instead. Ranges use hyphens ("2-3"). Short sentences. Plain words an average person knows.
- headline: max 12 words, punchy, plain English. Wrap THE key phrase (a number or the surprise) in ==double equals== for highlight. Exactly one highlight.
- exactly 2 detail slides. Slide labels: short ("What happened", "Why it matters", "The catch", "What's next"...). heading: max 14 words, may use one ==highlight==. body: max 2 short sentences, conversational, no jargon.
- kicker: "<Topic> · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}"
- category: one word for the corner tag (e.g. India, World, Tech, Money).
- caption: the second layer of the post, for people who want more. Build it EXACTLY in this order, blocks separated by blank lines:
  1) HOOK: one line, max 12 words, a surprising angle that is NOT the headline restated.
  2) SUBSTANCE: 2-3 short paragraphs of extra facts from the article that are NOT on the slides. Real numbers, context, the wild detail. It must teach something the slides did not.
  3) QUESTION: one question to the reader, ending with the emoji 👇
  4) CTA: exactly "Follow @wortins.news for 2-3 stories a day that actually stick."
  5) HASHTAGS: 7-9 on one line, mix of big and niche, always include #wortins.
- source: "${pick.source}"

Reply with ONLY JSON:
{"type":"news","category":"...","kicker":"...","headline":"...","slides":[{"label":"...","heading":"...","body":"..."},{"label":"...","heading":"...","body":"..."}],"source":"...","caption":"..."}`;

    const raw = await askClaude(prompt, { model: config.composeModel });
    const story = extractJson(raw);
    // validate
    const bad =
      story.type !== 'news' ? 'type' :
      !story.headline || story.headline.length > 110 ? 'headline' :
      !Array.isArray(story.slides) || story.slides.length !== 2 ? 'slides' :
      story.slides.some(s => !s.label || !s.heading || !s.body || s.heading.length > 130 || s.body.length > 260) ? 'slide fields' :
      !story.source ? 'source' : null;
    if (bad) throw new Error(`story validation failed: ${bad}`);

    story.photo = 'photo.jpg';
    story.photoCredit = `Photo: ${pick.source}`;
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
