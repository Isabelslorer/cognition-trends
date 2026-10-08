// Reads local Claude Code session transcripts (~/.claude/projects/<project>/<session>.jsonl)
// into the same normalized shape as the claude.ai export. Only what the user typed and
// what Claude said is kept; tool calls become short notes and raw tool output is dropped.
// Subagent transcripts (<session>/subagents/*.jsonl) are Claude talking to Claude and are skipped.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanText } from './common.mjs';

export const DEFAULT_CLAUDE_CODE_DIR = path.join(os.homedir(), '.claude', 'projects');

// User-role lines that the harness generated rather than the person.
const SKIP_PREFIXES = ['<task-notification>', '<local-command-caveat>', '<local-command-stdout>', '<local-command-stderr>', '<agent-message>', 'Caveat:'];

export function parseClaudeCodeSessions(dir = DEFAULT_CLAUDE_CODE_DIR) {
  if (!existsSync(dir)) return [];
  const conversations = [];
  for (const project of readdirSync(dir)) {
    const projectDir = path.join(dir, project);
    if (!statSync(projectDir).isDirectory()) continue;
    for (const file of readdirSync(projectDir)) {
      if (!file.endsWith('.jsonl')) continue;
      const conversation = parseSession(path.join(projectDir, file), project);
      if (conversation.messages.length) conversations.push(conversation);
    }
  }
  return conversations;
}

function parseSession(file, project) {
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(parseLine).filter(Boolean);
  const messages = [];
  let title = '';
  const timestamps = [];

  for (const line of lines) {
    if (line.timestamp) timestamps.push(line.timestamp);
    if (line.type === 'custom-title' && line.customTitle) title = line.customTitle;
    if (line.type === 'summary' && line.summary && !title) title = line.summary;
    if (line.isSidechain || line.isMeta || line.isCompactSummary || line.isApiErrorMessage) continue;

    if (line.type === 'user') {
      const text = userText(line.message?.content);
      if (text) push(messages, 'user', text, line.timestamp);
    } else if (line.type === 'assistant') {
      const { text, tools } = assistantParts(line.message?.content);
      if (text || tools.length) push(messages, 'assistant', text, line.timestamp, tools);
    }
  }

  for (const message of messages) {
    message.content = cleanText([message.content, toolNote(message.tools)].filter(Boolean).join('\n'));
    delete message.tools;
  }
  const kept = messages.filter((message) => message.content);
  timestamps.sort();

  return {
    id: `cc-${path.basename(file, '.jsonl')}`,
    source: 'claude_code',
    title: cleanText(title, firstLine(kept.find((message) => message.role === 'user')?.content) || 'Claude Code session'),
    project: projectName(project),
    created_at: timestamps[0] || null,
    updated_at: timestamps[timestamps.length - 1] || null,
    message_count: kept.length,
    messages: kept
  };
}

// Consecutive lines from the same side are one turn (assistant replies stream one block per line).
function push(messages, role, text, timestamp, tools = []) {
  const last = messages[messages.length - 1];
  if (last && last.role === role) {
    if (text) last.content = [last.content, text].filter(Boolean).join('\n');
    last.tools.push(...tools);
    return;
  }
  messages.push({ role, content: text || '', created_at: timestamp || null, tools: [...tools] });
}

function userText(content) {
  const parts = typeof content === 'string'
    ? [content]
    : (Array.isArray(content) ? content : []).flatMap((block) => {
        if (block?.type === 'text') return [block.text];
        if (block?.type === 'image') return ['[attached image]'];
        return []; // tool_result blocks are raw tool output
      });

  return parts.map((part) => {
    const text = String(part || '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
    if (!text || SKIP_PREFIXES.some((prefix) => text.startsWith(prefix))) return '';
    if (/^\[Request interrupted/.test(text)) return '[user interrupted AI]';
    const command = text.match(/<command-name>([^<]*)<\/command-name>/);
    if (command) {
      const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
      return `[ran ${command[1].trim()}${args ? ` ${args}` : ''}]`;
    }
    return text;
  }).filter(Boolean).join('\n');
}

function assistantParts(content) {
  const blocks = Array.isArray(content) ? content : [];
  const text = blocks.filter((block) => block?.type === 'text').map((block) => block.text).join('\n').trim();
  const tools = blocks.filter((block) => block?.type === 'tool_use').map((block) => cleanText(block.name, 'tool'));
  return { text, tools };
}

// "[used tools: Read ×3, Edit ×2, Bash]" keeps long tool runs short.
export function toolNote(tools) {
  if (!tools?.length) return '';
  const counts = new Map();
  for (const tool of tools) counts.set(tool, (counts.get(tool) || 0) + 1);
  return `[used tools: ${[...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)).join(', ')}]`;
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function firstLine(text) {
  return cleanText(String(text || '').split('\n')[0]).slice(0, 60);
}

// "C--Users-alex-Projects-my-app" -> "app" (the last dash-separated part of the folder name)
function projectName(folder) {
  const parts = folder.split('-').filter(Boolean);
  return parts[parts.length - 1] || folder;
}
