// Grounding + images for evergreen stories: Wikipedia text and Wikimedia Commons photos.
const UA = 'wortins-insta/0.1 (https://wortins.com; editorial carousel pipeline)';

// Plain-text article, trimmed to the intro plus the sections that tell the story.
export async function wikiText(title, { maxChars = 9000 } = {}) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`wikipedia ${res.status}`);
  const data = await res.json();
  const page = Object.values(data.query?.pages ?? {})[0];
  if (!page || page.missing !== undefined || !page.extract) throw new Error(`no wikipedia page for "${title}"`);
  const full = page.extract;
  const parts = full.split(/\n(?==+ [^=]+ =+\n)/);
  const intro = parts[0].trim();
  const KEEP = /histor|found|origin|early|beginn|launch|collapse|bankrupt|scandal|controvers|decline|fall|crisis|acqui|sale|match|game|result|impact|legacy|aftermath|reception|growth|funding|invest/i;
  let out = intro;
  for (const sec of parts.slice(1)) {
    const heading = sec.match(/^=+ ([^=]+) =+/)?.[1] ?? '';
    if (KEEP.test(heading) && out.length < maxChars) out += '\n\n' + sec.trim();
  }
  return { title: page.title, text: out.slice(0, maxChars), url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}` };
}

// Search Wikimedia Commons for usable photos. Returns [{url, credit}] best-first.
export async function commonsPhotos(query, { limit = 6 } = {}) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=${limit * 2}&gsrnamespace=6&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1400`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) return [];
  const data = await res.json();
  const pages = Object.values(data.query?.pages ?? {});
  pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii) continue;
    if (!/image\/(jpeg|png)/.test(ii.mime ?? '')) continue;
    if (ii.width < 900 || ii.width / ii.height > 2.4 || ii.height / ii.width > 1.6) continue;
    if (/logo|icon|map|diagram|chart|screenshot|flag|coat of arms|seal|emblem|signature/i.test(p.title)) continue;
    const meta = ii.extmetadata ?? {};
    const artist = (meta.Artist?.value ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const license = (meta.LicenseShortName?.value ?? '').trim();
    out.push({ url: ii.thumburl ?? ii.url, credit: `Photo: ${artist ? artist + ' / ' : ''}Wikimedia Commons${license ? ' (' + license + ')' : ''}` });
    if (out.length >= limit) break;
  }
  return out;
}
