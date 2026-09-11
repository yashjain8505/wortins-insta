// Turn a rendered carousel (slide-*.jpg) into a 9:16 Reel video with music.
// usage: node reel.mjs <dir-with-slides> [trackPath] [outPath]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2];
const track = process.argv[3] || path.join(__dirname, 'audio', 'monkeys.mp3');
const out = process.argv[4] || path.join(dir, 'reel.mp4');
const slides = fs.readdirSync(dir).filter(f => /^slide-\d+\.jpg$/.test(f)).sort().map(f => path.join(dir, f));
if (slides.length < 2) { console.error('need at least 2 slides'); process.exit(1); }

const FADE = 0.4;
const durs = slides.map((_, i) => (i === 0 ? 3.2 : i === slides.length - 1 ? 3.0 : 4.8));

const args = [];
slides.forEach((s, i) => args.push('-loop', '1', '-t', String(durs[i] + FADE), '-i', s));
args.push('-i', track);

let filter = slides.map((_, i) =>
  `[${i}:v]scale=1080:1350,pad=1080:1920:0:285:color=0x1B1712,setsar=1,fps=30[v${i}]`
).join(';') + ';';
let prev = 'v0', offset = 0;
for (let i = 1; i < slides.length; i++) {
  offset += durs[i - 1] - (i > 1 ? FADE : 0) + (i === 1 ? 0 : 0);
  const label = i === slides.length - 1 ? 'vout' : `x${i}`;
  filter += `[${prev}][v${i}]xfade=transition=slideleft:duration=${FADE}:offset=${(offset - (i === 1 ? 0 : 0)).toFixed(2)}[${label}];`;
  prev = label;
}
const total = durs.reduce((a, b) => a + b, 0) - FADE * (slides.length - 1);
filter += `[vout]format=yuv420p[v];[${slides.length}:a]atrim=0:${total.toFixed(2)},afade=t=out:st=${(total - 1).toFixed(2)}:d=1[a]`;

execFileSync('ffmpeg', [
  '-y', ...args,
  '-filter_complex', filter,
  '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
  '-c:a', 'aac', '-b:a', '192k',
  '-t', total.toFixed(2),
  out,
], { stdio: ['ignore', 'ignore', 'pipe'] });
console.log(`reel: ${out} (${total.toFixed(1)}s, ${slides.length} slides, track: ${path.basename(track)})`);
