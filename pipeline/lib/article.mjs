// Fetch an article page: plain-text extract, og:image, and body image candidates.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';
const JUNK = /logo|icon|avatar|sprite|pixel|badge|button|banner|placeholder|blank|spacer|emoji|thumb_small|\.svg|\.gif|1x1|widget|share|comment|author/i;

function absolutize(u, base) { try { return new URL(u, base).href; } catch { return null; } }
// Same picture served at several sizes must count once: drop query strings and size tokens.
const sizeKey = (u) => { try { const x = new URL(u); return (x.origin + x.pathname).replace(/[-_](\d{2,4})x(\d{2,4})(?=\.|$)/g, '').replace(/[-_]\d{3,4}w(?=\.|$)/g, '').replace(/\/w_\d+\//g, '/').replace(/-scaled/g, '').replace(/\/(?:l|m|s|xl|xxl|thumb|large|medium|small)-(?=[^\/]+$)/, '/').toLowerCase(); } catch { return u; } };

function bodyImages(html, base) {
  const out = [];
  const seen = new Set();
  const push = (u) => {
    if (!u) return;
    const abs = absolutize(u.trim(), base);
    if (!abs || !/^https?:/.test(abs) || JUNK.test(abs) || seen.has(abs)) return;
    seen.add(abs); out.push(abs);
  };
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const srcset = tag.match(/\bsrcset=["']([^"']+)["']/i)?.[1];
    if (srcset) push(srcset.split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean).pop());
    push(tag.match(/\bdata-src=["']([^"']+)["']/i)?.[1]);
    push(tag.match(/\bsrc=["']([^"']+)["']/i)?.[1]);
  }
  return out;
}

export async function fetchArticle(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`article fetch ${res.status}`);
  const html = await res.text();
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&amp;|&quot;|&#\d+;|&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 5000);
  const ogImage = og ? absolutize(og[1], url) : null;
  const keys = new Set();
  const images = [ogImage, ...bodyImages(html, url)].filter(Boolean).filter(u => { const k = sizeKey(u); if (keys.has(k)) return false; keys.add(k); return true; });
  return { text, ogImage, images };
}

// Width/height for JPEG + PNG headers (enough to reject icons and thumbnails). Others: unknown.
export function imageSize(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

export async function downloadImage(url, destPath, { minBytes = 20000, minWidth = 0 } = {}) {
  const fs = await import('node:fs');
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < minBytes) throw new Error(`image too small (${buf.length}b)`);
  const size = imageSize(buf);
  if (size && (size.w < minWidth || size.w / size.h > 2.6 || size.h / size.w > 2.2)) throw new Error(`bad dimensions ${size.w}x${size.h}`);
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

// Download up to n distinct usable photos from a candidate list into dir as photo.jpg, photo-2.jpg, ...
export async function downloadPhotoSet(urls, dir, n, { minBytes = 20000, minWidth = 700 } = {}) {
  const path = await import('node:path');
  const files = [];
  for (const u of urls) {
    if (files.length >= n) break;
    const name = files.length === 0 ? 'photo.jpg' : `photo-${files.length + 1}.jpg`;
    try { await downloadImage(u, path.join(dir, name), { minBytes, minWidth }); files.push(name); }
    catch { /* skip unusable image */ }
  }
  return files;
}
