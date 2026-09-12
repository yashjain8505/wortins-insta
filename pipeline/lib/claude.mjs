// Ask Claude via the local CLI (runs on the Claude Code subscription — no API key).
import { execFile } from 'node:child_process';

// Fallback chain: a failed Opus call (rate limit, usage window, timeout) retries on Sonnet; Sonnet retries once on Sonnet.
export async function askClaude(prompt, { model = 'sonnet', timeoutMs = 240000 } = {}) {
  try { return await askOnce(prompt, { model, timeoutMs }); }
  catch (e) {
    const fallback = model === 'opus' ? 'sonnet' : model;
    console.log(`claude ${model} failed (${String(e.message).slice(0, 80)}), retrying on ${fallback}`);
    await new Promise(r => setTimeout(r, 20000));
    return askOnce(prompt, { model: fallback, timeoutMs });
  }
}

function askOnce(prompt, { model, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'claude',
      ['-p', '--model', model],
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`claude CLI failed: ${stderr || err.message}`));
        else resolve(stdout.trim());
      }
    );
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// Pull the first JSON object/array out of a model response.
export function extractJson(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const iObj = raw.indexOf('{'), iArr = raw.indexOf('[');
  let start;
  if (iObj < 0 && iArr < 0) throw new Error('no JSON found in model response');
  if (iObj < 0) start = iArr; else if (iArr < 0) start = iObj; else start = Math.min(iObj, iArr);
  const close = raw[start] === '{' ? '}' : ']';
  const end = raw.lastIndexOf(close);
  if (end <= start) throw new Error('unterminated JSON in model response');
  return JSON.parse(raw.slice(start, end + 1));
}
