import * as TaskManager from 'expo-task-manager'
import AsyncStorage from '@react-native-async-storage/async-storage'

export const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION'
const BACKEND_URL = 'https://delivery-app-production-9c98.up.railway.app'

async function sendLocation(courier_id, order_id, latitude, longitude, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courier_id, order_id, latitude, longitude }),
      })
      if (res.ok) {
        console.log(`[BG Task] GPS enviado lat=${latitude.toFixed(4)} lng=${longitude.toFixed(4)}`)
        return
      }
    } catch (err) {
      if (i === retries) {
        console.error('[BG Task] Error enviando GPS (sin mas reintentos):', err.message)
      } else {
        console.warn(`[BG Task] Reintento ${i + 1}...`)
        await new Promise(r => setTimeout(r, 1000))
      }
    }
  }
}

// Define la tarea ANTES de que la app monte cualquier componente
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('[BG Task] Error:', error.message)
    return
  }

  if (!data) return

  const { locations } = data
  const location = locations[0]
  if (!location) return

  try {
    const stored = await AsyncStorage.getItem('activeDelivery')
    if (!stored) return

    const { courier_id, order_id } = JSON.parse(stored)
    await sendLocation(
      courier_id,
      order_id,
      location.coords.latitude,
      location.coords.longitude
    )
  } catch (err) {
    console.error('[BG Task] Error leyendo AsyncStorage:', err.message)
  }
})
