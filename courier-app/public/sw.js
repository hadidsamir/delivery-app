// Service Worker — GPS en segundo plano
let gpsInterval = null
let orderData = null

self.addEventListener('message', (event) => {
  const { type, payload } = event.data

  if (type === 'START_GPS') {
    orderData = payload
    console.log('[SW] GPS iniciado en segundo plano:', orderData)

    // Limpiar intervalo anterior si existía
    if (gpsInterval) clearInterval(gpsInterval)

    // Solicitar ubicación cada 10 segundos al tab activo
    gpsInterval = setInterval(() => {
      if (!orderData) return
      self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(client => client.postMessage({ type: 'REQUEST_LOCATION' }))
      })
    }, 10000)
  }

  if (type === 'LOCATION_UPDATE') {
    const { latitude, longitude, courier_id, order_id, backendUrl } = payload

    fetch(`${backendUrl}/api/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courier_id, order_id, latitude, longitude }),
    })
      .then(() => console.log(`[SW] Ubicación enviada: lat=${latitude} lng=${longitude}`))
      .catch(err => console.log('[SW] Error enviando ubicación:', err))
  }

  if (type === 'STOP_GPS') {
    if (gpsInterval) {
      clearInterval(gpsInterval)
      gpsInterval = null
    }
    orderData = null
    console.log('[SW] GPS detenido')
  }
})

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', () => self.clients.claim())
