// Fetch + normalize all RSS sources into candidate items. Feeds fetched in parallel.
import Parser from 'rss-parser';

const parser = new Parser({
  timeout: 12000,
  headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 insta-news/0.1' },
  customFields: { item: [['media:content', 'mediaContent'], ['media:thumbnail', 'mediaThumb']] },
});

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function itemImage(item) {
  return (
    item.enclosure?.url ||
    item.mediaContent?.$?.url || item.mediaContent?.url ||
    item.mediaThumb?.$?.url || item.mediaThumb?.url ||
    null
  );
}

// Hard wall-clock cap per feed on top of the parser timeout, so one stalled
// socket can never hang the whole run (it did, on 2026-09-11).
const withDeadline = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('deadline')), ms))]);

export async function fetchAllFeeds(sources, { freshHours = 24, freshHoursStory = 96 } = {}) {
  const now = Date.now();
  const jobs = Object.entries(sources).flatMap(([category, feeds]) =>
    feeds.map(feed => ({ category, feed }))
  );
  const settled = await Promise.allSettled(jobs.map(async ({ category, feed }) => {
    const maxAgeMs = (category === 'story' ? freshHoursStory : freshHours) * 3600 * 1000;
    const parsed = await withDeadline(parser.parseURL(feed.url), 20000);
    const out = [];
    for (const item of parsed.items ?? []) {
      const ts = item.isoDate ? Date.parse(item.isoDate) : (item.pubDate ? Date.parse(item.pubDate) : NaN);
      if (!Number.isFinite(ts) || now - ts > maxAgeMs || ts > now + 3600_000) continue;
      if (!item.title || !item.link) continue;
      out.push({
        category,
        source: feed.name,
        title: item.title.trim(),
        link: item.link,
        snippet: String(item.contentSnippet ?? '').slice(0, 200),
        publishedAt: new Date(ts).toISOString(),
        ageH: Math.round((now - ts) / 3600_000),
        image: itemImage(item),
        key: norm(item.title),
      });
    }
    return out;
  }));
  const candidates = settled.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
  const errors = settled
    .map((r, i) => (r.status === 'rejected' ? { source: jobs[i].feed.name, error: String(r.reason?.message ?? r.reason).slice(0, 120) } : null))
    .filter(Boolean);
  // intra-run dedupe on normalized title
  const seen = new Set();
  const deduped = candidates.filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)));
  return { candidates: deduped, errors };
}
