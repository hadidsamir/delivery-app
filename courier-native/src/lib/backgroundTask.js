import * as TaskManager from 'expo-task-manager'
import * as Location from 'expo-location'
import * as Notifications from 'expo-notifications'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { BACKEND_URL } from './config'

export const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION'
export const KEEPALIVE_TASK = 'ORDERS_KEEPALIVE'

// ─── Cola offline ─────────────────────────────────────────────────────────────
// Guarda hasta 20 ubicaciones cuando no hay red. Se vacía en el próximo envío exitoso.
const OFFLINE_QUEUE_KEY = 'gpsOfflineQueue'
const MAX_QUEUE_SIZE = 20

async function enqueueOffline(entry) {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY)
    const queue = raw ? JSON.parse(raw) : []
    queue.push(entry)
    if (queue.length > MAX_QUEUE_SIZE) queue.splice(0, queue.length - MAX_QUEUE_SIZE)
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue))
  } catch {}
}

async function flushOfflineQueue(courier_id, order_id) {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY)
    if (!raw) return
    const queue = JSON.parse(raw)
    if (!queue.length) return
    // Enviar de más antiguo a más nuevo, parar en el primero que falle
    const sent = []
    for (const entry of queue) {
      const ok = await sendLocationOnce(entry.courier_id || courier_id, entry.order_id || order_id, entry.lat, entry.lng)
      if (ok) sent.push(entry)
      else break
    }
    if (sent.length) {
      const remaining = queue.slice(sent.length)
      await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining))
      console.log(`[BG] Cola offline: enviados ${sent.length}, quedan ${remaining.length}`)
    }
  } catch {}
}

// ─── Envío individual (sin reintentos, retorna bool) ─────────────────────────
async function sendLocationOnce(courier_id, order_id, latitude, longitude) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courier_id, order_id, latitude, longitude }),
    })
    return res.ok
  } catch {
    return false
  }
}

// ─── Envío con reintentos + cola offline ─────────────────────────────────────
const RETRY_DELAYS = [1000, 2500, 5000]  // 3 intentos: 1s, 2.5s, 5s

async function sendLocation(courier_id, order_id, latitude, longitude) {
  // Primero intentar vaciar la cola offline (sin bloquear si falla)
  flushOfflineQueue(courier_id, order_id).catch(() => {})

  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    const ok = await sendLocationOnce(courier_id, order_id, latitude, longitude)
    if (ok) {
      const time = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      await AsyncStorage.setItem('lastGpsUpdate', `${time}  ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`)
      return
    }
    if (attempt < RETRY_DELAYS.length - 1) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]))
    } else {
      // Último intento falló → encolar para envío posterior
      console.warn('[BG] GPS no enviado tras 3 intentos. Encolando offline.')
      await enqueueOffline({ courier_id, order_id, lat: latitude, lng: longitude, ts: Date.now() })
    }
  }
}

// ─── Watchdog: reinicia el GPS si se detiene inesperadamente ─────────────────
let _watchdogTimer = null

export function startGpsWatchdog(courier_id, order_id) {
  stopGpsWatchdog()
  _watchdogTimer = setInterval(async () => {
    try {
      const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false)
      if (!running) {
        console.warn('[Watchdog] GPS detenido inesperadamente. Reiniciando…')
        await restartDeliveryGps(courier_id, order_id)
      }
    } catch (err) {
      console.warn('[Watchdog] Error:', err.message)
    }
  }, 15000) // Revisa cada 15 segundos
}

export function stopGpsWatchdog() {
  if (_watchdogTimer) {
    clearInterval(_watchdogTimer)
    _watchdogTimer = null
  }
}

async function restartDeliveryGps(courier_id, order_id) {
  try {
    // Asegurar que los datos estén en AsyncStorage
    await AsyncStorage.setItem('activeDelivery', JSON.stringify({ courier_id, order_id }))

    const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false)
    if (alreadyRunning) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {})
    await new Promise(r => setTimeout(r, 600))

    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 4000,
      distanceInterval: 0,
      foregroundService: {
        notificationTitle: '1012Delivery · Rastreo activo',
        notificationBody: 'Compartiendo ubicación con el cliente',
        notificationColor: '#F97316',
        killServiceOnDestroy: false,
      },
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      activityType: Location.ActivityType.AutomotiveNavigation,
      deferredUpdatesInterval: 0,
      deferredUpdatesDistance: 0,
    })
    console.log('[Watchdog] GPS reiniciado correctamente')
  } catch (err) {
    console.error('[Watchdog] No se pudo reiniciar GPS:', err.message)
  }
}

// ─── Keepalive: servicio de fondo siempre activo ─────────────────────────────
let _keepaliveStarting = false

