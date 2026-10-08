// The one place the pipeline calls Claude. Two backends:
// - 'agent' (default): the Claude Agent SDK. Runs through the Claude account you are logged
//   into with Claude Code (`claude` then /login), so no API key is needed.
// - 'api': the Anthropic API SDK with ANTHROPIC_API_KEY from .env. Set CLAUDE_BACKEND=api.
// Both send the same system prompt, user message and JSON schema, so cached analyses stay
// valid when you switch.
import Anthropic from '@anthropic-ai/sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { cleanText } from './common.mjs';

// USD per million tokens, from Anthropic's pricing table. Used only for the cost printout.
const PRICES = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10 }
};

// Models that must not receive a temperature (non-default sampling values return a 400).
const NO_SAMPLING = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']);
// Models that take the server-side refusal fallback (routes a declined request to another model).
const SERVER_FALLBACK = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']);

export function backend() {
  return cleanText(process.env.CLAUDE_BACKEND, 'agent').toLowerCase() === 'api' ? 'api' : 'agent';
}

export function backendLabel() {
  return backend() === 'api' ? 'Anthropic API (ANTHROPIC_API_KEY)' : 'Claude Agent SDK (your Claude login)';
}

// The agent backend checks the login when the first request runs; the API backend needs a key.
export function canCallClaude() {
  return backend() === 'agent' || Boolean(cleanText(process.env.ANTHROPIC_API_KEY));
}

export function requireClaude() {
  if (canCallClaude()) return;
  console.error('CLAUDE_BACKEND=api needs ANTHROPIC_API_KEY in .env (see .env.example). Or remove CLAUDE_BACKEND to use your Claude login.');
  process.exit(1);
}

// Sends one request constrained to a JSON schema and returns the parsed object.
// `cost` is an API-price estimate; on the agent backend it counts against your plan's usage
// instead of being billed per token (unless your Claude Code login is itself an API key).
export function structuredJson(request) {
  return backend() === 'api' ? structuredJsonApi(request) : structuredJsonAgent(request);
}

// The agent backend has no temperature setting, so `temperature` and `maxTokens` apply to the
// API backend only.
async function structuredJsonAgent({ model, system, user, schema }) {
  // Without the key the Claude Code process uses your login, not .env's API key.
  const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ...env } = process.env;
  const options = {
    model,
    systemPrompt: system,
    outputFormat: { type: 'json_schema', schema },
    // A plain model call: no built-in tools, MCP servers, settings, hooks, CLAUDE.md or skills,
    // and no transcript saved under ~/.claude/projects (these are private chats).
    tools: [],
    mcpServers: {},
    strictMcpConfig: true,
    settingSources: [],
    persistSession: false,
    // The schema answer can take a retry; nothing else needs turns.
    maxTurns: 4,
    env: { ...env, CLAUDE_AGENT_SDK_CLIENT_APP: 'cognition-trends/1.0' }
  };

  let result = null;
  for await (const message of query({ prompt: user, options })) {
    if (message.type === 'result') result = message;
  }
  if (!result) throw new Error('Claude Agent SDK returned no result.');
  if (result.subtype !== 'success' || result.is_error) {
    const detail = cleanText([...(result.errors || []), result.result].filter(Boolean).join(' '), result.subtype);
    throw new Error(`Claude Agent SDK: ${detail}`);
  }

  let json = result.structured_output;
  if (json === undefined) json = JSON.parse(result.result);
  const usage = Object.values(result.modelUsage || {}).reduce((total, entry) => ({
    input_tokens: total.input_tokens + (entry.inputTokens || 0),
    output_tokens: total.output_tokens + (entry.outputTokens || 0),
    cache_read_input_tokens: total.cache_read_input_tokens + (entry.cacheReadInputTokens || 0),
    cache_creation_input_tokens: total.cache_creation_input_tokens + (entry.cacheCreationInputTokens || 0)
  }), { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  return { json, usage, cost: result.total_cost_usd || estimateCost(model, usage) };
}

let client = null;

// Created lazily so loadEnv() has populated ANTHROPIC_API_KEY first.
// The SDK retries 408/409/429/5xx and connection errors with backoff.
function getClient() {
  client ??= new Anthropic({ maxRetries: 5 });
  return client;
}

async function structuredJsonApi({ model, system, user, schema, maxTokens = 4000, temperature }) {
  const params = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema } }
  };
  if (temperature !== undefined && !NO_SAMPLING.has(model)) params.temperature = temperature;

  const response = SERVER_FALLBACK.has(model)
    ? await getClient().beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    : await getClient().messages.create(params);

  if (response.stop_reason === 'refusal') {
    throw new Error(`Model declined (${response.stop_details?.category || 'no category'}).`);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error(`Output hit max_tokens (${maxTokens}) before the JSON was complete.`);
  }

  const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
  return { json: JSON.parse(text), usage: response.usage, cost: estimateCost(response.model || model, response.usage) };
}

export function estimateCost(model, usage) {
  // Responses may name a dated snapshot (e.g. claude-haiku-4-5-2025...), so match by prefix.
  const price = Object.entries(PRICES).find(([id]) => String(model).startsWith(id))?.[1];
  if (!price || !usage) return 0;
  const input = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
  return (input * price.input + (usage.output_tokens || 0) * price.output) / 1e6;
}

export function describeError(error) {
  if (error instanceof Anthropic.AuthenticationError) return 'Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY in .env.';
  if (error instanceof Anthropic.PermissionDeniedError) return `Permission denied (403): ${error.message}`;
  if (error instanceof Anthropic.BadRequestError) return `Bad request (400): ${error.message}`;
  if (error instanceof Anthropic.RateLimitError) return 'Still rate limited after retries (429). Re-run with a lower --concurrency.';
  if (error instanceof Anthropic.APIError) return `Anthropic API error ${error.status ?? ''}: ${error.message}`;
  if (/log ?in|\/login|not authenticated|invalid api key/i.test(error.message)) {
    return `${error.message} — run \`claude\` in a terminal and log in with /login, or set CLAUDE_BACKEND=api with an ANTHROPIC_API_KEY.`;
  }
  return error.message;
}
