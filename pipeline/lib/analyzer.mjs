// Analyzes one conversation with a given prompt version and model. Shared by analyze.mjs
// (the real history) and eval/run-eval.mjs (benchmark scenarios), so both measure the same thing.

import { backend, structuredJson } from './claude.mjs';
import { simpleHash } from './common.mjs';
import { textFeatures } from './features.mjs';
import * as v1 from './prompts/v1.mjs';
import * as v2 from './prompts/v2.mjs';

export const PROMPTS = { v1, v2 };
export const DEFAULT_PROMPT = 'v2';

// Extra context in the per-chat message (not the shared system prompt, so a source change does not
// alter the prompt version).
export const SOURCE_CONTEXT = {
  claude_code: 'Source: Claude Code, a coding agent working directly in the user\'s files and terminal. [used tools: ...] lists the tools Claude ran in that turn; [ran /command] is a command the user ran; [user interrupted AI] means the user stopped Claude mid-turn.',
  claude_design: 'Source: Claude Design, a visual design tool where Claude builds designs. [user edited the design directly] means the user changed the design themselves; [asked the user questions: ...] means Claude asked before building.'
};

export function getPrompt(name = DEFAULT_PROMPT) {
  const prompt = PROMPTS[name];
  if (!prompt) throw new Error(`Unknown prompt "${name}". Use one of: ${Object.keys(PROMPTS).join(', ')}.`);
  return prompt;
}

export function buildRequests(conversation, prompt) {
  return prompt.requests(conversation, SOURCE_CONTEXT[conversation.source]);
}

// Re-analyze only when the chat's content, the model or the prompt/schema changed.
// v1 keeps its original formula so earlier cache entries stay valid.
export function contentHash(conversation, model, prompt) {
  const content = conversation.messages.map((message) => `${message.role}:${message.content}`).join('\n');
  return simpleHash(`${model}|${prompt.version}|${content}`);
}

export async function analyzeConversation(conversation, { model, prompt }) {
  const requests = buildRequests(conversation, prompt);
  const results = [];
  let cost = 0;
  for (const request of requests) {
    const { json, cost: requestCost } = await structuredJson({
      model,
      system: request.system,
      user: request.user,
      schema: prompt.schema,
      maxTokens: prompt.maxTokens,
      temperature: prompt.temperature
    });
    results.push(json);
    cost += requestCost;
  }
  const reflection = prompt.normalize(results, conversation, requests.map((request) => request.range || [1, conversation.messages.length]));
  return { reflection, cost, parts: requests.length };
}

// Same shape as the extension's buildDashboardSessionRecord(), plus the conversation date,
// the prompt version and the deterministic text features.
export function buildSessionRecord(conversation, reflection, { model, prompt, sourceHash }) {
  return {
    session_id: `session_${conversation.id}`,
    chat_key: conversation.id,
    source: conversation.source || 'claude_ai',
    title: conversation.title,
    created_at: conversation.created_at,
    analyzed_at: new Date().toISOString(),
    message_count: conversation.message_count,
    model,
    prompt_version: prompt.id,
    // 'api' runs at the prompt's temperature (0 for v2); 'agent' at the model's default.
    backend: backend(),
    source_hash: sourceHash,
    features: textFeatures(conversation.messages),
    ...reflection
  };
}

export async function runPool(items, size, worker) {
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
