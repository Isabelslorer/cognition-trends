// Prompt v2: evidence ledger. The model codes observable moments and every user turn; positions are
// computed from those codes in lib/score.mjs. The model never picks a 0-100 number.
// Definitions come from lib/codebook.mjs. The whole conversation is kept: AI turns are shortened
// (the user's behaviour is what is coded), and very long chats are coded in overlapping parts.

import { AREA_KEYS, ARCS, OPENING_MODES, cleanText, simpleHash } from '../common.mjs';
import { MOMENT_CODES, REACTION_CODES, REQUEST_CODES, TURN_DIMENSIONS } from '../codebook.mjs';
import { scoreConversation } from '../score.mjs';
import { normalizeAreas } from './v1.mjs';

const USER_CHARS = 4000;
const AI_HEAD_CHARS = 800;
const AI_TAIL_CHARS = 300;
const PART_CHARS = 60000;
const PART_OVERLAP = 2;

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    user_turns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          turn: { type: 'integer' },
          reaction: { type: 'string', enum: REACTION_CODES.map((code) => code.key) },
          request: { type: 'string', enum: REQUEST_CODES.map((code) => code.key) }
        },
        required: ['turn', 'reaction', 'request']
      }
    },
    moments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        // note comes first so the model states the evidence before crediting it.
        properties: {
          turn: { type: 'integer' },
          note: { type: 'string' },
          dimension: { type: 'string', enum: MOMENT_CODES.map((code) => code.key) },
          actor: { type: 'string', enum: ['user', 'ai'] },
          weight: { type: 'string', enum: ['major', 'minor'] }
        },
        required: ['turn', 'note', 'dimension', 'actor', 'weight']
      }
    },
    areas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string', enum: AREA_KEYS },
          salience: { type: 'string', enum: ['primary', 'secondary'] },
          weight: { anyOf: [{ type: 'number' }, { type: 'null' }] }
        },
        required: ['key', 'salience', 'weight']
      }
    },
    interaction_pattern: {
      type: 'object',
      additionalProperties: false,
      properties: {
        opening_mode: { type: 'string', enum: OPENING_MODES },
        arc: { type: 'string', enum: ARCS },
        confidence: { type: 'string', enum: ['low', 'medium', 'high'] }
      },
      required: ['opening_mode', 'arc', 'confidence']
    },
    session_read_title: { type: 'string' },
    session_read_narrative: { type: 'string' },
    user_role_summary: { type: 'string' },
    ai_role_summary: { type: 'string' },
    evidence_note: { type: 'string' }
  },
  required: [
    'user_turns', 'moments', 'areas', 'interaction_pattern', 'session_read_title',
    'session_read_narrative', 'user_role_summary', 'ai_role_summary', 'evidence_note'
  ]
};

export const id = 'v2';
export { schema };
export const maxTokens = 12000;
export const temperature = 0;
export const version = simpleHash(`v2|${systemPrompt()}|${JSON.stringify(schema)}`);

export function requests(conversation, sourceContext) {
  const numbered = conversation.messages.map((message, index) => ({
    turn: index + 1,
    role: message.role === 'user' ? 'USER' : 'AI',
    text: message.role === 'user' ? clip(message.content, USER_CHARS, 800) : clip(message.content, AI_HEAD_CHARS + AI_TAIL_CHARS, AI_TAIL_CHARS)
  }));
  const parts = splitParts(numbered);

  return parts.map(({ from, to, start }, index) => {
    const lines = [
      `Conversation title: ${conversation.title}`,
      ...(sourceContext ? [sourceContext] : []),
      `Started: ${String(conversation.created_at || 'unknown').slice(0, 10)}. Total messages: ${numbered.length}.`
    ];
    if (parts.length > 1) {
      lines.push(`This long conversation is coded in ${parts.length} parts. This is part ${index + 1}, messages ${start}-${to}.` +
        (from < start ? ` Messages ${from}-${start - 1} are repeated only for context: do not code them.` : ''));
    }
    lines.push('Transcript:');
    for (const message of numbered.slice(from - 1, to)) lines.push(`[${message.turn}] ${message.role}: ${message.text}`);
    return { system: systemPrompt(), user: lines.join('\n'), range: [start, to] };
  });
}

