import { useEffect, useMemo, useRef, useState } from 'react'
import { core } from '@tauri-apps/api'
import './App.css'

const API_BASE =
  import.meta.env.VITE_GATEWAY_BASE_URL || 'https://claw-baskduf.duckdns.org/botapi'
const STORAGE_KEY = 'openclaw-desktop-char-pos'
const PANEL_SIZE = { width: 360, height: 520 }
const CHARACTER_SIZE = 72
const CHARACTER_WINDOW_LABEL = 'character'
const BUBBLE_WINDOW_LABEL = 'bubble'

function isBubbleMode() {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('mode') === 'bubble'
}

function canUseTauri() {
  return (
    typeof window !== 'undefined' &&
    (window.__TAURI__ != null || window.__TAURI_INTERNALS__ != null)
  )
}

function loadStoredPosition() {
  if (typeof window === 'undefined') return { x: 260, y: 520 }
  const fallback = { x: 260, y: 520 }
  const stored = window.localStorage?.getItem(STORAGE_KEY)
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

function clampPosition(pos) {
  if (typeof window === 'undefined') return pos

  const margin = 12
  const screenWidth = window.screen?.availWidth || window.innerWidth || 640
  const screenHeight = window.screen?.availHeight || window.innerHeight || 480
  const maxX = Math.max(0, screenWidth - CHARACTER_SIZE - margin)
  const maxY = Math.max(0, screenHeight - CHARACTER_SIZE - margin)

  return {
    x: Math.max(margin, Math.min(pos.x, maxX)),
    y: Math.max(margin, Math.min(pos.y, maxY)),
  }
}

function clampToScreen(x, y, width, height) {
  const margin = 12
  const screenWidth = window.screen?.availWidth || window.innerWidth || 640
  const screenHeight = window.screen?.availHeight || window.innerHeight || 480
  const maxX = Math.max(0, screenWidth - width - margin)
  const maxY = Math.max(0, screenHeight - height - margin)
  return {
    x: Math.max(margin, Math.min(x, maxX)),
    y: Math.max(margin, Math.min(y, maxY)),
  }
}

function resolvePanelPlacement(posX, posY) {
  const offset = 12
  const panelGap = 14
  const spaceForTop = PANEL_SIZE.height + 24
  const panelFitsLeft = posX > PANEL_SIZE.width + 30
  const panelFitsTop = posY >= spaceForTop

  return {
    left: panelFitsLeft ? `${-(PANEL_SIZE.width + panelGap)}px` : `${CHARACTER_SIZE + panelGap}px`,
    top: panelFitsTop ? `${-(PANEL_SIZE.height + offset)}px` : `${CHARACTER_SIZE + offset}px`,
  }
}

function resolveBubblePosition() {
  const charX = window.screenX || 0
  const charY = window.screenY || 0
  const charW = window.outerWidth || CHARACTER_SIZE
  const charH = window.outerHeight || CHARACTER_SIZE

  const gap = 14
  const fallbackX = charX + charW + gap
  const toLeftX = charX - PANEL_SIZE.width - gap
  const x = toLeftX >= 0 ? toLeftX : fallbackX

  const y = charY + (charH - PANEL_SIZE.height) / 2
  const clamped = clampToScreen(x, y, PANEL_SIZE.width, PANEL_SIZE.height)
  return clamped
}

function ChatPanel({
  activeCharacter,
  characters,
  activeCharacterId,
  setActiveCharacterId,
  messages,
  error,
  input,
  setInput,
  sendMessage,
  loading,
  onClose,
  open,
  panelClass,
}) {
  return (
    <div className={`chat-bubble-panel ${panelClass || ''}`}>
      <div className="panel-header">
        <strong>{activeCharacter?.name || 'Bot'}</strong>
        <button className="ghost" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="character-dock">
        {characters.map((c) => (
          <button
            key={c.id}
            className={`character ${c.id === activeCharacterId ? 'active' : ''}`}
            onClick={() => setActiveCharacterId(c.id)}
            title={`${c.name} - ${c.description}`}
          >
            <span>{c.emoji}</span>
          </button>
        ))}
      </div>

      <div className="messages">
        {messages.map((m, idx) => (
          <div key={`${m.ts || idx}-${idx}`} className={`msg ${m.role}`}>
            <div className="msg-text">{m.text}</div>
          </div>
        ))}
        {messages.length === 0 && <div className="empty">대화가 없습니다.</div>}
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

async function safeInvoke(name, payload) {
  if (!canUseTauri()) return

  try {
    await core.invoke(name, payload)
  } catch {
    // ignore tauri command failures in non-ready states
  }
}

function App() {
  const isBubble = isBubbleMode()
  const [characters, setCharacters] = useState([])
  const [activeCharacterId, setActiveCharacterId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(() => clampPosition(loadStoredPosition()))

  const dragState = useRef({
    isDragging: false,
    pointerId: null,
    offsetX: 0,
    offsetY: 0,
    startX: 0,
    startY: 0,
    moved: false,
  })

  const activeCharacter = useMemo(
    () => characters.find((c) => c.id === activeCharacterId),
    [characters, activeCharacterId],
  )

  useEffect(() => {
    loadCharacters()
  }, [])

  useEffect(() => {
    if (!isBubble) {
      const clamped = clampPosition(loadStoredPosition())
      setPosition(clamped)
      void safeInvoke('move_window', { label: CHARACTER_WINDOW_LABEL, x: clamped.x, y: clamped.y })
    }
  }, [isBubble])

  useEffect(() => {
    const handleResize = () => {
      if (!isBubble) {
        setPosition((prev) => clampPosition(prev))
      }
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [isBubble])

  useEffect(() => {
    if (!isBubble) {
      window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(position))
    }
  }, [position, isBubble])

  useEffect(() => {
    if (!activeCharacterId) return
    loadHistory(activeCharacterId)
  }, [activeCharacterId])

  function loadCharacters() {
    fetch(`${API_BASE}/characters`)
      .then((res) => res.json())
      .then((data) => {
        setCharacters(data.characters || [])
        if ((data.characters || []).length > 0) {
          setActiveCharacterId((prev) => prev || data.characters[0].id)
        }
      })
      .catch((e) => setError(String(e.message || e)))
  }

  async function loadHistory(characterId) {
    setError('')
    try {
      const res = await fetch(`${API_BASE}/chat/history/${characterId}`)
      const data = await res.json()
      setMessages(data.items || [])
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  async function sendMessage() {
    const text = input.trim()
    if (!text || !activeCharacterId || loading) return

    setLoading(true)
    setError('')
    setInput('')

    try {
      const res = await fetch(`${API_BASE}/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: activeCharacterId, text }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message || data?.error || 'send failed')
      await loadHistory(activeCharacterId)
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }

  const openBubble = async () => {
    if (isBubble) return
    const next = resolveBubblePosition()
    await safeInvoke('move_window', {
      label: BUBBLE_WINDOW_LABEL,
      x: next.x,
      y: next.y,
    })
    await safeInvoke('set_window_visible', { label: BUBBLE_WINDOW_LABEL, visible: true })
    setOpen(true)
  }

  const closeBubble = async () => {
    await safeInvoke('set_window_visible', { label: BUBBLE_WINDOW_LABEL, visible: false })
    setOpen(false)
  }

  const toggleBubble = async () => {
    if (open) {
      await closeBubble()
      return
    }
    await openBubble()
  }

  const handlePointerDown = (e) => {
    if (isBubble) return
    if (e.button !== 0) return

    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)

    const windowX = window.screenX || 0
    const windowY = window.screenY || 0

    dragState.current = {
      isDragging: true,
      pointerId: e.pointerId,
      offsetX: e.screenX - windowX,
      offsetY: e.screenY - windowY,
      startX: e.screenX,
      startY: e.screenY,
      moved: false,
    }

    const handlePointerMove = (event) => {
      if (!dragState.current.isDragging || event.pointerId !== dragState.current.pointerId) return

      const nextX = event.screenX - dragState.current.offsetX
      const nextY = event.screenY - dragState.current.offsetY

      const dx = event.screenX - dragState.current.startX
      const dy = event.screenY - dragState.current.startY
      if (!dragState.current.moved && Math.sqrt(dx * dx + dy * dy) > 6) {
        dragState.current.moved = true
      }

      setPosition((prev) => {
        const next = clampPosition({ x: nextX, y: nextY })
        if (prev.x === next.x && prev.y === next.y) return prev
        void safeInvoke('move_window', {
          label: CHARACTER_WINDOW_LABEL,
          x: next.x,
          y: next.y,
        })
        return next
      })
    }

    const handlePointerUp = async (event) => {
      if (event.pointerId !== dragState.current.pointerId) return

      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)

      const { moved } = dragState.current
      dragState.current.isDragging = false

      if (!moved) {
        await toggleBubble()
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }

  return (
    <div className={`desktop-overlay ${isBubble ? 'desktop-overlay-bubble' : ''}`}>
      {isBubble ? (
        <ChatPanel
          activeCharacter={activeCharacter}
          characters={characters}
          activeCharacterId={activeCharacterId}
          setActiveCharacterId={setActiveCharacterId}
          messages={messages}
          error={error}
          input={input}
          setInput={setInput}
          sendMessage={sendMessage}
          loading={loading}
          onClose={closeBubble}
          open={open}
          panelClass="bubble-mode"
        />
      ) : (
        <div
          className="character-wrap"
          style={{ left: '0px', top: '0px' }}
        >
          <button className="launcher" onPointerDown={handlePointerDown} title="Open Bot Hub">
            {activeCharacter?.emoji || '🤖'}
          </button>
        </div>
      )}
    </div>
  )
}

export default App