export async function startAppKeepalive() {
  if (_keepaliveStarting) return
  _keepaliveStarting = true
  try {
    // Pedir permiso de ubicación en primer plano (mínimo requerido)
    const { status: fg } = await Location.requestForegroundPermissionsAsync()
    if (fg !== 'granted') return

    // Intentar pedir permiso de fondo (Android 10+, iOS siempre)
    // No bloqueamos si el usuario lo niega — el foreground service igualmente funciona
    await Location.requestBackgroundPermissionsAsync().catch(() => {})

    const already = await Location.hasStartedLocationUpdatesAsync(KEEPALIVE_TASK).catch(() => false)
    if (already) { _keepaliveStarting = false; return }

    await new Promise(r => setTimeout(r, 1200))

    await Location.startLocationUpdatesAsync(KEEPALIVE_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 30000,
      distanceInterval: 0,
      foregroundService: {
        notificationTitle: '1012Delivery',
        notificationBody: 'Esperando pedidos nuevos…',
        notificationColor: '#F97316',
        killServiceOnDestroy: false,
      },
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: false,
    })
    console.log('[App] Keepalive iniciado')
  } catch (err) {
    console.warn('[App] Keepalive error:', err.message)
  } finally {
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

// ─── Envío de ubicación idle (sin entrega activa) ────────────────────────────
async function sendIdleLocation(courierId, latitude, longitude) {
  try {
    await fetch(`${BACKEND_URL}/api/courier/idle-location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courier_id: courierId, latitude, longitude }),
    })
  } catch {}
}

// ─── Verificar pedidos disponibles (servicios de clientes sin mensajero) ──────
export async function checkAvailableOrders(courierId) {
  if (!courierId) return
  try {
    const { data: available, error } = await supabase
      .from('orders')
      .select('id, pickup_address, delivery_address, base_amount, payment_method, created_at')
      .is('courier_id', null)
      .eq('status', 'pendiente')
      .eq('source', 'cliente')

    if (error || !available?.length) return

    const notifiedStr = await AsyncStorage.getItem('availableNotified') || '[]'
    const notified = new Set(JSON.parse(notifiedStr))

    const newOrders = available.filter(o => !notified.has(o.id))
    if (!newOrders.length) return

    for (const order of newOrders) notified.add(order.id)
    await AsyncStorage.setItem('availableNotified', JSON.stringify([...notified].slice(-50)))

    for (const order of newOrders) {
      const amount = order.base_amount
        ? ` • $${Number(order.base_amount).toLocaleString('es-CO')}`
        : ''
      await Notifications.scheduleNotificationAsync({
        identifier: 'available-' + order.id,
        content: {
          title: '🔔 Nuevo Servicio Disponible' + amount,
          body: `📦 ${order.pickup_address || 'Recogida'}\n📍 ${order.delivery_address}`,
          sound: 'nuevo_servicio',
          channelId: 'nuevo_servicio_v2',
          priority: Notifications.AndroidNotificationPriority.MAX,
          data: { availableOrderId: order.id },
        },
        trigger: null,
      }).catch(() => {})
    }
    console.log('[Notif] Servicios disponibles notificados:', newOrders.length)
  } catch (err) {
    console.warn('[checkAvailableOrders] Error:', err.message)
  }
}

// ─── Verificar y notificar pedidos asignados al mensajero ────────────────────
export async function checkAndNotifyOrders(courierId) {
  if (!courierId) return
  try {
    const { data: orders, error: dbError } = await supabase
      .from('orders')
      .select('id, client_name, delivery_address, status, created_at')
      .eq('courier_id', courierId)
      .eq('status', 'pendiente')

    if (dbError || !orders?.length) return

    const notifiedStr = await AsyncStorage.getItem('keepaliveNotified') || '[]'
    const notified = new Set(JSON.parse(notifiedStr))

    const newOrders = orders.filter(o => !notified.has(o.id))
    if (!newOrders.length) return

    for (const order of newOrders) notified.add(order.id)
    await AsyncStorage.setItem('keepaliveNotified', JSON.stringify([...notified].slice(-50)))

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
    console.log('[Notif] Pedidos notificados:', newOrders.length)
  } catch (err) {
    console.warn('[checkAndNotifyOrders] Error:', err.message)
  }
}

// ─── Tarea Keepalive ──────────────────────────────────────────────────────────
let _keepaliveTaskRunning = false

TaskManager.defineTask(KEEPALIVE_TASK, async ({ data, error }) => {
  if (error) { console.error('[Keepalive] Error de tarea:', error.message); return }
  if (_keepaliveTaskRunning) return
  _keepaliveTaskRunning = true
  try {
    const stored = await AsyncStorage.getItem('courier')
    if (!stored) return
    let courierId
    try { courierId = JSON.parse(stored)?.id } catch { return }

    await checkAndNotifyOrders(courierId)
    await checkAvailableOrders(courierId)

    const activeDeliveryStr = await AsyncStorage.getItem('activeDelivery')
    if (data?.locations?.length) {
      const { latitude, longitude } = data.locations[0].coords
      if (activeDeliveryStr) {
        // BACKUP GPS: si hay entrega activa, también enviamos desde el keepalive
        // por si el BACKGROUND_LOCATION_TASK fue matado por Android
        try {
          const { courier_id, order_id } = JSON.parse(activeDeliveryStr)
          if (courier_id && order_id) {
            const bgRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false)
            if (!bgRunning) {
              // El GPS de entrega murió — enviamos desde aquí y lo reiniciamos
              console.warn('[Keepalive] BG task muerto. Enviando backup GPS y reiniciando…')
              await sendLocation(courier_id, order_id, latitude, longitude)
              restartDeliveryGps(courier_id, order_id).catch(() => {})
            }
          }
        } catch {}
      } else {
        sendIdleLocation(courierId, latitude, longitude).catch(() => {})
      }
    }
  } catch (err) {
    console.warn('[Keepalive] Error:', err.message)
  } finally {
    _keepaliveTaskRunning = false
  }
})

// ─── Tarea GPS principal (durante entrega activa) ─────────────────────────────
// IMPORTANTE: defineTask debe ejecutarse al inicio del proceso (antes de montar componentes)
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('[BG Task] Error de localización:', error.message)
    return
  }
  if (!data?.locations?.length) return

  const { latitude, longitude, accuracy } = data.locations[0].coords

  // Descartar lecturas muy imprecisas (>50m de error)
  if (accuracy !== null && accuracy > 50) {
    console.log(`[BG Task] Lectura descartada por baja precisión: ${accuracy?.toFixed(0)}m`)
    return
  }

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
