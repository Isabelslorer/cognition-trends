// Builds site/demo-data.js, the example dashboard on the public site, for a made-up person:
//
//   A product designer at a mid-size company. Uses Claude chats for writing and research, Claude
//   Code for side projects, Claude Design for mockups. Early on lets Claude draft most things; over
//   the year starts writing first and asking for critique.
//
// No chats are written and Claude is never called. This script makes one analyzed-chat record per
// made-up chat (the shape analyze.mjs writes to data/sessions/), with coded moments drawn from the
// persona's tendencies below, then runs the real build step on them with the hand-written copy in
// demo/copy.json. So every number on every page is computed the same way as for real data.
// Seeded, so a rebuild gives the same dashboard.
//
//   npm run demo

import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MIN_MOMENTS, PATHS, writeJson } from '../pipeline/lib/common.mjs';

const START = Date.UTC(2025, 9, 1); // October 2025
const MONTHS = 12;
const random = mulberry32(20261008);

// Chats per month at the start and end of the year, and the month each source starts.
const SOURCES = {
  claude_ai: { from: 0, volume: [11, 13] },
  claude_code: { from: 3, volume: [2, 5] },
  claude_design: { from: 5, volume: [3, 5] }
};

// Main topic, and the topics that can come second, per source.
const TOPICS = {
  claude_ai: [['writing', 32], ['research', 26], ['personal', 13], ['studying', 10], ['presenting', 10], ['career', 9]],
  claude_code: [['coding', 1]],
  claude_design: [['design', 1]]
};
const SECOND_TOPIC = {
  writing: ['presenting', 'career', 'research'],
  research: ['writing', 'design', 'presenting'],
  personal: ['career'],
  studying: ['coding', 'research'],
  presenting: ['writing', 'design'],
  career: ['writing', 'presenting'],
  coding: ['design', 'studying'],
  design: ['presenting', 'research']
};

// Chance that a moment of each kind of work is the person's, at the start and end of the year.
// This is where the persona's arc lives: she starts writing first and asking for critique.
const USER_SHARE = {
  ideas: [0.32, 0.7],
  direction: [0.58, 0.8],
  research: [0.34, 0.4],
  building: [0.08, 0.46],
  problems: [0.28, 0.74],
  final_call: [0.72, 0.84],
  checking: [0.26, 0.64],
  understanding: [0.22, 0.5]
};
// Per source: Claude Code builds and debugs more; in Claude Design she steers and spots what's off.
const SOURCE_SHIFT = {
  claude_ai: {},
  claude_code: { building: -0.1, research: -0.12 },
  claude_design: { building: -0.05, problems: 0.12, direction: 0.08, ideas: 0.05 }
};
// Chance that each kind of work comes up at all, with topic boosts.
const INVOLVED = { ideas: 0.6, direction: 0.75, research: 0.5, building: 0.85, problems: 0.55, final_call: 0.65, checking: 0.85, understanding: 0.55 };
const TOPIC_INVOLVED = {
  research: { research: 0.85 },
  coding: { problems: 0.9, understanding: 0.7 },
  studying: { understanding: 0.9, building: 0.4 },
  personal: { building: 0.35, final_call: 0.8 },
  design: { problems: 0.75, ideas: 0.75 }
};
// Moment-coded kinds of work (major counts double); the last two come from per-message codes.
const TURN_CODED = new Set(['checking', 'understanding']);

const OPENINGS = { delegation: [50, 16], contextualized: [20, 26], critique: [5, 28], pastein: [15, 18], exploration: [10, 12] };
const ARCS = {
  writing: [['draft_redirect_rebuild', 7], ['brainstorm_refine', 3]],
  research: [['ask_synthesize_decide', 3], ['brainstorm_refine', 1]],
  personal: [['ask_synthesize_decide', 1], ['brainstorm_refine', 1]],
  studying: [['explain_practice_check', 4], ['ask_synthesize_decide', 1]],
  presenting: [['draft_redirect_rebuild', 3], ['brainstorm_refine', 2]],
  career: [['draft_redirect_rebuild', 7], ['ask_synthesize_decide', 3]],
  coding: [['debug_test_fix', 7], ['draft_redirect_rebuild', 3]],
  design: [['draft_redirect_rebuild', 1], ['brainstorm_refine', 1]]
};

