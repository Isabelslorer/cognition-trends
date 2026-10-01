// The codebook: what each dashboard dimension measures and how a conversation is coded.
// The v2 prompt (lib/prompts/v2.mjs) and docs/codebook.md (npm run codebook) are both generated
// from this file, so the instructions the model gets and the documented definitions cannot drift.
//
// Approach (Yeomans, Boland, Collins, Abi-Esber & Brooks, 2023, "A Practical Guide to Conversation
// Research"): code observable behaviour at the turn level, keep speakers separate, then aggregate
// to a conversation score with a transparent formula. The model never picks a 0-100 number.

// Six dimensions are coded as "moments": events in the transcript credited to the user or to AI.
export const MOMENT_CODES = [
  {
    key: 'ideas',
    definition: 'An idea, option, angle, content choice or approach that ended up being USED in the result (adopted, built on or kept). A suggestion that was rejected or dropped is not an idea moment for anyone.',
    credit: 'Whoever first proposed it. If the user proposed it vaguely and AI made it concrete, it is the user\'s idea. When AI writes a draft or plan, the substantive choices inside it that survive (its angle, structure, what it includes) are AI ideas. When the user specifies what the piece should say or centre on, those are user ideas.',
    counts: ['the user\'s own concept that AI then develops', 'one of several AI options that the user picks', 'the angle or content choices in an AI draft the user keeps', 'the user saying what the central point or story should be', 'the user\'s alternative that replaces AI\'s suggestion'],
    not: ['ideas that were proposed and then rejected or dropped (for example an AI recommendation the user overrode)', 'restating or polishing an idea someone already had', 'the task itself when it is routine (for example "fix this bug")'],
    examples: [
      'USER: "What if the onboarding was a short quiz instead of a form?" AI builds the quiz. -> user, major',
      'AI offers three names; the user picks the second. -> ai, major (AI proposed the name; the pick is a final_call moment)',
      'AI recommends PostgreSQL; USER: "No, SQLite, it is a single-user app." -> user idea, major. PostgreSQL is not logged (rejected).',
      'USER: "write a cover letter". AI writes one built around impact and reliability, the user keeps it. -> ai, major'
    ]
  },
  {
    key: 'direction',
    definition: 'A moment that sets the goal, changes course, or chooses what to work on next.',
    credit: 'Whoever set it. Every time AI proposes the next step or the plan and the user simply goes along, that is a separate moment for AI. If the user redirects or sets the next step, credit the user.',
    counts: ['the opening request that sets the goal', '"let\'s focus on X instead"', 'AI saying "next we should do X" and the user following', 'the user rejecting a plan and asking for a different one', 'the user narrowing the scope ("only touch the settings page")'],
    not: ['routine continuation ("continue", "go on") of a plan already set', 'clarifying questions that do not change course'],
    examples: [
      'USER opens: "Help me plan a 3-day trip to Lisbon focused on food, no museums." -> user, major (specific goal and constraints)',
      'USER opens: "help me get fit" (vague, no specifics). -> user, minor',
      'AI: "First let\'s set your schedule, then nutrition." USER answers and follows. -> ai, major (AI set the plan the conversation followed)'
    ]
  },
  {
    key: 'research',
    definition: 'Facts, sources, data, domain knowledge or context brought into the conversation.',
    credit: 'Whoever introduced it. Material the user pastes or attaches, and context about their own situation (numbers, constraints, personal stories, background), count for the user. Information AI supplies or looks up (including web search) counts for AI.',
    counts: ['the user pasting an article, notes, data or requirements', 'the user explaining their situation, constraints or background (for example salary, savings, deadlines)', 'the user answering AI\'s questions with personal facts or stories', 'AI explaining facts, citing sources or searching the web', 'AI laying out considerations or domain knowledge'],
    not: ['opinions or ideas (those are ideas)', 'the AI repeating back what the user said'],
    examples: [
      'USER attaches last year\'s sales figures. -> user, major',
      'AI explains how Norwegian VAT applies to digital services. -> ai, major'
    ]
  },
  {
    key: 'building',
    definition: 'A contribution to the thing being made: a draft, text, code, design, plan, translation or other output.',
    credit: 'The author of that contribution. AI writing a draft counts for AI; the user writing or rewriting parts themselves (shown in the transcript) counts for the user.',
    counts: ['AI writing code or a draft', 'the user pasting their own draft that becomes the basis', 'the user rewriting a paragraph themselves', '[user edited the design directly]'],
    not: ['explanations, answers, tutoring or quiz questions and answers when no artifact is being made', 'feedback without writing (that is problems or direction)'],
    examples: [
      'AI writes the full cover letter. -> ai, major',
      'USER: "Here is my rewrite of the intro: ..." -> user, major'
    ]
  },
  {
    key: 'problems',
    definition: 'An error, flaw, weakness, risk or mismatch being pointed out.',
    credit: 'Whoever raised it first. The user reporting a failing test or a wrong fact counts for the user; AI pointing out a bug, risk or gap counts for AI.',
    counts: ['"this is wrong / too long / not what I meant"', 'the user pasting an error message', 'AI flagging a weakness in the user\'s plan or draft', 'AI catching its own mistake unprompted'],
    not: ['ordinary preferences with no flaw ("make it blue")', 'AI fixing, agreeing with or acknowledging something the user pointed out (only the user\'s moment counts)', 'a tutor correcting a deliberate quiz answer counts for AI only once per wrong answer'],
    examples: [
      'USER: "This still crashes when the list is empty." -> user, major',
      'AI: "One risk: your survey question is leading." -> ai, major'
    ]
  },
  {
    key: 'final_call',
    definition: 'A decision that got settled: choosing between options, approving a result, or committing to a plan.',
    credit: 'The user if they chose between alternatives, overrode AI or set the decision themselves. AI if AI made the choice itself (picked the tools, the approach, the order, the itinerary) and it stood, or the user accepted AI\'s single proposal with a plain "ok / sounds good / perfect". A plain acceptance is NOT the user making the call.',
    counts: ['the user picking option B', 'the user saying "no, we keep the original title"', 'AI choosing the tools or approach and the user going along', 'the user deciding what to do in their own life after weighing it'],
    not: ['small wording choices', 'decisions that were never settled in the conversation', 'answering quiz or test questions'],
    examples: [
      'AI lists three plans; USER: "Plan 2, but keep the Friday off." -> user, major',
      'AI: "I\'ll use Poetry, Typer and pytest." USER: "sounds good, go ahead". -> ai, major',
      'AI delivers a full itinerary it chose; USER: "perfect". -> ai, major'
    ]
  }
];

