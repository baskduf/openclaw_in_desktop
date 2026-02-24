import { useEffect, useMemo, useRef, useState } from 'react'
import { core } from '@tauri-apps/api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './App.css'

function resolveApiBase(raw) {
  const fallback = 'http://127.0.0.1:4310'
  const value = String(raw || '').trim()
  if (!value) return fallback

  const withProtocol = /^https?:\/\//i.test(value) ? value : `http://${value}`
  try {
    return new URL(withProtocol).toString().replace(/\/$/, '')
  } catch {
    return fallback
  }
}

const API_BASE = resolveApiBase(import.meta.env.VITE_GATEWAY_BASE_URL)
const API_BASE_NORMALIZED = API_BASE.replace(/\/$/, '')
const POSITION_KEY_PREFIX = 'openclaw-desktop-char-pos'
const ACTIVE_CHARACTER_KEY = 'openclaw-desktop-active-character'
const PREVIEW_KEY_PREFIX = 'openclaw-desktop-reply-preview'
const CHARACTERS_VERSION_KEY = 'openclaw-desktop-characters-version'
const CHARACTER_PATCH_KEY = 'openclaw-desktop-character-patch'
const PREVIEW_DURATION_MS = 6000
const PREVIEW_MAX_LENGTH = 48
const DEFAULT_CHARACTER_SCALE = 1
const MIN_CHARACTER_SCALE = 0.6
const MAX_CHARACTER_SCALE = 3
const BASE_EMOJI_SIZE = 86
const BASE_EMOJI_FONT_SIZE = 34
const BASE_IMAGE_MAX_WIDTH = 320
const BASE_IMAGE_MAX_HEIGHT = 220
const CHARACTER_WINDOW_PADDING_X = 32
const CHARACTER_WINDOW_PADDING_Y = 22
const CHARACTER_PREVIEW_HEADROOM = 44
const CHARACTER_PREVIEW_SIDE_PADDING = 12
const MIN_CHARACTER_WINDOW_SIZE = { width: 220, height: 180 }
const DEFAULT_CHARACTER_WINDOW_SIZE = {
  width: BASE_IMAGE_MAX_WIDTH + CHARACTER_WINDOW_PADDING_X,
  height: BASE_IMAGE_MAX_HEIGHT + CHARACTER_WINDOW_PADDING_Y + CHARACTER_PREVIEW_HEADROOM,
}
const CHARACTER_WINDOW_LABEL = 'character'
const BUBBLE_WINDOW_LABEL = 'bubble'

function getQueryParam(name) {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(name)
}

function isBubbleMode() {
  return getQueryParam('mode') === 'bubble'
}

function getWindowLabel() {
  return getQueryParam('label') || CHARACTER_WINDOW_LABEL
}

function getWindowCharacterId() {
  return getQueryParam('characterId')
}

function getWindowBubbleLabel() {
  return getQueryParam('bubbleLabel') || BUBBLE_WINDOW_LABEL
}

function getWindowIndex() {
  const raw = getQueryParam('index')
  const parsed = Number(raw || '0')
  return Number.isFinite(parsed) ? parsed : 0
}

const BUBBLE_MODE = isBubbleMode()
const WINDOW_LABEL = getWindowLabel()
const WINDOW_CHARACTER_ID = getWindowCharacterId()
const WINDOW_BUBBLE_LABEL = getWindowBubbleLabel()
const WINDOW_INDEX = getWindowIndex()

function canUseTauri() {
  return (
    typeof window !== 'undefined' &&
    (window.__TAURI__ != null || window.__TAURI_INTERNALS__ != null)
  )
}

function positionKey(label) {
  return `${POSITION_KEY_PREFIX}:${label}`
}

function previewKey(characterId) {
  return `${PREVIEW_KEY_PREFIX}:${characterId}`
}

function toPreviewText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= PREVIEW_MAX_LENGTH) return normalized
  return `${normalized.slice(0, PREVIEW_MAX_LENGTH - 3)}...`
}

