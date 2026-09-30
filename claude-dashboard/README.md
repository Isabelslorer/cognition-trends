# Claude history → Miro dashboard

Fills the Miro "Looking back" dashboard from an exported Claude.ai conversation history, instead of the mock data in the extension's `dashboard.js`.

It reuses the extension's approach: the same area taxonomy, the same six work dimensions (0 = AI carried it, 100 = you did), the same collaboration markers and interaction patterns, and the same per-chat record shape as `buildDashboardSessionRecord()` in `content.js`.

## Pipeline

```
Claude export (conversations.json)
  │  npm run parse -- <file>      pipeline/parse-export.mjs
  ▼
data/conversations.json            normalized: role + text per message, attachments and tool use inlined
  │  npm run analyze              pipeline/analyze.mjs   (1 Claude Haiku 4.5 call per chat, cached)
  ▼
data/sessions/<id>.json            one record per chat: areas, work_split, markers, pattern, summaries
  │  npm run build                pipeline/build-dashboard.mjs  (aggregates + 1 synthesis call)
  ▼
site/data.js                       window.MIRO_DASHBOARD_DATA = { meta, areas, aspects, profile }
  ▼
site/index.html                    the extension's dashboard UI, rendering that data
```

| Dashboard section | Computed from |
|---|---|
| Bubbles (% of use, chats) | Each chat's primary area counts 1, secondary 0.5; share of the total |
| Sliders (dot, band) | Mean of each `work_split` dimension; band = middle half (25th–75th percentile) |
| Verdict | ≥80 Clearly you, ≥58 Leaned to you, 43–57 Shared, 21–42 Leaned to AI, ≤20 Clearly AI |
| Trend line | Older half of chats vs newer half; a shift of 6+ points counts as a trend |
| Profile, area copy, slider details | One synthesis call over the stats plus digests of the 60 most recent chats |

## Run it

Requires Node 18+ and an Anthropic API key. Run `npm install` once for the Anthropic SDK.

1. Export your data: claude.ai → Settings → Privacy → Export data. Unzip the file you receive by email.
2. `cp .env.example .env` and add your `ANTHROPIC_API_KEY`.
3. From this folder:

```bash
npm run parse -- "path/to/unzipped-export"
npm run analyze -- --dry-run      # shows chat count, token estimate and the first prompt; no API calls
npm run analyze -- --limit 10     # try a few chats first
npm run analyze                   # the rest (already-analyzed chats are skipped)
npm run build
```

4. Open `site/index.html`. Opening the file directly works, or serve the folder with `python -m http.server --directory site`.

To try it without an export, run `npm run sample`, which parses `sample/conversations.json` (8 made-up chats in the export format) instead.

### Options

- `analyze`: `--model <claude model id>` (default `claude-haiku-4-5`), `--limit N` (newest first), `--since 2026-01-01`, `--min-messages 4`, `--concurrency 4`, `--force` (re-analyze cached chats).
- `build`: `--synth-model <id>` (default `claude-sonnet-5-5`), `--no-synthesis` (stats-only copy, no API call), `--force` (rewrite the cached synthesis).

### Cost

Haiku 4.5 is roughly $0.01 per chat (long chats are trimmed to their first 6 and last 24 messages, 1,500 characters each). The synthesis call is a few cents. `analyze` prints an estimated cost (from token usage and list prices) when it finishes. Results are cached in `data/`, so re-running only pays for new or changed chats.

## Privacy

Conversation text is sent to the Anthropic API during `analyze`, and short per-chat summaries during `build`. Everything else stays local. `data/`, `export/`, `site/data.js`, `.env` and export manifests are gitignored; do not commit them.
