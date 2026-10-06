import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA_DIR = process.env.MIRO_DATA_DIR ? path.resolve(process.env.MIRO_DATA_DIR) : path.join(ROOT, 'data');

export const PATHS = {
  root: ROOT,
  env: path.join(ROOT, '.env'),
  conversations: path.join(DATA_DIR, 'conversations.json'),
  sessionsDir: path.join(DATA_DIR, 'sessions'),
  synthesis: path.join(DATA_DIR, 'synthesis.json'),
  evalDir: path.join(DATA_DIR, 'eval'),
  siteData: path.join(ROOT, 'site', 'data.js')
};

// Same topic taxonomy as the Miro extension (background.js / content.js).
export const AREA_KEYS = ['research', 'writing', 'coding', 'design', 'studying', 'career', 'presenting', 'personal'];

// The dashboard dimensions. Definitions, what counts and examples are in lib/codebook.mjs (docs/codebook.md).
// 0 = AI side, 100 = your side.
export const DIMENSIONS = [
  { key: 'ideas', label: 'Coming up with ideas', question: 'Who came up with the ideas that were used?' },
  { key: 'direction', label: 'Deciding the direction', question: 'Who steered where the work went?' },
  { key: 'research', label: 'Bringing the information', question: 'Who brought the facts, sources and context?' },
  { key: 'building', label: 'Building the thing', question: 'Who made the draft, code or design?' },
  { key: 'problems', label: 'Catching problems', question: 'Who spotted what was wrong?' },
  { key: 'final_call', label: 'Making the final call', question: 'Who settled the decisions?' },
  { key: 'checking', label: 'Checking the answers', question: 'Did you question and test AI\'s answers, or take them as they were?' },
  { key: 'understanding', label: 'Working to understand', question: 'Did you ask to understand, or just for the answer?' }
];

// A dimension counts as having happened in a chat only with at least this many coded moments (or
// counted turns). One borderline moment flips too easily between runs to be read as a 0 or 100 split.
export const MIN_MOMENTS = 2;

// Counts as "happened" for the dashboard: v2 rows need MIN_MOMENTS; v1 rows have no counts.
export function countsAsInvolved(row) {
  return Boolean(row) && row.involved !== false && (!Number.isFinite(row.n) || row.n >= MIN_MOMENTS);
}

export const MARKER_KEYS = [
  'user_provided_material',
  'user_redirected_after_output',
  'user_critiqued_or_corrected',
  'user_made_final_selection',
  'ai_produced_first_pass'
];

export const OPENING_MODES = ['delegation', 'contextualized', 'critique', 'pastein', 'exploration'];
export const ARCS = ['draft_redirect_rebuild', 'ask_synthesize_decide', 'debug_test_fix', 'brainstorm_refine', 'explain_practice_check'];

// Reads KEY=VALUE lines from .env at the repo root without overriding real env vars.
export function loadEnv() {
  if (!existsSync(PATHS.env)) return;
  for (const line of readFileSync(PATHS.env, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trim().startsWith('#')) continue;
    const value = match[2].replace(/^["']|["']$/g, '');
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

export function parseArgs(argv, booleans = []) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const [key, inline] = arg.slice(2).split(/=(.*)/s);
    if (inline !== undefined) out[key] = inline;
    else if (booleans.includes(key)) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2));
}

export function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function cleanText(value, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

export function simpleHash(value) {
  let hash = 0;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