// Merges the coded parts and computes the dashboard positions from the codes.
export function normalize(results, conversation, ranges = [[1, conversation.messages.length]]) {
  const isUser = (turn) => conversation.messages[turn - 1]?.role === 'user';
  const inRange = (turn, [start, end]) => Number.isInteger(turn) && turn >= start && turn <= end;

  const userTurns = new Map();
  const moments = [];
  const seen = new Set();
  results.forEach((data, index) => {
    for (const item of data?.user_turns || []) {
      if (!inRange(item?.turn, ranges[index]) || !isUser(item.turn) || userTurns.has(item.turn)) continue;
      userTurns.set(item.turn, { turn: item.turn, reaction: item.reaction, request: item.request });
    }
    for (const item of data?.moments || []) {
      if (!inRange(item?.turn, ranges[index])) continue;
      const key = `${item.turn}|${item.dimension}|${item.actor}`;
      if (seen.has(key)) continue;
      seen.add(key);
      moments.push({ turn: item.turn, dimension: item.dimension, actor: item.actor, weight: item.weight, note: cleanText(item.note) });
    }
  });
  moments.sort((a, b) => a.turn - b.turn);
  const coded = [...userTurns.values()].sort((a, b) => a.turn - b.turn);

  const weightRows = scoreConversation({ moments, userTurns: coded }, conversation.messages.length);
  const first = results[0] || {};
  const last = results[results.length - 1] || {};
  const has = (dimension, actor) => moments.some((moment) => moment.dimension === dimension && moment.actor === actor);
  const pattern = { ...first.interaction_pattern, arc: last.interaction_pattern?.arc || first.interaction_pattern?.arc };

  return {
    session_read_title: cleanText(first.session_read_title, 'This chat').slice(0, 40),
    session_read_narrative: cleanText(first.session_read_narrative),
    user_role_summary: cleanText(first.user_role_summary),
    ai_role_summary: cleanText(first.ai_role_summary),
    areas: normalizeAreas(first.areas),
    weight_rows: weightRows,
    work_split: Object.fromEntries(weightRows.filter((row) => row.involved).map((row) => [row.key, row.position])),
    moments,
    user_turns: coded,
    // v1's markers, now derived from the codes instead of asked for separately.
    collaboration_markers: {
      user_provided_material: has('research', 'user') || has('building', 'user'),
      user_redirected_after_output: coded.some((turn) => turn.reaction === 'redirect'),
      user_critiqued_or_corrected: coded.some((turn) => ['question', 'correct'].includes(turn.reaction)) || has('problems', 'user'),
      user_made_final_selection: has('final_call', 'user'),
      ai_produced_first_pass: moments.find((moment) => moment.dimension === 'building')?.actor === 'ai'
    },
    interaction_pattern: {
      opening_mode: OPENING_MODES.includes(pattern.opening_mode) ? pattern.opening_mode : null,
      arc: ARCS.includes(pattern.arc) ? pattern.arc : null,
      confidence: ['low', 'medium', 'high'].includes(pattern.confidence) ? pattern.confidence : 'low'
    },
    evidence_note: cleanText(first.evidence_note),
    trace: {
      first_key_turn: moments.find((moment) => moment.weight === 'major')?.turn ?? null,
      key_turn_indices: [...new Set(moments.filter((moment) => moment.weight === 'major').map((moment) => moment.turn))].slice(0, 4)
    }
  };
}

