// Benchmarks a prompt version + model. Two modes:
//
//   Scenarios (default): codes the fictional known-answer conversations in eval/scenarios/ and checks
//   the results against their expected bands and key moments. Writes eval/report.md.
//     node eval/run-eval.mjs [--set scenarios|holdout] [--prompt v1,v2] [--model claude-haiku-4-5] [--runs 2] [--only 05]
//
//   Real chats: codes a fixed stratified sample of your own chats with several runs/models and reports
//   how much they agree (Krippendorff's alpha). Results stay in data/eval/ (gitignored).
//     node eval/run-eval.mjs --real 30 [--prompt v2] [--models claude-haiku-4-5,claude-sonnet-5-5] [--runs 2]
//
// Every call is cached in data/eval/cache/, so re-running a report costs nothing.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIMENSIONS, PATHS, clamp, loadEnv, parseArgs, readJson, requireApiKey, simpleHash, writeJson } from '../pipeline/lib/common.mjs';
import { describeError } from '../pipeline/lib/claude.mjs';
import { analyzeConversation, buildRequests, contentHash, getPrompt, runPool } from '../pipeline/lib/analyzer.mjs';
import { textFeatures } from '../pipeline/lib/features.mjs';
import { krippendorffInterval, spearman } from './stats.mjs';

// Pre-registered acceptance gates (see eval/README.md). Changing them after seeing results defeats the point.
const GATES = { bandHit: 0.85, involved: 0.9, runToRunAlpha: 0.8, crossModelAlpha: 0.667 };

const EVAL_DIR = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(PATHS.evalDir, 'cache');

loadEnv();
const args = parseArgs(process.argv.slice(2), ['dry-run']);
const prompts = String(args.prompt || 'v2').split(',').map((name) => getPrompt(name.trim()));
const models = String(args.models || args.model || process.env.CLAUDE_MODEL || 'claude-haiku-4-5').split(',').map((name) => name.trim());
const runs = clamp(args.runs, 1, 5, args.real ? 2 : 1);
const concurrency = clamp(args.concurrency, 1, 16, 4);
// scenarios = development set (the prompt was tuned on it); holdout = written after tuning, run untouched.
const set = args.set === 'holdout' ? 'holdout' : 'scenarios';
const SCENARIO_DIR = path.join(EVAL_DIR, set);

const conversations = args.real ? await sampleRealChats(clamp(args.real, 2, 200, 30)) : loadScenarios();
const configs = prompts.flatMap((prompt) => models.flatMap((model) => Array.from({ length: runs }, (_, run) => ({ prompt, model, run }))));
const jobs = configs.flatMap((config) => conversations.map((conversation) => ({ ...config, conversation })));
const pending = jobs.filter((job) => !existsSync(cachePath(job)));

console.log(`${conversations.length} ${args.real ? 'real chats' : 'scenarios'} x ${configs.length} configurations = ${jobs.length} codings, ${pending.length} not cached yet.`);
if (args['dry-run']) {
  const chars = pending.reduce((sum, job) => sum + buildRequests(job.conversation, job.prompt).reduce((total, request) => total + request.system.length + request.user.length, 0), 0);
  console.log(`Estimated input: ~${Math.round(chars / 4).toLocaleString()} tokens.`);
  process.exit(0);
}

if (pending.length) requireApiKey();
let cost = 0;
let failed = 0;
await runPool(pending, concurrency, async (job) => {
  try {
    const result = await analyzeConversation(job.conversation, { model: job.model, prompt: job.prompt });
    cost += result.cost;
    await writeJson(cachePath(job), { model: job.model, prompt: job.prompt.id, run: job.run, conversation: job.conversation.id, reflection: result.reflection });
    process.stdout.write('.');
  } catch (error) {
    failed += 1;
    console.warn(`\n  failed: ${job.conversation.id} (${job.prompt.id}, ${job.model}, run ${job.run + 1}) - ${describeError(error)}`);
  }
});
if (pending.length) console.log(`\nCoded ${pending.length - failed} conversations, estimated cost ~$${cost.toFixed(4)}.`);

const results = await Promise.all(jobs.map(async (job) => ({ ...job, reflection: existsSync(cachePath(job)) ? (await readJson(cachePath(job))).reflection : null })));

if (args.real) await reportReal(results);
else await reportScenarios(results);
if (failed) process.exitCode = 1;

