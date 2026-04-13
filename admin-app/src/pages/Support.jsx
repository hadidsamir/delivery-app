import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Logo from '../components/Logo'
import ThemeToggle from '../components/ThemeToggle'
import { useTheme } from '../hooks/useTheme'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://delivery-app-production-9c98.up.railway.app'

function timeLabel(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}

function dateLabel(ts) {
  if (!ts) return ''
  const now = new Date()
  const d   = new Date(ts)
  const diffDays = Math.floor((now - d) / 86400000)
  if (diffDays === 0) return 'Hoy'
  if (diffDays === 1) return 'Ayer'
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
}

function msgDateLabel(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
}

function initials(name) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function avatarColor(phone) {
  const colors = ['#F97316','#8B5CF6','#06B6D4','#10B981','#EF4444','#F59E0B','#3B82F6','#EC4899']
  let hash = 0
  for (const c of (phone || '')) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff
  return colors[Math.abs(hash) % colors.length]
}

/* ── Avatar ─────────────────────────────────────────────────────────────────── */
function Avatar({ name, phone, size = 40 }) {
  return (
    <div
      style={{ width: size, height: size, backgroundColor: avatarColor(phone), fontSize: size * 0.38 }}
      className="rounded-full flex items-center justify-center text-white font-bold shrink-0 select-none uppercase"
    >
      {initials(name || phone)}
    </div>
  )
}

/* ── Badge de estado ─────────────────────────────────────────────────────────── */
function StatusBadge({ human }) {
  return human ? (
    <span className="inline-flex items-center gap-1.5 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs font-semibold px-3 py-1 rounded-full border border-red-200 dark:border-red-800 whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
      Atención humana activa
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-xs font-semibold px-3 py-1 rounded-full border border-green-200 dark:border-green-800 whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
      Bot activo
    </span>
  )
}

/* ── Burbuja de mensaje ──────────────────────────────────────────────────────── */
function MessageBubble({ msg }) {
  const isOutbound = msg.direction === 'outbound'
  const isBot      = msg.sender   === 'bot'
  const isHuman    = msg.sender   === 'human'

  if (isOutbound) {
    return (
      <div className="flex flex-col items-end mb-1.5 px-4">
        {isBot && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5 mr-1">Bot</span>
        )}
        <div className={`max-w-[68%] px-4 py-2.5 rounded-2xl rounded-br-md shadow-sm ${
          isHuman ? 'bg-orange-500 text-white' : 'bg-gray-400 dark:bg-gray-600 text-white'
        }`}>
          <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{msg.body}</p>
          <p className="text-[10px] text-white/60 text-right mt-1 leading-none">{timeLabel(msg.created_at)}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-end gap-2 mb-1.5 px-4">
      <div className="max-w-[68%] bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 px-4 py-2.5 rounded-2xl rounded-bl-md shadow-sm">
        <p className="text-sm whitespace-pre-wrap break-words text-gray-800 dark:text-gray-100 leading-relaxed">{msg.body}</p>
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 leading-none">{timeLabel(msg.created_at)}</p>
      </div>
    </div>
  )
}

/* ── Separador de fecha ──────────────────────────────────────────────────────── */
function DateSeparator({ label }) {
  return (
    <div className="flex items-center gap-3 my-5 px-4">
      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
      <span className="text-[11px] text-gray-400 dark:text-gray-500 font-medium whitespace-nowrap capitalize">{label}</span>
      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
    </div>
  )
}

