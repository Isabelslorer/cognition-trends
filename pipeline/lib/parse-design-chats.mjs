// Reads Claude Design chats from the export's design_chats/ folder (one JSON file per chat)
// into the same normalized shape as the claude.ai export.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanText } from './common.mjs';
import { toolNote } from './parse-claude-code.mjs';

export function parseDesignChats(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => normalizeDesignChat(JSON.parse(readFileSync(path.join(dir, file), 'utf8'))))
    .filter((conversation) => conversation.messages.length);
}

function normalizeDesignChat(chat) {
  const messages = (chat?.messages || [])
    .map((message) => ({
      role: message?.role === 'assistant' ? 'assistant' : 'user',
      content: cleanText(message?.role === 'assistant' ? assistantText(message.content) : userText(message.content)),
      created_at: message?.created_at || message?.content?.timestamp || null
    }))
    .filter((message) => message.content)
    // The export sometimes stores the same message twice in a row.
    .filter((message, index, list) => index === 0 || message.role !== list[index - 1].role || message.content !== list[index - 1].content);

  const projectName = cleanText(chat?.project?.name);
  const chatTitle = cleanText(chat?.title);
  return {
    id: `design-${chat?.uuid}`,
    source: 'claude_design',
    title: projectName && chatTitle && chatTitle !== 'Chat' ? `${projectName}: ${chatTitle}` : (projectName || chatTitle || 'Design chat'),
    created_at: chat?.created_at || messages[0]?.created_at || null,
    updated_at: chat?.updated_at || chat?.created_at || null,
    message_count: messages.length,
    messages
  };
}

function userText(content) {
  const text = String(content?.content || '');
  if (content?.kind === 'direct-edit') {
    // The first line says what changed; the <mentioned-element> block is DOM detail.
    return `[user edited the design directly] ${text.split('\n')[0].replace(/^Apply a direct edit\.\s*/, '')}`;
  }
  const attachments = (content?.attachments || [])
    .filter((attachment) => !attachment?.hidden && attachment?.type !== 'skill')
    .map((attachment) => `[attached file: ${cleanText(attachment?.name, 'file')}]`);
  return [text, ...attachments].filter(Boolean).join('\n');
}

function assistantText(content) {
  if (content?.kind === 'question-record') {
    const spec = content.questionRecord?.spec;
    if (content.questionRecord?.event !== 'asked' || !spec) return '';
    const questions = (spec.questions || []).map((question) => cleanText(question?.title)).filter(Boolean);
    return `[asked the user questions: ${questions.join('; ')}]`;
  }
  const blocks = Array.isArray(content?.contentBlocks) ? content.contentBlocks : [];
  if (!blocks.length) return String(content?.content || '');
  const text = blocks.filter((block) => block?.type === 'text').map((block) => block.text).join('\n');
  const tools = blocks.filter((block) => block?.type === 'tool_call').map((block) => cleanText(block.toolCall?.name, 'tool'));
  return [text, toolNote(tools)].filter(Boolean).join('\n');
}
