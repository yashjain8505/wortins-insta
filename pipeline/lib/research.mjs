// Deep research before writing: the model searches the web and reads many pages, then hands back a
// dossier of concrete, sourced facts. This is what turns a thin Wikipedia summary into a story.
import { askClaude, extractJson } from './claude.mjs';

export async function researchDossier({ subject, angle, type, known = '', model = 'opus', minFacts = 20 }) {
  const prompt = `You are a researcher for an Instagram page about AI and startups. Build a fact dossier for a carousel story.

SUBJECT: ${subject}
STORY TYPE: ${type}
ANGLE: ${angle}
${known ? `\nWHAT WE ALREADY HAVE (do not repeat, go deeper):\n${known.slice(0, 3000)}\n` : ''}
DO THE RESEARCH FOR REAL:
- Run at least 6 different WebSearch queries (origin story, interviews with the founders, the money, the near-death moment, the scandal or turning point, quotes, "little known facts", court documents, podcasts, book excerpts).
- Read at least 6 pages with WebFetch: long-form profiles, interviews, court filings, company blogs, reputable news. Not just the top result.
- Hunt for the human details: what someone said word for word, what they risked, what they were rejected for, what it cost, what they bought, the strange decisions, the exact dates and dollar figures, the people nobody mentions.

RETURN ONLY JSON:
{
  "facts": [ { "fact": "one concrete fact, with the number/name/date in it", "year": 2019, "source": "https://..." }, ... at least ${minFacts} ],
  "quotes": [ { "quote": "exact words", "who": "name, role", "source": "https://..." }, ... ],
  "timeline": [ { "year": 2010, "event": "..." }, ... ],
  "thenVsNow": { "then": "smallest number or state at the start, with year", "now": "biggest number or state today, with year", "source": "https://..." },
  "sources": [ "domain.com", ... ]
}
Rules: every fact must have a real source URL you actually opened. No guesses. If two sources disagree, keep the one from the more reputable outlet and say so in the fact. No em dashes.`;
  const raw = await askClaude(prompt, { model, tools: ['WebSearch', 'WebFetch'], timeoutMs: 720000 });
  const d = extractJson(raw);
  if (!d || !Array.isArray(d.facts) || d.facts.length < 8) throw new Error(`research returned ${d?.facts?.length ?? 0} facts`);
  return d;
}

// Extra angles for a NEWS story: other outlets' coverage of the same event.
export async function researchNews({ title, source, articleText, model = 'sonnet' }) {
  const prompt = `You are a researcher for an Instagram news page about AI and startups. A story broke; we have one article. Find what the other coverage adds.

HEADLINE: ${title} (from ${source})
ARTICLE EXCERPT:
${articleText.slice(0, 2500)}

- Run 3-5 WebSearch queries about this exact story and the company/people in it.
- Read 3-5 other pages with WebFetch (other outlets, the company's own post, founder tweets or interviews, background on the company: what it does, who runs it, its history).
- Bring back the concrete details the first article missed: numbers, names, what the product actually does, what the founder said, why it matters to a normal person, any wild or funny detail.

RETURN ONLY JSON: { "facts": [ { "fact": "...", "source": "https://..." }, ... 8-15 ], "quotes": [ { "quote": "...", "who": "...", "source": "..." } ], "companyInOneLine": "what it builds, in plain words", "sources": ["domain.com", ...] }
Every fact needs a real URL you opened. No em dashes.`;
  const raw = await askClaude(prompt, { model, tools: ['WebSearch', 'WebFetch'], timeoutMs: 480000 });
  const d = extractJson(raw);
  if (!d || !Array.isArray(d.facts)) throw new Error('news research returned nothing');
  return d;
}

export const dossierText = (d) => [
  'FACTS (sourced):', ...d.facts.map((f, i) => `${i + 1}. ${f.year ? `[${f.year}] ` : ''}${f.fact} (${f.source})`),
  d.quotes?.length ? '\nQUOTES (word for word):' : '', ...(d.quotes ?? []).map(q => `"${q.quote}" - ${q.who} (${q.source})`),
  d.timeline?.length ? '\nTIMELINE:' : '', ...(d.timeline ?? []).map(t => `${t.year}: ${t.event}`),
  d.thenVsNow ? `\nTHEN: ${d.thenVsNow.then}\nNOW: ${d.thenVsNow.now}` : '',
  d.companyInOneLine ? `\nTHE COMPANY IN ONE LINE: ${d.companyInOneLine}` : '',
].filter(Boolean).join('\n');
