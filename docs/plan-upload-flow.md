# Plan: upload your export from the site

Status: not started. Agreed on 2026-10-06 during the site redesign; to be built on its own branch.

## Why

The cover ("Me, myself, and AI") is the same for everyone and no longer shows any numbers, because a visitor may not have loaded their chats yet. Today the dashboard only works after running the pipeline in a terminal (`npm run parse`, `analyze`, `build`; see README). The goal is that someone with no data presses **Start**, learns in one sentence how to export their chats, and uploads the export in the page.

## The flow

1. **Cover → Start.**
   - No data yet: Start goes to a new **Upload** page.
   - Data already loaded: Start goes straight to Areas, as now. Add a small "Load a new export" link (for example in the header next to "How it's scored") that opens the Upload page.
2. **Upload page: explain and drop.**
   - Copy: "Export your chats from claude.ai (Settings → Privacy → Export data), then drop the zip files here. Everything stays on your computer."
   - A drop zone (and a file picker) that accepts the export zips: `conversations-000.zip` (and `-001`, `-002` … for large exports) and optionally `design_chats-000.zip`. Several files at once.
   - Optional checkbox: "Also include Claude Code sessions on this computer" (the parser's `--claude-code`).
3. **Read.** Unzip into `export/` and run the parser. Show what was found: "225 chats from Jan 2025 to Sep 2026 · 12 Claude Design chats".
4. **Estimate and confirm. Nothing is spent before this.**
   - Run the analysis dry run and show: chats to analyze, rough time, and rough cost ("about 5 minutes · roughly $3 of Claude usage"), plus which path it runs on (Claude login or API key).
   - Primary button "Analyze my chats", secondary "Cancel".
   - This is the go-ahead CLAUDE.md requires before `npm run analyze`. A pilot of 10 chats first could be offered as a lighter option.
5. **Progress.** Reading → Analyzing 37 of 225 → Building. Cached chats are skipped, so a re-upload only pays for new chats. If some fail, say how many and offer "Retry the failed ones".
6. **Done.** Go straight to Areas with the new data (reload `data.js`).

States to design: empty (drop zone), files chosen, reading, estimate/confirm, analyzing, building, done, and errors (wrong file type, no `conversations.json` in the zip, not logged in to Claude / no API key, plan limits hit).

## Architecture

The site is static files today and can't run the pipeline in the browser (it needs Node, the user's Claude login or API key, and the file system). So the upload needs a **small local server**:

- `npm start` serves `site/` and a few local-only endpoints, replacing `python3 -m http.server`. It binds to `127.0.0.1` only.
- Endpoints (sketch):
  - `POST /api/upload`: receives the zips, unpacks them into `export/`.
  - `POST /api/parse`: runs `pipeline/parse-export.mjs export [--claude-code]`, returns the counts.
  - `GET /api/estimate`: runs `pipeline/analyze.mjs --dry-run`, returns chat count and token estimate (turn this into time and cost on the server).
  - `POST /api/analyze`: runs the analysis; progress streamed with Server-Sent Events (the analyzer already prints `[done/total] title`; better to expose a progress callback than to parse stdout).
  - `POST /api/build`: runs `pipeline/build-dashboard.mjs` (this also calls Claude for the profile copy, so include it in the estimate).
- Prefer importing the pipeline steps as functions over spawning `npm run …`, so progress and errors come back as data. That may need small refactors of `parse-export.mjs`, `analyze.mjs` and `build-dashboard.mjs` to export a function next to their CLI.
- The site detects whether the server is there (for example `GET /api/status`). Opened as plain files (`site/index.html`) or via `python3 -m http.server`, the Upload page falls back to explaining the terminal steps from the README.

## Privacy and cost rules (from CLAUDE.md)

- The export, `data/`, `site/data.js` and `.env` never leave the machine except as analysis requests to Anthropic, and are never committed. Uploaded zips go to the gitignored `export/` folder.
- Never print chat contents in server logs; log counts and ids only.
- No analysis without the explicit confirm step above. The estimate must say whether it is plan usage (Claude login, default) or API billing (`CLAUDE_BACKEND=api`).
- Changing the prompt, codebook or model invalidates the cache; the upload flow must not change any of them.

## Open questions

1. Design the Upload page and its states in Paper first (style A, file "Humble vase"), then build?
2. Where does "Load a new export" live once data exists: header link, a footer, or the cover?
3. Replace the existing data or keep several exports side by side (for example one per person)?
4. Offer the 10-chat pilot as a step, or only the full run?
5. Should the cover also say whether data is already loaded (for example "Continue" instead of "Start")?

## Files likely touched

- New: `server/` (or `pipeline/serve.mjs`), `site/upload.js`, an Upload section in `site/index.html`, styles in `site/dashboard.css`.
- Changed: `site/pages.js` (Start goes to Upload when there is no data), `site/dashboard.js` (empty state), `package.json` (`start` script, maybe a zip library), README (new "Run it" section).
