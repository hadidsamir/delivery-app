import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Orders() {
  const [courier, setCourier] = useState(null)
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [successMsg, setSuccessMsg] = useState('')
  const [actionLoading, setActionLoading] = useState(null)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const stored = localStorage.getItem('courier')
    if (!stored) { navigate('/'); return }
    const courierData = JSON.parse(stored)
    setCourier(courierData)
    fetchOrders(courierData.id)

    if (location.state?.message) {
      setSuccessMsg(location.state.message)
      setTimeout(() => setSuccessMsg(''), 4000)
    }

    // Realtime: escuchar nuevos pedidos asignados a este mensajero
    const channel = supabase
      .channel('courier-orders-' + courierData.id)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload) => {
          if (payload.new.courier_id === courierData.id) {
            fetchOrders(courierData.id)
          }
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          if (payload.new.courier_id === courierData.id ||
              payload.old?.courier_id === courierData.id) {
            fetchOrders(courierData.id)
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  async function fetchOrders(courierId) {
    setLoading(true)
    const { data } = await supabase
      .from('orders')
      .select('*')
      .eq('courier_id', courierId)
      .in('status', ['pendiente', 'en_camino'])
      .order('created_at', { ascending: true })
    setOrders(data || [])
    setLoading(false)
  }

  async function acceptOrder(orderId) {
    setActionLoading(orderId)
    await supabase.from('orders').update({ status: 'en_camino' }).eq('id', orderId)
    setActionLoading(null)
    fetchOrders(courier.id)
  }

  async function rejectOrder(orderId) {
    const confirmed = window.confirm('¿Rechazar este pedido? Será devuelto al administrador para reasignarlo.')
    if (!confirmed) return
    setActionLoading(orderId + '-reject')
    await supabase.from('orders').update({ status: 'pendiente', courier_id: null }).eq('id', orderId)
    setActionLoading(null)
    fetchOrders(courier.id)
  }

  function handleLogout() {
    localStorage.removeItem('courier')
    navigate('/')
  }

  if (!courier) return null

  const pendientes = orders.filter(o => o.status === 'pendiente')
  const enCamino = orders.filter(o => o.status === 'en_camino')

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[480px] mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">Bienvenido</p>
            <h2 className="text-lg font-bold text-gray-900">{courier.name}</h2>
          </div>
          <button onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-red-500 border border-gray-200 hover:border-red-300 px-3 py-2 rounded-lg transition-colors">
            Cerrar sesión
          </button>
        </div>
      </div>

      <div className="max-w-[480px] mx-auto px-4 py-4">
        {successMsg && (
          <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 mb-4 text-sm font-medium">
            ✓ {successMsg}
          </div>
        )}

        {/* ── PEDIDOS PENDIENTES ── */}
        {pendientes.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></span>
              <h3 className="text-base font-bold text-gray-900">
                Nuevos pedidos ({pendientes.length})
              </h3>
            </div>

            <div className="space-y-3">
              {pendientes.map((order) => (
                <div key={order.id} className="bg-white rounded-2xl border-2 border-yellow-300 shadow-sm p-4">
                  <span className="inline-block bg-yellow-100 text-yellow-700 text-xs font-bold px-2 py-1 rounded-full mb-3">
                    ⏳ Nuevo pedido asignado
                  </span>

                  <div className="flex items-start gap-2 mb-2">
                    <svg className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <p className="text-sm font-semibold text-gray-800">{order.delivery_address}</p>
                  </div>

                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <p className="text-sm text-gray-600">{order.client_name}</p>
                  </div>

                  {order.client_phone && (
                    <div className="flex items-center gap-2 mb-3">
                      <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                      <a href={`tel:${order.client_phone}`} className="text-sm text-orange-500 font-medium">
                        {order.client_phone}
                      </a>
                    </div>
                  )}

                  {order.items?.length > 0 && (
                    <div className="bg-gray-50 rounded-xl p-3 mb-3">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Items</p>
                      <ul className="space-y-0.5">
                        {order.items.map((item, idx) => (
                          <li key={idx} className="text-sm text-gray-700">
                            <span className="font-medium text-orange-500">x{item.qty}</span> {item.name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => rejectOrder(order.id)}
                      disabled={actionLoading !== null}
                      className="flex-1 border-2 border-red-300 text-red-600 hover:bg-red-50 font-semibold py-3 rounded-xl transition-colors disabled:opacity-50 text-sm"
                    >
                      {actionLoading === order.id + '-reject' ? 'Rechazando...' : '✕ Rechazar'}
                    </button>
                    <button
                      onClick={() => acceptOrder(order.id)}
                      disabled={actionLoading !== null}
                      className="flex-1 bg-green-500 hover:bg-green-600 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-50 text-sm"
                    >
                      {actionLoading === order.id ? 'Aceptando...' : '✓ Aceptar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── ENTREGAS EN CAMINO ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {enCamino.length > 0 && (
                <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse"></span>
              )}
              <h3 className="text-base font-bold text-gray-900">
                Entregas activas {enCamino.length > 0 ? `(${enCamino.length})` : ''}
              </h3>
            </div>
            <button onClick={() => fetchOrders(courier.id)} className="text-orange-500 text-sm font-medium">
              Actualizar
            </button>
          </div>

          {loading ? (
            <div className="text-center py-12 text-gray-400">Cargando pedidos...</div>
          ) : enCamino.length === 0 && pendientes.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-5xl mb-3">📦</div>
              <p className="text-gray-500">No tienes pedidos asignados</p>
            </div>
          ) : enCamino.length === 0 ? null : (
            <div className="space-y-3">
              {enCamino.map((order) => (
                <div key={order.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  {enCamino.length > 1 && order.delivery_order && (
                    <span className="inline-block bg-orange-100 text-orange-600 text-xs font-semibold px-2 py-0.5 rounded-full mb-2">
                      Entrega #{order.delivery_order} de {enCamino.length}
                    </span>
                  )}

                  <div className="flex items-start gap-2 mb-2">
                    <svg className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <p className="text-sm font-semibold text-gray-800">{order.delivery_address}</p>
                  </div>

                  <div className="flex items-center gap-2 mb-3">
                    <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <p className="text-sm text-gray-600">{order.client_name}</p>
                  </div>

                  {order.items?.length > 0 && (
                    <div className="bg-gray-50 rounded-xl p-3 mb-3">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Items del pedido</p>
                      <ul className="space-y-1">
                        {order.items.map((item, idx) => (
                          <li key={idx} className="text-sm text-gray-700">
                            <span className="font-medium">x{item.qty}</span> {item.name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <button
                    onClick={() => navigate(`/tracking/${order.id}`)}
                    className="w-full bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-semibold py-3.5 rounded-xl transition-colors"
                  >
                    Iniciar entrega
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
