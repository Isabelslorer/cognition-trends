# Scenario benchmark (held-out set)

Generated 2026-10-01 11:57. 8 fictional scenarios in `eval/holdout/`.

Each scenario states the expected result per dimension: a band the position must fall in, or "did not happen". Key moments are specific codes the coder must find (within one message).

## v1 on claude-haiku-4-5

| | Band hit | Did/didn't happen correct | Mean miss (points outside band) |
|---|---|---|---|
| Coming up with ideas | 0/2 | 1/2 | 17.5 |
| Deciding the direction | 2/2 | 2/2 | 0.0 |
| Bringing the information | – | – | – |
| Building the thing | 2/3 | 4/4 | 1.7 |
| Catching problems | 3/3 | 4/4 | 0.0 |
| Making the final call | 3/4 | 4/5 | 11.3 |
| **All** | **71%** | **88%** | 6.1 |

Gates: band hit FAIL (71% vs 85%), did/didn't happen FAIL (88% vs 90%).

<details><summary>Misses</summary>

- h1-vegan-recipe building: expected 25-80, got 85 (User executed the recipe in the kitchen; AI provided the instructions to follow.)
- h4-norwegian-grammar final_call: expected not involved, got 85 (User made the final call by accepting AI's explanations and moving to new questions; no decision was contested or revised.)
- h5-rejects-all-ideas ideas: expected 70-100, got 35 (AI offered five initial options; user rejected them and generated their own idea.)
- h6-design-exact-spec ideas: expected 60-100, got not involved
- h8-whatever-you-think final_call: expected 0-30, got 75 (User made the final decision to purchase, but only after AI's recommendation with no alternatives offered.)

</details>

## v1 on claude-sonnet-5-5

| | Band hit | Did/didn't happen correct | Mean miss (points outside band) |
|---|---|---|---|
| Coming up with ideas | 1/2 | 1/2 | 0.0 |
| Deciding the direction | 2/2 | 2/2 | 0.0 |
| Bringing the information | – | – | – |
| Building the thing | 3/3 | 4/4 | 0.0 |
| Catching problems | 3/3 | 4/4 | 0.0 |
| Making the final call | 2/4 | 5/5 | 17.5 |
| **All** | **79%** | **94%** | 5.0 |

Gates: band hit FAIL (79% vs 85%), did/didn't happen PASS (94% vs 90%).

<details><summary>Misses</summary>

- h6-design-exact-spec ideas: expected 60-100, got not involved
- h7-paper-compare final_call: expected 0-45, got 75 (The user decided to adopt Claude's conclusion, though they did not discuss or modify it.)
- h8-whatever-you-think final_call: expected 0-30, got 70 (The user agreed to buy Claude's single recommendation without weighing alternatives.)

</details>

## v2 on claude-haiku-4-5

| | Band hit | Did/didn't happen correct | Mean miss (points outside band) |
|---|---|---|---|
| Coming up with ideas | 2/2 | 2/2 | 0.0 |
| Deciding the direction | 1/2 | 2/2 | 30.0 |
| Bringing the information | – | – | – |
| Building the thing | 2/3 | 4/4 | 8.3 |
| Catching problems | 3/3 | 4/4 | 0.0 |
| Making the final call | 3/4 | 5/5 | 13.8 |
| Checking the answers | 4/5 | 5/5 | 12.0 |
| Working to understand | 4/5 | 5/5 | 5.0 |
| **All** | **79%** | **100%** | 9.4 |

Key moments found: 22/24 (92%).

Gates: band hit FAIL (79% vs 85%), did/didn't happen PASS (100% vs 90%).

<details><summary>Misses</summary>

- h1-vegan-recipe building: expected 25-80, got 0 (2 moments: 0 yours, 2 AI's.)
- h1-vegan-recipe missed key building/user at 1
- h5-rejects-all-ideas checking: expected 60-100, got 0 (1 turn counted: accept 1.)
- h5-rejects-all-ideas missed key reaction correct at 3
- h7-paper-compare understanding: expected 0-25, got 50 (2 turns counted: do_it 1, explain 1.)
- h7-paper-compare final_call: expected 0-45, got 100 (1 moment: 1 yours, 0 AI's.)
- h8-whatever-you-think direction: expected 0-40, got 100 (1 moment: 1 yours, 0 AI's.)

</details>

## v2 on claude-sonnet-5-5

| | Band hit | Did/didn't happen correct | Mean miss (points outside band) |
|---|---|---|---|
| Coming up with ideas | 2/2 | 2/2 | 0.0 |
| Deciding the direction | 1/2 | 2/2 | 5.0 |
| Bringing the information | – | – | – |
| Building the thing | 2/3 | 4/4 | 8.3 |
| Catching problems | 3/3 | 4/4 | 0.0 |
| Making the final call | 4/4 | 5/5 | 0.0 |
| Checking the answers | 5/5 | 5/5 | 0.0 |
| Working to understand | 4/5 | 5/5 | 1.6 |
| **All** | **88%** | **100%** | 1.8 |

Key moments found: 23/24 (96%).

Gates: band hit PASS (88% vs 85%), did/didn't happen PASS (100% vs 90%).

<details><summary>Misses</summary>

- h1-vegan-recipe building: expected 25-80, got 0 (2 moments: 0 yours, 2 AI's.)
- h1-vegan-recipe missed key building/user at 1
- h7-paper-compare understanding: expected 0-25, got 33 (3 turns counted: do_it 2, critique_mine 1.)
- h8-whatever-you-think direction: expected 0-40, got 50 (2 moments: 1 yours, 1 AI's.)

</details>
