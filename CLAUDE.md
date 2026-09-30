# Miro Claude dashboard

Pipeline that fills the Miro dashboard from a person's Claude history. Setup, data layout and how scoring works are in README.md; read it first.

Rules for agents working here:

- The data is someone's private conversation history. Never commit, print in full or send anywhere other than the Anthropic API: `export/`, `data/`, `site/data.js`, `.env`, or any `manifest-*.json` from the export (its download links are single-use and point at account data). Before any commit, confirm none of these are staged.
- `npm run analyze` and `npm run build` spend the user's API credit. Run `npm run analyze -- --dry-run` first, report the chat count and cost estimate, and get the user's go-ahead. Pilot with `--limit 10` before a full run.
- Changing `systemPrompt()` or the schema in `pipeline/analyze.mjs`, or the model, invalidates every cached analysis and the next run re-analyzes all chats. Per-source context belongs in `SOURCE_CONTEXT` (the per-chat message), which does not invalidate the cache.
- After a rebuild, hard-refresh the browser; it caches `site/data.js`.
