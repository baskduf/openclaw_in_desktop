import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

const app = express();
app.use(cors());
app.use(express.json());

const CONFIG_PATH = path.resolve(__dirname, '../../../config/characters.json');
const PORT = process.env.PORT || 4310;
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || 'openclaw';
const OPENCLAW_MODE = process.env.OPENCLAW_MODE || 'mock'; // mock | cli
const OPENCLAW_TIMEOUT_SEC = Number(process.env.OPENCLAW_TIMEOUT_SEC || 45);

/** @type {Map<string, Array<{role:'user'|'assistant', text:string, ts:number}>>} */
const historyStore = new Map();

function loadCharacters() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const json = JSON.parse(raw);
  return json.characters || [];
}

function findCharacter(characterId) {
  return loadCharacters().find((c) => c.id === characterId);
}

function pushHistory(characterId, role, text) {
  const items = historyStore.get(characterId) || [];
  items.push({ role, text, ts: Date.now() });
  historyStore.set(characterId, items);
}

async function sendViaCli(character, text) {
  // sessionId 지정이 가장 안정적. 없으면 agentId fallback.
  const args = ['agent', '--json', '--timeout', String(OPENCLAW_TIMEOUT_SEC), '--message', text];

  if (character.sessionId) {
    args.push('--session-id', String(character.sessionId));
  } else if (character.agentId) {
    args.push('--agent', String(character.agentId));
  } else {
    throw new Error(`character '${character.id}' missing sessionId/agentId for cli mode`);
  }

  const { stdout, stderr } = await execFileAsync(OPENCLAW_BIN, args, {
    timeout: (OPENCLAW_TIMEOUT_SEC + 5) * 1000,
    maxBuffer: 1024 * 1024,
  });

  let parsed;
  try {
    parsed = JSON.parse(stdout || '{}');
  } catch {
    throw new Error(`invalid_openclaw_json: ${stdout || stderr || 'empty output'}`);
  }

  const reply =
    parsed?.reply ??
    parsed?.result?.reply ??
    parsed?.result?.text ??
    parsed?.result?.payloads?.find?.((p) => typeof p?.text === 'string')?.text;

  if (!reply) {
    throw new Error(`no_reply_from_openclaw: ${stdout || stderr || 'unknown'}`);
  }

  return String(reply);
}

async function sendToSession(character, text) {
  if (OPENCLAW_MODE === 'mock') {
    return `(${character.name}) ${text} 요청 받았어. 현재는 mock 모드야. OPENCLAW_MODE=cli 로 바꾸면 실제 세션 호출해.`;
  }

  if (OPENCLAW_MODE === 'cli') {
    return sendViaCli(character, text);
  }

  throw new Error(`unsupported OPENCLAW_MODE: ${OPENCLAW_MODE}`);
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, mode: OPENCLAW_MODE });
});

app.get('/characters', (_req, res) => {
  const characters = loadCharacters().map(({ sessionKey, ...rest }) => rest);
  res.json({ characters });
});

app.get('/chat/history/:characterId', (req, res) => {
  const { characterId } = req.params;
  const character = findCharacter(characterId);
  if (!character) return res.status(404).json({ error: 'character_not_found' });
  res.json({ items: historyStore.get(characterId) || [] });
});

app.post('/chat/send', async (req, res) => {
  const { characterId, text } = req.body || {};
  if (!characterId || !text) {
    return res.status(400).json({ error: 'characterId_and_text_required' });
  }

  const character = findCharacter(characterId);
  if (!character) return res.status(404).json({ error: 'character_not_found' });

  pushHistory(characterId, 'user', text);

  try {
    const reply = await sendToSession(character, text);
    pushHistory(characterId, 'assistant', reply);
    return res.json({ reply, characterId });
  } catch (error) {
    return res.status(500).json({
      error: 'session_send_failed',
      message: String(error?.message || error),
      mode: OPENCLAW_MODE,
    });
  }
});

app.listen(PORT, () => {
  console.log(`[gateway] listening on :${PORT} (mode=${OPENCLAW_MODE})`);
});
