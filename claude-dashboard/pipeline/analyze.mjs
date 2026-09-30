// Step 2: analyze each conversation with a cheap model via OpenRouter and cache one
// session record per conversation in data/sessions/<id>.json.
// Adapted from the extension's background.js (prompt + schema) and content.js
// (normalizeAnalysis + buildDashboardSessionRecord).
//
//   node pipeline/analyze.mjs [--model anthropic/claude-haiku-4.5] [--limit 20] [--since 2026-01-01]
//                             [--concurrency 4] [--min-messages 4] [--force] [--dry-run]

import path from 'node:path';
import { existsSync } from 'node:fs';
import {
  ARCS, AREA_KEYS, DIMENSIONS, MARKER_KEYS, OPENING_MODES, PATHS,
  clamp, cleanText, loadEnv, parseArgs, readJson, requireApiKey, simpleHash, writeJson
} from './lib/common.mjs';
import { chatJson } from './lib/openrouter.mjs';

const HEAD_MESSAGES = 6;
const MAX_PROMPT_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 1500;

const reflectionSchema = {
  name: 'claude_session_reflection',
  strict: true,
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
        minItems: 1,
        maxItems: 2,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            key: { type: 'string', enum: AREA_KEYS },
            salience: { type: 'string', enum: ['primary', 'secondary'] },
            weight: { type: ['number', 'null'] }
          },
          required: ['key', 'salience', 'weight']
        }
      },
      weight_rows: {
        type: 'array',
        minItems: 6,
        maxItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            key: { type: 'string', enum: DIMENSIONS.map((dimension) => dimension.key) },
            position: { type: 'number' },
            range_start: { type: 'number' },
            range_end: { type: 'number' },
            reason: { type: 'string' }
          },
          required: ['key', 'position', 'range_start', 'range_end', 'reason']
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
              first_key_turn: { type: ['integer', 'null'] },
              key_turn_indices: { type: 'array', maxItems: 4, items: { type: 'integer' } }
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

loadEnv();
const args = parseArgs(process.argv.slice(2), ['force', 'dry-run']);
const model = args.model || process.env.OPENROUTER_MODEL || 'anthropic/claude-haiku-4.5';
const concurrency = clamp(args.concurrency, 1, 16, 4);
const minMessages = clamp(args['min-messages'], 1, 1000, 4);
const limit = clamp(args.limit, 1, 100000, Infinity);

if (!existsSync(PATHS.conversations)) {
  console.error('No parsed conversations yet. Run: npm run parse -- <path to conversations.json>');
  process.exit(1);
}

const { conversations } = await readJson(PATHS.conversations);
const eligible = conversations
  .filter((conversation) => conversation.message_count >= minMessages)
  .filter((conversation) => !args.since || String(conversation.created_at) >= args.since)
  .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  .slice(0, limit);

const todo = [];
for (const conversation of eligible) {
  const sourceHash = simpleHash(`${conversation.updated_at}|${conversation.message_count}`);
  const cachePath = path.join(PATHS.sessionsDir, `${conversation.id}.json`);
  if (!args.force && existsSync(cachePath)) {
    const cached = await readJson(cachePath).catch(() => null);
    if (cached?.source_hash === sourceHash) continue;
  }
  todo.push({ conversation, sourceHash, cachePath });
}

console.log(`${conversations.length} conversations, ${eligible.length} eligible (>= ${minMessages} messages), ${todo.length} need analysis with ${model}.`);

if (args['dry-run']) {
  const promptChars = todo.reduce((sum, item) => sum + JSON.stringify(buildMessages(item.conversation)).length, 0);
  console.log(`Estimated input: ~${Math.round(promptChars / 4).toLocaleString()} tokens across ${todo.length} requests.`);
  if (todo[0]) {
    console.log('\n--- First request (user message) ---\n');
    console.log(buildMessages(todo[0].conversation)[1].content);
  }
  process.exit(0);
}

if (todo.length === 0) process.exit(0);

const apiKey = requireApiKey();
let done = 0;
let totalCost = 0;
const failures = [];

