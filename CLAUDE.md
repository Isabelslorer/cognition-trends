# Miro Claude dashboard

Pipeline that fills the Miro dashboard from a person's Claude history. Setup, data layout and how scoring works are in README.md; read it first.

Rules for agents working here:

- The data is someone's private conversation history. Never commit, print in full or send anywhere other than Anthropic (via the Agent SDK or the API): `export/`, `data/`, `site/data.js`, `.env`, or any `manifest-*.json` from the export (its download links are single-use and point at account data). Before any commit, confirm none of these are staged.
- `npm run analyze` and `npm run build` spend the user's Claude plan usage (default Agent SDK backend) or API credit (`CLAUDE_BACKEND=api`). Run `npm run analyze -- --dry-run` first, report the chat count and cost estimate, and get the user's go-ahead. Pilot with `--limit 10` before a full run.
- Changing the codebook (`pipeline/lib/codebook.mjs`), a prompt in `pipeline/lib/prompts/`, or the model invalidates every cached analysis for that prompt, and the next run re-analyzes all chats. Per-source context belongs in `SOURCE_CONTEXT` in `pipeline/lib/analyzer.mjs` (the per-chat message), which does not invalidate the cache. Never edit `prompts/v1.mjs`: it is the frozen baseline.
- After changing the codebook, run `npm run codebook` and `npm test`, then `npm run eval -- --prompt v2` on the scenarios before any real analysis. Don't tune the prompt against `eval/holdout/`. Change a scenario's expected band only when it contradicts the codebook, and log the change in `eval/README.md`.
- `npm run eval -- --real` codes the user's own chats (paid; same go-ahead rule). Its detailed output stays in `data/eval/`; report only aggregates.
- After a rebuild, hard-refresh the browser; it caches `site/data.js`.
- `site/demo-data.js` is the made-up example on the public site, built by `npm run demo` from `demo/` with no Claude calls. It is committed. Never build it from real data.
