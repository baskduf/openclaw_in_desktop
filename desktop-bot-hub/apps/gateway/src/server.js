import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const CONFIG_PATH = path.resolve(__dirname, '../../../config/characters.json');
const PORT = process.env.PORT || 4310;

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

async function sendToSession(character, text) {
  // TODO: 실제 OpenClaw session API 연동
  // 예: POST /sessions/send with { sessionKey: character.sessionKey, message: text }
  // 현재는 MVP mock 응답
  return `(${character.name}) ${text} 요청 받았어. 실제 세션 연동은 다음 단계에서 연결할게.`;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
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

  const items = historyStore.get(characterId) || [];
  items.push({ role: 'user', text, ts: Date.now() });

  try {
    const reply = await sendToSession(character, text);
    items.push({ role: 'assistant', text: reply, ts: Date.now() });
    historyStore.set(characterId, items);
    return res.json({ reply, characterId });
  } catch (error) {
    return res.status(500).json({ error: 'session_send_failed', message: String(error?.message || error) });
  }
});

app.listen(PORT, () => {
  console.log(`[gateway] listening on :${PORT}`);
});
