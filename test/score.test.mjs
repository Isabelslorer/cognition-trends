import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreConversation, share } from '../pipeline/lib/score.mjs';
import { textFeatures } from '../pipeline/lib/features.mjs';

const rowOf = (rows, key) => rows.find((row) => row.key === key);

test('no moments: every dimension is not involved', () => {
  const rows = scoreConversation({ moments: [], userTurns: [] }, 6);
  assert.equal(rows.length, 8);
  for (const row of rows) {
    assert.equal(row.involved, false);
    assert.equal(row.n, 0);
  }
});

test('all user moments score 100, all AI moments score 0', () => {
  const rows = scoreConversation({
    moments: [
      { turn: 1, dimension: 'ideas', actor: 'user', weight: 'major' },
      { turn: 3, dimension: 'ideas', actor: 'user', weight: 'minor' },
      { turn: 2, dimension: 'building', actor: 'ai', weight: 'major' }
    ]
  }, 4);
  assert.equal(rowOf(rows, 'ideas').position, 100);
  assert.equal(rowOf(rows, 'building').position, 0);
  assert.equal(rowOf(rows, 'direction').involved, false);
});

test('major counts twice a minor', () => {
  // user major (2) vs ai minor (1) -> 67
  const rows = scoreConversation({
    moments: [
      { turn: 1, dimension: 'final_call', actor: 'user', weight: 'major' },
      { turn: 2, dimension: 'final_call', actor: 'ai', weight: 'minor' }
    ]
  }, 2);
  assert.equal(rowOf(rows, 'final_call').position, 67);
  assert.equal(rowOf(rows, 'final_call').user_weight, 2);
  assert.equal(rowOf(rows, 'final_call').ai_weight, 1);
});

test('unknown weights count as minor and bad actors are ignored', () => {
  assert.equal(share([{ actor: 'user', weight: 1 }, { actor: 'ai', weight: 1 }]), 50);
  const rows = scoreConversation({
    moments: [
      { turn: 1, dimension: 'problems', actor: 'user', weight: 'huge' },
      { turn: 2, dimension: 'problems', actor: 'someone', weight: 'major' },
      { turn: 2, dimension: 'problems', actor: 'ai', weight: 'minor' }
    ]
  }, 2);
  assert.equal(rowOf(rows, 'problems').position, 50);
  assert.equal(rowOf(rows, 'problems').n, 2);
});

test('band spans the first-half and second-half split', () => {
  // first half: AI only (0); second half: user only (100); overall 50
  const rows = scoreConversation({
    moments: [
      { turn: 1, dimension: 'direction', actor: 'ai', weight: 'major' },
      { turn: 7, dimension: 'direction', actor: 'user', weight: 'major' }
    ]
  }, 8);
  const direction = rowOf(rows, 'direction');
  assert.equal(direction.position, 50);
  assert.equal(direction.range_start, 0);
  assert.equal(direction.range_end, 100);
});

test('checking and understanding come from per-turn codes', () => {
  const rows = scoreConversation({
    userTurns: [
      { turn: 1, reaction: 'none', request: 'do_it' },
      { turn: 3, reaction: 'accept', request: 'do_it' },
      { turn: 5, reaction: 'question', request: 'explain' },
      { turn: 7, reaction: 'build_on', request: 'inform' }
    ]
  }, 8);
  const checking = rowOf(rows, 'checking');
  assert.equal(checking.n, 2); // accept + question; none and build_on not counted
  assert.equal(checking.position, 50);
  const understanding = rowOf(rows, 'understanding');
  assert.equal(understanding.n, 3); // do_it, do_it, explain; inform not counted
  assert.equal(understanding.position, 33);
});

test('text features split words by speaker', () => {
  const features = textFeatures([
    { role: 'user', content: 'Can you help me write this?' },
    { role: 'assistant', content: 'Sure, here is a draft with eight words. [used tools: Read]' },
    { role: 'user', content: '[user interrupted AI] no wait' }
  ]);
  assert.equal(features.user_turns, 2);
  assert.equal(features.user_words, 11);
  assert.equal(features.ai_words, 11);
  assert.equal(features.interruptions, 1);
  assert.equal(features.tool_notes, 1);
  assert.equal(features.user_question_rate, 0.5);
});

test('Krippendorff alpha: perfect agreement is 1, disagreement drops it', async () => {
  const { krippendorffInterval } = await import('../eval/stats.mjs');
  assert.equal(krippendorffInterval([[10, 10], [50, 50], [90, 90]]), 1);
  assert.ok(krippendorffInterval([[10, 90], [90, 10], [50, 50]]) < 0);
  assert.equal(krippendorffInterval([[10], [20]]), null);
  // textbook-style check: small noise around well-separated values stays high
  assert.ok(krippendorffInterval([[10, 12], [50, 48], [90, 91]]) > 0.99);
});

test('Spearman: monotonic is 1, reversed is -1', async () => {
  const { spearman } = await import('../eval/stats.mjs');
  assert.equal(spearman([[1, 10], [2, 20], [3, 35]]), 1);
  assert.equal(spearman([[1, 3], [2, 2], [3, 1]]), -1);
});
