import * as TaskManager from 'expo-task-manager'
import * as Location from 'expo-location'
import * as Notifications from 'expo-notifications'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

export const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION'
export const KEEPALIVE_TASK = 'ORDERS_KEEPALIVE'

// ─── Keepalive a nivel de módulo ─────────────────────────────────────────────
// Vive fuera del ciclo de vida de cualquier componente.
let _keepaliveStarting = false

export async function startAppKeepalive() {
  if (_keepaliveStarting) return
  _keepaliveStarting = true
  try {
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== 'granted') return
    const already = await Location.hasStartedLocationUpdatesAsync(KEEPALIVE_TASK).catch(() => false)
    if (already) return
    await new Promise(r => setTimeout(r, 1200))
    await Location.startLocationUpdatesAsync(KEEPALIVE_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 30000,
      distanceInterval: 0,
      foregroundService: {
        notificationTitle: '1012Delivery',
        notificationBody: 'Esperando pedidos nuevos…',
        notificationColor: '#F97316',
      },
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: false,
    })
    console.log('[App] Keepalive iniciado')
  } catch (err) {
    console.warn('[App] Keepalive error:', err.message)
  } finally {
    // Siempre liberar el mutex para que se pueda reintentar si el servicio muere
    _keepaliveStarting = false
  }
}

export async function stopAppKeepalive() {
  _keepaliveStarting = false
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(KEEPALIVE_TASK).catch(() => false)
    if (running) await Location.stopLocationUpdatesAsync(KEEPALIVE_TASK)
  } catch {}
}

// ─── GPS Background Task ──────────────────────────────────────────────────────
const BACKEND_URL = 'https://delivery-app-production-9c98.up.railway.app'

async function sendLocation(courier_id, order_id, latitude, longitude) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courier_id, order_id, latitude, longitude }),
      })
      if (res.ok) {
        const time = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        await AsyncStorage.setItem('lastGpsUpdate', `${time}  ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`)
        return
      }
      // Respuesta no-ok (4xx/5xx): reintentar con delay
      if (attempt < 2) await new Promise(r => setTimeout(r, 1200))
      else console.error('[BG Task] GPS rechazado por servidor tras 3 intentos, status:', res.status)
    } catch (err) {
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 1200))
      } else {
        console.error('[BG Task] GPS no enviado tras 3 intentos:', err.message)
      }
    }
  }
}

// Lock de módulo: evita que múltiples disparos de la tarea (por location updates rápidos)
// corran en paralelo y lean AsyncStorage antes de que el anterior haya escrito.
let _keepaliveTaskRunning = false

// Tarea keepalive: consulta Supabase y notifica pedidos nuevos
TaskManager.defineTask(KEEPALIVE_TASK, async ({ error }) => {
  if (error) { console.error('[Keepalive] Error de tarea:', error.message); return }
  if (_keepaliveTaskRunning) return  // evitar ejecuciones concurrentes
  _keepaliveTaskRunning = true
  try {
    const stored = await AsyncStorage.getItem('courier')
    if (!stored) return

    let courierId
    try {
      const parsed = JSON.parse(stored)
      courierId = parsed?.id
    } catch {
      console.warn('[Keepalive] Datos de courier corruptos en AsyncStorage')
      return
    }
    if (!courierId) return

    // Consultar pedidos pendientes asignados a este mensajero
    const { data: orders, error: dbError } = await supabase
      .from('orders')
      .select('id, client_name, delivery_address, status, created_at')
      .eq('courier_id', courierId)
      .eq('status', 'pendiente')

    if (dbError || !orders?.length) return

    // IDs ya notificados (AsyncStorage persiste entre ciclos y entre procesos)
    const notifiedStr = await AsyncStorage.getItem('keepaliveNotified') || '[]'
    const notified = new Set(JSON.parse(notifiedStr))

    const now = Date.now()
    const newOrders = orders.filter(o => {
      if (notified.has(o.id)) return false
      // Solo notificar pedidos con más de 15s de antigüedad.
      // Esto da tiempo al canal Realtime para notificar primero (evita duplicados).
      const ageMs = now - new Date(o.created_at).getTime()
      return ageMs > 15000
    })
    if (!newOrders.length) return

    // Marcar como notificado ANTES de enviar para evitar duplicados si el envío falla
    for (const order of newOrders) {
      notified.add(order.id)
    }
    await AsyncStorage.setItem('keepaliveNotified', JSON.stringify([...notified].slice(-50)))

    // Enviar notificaciones
    for (const order of newOrders) {
      await Notifications.scheduleNotificationAsync({
        identifier: 'order-' + order.id,
        content: {
          title: '🛵 Nuevo pedido asignado',
          body: `${order.client_name}\n📍 ${order.delivery_address}`,
          sound: true,
          channelId: 'pedidos',
          categoryIdentifier: 'nuevo_pedido',
          data: { orderId: order.id },
        },
        trigger: null,
      }).catch(() => {})
    }

    console.log('[Keepalive] Nuevos pedidos notificados:', newOrders.length)
  } catch (err) {
    console.warn('[Keepalive] Error:', err.message)
  } finally {
    _keepaliveTaskRunning = false
  }
})

// IMPORTANTE: defineTask debe ejecutarse al inicio del proceso (antes de montar componentes)
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('[BG Task] Error de localización:', error.message)
    return
  }
  if (!data?.locations?.length) return

  const { latitude, longitude } = data.locations[0].coords

  try {
    const stored = await AsyncStorage.getItem('activeDelivery')
    if (!stored) {
      console.log('[BG Task] Sin entrega activa - ignorando')
      return
    }
    let courier_id, order_id
    try {
      const parsed = JSON.parse(stored)
      courier_id = parsed?.courier_id
      order_id   = parsed?.order_id
    } catch {
      console.warn('[BG Task] Datos de activeDelivery corruptos')
      return
    }
    if (!courier_id || !order_id) return
    await sendLocation(courier_id, order_id, latitude, longitude)
  } catch (err) {
    console.error('[BG Task] Error leyendo AsyncStorage:', err.message)
  }
})
