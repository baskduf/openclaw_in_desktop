import { useEffect, useMemo, useState } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_GATEWAY_BASE_URL || 'http://127.0.0.1:4310'

function App() {
  const [characters, setCharacters] = useState([])
  const [activeCharacterId, setActiveCharacterId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const activeCharacter = useMemo(
    () => characters.find((c) => c.id === activeCharacterId),
    [characters, activeCharacterId],
  )

  useEffect(() => {
    loadCharacters()
  }, [])

  useEffect(() => {
    if (!activeCharacterId) return
    loadHistory(activeCharacterId)
  }, [activeCharacterId])

  async function loadCharacters() {
    const res = await fetch(`${API_BASE}/characters`)
    const data = await res.json()
    setCharacters(data.characters || [])
    if ((data.characters || []).length > 0) {
      setActiveCharacterId((prev) => prev || data.characters[0].id)
    }
  }

  async function loadHistory(characterId) {
    setError('')
    const res = await fetch(`${API_BASE}/chat/history/${characterId}`)
    const data = await res.json()
    setMessages(data.items || [])
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

  return (
    <div className="desktop-overlay">
      <div className="chat-bubble-panel">
        <div className="panel-header">
          <strong>{activeCharacter?.name || 'Bot'}</strong>
          <span className="muted">{activeCharacter?.description || ''}</span>
        </div>

        <div className="messages">
          {messages.map((m, idx) => (
            <div key={`${m.ts || idx}-${idx}`} className={`msg ${m.role}`}>
              <div className="msg-role">{m.role === 'assistant' ? activeCharacter?.emoji || '🤖' : '나'}</div>
              <div className="msg-text">{m.text}</div>
            </div>
          ))}
          {messages.length === 0 && <div className="empty">메시지를 시작해…</div>}
        </div>

        {error && <div className="error">{error}</div>}

        <div className="input-row">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="메시지 입력…"
          />
          <button onClick={sendMessage} disabled={loading}>
            {loading ? '...' : '전송'}
          </button>
        </div>
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
    </div>
  )
}

export default App
