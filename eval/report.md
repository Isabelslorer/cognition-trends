# Scenario benchmark (development set)

Generated 2026-10-01 11:57. 24 fictional scenarios in `eval/scenarios/`.

Each scenario states the expected result per dimension: a band the position must fall in, or "did not happen". Key moments are specific codes the coder must find (within one message).

## v1 on claude-haiku-4-5

| | Band hit | Did/didn't happen correct | Mean miss (points outside band) |
|---|---|---|---|
| Coming up with ideas | 8/9 | 9/10 | 0.0 |
| Deciding the direction | 6/7 | 7/7 | 3.6 |
| Bringing the information | 0/4 | 2/5 | 1.3 |
| Building the thing | 13/14 | 20/21 | 0.0 |
| Catching problems | 7/9 | 13/13 | 2.2 |
| Making the final call | 7/9 | 9/11 | 5.6 |
| **All** | **79%** | **90%** | 1.9 |

Gates: band hit FAIL (79% vs 85%), did/didn't happen FAIL (90% vs 90%).

<details><summary>Misses</summary>

- 01-delegation-one-shot direction: expected 50-100, got 25 (AI decided the approach and tone; user did not redirect.)
- 05-user-catches-bug problems: expected 80-100, got 65 (User caught both bugs through testing; AI diagnosed and fixed them.)
- 07-explain-learning final_call: expected not involved, got 75 (User answered the quiz questions and demonstrated mastery; AI confirmed correctness.)
- 10-user-brings-research research: expected 70-100, got not involved
- 11-ai-brings-research research: expected 0-20, got 25 (AI conducted web searches and gathered information; user posed the research questions.)
- 14-claude-code-interrupt problems: expected 70-100, got 65 (User discovered the reload bug; AI diagnosed and fixed the persistence issue.)
- 16-accept-everything building: expected 0-15, got not involved
- 16-accept-everything final_call: expected 0-35, got 85 (User made the final call by accepting the itinerary without modification.)
- 19-clarify-then-draft research: expected 65-100, got not involved
- 21-ai-decides-plan final_call: expected 0-30, got not involved
- 22-quiz-me-notes research: expected 40-100, got not involved
- 24-user-outline-ai-prose ideas: expected 70-100, got not involved

</details>

## v1 on claude-sonnet-5-5

| | Band hit | Did/didn't happen correct | Mean miss (points outside band) |
|---|---|---|---|
| Coming up with ideas | 8/9 | 9/10 | 0.0 |
| Deciding the direction | 6/7 | 7/7 | 3.6 |
| Bringing the information | 1/4 | 2/5 | 0.0 |
| Building the thing | 13/14 | 20/21 | 0.7 |
| Catching problems | 7/9 | 13/13 | 1.1 |
| Making the final call | 7/9 | 10/11 | 8.3 |
| **All** | **81%** | **91%** | 2.3 |

Gates: band hit FAIL (81% vs 85%), did/didn't happen PASS (91% vs 90%).

<details><summary>Misses</summary>

