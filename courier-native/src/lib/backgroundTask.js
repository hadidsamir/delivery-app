import * as TaskManager from 'expo-task-manager'
import AsyncStorage from '@react-native-async-storage/async-storage'

export const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION'
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
        // Guardar timestamp del ultimo GPS exitoso para mostrar en UI
        const time = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        await AsyncStorage.setItem('lastGpsUpdate', `${time}  ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`)
        return
      }
    } catch (err) {
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 1200))
      } else {
        console.error('[BG Task] GPS no enviado tras 3 intentos:', err.message)
      }
    }
  }
}

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