function buildCharacterImageUrl(character, fallbackVersion = Date.now()) {
  if (!character?.id) return ''
  const hasImage = Boolean(character.hasImage || character.imagePath)
  if (!hasImage) return ''

  const version = character.imageVersion ?? fallbackVersion
  return `${API_BASE_NORMALIZED}/characters/${encodeURIComponent(character.id)}/image?v=${version}`
}

function apiUrl(pathname) {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  return `${API_BASE_NORMALIZED}${path}`
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('image_read_failed'))
    reader.readAsDataURL(file)
  })
}

function toFiniteNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeCharacterScale(value) {
  const parsed = toFiniteNumber(value, DEFAULT_CHARACTER_SCALE)
  return Math.max(MIN_CHARACTER_SCALE, Math.min(MAX_CHARACTER_SCALE, parsed))
}

function getCharacterScale(character) {
  return normalizeCharacterScale(character?.avatarScale)
}

function getCharacterWindowSize(character) {
  const scale = getCharacterScale(character)
  const hasImage = Boolean(character?.imageUrl || character?.hasImage || character?.imagePath)

  if (hasImage) {
    const imageWidth = BASE_IMAGE_MAX_WIDTH * scale
    const imageHeight = BASE_IMAGE_MAX_HEIGHT * scale
    const previewWidth = Math.max(160, imageWidth + 30)
    return {
      width: Math.max(
        MIN_CHARACTER_WINDOW_SIZE.width,
        Math.round(Math.max(imageWidth + CHARACTER_WINDOW_PADDING_X, previewWidth + CHARACTER_PREVIEW_SIDE_PADDING)),
      ),
      height: Math.max(
        MIN_CHARACTER_WINDOW_SIZE.height,
        Math.round(imageHeight + CHARACTER_WINDOW_PADDING_Y + CHARACTER_PREVIEW_HEADROOM),
      ),
    }
  }

  const launcherSize = BASE_EMOJI_SIZE * scale
  const previewWidth = Math.max(160, launcherSize * 2.1)
  return {
    width: Math.max(
      MIN_CHARACTER_WINDOW_SIZE.width,
      Math.round(
        Math.max(
          launcherSize + CHARACTER_WINDOW_PADDING_X + 26,
          previewWidth + CHARACTER_PREVIEW_SIDE_PADDING,
        ),
      ),
    ),
    height: Math.max(
      MIN_CHARACTER_WINDOW_SIZE.height,
      Math.round(launcherSize + CHARACTER_WINDOW_PADDING_Y + 26 + CHARACTER_PREVIEW_HEADROOM),
    ),
  }
}

function getLauncherStyle(character) {
  const scale = getCharacterScale(character)
  const hasImage = Boolean(character?.imageUrl)

  if (hasImage) {
    const maxWidth = Math.round(BASE_IMAGE_MAX_WIDTH * scale)
    const maxHeight = Math.round(BASE_IMAGE_MAX_HEIGHT * scale)
    return {
      '--launcher-image-max-width': `${maxWidth}px`,
      '--launcher-image-max-height': `${maxHeight}px`,
      '--preview-max-width': `${Math.max(160, maxWidth + 30)}px`,
      '--preview-anchor-height': `${maxHeight}px`,
      '--preview-gap': '10px',
    }
  }

  const launcherSize = Math.round(BASE_EMOJI_SIZE * scale)
  const fontSize = Math.round(BASE_EMOJI_FONT_SIZE * scale)
  return {
    '--launcher-size': `${launcherSize}px`,
    '--launcher-font-size': `${fontSize}px`,
    '--preview-max-width': `${Math.max(160, Math.round(launcherSize * 2.1))}px`,
    '--preview-anchor-height': `${launcherSize}px`,
    '--preview-gap': '10px',
  }
}

