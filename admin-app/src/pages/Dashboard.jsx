import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const CLIENT_URL = import.meta.env.VITE_CLIENT_APP_URL || 'http://localhost:5175'

const STATUS_BADGE = {
  pendiente:  'bg-gray-100 text-gray-600',
  en_camino:  'bg-orange-100 text-orange-700',
  entregado:  'bg-green-100 text-green-700',
}
const STATUS_LABEL = {
  pendiente: 'Pendiente',
  en_camino: 'En camino',
  entregado: 'Entregado',
}

function isToday(dateStr) {
  const d = new Date(dateStr)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [couriers, setCouriers] = useState([])
  const [loading, setLoading] = useState(true)

  // Modals
  const [trackingOrder, setTrackingOrder] = useState(null)
  const [assignOrder, setAssignOrder] = useState(null)
  const [assignCourierId, setAssignCourierId] = useState('')
  const [copied, setCopied] = useState(false)
  const [assigning, setAssigning] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [{ data: ordersData }, { data: couriersData }] = await Promise.all([
      supabase
        .from('orders')
        .select('*, couriers(name)')
        .order('created_at', { ascending: false }),
      supabase.from('couriers').select('id, name').eq('is_active', true),
    ])
    setOrders(ordersData || [])
    setCouriers(couriersData || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Supabase Realtime — actualizar tabla cuando cambie el estado de un pedido
  useEffect(() => {
    const channel = supabase
      .channel('orders-changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          setOrders(prev =>
            prev.map(order =>
              order.id === payload.new.id
                ? { ...order, ...payload.new }
                : order
            )
          )
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        () => {
          fetchData() // recargar para obtener el JOIN con couriers
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [fetchData])

  function logout() {
    localStorage.removeItem('admin_auth')
    navigate('/login')
  }

  // Stats
  const todayOrders = orders.filter(o => isToday(o.created_at))
  const enCamino = orders.filter(o => o.status === 'en_camino').length
  const entregadosHoy = todayOrders.filter(o => o.status === 'entregado').length

  // Copy link
  async function copyLink(token) {
    const url = `${CLIENT_URL}/track/${token}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Assign courier
  async function handleAssign() {
    if (!assignCourierId) return
    setAssigning(true)
    await supabase.from('orders').update({ courier_id: assignCourierId }).eq('id', assignOrder.id)
    setAssigning(false)
    setAssignOrder(null)
    setAssignCourierId('')
    fetchData()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-orange-500 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-gray-900">Panel de Domicilios</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/couriers')}
            className="text-sm text-gray-600 hover:text-orange-600 font-medium flex items-center gap-1.5 border border-gray-200 px-3 py-2 rounded-lg hover:border-orange-300 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Mensajeros
          </button>
          <button
            onClick={logout}
            className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1.5"
          >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Cerrar sesión
        </button>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Total pedidos hoy', value: todayOrders.length, color: 'text-gray-900' },
            { label: 'En camino', value: enCamino, color: 'text-orange-500' },
            { label: 'Entregados hoy', value: entregadosHoy, color: 'text-green-600' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <p className="text-sm text-gray-500">{s.label}</p>
              <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Table header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Todos los pedidos</h2>
          <button
            onClick={() => navigate('/orders/new')}
            className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2.5 rounded-lg flex items-center gap-2 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nuevo pedido
          </button>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin"></div>
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-16 text-gray-400">No hay pedidos aún</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {['#ID', 'Cliente', 'Dirección', 'Mensajero', 'Ítems', 'Estado', 'Acciones'].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {orders.map(order => (
                    <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-gray-500">{order.id.slice(0, 8)}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{order.client_name}</p>
                        <p className="text-gray-400 text-xs">{order.client_phone}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600 max-w-[180px] truncate">{order.delivery_address}</td>
                      <td className="px-4 py-3 text-gray-700">{order.couriers?.name || <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {Array.isArray(order.items) ? order.items.length : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_BADGE[order.status] || 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABEL[order.status] || order.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setTrackingOrder(order); setCopied(false) }}
                            className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition-colors"
                          >
                            Ver tracking
                          </button>
                          <button
                            onClick={() => { setAssignOrder(order); setAssignCourierId(order.courier_id || '') }}
                            className="text-xs bg-orange-50 hover:bg-orange-100 text-orange-700 px-3 py-1.5 rounded-lg transition-colors"
                          >
                            Asignar
                          </button>
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

      {/* Modal Tracking */}
      {trackingOrder && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Link de rastreo</h3>
              <button onClick={() => setTrackingOrder(null)} className="text-gray-400 hover:text-gray-700">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-xs text-gray-500 mb-2">Cliente: <span className="font-medium text-gray-800">{trackingOrder.client_name}</span></p>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-700 break-all mb-4">
              {CLIENT_URL}/track/{trackingOrder.tracking_token}
            </div>

            <div className="flex flex-col gap-2">
              <button
                onClick={() => copyLink(trackingOrder.tracking_token)}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2.5 rounded-lg transition-colors"
              >
                {copied ? '¡Copiado!' : 'Copiar link'}
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`Rastrea tu pedido aquí: ${CLIENT_URL}/track/${trackingOrder.tracking_token}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-green-500 hover:bg-green-600 text-white font-semibold py-2.5 rounded-lg transition-colors text-center"
              >
                Compartir por WhatsApp
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Modal Asignar mensajero */}
      {assignOrder && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Asignar mensajero</h3>
              <button onClick={() => setAssignOrder(null)} className="text-gray-400 hover:text-gray-700">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-sm text-gray-500 mb-3">Pedido de <span className="font-medium text-gray-800">{assignOrder.client_name}</span></p>

            <select
              value={assignCourierId}
              onChange={e => setAssignCourierId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
            >
              <option value="">Seleccionar mensajero...</option>
              {couriers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            <div className="flex gap-3">
              <button
                onClick={() => setAssignOrder(null)}
                className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleAssign}
                disabled={assigning || !assignCourierId}
                className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
              >
                {assigning ? 'Asignando...' : 'Asignar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