await runPool(todo, concurrency, async ({ conversation, sourceHash, cachePath }) => {
  try {
    const { json, usage } = await chatJson({
      apiKey,
      model,
      messages: buildMessages(conversation),
      schema: reflectionSchema,
      maxTokens: 2000
    });
    totalCost += Number(usage?.cost) || 0;
    await writeJson(cachePath, buildSessionRecord(conversation, normalizeReflection(json), { model, sourceHash }));
    done += 1;
    console.log(`[${done}/${todo.length}] ${conversation.title}`);
  } catch (error) {
    failures.push({ id: conversation.id, title: conversation.title, error: error.message });
    console.warn(`  failed: ${conversation.title} - ${error.message}`);
  }
});

console.log(`\nAnalyzed ${done} conversations${totalCost ? `, OpenRouter cost ~$${totalCost.toFixed(4)}` : ''}.`);
if (failures.length) {
  console.log(`${failures.length} failed; re-run the same command to retry just those.`);
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------

function buildMessages(conversation) {
  const system = [
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
    ...DIMENSIONS.map((dimension, index) => `  ${index + 1}. ${dimension.key} / ${dimension.label}`),
    '- position is 0 to 100: 0 means AI carried nearly all of that work, 100 means the user carried nearly all of it, 50 means evenly shared.',
    '- If a kind of work barely happened in this conversation, use a position near 50 with a narrow range and say so in the reason.',
    '- range_start and range_end show the rough band that work moved across during the conversation, with range_start <= position <= range_end.',
    '- reason is one short sentence naming what the user carried and what AI carried.',
    '- collaboration_markers are true only when clearly shown in the conversation.',
    '- interaction_pattern.opening_mode: delegation (handed the task over with little context), contextualized (gave goals, constraints, or background up front), critique (asked AI to react to their own work), pastein (pasted material and asked AI to process it), exploration (open-ended questions or thinking out loud).',
    '- interaction_pattern.arc: draft_redirect_rebuild, ask_synthesize_decide, debug_test_fix, brainstorm_refine, explain_practice_check. Pick the closest.',
    '- evidence_note is one or two sentences, strictly behavioral: what the user did and what AI did, not what kind of session this was.',
    '- trace may list the first key turn and up to four key turn numbers from the transcript, or be null.',
    '- Avoid scoring language or overclaiming certainty.'
  ].join('\n');

  const lines = [
    `Conversation title: ${conversation.title}`,
    `Started: ${String(conversation.created_at || 'unknown').slice(0, 10)}. Total messages: ${conversation.message_count}.`,
    'Transcript:'
  ];
  for (const item of selectTranscript(conversation.messages)) {
    lines.push(item.omitted
      ? `[... messages ${item.from}-${item.to} omitted ...]`
      : `${item.index}. ${item.role === 'assistant' ? 'AI' : 'USER'}: ${truncate(item.content)}`);
  }

  return [
    { role: 'system', content: system },
    { role: 'user', content: lines.join('\n') }
  ];
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

function normalizeReflection(data) {
  const weightRows = DIMENSIONS.map(({ key }) => {
    const row = (Array.isArray(data?.weight_rows) ? data.weight_rows : []).find((candidate) => candidate?.key === key) || {};
    const position = Math.round(clamp(row.position, 0, 100, 50));
    const start = clamp(row.range_start, 0, 100, position - 12);
    const end = clamp(row.range_end, 0, 100, position + 12);
    return {
      key,
      position,
      range_start: Math.round(Math.max(0, Math.min(start, end, position))),
      range_end: Math.round(Math.min(100, Math.max(start, end, position))),
      reason: cleanText(row.reason)
    };
  });

  const seen = new Set();
  const areas = (Array.isArray(data?.areas) ? data.areas : [])
    .filter((area) => AREA_KEYS.includes(area?.key) && !seen.has(area.key) && seen.add(area.key))
    .slice(0, 2)
    .map((area, index) => ({
      key: area.key,
      salience: index === 0 ? 'primary' : 'secondary',
      weight: Number.isFinite(Number(area.weight)) && area.weight !== null ? clamp(area.weight, 0, 1, null) : null
    }));

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
    areas,
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

// Same shape as the extension's buildDashboardSessionRecord(), plus the
// conversation date and the per-chat summaries the synthesis step uses.
function buildSessionRecord(conversation, reflection, { model, sourceHash }) {
  return {
    session_id: `session_${conversation.id}`,
    chat_key: conversation.id,
    source: 'claude-export',
    title: conversation.title,
    created_at: conversation.created_at,
    analyzed_at: new Date().toISOString(),
    message_count: conversation.message_count,
    model,
    source_hash: sourceHash,
    ...reflection
  };
}

async function runPool(items, size, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}
