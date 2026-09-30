// Step 1: read a Claude.ai data export (plus, optionally, Claude Design chats and local
// Claude Code sessions) and write one normalized conversation list to data/conversations.json.
// Plays the role of scrapeConversation() in the extension.
//
//   node pipeline/parse-export.mjs <export folder | conversations-NNN folder | conversations.json>
//        [--design <design_chats folder>]   default: a design_chats/ folder in or next to the export
//        [--claude-code] [--claude-code-dir <dir>]   default dir: ~/.claude/projects
//
// Large exports come in parts (conversations-000.zip, conversations-001.zip, ...). Unzip each into
// export/conversations-NNN/ and pass export/ (or any one part): all parts are read and merged.

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { PATHS, cleanText, parseArgs, readJson, writeJson } from './lib/common.mjs';
import { DEFAULT_CLAUDE_CODE_DIR, parseClaudeCodeSessions } from './lib/parse-claude-code.mjs';
import { parseDesignChats } from './lib/parse-design-chats.mjs';

const ATTACHMENT_SNIPPET_CHARS = 400;

const args = parseArgs(process.argv.slice(2), ['claude-code']);
const input = args._[0];

if (!input) {
  console.error('Usage: node pipeline/parse-export.mjs <export folder | conversations-NNN folder | conversations.json>');
  process.exit(1);
}

const files = findConversationFiles(input);
if (!files.length) {
  console.error(`No conversations.json found in ${input}. Unzip conversations-000.zip into export/conversations-000/ and pass export/.`);
  process.exit(1);
}

// Merge all parts; if a chat appears in more than one part, keep its most recently updated copy.
const byId = new Map();
let rawCount = 0;
for (const file of files) {
  const raw = await readJson(file);
  if (!Array.isArray(raw)) {
    console.error(`${file} is not a Claude conversations export (expected a JSON array).`);
    process.exit(1);
  }
  rawCount += raw.length;
  raw.forEach((conversation, index) => {
    const key = conversation?.uuid || `${file}#${index}`;
    const previous = byId.get(key);
    if (!previous || String(conversation?.updated_at) > String(previous.updated_at)) byId.set(key, conversation);
  });
}
if (files.length > 1) console.log(`Read ${files.length} export parts (${rawCount} chats, ${rawCount - byId.size} duplicates across parts).`);

const chats = [...byId.values()]
  .map(normalizeConversation)
  .filter((conversation) => conversation.messages.length > 0);
report('claude.ai chats', chats, byId.size - chats.length);

// Design chats sit in their own folder of the export (design_chats-000.zip, unzipped).
const exportRoot = path.dirname(files[0]);
const designDir = args.design || [path.join(input, 'design_chats'), path.join(exportRoot, 'design_chats'), path.join(exportRoot, '..', 'design_chats')]
  .find((dir) => existsSync(dir) && statSync(dir).isDirectory());
const designChats = parseDesignChats(designDir);
if (designDir) report('Claude Design chats', designChats);

const claudeCodeDir = args['claude-code-dir'] || (args['claude-code'] ? DEFAULT_CLAUDE_CODE_DIR : null);
const claudeCodeSessions = claudeCodeDir ? parseClaudeCodeSessions(claudeCodeDir) : [];
if (claudeCodeDir) report('Claude Code sessions', claudeCodeSessions);

const conversations = [...chats, ...designChats, ...claudeCodeSessions]
  .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

await writeJson(PATHS.conversations, {
  source: files.map((file) => path.resolve(file)),
  design_source: designDir ? path.resolve(designDir) : null,
  claude_code_source: claudeCodeDir ? path.resolve(claudeCodeDir) : null,
  parsed_at: new Date().toISOString(),
  conversations
});
console.log(`Wrote ${conversations.length} conversations to ${PATHS.conversations}`);

// Accepts a conversations.json file, a folder holding one, or the export root holding
// conversations-NNN/ part folders. Pointing at one part also picks up its sibling parts.
function findConversationFiles(target) {
  if (!existsSync(target)) return [];
  if (!statSync(target).isDirectory()) return [target];
  const partsIn = (dir) => readdirSync(dir)
    .filter((name) => /^conversations-\d+$/.test(name))
    .sort()
    .map((name) => path.join(dir, name, 'conversations.json'))
    .filter((file) => existsSync(file));
  const direct = path.join(target, 'conversations.json');
  if (/^conversations-\d+$/.test(path.basename(path.resolve(target)))) {
    const siblings = partsIn(path.dirname(path.resolve(target)));
    return siblings.length ? siblings : (existsSync(direct) ? [direct] : []);
  }
  return [...(existsSync(direct) ? [direct] : []), ...partsIn(target)];
}

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
