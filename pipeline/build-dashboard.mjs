// Step 3: aggregate the cached session records into the dashboard's data object
// (the same shape as the hard-coded `D` in the original extension's dashboard.js) and write
// site/data.js. One synthesis call writes the profile and per-area copy.
//
//   node pipeline/build-dashboard.mjs [--synth-model claude-sonnet-5-5] [--no-synthesis] [--force]

import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import {
  AREA_KEYS, ARCS, DIMENSIONS, MARKER_KEYS, MIN_MOMENTS, OPENING_MODES, PATHS,
  cleanText, countsAsInvolved, loadEnv, parseArgs, readJson, simpleHash, writeJson
} from './lib/common.mjs';
import { describeError, structuredJson } from './lib/claude.mjs';

// Visual layout and static copy per area, kept from the extension's mock dashboard.
const AREA_STYLE = {
  research: { label: 'Research', color: '#d7cfbe', includes: 'Finding sources, summarizing readings, comparing frameworks, and pulling together background material.' },
  writing: { label: 'Writing', color: '#e7c4ab', includes: 'Drafting, outlining ideas, rewriting sections, and getting words on the page.' },
  coding: { label: 'Coding', color: '#8ec7a1', includes: 'Writing code, debugging, explaining errors, and building functional prototypes.' },
  design: { label: 'Design', color: '#d7c079', includes: 'Layouts, wireframes, UI prototyping, visual critique, and structuring user-facing work.' },
  studying: { label: 'Studying', color: '#a8c7dd', includes: 'Exam prep, understanding concepts, generating practice questions, and reviewing material.' },
  career: { label: 'Career', color: '#d8b9c3', includes: 'Resume editing, cover letters, interview prep, networking messages, and professional decisions.' },
  presenting: { label: 'Presenting', color: '#a9d7de', includes: 'Slide decks, talk structure, speaker notes, and presentation prep.' },
  personal: { label: 'Personal', color: '#cbbcd9', includes: 'Life advice, exploring ideas, decision-making, and casual conversations.' }
};
// Bubble slots and sizes by rank (largest area first), from the mock layout.
const BUBBLE_SLOTS = [[35, 28], [60, 24], [78, 42], [44, 54], [22, 64], [68, 68], [84, 62], [56, 76]];
const BUBBLE_SIZES = ['xxl', 'xl', 'lg', 'md', 'sm', 'xs', 'xs', 'xs'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TREND_MIN_SESSIONS = 6;
const TREND_MIN_DELTA = 6;
const TREND_MIN_SPAN_DAYS = 60;
const SYNTH_SESSION_SAMPLE = 60;
const SOURCES = [
  { key: 'all', label: 'All sources', description: 'All of the person\'s Claude use: regular Claude chats, Claude Code sessions (a coding agent working in their files) and Claude Design chats (a visual design tool).' },
  { key: 'claude_ai', label: 'Claude chats', description: 'Regular Claude chats on claude.ai and the Claude apps.' },
  { key: 'claude_code', label: 'Claude Code', description: 'Claude Code sessions: a coding agent working directly in the person\'s files and terminal.' },
  { key: 'claude_design', label: 'Claude Design', description: 'Claude Design chats: a visual design tool where Claude builds designs and the person can also edit them directly.' }
];

loadEnv();
const args = parseArgs(process.argv.slice(2), ['no-synthesis', 'force']);
const synthModel = args['synth-model'] || process.env.CLAUDE_SYNTH_MODEL || 'claude-sonnet-5-5';

const sessions = await loadSessions();
if (sessions.length === 0) {
  console.error('No analyzed sessions found. Run: npm run analyze');
  process.exit(1);
}
// v1 positions are holistic model guesses, v2 positions are computed from coded moments: not comparable.
const versions = {};
for (const session of sessions) versions[session.prompt_version || 'v1'] = (versions[session.prompt_version || 'v1'] || 0) + 1;
if (Object.keys(versions).length > 1) {
  console.warn(`Warning: mixing prompt versions (${Object.entries(versions).map(([version, n]) => `${version}: ${n}`).join(', ')}). Their scores are not comparable; re-analyze with one version.`);
}

// Reliability measured by npm run eval -- --real (aggregates only), for the per-dimension footnotes.
const reliability = await loadReliability(sessions);

// One complete dashboard (bubbles, sliders, written profile) per source, plus all sources together.
const variants = {};
for (const source of SOURCES) {
  const subset = source.key === 'all' ? sessions : sessions.filter((session) => session.source === source.key);
  if (!subset.length) continue;
  const stats = computeStats(subset);
  const synthesis = args['no-synthesis'] ? null : await getSynthesis(stats, subset, source);
  variants[source.key] = { label: source.label, ...assembleDashboard(stats, synthesis) };
  console.log(`${source.label}: ${subset.length} chats (${variants[source.key].meta.rangeLabel})${synthesis ? '' : ', stats-only copy'}.`);
}
const data = { ...variants.all, variants, dimensions: DIMENSIONS, reliability, timeline: buildTimeline(sessions) };

await writeFile(PATHS.siteData, `// Generated by pipeline/build-dashboard.mjs on ${data.meta.generatedAt}. Do not edit.\nwindow.MIRO_DASHBOARD_DATA = ${JSON.stringify(data, null, 2)};\n`);
console.log(`Wrote ${PATHS.siteData}. Open site/index.html in a browser.`);

// ---------------------------------------------------------------------------

async function loadSessions() {
  if (!existsSync(PATHS.sessionsDir)) return [];
  // Only include sessions for conversations in the current parse, which also says where each came from.
  const sourceById = existsSync(PATHS.conversations)
    ? new Map((await readJson(PATHS.conversations)).conversations.map((conversation) => [conversation.id, conversation.source || 'claude_ai']))
    : null;
  const currentIds = sourceById ? new Set(sourceById.keys()) : null;
  const files = (await readdir(PATHS.sessionsDir)).filter((file) => file.endsWith('.json'));
  const records = await Promise.all(files.map((file) => readJson(path.join(PATHS.sessionsDir, file)).catch(() => null)));
  return records
    .filter((record) => record?.work_split && (!currentIds || currentIds.has(record.chat_key)))
    .map((record) => ({ ...record, source: sourceById?.get(record.chat_key) || 'claude_ai' }))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

function computeStats(list) {
  const areaScores = Object.fromEntries(AREA_KEYS.map((key) => [key, { score: 0, sessions: [] }]));
  for (const session of list) {
    for (const area of session.areas || []) {
      if (!areaScores[area.key]) continue;
      areaScores[area.key].score += area.salience === 'primary' ? 1 : 0.5;
      areaScores[area.key].sessions.push(session);
    }
  }
  const totalScore = Object.values(areaScores).reduce((sum, area) => sum + area.score, 0) || 1;

  const areas = AREA_KEYS
    .filter((key) => areaScores[key].sessions.length > 0)
    .map((key) => ({
      key,
      share: areaScores[key].score / totalScore,
      sessions: areaScores[key].sessions.length,
      work_split: meanSplit(areaScores[key].sessions),
      top_arc: topValue(areaScores[key].sessions.map((session) => session.interaction_pattern?.arc))
    }))
    .sort((a, b) => b.share - a.share);

  const dimensions = DIMENSIONS.map(({ key, label, question }) => {
    const values = list.map((session) => dimensionValue(session, key)).filter(Number.isFinite);
    const rows = list.map((session) => (session.weight_rows || []).find((row) => row.key === key));
    const counted = rows.filter(countsAsInvolved).map((row) => row.n).filter(Number.isFinite);
    return {
      key,
      label,
      question,
      chats: values.length,
      // Chats where it came up only once: left out of the averages (see MIN_MOMENTS).
      thin: rows.filter((row) => row && row.involved !== false && !countsAsInvolved(row)).length,
      moments: counted.reduce((sum, n) => sum + n, 0),
      mean: mean(values),
      p25: percentile(values, 0.25),
      p75: percentile(values, 0.75),
      you_led: values.filter((value) => value >= 58).length,
      ai_led: values.filter((value) => value <= 42).length,
      trend: computeTrend(list, key)
    };
  });

  const markerRates = Object.fromEntries(MARKER_KEYS.map((key) => [
    key,
    list.filter((session) => session.collaboration_markers?.[key]).length / list.length
  ]));

  return {
    count: list.length,
    first: list[0].created_at,
    last: list[list.length - 1].created_at,
    areas,
    dimensions,
    markerRates,
    openingModes: distribution(list.map((session) => session.interaction_pattern?.opening_mode), OPENING_MODES),
    arcs: distribution(list.map((session) => session.interaction_pattern?.arc), ARCS)
  };
}

// Compares the older half of chats with the newer half for one dimension.
function computeTrend(list, key) {
  const values = list
    .map((session) => ({ date: session.created_at, value: dimensionValue(session, key) }))
    .filter((item) => Number.isFinite(item.value));
  const spanDays = values.length ? (new Date(values[values.length - 1].date) - new Date(values[0].date)) / 86400000 : 0;
  if (values.length < TREND_MIN_SESSIONS || !(spanDays >= TREND_MIN_SPAN_DAYS)) return { direction: 'unknown', delta: 0, since: null };
  const middle = Math.floor(values.length / 2);
  const delta = mean(values.slice(middle).map((item) => item.value)) - mean(values.slice(0, middle).map((item) => item.value));
  if (Math.abs(delta) < TREND_MIN_DELTA) return { direction: 'steady', delta, since: null };
  return { direction: delta > 0 ? 'you' : 'ai', delta, since: values[middle].date };
}

async function getSynthesis(stats, list, source) {
  const cachePath = path.join(path.dirname(PATHS.synthesis), `synthesis-${source.key}.json`);
  if (!cleanText(process.env.ANTHROPIC_API_KEY)) {
    console.warn('No ANTHROPIC_API_KEY; building with stats-only copy. Add a key to get the written profile.');
    return null;
  }

  const inputHash = simpleHash(`${synthModel}|${list.map((session) => `${session.chat_key}:${session.analyzed_at}`).join('|')}`);
  if (!args.force && existsSync(cachePath)) {
    const cached = await readJson(cachePath).catch(() => null);
    if (cached?.input_hash === inputHash) {
      console.log(`  ${source.label}: reusing cached profile copy (chats unchanged).`);
      return cached.result;
    }
  }

  console.log(`  ${source.label}: writing profile copy with ${synthModel}...`);
  const digests = list.slice(-SYNTH_SESSION_SAMPLE).map((session) => ({
    date: String(session.created_at).slice(0, 10),
    title: session.session_read_title,
    areas: (session.areas || []).map((area) => area.key),
    what_happened: session.session_read_narrative,
    user_did: session.user_role_summary,
    ai_did: session.ai_role_summary,
    evidence: session.evidence_note,
    moments: (session.moments || []).filter((moment) => moment.weight === 'major').slice(0, 6)
      .map((moment) => `${moment.dimension}, ${moment.actor === 'user' ? 'you' : 'AI'}: ${moment.note}`),
    work_split: Object.fromEntries(DIMENSIONS.map(({ key }) => [key, dimensionValue(session, key)]).filter(([, value]) => value !== null)),
    opening: session.interaction_pattern?.opening_mode,
    arc: session.interaction_pattern?.arc
  }));

  const system = [
    'You write the copy for a personal dashboard that reflects how one person collaborates with AI (Claude) across many conversations.',
    'You receive aggregate statistics and short digests of individual conversations. Return only JSON matching the schema.',
    '',
    'Voice and rules:',
    '- Speak to the person as "you" and refer to the assistant as "AI". Warm, plain, specific, nonjudgmental. No hype.',
    '- Ground every claim in the statistics and digests. Name recognizable kinds of work, not generic platitudes.',
    '- Work split scale: 0 means AI carried nearly all of that work, 100 means the person carried nearly all of it.',
    '- Avoid percentages and scores in the copy; the dashboard shows those separately.',
    '- Each field is one or two short sentences unless noted. Tags are 2 to 4 words each, exactly three per card.',
    '- body fields may bold one short phrase with **double asterisks**. No other markdown.',
    '- hero_title: 3 to 6 words naming the overall working style. dynamic_pill: 3 to 5 words.',
    '- you/ai/together titles are short names like "The Redirector", "The Eager Builder", or "Draft. Redirect. Rebuild."',
    '- whats_working: a strength visible in the data. prompt_better: one concrete prompting habit to try, with a short example phrase. watch_for: a pattern that could quietly erode the person\'s own skills or judgment.',
    '- areas: one entry for each area key provided, no others. patterns = how the collaboration usually goes there; helps = what AI adds; risk = what can get in the way; try = one small concrete move for next time.',
    '- dimensions: one entry for each dimension key provided. detail = what the split usually looks like for that kind of work, one sentence.',
    '',
    'Style reference (from a different person, do not copy the content):',
    '- patterns: "You use AI to get momentum. The first draft is usually something you push against."',
    '- try: "Before asking for a draft, write one sentence about what you want the piece to do."',
    '- you.body: "You think by reacting. Your strongest work starts after you have something concrete to push against. You rarely start from zero. You start from **\\"not quite.\\"**"'
  ].join('\n');

  const user = JSON.stringify({
    conversations_from: source.description,
    chat_count: stats.count,
    date_range: rangeLabel(stats.first, stats.last),
    areas: stats.areas.map((area) => ({
      key: area.key,
      share_of_use: Math.round(area.share * 100) / 100,
      chats: area.sessions,
      mean_work_split: area.work_split,
      most_common_arc: area.top_arc
    })),
    dimensions: stats.dimensions.map((dimension) => ({
      key: dimension.key,
      label: dimension.label,
      question: dimension.question,
      mean_position: Math.round(dimension.mean),
      middle_half: [Math.round(dimension.p25), Math.round(dimension.p75)],
      chats_where_this_work_happened: dimension.chats,
      chats_you_led: dimension.you_led,
      chats_ai_led: dimension.ai_led,
      trend: dimension.trend.direction
    })),
    collaboration_marker_rates: roundValues(stats.markerRates),
    opening_modes: stats.openingModes,
    arcs: stats.arcs,
    recent_conversations: digests
  });

  let json;
  try {
    // Sonnet 5.5 thinks by default; the budget leaves room for that plus the JSON.
    ({ json } = await structuredJson({ model: synthModel, system, user, schema: synthesisSchema(stats.areas.map((area) => area.key)), maxTokens: 16000 }));
  } catch (error) {
    console.warn(`Synthesis failed (${describeError(error)}); building with stats-only copy.`);
    return null;
  }
  await writeJson(cachePath, { input_hash: inputHash, model: synthModel, created_at: new Date().toISOString(), result: json });
  return json;
}

function assembleDashboard(stats, synthesis) {
  const areaCopy = Object.fromEntries((synthesis?.areas || []).map((area) => [area.key, area]));
  const dimensionCopy = Object.fromEntries((synthesis?.dimensions || []).map((dimension) => [dimension.key, dimension.detail]));

  const percents = roundToHundred(stats.areas.map((area) => area.share * 100));
  const areas = stats.areas.map((area, rank) => {
    const style = AREA_STYLE[area.key];
    const copy = areaCopy[area.key] || {};
    const [x, y] = BUBBLE_SLOTS[rank];
    // Areas with the same share get the same bubble size as the first of their tie.
    const sizeRank = stats.areas.findIndex((other) => other.share === area.share);
    return {
      id: area.key,
      label: style.label,
      pct: Math.max(1, percents[rank]),
      sessions: area.sessions,
      size: BUBBLE_SIZES[sizeRank],
      x,
      y,
      color: style.color,
      includes: style.includes,
      patterns: cleanText(copy.patterns, fallbackAreaPattern(area)),
      helps: cleanText(copy.helps, 'AI gives you a faster starting point here.'),
      risk: cleanText(copy.risk, 'The more AI carries here, the less practice your own first instincts get.'),
      try: cleanText(copy.try, 'Before the next request in this area, write down what you would do on your own first.')
    };
  });

  // Dimensions with no data (for example checking/understanding on v1 records) are left out.
  const aspects = stats.dimensions.filter((dimension) => dimension.chats > 0).map((dimension) => {
    const position = Math.round(dimension.mean);
    const { verdict, tone } = verdictFor(position);
    return {
      key: dimension.key,
      label: dimension.label,
      question: dimension.question,
      position,
      lo: Math.round(Math.min(dimension.p25, position)),
      hi: Math.round(Math.max(dimension.p75, position)),
      verdict,
      tone,
      trendLine: trendLine(dimension.trend),
      detail: cleanText(dimensionCopy[dimension.key], `This came up in ${dimension.chats} of ${stats.count} chats. You carried more of it in ${dimension.you_led}; AI carried more in ${dimension.ai_led}.`),
      basis: `Based on ${dimension.chats} chat${dimension.chats === 1 ? '' : 's'} where this happened${dimension.moments ? ` (${dimension.moments} coded moments)` : ''}.`,
      footnote: footnoteFor(dimension, reliability?.dimensions?.[dimension.key], reliability)
    };
  });

  return {
    meta: {
      chatCount: stats.count,
      rangeLabel: rangeLabel(stats.first, stats.last),
      generatedAt: new Date().toISOString(),
      synthesized: Boolean(synthesis)
    },
    areas,
    aspects,
    profile: synthesis ? profileFromSynthesis(synthesis) : fallbackProfile(stats)
  };
}

// One compact row per chat for the "Over time" view, which filters and buckets
// these in the browser. split only holds the kinds of work that happened in that chat.
function buildTimeline(list) {
  return list.map((session) => ({
    date: String(session.created_at).slice(0, 10),
    source: session.source,
    areas: (session.areas || []).map((area) => area.key),
    opening: session.interaction_pattern?.opening_mode || null,
    arc: session.interaction_pattern?.arc || null,
    split: Object.fromEntries(DIMENSIONS
      .map(({ key }) => [key, dimensionValue(session, key)])
      .filter(([, value]) => value !== null))
  }));
}

function profileFromSynthesis(synthesis) {
  const card = (value) => ({
    title: cleanText(value?.title),
    body: cleanText(value?.body),
    tags: (value?.tags || []).map((tag) => cleanText(tag)).filter(Boolean).slice(0, 3)
  });
  return {
    heroTitle: cleanText(synthesis.hero_title, 'How you work with AI'),
    summary: cleanText(synthesis.summary),
    dynamicPill: cleanText(synthesis.dynamic_pill),
    you: card(synthesis.you),
    ai: card(synthesis.ai),
    together: card(synthesis.together),
    helps: cleanText(synthesis.whats_working),
    risk: cleanText(synthesis.prompt_better),
    next: cleanText(synthesis.watch_for)
  };
}

// Stats-only profile used when no synthesis call is made.
function fallbackProfile(stats) {
  const byPosition = [...stats.dimensions].sort((a, b) => b.mean - a.mean);
  const yours = byPosition[0];
  const ais = byPosition[byPosition.length - 1];
  const topArc = Object.entries(stats.arcs).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topOpening = Object.entries(stats.openingModes).sort((a, b) => b[1] - a[1])[0]?.[0];
  const rate = (key) => stats.markerRates[key] || 0;

  return {
    heroTitle: 'How you work with AI',
    summary: `Across ${stats.count} chats, you carried the most of "${yours.label.toLowerCase()}" and AI carried the most of "${ais.label.toLowerCase()}".`,
    dynamicPill: humanize(topArc || 'mixed patterns'),
    you: {
      title: humanize(topOpening || 'Varied openings'),
      body: `Your chats most often open in ${humanize(topOpening || 'varied').toLowerCase()} mode.`,
      tags: [
        rate('user_provided_material') >= 0.5 ? 'Brings own material' : 'Starts from a question',
        rate('user_critiqued_or_corrected') >= 0.5 ? 'Critiques output' : 'Accepts most output',
        rate('user_made_final_selection') >= 0.5 ? 'Keeps the final say' : 'Shares the final say'
      ]
    },
    ai: {
      title: rate('ai_produced_first_pass') >= 0.5 ? 'First-draft maker' : 'Sounding board',
      body: `AI produced the first pass in ${Math.round(rate('ai_produced_first_pass') * stats.count)} of ${stats.count} chats.`,
      tags: ['Stats only', 'Add a key', 'For full copy']
    },
    together: {
      title: humanize(topArc || 'Mixed'),
      body: 'The most common shape of your conversations.',
      tags: [`${stats.count} chats`, rangeLabel(stats.first, stats.last), 'Claude export']
    },
    helps: `You redirected AI after its output in ${Math.round(rate('user_redirected_after_output') * 100)}% of chats.`,
    risk: 'Run the build with an ANTHROPIC_API_KEY to get written, personalized guidance here.',
    next: `AI carried the most of "${ais.label.toLowerCase()}". Worth noticing whether that is a choice.`
  };
}

function fallbackAreaPattern(area) {
  const entries = DIMENSIONS.map(({ key, label }) => ({ label: label.toLowerCase(), value: area.work_split[key] }));
  entries.sort((a, b) => b.value - a.value);
  return `Across ${area.sessions} chats, you carried more of ${entries[0].label}, while AI carried more of ${entries[entries.length - 1].label}.`;
}

// Dashboard scale: 0 = AI, 100 = you (the dot sits between the "AI" and "You" labels).
async function loadReliability(list) {
  const file = path.join(PATHS.evalDir, 'reliability.json');
  if (!existsSync(file)) return null;
  const summary = await readJson(file).catch(() => null);
  const promptId = topValue(list.map((session) => session.prompt_version || 'v1'));
  const model = topValue(list.map((session) => session.model));
  const measured = summary?.prompts?.[promptId];
  if (!measured) return null;
  const repeat = measured.run_to_run?.[model];
  const cross = measured.cross_model;
  return {
    model,
    sample: summary.chats,
    min_moments: MIN_MOMENTS,
    cross_models: cross?.models || null,
    dimensions: Object.fromEntries(DIMENSIONS.map(({ key }) => [key, {
      repeat: Number.isFinite(repeat?.per_dim?.[key]) ? { alpha: round2(repeat.per_dim[key]), chats: repeat.chats?.[key] ?? null } : null,
      cross: Number.isFinite(cross?.per_dim?.[key]) ? { alpha: round2(cross.per_dim[key]), chats: cross.chats?.[key] ?? null } : null
    }]))
  };
}

// A short plain-language note on how much a slider can be trusted.
function footnoteFor(dimension, measured, meta) {
  const parts = [`Counted in ${dimension.chats} chats where this came up at least ${MIN_MOMENTS} times${dimension.thin ? `; ${dimension.thin} chats where it came up only once are left out` : ''}.`];
  if (dimension.chats < 30) parts.push('Few chats, so read this one with care.');
  if (!meta) return parts.join(' ');
  if (measured?.repeat) parts.push(`Re-analyzing with ${modelName(meta.model)} gave ${agreementWord(measured.repeat.alpha)} agreement (α ${measured.repeat.alpha.toFixed(2)}, ${measured.repeat.chats} test chats).`);
  else parts.push('Too few test chats to measure how repeatable this one is.');
  if (measured?.cross && meta.cross_models) parts.push(`${meta.cross_models.map(modelName).join(' and ')} show ${agreementWord(measured.cross.alpha)} agreement with each other (α ${measured.cross.alpha.toFixed(2)}, ${measured.cross.chats} test chats).`);
  return parts.join(' ');
}

function agreementWord(alpha) {
  return alpha >= 0.8 ? 'high' : alpha >= 0.667 ? 'moderate' : 'low';
}

function modelName(id) {
  const match = String(id).match(/claude-(\w+)-(\d+)-(\d+)/);
  return match ? `${match[1][0].toUpperCase()}${match[1].slice(1)} ${match[2]}.${match[3]}` : id;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function verdictFor(position) {
  if (position >= 80) return { verdict: 'Clearly you', tone: 'you' };
  if (position >= 58) return { verdict: 'Leaned to you', tone: 'you' };
  if (position > 42) return { verdict: 'Shared', tone: 'shared' };
  if (position > 20) return { verdict: 'Leaned to AI', tone: 'ai' };
  return { verdict: 'Clearly AI', tone: 'ai' };
}

function trendLine(trend) {
  if (trend.direction === 'unknown') return 'Not enough history yet to see a trend.';
  if (trend.direction === 'steady') return 'Consistent over time.';
  const since = new Date(trend.since);
  const month = `${MONTHS_LONG[since.getUTCMonth()]} ${since.getUTCFullYear()}`;
  return `Trending toward ${trend.direction === 'you' ? 'you' : 'AI'} since ${month}.`;
}

function rangeLabel(first, last) {
  const start = new Date(first);
  const end = new Date(last);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const format = (date, withYear) => `${MONTHS[date.getUTCMonth()]}${withYear ? ` ${date.getUTCFullYear()}` : ''}`;
  if (sameYear && start.getUTCMonth() === end.getUTCMonth()) return format(start, true);
  return `${format(start, !sameYear)} – ${format(end, true)}`;
}

// Largest-remainder rounding so the bubble percentages add up to exactly 100.
function roundToHundred(values) {
  const floors = values.map(Math.floor);
  let remaining = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = values.map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort((a, b) => b.remainder - a.remainder);
  for (const { index } of order) {
    if (remaining <= 0) break;
    floors[index] += 1;
    remaining -= 1;
  }
  return floors;
}

// A dimension's position in one chat, or null when that kind of work did not happen there.
function dimensionValue(session, key) {
  const row = (session.weight_rows || []).find((candidate) => candidate.key === key);
  if (row && !countsAsInvolved(row)) return null;
  const value = Number(row ? row.position : session.work_split?.[key]);
  return Number.isFinite(value) ? value : null;
}

function meanSplit(list) {
  return Object.fromEntries(DIMENSIONS.map(({ key }) => [
    key,
    Math.round(mean(list.map((session) => dimensionValue(session, key)).filter(Number.isFinite)))
  ]));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 50;
}

function percentile(values, fraction) {
  if (!values.length) return 50;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}

function distribution(values, keys) {
  const counts = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const value of values) if (value in counts) counts[value] += 1;
  return counts;
}

function topValue(values) {
  const counts = {};
  for (const value of values) if (value) counts[value] = (counts[value] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function roundValues(object) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, Math.round(value * 100) / 100]));
}

function humanize(key) {
  const text = String(key).replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function synthesisSchema(areaKeys) {
  const card = {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      body: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } }
    },
    required: ['title', 'body', 'tags']
  };
  // Tag counts are enforced in profileFromSynthesis(); structured outputs have no array length limits.
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      hero_title: { type: 'string' },
      summary: { type: 'string' },
      dynamic_pill: { type: 'string' },
      you: card,
      ai: card,
      together: card,
      whats_working: { type: 'string' },
      prompt_better: { type: 'string' },
      watch_for: { type: 'string' },
      areas: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            key: { type: 'string', enum: areaKeys },
            patterns: { type: 'string' },
            helps: { type: 'string' },
            risk: { type: 'string' },
            try: { type: 'string' }
          },
          required: ['key', 'patterns', 'helps', 'risk', 'try']
        }
      },
      dimensions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            key: { type: 'string', enum: DIMENSIONS.map((dimension) => dimension.key) },
            detail: { type: 'string' }
          },
          required: ['key', 'detail']
        }
      }
    },
    required: ['hero_title', 'summary', 'dynamic_pill', 'you', 'ai', 'together', 'whats_working', 'prompt_better', 'watch_for', 'areas', 'dimensions']
  };
}
