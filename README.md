# Claude history → Miro dashboard

Builds the Miro "Looking back" dashboard from a person's own Claude history: where AI shows up in their work, and how the work splits between them and AI.

It reads three sources:

| Source | Where it comes from |
|---|---|
| Claude chats | `conversations.json` in the claude.ai data export |
| Claude Design chats | `design_chats/` in the claude.ai data export |
| Claude Code sessions | local transcripts in `~/.claude/projects` on the machine you run this on (not in the export) |

The dashboard has three views, chosen from the top menu, plus a source switch (All sources / Claude chats / Claude Code / Claude Design) that applies to all of them:

- **Overview**: where AI shows up (topic bubbles), how the work splits (six sliders), and a written profile.
- **Over time**: one line per kind of work across months or quarters, with You at the top and AI at the bottom, filterable by topic, how the chat opened and how it unfolded.
- **How it's scored**: a visual walk-through for the curious. A made-up chat is coded moment by moment and counted into positions, then your own chats are shown combining into a slider and a trend line, with how reliable each kind of work is.

It started from the Miro ChatGPT extension (upstream repo `sylee15/capstone-mock`; the extension files are in this repo's git history before the move to the root) and keeps its approach: the same topic taxonomy, the same six work dimensions (0 = AI carried it, 100 = you did), the same collaboration markers and interaction patterns, the same per-chat record shape as its `buildDashboardSessionRecord()`, and its dashboard design.

## Setup

Requires Node 18+ and [Claude Code](https://code.claude.com) logged in to your Claude account (run `claude`, then `/login`). The pipeline calls Claude through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk), which uses that login, so you don't need an API key. Analysis then counts against your Claude plan's usage limits instead of being billed per token.

Prefer to pay per token with your own API key? Set `CLAUDE_BACKEND=api` and `ANTHROPIC_API_KEY` in `.env`. That path calls the Anthropic API directly. It is also the only one that can set temperature: v2 codes at temperature 0 there, while the Agent SDK uses the model's default. The reliability numbers in [eval/README.md](eval/README.md) were measured on the API path, so re-run `npm run eval` if you want them for the Agent SDK path (its results are cached separately).

### 1. Install

```bash
git clone git@github.com:Isabelslorer/cognition-trends.git
cd cognition-trends
npm install
cp .env.example .env    # optional: model overrides, or CLAUDE_BACKEND=api with a key
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

## Choosing the analysis model (your decision)

You decide which model analyzes your chats. It's a trade-off between cost and accuracy that this repo can't make for you. Set it with `--model` or `CLAUDE_MODEL` in `.env`. The default is Haiku 4.5.

| | Haiku 4.5 (default) | Sonnet 5.5 |
|---|---|---|
| Cost for about 650 chats | about $8 | about $20 |
| Held-out scenarios (in band / did it happen / key moments found) | 79% / 100% / 92% | 88% / 100% / 96% |
| Same model, same chats, run twice (Krippendorff's alpha) | 0.94 | 0.94 |

**How these numbers were tested.** Two tests, each answering a different question:

1. **Is the model consistent? (reliability)**
   - The same 30 real chats were analyzed four times: Haiku twice and Sonnet twice.
   - Three comparisons were made from those four runs: Haiku against itself, Sonnet against itself, and Haiku against Sonnet. These are not the same test run three times.
   - Agreement is measured with Krippendorff's alpha: 1 means perfect agreement, 0 means no better than chance. 0.80 or above is the usual threshold for reliable data.
   - Both models agree with themselves at 0.94, so a change you see over time isn't just the model reading a chat differently on another day.
   - Haiku and Sonnet agree with each other at only 0.72 overall, and much less on some dimensions (ideas 0.31, direction 0.47).
   - Being consistent doesn't make a model correct. A model can be consistently wrong.
2. **Is the model correct? (validity)**
   - The models analyzed scenario conversations whose correct answers are known in advance. There are 24 used while developing the prompt, plus 8 written afterwards and run once (held out).
   - Three things are scored: whether each score lands in the expected range ("in band"), whether the model correctly says if each kind of work happened at all, and whether it finds specific key moments (for example "the user caught the bug at message 3").
   - Sonnet passes the pre-registered gates on the held-out set. Haiku misses the in-band gate (79% against a target of 85%).
   - Each of Haiku's misses broke a rule the codebook states explicitly. For example, it credited a plain "ok, I'll use that" as the user's own decision.

**Important limitation: the "gold set" in this version is generated, not hand-labelled.** Claude wrote the scenario conversations and their expected answers, and Claude also does the analysis. The scenarios therefore show whether the model applies the codebook as written. They do not show that its codes match how a human researcher would read your chats, and they may flatter the results. A gold set labelled independently by two people is the next step; the harness already accepts that format (see [`eval/README.md`](eval/README.md)). Until then, treat the dashboard as an indication of patterns, not a validated measurement.

## How it works

```
export + ~/.claude/projects
  │  npm run parse     pipeline/parse-export.mjs (+ lib/parse-design-chats.mjs, lib/parse-claude-code.mjs)
  ▼
data/conversations.json     one normalized list: id, source, title, dates, messages (role + text)
  │  npm run analyze   pipeline/analyze.mjs: one Claude call per chat with 4+ messages (codes moments; lib/score.mjs computes positions), cached
  ▼
data/sessions/<id>.json     one record per chat: coded moments and turns, eight positions, text features, topics, summaries
  │  npm run build     pipeline/build-dashboard.mjs: aggregates + one Claude Sonnet 5.5 call per source
  ▼
site/data.js                window.MIRO_DASHBOARD_DATA = { meta, areas, aspects, profile, variants, timeline }
  ▼
site/index.html             dashboard.js (overview), trends.js (over time), sources.js (source switch)
```

**Parse.** Keeps what the user typed and what Claude said. Tool calls become short notes (`[used tool: WebSearch]`, `[used tools: Read ×3, Edit]`); raw tool output, Claude's internal reasoning and system-generated lines are dropped. Attachments become `[attached name: first 400 chars]`. Claude Code slash commands and interruptions become `[ran /command]` and `[user interrupted AI]`; Claude Design direct edits become `[user edited the design directly]`.

**Analyze (prompt v2, the default).** The model codes evidence and does not pick scores. The whole conversation is kept: your messages up to 4,000 characters each, and AI messages shortened to their first 800 and last 300 characters. Chats over about 60,000 characters are coded in overlapping parts. For each chat the model returns:
- **Moments** for six kinds of work: ideas, direction, research, building, problems and final call. Each one names the message, who did it (you or AI), whether it was major or minor, and a short note.
- **Two codes for every one of your messages**: how you reacted to the AI message before it (accepted, questioned, corrected, tested, edited and so on), and what you asked for (do it, give options, explain, critique mine and so on).
- One or two topics, how the chat opened, how it unfolded, and short summaries.

`pipeline/lib/score.mjs` then computes each position as 100 × your weight / (your weight + AI weight), with major moments counting twice. The two dependency dimensions come from your message codes:
- **Checking the answers**: how often you questioned, corrected, tested or edited AI's output, rather than accepting it as is.
- **Working to understand**: how often you asked to understand or for critique of your own work, rather than for the answer.

Definitions, what counts and examples are in [`docs/codebook.md`](docs/codebook.md), which is generated from `pipeline/lib/codebook.mjs`, the same source the prompt is built from. Model-free text features, such as your share of the words, questions per message and pastes, are stored on each record as a sanity check. The original holistic prompt is kept as `--prompt v1` for comparison. How the analysis is validated is in [`eval/README.md`](eval/README.md).

**Caching.** A chat is re-analyzed only if its message text, the model or the prompt version changed (the fingerprint is stored in each record as `source_hash`). `--force` re-analyzes everything. The build warns if records from different prompt versions are mixed, because their scores aren't comparable. Profile copy is cached per source in `data/synthesis-<source>.json` and rewritten only when that source's set of analyzed chats changes.

| Dashboard element | Computed from |
|---|---|
| Bubbles (% of use, chats) | Each chat's main topic counts 1, its second topic 0.5; share of the total |
| Sliders (dot, band) | Mean position per dimension, using only chats where it came up at least twice (`MIN_MOMENTS` in `pipeline/lib/common.mjs`); band = middle half (25th–75th percentile). The footnote under each slider says how many chats it rests on, how many were left out, and how repeatable the coding was (from `npm run eval -- --real`, if you ran it). Expanding a slider shows its question |
| Verdict | ≥80 Clearly you, 58–79 Leaned to you, 43–57 Shared, 21–42 Leaned to AI, ≤20 Clearly AI |
| Slider trend line | Older half of chats vs newer half; needs 6+ chats over 60+ days and a 6-point shift |
| Profile, area copy, slider details | One synthesis call per source over the stats plus digests of the 60 most recent chats |
| Over time view | Computed in the browser from `timeline` (one row per chat): average per month or quarter, only from chats where that work happened, and only plotted when at least 5 chats contribute |

## Options

- `parse`: the first argument is the `export/` folder, one `conversations-NNN/` part (its sibling parts are included), or a single `conversations.json`. `--design <folder>` (default: `design_chats/` inside or next to the export), `--claude-code`, `--claude-code-dir <dir>`.
- `analyze`: `--prompt v2|v1` (default `v2`), `--model <claude model id>` (default `claude-haiku-4-5`; see eval/README.md for why `claude-sonnet-5-5` is more accurate), `--limit N` (newest first), `--since 2026-01-01`, `--min-messages 4`, `--concurrency 4`, `--force`, `--dry-run`.
- `eval`: benchmark a prompt and model on the known-answer scenarios, or check reliability on your own chats. See [`eval/README.md`](eval/README.md).
- `test`: unit tests for the scoring formula and statistics (`npm test`). `codebook`: regenerate `docs/codebook.md`.
- `build`: `--synth-model <id>` (default `claude-sonnet-5-5`), `--no-synthesis` (stats-only copy, no API call), `--force` (rewrite cached profile copy).
- `.env`: `CLAUDE_MODEL`, `CLAUDE_SYNTH_MODEL`, and `CLAUDE_BACKEND=api` + `ANTHROPIC_API_KEY` to use the API instead of your Claude login. On the default path an `ANTHROPIC_API_KEY` in `.env` is ignored, so it can't silently bill your API account.

## Cost

With prompt v2, about $0.012 per analyzed chat with Haiku 4.5 or about $0.03 with Sonnet 5.5 (v2 reads the whole conversation, and Sonnet's thinking is billed as output). A history of roughly 650 chats costs about $8 with Haiku or about $20 with Sonnet, plus a few cents per source for the profile copy. `analyze --dry-run` estimates the input tokens before you spend anything, `analyze` prints an estimate from actual usage when it finishes, and re-runs only pay for new or changed chats.

These dollar figures are API prices. On the default Agent SDK path the same work counts against your Claude plan's usage limits instead, and the printed figure is an API-price estimate for comparison. Each request starts a small Claude Code process, so it is a few seconds slower per chat. If you hit your plan's limits, lower `--concurrency` and re-run: finished chats are cached.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Not logged in` / `/login` errors | Run `claude` in a terminal and log in with `/login`, or use `CLAUDE_BACKEND=api` with a key |
| `CLAUDE_BACKEND=api needs ANTHROPIC_API_KEY` | Set the key in `.env` at the repo root, or remove `CLAUDE_BACKEND` |
| `No parsed conversations yet` | Run `npm run parse -- export` first |
| `No conversations.json found` | Check the `export/conversations-000/conversations.json` layout |
| `No analyzed sessions found` | Run `npm run analyze` before `npm run build` |
| Design chats not picked up | Check the `export/design_chats/` layout, or pass `--design <folder>` |
| Dashboard shows old data or no "Over time" menu item | Hard-refresh; the browser cached `data.js` or the scripts |
| "No month has 5 or more to plot a point" | Group by quarter, widen the filters, or use the table view |
| Some chats failed during analyze | Re-run the same command; only the missing ones are sent |

## Privacy

Conversation text (including Claude Code sessions, when included) is sent to Anthropic (through your Claude login, or the API with `CLAUDE_BACKEND=api`) during `analyze`, and short per-chat summaries during `build`. Everything else stays local. The Agent SDK calls run with no tools, settings, hooks or MCP servers, and are not saved as Claude Code sessions under `~/.claude/projects`. `data/`, `export/`, `site/data.js`, `.env`, `node_modules/` and export manifests are gitignored. Never commit them.
