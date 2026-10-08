// Deterministic text features computed without a model. They are a cheap, transparent baseline
// to sanity-check the model's coding against (for example, a chat where AI wrote 95% of the words
// should rarely score "you built it").

const PASTE_CHARS = 1500;

export function textFeatures(messages = []) {
  const user = messages.filter((message) => message.role === 'user');
  const ai = messages.filter((message) => message.role !== 'user');
  const words = (list) => list.reduce((sum, message) => sum + countWords(message.content), 0);
  const userWords = words(user);
  const aiWords = words(ai);
  const all = messages.map((message) => message.content || '').join('\n');

  return {
    messages: messages.length,
    user_turns: user.length,
    ai_turns: ai.length,
    user_words: userWords,
    ai_words: aiWords,
    user_word_share: userWords + aiWords ? round(userWords / (userWords + aiWords)) : null,
    mean_user_words: user.length ? Math.round(userWords / user.length) : 0,
    user_question_rate: user.length ? round(user.filter((message) => message.content.includes('?')).length / user.length) : 0,
    user_pastes: user.filter((message) => message.content.length > PASTE_CHARS || message.content.includes('[attached')).length,
    interruptions: count(all, /\[user interrupted AI\]/g),
    direct_edits: count(all, /\[user edited the design directly\]/g),
    tool_notes: count(all, /\[used tools?:/g)
  };
}

function countWords(text) {
  return (String(text || '').match(/\S+/g) || []).length;
}

function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
