// Prompt v1: the original holistic scoring, adapted from the Miro extension's background.js.
// The model reads a trimmed transcript (first 6 + last 24 messages) and picks a 0-100 position per
// dimension itself. Kept unchanged as the baseline for npm run eval; its text and schema must not
// change, or the version hash (and every v1 cache entry) changes with it.

import { AREA_KEYS, ARCS, MARKER_KEYS, OPENING_MODES, clamp, cleanText, simpleHash } from '../common.mjs';

const HEAD_MESSAGES = 6;
const MAX_PROMPT_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 1500;

// The six dimensions as v1 defined them (labels are part of the prompt text).
export const V1_DIMENSIONS = [
  { key: 'ideas', label: 'Coming up with ideas' },
  { key: 'direction', label: 'Deciding the direction' },
  { key: 'research', label: 'Doing the research' },
  { key: 'building', label: 'Building the thing' },
  { key: 'problems', label: 'Catching problems' },
  { key: 'final_call', label: 'Making the final call' }
];

// Anthropic structured outputs: no array length limits, so counts are enforced in normalize().
const reflectionSchema = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      session_read_title: { type: 'string' },
      session_read_narrative: { type: 'string' },
      user_role_summary: { type: 'string' },
      ai_role_summary: { type: 'string' },
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
      weight_rows: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          // Property order matters: the model writes involved and reason before committing to a number.
          properties: {
            key: { type: 'string', enum: V1_DIMENSIONS.map((dimension) => dimension.key) },
            involved: { type: 'boolean' },
            reason: { type: 'string' },
            position: { type: 'number' },
            range_start: { type: 'number' },
            range_end: { type: 'number' }
          },
          required: ['key', 'involved', 'reason', 'position', 'range_start', 'range_end']
        }
      },
      collaboration_markers: {
        type: 'object',
        additionalProperties: false,
        properties: Object.fromEntries(MARKER_KEYS.map((key) => [key, { type: 'boolean' }])),
        required: MARKER_KEYS
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
      evidence_note: { type: 'string' },
      trace: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              first_key_turn: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
              key_turn_indices: { type: 'array', items: { type: 'integer' } }
            },
            required: ['first_key_turn', 'key_turn_indices']
          },
          { type: 'null' }
        ]
      }
    },
    required: [
      'session_read_title', 'session_read_narrative', 'user_role_summary', 'ai_role_summary', 'areas',
      'weight_rows', 'collaboration_markers', 'interaction_pattern', 'evidence_note', 'trace'
    ]
  }
};

export const id = 'v1';
export const schema = reflectionSchema.schema;
export const maxTokens = 4000;
export const temperature = 0.25;
// Same formula as before the move, so existing v1 cache entries stay valid.
export const version = simpleHash(systemPrompt() + JSON.stringify(reflectionSchema));

export function requests(conversation, sourceContext) {
  const lines = [
    `Conversation title: ${conversation.title}`,
    ...(sourceContext ? [sourceContext] : []),
    `Started: ${String(conversation.created_at || 'unknown').slice(0, 10)}. Total messages: ${conversation.message_count}.`,
    'Transcript:'
  ];
  for (const item of selectTranscript(conversation.messages)) {
    lines.push(item.omitted
      ? `[... messages ${item.from}-${item.to} omitted ...]`
      : `${item.index}. ${item.role === 'assistant' ? 'AI' : 'USER'}: ${truncate(item.content)}`);
  }
  return [{ system: systemPrompt(), user: lines.join('\n') }];
}

export function normalize([data]) {
  const weightRows = V1_DIMENSIONS.map(({ key }) => {
    const row = (Array.isArray(data?.weight_rows) ? data.weight_rows : []).find((candidate) => candidate?.key === key) || {};
    const position = Math.round(clamp(row.position, 0, 100, 50));
    const start = clamp(row.range_start, 0, 100, position - 12);
    const end = clamp(row.range_end, 0, 100, position + 12);
    return {
      key,
      involved: row.involved !== false,
      position,
      range_start: Math.round(Math.max(0, Math.min(start, end, position))),
      range_end: Math.round(Math.min(100, Math.max(start, end, position))),
      reason: cleanText(row.reason)
    };
  });

  const markers = Object.fromEntries(MARKER_KEYS.map((key) => [key, Boolean(data?.collaboration_markers?.[key])]));
  const pattern = data?.interaction_pattern || {};
  const trace = data?.trace && typeof data.trace === 'object'
    ? {
        first_key_turn: Number.isInteger(data.trace.first_key_turn) ? data.trace.first_key_turn : null,
        key_turn_indices: (data.trace.key_turn_indices || []).filter(Number.isInteger).slice(0, 4)
      }
    : null;

  return {
    session_read_title: cleanText(data?.session_read_title, 'This chat').slice(0, 40),
    session_read_narrative: cleanText(data?.session_read_narrative),
    user_role_summary: cleanText(data?.user_role_summary),
    ai_role_summary: cleanText(data?.ai_role_summary),
    areas: normalizeAreas(data?.areas),
    weight_rows: weightRows,
    work_split: Object.fromEntries(weightRows.map((row) => [row.key, row.position])),
    collaboration_markers: markers,
    interaction_pattern: {
      opening_mode: OPENING_MODES.includes(pattern.opening_mode) ? pattern.opening_mode : null,
      arc: ARCS.includes(pattern.arc) ? pattern.arc : null,
      confidence: ['low', 'medium', 'high'].includes(pattern.confidence) ? pattern.confidence : 'low'
    },
    evidence_note: cleanText(data?.evidence_note),
    trace
  };
}