/* ── Tarjeta lateral ─────────────────────────────────────────────────────────── */
function ChatItem({ session, active, onClick }) {
  const lastMsg = session.messages?.[session.messages.length - 1]
  const name    = session.display_name || session.phone

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-3 flex items-center gap-3 border-b border-gray-100 dark:border-gray-800 transition-colors ${
        active
          ? 'bg-orange-50 dark:bg-orange-900/20 border-l-[3px] border-l-orange-500'
          : 'hover:bg-gray-50 dark:hover:bg-gray-800/60 border-l-[3px] border-l-transparent'
      }`}
    >
      <div className="relative shrink-0">
        <Avatar name={session.display_name} phone={session.phone} size={44} />
        {session.human_takeover && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-red-500 rounded-full border-2 border-white dark:border-gray-900" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className={`text-sm font-semibold truncate ${
            active ? 'text-orange-600 dark:text-orange-400' : 'text-gray-900 dark:text-white'
          }`}>
            {name}
          </span>
          <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0 ml-2">
            {dateLabel(session.updated_at)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate leading-relaxed">
            {lastMsg?.body || 'Sin mensajes'}
          </p>
          {session.human_takeover && (
            <span className="shrink-0 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none uppercase tracking-wide">
              Humano
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

/* ── Componente principal ────────────────────────────────────────────────────── */
export default function Support() {
  const navigate = useNavigate()
  const { dark, toggleTheme } = useTheme()

  const [sessions, setSessions]         = useState([])
  const [activePhone, setActivePhone]   = useState(null)
  const [replyText, setReplyText]       = useState('')
  const [sending, setSending]           = useState(false)
  const [resuming, setResuming]         = useState(false)
  const [loading, setLoading]           = useState(true)
  const [filter, setFilter]             = useState('all')
  const [notification, setNotification] = useState(null)

  const messagesEndRef = useRef(null)
  const inputRef       = useRef(null)

  const activeSession = sessions.find(s => s.phone === activePhone) || null

  const fetchSessions = useCallback(async () => {
    try {
      const res  = await fetch(`${BACKEND_URL}/api/support/chats`)
      const data = await res.json()
      if (Array.isArray(data)) {
        setSessions(data)
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
    const interval = setInterval(() => fetchSessions(), 8000)
    return () => clearInterval(interval)
  }, [fetchSessions])

  useEffect(() => {
    const channel = supabase
      .channel('support-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        const msg = payload.new
        setSessions(prev => prev.map(s =>
          s.phone !== msg.phone ? s : { ...s, messages: [...(s.messages || []), msg], updated_at: msg.created_at }
        ))
        if (msg.phone !== activePhone && msg.sender === 'client') {
          const session = sessions.find(s => s.phone === msg.phone)
          setNotification({ name: session?.display_name || msg.phone, body: msg.body, phone: msg.phone })
          setTimeout(() => setNotification(null), 5000)
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_sessions' }, () => fetchSessions())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [activePhone, sessions, fetchSessions])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeSession?.messages?.length])

  async function handleReply(e) {
    e.preventDefault()
    if (!replyText.trim() || !activePhone || sending) return
    setSending(true)
    const text = replyText.trim()
    setReplyText('')
    try {
      const res = await fetch(`${BACKEND_URL}/api/support/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: activePhone, body: text }),
      })
      if (res.ok) {
        const newMsg = {
          id: Date.now(), phone: activePhone,
          direction: 'outbound', sender: 'human',
          body: text, created_at: new Date().toISOString(),
        }
        setSessions(prev => prev.map(s =>
          s.phone === activePhone ? { ...s, messages: [...(s.messages || []), newMsg] } : s
        ))
        inputRef.current?.focus()
      } else {
        setReplyText(text)
      }
    } catch (err) {
      console.error('[Support] Error enviando respuesta:', err)
      setReplyText(text)
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
      setSessions(prev => prev.map(s =>
        s.phone === activePhone ? { ...s, human_takeover: false } : s
      ))
    } catch (err) {
      console.error('[Support] Error reanudando bot:', err)
    } finally {
      setResuming(false)
    }
  }

  const filteredSessions = sessions.filter(s => {
    if (filter === 'human') return s.human_takeover
    if (filter === 'bot')   return !s.human_takeover
    return true
  })

  const humanCount = sessions.filter(s => s.human_takeover).length

  function groupByDate(messages = []) {
    const groups = []
    let lastLabel = null
    for (const msg of messages) {
      const label = msgDateLabel(msg.created_at)
      if (label !== lastLabel) {
        groups.push({ type: 'sep', label, key: `sep-${msg.id}` })
        lastLabel = label
      }
      groups.push({ type: 'msg', msg, key: msg.id })
    }
    return groups
  }

  return (
    <div className="h-screen flex flex-col bg-gray-100 dark:bg-gray-950 overflow-hidden">

      {/* ── Header ── */}
      <header className="h-14 shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center px-5 gap-4 shadow-sm z-10">
        <div className="flex items-center gap-2.5">
          <Logo className="h-7 w-auto" />
          <span className="font-bold text-orange-500 text-base hidden sm:block">1012Delivery</span>
        </div>

        <div className="w-px h-5 bg-gray-200 dark:bg-gray-700" />

        <nav className="flex items-center gap-1">
          <button
            onClick={() => navigate('/dashboard')}
            className="px-4 py-1.5 text-sm rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors font-medium"
          >
            Pedidos
          </button>

          <button className="relative px-4 py-1.5 text-sm rounded-lg bg-orange-500 text-white font-semibold">
            Soporte WhatsApp
            {humanCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none border-2 border-white dark:border-gray-900">
                {humanCount}
              </span>
            )}
          </button>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle dark={dark} toggle={toggleTheme} />
          <button
            onClick={async () => { await supabase.auth.signOut(); navigate('/login') }}
            className="text-sm text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors font-medium"
          >
            Salir
          </button>
        </div>
      </header>

      {/* ── Toast ── */}
      {notification && (
        <div
          onClick={() => { setActivePhone(notification.phone); setNotification(null) }}
          className="fixed top-16 right-4 z-50 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-2xl shadow-2xl px-4 py-3 cursor-pointer flex items-center gap-3 max-w-xs border border-white/10 dark:border-gray-200"
          style={{ animation: 'slideIn .2s ease' }}
        >
          <Avatar name={notification.name} phone={notification.phone} size={36} />
          <div className="min-w-0">
            <p className="font-semibold text-sm leading-tight">{notification.name}</p>
            <p className="text-xs opacity-60 truncate mt-0.5">{notification.body}</p>
          </div>
        </div>
      )}

      {/* ── Cuerpo ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Sidebar */}
        <aside className="w-80 shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col">

          {/* Filtros */}
          <div className="p-3 border-b border-gray-100 dark:border-gray-800">
            <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
              {[['all','Todos'],['human','Humano'],['bot','Bot']].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setFilter(val)}
                  className={`flex-1 text-xs py-1.5 rounded-lg font-semibold transition-all leading-none ${
                    filter === val
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
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
                <div className="w-6 h-6 border-[3px] border-orange-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-400">
                <svg className="w-8 h-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <p className="text-sm">{filter === 'human' ? 'Sin casos escalados' : 'Sin conversaciones'}</p>
              </div>
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
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-950">
              <div className="text-center text-gray-400">
                <svg className="w-14 h-14 mx-auto mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <p className="text-base font-semibold text-gray-500 dark:text-gray-400">Selecciona una conversación</p>
                <p className="text-sm mt-1 text-gray-400">Los mensajes de WhatsApp aparecen aquí</p>
              </div>
            </div>
          ) : (
            <>
              {/* Header del chat */}
              <div className="shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-5 py-3 flex items-center gap-3 shadow-sm">
                <Avatar name={activeSession.display_name} phone={activeSession.phone} size={42} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 dark:text-white leading-tight">
                    {activeSession.display_name || activeSession.phone}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{activeSession.phone}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge human={activeSession.human_takeover} />
                  {activeSession.human_takeover && (
                    <button
                      onClick={handleResume}
                      disabled={resuming}
                      className="inline-flex items-center gap-1.5 text-xs bg-green-500 hover:bg-green-600 active:bg-green-700 text-white px-3 py-1.5 rounded-full font-semibold transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      {resuming ? (
                        <>
                          <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                          Reanudando...
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
                          </svg>
                          Reanudar bot
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Banner motivo */}
              {activeSession.human_takeover && activeSession.takeover_reason && (
                <div className="shrink-0 mx-4 mt-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-4 py-2 flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                  </svg>
                  <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                    Motivo de escalación: {activeSession.takeover_reason}
                  </p>
                </div>
              )}

              {/* Mensajes */}
              <div className="flex-1 overflow-y-auto py-4 bg-gray-50 dark:bg-gray-950">
                {(!activeSession.messages || activeSession.messages.length === 0) ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400">
                    <svg className="w-10 h-10 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                    <p className="text-sm">Sin mensajes aún</p>
                  </div>
                ) : (
                  groupByDate(activeSession.messages).map(item =>
                    item.type === 'sep'
                      ? <DateSeparator key={item.key} label={item.label} />
                      : <MessageBubble key={item.key} msg={item.msg} />
                  )
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <form
                onSubmit={handleReply}
                className="shrink-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 px-4 py-3 flex items-end gap-2"
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
                      ? 'Escribe tu respuesta al cliente...'
                      : 'El bot está activo. Puedes escribir igualmente si lo necesitas.'
                  }
                  rows={2}
                  style={{ paddingLeft: '14px', paddingRight: '14px', paddingTop: '10px', paddingBottom: '10px' }}
                  className="flex-1 resize-none rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-orange-400 dark:focus:border-orange-500 placeholder-gray-400 dark:placeholder-gray-500 transition-colors leading-relaxed"
                />
                <button
                  type="submit"
                  disabled={!replyText.trim() || sending}
                  className="shrink-0 w-10 h-10 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-full flex items-center justify-center transition-colors shadow-sm"
                >
                  {sending ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4 translate-x-px" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
                    </svg>
                  )}
                </button>
              </form>
            </>
          )}
        </main>
      </div>

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(16px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}
