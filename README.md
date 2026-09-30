# Claude history → Miro dashboard

Builds the Miro "Looking back" dashboard from a person's own Claude history: where AI shows up in their work, and how the work splits between them and AI.

It reads three sources:

| Source | Where it comes from |
|---|---|
| Claude chats | `conversations.json` in the claude.ai data export |
| Claude Design chats | `design_chats/` in the claude.ai data export |
| Claude Code sessions | local transcripts in `~/.claude/projects` on the machine you run this on (not in the export) |

The dashboard has two views, chosen from the top menu, plus a source switch (All sources / Claude chats / Claude Code / Claude Design) that applies to both:

- **Overview**: where AI shows up (topic bubbles), how the work splits (six sliders), and a written profile.
- **Over time**: one line per kind of work across months or quarters, with You at the top and AI at the bottom, filterable by topic, how the chat opened and how it unfolded.

It started from the Miro ChatGPT extension (upstream repo `sylee15/capstone-mock`; the extension files are in this repo's git history before the move to the root) and keeps its approach: the same topic taxonomy, the same six work dimensions (0 = AI carried it, 100 = you did), the same collaboration markers and interaction patterns, the same per-chat record shape as its `buildDashboardSessionRecord()`, and its dashboard design.

## Setup

Requires Node 18+ and an Anthropic API key.

### 1. Install

```bash
git clone git@github.com:Isabelslorer/cognition-trends.git
cd cognition-trends
npm install
cp .env.example .env    # then set ANTHROPIC_API_KEY in .env
```

### 2. Get the claude.ai export

1. On claude.ai: Settings → Privacy → Export data. The export arrives as a small manifest JSON (`manifest-<id>-...json`) listing one download link per zip. **Each link works only once**, and the manifest points at account data, so never commit it (it is gitignored if saved in `sample/`, but keep it out of the repo).
2. Download these zips (the others, such as projects, memories and login metadata, are not used):
   - `conversations-000.zip` (Claude chats). Large exports are split into several parts: `conversations-000.zip`, `conversations-001.zip`, and so on. Download all of them.
   - `design_chats-000.zip` (Claude Design; optional)
3. Unzip them into `export/` at the repo root (gitignored) so the layout is:

```
export/
├── conversations-000/
│   └── conversations.json
├── conversations-001/          (only if the export has more parts)
│   └── conversations.json
└── design_chats/
    └── <uuid>.json ...
```

```bash
for f in conversations-*.zip; do unzip "$f" -d "export/${f%.zip}"; done   # one folder per part
unzip design_chats-000.zip -d export                                    # the zip already contains design_chats/
```

The parser reads every `conversations-NNN/` part and merges them; a chat that appears in more than one part is kept once, in its most recently updated form.

### 3. Claude Code sessions (optional)

Add `--claude-code` when parsing to include the Claude Code sessions stored on this machine in `~/.claude/projects/<project>/<session>.jsonl`. Sessions from other computers or the cloud are not included unless you point `--claude-code-dir` at a copy of that folder. Subagent transcripts (`<session>/subagents/`) are skipped.

### 4. Run the pipeline

```bash
npm run parse -- export --claude-code   # reads all conversations-NNN/ parts and design_chats/
npm run analyze -- --dry-run      # chat count, token estimate and the first prompt; no API calls, no cost
npm run analyze -- --limit 10     # pilot a few chats and read data/sessions/*.json before paying for the rest
npm run analyze -- --concurrency 6
npm run build
```

`parse` prints how many export parts it read (when there is more than one), then one line per source (`Parsed N claude.ai chats`, `Parsed N Claude Design chats`, `Parsed N Claude Code sessions`) and the total written. Only chats with 4 or more messages are analyzed.

### 5. View it

```bash
python -m http.server 8765 --directory site
```

Then open http://localhost:8765. Opening `site/index.html` directly also works. After a rebuild, hard-refresh (Ctrl+Shift+R), because browsers cache `data.js`.

To try the pipeline without an export: `npm run sample` parses 8 made-up chats in `sample/conversations.json`. Analyzing them costs about $0.06.

## How it works

```
export + ~/.claude/projects
  │  npm run parse     pipeline/parse-export.mjs (+ lib/parse-design-chats.mjs, lib/parse-claude-code.mjs)
  ▼
data/conversations.json     one normalized list: id, source, title, dates, messages (role + text)
  │  npm run analyze   pipeline/analyze.mjs: one Claude Haiku 4.5 call per chat with 4+ messages, cached
  ▼
data/sessions/<id>.json     one record per chat: topics, six work scores, markers, pattern, summaries
  │  npm run build     pipeline/build-dashboard.mjs: aggregates + one Claude Sonnet 5.5 call per source
  ▼
site/data.js                window.MIRO_DASHBOARD_DATA = { meta, areas, aspects, profile, variants, timeline }
  ▼
site/index.html             dashboard.js (overview), trends.js (over time), sources.js (source switch)
```

**Parse.** Keeps what the user typed and what Claude said. Tool calls become short notes (`[used tool: WebSearch]`, `[used tools: Read ×3, Edit]`); raw tool output, Claude's internal reasoning and system-generated lines are dropped. Attachments become `[attached name: first 400 chars]`. Claude Code slash commands and interruptions become `[ran /command]` and `[user interrupted AI]`; Claude Design direct edits become `[user edited the design directly]`.

**Analyze.** Long chats are trimmed to their first 6 and last 24 messages, 1,500 characters each. The model returns fixed JSON (structured outputs): one or two topics, and for each of six kinds of work (ideas, direction, research, building, catching problems, final call) whether it happened, a one-sentence reason, then a 0–100 position. It also returns five yes/no markers, how the chat opened, how it unfolded, and short summaries. The instructions are in `systemPrompt()` in `analyze.mjs`; per-source context is in `SOURCE_CONTEXT`.

**Caching.** A chat is re-analyzed only if its message text, the model or the prompt/schema changed (the fingerprint is stored in each record as `source_hash`). `--force` re-analyzes everything. Profile copy is cached per source in `data/synthesis-<source>.json` and rewritten only when that source's set of analyzed chats changes.

| Dashboard element | Computed from |
|---|---|
| Bubbles (% of use, chats) | Each chat's main topic counts 1, its second topic 0.5; share of the total |
| Sliders (dot, band) | Mean position per work type, using only chats where that work happened; band = middle half (25th–75th percentile) |
| Verdict | ≥80 Clearly you, 58–79 Leaned to you, 43–57 Shared, 21–42 Leaned to AI, ≤20 Clearly AI |
| Slider trend line | Older half of chats vs newer half; needs 6+ chats over 60+ days and a 6-point shift |
| Profile, area copy, slider details | One synthesis call per source over the stats plus digests of the 60 most recent chats |
| Over time view | Computed in the browser from `timeline` (one row per chat): average per month or quarter, only from chats where that work happened, and only plotted when at least 5 chats contribute |

## Options

- `parse`: the first argument is the `export/` folder, one `conversations-NNN/` part (its sibling parts are included), or a single `conversations.json`. `--design <folder>` (default: `design_chats/` inside or next to the export), `--claude-code`, `--claude-code-dir <dir>`.
- `analyze`: `--model <claude model id>` (default `claude-haiku-4-5`), `--limit N` (newest first), `--since 2026-01-01`, `--min-messages 4`, `--concurrency 4`, `--force`, `--dry-run`.
- `build`: `--synth-model <id>` (default `claude-sonnet-5-5`), `--no-synthesis` (stats-only copy, no API call), `--force` (rewrite cached profile copy).
- `.env`: `ANTHROPIC_API_KEY` (required), `CLAUDE_MODEL`, `CLAUDE_SYNTH_MODEL`.

## Cost

About $0.007 per analyzed chat with Haiku 4.5, plus a few cents per source for the profile copy. A history of roughly 650 analyzed chats costs about $5 end to end. `analyze` prints an estimate from token usage when it finishes, and re-runs only pay for new or changed chats.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing ANTHROPIC_API_KEY` | Set it in `.env` at the repo root |
| `No parsed conversations yet` | Run `npm run parse -- export` first |
| `No conversations.json found` | Check the `export/conversations-000/conversations.json` layout |
| `No analyzed sessions found` | Run `npm run analyze` before `npm run build` |
| Design chats not picked up | Check the `export/design_chats/` layout, or pass `--design <folder>` |
| Dashboard shows old data or no "Over time" menu item | Hard-refresh; the browser cached `data.js` or the scripts |
| "No month has 5 or more to plot a point" | Group by quarter, widen the filters, or use the table view |
| Some chats failed during analyze | Re-run the same command; only the missing ones are sent |

## Privacy

Conversation text (including Claude Code sessions, when included) is sent to the Anthropic API during `analyze`, and short per-chat summaries during `build`. Everything else stays local. `data/`, `export/`, `site/data.js`, `.env`, `node_modules/` and export manifests are gitignored. Never commit them.
