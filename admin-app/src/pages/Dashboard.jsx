import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Logo from '../components/Logo'
import ThemeToggle from '../components/ThemeToggle'
import { useTheme } from '../hooks/useTheme'

const CLIENT_URL = import.meta.env.VITE_CLIENT_APP_URL || 'http://localhost:5175'

// Función switch en lugar de objetos separados.
// Con objetos JS, el minificador de Vite puede reordenar claves y hacer que
// STATUS_LABEL['en_camino'] devuelva el valor de 'pendiente' en producción.
// Un switch evalúa el status UNA SOLA VEZ y devuelve label+dot+badge juntos
// → imposible que label y colores queden desincronizados.
function getStatusCfg(status) {
  switch (status) {
    case 'pendiente':
      return { label: 'Esperando mensajero', dot: 'bg-yellow-400', badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' }
    case 'en_camino':
      return { label: 'En camino',           dot: 'bg-orange-500', badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' }
    case 'entregado':
      return { label: 'Entregado',           dot: 'bg-green-500',  badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'   }
    case 'cancelado':
      return { label: 'Cancelado',           dot: 'bg-red-500',    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'           }
    default:
      return { label: status,               dot: 'bg-gray-400',   badge: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'          }
  }
}

// Componente de badge de estado — extrae el status UNA VEZ y lo usa para todo
function StatusBadge({ status }) {
  const { label, dot, badge } = getStatusCfg(status)
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold ${badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { dark, toggleTheme } = useTheme()
  const [orders, setOrders] = useState([])
  const [couriers, setCouriers] = useState([])
  const [loading, setLoading] = useState(true)

  const couriersRef = useRef([])

  // Modals
  const [trackingOrder, setTrackingOrder] = useState(null)
  const [assignOrder, setAssignOrder] = useState(null)
  const [assignCourierId, setAssignCourierId] = useState('')
  const [copied, setCopied] = useState(false)
  const [assigning, setAssigning] = useState(false)

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [ordersResult, couriersResult] = await Promise.allSettled([
        supabase
          .from('orders')
          .select('*, couriers(name)')
          .order('created_at', { ascending: false }),
        supabase.from('couriers').select('id, name').eq('is_active', true),
      ])

      // Solo actualizar state si la consulta fue exitosa y sin error de Supabase.
      // Esto evita que un fallo de red o error de réplica borre los pedidos mostrados.
      if (ordersResult.status === 'fulfilled' && !ordersResult.value.error) {
        setOrders(ordersResult.value.data || [])
      } else if (ordersResult.status === 'rejected') {
        console.warn('[Dashboard] Error consultando pedidos:', ordersResult.reason)
      }

      if (couriersResult.status === 'fulfilled' && !couriersResult.value.error) {
        const couriersData = couriersResult.value.data || []
        setCouriers(couriersData)
        couriersRef.current = couriersData
      }
    } catch (err) {
      console.error('[Dashboard] Error cargando datos:', err)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Supabase Realtime + polling de respaldo
  useEffect(() => {
    let reconnectTimer = null
    let pollTimer     = null
    let channel       = null
    let active        = true   // flag para ignorar callbacks tras desmontaje

    function subscribe() {
      // Eliminar canal anterior si existe
      if (channel) {
        supabase.removeChannel(channel)
        channel = null
      }
      if (!active) return

      channel = supabase
        .channel('dashboard-orders')
        // INSERT → fetch completo para obtener JOIN courier name
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'orders' },
          () => { if (active) fetchData(true) }
        )
        // UPDATE → aplicar payload.new al estado al instante.
        // REPLICA IDENTITY FULL garantiza que payload.new tiene TODAS las columnas.
        // NO hacemos re-fetch para no sobreescribir con datos obsoletos de la réplica.
        .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'orders' },
          (payload) => {
            if (!active || !payload.new?.id) return
            setOrders(prev => prev.map(o =>
              o.id === payload.new.id
                ? { ...o, ...payload.new, couriers: o.couriers }
                : o
            ))
          }
        )
        // DELETE → eliminar del estado local
        .on('postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'orders' },
          (payload) => {
            if (!active) return
            if (payload.old?.id) {
              setOrders(prev => prev.filter(o => o.id !== payload.old.id))
            }
            fetchData(true)
          }
        )
        .subscribe((status) => {
          console.log('[Dashboard] Realtime:', status)
          if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && active) {
            // Reconectar tras 3 segundos y hacer fetch para recuperar cambios perdidos
            if (reconnectTimer) clearTimeout(reconnectTimer)
            reconnectTimer = setTimeout(() => {
              if (active) { fetchData(true); subscribe() }
            }, 3000)
          }
        })
    }

    subscribe()

    // Polling cada 5 s — garantiza actualización aunque Realtime falle o se pierda un evento
    pollTimer = setInterval(() => { if (active) fetchData(true) }, 5000)

    // Al volver a la pestaña: solo refrescar datos, NO recrear el canal.
    // Recrear el canal en cada visibilitychange destruía la conexión WebSocket
    // activa y causaba pérdida de eventos durante la reconexión.
    function onVisibilityChange() {
      if (!document.hidden && active) fetchData(true)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      active = false
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (pollTimer)      clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (channel) supabase.removeChannel(channel)
    }
  }, [fetchData])

  async function logout() {
    try {
      await supabase.auth.signOut()
    } catch {}
    navigate('/login')
  }

  // Stats — calculados sobre todos los pedidos cargados
  const totalPedidos = orders.length
  const esperando   = orders.filter(o => o.status === 'pendiente').length
  const enCamino    = orders.filter(o => o.status === 'en_camino').length
  const entregados  = orders.filter(o => o.status === 'entregado').length

  // Solicitudes de clientes sin mensajero asignado
  const pendingClientOrders = orders.filter(o => o.source === 'cliente' && !o.courier_id)

  async function copyLink(token) {
    if (!token) return
    const url = `${CLIENT_URL}/track/${encodeURIComponent(token)}`
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url)
      } else {
        // Fallback para HTTP o navegadores sin Clipboard API
        const el = document.createElement('textarea')
        el.value = url
        document.body.appendChild(el)
        el.select()
        document.execCommand('copy')
        document.body.removeChild(el)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      alert('No se pudo copiar el link. Cópialo manualmente: ' + url)
    }
  }

  async function handleAssign() {
    if (!assignCourierId) return
    setAssigning(true)
    const orderId = assignOrder.id
    const selectedCourier = couriers.find(c => c.id === assignCourierId)
    const currentStatus = assignOrder.status

    // Al reasignar un pedido rechazado (sin mensajero), volver a 'pendiente'
    const newStatus = currentStatus === 'entregado' ? currentStatus : 'pendiente'

    const { error } = await supabase
      .from('orders')
      .update({ courier_id: assignCourierId, status: newStatus })
      .eq('id', orderId)

    if (error) {
      alert('Error al asignar mensajero: ' + error.message)
      setAssigning(false)
      return
    }

    // Actualización optimista tras confirmar Supabase
    setOrders(prev => prev.map(o =>
      o.id === orderId
        ? { ...o, courier_id: assignCourierId, status: newStatus, couriers: { name: selectedCourier?.name || '' } }
        : o
    ))
    setAssignOrder(null)
    setAssignCourierId('')
    setAssigning(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Logo size="sm" />

          <div className="flex items-center gap-2">
            <ThemeToggle dark={dark} onToggle={toggleTheme} />

            <button
              onClick={() => navigate('/couriers')}
              className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-orange-500 dark:hover:text-orange-400 border border-gray-200 dark:border-gray-700 px-3 py-2 rounded-xl hover:border-orange-300 dark:hover:border-orange-700 transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Mensajeros
            </button>

            <button
              onClick={() => navigate('/support')}
              className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-orange-500 dark:hover:text-orange-400 border border-gray-200 dark:border-gray-700 px-3 py-2 rounded-xl hover:border-orange-300 dark:hover:border-orange-700 transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              Soporte
            </button>

            <button
              onClick={logout}
              className="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 px-3 py-2 rounded-xl transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">

        {/* ── Título ──────────────────────────────────────────────────────── */}
        <div className="mb-8">
          <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Panel de control</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Gestiona pedidos y mensajeros en tiempo real</p>
        </div>

        {/* ── Stats ────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {/* Total */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total</span>
              <div className="w-9 h-9 bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center">
                <svg className="w-4.5 h-4.5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
            </div>
            <p className="text-3xl font-black text-gray-900 dark:text-white">{totalPedidos}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">pedidos totales</p>
          </div>

          {/* Esperando */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-yellow-600 dark:text-yellow-400 uppercase tracking-wider">Esperando</span>
              <div className="w-9 h-9 bg-yellow-50 dark:bg-yellow-900/30 rounded-xl flex items-center justify-center">
                <svg className="w-4.5 h-4.5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <p className="text-3xl font-black text-yellow-500">{esperando}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">sin mensajero</p>
          </div>

          {/* En camino */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-orange-600 dark:text-orange-400 uppercase tracking-wider">En camino</span>
              <div className="w-9 h-9 bg-orange-50 dark:bg-orange-900/30 rounded-xl flex items-center justify-center">
                <svg className="w-4.5 h-4.5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
            </div>
            <p className="text-3xl font-black text-orange-500">{enCamino}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">en ruta ahora</p>
          </div>

          {/* Entregados */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wider">Entregados</span>
              <div className="w-9 h-9 bg-green-50 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                <svg className="w-4.5 h-4.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <p className="text-3xl font-black text-green-500">{entregados}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">completados</p>
          </div>
        </div>

        {/* ── Solicitudes de clientes sin asignar ──────────────────────────── */}
        {pendingClientOrders.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
              <h2 className="text-base font-bold text-gray-900 dark:text-white">
                Solicitudes sin asignar
              </h2>
              <span className="bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 text-xs font-bold px-2 py-0.5 rounded-full">
                {pendingClientOrders.length}
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pendingClientOrders.map(order => (
                <div
                  key={order.id}
                  className="bg-white dark:bg-gray-900 rounded-2xl border border-cyan-200 dark:border-cyan-900/50 shadow-sm p-5 flex flex-col gap-3"
                >
                  {/* Encabezado */}
                  <div className="flex items-center justify-between">
                    <div>
                      {order.client_name && (
                        <p className="font-semibold text-gray-900 dark:text-white text-sm mb-0.5">{order.client_name}</p>
                      )}
                      {order.client_phone && (
                        <p className="text-xs text-gray-400 dark:text-gray-500">{order.client_phone}</p>
                      )}
                      <span className="font-mono text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md">
                        #{order.id.slice(0, 8)}
                      </span>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                      order.payment_method === 'efectivo'
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                        : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                    }`}>
                      {order.payment_method === 'efectivo' ? '💵 Efectivo' : '📲 Transferencia'}
                    </span>
                  </div>

                  {/* Direcciones */}
                  <div className="space-y-2 text-sm">
                    <div className="flex gap-2">
                      <span className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">R</span>
                      <p className="text-gray-700 dark:text-gray-300 leading-tight line-clamp-2">{order.pickup_address || '—'}</p>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">E</span>
                      <p className="text-gray-700 dark:text-gray-300 leading-tight line-clamp-2">{order.delivery_address || '—'}</p>
                    </div>
                  </div>

                  {/* Base y descripción */}
                  <div className="flex items-center justify-between text-sm">
                    {order.base_amount ? (
                      <span className="font-bold text-gray-900 dark:text-white">
                        Base: ${Number(order.base_amount).toLocaleString('es-CO')}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">Sin base definida</span>
                    )}
                    <span className="text-xs text-gray-400">
                      {new Date(order.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {order.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 line-clamp-2">
                      {order.description}
                    </p>
                  )}

                  {/* Botones */}
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={() => { setAssignOrder(order); setAssignCourierId('') }}
                      className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold py-2.5 rounded-xl transition-colors"
                    >
                      🛵 Asignar mensajero
                    </button>
                    <button
                      onClick={() => { setTrackingOrder(order); setCopied(false) }}
                      className="bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-medium px-3 py-2.5 rounded-xl transition-colors"
                      title="Ver link de rastreo"
                    >
                      🔗
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Tabla de pedidos ─────────────────────────────────────────────── */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">

          {/* Tabla header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Todos los pedidos</h2>
            <button
              onClick={() => navigate('/orders/new')}
              className="flex items-center gap-2 text-black text-sm font-bold px-6 py-2.5 rounded-full transition-all shadow-md"
              style={{ backgroundColor: '#00E8E1', letterSpacing: '0.04em', boxShadow: '0 4px 18px rgba(0,232,225,0.35)' }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#00d4ce'; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,232,225,0.5)' }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#00E8E1'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 18px rgba(0,232,225,0.35)' }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              Nuevo pedido
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-4 border-orange-100 dark:border-orange-900/50 border-t-orange-500 rounded-full animate-spin" />
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <p className="text-gray-500 dark:text-gray-400 font-medium">No hay pedidos aún</p>
              <p className="text-sm text-gray-400 dark:text-gray-600 mt-1">Crea el primero con el botón de arriba</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
                    {['Pedido', 'Cliente', 'Dirección', 'Mensajero', 'Ítems', 'Estado', 'Acciones'].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-4 py-3 first:pl-6 last:pr-6">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {orders.map(order => (
                    <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">

                      {/* ID */}
                      <td className="pl-6 pr-4 py-4">
                        <span className="font-mono text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md">
                          {order.id.slice(0, 8)}
                        </span>
                      </td>

                      {/* Cliente */}
                      <td className="px-4 py-4">
                        {order.source === 'cliente' ? (
                          <span className="inline-flex items-center gap-1 bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 text-xs font-semibold px-2 py-1 rounded-full">
                            🌐 Solicitud web
                          </span>
                        ) : (
                          <>
                            <p className="font-semibold text-gray-900 dark:text-white">{order.client_name}</p>
                            <p className="text-gray-400 dark:text-gray-500 text-xs mt-0.5">{order.client_phone}</p>
                          </>
                        )}
                      </td>

                      {/* Dirección */}
                      <td className="px-4 py-4 text-gray-600 dark:text-gray-400 max-w-[200px]">
                        <p className="truncate">{order.delivery_address}</p>
                      </td>

                      {/* Mensajero */}
                      <td className="px-4 py-4">
                        {order.couriers?.name ? (
                          <span className="text-gray-700 dark:text-gray-300 font-medium">{order.couriers.name}</span>
                        ) : order.status === 'pendiente' ? (
                          <button
                            onClick={() => { setAssignOrder(order); setAssignCourierId('') }}
                            className="inline-flex items-center gap-1.5 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 font-semibold text-xs px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            Reasignar
                          </button>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </td>

                      {/* Ítems */}
                      <td className="px-4 py-4 text-gray-600 dark:text-gray-400">
                        {Array.isArray(order.items)
                          ? <span className="font-medium">{order.items.length}</span>
                          : '—'}
                      </td>

                      {/* Estado */}
                      <td className="px-4 py-4">
                        <StatusBadge status={order.status} />
                      </td>

                      {/* Acciones */}
                      <td className="px-4 py-4 pr-6">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setTrackingOrder(order); setCopied(false) }}
                            className="text-xs font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 px-3 py-1.5 rounded-lg transition-colors"
                          >
                            Seguimiento
                          </button>
                          {order.status !== 'entregado' && (
                            <button
                              onClick={() => { setAssignOrder(order); setAssignCourierId(order.courier_id || '') }}
                              className="text-xs font-medium bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/40 text-orange-600 dark:text-orange-400 px-3 py-1.5 rounded-lg transition-colors"
                            >
                              Asignar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* ── Modal: Tracking link ─────────────────────────────────────────── */}
      {trackingOrder && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-orange-50 dark:bg-orange-900/30 rounded-xl flex items-center justify-center">
                  <svg className="w-5 h-5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-white">Link de rastreo</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {trackingOrder.client_name || `Solicitud #${trackingOrder.id.slice(0, 8)}`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setTrackingOrder(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3.5 text-sm text-gray-700 dark:text-gray-300 break-all mb-4 font-mono leading-relaxed">
              {trackingOrder.tracking_token
                ? `${CLIENT_URL}/track/${trackingOrder.tracking_token}`
                : <span className="text-yellow-500 dark:text-yellow-400 font-sans">⚠ Este pedido aún no tiene link de rastreo generado</span>
              }
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => copyLink(trackingOrder.tracking_token)}
                disabled={!trackingOrder.tracking_token}
                className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-colors"
              >
                {copied ? (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copiado
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                    Copiar link
                  </>
                )}
              </button>
              <a
                href={trackingOrder.tracking_token ? `https://wa.me/?text=${encodeURIComponent(`Rastrea tu pedido en tiempo real: ${CLIENT_URL}/track/${trackingOrder.tracking_token}`)}` : undefined}
                onClick={!trackingOrder.tracking_token ? e => e.preventDefault() : undefined}
                target="_blank"
                rel="noopener noreferrer"
                className={`w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white font-bold py-3 rounded-xl transition-colors${!trackingOrder.tracking_token ? ' opacity-40 cursor-not-allowed pointer-events-none' : ''}`}
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm.029 18.88a7.947 7.947 0 01-3.801-.97l-4.215 1.107 1.129-4.12A7.95 7.95 0 014.063 12c0-4.4 3.579-7.98 7.979-7.98 4.4 0 7.979 3.58 7.979 7.98S16.43 18.88 12.03 18.88z"/>
                </svg>
                Compartir por WhatsApp
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Asignar mensajero ─────────────────────────────────────── */}
      {assignOrder && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-orange-50 dark:bg-orange-900/30 rounded-xl flex items-center justify-center">
                  <svg className="w-5 h-5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-white">Asignar mensajero</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {assignOrder.client_name || `Solicitud #${assignOrder.id.slice(0, 8)}`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAssignOrder(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <select
              value={assignCourierId}
              onChange={e => setAssignCourierId(e.target.value)}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm mb-5 focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 appearance-none cursor-pointer"
            >
              <option value="">Seleccionar mensajero...</option>
              {couriers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            <div className="flex gap-3">
              <button
                onClick={() => setAssignOrder(null)}
                className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 py-3 rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleAssign}
                disabled={assigning || !assignCourierId}
                className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl text-sm transition-colors"
              >
                {assigning ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Asignando...
                  </span>
                ) : 'Asignar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
