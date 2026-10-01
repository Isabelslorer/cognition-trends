# Evaluating the analysis

How we check that the per-chat coding measures what the dashboard claims, before trusting the trends built on it. The method follows Yeomans, Boland, Collins, Abi-Esber & Brooks (2023), *A Practical Guide to Conversation Research: How to Study What People Say to Each Other* (Advances in Methods and Practices in Psychological Science, 6(4)):

- **Explicit constructs.** Every dimension is defined in [`docs/codebook.md`](../docs/codebook.md), with what counts, what does not, and examples. The prompt is generated from the same source (`pipeline/lib/codebook.mjs`).
- **Turn-level coding, then aggregation.** The model records moments (who did what, at which message) and codes every user turn. The 0–100 positions are computed from those codes by a fixed formula (`pipeline/lib/score.mjs`). The model never picks a number.
- **Validation against known labels.** Fictional scenarios with known answers, below. A human-labelled gold set can be added later in the same format.
- **Reliability.** The same chats are coded again, by the same model and by a different one.
- **Baselines.** The original holistic prompt (v1) runs on the same scenarios, and model-free text features (`pipeline/lib/features.mjs`) serve as a sanity check.
- **Pre-registered gates.** These are written down before running v2 and are not changed after seeing results.

## 1. Scenarios with known answers

`eval/scenarios/*.json` holds 24 fictional conversations. They contain no private data and are safe to commit. Each one has:

- `spec`: who does what, in words.
- `messages`: the transcript, in the same shape as `data/conversations.json`.
- `expected`: for each dimension, either `[lo, hi]` (it happened, and the position must fall in this band), `false` (it did not happen), or nothing (not evaluated, because the answer is genuinely ambiguous).
- `key_moments`: codes the coder must find, allowing one message either side. Examples: `{ "turn": 3, "dimension": "problems", "actor": "user" }` or `{ "turn": 5, "reaction": "test" }`.

The scenarios cover:
- each dimension at both ends
- one-shot delegation
- critique of the user's own draft
- picking from AI's options
- a user overriding AI
- a user catching a bug, and AI catching one
- advice where nothing is built
- AI steering
- user-supplied versus AI-supplied research
- a mixed brainstorm
- a Norwegian-language chat
- a Claude Code session with an interruption
- a 36-message chat where the key moment sits in the middle (v1 drops it)
- accepting everything
- a user writing code while AI reviews it
- direct edits in Claude Design
- clarifying questions
- pushback on sources
- AI deciding the plan
- quizzing from notes
- a greeting with no task
- a user's outline turned into AI's prose

```bash
npm run eval -- --prompt v1,v2          # both prompts, Haiku, writes eval/report.md
npm run eval -- --prompt v2 --runs 2    # adds run-to-run agreement
npm run eval -- --only 15               # a single scenario
```

**Limitation:** Claude wrote both the scenarios and the codings, so the scenarios may be easier for Claude than real chats are. They test whether the codebook is applied as intended, not whether it matches a human reader. That is what the later human gold set is for.

## 2. Reliability on your real chats

```bash
npm run eval -- --real 30 --prompt v2 --models claude-haiku-4-5,claude-sonnet-5-5 --runs 2
```

This codes a fixed sample of 30 of your chats, stratified by source and length. It reports Krippendorff's alpha (interval) per dimension for run-to-run and model-to-model agreement, and how often the codings agree on whether each kind of work happened. It also gives Spearman's correlation between "building" and your share of the words, as a model-free sanity check. The console prints aggregates only. The report goes to `data/eval/real-report.md`, which is gitignored because it is computed from your private chats.

## Pre-registered gates for adopting a prompt

| Check | Gate | Why |
|---|---|---|
| Scenario band hit rate | ≥ 85% | Positions land where the codebook says they should |
| Scenario did/didn't happen accuracy | ≥ 90% | Kinds of work are not invented or missed |
| Run-to-run alpha, same model | ≥ 0.80 | Krippendorff's conventional threshold for reliable data |
| Haiku vs Sonnet alpha | ≥ 0.667 | Krippendorff's lowest threshold for tentative conclusions. If it is missed, analyze with the stronger model or take the majority of three runs |

All codings are cached in `data/eval/cache/`, so re-running a report is free. Coding the 24 scenarios costs about $0.05 per prompt with Haiku.

## Adding a human gold set later

Label real chats in the same format as the scenarios and save them in `data/gold/` (private), ideally labelled by two people independently. Compare the two people's labels first: their agreement is the ceiling the model can reasonably reach. Then point the harness at the folder.

## Scenario revision log

Expected bands may only change when they contradict the codebook as written, never just to make a result pass. Every change is logged here.

| Date | Scenario | Change | Reason |
|---|---|---|---|
| 2026-10-01 | 20-pushback-sources | checking 75–100 → 60–100 | The user questions twice and then accepts the final answer ("OK that's a much better answer"). By the codebook that final turn is `accept`, so 2 of 3 = 67 is the correct score. |
| 2026-10-01 | 24-user-outline-ai-prose | checking 60–100 → 40–100 | One `correct`, then the final version is accepted. By the codebook that is 1 of 2 = 50. |

## Results so far (2026-10-01)

Scenario benchmark. Cells show band hit / did-or-didn't-happen correct / key moments found.

| Prompt and model | Development set (24, prompt tuned on it) | Held-out set (8, written after tuning, run once) |
|---|---|---|
| v1 Haiku 4.5 (the original) | 79% / 90% / – | 71% / 88% / – |
| v1 Sonnet 5.5 | 81% / 91% / – | 79% / 94% / – |
| v2 Haiku 4.5 | 93% / 99% / 93% | 79% / 100% / 92% (fails the band gate) |
| **v2 Sonnet 5.5** | **99% / 97% / 99%** | **88% / 100% / 96% (passes)** |

Haiku's held-out misses all break rules the codebook states explicitly. It credits a plain "ok, I'll use that" as the user's decision, misses AI steering through a series of questions, and codes "these are generic, what about X?" as a redirect rather than a correction. Sonnet follows those rules.

Reliability on 30 real chats, prompt v2. These are aggregates only and contain nothing from the chats themselves.

| | Pooled alpha | Weakest dimension |
|---|---|---|
| Haiku run-to-run | 0.94 | problems 0.74 |
| Sonnet run-to-run | 0.94 | problems 0.82 |
| Haiku vs Sonnet | 0.72 | building 0.07 (ideas 0.31, direction 0.47, research 0.49) |

Reading this:
- **Each model is stable against itself.** Sonnet clears 0.80 on every dimension.
- **The models disagree mostly where Haiku breaks the codebook**, going by the held-out misses above.
- **Building has almost no variance in these chats.** AI wrote nearly everything (0 in 16 of 18 chats), which makes its alpha and its correlation with word share (ρ ≈ 0) uninformative rather than wrong.
- **"Did it happen" is the least stable judgement.** Across the four codings it agreed in only 43–73% of chats for checking, research, problems, ideas, direction, building and final call (understanding: 93%), because a single borderline moment decides it.

**Open issue:** consider requiring at least two moments, or weighting chats by the number of moments, before a dimension counts as involved.