// Two dimensions are coded on every user turn, as the user's dialogue act and their reaction to the
// previous AI turn (an adjacency pair).
export const REQUEST_CODES = [
  { key: 'do_it', side: 'ai', definition: 'asks AI to produce, do, decide, rewrite, improve or answer (write this, fix this, improve my email, what is X, pick one)' },
  { key: 'options', side: 'ai', definition: 'asks AI for options, ideas or suggestions to choose from' },
  { key: 'explain', side: 'user', definition: 'asks to understand or to be tested: why, how does this work, teach me, walk me through, quiz me, test me, next quiz question' },
  { key: 'critique_mine', side: 'user', definition: 'asks for an assessment of the user\'s own work, reasoning or attempt (is this right? what is weak?), without asking AI to rewrite it' },
  { key: 'inform', side: null, definition: 'gives information, context, quiz answers or answers to AI\'s question, without a new request' },
  { key: 'none', side: null, definition: 'acknowledgement, thanks, or anything else' }
];

export const REACTION_CODES = [
  { key: 'accept', side: 'ai', definition: 'takes the previous AI output as it is without examining it: thanks, ok, perfect, moves on, or asks for the next thing' },
  { key: 'question', side: 'user', definition: 'questions or challenges the AI output: asks why, asks for sources, doubts a claim' },
  { key: 'correct', side: 'user', definition: 'points out an error in the AI output or rejects it' },
  { key: 'test', side: 'user', definition: 'reports having tried or verified the output, whatever the result (ran the code, tests pass, checked it against a source or spreadsheet, "works now")' },
  { key: 'edit', side: 'user', definition: 'changes the AI output themselves (shows their own edited version, or [user edited the design directly])' },
  { key: 'build_on', side: null, definition: 'uses the output and adds their own new material or next idea' },
  { key: 'redirect', side: null, definition: 'changes the request or direction without judging the output' },
  { key: 'none', side: null, definition: 'first turn, or the previous AI turn was only a short question or acknowledgement' }
];

export const TURN_DIMENSIONS = [
  {
    key: 'checking',
    field: 'reaction',
    codes: REACTION_CODES,
    definition: 'How the user responded to each substantial AI output. Questioned, corrected, tested or edited counts for the user (you checked); accepted as is counts for AI. build_on, redirect and none are not counted.'
  },
  {
    key: 'understanding',
    field: 'request',
    codes: REQUEST_CODES,
    definition: 'What the user asked for. Explain and critique_mine count for the user (working to understand); do_it and options count for AI (asking for the answer). inform and none are not counted.'
  }
];

export const WEIGHTS = { major: 2, minor: 1 };