// ---------------------------------------------------------------------------

function cachePath({ conversation, model, prompt, run }) {
  return path.join(CACHE_DIR, `${simpleHash(conversation.id)}-${contentHash(conversation, model, prompt)}-r${run}.json`);
}

function loadScenarios() {
  return readdirSync(SCENARIO_DIR)
    .filter((file) => file.endsWith('.json') && (!args.only || file.startsWith(args.only)))
    .sort()
    .map((file) => {
      const scenario = JSON.parse(readFileSync(path.join(SCENARIO_DIR, file), 'utf8'));
      return {
        id: scenario.id,
        title: scenario.title,
        source: scenario.source || 'claude_ai',
        created_at: '2026-01-01T00:00:00Z',
        message_count: scenario.messages.length,
        messages: scenario.messages,
        expected: scenario.expected || {},
        key_moments: scenario.key_moments || [],
        spec: scenario.spec
      };
    });
}

// A fixed, stratified sample: the same chats every time, spread over sources and lengths.
async function sampleRealChats(size) {
  const { conversations: all } = await readJson(PATHS.conversations);
  const eligible = all.filter((conversation) => conversation.message_count >= 4);
  const bySource = {};
  for (const conversation of eligible) (bySource[conversation.source || 'claude_ai'] ||= []).push(conversation);
  const picked = [];
  const sources = Object.keys(bySource);
  for (const source of sources) {
    const list = bySource[source].sort((a, b) => simpleHash(a.id).localeCompare(simpleHash(b.id)));
    const quota = Math.max(2, Math.round((size * list.length) / eligible.length));
    // Alternate short and long chats so both are represented.
    const byLength = [...list].sort((a, b) => a.message_count - b.message_count);
    const step = Math.max(1, Math.floor(byLength.length / quota));
    for (let index = 0; index < byLength.length && picked.filter((item) => (item.source || 'claude_ai') === source).length < quota; index += step) {
      picked.push(byLength[index]);
    }
  }
  return picked.slice(0, Math.max(size, sources.length * 2));
}

// ---------------------------------------------------------------------------
// Scenario report

