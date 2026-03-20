import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import axios from 'axios'
import { supabase } from '../lib/supabase'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL

export default function Tracking() {
  const { orderId } = useParams()
  const navigate = useNavigate()
  const intervalRef = useRef(null)

  const [courier, setCourier] = useState(null)
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tracking, setTracking] = useState(false)
  const [gpsError, setGpsError] = useState('')
  const [delivering, setDelivering] = useState(false)
  const [debugInfo, setDebugInfo] = useState('')
  const wakeLockRef = useRef(null)

  useEffect(() => {
    const stored = localStorage.getItem('courier')
    if (!stored) {
      navigate('/')
      return
    }
    const courierData = JSON.parse(stored)
    setCourier(courierData)
    fetchOrder()

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      // Liberar Wake Lock al salir
      if (wakeLockRef.current) {
        wakeLockRef.current.release()
        wakeLockRef.current = null
      }
    }
  }, [])

  async function fetchOrder() {
    const { data } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single()

    setOrder(data)
    setLoading(false)

    if (data) startTracking(data)
  }

  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen')
        // Reactivar si la pantalla se apagó temporalmente (ej. llamada)
        document.addEventListener('visibilitychange', async () => {
          if (document.visibilityState === 'visible' && wakeLockRef.current === null) {
            wakeLockRef.current = await navigator.wakeLock.request('screen')
          }
        })
      } catch (err) {
        console.warn('Wake Lock no disponible:', err)
      }
    }
  }

  function startTracking(orderData) {
    setGpsError('')
    navigator.geolocation.getCurrentPosition(
      () => {
        setTracking(true)
        requestWakeLock() // Mantener pantalla encendida
        const stored = JSON.parse(localStorage.getItem('courier'))

        intervalRef.current = setInterval(() => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const payload = {
                courier_id: stored.id,
                order_id: orderData.id,
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
              }
              axios.post(`${BACKEND_URL}/api/location`, payload)
                .then(() => setDebugInfo(`✓ ${new Date().toLocaleTimeString()} lat=${pos.coords.latitude.toFixed(4)} lng=${pos.coords.longitude.toFixed(4)}`))
                .catch(err => setDebugInfo(`✗ Error: ${err.message}`))
            },
            (err) => setDebugInfo(`✗ GPS error: ${err.message}`)
          )
        }, 3000)
      },
      () => {
        setGpsError('No se pudo acceder al GPS. Verifica los permisos de ubicación.')
      }
    )
  }

  function stopTracking() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setTracking(false)
  }

  async function markDelivered() {
    setDelivering(true)
    try {
      await axios.put(`${BACKEND_URL}/api/order/${orderId}/status`, {
        status: 'entregado',
      })
      stopTracking()
      navigate('/orders', { state: { message: '¡Pedido entregado exitosamente!' } })
    } catch {
      setDelivering(false)
    }
  }

  function handleStopTracking() {
    stopTracking()
    navigate('/orders')
  }

  if (loading || !order) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <p className="text-gray-400">Cargando pedido...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[480px] mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={handleStopTracking}
            className="text-gray-500 hover:text-gray-700"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-lg font-bold text-gray-900">Entrega activa</h2>
        </div>
      </div>

      <div className="max-w-[480px] mx-auto px-4 py-4 space-y-4">
        {/* Indicador de GPS */}
        <div className={`rounded-2xl px-4 py-3 flex items-center gap-3 ${
          tracking ? 'bg-green-50 border border-green-200' : 'bg-gray-100 border border-gray-200'
        }`}>
          {tracking ? (
            <>
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>
              <div>
                <span className="text-green-700 font-semibold text-sm block">Compartiendo ubicación</span>
                <span className="text-green-600 text-xs">Mantén esta pantalla abierta</span>
              </div>
            </>
          ) : (
            <>
              <span className="h-3 w-3 rounded-full bg-gray-400"></span>
              <span className="text-gray-500 text-sm">GPS inactivo</span>
            </>
          )}
        </div>

        {/* Error GPS */}
        {gpsError && (
          <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 text-sm">
            {gpsError}
          </div>
        )}

        {/* Debug GPS */}
        {debugInfo && (
          <div className="bg-gray-100 rounded-xl px-4 py-2 text-xs font-mono text-gray-600 break-all">
            {debugInfo}
          </div>
        )}

        {/* Info del pedido */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Detalle del pedido</h3>

          <div className="flex items-start gap-2 mb-2">
            <svg className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-sm font-semibold text-gray-800">{order.delivery_address}</p>
          </div>

          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <p className="text-sm text-gray-600">{order.client_name}</p>
          </div>

          {order.client_phone && (
            <div className="flex items-center gap-2 mt-1">
              <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              <a href={`tel:${order.client_phone}`} className="text-sm text-orange-500 font-medium">
                {order.client_phone}
              </a>
            </div>
          )}
        </div>

        {/* Items */}
        {order.items && order.items.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Items del pedido</h3>
            <ul className="space-y-2">
              {order.items.map((item, idx) => (
                <li key={idx} className="flex gap-2 text-sm">
                  <span className="font-bold text-orange-500 w-6 shrink-0">x{item.qty}</span>
                  <div>
                    <span className="font-medium text-gray-800">{item.name}</span>
                    {item.description && (
                      <p className="text-gray-400 text-xs mt-0.5">{item.description}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Botones de acción */}
        <div className="space-y-3 pt-2 pb-6">
          <button
            onClick={markDelivered}
            disabled={delivering}
            className="w-full bg-green-500 hover:bg-green-600 active:bg-green-700 text-white font-bold text-lg py-4 rounded-2xl transition-colors disabled:opacity-60 shadow-sm"
          >
            {delivering ? 'Marcando...' : '✓ Marcar como entregado'}
          </button>

          <button
            onClick={handleStopTracking}
            className="w-full bg-red-500 hover:bg-red-600 active:bg-red-700 text-white font-semibold text-lg py-4 rounded-2xl transition-colors shadow-sm"
          >
            Detener rastreo
          </button>
        </div>
      </div>
    </div>
  )
}
