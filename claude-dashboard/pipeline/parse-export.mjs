// Step 1: read a Claude.ai data export and write a normalized conversation list
// to data/conversations.json. Plays the role of scrapeConversation() in the extension.
//
//   node pipeline/parse-export.mjs <path to conversations.json or the unzipped export folder>

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { PATHS, cleanText, parseArgs, readJson, writeJson } from './lib/common.mjs';

const ATTACHMENT_SNIPPET_CHARS = 400;

const args = parseArgs(process.argv.slice(2));
const input = args._[0];

if (!input) {
  console.error('Usage: node pipeline/parse-export.mjs <conversations.json | unzipped export folder>');
  process.exit(1);
}

const file = existsSync(input) && statSync(input).isDirectory() ? path.join(input, 'conversations.json') : input;
if (!existsSync(file)) {
  console.error(`Could not find ${file}. Unzip the Claude export first and point at conversations.json.`);
  process.exit(1);
}

const raw = await readJson(file);
if (!Array.isArray(raw)) {
  console.error(`${file} is not a Claude conversations export (expected a JSON array).`);
  process.exit(1);
}

const conversations = raw
  .map(normalizeConversation)
  .filter((conversation) => conversation.messages.length > 0)
  .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

await writeJson(PATHS.conversations, {
  source: path.resolve(file),
  parsed_at: new Date().toISOString(),
  conversations
});

const messageTotal = conversations.reduce((sum, conversation) => sum + conversation.message_count, 0);
console.log(`Parsed ${conversations.length} conversations (${messageTotal} messages, ${raw.length - conversations.length} empty skipped).`);
console.log(`Wrote ${PATHS.conversations}`);

function normalizeConversation(conversation) {
  const messages = (conversation?.chat_messages || [])
    .map(normalizeMessage)
    .filter((message) => message.content);

  return {
    id: cleanText(conversation?.uuid, `conv_${Math.random().toString(36).slice(2)}`),
    title: cleanText(conversation?.name, 'Untitled chat'),
    created_at: conversation?.created_at || messages[0]?.created_at || null,
    updated_at: conversation?.updated_at || conversation?.created_at || null,
    message_count: messages.length,
    messages
  };
}

function normalizeMessage(message) {
  const role = message?.sender === 'assistant' ? 'assistant' : 'user';
  const parts = [];

  if (Array.isArray(message?.content) && message.content.length) {
    for (const block of message.content) {
      if (block?.type === 'text' && block.text) {
        parts.push(block.text);
      } else if (block?.type === 'tool_use') {
        const title = cleanText(block.input?.title);
        parts.push(`[used tool: ${cleanText(block.name, 'tool')}${title ? ` - ${title}` : ''}]`);
      }
      // thinking and tool_result blocks are skipped: they are not part of the visible exchange.
    }
  } else if (message?.text) {
    parts.push(message.text);
  }

  const attachments = new Map();
  for (const item of [...(message?.attachments || []), ...(message?.files || [])]) {
    const name = cleanText(item?.file_name);
    if (name && !attachments.has(name)) attachments.set(name, cleanText(item?.extracted_content));
  }
  for (const [name, extracted] of attachments) {
    parts.push(extracted
      ? `[attached ${name}: ${extracted.slice(0, ATTACHMENT_SNIPPET_CHARS)}${extracted.length > ATTACHMENT_SNIPPET_CHARS ? '...' : ''}]`
      : `[attached file: ${name}]`);
  }

  return {
    role,
    content: cleanText(parts.join('\n')),
    created_at: message?.created_at || null
  };
}