async function reportScenarios(list) {
  const lines = [`# Scenario benchmark (${set === 'holdout' ? 'held-out set' : 'development set'})`, '', `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}. ${conversations.length} fictional scenarios in \`eval/${set}/\`.`, ''];
  lines.push('Each scenario states the expected result per dimension: a band the position must fall in, or "did not happen". Key moments are specific codes the coder must find (within one message).', '');

  for (const prompt of prompts) {
    for (const model of models) {
      const subset = list.filter((item) => item.prompt === prompt && item.model === model && item.reflection);
      const dims = DIMENSIONS.filter(({ key }) => subset.some((item) => item.reflection.weight_rows.some((row) => row.key === key)));
      const perDim = Object.fromEntries(dims.map(({ key }) => [key, { involvedOk: 0, involvedN: 0, bandHit: 0, bandN: 0, miss: 0 }]));
      const failures = [];
      let keyFound = 0;
      let keyN = 0;

      for (const item of subset) {
        const rows = Object.fromEntries(item.reflection.weight_rows.map((row) => [row.key, row]));
        for (const [key, expected] of Object.entries(item.conversation.expected)) {
          if (!perDim[key]) continue;
          const stat = perDim[key];
          const row = rows[key];
          stat.involvedN += 1;
          if (expected === false) {
            if (!row.involved) stat.involvedOk += 1;
            else failures.push(`${item.conversation.id} ${key}: expected not involved, got ${row.position} (${row.reason})`);
            continue;
          }
          const [lo, hi] = expected;
          stat.bandN += 1;
          if (!row.involved) {
            failures.push(`${item.conversation.id} ${key}: expected ${lo}-${hi}, got not involved`);
            continue;
          }
          stat.involvedOk += 1;
          const distance = row.position < lo ? lo - row.position : row.position > hi ? row.position - hi : 0;
          stat.miss += distance;
          if (distance === 0) stat.bandHit += 1;
          else failures.push(`${item.conversation.id} ${key}: expected ${lo}-${hi}, got ${row.position} (${row.reason})`);
        }
        if (prompt.id !== 'v1') {
          for (const key of item.conversation.key_moments) {
            keyN += 1;
            if (findsKey(item.reflection, key)) keyFound += 1;
            else failures.push(`${item.conversation.id} missed key ${describeKey(key)}`);
          }
        }
      }

      const total = (field) => Object.values(perDim).reduce((sum, stat) => sum + stat[field], 0);
      const bandHit = ratio(total('bandHit'), total('bandN'));
      const involved = ratio(total('involvedOk'), total('involvedN'));
      const runsUsed = new Set(subset.map((item) => item.run)).size;
      const alpha = runsUsed > 1 ? alphaAcrossConfigs(subset, (item) => item.run) : null;

      lines.push(`## ${prompt.id} on ${model}${runsUsed > 1 ? ` (${runsUsed} runs)` : ''}`, '');
      lines.push(`| | Band hit | Did/didn't happen correct | Mean miss (points outside band) |`, '|---|---|---|---|');
      for (const { key, label } of dims) {
        const stat = perDim[key];
        lines.push(`| ${label} | ${fraction(stat.bandHit, stat.bandN)} | ${fraction(stat.involvedOk, stat.involvedN)} | ${stat.bandN ? (stat.miss / stat.bandN).toFixed(1) : '–'} |`);
      }
      lines.push(`| **All** | **${pct(bandHit)}** | **${pct(involved)}** | ${total('bandN') ? (total('miss') / total('bandN')).toFixed(1) : '–'} |`, '');
      if (keyN) lines.push(`Key moments found: ${keyFound}/${keyN} (${pct(keyFound / keyN)}).`, '');
      if (alpha) lines.push(`Run-to-run agreement (Krippendorff's alpha, interval): ${formatAlpha(alpha)}.`, '');
      lines.push('Gates: ' + [
        gate('band hit', bandHit, GATES.bandHit),
        gate('did/didn\'t happen', involved, GATES.involved),
        ...(alpha ? [gate('run-to-run alpha', alpha.overall, GATES.runToRunAlpha)] : [])
      ].join(', ') + '.', '');
      if (failures.length) lines.push('<details><summary>Misses</summary>', '', ...failures.map((failure) => `- ${failure}`), '', '</details>', '');
      console.log(`${prompt.id} / ${model}: band hit ${pct(bandHit)}, did/didn't happen ${pct(involved)}${keyN ? `, key moments ${pct(keyFound / keyN)}` : ''}${alpha ? `, run-to-run alpha ${alpha.overall.toFixed(2)}` : ''}.`);
    }
  }

  const reportPath = path.join(EVAL_DIR, set === 'holdout' ? 'report-holdout.md' : 'report.md');
  await writeFile(reportPath, lines.join('\n'));
  console.log(`Report: ${path.relative(PATHS.root, reportPath)}`);
}

function findsKey(reflection, key) {
  if (key.dimension) {
    return (reflection.moments || []).some((moment) => moment.dimension === key.dimension && moment.actor === key.actor && Math.abs(moment.turn - key.turn) <= 1);
  }
  const turn = (reflection.user_turns || []).find((candidate) => candidate.turn === key.turn);
  return Boolean(turn && (key.reaction ? turn.reaction === key.reaction : turn.request === key.request));
}

function describeKey(key) {
  if (key.dimension) return `${key.dimension}/${key.actor} at ${key.turn}`;
  return `${key.reaction ? `reaction ${key.reaction}` : `request ${key.request}`} at ${key.turn}`;
}

// ---------------------------------------------------------------------------
// Real-chat reliability report (aggregates only in the console; details stay in data/eval/)