function getBubbleAnchorSize(character) {
  const scale = getCharacterScale(character)
  if (character?.imageUrl) {
    return {
      width: Math.max(24, Math.round(BASE_IMAGE_MAX_WIDTH * scale)),
      height: Math.max(24, Math.round(BASE_IMAGE_MAX_HEIGHT * scale)),
    }
  }

  const size = Math.max(24, Math.round(BASE_EMOJI_SIZE * scale))
  return { width: size, height: size }
}

function loadStoredPosition(label, index, windowSize = DEFAULT_CHARACTER_WINDOW_SIZE) {
  if (typeof window === 'undefined') return { x: 260, y: 520 }

  const fallback = {
    x: 260,
    y: 520 + index * (windowSize.height + 12),
  }

  const stored = window.localStorage?.getItem(positionKey(label))
  if (!stored) return fallback

  try {
    const parsed = JSON.parse(stored)
    if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
      return { x: parsed.x, y: parsed.y }
    }
  } catch {
    // ignore invalid cache
  }

  return fallback
}

function clampPosition(pos, windowSize = DEFAULT_CHARACTER_WINDOW_SIZE) {
  if (typeof window === 'undefined') return pos

  const margin = 12
  const screenWidth = window.screen?.availWidth || window.innerWidth || 640
  const screenHeight = window.screen?.availHeight || window.innerHeight || 480
  const maxX = Math.max(0, screenWidth - windowSize.width - margin)
  const maxY = Math.max(0, screenHeight - windowSize.height - margin)

  return {
    x: Math.max(margin, Math.min(pos.x, maxX)),
    y: Math.max(margin, Math.min(pos.y, maxY)),
  }
}

function loadStoredCharacterId() {
  if (typeof window === 'undefined') return null
  return window.localStorage?.getItem(ACTIVE_CHARACTER_KEY) || null
}

async function safeInvoke(name, payload) {
  if (!canUseTauri()) return

  try {
    await core.invoke(name, payload)
  } catch {
    // ignore tauri command failures in non-ready states
  }
}

function ChatPanel({
  activeCharacter,
  messages,
  error,
  input,
  setInput,
  sendMessage,
  loading,
  pendingReply,
  onOpenSettings,
  onClose,
  panelClass,
}) {
  const markdownComponents = {
    a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
  }

  return (
    <div className={`chat-bubble-panel ${panelClass || ''}`}>
      <div className="panel-header">
        <strong>{activeCharacter?.name || 'Bot'}</strong>
        <div className="panel-header-actions">
          {onOpenSettings && (
            <button className="ghost" onClick={onOpenSettings} title="캐릭터 설정">
              ⚙
            </button>
          )}
          <button className="ghost" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      <div className="messages">
        {messages.map((m, idx) => (
          <div key={`${m.ts || idx}-${idx}`} className={`msg ${m.role}`}>
            <div className="msg-text markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {String(m.text || '')}
              </ReactMarkdown>
            </div>
          </div>
        ))}

        {pendingReply && (
          <div className="msg assistant pending">
            <div className="msg-text">...</div>
          </div>
        )}

        {messages.length === 0 && !pendingReply && <div className="empty">대화가 없습니다.</div>}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="input-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="메시지 입력"
        />
        <button onClick={sendMessage} disabled={loading}>
          {loading ? '...' : '전송'}
        </button>
      </div>
    </div>
  )
}

