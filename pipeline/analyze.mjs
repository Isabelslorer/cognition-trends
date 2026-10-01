// Step 2: code each conversation with Claude Haiku 4.5 and cache one session record per
// conversation in data/sessions/<id>.json. The prompt versions live in lib/prompts/ (v2 by default;
// v1 is the original holistic scoring from the Miro extension), the definitions in lib/codebook.mjs.
//
//   node pipeline/analyze.mjs [--prompt v2] [--model claude-haiku-4-5] [--limit 20] [--since 2026-01-01]
//                             [--concurrency 4] [--min-messages 4] [--force] [--dry-run]

import path from 'node:path';
import { existsSync } from 'node:fs';
import { PATHS, clamp, loadEnv, parseArgs, readJson, requireApiKey, writeJson } from './lib/common.mjs';
import { describeError } from './lib/claude.mjs';
import { analyzeConversation, buildRequests, buildSessionRecord, contentHash, getPrompt, runPool } from './lib/analyzer.mjs';

loadEnv();
const args = parseArgs(process.argv.slice(2), ['force', 'dry-run']);
const model = args.model || process.env.CLAUDE_MODEL || 'claude-haiku-4-5';
const prompt = getPrompt(args.prompt);
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
  const sourceHash = contentHash(conversation, model, prompt);
  const cachePath = path.join(PATHS.sessionsDir, `${conversation.id}.json`);
  if (!args.force && existsSync(cachePath)) {
    const cached = await readJson(cachePath).catch(() => null);
    if (cached?.source_hash === sourceHash) continue;
  }
  todo.push({ conversation, sourceHash, cachePath });
}

console.log(`${conversations.length} conversations, ${eligible.length} eligible (>= ${minMessages} messages), ${todo.length} need analysis with ${model}, prompt ${prompt.id}.`);

if (args['dry-run']) {
  const requests = todo.map((item) => buildRequests(item.conversation, prompt));
  const promptChars = requests.flat().reduce((sum, request) => sum + request.system.length + request.user.length, 0);
  const multipart = requests.filter((list) => list.length > 1).length;
  console.log(`Estimated input: ~${Math.round(promptChars / 4).toLocaleString()} tokens across ${requests.flat().length} requests${multipart ? ` (${multipart} long chats coded in parts)` : ''}.`);
  if (todo[0]) {
    console.log('\n--- First request (user message) ---\n');
    console.log(requests[0][0].user);
  }
  process.exit(0);
}

if (todo.length === 0) process.exit(0);

requireApiKey();
let done = 0;
let totalCost = 0;
const failures = [];

await runPool(todo, concurrency, async ({ conversation, sourceHash, cachePath }) => {
  try {
    const { reflection, cost } = await analyzeConversation(conversation, { model, prompt });
    totalCost += cost;
    await writeJson(cachePath, buildSessionRecord(conversation, reflection, { model, prompt, sourceHash }));
    done += 1;
    console.log(`[${done}/${todo.length}] ${conversation.title}`);
  } catch (error) {
    failures.push({ id: conversation.id, title: conversation.title, error: describeError(error) });
    console.warn(`  failed: ${conversation.title} - ${describeError(error)}`);
  }
});

console.log(`\nAnalyzed ${done} conversations${totalCost ? `, estimated cost ~$${totalCost.toFixed(4)}` : ''}.`);
if (failures.length) {
  console.log(`${failures.length} failed; re-run the same command to retry just those.`);
  process.exitCode = 1;
}