async function reportReal(list) {
  const lines = ['# Reliability on real chats', '', `Generated ${new Date().toISOString()}. ${conversations.length} chats (stratified by source and length).`, ''];
  for (const prompt of prompts) {
    const subset = list.filter((item) => item.prompt === prompt && item.reflection);
    const byRun = models.map((model) => ({ model, alpha: alphaAcrossConfigs(subset.filter((item) => item.model === model), (item) => item.run) }));
    const firstRun = subset.filter((item) => item.run === 0);
    const cross = models.length > 1 ? alphaAcrossConfigs(firstRun, (item) => item.model) : null;
    const involvement = involvementAgreement(subset);

    lines.push(`## ${prompt.id}`, '');
    for (const { model, alpha } of byRun) {
      if (!alpha) continue;
      lines.push(`- Run-to-run, ${model}: ${formatAlpha(alpha)}`);
      console.log(`${prompt.id} run-to-run ${model}: ${gate('alpha', alpha.overall, GATES.runToRunAlpha)}; lowest dimension ${lowest(alpha)}`);
    }
    if (cross) {
      lines.push(`- ${models.join(' vs ')}: ${formatAlpha(cross)}`);
      console.log(`${prompt.id} ${models.join(' vs ')}: ${gate('alpha', cross.overall, GATES.crossModelAlpha)}; lowest dimension ${lowest(cross)}`);
    }
    lines.push(`- Did/didn't happen agreement across all codings: ${Object.entries(involvement).map(([key, value]) => `${key} ${pct(value)}`).join(', ')}`);

    // Sanity check against a model-free feature: who wrote more of the words vs who built it.
    const pairs = firstRun
      .filter((item) => item.model === models[0])
      .map((item) => [item.reflection.weight_rows.find((row) => row.key === 'building'), textFeatures(item.conversation.messages).user_word_share])
      .filter(([row, share]) => row?.involved && share !== null)
      .map(([row, share]) => [row.position, share]);
    if (pairs.length > 4) {
      const rho = spearman(pairs);
      lines.push(`- Building vs your share of the words (Spearman, n=${pairs.length}): ${rho.toFixed(2)}`);
      console.log(`${prompt.id} building vs user word share: Spearman ${rho.toFixed(2)} (n=${pairs.length})`);
    }
    lines.push('');
  }
  const reportPath = path.join(PATHS.evalDir, 'real-report.md');
  await writeFile(reportPath, lines.join('\n'));
  console.log(`Report (private, gitignored): ${path.relative(PATHS.root, reportPath)}`);
}

function involvementAgreement(list) {
  const out = {};
  for (const { key } of DIMENSIONS) {
    let agree = 0;
    let total = 0;
    for (const conversation of conversations) {
      const values = list
        .filter((item) => item.conversation.id === conversation.id)
        .map((item) => item.reflection.weight_rows.find((row) => row.key === key)?.involved)
        .filter((value) => value !== undefined);
      if (values.length < 2) continue;
      total += 1;
      if (values.every((value) => value === values[0])) agree += 1;
    }
    if (total) out[key] = agree / total;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Statistics

// Krippendorff's alpha per dimension, treating each configuration (run or model) as a coder and each
// conversation as a unit. "Did not happen" counts as a missing value.
function alphaAcrossConfigs(list, coderOf) {
  const perDim = {};
  const pooledUnits = [];
  for (const { key } of DIMENSIONS) {
    const units = conversations.map((conversation) => list
      .filter((item) => item.conversation.id === conversation.id)
      .map((item) => item.reflection.weight_rows.find((row) => row.key === key))
      .filter((row) => row?.involved)
      .map((row) => row.position));
    const value = krippendorffInterval(units);
    if (value !== null) perDim[key] = value;
    pooledUnits.push(...units);
  }
  if (new Set(list.map(coderOf)).size < 2 || !Object.keys(perDim).length) return null;
  return { overall: krippendorffInterval(pooledUnits), perDim };
}

// Pooling all dimensions inflates alpha (between-dimension differences count as agreement), so the
// weakest single dimension is always reported next to the pooled value.
function lowest(alpha) {
  const [key, value] = Object.entries(alpha.perDim).sort((a, b) => a[1] - b[1])[0];
  return `${key} ${value.toFixed(2)}`;
}

function formatAlpha(alpha) {
  const labels = Object.fromEntries(DIMENSIONS.map(({ key, label }) => [key, label.toLowerCase()]));
  return `${alpha.overall.toFixed(2)} overall (${Object.entries(alpha.perDim).map(([key, value]) => `${labels[key]} ${value.toFixed(2)}`).join(', ')})`;
}

function gate(name, value, threshold) {
  return `${name} ${value === null || Number.isNaN(value) ? 'n/a' : value >= threshold ? 'PASS' : 'FAIL'} (${typeof value === 'number' ? (value <= 1 && name.includes('alpha') ? value.toFixed(2) : pct(value)) : 'n/a'} vs ${threshold <= 1 && name.includes('alpha') ? threshold : pct(threshold)})`;
}

function ratio(a, b) {
  return b ? a / b : null;
}

function fraction(a, b) {
  return b ? `${a}/${b}` : '–';
}

function pct(value) {
  return value === null || value === undefined ? 'n/a' : `${Math.round(value * 100)}%`;
}
