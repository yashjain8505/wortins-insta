// Music-post handoff: upload slides + manifest, ping Yash on Telegram.
// He taps the "Wortins Post" iOS Shortcut, which reads handoff/latest.json,
// saves the slides to Photos, copies the caption, and opens Instagram.
// usage: node handoff.mjs queue/<dir>
import fs from 'node:fs';
import path from 'node:path';
import './lib/env.mjs';
import { requireEnv } from './lib/env.mjs';

const dir = process.argv[2];
if (!dir || !fs.existsSync(path.join(dir, 'story.json'))) {
  console.error('usage: node handoff.mjs queue/<dir>'); process.exit(1);
}
const [SUPABASE_URL, KEY, BUCKET, TG, CHAT] = requireEnv(
  'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_BUCKET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID');

const story = JSON.parse(fs.readFileSync(path.join(dir, 'story.json'), 'utf8'));
const slides = fs.readdirSync(dir).filter(f => /^slide-\d+\.jpg$/.test(f)).sort();
const runId = path.basename(dir);
const sbHeaders = { Authorization: `Bearer ${KEY}`, apikey: KEY };

const MUSIC = {
  india: 'Minimal cinematic beat. In IG music search: "cinematic ambient"',
  global: 'Minimal cinematic beat. In IG music search: "cinematic ambient"',
  ai: 'Lo-fi chill beat. In IG music search: "lofi"',
  tech: 'Lo-fi chill beat. In IG music search: "lofi"',
  'india-tech': 'Lo-fi chill beat. In IG music search: "lofi"',
  vc: 'Lo-fi chill beat. In IG music search: "lofi"',
  fact: 'Playful and quirky. In IG music search: "quirky" or use a trending funny audio',
  science: 'Dreamy ambient. In IG music search: "dreamy ambient" or "slowed reverb"',
  story: 'Dreamy ambient. In IG music search: "dreamy ambient"',
};
const cat = (story.type === 'fact') ? 'fact' : (story.category ?? '').toLowerCase();
const music = MUSIC[cat] ?? MUSIC[(story.type === 'news' ? 'india' : 'fact')] ?? 'Pick a lo-fi beat';

async function put(objectPath, body, contentType) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: 'POST', headers: { ...sbHeaders, 'Content-Type': contentType, 'x-upsert': 'true' }, body,
  });
  if (!res.ok) throw new Error(`upload ${objectPath} -> ${res.status}: ${(await res.text()).slice(0, 150)}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`;
}

const urls = [];
for (const f of slides) urls.push(await put(`handoff/${runId}/${f}`, fs.readFileSync(path.join(dir, f)), 'image/jpeg'));
const manifest = { runId, headline: story.headline, caption: story.caption ?? '', music, slides: urls, createdAt: new Date().toISOString() };
const manifestBody = JSON.stringify(manifest, null, 1);
await put(`handoff/${runId}.json`, manifestBody, 'application/json');
await put('handoff/latest.json', manifestBody, 'application/json');

// Zip + caption.txt: lets the iOS Shortcut stay a simple linear chain (no variables).
const { execFileSync } = await import('node:child_process');
const zipPath = path.join(dir, 'slides.zip');
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execFileSync('zip', ['-j', '-q', zipPath, ...slides.map(f => path.join(dir, f))]);
const zipUrl = await put(`handoff/${runId}.zip`, fs.readFileSync(zipPath), 'application/zip');
await put('handoff/latest.zip', fs.readFileSync(zipPath), 'application/zip');
await put('handoff/latest-caption.txt', story.caption ?? '', 'text/plain; charset=utf-8');
console.log(`uploaded ${urls.length} slides + manifest + latest.zip + latest-caption.txt`);

async function tg(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${TG}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`telegram ${method}: ${JSON.stringify(json).slice(0, 200)}`);
}

const headline = String(story.headline ?? '').replace(/==/g, '');
await tg('sendPhoto', {
  chat_id: CHAT, photo: urls[0],
  caption: `🗞 Post ready: ${headline}\n\n🎵 ${music}\n\n👉 Tap your "Wortins Post" shortcut: it saves the slides + copies the caption, then opens Instagram.\n\n(Missed it and a newer one arrived? This post's slides: ${zipUrl})`,
});
await tg('sendMessage', { chat_id: CHAT, text: story.caption ?? '(no caption)' });
console.log('Telegram alert sent');