function SettingsModal({
  open,
  onClose,
  draft,
  onChange,
  onSave,
  saving,
  onUploadImage,
  uploadingImage,
  imageUrl,
}) {
  if (!open) return null

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <strong>캐릭터 설정</strong>
          <button className="ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="settings-body">
          <label className="settings-field">
            <span>이름</span>
            <input value={draft.name} onChange={(e) => onChange('name', e.target.value)} />
          </label>

          <label className="settings-field">
            <span>설명</span>
            <input
              value={draft.description}
              onChange={(e) => onChange('description', e.target.value)}
            />
          </label>

          <label className="settings-field">
            <span>이모지</span>
            <input value={draft.emoji} onChange={(e) => onChange('emoji', e.target.value)} />
          </label>

          <label className="settings-field">
            <span>세션 ID</span>
            <input value={draft.sessionId} onChange={(e) => onChange('sessionId', e.target.value)} />
          </label>

          <label className="settings-field">
            <span>에이전트 ID</span>
            <input value={draft.agentId} onChange={(e) => onChange('agentId', e.target.value)} />
          </label>

          <label className="settings-field">
            <span>캐릭터 크기 배율 (0.6 - 3.0)</span>
            <input
              type="number"
              min={MIN_CHARACTER_SCALE}
              max={MAX_CHARACTER_SCALE}
              step="0.1"
              value={draft.avatarScale}
              onChange={(e) => onChange('avatarScale', e.target.value)}
            />
          </label>

          <label className="settings-field">
            <span>캐릭터 이미지</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) {
                  void onUploadImage(file)
                }
                e.target.value = ''
              }}
              disabled={uploadingImage}
            />
          </label>

          {imageUrl && (
            <div className="settings-image-preview-wrap">
              <img className="settings-image-preview" src={imageUrl} alt="character" />
            </div>
          )}
        </div>

        <div className="settings-actions">
          <button className="ghost" onClick={onClose}>
            취소
          </button>
          <button onClick={onSave} disabled={saving || uploadingImage}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

