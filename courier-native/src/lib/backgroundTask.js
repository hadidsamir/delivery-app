import * as TaskManager from 'expo-task-manager'
import * as Location from 'expo-location'
import AsyncStorage from '@react-native-async-storage/async-storage'

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
      distanceInterval: 50,
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

// Tarea keepalive: solo mantiene el proceso vivo para que Supabase Realtime funcione
// cuando el mensajero está en la pantalla de pedidos con la app minimizada
TaskManager.defineTask(KEEPALIVE_TASK, async ({ data, error }) => {
  if (error) return
  // Solo registrar que sigue activo — no enviar ubicación
  console.log('[Keepalive] Proceso activo, Realtime conectado')
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
    const { courier_id, order_id } = JSON.parse(stored)
    await sendLocation(courier_id, order_id, latitude, longitude)
  } catch (err) {
    console.error('[BG Task] Error leyendo AsyncStorage:', err.message)
  }
})
