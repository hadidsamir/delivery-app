import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { io } from 'socket.io-client'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL

export function useOrderTracking(token) {
  const [state, setState] = useState({
    status: 'loading', // 'loading' | 'error' | 'tracking' | 'delivered'
    order: null,
    courier: null,
    totalActiveOrders: 1,
    courierLocation: null,
    errorMessage: '',
  })

  const socketRef = useRef(null)

  useEffect(() => {
    if (!token || token === 'demo') {
      setState(s => ({ ...s, status: 'error', errorMessage: 'Pedido no encontrado' }))
      return
    }

    let cancelled = false

    async function fetchOrder() {
      try {
        const res = await axios.get(`${BACKEND_URL}/api/order/${token}`)
        if (cancelled) return

        const { order, active_orders_count, last_location } = res.data
        // El mensajero viene embebido en order.couriers por el join de Supabase
        const courier = order.couriers ?? null
        const totalActiveOrders = active_orders_count ?? 1
        const initialLocation = last_location
          ? { lat: last_location.latitude, lng: last_location.longitude }
          : null

        if (order.status === 'entregado') {
          setState(s => ({
            ...s,
            status: 'delivered',
            order,
            courier,
            totalActiveOrders,
          }))
          return
        }

        setState(s => ({
          ...s,
          status: 'tracking',
          order,
          courier,
          totalActiveOrders,
          courierLocation: initialLocation,
        }))

        // Conectar WebSocket — polling primero para compatibilidad con Railway/proxies
        const socket = io(BACKEND_URL, {
          transports: ['polling', 'websocket'],
          upgrade: true,
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
          forceNew: true,
        })
        socketRef.current = socket

        socket.on('connect', () => {
          console.log('[Socket] Conectado:', socket.id)
          socket.emit('join:order', order.id)
        })

        socket.on('disconnect', (reason) => {
          console.log('[Socket] Desconectado:', reason)
        })

        socket.on('connect_error', (err) => {
          console.error('[Socket] Error de conexión:', err.message)
        })

        socket.on('location:update', ({ latitude, longitude }) => {
          console.log('[Socket] Ubicación recibida:', latitude, longitude)
          setState(s => ({ ...s, courierLocation: { lat: latitude, lng: longitude } }))
        })

        socket.on('order:delivered', () => {
          setState(s => ({ ...s, status: 'delivered' }))
        })
      } catch (err) {
        if (cancelled) return
        if (err.response?.status === 404) {
          setState(s => ({ ...s, status: 'error', errorMessage: 'Pedido no encontrado' }))
        } else {
          setState(s => ({ ...s, status: 'error', errorMessage: 'Error de conexión, intenta de nuevo' }))
        }
      }
    }

    fetchOrder()

    return () => {
      cancelled = true
      if (socketRef.current) {
        socketRef.current.disconnect()
      }
    }
  }, [token])

  return state
}