function App() {
  const isBubble = BUBBLE_MODE
  const [characters, setCharacters] = useState([])
  const [activeCharacterId, setActiveCharacterId] = useState(
    () => WINDOW_CHARACTER_ID || loadStoredCharacterId(),
  )
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingReply, setPendingReply] = useState(false)
  const [error, setError] = useState('')
  const [previewText, setPreviewText] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState({
    name: '',
    description: '',
    emoji: '',
    sessionId: '',
    agentId: '',
    avatarScale: String(DEFAULT_CHARACTER_SCALE),
  })
  const [, setPosition] = useState(() =>
    clampPosition(
      loadStoredPosition(WINDOW_LABEL, WINDOW_INDEX, DEFAULT_CHARACTER_WINDOW_SIZE),
      DEFAULT_CHARACTER_WINDOW_SIZE,
    ),
  )
  const previewTimerRef = useRef(null)
  const dragState = useRef({ active: false, moved: false, pointerId: null, startX: 0, startY: 0 })

  const activeCharacter = useMemo(
    () => characters.find((c) => c.id === activeCharacterId),
    [characters, activeCharacterId],
  )
  const windowCharacter = useMemo(() => {
    if (WINDOW_CHARACTER_ID) {
      return characters.find((c) => c.id === WINDOW_CHARACTER_ID) || null
    }
    return activeCharacter || null
  }, [characters, activeCharacter])
  const currentWindowSize = useMemo(
    () => getCharacterWindowSize(windowCharacter),
    [windowCharacter],
  )
  const launcherStyle = useMemo(() => getLauncherStyle(activeCharacter), [activeCharacter])

  useEffect(() => {
    void loadCharacters()
  }, [])

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key !== CHARACTERS_VERSION_KEY || !event.newValue) return
      void loadCharacters()
    }
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  useEffect(() => {
    const applyPatchPayload = (raw) => {
      if (!raw) return
      try {
        const payload = JSON.parse(raw)
        applyCharacterUpdate(payload?.character || {}, {
          forceHasImage: Boolean(payload?.forceHasImage),
        })
      } catch {
        // ignore invalid payload
      }
    }

    const latest = window.localStorage?.getItem(CHARACTER_PATCH_KEY)
    if (latest) {
      applyPatchPayload(latest)
    }

    const handleStorage = (event) => {
      if (event.key !== CHARACTER_PATCH_KEY || !event.newValue) return
      applyPatchPayload(event.newValue)
    }

    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  useEffect(() => {
    if (isBubble) return

    void safeInvoke('set_window_size', {
      label: WINDOW_LABEL,
      width: currentWindowSize.width,
      height: currentWindowSize.height,
    })
    const clamped = clampPosition(
      loadStoredPosition(WINDOW_LABEL, WINDOW_INDEX, currentWindowSize),
      currentWindowSize,
    )
    setPosition(clamped)
    window.localStorage?.setItem(positionKey(WINDOW_LABEL), JSON.stringify(clamped))
    void safeInvoke('move_window', { label: WINDOW_LABEL, x: clamped.x, y: clamped.y })
  }, [isBubble, currentWindowSize.height, currentWindowSize.width])

  useEffect(() => {
    if (!isBubble) return
    if (WINDOW_CHARACTER_ID) return

    const handleStorage = (event) => {
      if (event.key !== ACTIVE_CHARACTER_KEY) return
      if (!event.newValue) return
      setActiveCharacterId((prev) => (prev === event.newValue ? prev : event.newValue))
    }
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('storage', handleStorage)
    }
  }, [isBubble])

  useEffect(() => {
    if (isBubble) return

    const currentCharacterId = WINDOW_CHARACTER_ID || activeCharacterId
    if (!currentCharacterId) return

    const key = previewKey(currentCharacterId)

    const showPreview = (text, ts) => {
      const normalized = toPreviewText(text)
      if (!normalized || typeof ts !== 'number') return

      const age = Date.now() - ts
      if (age >= PREVIEW_DURATION_MS) return

      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current)
      }

      setPreviewText(normalized)
      previewTimerRef.current = window.setTimeout(() => {
        setPreviewText('')
      }, PREVIEW_DURATION_MS - age)
    }

    const applyPayload = (raw) => {
      try {
        const payload = JSON.parse(raw)
        showPreview(payload?.text, payload?.ts)
      } catch {
        // ignore invalid payload
      }
    }

    const existing = window.localStorage?.getItem(key)
    if (existing) {
      applyPayload(existing)
    }

    const handleStorage = (event) => {
      if (event.key !== key || !event.newValue) return
      applyPayload(event.newValue)
    }

    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('storage', handleStorage)
      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current)
        previewTimerRef.current = null
      }
    }
  }, [isBubble, activeCharacterId])

  useEffect(() => {
    if (!isBubble || !activeCharacterId) return
    void loadHistory(activeCharacterId)
  }, [isBubble, activeCharacterId])

  useEffect(() => {
    if (isBubble) return
    if (WINDOW_LABEL !== CHARACTER_WINDOW_LABEL) return
    if (WINDOW_CHARACTER_ID) return
    if (!activeCharacterId) return
    if (characters.length === 0) return

    const ids = characters.map((c) => c.id)
    void safeInvoke('sync_character_windows', {
      characterIds: ids,
      primaryCharacterId: activeCharacterId,
    })
  }, [isBubble, activeCharacterId, characters])

  function notifyCharactersUpdated() {
    window.localStorage?.setItem(CHARACTERS_VERSION_KEY, String(Date.now()))
  }

  function broadcastCharacterPatch(character, forceHasImage = false) {
    window.localStorage?.setItem(
      CHARACTER_PATCH_KEY,
      JSON.stringify({
        ts: Date.now(),
        forceHasImage,
        character,
      }),
    )
  }

  function applyCharacterUpdate(updatedCharacter, { forceHasImage = false } = {}) {
    if (!updatedCharacter?.id) return
    const stamp = Date.now()
    const patched = {
      ...updatedCharacter,
      hasImage: forceHasImage ? true : updatedCharacter.hasImage,
      imageVersion: updatedCharacter.imageVersion ?? stamp,
    }

    setCharacters((prev) =>
      prev.map((item) =>
        item.id === patched.id
          ? {
              ...item,
              ...patched,
              imageUrl: buildCharacterImageUrl(patched, stamp),
            }
          : item,
      ),
    )
  }

  function publishReplyPreview(characterId, reply) {
    const text = toPreviewText(reply)
    if (!characterId || !text) return

    const payload = JSON.stringify({ text, ts: Date.now() })
    window.localStorage?.setItem(previewKey(characterId), payload)
  }

  function hydrateCharacters(items) {
    const stamp = Date.now()
    return (items || []).map((character) => ({
      ...character,
      imageUrl: buildCharacterImageUrl(character, stamp),
    }))
  }

  async function loadCharacters() {
    setError('')
    try {
      const res = await fetch(apiUrl('/characters'))
      const data = await res.json()
      const nextCharacters = hydrateCharacters(data.characters || [])
      setCharacters(nextCharacters)

      if (nextCharacters.length === 0) return

      const stored = loadStoredCharacterId()
      const fallback = nextCharacters[0].id
      const selectedFromWindow =
        WINDOW_CHARACTER_ID && nextCharacters.some((c) => c.id === WINDOW_CHARACTER_ID)
          ? WINDOW_CHARACTER_ID
          : null

      setActiveCharacterId((prev) => {
        if (selectedFromWindow) return selectedFromWindow
        if (nextCharacters.some((c) => c.id === prev)) return prev
        if (nextCharacters.some((c) => c.id === stored)) return stored
        return fallback
      })
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  async function loadHistory(characterId) {
    setError('')
    try {
      const res = await fetch(apiUrl(`/chat/history/${encodeURIComponent(characterId)}`))
      const data = await res.json()
      const items = data.items || []
      setMessages(items)
      return items
    } catch (e) {
      setError(String(e.message || e))
      return []
    }
  }

  async function sendMessage() {
    const text = input.trim()
    if (!text || !activeCharacterId || loading) return

    const userMessage = { role: 'user', text, ts: Date.now() }

    setMessages((prev) => [...prev, userMessage])
    setPendingReply(true)
    setLoading(true)
    setError('')
    setInput('')

    try {
      const res = await fetch(apiUrl('/chat/send'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: activeCharacterId, text }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message || data?.error || 'send failed')

      const reply = String(data?.reply || '').trim()
      if (reply) {
        setMessages((prev) => [...prev, { role: 'assistant', text: reply, ts: Date.now() }])
        publishReplyPreview(activeCharacterId, reply)
      } else {
        const items = await loadHistory(activeCharacterId)
        const latestAssistant = [...items].reverse().find((item) => item.role === 'assistant')
        if (latestAssistant?.text) {
          publishReplyPreview(activeCharacterId, latestAssistant.text)
        }
      }
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setPendingReply(false)
      setLoading(false)
    }
  }

  function openSettings() {
    if (!activeCharacter) return

    setSettingsDraft({
      name: activeCharacter.name || '',
      description: activeCharacter.description || '',
      emoji: activeCharacter.emoji || '',
      sessionId: activeCharacter.sessionId || '',
      agentId: activeCharacter.agentId || '',
      avatarScale: String(getCharacterScale(activeCharacter)),
    })
    setSettingsOpen(true)
  }

  function closeSettings() {
    setSettingsOpen(false)
  }

  async function saveSettings() {
    if (!activeCharacterId) return

    setSettingsSaving(true)
    setError('')

    try {
      const payload = {
        ...settingsDraft,
        avatarScale: normalizeCharacterScale(settingsDraft.avatarScale),
      }
      const res = await fetch(apiUrl(`/characters/${encodeURIComponent(activeCharacterId)}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message || data?.error || 'settings_update_failed')

      applyCharacterUpdate(data?.character || {})
      broadcastCharacterPatch(data?.character || {}, false)
      notifyCharactersUpdated()
      setSettingsOpen(false)
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setSettingsSaving(false)
    }
  }

  async function uploadCharacterImage(file) {
    if (!activeCharacterId || !file) return

    setUploadingImage(true)
    setError('')

    try {
      const imageDataUrl = await readFileAsDataUrl(file)
      const res = await fetch(
        apiUrl(`/characters/${encodeURIComponent(activeCharacterId)}/image`),
        {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl }),
        },
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message || data?.error || 'image_upload_failed')

      applyCharacterUpdate(data?.character || {}, { forceHasImage: true })
      broadcastCharacterPatch(data?.character || {}, true)
      notifyCharactersUpdated()
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setUploadingImage(false)
    }
  }

  const openBubble = async () => {
    if (isBubble || !activeCharacterId) return
    const anchorSize = getBubbleAnchorSize(activeCharacter)
    window.localStorage?.setItem(ACTIVE_CHARACTER_KEY, activeCharacterId)
    await safeInvoke('toggle_character_bubble', {
      anchorLabel: WINDOW_LABEL,
      characterId: activeCharacterId,
      anchorWidth: anchorSize.width,
      anchorHeight: anchorSize.height,
    })
  }

  const closeBubble = async () => {
    await safeInvoke('set_window_visible', { label: WINDOW_BUBBLE_LABEL, visible: false })
  }

  const handleLauncherPointerDown = (e) => {
    if (isBubble) return
    if (e.button !== 0) return

    e.preventDefault()
    dragState.current = {
      active: true,
      moved: false,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
    }

    const handlePointerMove = (event) => {
      if (!dragState.current.active) return
      if (event.pointerId !== dragState.current.pointerId) return
      if (dragState.current.moved) return

      const dx = event.clientX - dragState.current.startX
      const dy = event.clientY - dragState.current.startY
      if (Math.sqrt(dx * dx + dy * dy) > 6) {
        dragState.current.moved = true
        void safeInvoke('start_window_drag', { label: WINDOW_LABEL })
      }
    }

    const handlePointerUp = async (event) => {
      if (event.pointerId !== dragState.current.pointerId) return

      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)

      const moved = dragState.current.moved
      dragState.current.active = false

      if (!moved) {
        await openBubble()
        return
      }

      window.setTimeout(() => {
        const next = clampPosition({ x: window.screenX || 0, y: window.screenY || 0 }, currentWindowSize)
        setPosition(next)
        window.localStorage?.setItem(positionKey(WINDOW_LABEL), JSON.stringify(next))
      }, 40)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }

  return (
    <div className={`desktop-overlay ${isBubble ? 'desktop-overlay-bubble' : ''}`}>
      {isBubble ? (
        <>
          <ChatPanel
            activeCharacter={activeCharacter}
            messages={messages}
            error={error}
            input={input}
            setInput={setInput}
            sendMessage={sendMessage}
            loading={loading}
            pendingReply={pendingReply}
            onOpenSettings={openSettings}
            onClose={closeBubble}
            panelClass="bubble-mode"
          />
          <SettingsModal
            open={settingsOpen}
            onClose={closeSettings}
            draft={settingsDraft}
            onChange={(field, value) => setSettingsDraft((prev) => ({ ...prev, [field]: value }))}
            onSave={saveSettings}
            saving={settingsSaving}
            onUploadImage={uploadCharacterImage}
            uploadingImage={uploadingImage}
            imageUrl={activeCharacter?.imageUrl || ''}
          />
        </>
      ) : (
        <div className="character-wrap" style={launcherStyle}>
          {previewText && <div className="character-preview">{previewText}</div>}
          <button
            className={`launcher active ${activeCharacter?.imageUrl ? 'launcher-image-mode' : ''}`}
            onPointerDown={handleLauncherPointerDown}
            title={`${activeCharacter?.name || 'Bot'} - ${activeCharacter?.description || ''}`}
          >
            {activeCharacter?.imageUrl ? (
              <img
                className="launcher-image"
                src={activeCharacter.imageUrl}
                alt={activeCharacter.name || 'bot'}
                draggable={false}
              />
            ) : (
              activeCharacter?.emoji || '🤖'
            )}
          </button>
        </div>
      )}
    </div>
  )
}

export default App
