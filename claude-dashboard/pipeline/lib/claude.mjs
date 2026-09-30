import Anthropic from '@anthropic-ai/sdk';

// USD per million tokens, from Anthropic's pricing table. Used only for the cost printout.
const PRICES = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10 }
};

// Models that must not receive a temperature (non-default sampling values return a 400).
const NO_SAMPLING = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']);
// Models that take the server-side refusal fallback (routes a declined request to another model).
const SERVER_FALLBACK = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']);

let client = null;

// Created lazily so loadEnv() has populated ANTHROPIC_API_KEY first.
// The SDK retries 408/409/429/5xx and connection errors with backoff.
function getClient() {
  client ??= new Anthropic({ maxRetries: 5 });
  return client;
}

// Sends one request constrained to a JSON schema and returns the parsed object.
export async function structuredJson({ model, system, user, schema, maxTokens = 4000, temperature }) {
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
  return error.message;
}
