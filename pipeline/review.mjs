// Generate queue/review.html — a contact sheet of every pending carousel.
import fs from 'node:fs';
import path from 'node:path';

const published = fs.existsSync('state/published.json')
  ? new Set(JSON.parse(fs.readFileSync('state/published.json', 'utf8')).map(p => p.runId)) : new Set();
const dirs = fs.existsSync('queue')
  ? fs.readdirSync('queue').filter(d => fs.existsSync(path.join('queue', d, 'story.json')) && !published.has(d)).sort().reverse()
  : [];

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rows = dirs.map(d => {
  const story = JSON.parse(fs.readFileSync(path.join('queue', d, 'story.json'), 'utf8'));
  const slides = fs.readdirSync(path.join('queue', d)).filter(f => /^slide-\d+\.jpg$/.test(f)).sort();
  return `<section>
    <h2>${esc(story.headline)} <small>[${esc(story.type)}] ${esc(story.source ?? '')}</small></h2>
    <div class="slides">${slides.map(f => `<img src="${d}/${f}" loading="lazy">`).join('')}</div>
    <pre class="caption">${esc(story.caption ?? '(no caption)')}</pre>
    <pre class="cmd">node publish.mjs queue/${d}</pre>
  </section>`;
}).join('\n');

fs.writeFileSync('queue/review.html', `<!doctype html><meta charset="utf-8"><title>Carousel review</title>
<style>
  body { margin: 0; padding: 32px; background: #14151c; color: #eee; font: 15px/1.5 system-ui, sans-serif; }
  h1 { font-size: 22px; } h2 { font-size: 17px; margin: 0 0 12px; } small { color: #9a9; font-weight: 400; }
  section { margin: 0 0 48px; padding: 24px; background: #1c1e28; }
  .slides { display: flex; gap: 12px; overflow-x: auto; }
  .slides img { height: 320px; flex-shrink: 0; }
  pre { white-space: pre-wrap; background: #14151c; padding: 12px; font-size: 13px; color: #bbb; }
  .cmd { color: #d8ff3b; }
</style>
<h1>Pending carousels — ${dirs.length}</h1>
${rows || '<p>Queue is empty.</p>'}`);
console.log(`wrote queue/review.html (${dirs.length} pending)`);
