// Fetch an article page: plain-text extract + og:image.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';

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
  return { text, ogImage: og ? og[1] : null };
}

export async function downloadImage(url, destPath, { minBytes = 20000 } = {}) {
  const fs = await import('node:fs');
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < minBytes) throw new Error(`image too small (${buf.length}b)`);
  fs.writeFileSync(destPath, buf);
  return buf.length;
}
