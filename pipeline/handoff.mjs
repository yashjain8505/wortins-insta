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

// Real tracks to search in Instagram's music picker, by mood. Three are suggested per alert, rotating.
// Business accounts only see the royalty-free library; a Creator account sees the full catalogue.
const TRACKS = {
  lofi:      ['Snowfall (Oneheart & reidenshi)', 'Aesthetic (Tollan Kim)', 'Sunset Lover (Petit Biscuit)', 'Blue (yung kai)', 'Lofi Chill (search: lofi)', 'Coffee Shop Lofi (search: chill lofi)'],
  cinematic: ['Cornfield Chase (Hans Zimmer)', 'Time (Hans Zimmer)', 'Experience (Ludovico Einaudi)', 'Nuvole Bianche (Ludovico Einaudi)', 'Interstellar Main Theme (Hans Zimmer)', 'Cinematic Ambient (search: cinematic)'],
  inspiring: ['Experience (Ludovico Einaudi)', 'Una Mattina (Ludovico Einaudi)', 'River Flows in You (Yiruma)', 'Cornfield Chase (Hans Zimmer)', 'Divenire (Ludovico Einaudi)', 'Inspiring Piano (search: inspirational)'],
  tension:   ['Lux Aeterna (Clint Mansell)', 'Time (Hans Zimmer)', 'Mombasa (Hans Zimmer)', 'Divenire (Ludovico Einaudi)', 'Dramatic Piano (search: dramatic piano)', 'Cinematic Tension (search: tension)'],
  dreamy:    ['Space Song (Beach House)', 'Snowfall (Oneheart & reidenshi)', 'Blue (yung kai)', 'Sunset Lover (Petit Biscuit)', 'Dreamy Ambient (search: dreamy)', 'Motion (search: ambient)'],
};
const MOOD = {
  ai: 'lofi', tech: 'lofi', 'india-tech': 'lofi', vc: 'lofi', funding: 'lofi', startups: 'lofi', 'big tech': 'lofi', research: 'dreamy',
  india: 'cinematic', global: 'cinematic', roundup: 'cinematic',
  'origin story': 'inspiring', 'turning point': 'tension', 'what went wrong': 'tension', 'ai history': 'dreamy', fact: 'lofi',
};
const pickTracks = (mood) => { const list = TRACKS[mood] ?? TRACKS.lofi; const start = Math.floor(Math.random() * list.length); return [0, 1, 2].map(i => list[(start + i) % list.length]); };
const musicFor = (cat) => {
  const mood = MOOD[cat] ?? 'lofi';
  const [a, b, c] = pickTracks(mood);
  return `${mood} vibe. Search one of these in the music picker:\n   1. ${a}\n   2. ${b}\n   3. ${c}\n   (Not there? A Business account only sees the royalty-free library. Switch to Creator in Settings > Account type to unlock the full catalogue; posting keeps working.)`;
};
const cat = story.type === 'fact' ? 'fact' : story.type === 'roundup' ? 'roundup' : (story.category ?? '').toLowerCase();
const music = musicFor(cat);

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
