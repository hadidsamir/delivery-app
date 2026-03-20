import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Orders() {
  const [courier, setCourier] = useState(null)
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [successMsg, setSuccessMsg] = useState('')
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const stored = localStorage.getItem('courier')
    if (!stored) {
      navigate('/')
      return
    }
    const courierData = JSON.parse(stored)
    setCourier(courierData)
    fetchOrders(courierData.id)

    // Mensaje de éxito desde /tracking
    if (location.state?.message) {
      setSuccessMsg(location.state.message)
      setTimeout(() => setSuccessMsg(''), 4000)
    }
  }, [])

  async function fetchOrders(courierId) {
    setLoading(true)
    const { data } = await supabase
      .from('orders')
      .select('*')
      .eq('courier_id', courierId)
      .eq('status', 'en_camino')
      .order('delivery_order', { ascending: true })

    setOrders(data || [])
    setLoading(false)
  }

  function handleLogout() {
    localStorage.removeItem('courier')
    navigate('/')
  }

  function startDelivery(orderId) {
    navigate(`/tracking/${orderId}`)
  }

  if (!courier) return null

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[480px] mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">Bienvenido</p>
            <h2 className="text-lg font-bold text-gray-900">{courier.name}</h2>
          </div>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-red-500 border border-gray-200 hover:border-red-300 px-3 py-2 rounded-lg transition-colors"
          >
            Cerrar sesión
          </button>
        </div>
      </div>

      <div className="max-w-[480px] mx-auto px-4 py-4">
        {/* Mensaje de éxito */}
        {successMsg && (
          <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 mb-4 text-sm font-medium">
            ✓ {successMsg}
          </div>
        )}

        {/* Título */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-gray-900">Pedidos activos</h3>
          <button
            onClick={() => fetchOrders(courier.id)}
            className="text-orange-500 text-sm font-medium"
          >
            Actualizar
          </button>
        </div>

        {/* Lista de pedidos */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">Cargando pedidos...</div>
        ) : orders.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-5xl mb-3">📦</div>
            <p className="text-gray-500">No tienes pedidos activos</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <div key={order.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                {/* Número de entrega si hay varios */}
                {orders.length > 1 && order.delivery_order && (
                  <span className="inline-block bg-orange-100 text-orange-600 text-xs font-semibold px-2 py-0.5 rounded-full mb-2">
                    Entrega #{order.delivery_order} de {orders.length}
                  </span>
                )}

                {/* Dirección */}
                <div className="flex items-start gap-2 mb-2">
                  <svg className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <p className="text-sm font-semibold text-gray-800">{order.delivery_address}</p>
                </div>

                {/* Cliente */}
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  <p className="text-sm text-gray-600">{order.client_name}</p>
                </div>

                {/* Items */}
                {order.items && order.items.length > 0 && (
                  <div className="bg-gray-50 rounded-xl p-3 mb-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Items del pedido</p>
                    <ul className="space-y-1">
                      {order.items.map((item, idx) => (
                        <li key={idx} className="text-sm text-gray-700">
                          <span className="font-medium">x{item.qty}</span> {item.name}
                          {item.description && (
                            <span className="text-gray-400 text-xs"> — {item.description}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Botón */}
                <button
                  onClick={() => startDelivery(order.id)}
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
  )
}
