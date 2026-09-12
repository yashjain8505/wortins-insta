// The house voice, shared by every writer prompt, plus the editor pass that every carousel goes through.
import { askClaude, extractJson } from './claude.mjs';

export const VOICE = `HOW TO WRITE (the difference between a post people share and one they scroll past):
- You are telling this to a smart friend at dinner who does not work in finance. If a sentence would not survive that dinner table, rewrite it.
- BANNED WORDS unless explained in plain words in the same sentence: IPO, SPAC, Chapter 11, filing, governance, valuation, run rate, Series A/B/C, EBITDA, unicorn, liquidity, restructuring, stakeholder, ecosystem, leverage, synergy, "went public", "bankruptcy protection". Say what happened instead: "the company was worth $47 billion on paper", "it went bankrupt", "it sold shares to the public for the first time".
- Every slide carries one concrete, human fact: what a person did, said, bought, lost, risked, or refused. Never a summary sentence ("investors had concerns", "the company grew fast"). Say WHO, WHAT, HOW MUCH.
- The story must have a spine: hook, the setup, the moment it turned (or nearly died), the number that proves it, the ending. Each slide is one beat. The reader must be able to say what happened in one breath after reading.
- Years are anchors, never surprises. If a slide jumps in time, start the heading or body with the year ("2019: worth $47 billion. 2023: bankrupt."). A year that appears without context feels random and gets the post skipped.
- Real quotes, word for word, in quotation marks, whenever the source has one. A quote beats a paraphrase every time.
- Short common words. One idea per sentence. Under 12 words per sentence where possible. Give big numbers a human scale. Indian English. NEVER use em dashes or en dashes; use periods, commas or colons. Ranges use hyphens.
- Headings are claims, not labels. Not "The filing", but "The paperwork showed he had rented buildings to his own company".`;

// Second pass: a ruthless editor rewrites the draft. Adds no facts, removes weak slides, kills jargon.
export async function editorPass(story, { model, kind = 'news' }) {
  const prompt = `You are the ruthless editor of an Instagram page about AI and startups. Below is a DRAFT carousel as JSON. Your job: make it the version people screenshot and send to friends.

${VOICE}

EDIT RULES:
- Add NO new facts. Cut, sharpen, reorder, rewrite. If a slide is weak (vague, jargon, no concrete fact, repeats another slide), delete it. Keep between 4 and 8 detail slides: as many as there are strong beats, never padding.
- Check the story reads as one thread. If a reader could not retell it in one breath, fix the order and the transitions.
- Every heading must be a claim with a concrete fact. Every body must add something the heading did not say.
- The headline is the single most surprising fact, max 12 words, exactly one ==highlight==.
- Keep the same JSON shape and field names. Keep "photo" and "photoPos" fields on slides if present (you may drop a slide, never reassign photos). Keep "category", "kicker", "source". Rewrite the caption to the same 5-block formula if it has jargon, else keep it.
- Output ONLY the improved JSON. No commentary.

DRAFT (${kind}):
${JSON.stringify(story)}`;
  const raw = await askClaude(prompt, { model });
  const out = extractJson(raw);
  if (!out || !Array.isArray(out.slides) || out.slides.length < 4 || out.slides.length > 8 || !out.headline) throw new Error('editor pass returned an invalid carousel');
  return out;
}
