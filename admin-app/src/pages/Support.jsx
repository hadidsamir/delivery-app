import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Logo from '../components/Logo'
import ThemeToggle from '../components/ThemeToggle'
import { useTheme } from '../hooks/useTheme'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://delivery-app-production-9c98.up.railway.app'

function timeLabel(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}

function dateLabel(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
}

// ── Burbuja de mensaje ────────────────────────────────────────────────────────
function MessageBubble({ msg }) {
  const isOutbound = msg.direction === 'outbound'
  const isBot      = msg.sender === 'bot'
  const isHuman    = msg.sender === 'human'

  const bubbleColor = isOutbound
    ? isHuman
      ? 'bg-orange-500 text-white'
      : 'bg-gray-500 text-white'
    : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-600'

  const label = isBot ? '🤖 Bot' : isHuman ? '👤 Tú' : null

  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} mb-2`}>
      <div className={`max-w-[75%] px-3 py-2 rounded-2xl ${bubbleColor} ${isOutbound ? 'rounded-br-sm' : 'rounded-bl-sm'}`}>
        {label && (
          <p className="text-[10px] opacity-70 font-semibold mb-0.5">{label}</p>
        )}
        <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
        <p className={`text-[10px] mt-1 ${isOutbound ? 'text-white/70 text-right' : 'text-gray-400 dark:text-gray-500'}`}>
          {timeLabel(msg.created_at)}
        </p>
      </div>
    </div>
  )
}

// ── Tarjeta de conversación en la lista lateral ───────────────────────────────
function ChatItem({ session, active, onClick }) {
  const lastMsg = session.messages?.[session.messages.length - 1]
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
        active ? 'bg-orange-50 dark:bg-orange-900/20 border-l-4 border-l-orange-500' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-sm text-gray-900 dark:text-white truncate">
          {session.display_name || session.phone}
        </span>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {session.human_takeover && (
            <span className="bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              HUMANO
            </span>
          )}
          <span className="text-[10px] text-gray-400">{dateLabel(session.updated_at)}</span>
        </div>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
        {lastMsg?.body || 'Sin mensajes'}
      </p>
      {session.takeover_reason && (
        <p className="text-[10px] text-red-500 mt-0.5 truncate">⚠️ {session.takeover_reason}</p>
      )}
    </button>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function Support() {
  const navigate = useNavigate()
  const { dark, toggleTheme } = useTheme()

  const [sessions, setSessions]     = useState([])
  const [activePhone, setActivePhone] = useState(null)
  const [replyText, setReplyText]   = useState('')
  const [sending, setSending]       = useState(false)
  const [resuming, setResuming]     = useState(false)
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState('all') // 'all' | 'human' | 'bot'
  const [notification, setNotification] = useState(null)

  const messagesEndRef = useRef(null)
  const inputRef       = useRef(null)

  const activeSession = sessions.find(s => s.phone === activePhone) || null

  // Cargar todas las sesiones
  const fetchSessions = useCallback(async () => {
    try {
      const res  = await fetch(`${BACKEND_URL}/api/support/chats`)
      const data = await res.json()
      if (Array.isArray(data)) {
        setSessions(data)
        // Si no hay sesión activa, seleccionar la primera
        if (!activePhone && data.length > 0) setActivePhone(data[0].phone)
      }
    } catch (err) {
      console.error('[Support] Error cargando chats:', err)
    } finally {
      setLoading(false)
    }
  }, [activePhone])

  useEffect(() => {
    fetchSessions()
    // Polling cada 8 segundos para actualizar mensajes nuevos
    const interval = setInterval(() => fetchSessions(), 8000)
    return () => clearInterval(interval)
  }, [fetchSessions])

  // Suscripción Supabase Realtime para mensajes nuevos
  useEffect(() => {
    const channel = supabase
      .channel('support-messages')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'chat_messages',
      }, (payload) => {
        const msg = payload.new
        setSessions(prev => prev.map(s => {
          if (s.phone !== msg.phone) return s
          return { ...s, messages: [...(s.messages || []), msg], updated_at: msg.created_at }
        }))
        // Notificación si no es la sesión activa
        if (msg.phone !== activePhone && msg.sender === 'client') {
          const session = sessions.find(s => s.phone === msg.phone)
          setNotification({
            name: session?.display_name || msg.phone,
            body: msg.body,
            phone: msg.phone,
          })
          setTimeout(() => setNotification(null), 5000)
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'chat_sessions',
      }, () => fetchSessions())
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [activePhone, sessions, fetchSessions])

  // Scroll al último mensaje
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeSession?.messages?.length])

  async function handleReply(e) {
    e.preventDefault()
    if (!replyText.trim() || !activePhone || sending) return
    setSending(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/support/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: activePhone, body: replyText.trim() }),
      })
      if (res.ok) {
        setReplyText('')
        // Agregar mensaje optimista a la lista
        const newMsg = {
          id: Date.now(), phone: activePhone,
          direction: 'outbound', sender: 'human',
          body: replyText.trim(), created_at: new Date().toISOString(),
        }
        setSessions(prev => prev.map(s =>
          s.phone === activePhone
            ? { ...s, messages: [...(s.messages || []), newMsg] }
            : s
        ))
        inputRef.current?.focus()
      }
    } catch (err) {
      console.error('[Support] Error enviando respuesta:', err)
    } finally {
      setSending(false)
    }
  }

  async function handleResume() {
    if (!activePhone || resuming) return
    if (!confirm('¿Reactivar el bot para esta conversación? Se le avisará al cliente.')) return
    setResuming(true)
    try {
      await fetch(`${BACKEND_URL}/api/support/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: activePhone }),
      })
      // Actualizar sesión local
      setSessions(prev => prev.map(s =>
        s.phone === activePhone
          ? { ...s, human_takeover: false, resolved_at: new Date().toISOString() }
          : s
      ))
    } catch (err) {
      console.error('[Support] Error reanudando bot:', err)
    } finally {
      setResuming(false)
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const filteredSessions = sessions.filter(s => {
    if (filter === 'human') return s.human_takeover
    if (filter === 'bot')   return !s.human_takeover
    return true
  })

  const humanCount = sessions.filter(s => s.human_takeover).length

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white">

      {/* ── Header ── */}
      <header className="h-14 shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex items-center px-4 gap-3 shadow-sm">
        <Logo className="h-7 w-auto" />
        <span className="font-bold text-orange-500 text-lg hidden sm:block">1012Delivery</span>
        <nav className="flex items-center gap-1 ml-4">
          <button onClick={() => navigate('/dashboard')}
            className="px-3 py-1.5 text-sm rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            Pedidos
          </button>
          <button
            className="px-3 py-1.5 text-sm rounded-lg bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 font-semibold">
            Soporte WhatsApp
            {humanCount > 0 && (
              <span className="ml-1.5 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {humanCount}
              </span>
            )}
          </button>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle dark={dark} toggle={toggleTheme} />
          <button onClick={handleLogout}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            Salir
          </button>
        </div>
      </header>

      {/* ── Notificación de mensaje nuevo ── */}
      {notification && (
        <div
          onClick={() => { setActivePhone(notification.phone); setNotification(null) }}
          className="absolute top-16 right-4 z-50 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-xl shadow-xl px-4 py-3 cursor-pointer max-w-xs border border-gray-700 dark:border-gray-200 animate-pulse"
        >
          <p className="font-semibold text-sm">💬 {notification.name}</p>
          <p className="text-xs opacity-80 truncate">{notification.body}</p>
        </div>
      )}

      {/* ── Cuerpo principal ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Lista de conversaciones */}
        <aside className="w-72 shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex flex-col">
          {/* Filtros */}
          <div className="p-3 border-b border-gray-100 dark:border-gray-700">
            <div className="flex gap-1">
              {[['all','Todos'],['human','⚠️ Humano'],['bot','🤖 Bot']].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setFilter(val)}
                  className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors ${
                    filter === val
                      ? 'bg-orange-500 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <div className="w-6 h-6 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredSessions.length === 0 ? (
              <p className="text-center text-sm text-gray-400 mt-10">
                {filter === 'human' ? 'No hay casos escalados' : 'No hay conversaciones'}
              </p>
            ) : (
              filteredSessions.map(s => (
                <ChatItem
                  key={s.phone}
                  session={s}
                  active={s.phone === activePhone}
                  onClick={() => setActivePhone(s.phone)}
                />
              ))
            )}
          </div>
        </aside>

        {/* Panel de chat */}
        <main className="flex-1 flex flex-col min-w-0">
          {!activeSession ? (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <p className="text-4xl mb-3">💬</p>
                <p className="text-lg font-medium">Selecciona una conversación</p>
                <p className="text-sm">Los chats de WhatsApp aparecen aquí</p>
              </div>
            </div>
          ) : (
            <>
              {/* Header del chat */}
              <div className="h-14 shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex items-center px-4 gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{activeSession.display_name || activeSession.phone}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{activeSession.phone}</p>
                </div>
                {activeSession.human_takeover && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-2 py-1 rounded-full font-semibold">
                      ⚠️ Atención humana activa
                    </span>
                    <button
                      onClick={handleResume}
                      disabled={resuming}
                      className="text-xs bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors disabled:opacity-50"
                    >
                      {resuming ? 'Reanudando...' : '✅ Reanudar bot'}
                    </button>
                  </div>
                )}
                {!activeSession.human_takeover && (
                  <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 px-2 py-1 rounded-full">
                    🤖 Bot activo
                  </span>
                )}
              </div>

              {/* Motivo de escalación */}
              {activeSession.human_takeover && activeSession.takeover_reason && (
                <div className="mx-4 mt-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-2">
                  <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                    ⚠️ Motivo: {activeSession.takeover_reason}
                  </p>
                </div>
              )}

              {/* Mensajes */}
              <div className="flex-1 overflow-y-auto px-4 py-4">
                {activeSession.messages?.length === 0 && (
                  <p className="text-center text-sm text-gray-400 mt-10">Sin mensajes aún</p>
                )}
                {activeSession.messages?.map((msg) => (
                  <MessageBubble key={msg.id} msg={msg} />
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Input de respuesta */}
              <form
                onSubmit={handleReply}
                className="shrink-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 p-3 flex items-end gap-2"
              >
                <textarea
                  ref={inputRef}
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(e) }
                  }}
                  placeholder={
                    activeSession.human_takeover
                      ? 'Escribe tu respuesta al cliente…'
                      : 'El bot está activo. Puedes escribir igualmente si necesitas.'
                  }
                  rows={2}
                  className="flex-1 resize-none rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:border-orange-400 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
                />
                <button
                  type="submit"
                  disabled={!replyText.trim() || sending}
                  className="bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors shrink-0"
                >
                  {sending ? '...' : 'Enviar'}
                </button>
              </form>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
