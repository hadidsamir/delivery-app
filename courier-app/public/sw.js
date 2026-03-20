// Service Worker — GPS en segundo plano v2
let gpsInterval = null

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', () => self.clients.claim())

self.addEventListener('message', (event) => {
  const { type, payload } = event.data

  if (type === 'START_GPS') {
    if (gpsInterval) clearInterval(gpsInterval)

    gpsInterval = setInterval(() => {
      self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
        clients.forEach(client => client.postMessage({ type: 'REQUEST_LOCATION' }))
      })
    }, 8000)
  }

  if (type === 'LOCATION_UPDATE') {
    const { latitude, longitude, courier_id, order_id, backendUrl } = payload
    fetch(`${backendUrl}/api/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courier_id, order_id, latitude, longitude }),
    }).catch(err => console.log('[SW] Error enviando ubicación:', err))
  }

  if (type === 'STOP_GPS') {
    if (gpsInterval) {
      clearInterval(gpsInterval)
      gpsInterval = null
    }
  }
})