const sessions = [];
for (let month = 0; month < MONTHS; month += 1) {
  for (const [source, { from, volume }] of Object.entries(SOURCES)) {
    if (month < from) continue;
    const progress = (month - from) / Math.max(1, MONTHS - 1 - from);
    const count = Math.round(volume[0] + (volume[1] - volume[0]) * progress + (random() - 0.5) * 3);
    for (let index = 0; index < count; index += 1) sessions.push(makeSession(source, month));
  }
}
sessions.sort((a, b) => a.created_at.localeCompare(b.created_at));

const dir = await mkdtemp(path.join(os.tmpdir(), 'cognition-demo-'));
try {
  await Promise.all(sessions.map((session) => writeJson(path.join(dir, 'sessions', `${session.chat_key}.json`), session)));
  await writeJson(path.join(dir, 'conversations.json'), { conversations: sessions.map(({ chat_key, source }) => ({ id: chat_key, source })) });
  console.log(`Made ${sessions.length} chat records for the demo person.`);
  execFileSync(process.execPath, [
    path.join(PATHS.root, 'pipeline', 'build-dashboard.mjs'),
    '--copy', path.join(PATHS.root, 'demo', 'copy.json'),
    '--out', path.join(PATHS.root, 'site', 'demo-data.js')
  ], { stdio: 'inherit', env: { ...process.env, MIRO_DATA_DIR: dir } });
} finally {
  await rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------

function makeSession(source, month) {
  const year = month / (MONTHS - 1);
  const date = new Date(START);
  date.setUTCMonth(date.getUTCMonth() + month, 1 + Math.floor(random() * 28));
  date.setUTCHours(8 + Math.floor(random() * 12), Math.floor(random() * 60));

  const main = pick(TOPICS[source]);
  const areas = [{ key: main, salience: 'primary' }];
  if (random() < 0.4) areas.push({ key: SECOND_TOPIC[main][Math.floor(random() * SECOND_TOPIC[main].length)], salience: 'secondary' });

  // One lean per chat, so a chat where she was hands-on is hands-on across the board.
  const lean = gaussian() * 0.12;
  const weight_rows = Object.keys(USER_SHARE).map((key) => {
    const chance = TOPIC_INVOLVED[main]?.[key] ?? INVOLVED[key];
    if (random() >= chance) return { key, involved: false, position: 50, n: 0 };
    const [from, to] = USER_SHARE[key];
    const share = clamp(from + (to - from) * year + (SOURCE_SHIFT[source][key] || 0) + lean + gaussian() * 0.08, 0.03, 0.97);
    // Some chats have only one coded moment for a kind of work; the dashboard leaves those out.
    const n = random() < 0.15 ? 1 : MIN_MOMENTS + Math.floor(random() * (TURN_CODED.has(key) ? 7 : 4));
    let user = 0;
    let ai = 0;
    for (let index = 0; index < n; index += 1) {
      const weight = !TURN_CODED.has(key) && random() < 0.3 ? 2 : 1;
      if (random() < share) user += weight;
      else ai += weight;
    }
    return { key, involved: true, position: Math.round((100 * user) / (user + ai)), n, user_weight: user, ai_weight: ai };
  });

  const opening = pick(Object.entries(OPENINGS).map(([key, [from, to]]) => [key, from + (to - from) * year]));
  const position = (key) => weight_rows.find((row) => row.key === key);
  const userLed = (key) => position(key).involved && position(key).position >= 58;
  const id = `demo-${String(sessions.length + 1).padStart(3, '0')}`;
  return {
    session_id: `session_${id}`,
    chat_key: id,
    source,
    created_at: date.toISOString(),
    analyzed_at: '2026-10-01T00:00:00.000Z',
    model: 'claude-haiku-4-5',
    prompt_version: 'v2',
    areas,
    work_split: Object.fromEntries(weight_rows.map((row) => [row.key, row.position])),
    weight_rows,
    interaction_pattern: { opening_mode: opening, arc: pick(ARCS[main]) },
    collaboration_markers: {
      user_provided_material: ['contextualized', 'critique', 'pastein'].includes(opening),
      user_redirected_after_output: userLed('direction'),
      user_critiqued_or_corrected: userLed('problems') || userLed('checking'),
      user_made_final_selection: userLed('final_call'),
      ai_produced_first_pass: opening === 'delegation' || (position('building').involved && position('building').position <= 42)
    }
  };
}

function pick(weighted) {
  const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of weighted) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return weighted[weighted.length - 1][0];
}

function gaussian() {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mulberry32(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
