// Step 1: read a Claude.ai data export (plus, optionally, Claude Design chats and local
// Claude Code sessions) and write one normalized conversation list to data/conversations.json.
// Plays the role of scrapeConversation() in the extension.
//
//   node pipeline/parse-export.mjs <conversations.json | unzipped export folder>
//        [--design <design_chats folder>]   default: a design_chats/ folder next to the export
//        [--claude-code] [--claude-code-dir <dir>]   default dir: ~/.claude/projects

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { PATHS, cleanText, parseArgs, readJson, writeJson } from './lib/common.mjs';
import { DEFAULT_CLAUDE_CODE_DIR, parseClaudeCodeSessions } from './lib/parse-claude-code.mjs';
import { parseDesignChats } from './lib/parse-design-chats.mjs';

const ATTACHMENT_SNIPPET_CHARS = 400;

const args = parseArgs(process.argv.slice(2), ['claude-code']);
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

const chats = raw
  .map(normalizeConversation)
  .filter((conversation) => conversation.messages.length > 0);
report('claude.ai chats', chats, raw.length - chats.length);

// Design chats sit in their own folder of the export (design_chats-000.zip, unzipped).
const designDir = args.design || [path.join(path.dirname(file), 'design_chats'), path.join(path.dirname(file), '..', 'design_chats')].find((dir) => existsSync(dir));
const designChats = parseDesignChats(designDir);
if (designDir) report('Claude Design chats', designChats);

const claudeCodeDir = args['claude-code-dir'] || (args['claude-code'] ? DEFAULT_CLAUDE_CODE_DIR : null);
const claudeCodeSessions = claudeCodeDir ? parseClaudeCodeSessions(claudeCodeDir) : [];
if (claudeCodeDir) report('Claude Code sessions', claudeCodeSessions);

const conversations = [...chats, ...designChats, ...claudeCodeSessions]
  .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

await writeJson(PATHS.conversations, {
  source: path.resolve(file),
  design_source: designDir ? path.resolve(designDir) : null,
  claude_code_source: claudeCodeDir ? path.resolve(claudeCodeDir) : null,
  parsed_at: new Date().toISOString(),
  conversations
});
console.log(`Wrote ${conversations.length} conversations to ${PATHS.conversations}`);

function report(label, list, skipped = 0) {
  const messages = list.reduce((sum, conversation) => sum + conversation.message_count, 0);
  console.log(`Parsed ${list.length} ${label} (${messages} messages${skipped ? `, ${skipped} empty skipped` : ''}).`);
}

function normalizeConversation(conversation) {
  const messages = (conversation?.chat_messages || [])
    .map(normalizeMessage)
    .filter((message) => message.content);

  return {
    id: cleanText(conversation?.uuid, `conv_${Math.random().toString(36).slice(2)}`),
    source: 'claude_ai',
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
      } else if (block?.type === 'voice_note' && block.text) {
        parts.push(`[voice note] ${block.text}`);
      } else if (block?.type === 'tool_use') {
        const title = cleanText(block.input?.title);
        parts.push(`[used tool: ${cleanText(block.name, 'tool')}${title ? ` - ${title}` : ''}]`);
      }
      // thinking, tool_result and injected_prompt_block are skipped: they are not part of the visible exchange.
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
