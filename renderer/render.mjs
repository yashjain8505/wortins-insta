// insta-news renderer — story JSON -> Instagram carousel JPEGs (1080x1350 @2x)
// usage: node render.mjs <story.json> [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storyPath = process.argv[2];
if (!storyPath) { console.error('usage: node render.mjs <story.json> [outDir]'); process.exit(1); }
const outDir = process.argv[3] || path.join(__dirname, 'out', path.basename(storyPath, '.json'));
fs.mkdirSync(outDir, { recursive: true });

const story = JSON.parse(fs.readFileSync(storyPath, 'utf8'));
const brand = JSON.parse(fs.readFileSync(path.join(__dirname, 'brand.json'), 'utf8'));

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// ==text== -> acid highlight span
const rich = (s) => esc(s).replace(/==([^=]+)==/g, '<span class="hl">$1</span>');

const tpl = (name) => fs.readFileSync(path.join(__dirname, 'templates', name), 'utf8');
const fill = (html, vars) =>
  Object.entries(vars).reduce((h, [k, v]) => h.replaceAll(`{{${k}}}`, v ?? ''), html);

const dots = (n, active) =>
  Array.from({ length: n }, (_, i) => `<div class="dot${i === active ? ' on' : ''}"></div>`).join('');

const counter = (i, n) => `${String(i).padStart(2, '0')} / ${String(n).padStart(2, '0')}`;

function photoDataUri() {
  if (!story.photo) return '';
  if (/^https?:\/\//.test(story.photo)) return story.photo;
  const p = path.isAbsolute(story.photo) ? story.photo : path.join(path.dirname(path.resolve(storyPath)), story.photo);
  return 'data:image/jpeg;base64,' + fs.readFileSync(p).toString('base64');
}

const isNews = story.type === 'news';
const total = 1 + (story.slides?.length ?? 0) + 1; // cover + details + closer
const photo = isNews ? photoDataUri() : '';
const logoUri = (f) => 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'assets', f)).toString('base64');
const common = { BRAND: esc(brand.name), HANDLE: esc(brand.handle), LOGO_CREAM: logoUri('logo-cream.png'), LOGO_DARK: logoUri('logo-dark.png') };

const pages = [];
// cover
pages.push(fill(tpl(isNews ? 'news-cover.html' : 'facts-cover.html'), {
  ...common,
  TAG: esc(story.category),
  KICKER: esc(story.kicker ?? ''),
  HEADLINE: rich(story.headline),
  PHOTO: photo,
  CREDIT: esc(story.photoCredit ?? ''),
}));
// detail slides
(story.slides ?? []).forEach((slide, i) => {
  pages.push(fill(tpl('detail.html'), {
    ...common,
    LABEL: esc(slide.label),
    HEADING: rich(slide.heading),
    BODY: esc(slide.body),
    COUNTER: counter(i + 2, total),
    DOTS: dots(total, i + 1),
    SOURCE: esc(story.source ? `source: ${story.source}` : ''),
    PHOTO: photo,
    CREDIT: esc(story.photoCredit ?? ''),
  }));
});
// closer
pages.push(fill(tpl('closer.html'), {
  ...common,
  SOURCE_NOTE: esc(story.source ? `source: ${story.source}` : ''),
}));

const launchOpts = {};
if (process.env.PUPPETEER_EXECUTABLE_PATH) {
  launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  launchOpts.args = ['--no-sandbox', '--disable-setuid-sandbox'];
}
const browser = await puppeteer.launch(launchOpts);
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 2 });

for (let i = 0; i < pages.length; i++) {
  await page.setContent(pages[i], { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all(Array.from(document.images).filter(im => !im.complete).map(im => new Promise(res => { im.onload = im.onerror = res; }))));
  await new Promise(res => setTimeout(res, 150));
  const file = path.join(outDir, `slide-${String(i + 1).padStart(2, '0')}.jpg`);
  await page.screenshot({ type: 'jpeg', quality: 92, path: file });
  console.log('rendered', file);
}
await browser.close();
console.log(`done: ${pages.length} slides -> ${outDir}`);
