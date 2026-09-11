// Tiny .env loader (no dependency).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
export function requireEnv(...names) {
  const missing = names.filter(n => !process.env[n]);
  if (missing.length) {
    console.error(`missing in pipeline/.env: ${missing.join(', ')} (see .env.example)`);
    process.exit(1);
  }
  return names.map(n => process.env[n]);
}
