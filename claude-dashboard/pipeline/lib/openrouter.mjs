const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_ATTEMPTS = 5;

// Sends one chat completion with a strict JSON schema and returns the parsed JSON.
// Retries rate limits and upstream failures with exponential backoff.
export async function chatJson({ apiKey, model, messages, schema, maxTokens = 2000, temperature = 0.25 }) {
  const body = JSON.stringify({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: 'json_schema', json_schema: schema },
    usage: { include: true }
  });

  let lastError = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(1000 * 2 ** attempt + Math.random() * 500);

    let response;
    try {
      response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'Miro Claude dashboard'
        },
        body
      });
    } catch (error) {
      lastError = error;
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      lastError = new Error(`OpenRouter ${response.status}: ${await response.text().catch(() => '')}`.slice(0, 300));
      continue;
    }

    if (!response.ok) {
      throw new Error(await describeError(response));
    }

    const data = await response.json();
    // OpenRouter can return 200 with an error object when the upstream provider fails.
    if (data?.error) {
      lastError = new Error(`OpenRouter upstream error: ${data.error.message || JSON.stringify(data.error)}`);
      continue;
    }

    const choice = data?.choices?.[0];
    try {
      return { json: parseJsonContent(choice?.message?.content), usage: data.usage || {} };
    } catch (error) {
      lastError = new Error(`Could not parse model output (finish_reason: ${choice?.finish_reason}): ${error.message}`);
    }
  }

  throw lastError || new Error('OpenRouter request failed.');
}

function parseJsonContent(content) {
  const text = Array.isArray(content)
    ? content.filter((part) => part?.type === 'text').map((part) => part.text).join('')
    : String(content || '');
  const unfenced = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('no JSON object in response');
    return JSON.parse(unfenced.slice(start, end + 1));
  }
}

async function describeError(response) {
  const text = await response.text().catch(() => '');
  let message = text;
  try {
    message = JSON.parse(text)?.error?.message || text;
  } catch {
    // Keep the raw text.
  }
  if (response.status === 401) return 'OpenRouter rejected the API key (401). Check OPENROUTER_API_KEY.';
  if (response.status === 402) return 'OpenRouter says the account is out of credits (402).';
  return `OpenRouter request failed (${response.status}): ${String(message).slice(0, 300)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
