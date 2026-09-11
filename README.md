# insta news

Auto-publishing Instagram news/facts carousel account (Tatva-style). Brand name TBD (placeholder: BRIEF.).

## Pieces
- `design/` — locked design system (Electric skin). Canvas: https://claude.ai/code/artifact/22d7f75a-b91f-411d-81f2-f303272df05b
- `renderer/` — story JSON → 2160×2700 JPEGs via Puppeteer. `node render.mjs <story.json> [outDir]`
- `pipeline/` — RSS fetch → LLM curation → story compose → render into `pipeline/queue/`
  - `node curate.mjs` — fetch all feeds + score (needs `claude` CLI logged in; `--fetch-only` to skip scoring)
  - `node compose.mjs [--category india]` — best candidate → carousel in queue/
  - `node run-fact.mjs` — next unused fact from facts-bank.json → carousel
  - `node review.mjs` — writes `queue/review.html`, a contact sheet of pending carousels
  - `node publish.mjs queue/<dir> [--dry]` — uploads slides to Supabase Storage (public bucket, auto-created, cleaned after publish) and publishes the carousel via IG Graph API. Needs `pipeline/.env` (see `.env.example`). `--dry` = storage upload + plan only.
- Automation (TODO, decide later): GH Actions vs local launchd (GH billing broke 2026-08-28 — see vault Tools/whoop-family-report.md) vs cron-job.org. Publisher is agnostic. Review gate stays ON first weeks.

## Notes
- Curation/composing runs on the Claude subscription via `claude -p` (no API key). GH Actions later needs `claude setup-token` secret.
- 100 API posts/day limit (plenty). Images must be JPEG at a public URL for the IG API (Supabase Storage).
- Cadence: 2-3 carousels/day. Review gate ON for first weeks: user approves queue/ before publish.