// One primary area and optionally one secondary, from the fixed taxonomy. Shared with v2.
export function normalizeAreas(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .filter((area) => AREA_KEYS.includes(area?.key) && !seen.has(area.key) && seen.add(area.key))
    .slice(0, 2)
    .map((area, index) => ({
      key: area.key,
      salience: index === 0 ? 'primary' : 'secondary',
      weight: Number.isFinite(Number(area.weight)) && area.weight !== null ? clamp(area.weight, 0, 1, null) : null
    }));
}

function systemPrompt() {
  return [
    'You read one past conversation between a user and Claude (an AI assistant) and describe how the collaboration split.',
    'Return only valid JSON that matches the schema.',
    '',
    'Guidelines:',
    '- Use plain English. Stay clear, neutral, and nonjudgmental.',
    '- Ground everything in the actual conversation. Be concrete enough that the user would recognize the moments.',
    '- Do not use direct quotes from the conversation.',
    '- Lines like [used tool: ...] mean Claude used a tool or created an artifact. Lines like [attached ...] mean the user attached a file or pasted material.',
    '- Long conversations may have their middle omitted; this is marked in the transcript.',
    '- session_read_title must be short and concrete: 2 to 5 words, under 30 characters, no colon.',
    '- session_read_narrative is one short sentence about what happened overall.',
    '- user_role_summary is one short sentence fragment about what the user did. ai_role_summary is the same for AI.',
    `- areas use this taxonomy only: ${AREA_KEYS.join(', ')}. Exactly one primary area and optionally one secondary area.`,
    '- areas describe where AI showed up in this conversation. weight is 0 to 1 for how much of the conversation the area covers, or null.',
    '- weight_rows must be exactly these six work dimensions, in this order:',
    ...V1_DIMENSIONS.map((dimension, index) => `  ${index + 1}. ${dimension.key} / ${dimension.label}`),
    '- For each row, first decide involved: false when that kind of work did not really happen in this conversation (for example nothing was built, no research was done, no final decision was reached). For rows that are not involved, set position 50 with range 50 to 50 and say briefly why in the reason.',
    '- Then write reason: one short sentence naming what the user carried and what AI carried. Then choose a position consistent with that reason.',
    '- position is 0 to 100: 0 means AI carried nearly all of that work, 100 means the user carried nearly all of it, 50 means evenly shared.',
    '- Anchors: AI wrote the code or draft and the user only reviewed it -> building 15 to 25. The user chose between options AI offered -> final_call 80 to 90. AI decided what to do next and the user went along -> direction 20 to 30. The user named the problem and AI fixed it -> problems 55 to 70.',
    '- range_start and range_end show the rough band that work moved across during the conversation, with range_start <= position <= range_end.',
    '- collaboration_markers are true only when clearly shown in the conversation.',
    '- interaction_pattern.opening_mode: delegation (handed the task over with little context), contextualized (gave goals, constraints, or background up front), critique (asked AI to react to their own work), pastein (pasted material and asked AI to process it), exploration (open-ended questions or thinking out loud).',
    '- interaction_pattern.arc: draft_redirect_rebuild, ask_synthesize_decide, debug_test_fix, brainstorm_refine, explain_practice_check. Pick the closest.',
    '- evidence_note is one or two sentences, strictly behavioral: what the user did and what AI did, not what kind of session this was.',
    '- trace may list the first key turn and up to four key turn numbers from the transcript, or be null.',
    '- Avoid scoring language or overclaiming certainty.'
  ].join('\n');
}

// Keeps the opening of the conversation (how the user framed the task) and the
// most recent stretch, numbering messages by their original position.
function selectTranscript(messages) {
  const numbered = messages.map((message, index) => ({ ...message, index: index + 1 }));
  if (numbered.length <= MAX_PROMPT_MESSAGES) return numbered;
  const head = numbered.slice(0, HEAD_MESSAGES);
  const tail = numbered.slice(-(MAX_PROMPT_MESSAGES - HEAD_MESSAGES));
  return [...head, { omitted: true, from: HEAD_MESSAGES + 1, to: tail[0].index - 1 }, ...tail];
}

function truncate(text) {
  if (text.length <= MAX_MESSAGE_CHARS) return text;
  return `${text.slice(0, MAX_MESSAGE_CHARS - 320)} [...] ${text.slice(-300)}`;
}