function systemPrompt() {
  const list = (items) => items.map((item) => `"${item}"`).join('; ');
  return [
    'You code one past conversation between a user and Claude (an AI assistant) for a study of how people collaborate with AI over time.',
    'You do not score anything. You record observable evidence: who did what, at which message. Scores are computed from your codes.',
    'Return only JSON that matches the schema.',
    '',
    'Transcript conventions:',
    '- Messages are numbered [n]. Cite these numbers in turn fields.',
    '- AI messages may be shortened in the middle; user messages are kept in full where possible.',
    '- [used tool: ...] / [used tools: ...] means AI ran tools or made an artifact. [attached ...] means the user attached or pasted material.',
    '- The conversation may be in any language. Write notes and summaries in English.',
    '',
    'PART 1. user_turns: code EVERY USER message, once each, with two codes.',
    'reaction = how the user responded to the AI message just before it:',
    ...REACTION_CODES.map((code) => `  - ${code.key}: ${code.definition}`),
    'request = what the user asks for in this message (choose the main one):',
    ...REQUEST_CODES.map((code) => `  - ${code.key}: ${code.definition}`),
    '',
    'PART 2. moments: list the moments for these six kinds of work. Each moment is one event at one message, credited to the user or to AI.',
    'Only record what is visible in the transcript. One message can hold several moments (for example the user pastes data AND sets the goal).',
    'weight: major when the moment shaped the outcome; minor for small contributions. When in doubt, minor.',
    'A kind of work with no moments simply did not happen: leave it out rather than inventing one.',
    ...MOMENT_CODES.flatMap((code) => [
      '',
      `${code.key}: ${code.definition}`,
      `  Credit: ${code.credit}`,
      `  Counts: ${list(code.counts)}.`,
      `  Does not count: ${list(code.not)}.`,
      ...code.examples.map((example) => `  Example: ${example}`)
    ]),
    '',
    'Rules for moments:',
    '- note: one short neutral sentence naming the concrete thing (no quotes longer than five words).',
    '- Credit the person who did it first, not the one who repeated, polished or executed it.',
    '- Do not credit AI for simply doing what it was told; the instruction is the user\'s moment only if it adds an idea, direction, information or decision.',
    '- Do not invent balance. If one side did all of it, list only that side.',
    '',
    'PART 3. Summary fields.',
    `- areas use this taxonomy only: ${AREA_KEYS.join(', ')}. Exactly one primary area and optionally one secondary. weight is 0 to 1 for how much of the conversation the area covers, or null.`,
    '- interaction_pattern.opening_mode: delegation (handed the task over with little context), contextualized (gave goals, constraints, or background up front), critique (asked AI to react to their own work), pastein (pasted material and asked AI to process it), exploration (open-ended questions or thinking out loud).',
    '- interaction_pattern.arc: draft_redirect_rebuild, ask_synthesize_decide, debug_test_fix, brainstorm_refine, explain_practice_check. Pick the closest.',
    '- session_read_title: 2 to 5 words, under 30 characters, no colon. session_read_narrative: one short sentence about what happened.',
    '- user_role_summary and ai_role_summary: one short sentence fragment each.',
    '- evidence_note: one or two strictly behavioural sentences about what the user did and what AI did.',
    `- ${TURN_DIMENSIONS.map((dimension) => `${dimension.key}: ${dimension.definition}`).join(' ')}`
  ].join('\n');
}

// Splits a long transcript into parts of about PART_CHARS, each repeating the last
// PART_OVERLAP messages of the previous part as context. start = first message to code.
function splitParts(numbered) {
  const total = numbered.reduce((sum, message) => sum + message.text.length, 0);
  if (total <= PART_CHARS) return [{ from: 1, start: 1, to: numbered.length }];
  const parts = [];
  let start = 1;
  while (start <= numbered.length) {
    let size = 0;
    let to = start;
    while (to <= numbered.length && (to === start || size + numbered[to - 1].text.length <= PART_CHARS)) {
      size += numbered[to - 1].text.length;
      to += 1;
    }
    parts.push({ from: Math.max(1, start - PART_OVERLAP), start, to: to - 1 });
    start = to;
  }
  return parts;
}

function clip(text, max, tail) {
  const value = String(text || '');
  if (value.length <= max) return value;
  // A cut can split an emoji's surrogate pair, which the API rejects as invalid JSON; drop the half.
  return `${value.slice(0, max - tail)} [... ${value.length - max} characters shortened ...] ${value.slice(-tail)}`
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}
