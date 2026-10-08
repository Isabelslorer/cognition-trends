// Turns a coded conversation (moments + per-user-turn codes) into dashboard positions.
// position = 100 x user weight / (user weight + AI weight): 0 = AI side, 100 = your side.
// A dimension with nothing counted is not involved. Pure functions, unit tested in test/score.test.mjs.

import { MOMENT_CODES, TURN_DIMENSIONS, WEIGHTS } from './codebook.mjs';

// Returns one row per dimension, in the same shape as v1's weight_rows, plus the counts behind it.
export function scoreConversation({ moments = [], userTurns = [] }, messageCount) {
  const half = Math.ceil((messageCount || maxTurn(moments, userTurns)) / 2);

  const momentRows = MOMENT_CODES.map(({ key }) => {
    const items = moments
      .filter((moment) => moment.dimension === key && (moment.actor === 'user' || moment.actor === 'ai'))
      .map((moment) => ({ turn: moment.turn, actor: moment.actor, weight: WEIGHTS[moment.weight] || WEIGHTS.minor }));
    return row(key, items, half, describeMoments);
  });

  const turnRows = TURN_DIMENSIONS.map(({ key, field, codes }) => {
    const sideOf = Object.fromEntries(codes.map((code) => [code.key, code.side]));
    const items = userTurns
      .map((turn) => ({ turn: turn.turn, actor: sideOf[turn[field]] || null, code: turn[field], weight: 1 }))
      .filter((item) => item.actor);
    return row(key, items, half, describeTurns);
  });

  return [...momentRows, ...turnRows];
}

export function share(items) {
  const user = items.filter((item) => item.actor === 'user').reduce((sum, item) => sum + item.weight, 0);
  const ai = items.filter((item) => item.actor === 'ai').reduce((sum, item) => sum + item.weight, 0);
  return user + ai > 0 ? (100 * user) / (user + ai) : null;
}

function row(key, items, half, describe) {
  const position = share(items);
  if (position === null) {
    return { key, involved: false, position: 50, range_start: 50, range_end: 50, n: 0, user_weight: 0, ai_weight: 0, reason: 'Did not come up.' };
  }
  // The band shows how the split moved between the first and second half of the conversation.
  const halves = [share(items.filter((item) => item.turn <= half)), share(items.filter((item) => item.turn > half))]
    .filter((value) => value !== null);
  const rounded = Math.round(position);
  return {
    key,
    involved: true,
    position: rounded,
    range_start: Math.round(Math.min(position, ...halves)),
    range_end: Math.round(Math.max(position, ...halves)),
    n: items.length,
    user_weight: items.filter((item) => item.actor === 'user').reduce((sum, item) => sum + item.weight, 0),
    ai_weight: items.filter((item) => item.actor === 'ai').reduce((sum, item) => sum + item.weight, 0),
    reason: describe(items)
  };
}

function describeMoments(items) {
  const count = (actor) => items.filter((item) => item.actor === actor).length;
  return `${items.length} moment${items.length === 1 ? '' : 's'}: ${count('user')} yours, ${count('ai')} AI's.`;
}

function describeTurns(items) {
  const tally = {};
  for (const item of items) tally[item.code] = (tally[item.code] || 0) + 1;
  return `${items.length} turn${items.length === 1 ? '' : 's'} counted: ${Object.entries(tally).map(([code, n]) => `${code} ${n}`).join(', ')}.`;
}

function maxTurn(moments, userTurns) {
  return Math.max(1, ...moments.map((moment) => moment.turn || 0), ...userTurns.map((turn) => turn.turn || 0));
}
