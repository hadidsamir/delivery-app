import * as TaskManager from 'expo-task-manager'
import AsyncStorage from '@react-native-async-storage/async-storage'

export const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION'
const BACKEND_URL = 'https://delivery-app-production-9c98.up.railway.app'

// Define la tarea ANTES de que la app monte cualquier componente
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('[BG Task] Error:', error.message)
    return
  }

  if (data) {
    const { locations } = data
    const location = locations[0]
    if (!location) return

    try {
      const stored = await AsyncStorage.getItem('activeDelivery')
      if (!stored) return

      const { courier_id, order_id } = JSON.parse(stored)

      await fetch(`${BACKEND_URL}/api/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courier_id,
          order_id,
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        }),
      })

      console.log(`[BG Task] GPS enviado lat=${location.coords.latitude.toFixed(4)} lng=${location.coords.longitude.toFixed(4)}`)
    } catch (err) {
      console.error('[BG Task] Error enviando ubicación:', err.message)
    }
  }
})
