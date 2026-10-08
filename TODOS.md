# Follow-ups

Recorded from the review of PR #3 (`Isabelslorer/site-redesign`, commit `26af8ef`). Agreed to defer these fixes until after merging the dashboard rebuild. They are not merge blockers for the current local, exploratory dashboard; address the scoring issue before relying on the results for research or presenting them as validated measurements.

## 1. Preserve distinct scoring moments in the same message

- [ ] Fix and test moment deduplication.

**Priority:** First follow-up; affects scores and whether a dimension is counted.

**Location:** `pipeline/lib/prompts/v2.mjs`, `normalize()`.

The deduplication key uses only the turn, dimension, and actor. Different events sharing those fields are discarded. In a synthetic reproduction, a minor user idea and a different major user idea in message 1, plus a minor AI idea in message 2, should score 75 but normalize to 50. Two distinct user ideas in one message become one moment, falling below the dashboard's two-moment threshold.

**Done when:** Distinct evidence survives normalization, repeated context across transcript parts is still excluded, and regression tests cover both the score and the inclusion threshold. Decide how genuine duplicate events should be identified without collapsing distinct ones. Account for existing cached analyses: changing normalization alone does not invalidate their content hashes. Any paid reanalysis requires the dry run and approval described in `CLAUDE.md`.

## 2. Match reliability claims to the analysis configuration

- [ ] Record and validate the configuration behind reliability measurements.

**Priority:** Second follow-up; affects confidence claims, not the scores themselves.

**Locations:** `eval/run-eval.mjs`, `reportReal()`; `pipeline/build-dashboard.mjs`, `loadReliability()`; session metadata in `pipeline/lib/analyzer.mjs`.

Reliability is selected by model and prompt name (`v2`) only. The summary lacks the backend and exact prompt fingerprint. API measurements at temperature 0 can therefore appear as reliability for Agent SDK sessions, and measurements from an older v2 prompt can remain eligible after the prompt changes.

**Done when:** Eval summaries and session records carry sufficient configuration metadata to match model, backend, and exact prompt fingerprint. Tests prove mismatched or legacy measurements are suppressed or clearly qualified, matching measurements remain available, and source variants or mixed datasets do not inherit unsupported claims.

## 3. Exclude unobserved work from fallback profiles

- [ ] Fix and test profile and area copy when synthesis is unavailable.

**Priority:** Third follow-up; affects stats-only builds and builds whose synthesis call fails.

**Location:** `pipeline/build-dashboard.mjs`, `fallbackProfile()`, `fallbackAreaPattern()`, and `meanSplit()`.

Dimensions with no counted chats receive a default mean of 50 and enter the ranking. With only ideas counted at 67, the fallback claims AI carried the most of "working to understand," despite having no evidence for that dimension. Area copy has the same problem.

**Done when:** Missing dimensions remain distinguishable from an observed 50/50 split and are excluded from conclusions. Tests cover sparse data, a real 50/50 split, and no counted dimensions, for both profile and area copy. Empty evidence produces an explicit insufficient-data message.