- 01-delegation-one-shot direction: expected 50-100, got 25 (The user set the goal of a cover letter for this role, while AI picked the tone and focus without any steering.)
- 05-user-catches-bug problems: expected 80-100, got 75 (The user found both failures through their own testing and described them, and AI explained the string-sorting cause.)
- 06-ai-catches-bug building: expected 20-80, got 10 (The AI wrote the full revised endpoint and the user supplied only the original code.)
- 07-explain-learning final_call: expected not involved, got 55 (The user judged their own understanding by answering the quiz, while AI graded the answers and confirmed them.)
- 10-user-brings-research research: expected 70-100, got not involved
- 12-brainstorm-mixed building: expected not involved, got 35 (AI drafted the timing outline for the chosen activities while the user defined the content.)
- 14-claude-code-interrupt problems: expected 70-100, got 65 (The user caught the reset-on-reload bug by running the app, and Claude diagnosed and fixed it; the user also caught the provider overreach.)
- 16-accept-everything final_call: expected 0-35, got 70 (The user accepted the plan as written, while AI's choices set what was approved.)
- 19-clarify-then-draft research: expected 65-100, got not involved
- 21-ai-decides-plan final_call: expected 0-30, got 70 (The user approved the AI's plan and accepted the output, but did not weigh alternatives.)
- 22-quiz-me-notes research: expected 40-100, got not involved
- 24-user-outline-ai-prose ideas: expected 70-100, got not involved

</details>

## v2 on claude-haiku-4-5

| | Band hit | Did/didn't happen correct | Mean miss (points outside band) |
|---|---|---|---|
| Coming up with ideas | 8/9 | 10/10 | 0.6 |
| Deciding the direction | 7/7 | 7/7 | 0.0 |
| Bringing the information | 4/4 | 5/5 | 0.0 |
| Building the thing | 14/14 | 20/21 | 0.0 |
| Catching problems | 8/9 | 13/13 | 1.1 |
| Making the final call | 9/9 | 11/11 | 0.0 |
| Checking the answers | 14/16 | 17/17 | 1.8 |
| Working to understand | 10/12 | 13/13 | 3.9 |
| **All** | **93%** | **99%** | 1.1 |

Key moments found: 78/84 (93%).

Gates: band hit PASS (93% vs 85%), did/didn't happen PASS (99% vs 90%).

<details><summary>Misses</summary>

- 04-user-overrides-ai ideas: expected 55-100, got 50 (2 moments: 1 yours, 1 AI's.)
- 04-user-overrides-ai missed key final_call/user at 3
- 07-explain-learning understanding: expected 80-100, got 75 (4 turns counted: explain 2, critique_mine 1, do_it 1.)
- 07-explain-learning building: expected not involved, got 0 (1 moment: 0 yours, 1 AI's.)
- 07-explain-learning missed key request explain at 7
- 08-advice-user-decides missed key research/ai at 2
- 10-user-brings-research checking: expected 75-100, got 50 (2 turns counted: correct 1, accept 1.)
- 14-claude-code-interrupt checking: expected 70-100, got 67 (3 turns counted: correct 1, test 1, accept 1.)
- 15-long-chat-key-middle missed key direction/user at 15
- 15-long-chat-key-middle missed key research/user at 17
- 20-pushback-sources problems: expected 60-100, got 50 (2 moments: 1 yours, 1 AI's.)
- 20-pushback-sources missed key reaction question at 5
- 22-quiz-me-notes understanding: expected 75-100, got 33 (3 turns counted: do_it 2, explain 1.)

</details>

## v2 on claude-sonnet-5-5

| | Band hit | Did/didn't happen correct | Mean miss (points outside band) |
|---|---|---|---|
| Coming up with ideas | 9/9 | 10/10 | 0.0 |
| Deciding the direction | 7/7 | 7/7 | 0.0 |
| Bringing the information | 4/4 | 5/5 | 0.0 |
| Building the thing | 13/14 | 18/21 | 1.4 |
| Catching problems | 9/9 | 13/13 | 0.0 |
| Making the final call | 9/9 | 11/11 | 0.0 |
| Checking the answers | 16/16 | 17/17 | 0.0 |
| Working to understand | 12/12 | 13/13 | 0.0 |
| **All** | **99%** | **97%** | 0.3 |

Key moments found: 83/84 (99%).

Gates: band hit PASS (99% vs 85%), did/didn't happen PASS (97% vs 90%).

<details><summary>Misses</summary>

- 06-ai-catches-bug building: expected 20-80, got 0 (1 moment: 0 yours, 1 AI's.)
- 06-ai-catches-bug missed key building/user at 1
- 07-explain-learning building: expected not involved, got 0 (1 moment: 0 yours, 1 AI's.)
- 12-brainstorm-mixed building: expected not involved, got 0 (1 moment: 0 yours, 1 AI's.)
- 22-quiz-me-notes building: expected not involved, got 0 (2 moments: 0 yours, 2 AI's.)

</details>
