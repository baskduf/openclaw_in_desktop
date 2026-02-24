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
app.use(express.json({ limit: '10mb' }));

const CONFIG_DIR = path.resolve(__dirname, '../../../config');
const CONFIG_PATH = path.join(CONFIG_DIR, 'characters.json');
const CHARACTER_IMAGE_DIR = path.join(CONFIG_DIR, 'character-images');
const PORT = process.env.PORT || 4310;
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || 'openclaw';
const OPENCLAW_MODE = process.env.OPENCLAW_MODE || 'cli'; // cli | mock
const OPENCLAW_TIMEOUT_SEC = Number(process.env.OPENCLAW_TIMEOUT_SEC || 45);

/** @type {Map<string, Array<{role:'user'|'assistant', text:string, ts:number}>>} */
const historyStore = new Map();

function loadCharactersConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw || '{}');
}

function saveCharactersConfig(config) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

function loadCharacters() {
  return loadCharactersConfig().characters || [];
}

function findCharacter(characterId) {
  return loadCharacters().find((c) => c.id === characterId);
}

function sanitizeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function sanitizeAvatarScale(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number.isFinite(Number(fallback)) ? Number(fallback) : 1;
  const clamped = Math.max(0.6, Math.min(3, parsed));
  return Math.round(clamped * 10) / 10;
}

function ensureImageDir() {
  fs.mkdirSync(CHARACTER_IMAGE_DIR, { recursive: true });
}

function resolveCharacterImagePath(character) {
  const imagePath = sanitizeString(character?.imagePath);
  if (!imagePath) return null;

  const absolute = path.resolve(CONFIG_DIR, imagePath);
  if (!absolute.startsWith(CONFIG_DIR)) return null;
  return absolute;
}

function getCharacterImageMeta(character) {
  const absolutePath = resolveCharacterImagePath(character);
  if (!absolutePath) return null;
  if (!fs.existsSync(absolutePath)) return null;

  const stat = fs.statSync(absolutePath);
  return {
    absolutePath,
    mtimeMs: Number(stat.mtimeMs || Date.now()),
    ext: path.extname(absolutePath).toLowerCase(),
  };
}

function toPublicCharacter(character) {
  const { sessionKey, ...rest } = character;
  const imageMeta = getCharacterImageMeta(character);
  const avatarScale = sanitizeAvatarScale(character?.avatarScale, 1);
  return {
    ...rest,
    avatarScale,
    hasImage: Boolean(imageMeta),
    imageVersion: imageMeta ? imageMeta.mtimeMs : null,
  };
}

function mimeToExt(mime) {
  const normalized = sanitizeString(mime).toLowerCase();
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  return null;
}

function extToMime(ext) {
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'application/octet-stream';
}

function parseImageDataUrl(value) {
  const raw = sanitizeString(value);
  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;

  const mime = match[1].toLowerCase();
  const ext = mimeToExt(mime);
  if (!ext) return null;

  return {
    mime,
    ext,
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function pushHistory(characterId, role, text) {
  const items = historyStore.get(characterId) || [];
  items.push({ role, text, ts: Date.now() });
  historyStore.set(characterId, items);
}

async function sendViaCli(character, text) {
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
  const characters = loadCharacters().map((c) => toPublicCharacter(c));
  res.json({ characters });
});

app.put('/characters/:characterId', (req, res) => {
  const { characterId } = req.params;
  const config = loadCharactersConfig();
  const items = config.characters || [];
  const index = items.findIndex((c) => c.id === characterId);

  if (index < 0) {
    return res.status(404).json({ error: 'character_not_found' });
  }

  const body = req.body || {};
  const editableFields = ['name', 'emoji', 'sessionId', 'agentId', 'description'];
  const next = { ...items[index] };

  for (const field of editableFields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      next[field] = sanitizeString(body[field]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'avatarScale')) {
    next.avatarScale = sanitizeAvatarScale(body.avatarScale, next.avatarScale);
  }

  items[index] = next;
  config.characters = items;
  saveCharactersConfig(config);

  return res.json({ character: toPublicCharacter(next) });
});

app.post('/characters/:characterId/image', (req, res) => {
  const { characterId } = req.params;
  const config = loadCharactersConfig();
  const items = config.characters || [];
  const index = items.findIndex((c) => c.id === characterId);

  if (index < 0) {
    return res.status(404).json({ error: 'character_not_found' });
  }

  const payload = parseImageDataUrl(req.body?.imageDataUrl);
  if (!payload || !payload.buffer?.length) {
    return res.status(400).json({ error: 'invalid_image_data' });
  }

  ensureImageDir();

  const filename = `${characterId}.${payload.ext}`;
  const relativePath = path.posix.join('character-images', filename);
  const absolutePath = path.join(CHARACTER_IMAGE_DIR, filename);

  fs.writeFileSync(absolutePath, payload.buffer);

  const next = { ...items[index], imagePath: relativePath };
  items[index] = next;
  config.characters = items;
  saveCharactersConfig(config);

  return res.json({ character: toPublicCharacter(next) });
});

app.get('/characters/:characterId/image', (req, res) => {
  const { characterId } = req.params;
  const character = findCharacter(characterId);
  if (!character) return res.status(404).json({ error: 'character_not_found' });

  const meta = getCharacterImageMeta(character);
  if (!meta) {
    return res.status(404).json({ error: 'character_image_not_found' });
  }

  res.setHeader('Cache-Control', 'no-cache');
  res.type(extToMime(meta.ext));
  return res.sendFile(meta.absolutePath);
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
