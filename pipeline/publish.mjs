// Publish a rendered carousel from queue/ to Instagram via the Graph API.
// usage: node publish.mjs queue/<dir> [--dry]
// --dry: upload slides to Supabase Storage + print the plan, but make no Instagram calls.
import fs from 'node:fs';
import path from 'node:path';
import './lib/env.mjs';
import { requireEnv } from './lib/env.mjs';

const GRAPH = 'https://graph.instagram.com/v21.0';
const dir = process.argv[2];
const dry = process.argv.includes('--dry');
if (!dir || !fs.existsSync(path.join(dir, 'story.json'))) {
  console.error('usage: node publish.mjs queue/<dir> [--dry]'); process.exit(1);
}

const story = JSON.parse(fs.readFileSync(path.join(dir, 'story.json'), 'utf8'));
const slides = fs.readdirSync(dir).filter(f => /^slide-\d+\.jpg$/.test(f)).sort();
if (slides.length < 2 || slides.length > 10) { console.error(`need 2-10 slides, found ${slides.length}`); process.exit(1); }

const [SUPABASE_URL, KEY, BUCKET] = requireEnv('SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_BUCKET');
const sbHeaders = { Authorization: `Bearer ${KEY}`, apikey: KEY };
const runId = path.basename(dir);

async function sb(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...sbHeaders, ...(opts.headers ?? {}) } });
  if (!res.ok) throw new Error(`${opts.method ?? 'GET'} ${url} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

async function ensureBucket() {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${BUCKET}`, { headers: sbHeaders });
  if (res.ok) return;
  await sb(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });
  console.log(`created public bucket "${BUCKET}"`);
}

async function uploadSlides() {
  const urls = [];
  for (const f of slides) {
    const objectPath = `${runId}/${f}`;
    await sb(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
      body: fs.readFileSync(path.join(dir, f)),
    });
    urls.push(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`);
  }
  return urls;
}

async function cleanupSlides() {
  await sb(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: slides.map(f => `${runId}/${f}`) }),
  }).catch(e => console.log(`storage cleanup failed (harmless): ${e.message}`));
}

async function ig(pathname, params) {
  const body = new URLSearchParams({ ...params, access_token: process.env.IG_ACCESS_TOKEN });
  const res = await fetch(`${GRAPH}/${pathname}`, { method: 'POST', body });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`IG ${pathname}: ${JSON.stringify(json.error ?? json).slice(0, 300)}`);
  return json;
}

async function waitFinished(containerId, label) {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${GRAPH}/${containerId}?fields=status_code&access_token=${process.env.IG_ACCESS_TOKEN}`);
    const json = await res.json();
    if (json.status_code === 'FINISHED') return;
    if (json.status_code === 'ERROR') throw new Error(`${label} container ERROR`);
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`${label} container not ready after 60s`);
}

console.log(`carousel: ${story.headline}\nslides: ${slides.length} · caption: ${(story.caption ?? '').split('\n')[0]}...`);
await ensureBucket();
const urls = await uploadSlides();
console.log(`uploaded ${urls.length} slides to storage`);

if (dry) {
  console.log('\n--dry: stopping before Instagram. Slide URLs:');
  urls.forEach(u => console.log('  ' + u));
  process.exit(0);
}

requireEnv('IG_ACCESS_TOKEN', 'IG_USER_ID');
const IG_USER = process.env.IG_USER_ID;
try {
  const children = [];
  for (const u of urls) {
    const { id } = await ig(`${IG_USER}/media`, { image_url: u, is_carousel_item: 'true' });
    children.push(id);
  }
  for (const [i, id] of children.entries()) await waitFinished(id, `slide ${i + 1}`);
  const { id: carouselId } = await ig(`${IG_USER}/media`, {
    media_type: 'CAROUSEL', children: children.join(','), caption: story.caption ?? '',
  });
  await waitFinished(carouselId, 'carousel');
  const { id: mediaId } = await ig(`${IG_USER}/media_publish`, { creation_id: carouselId });

  const permRes = await fetch(`${GRAPH}/${mediaId}?fields=permalink&access_token=${process.env.IG_ACCESS_TOKEN}`);
  const { permalink } = await permRes.json();
  console.log(`\nPUBLISHED: ${permalink ?? mediaId}`);

  const logPath = 'state/published.json';
  const log = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf8')) : [];
  log.push({ runId, mediaId, permalink, headline: story.headline, at: new Date().toISOString() });
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
} finally {
  await cleanupSlides();
}
