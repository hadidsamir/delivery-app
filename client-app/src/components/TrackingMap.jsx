import { useRef, useEffect, useState } from 'react'
import { GoogleMap, useJsApiLoader, Marker } from '@react-google-maps/api'

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY

const LIBRARIES = []
const DEFAULT_CENTER = { lat: 4.711, lng: -74.0721 }

// Duración de la animación entre posiciones GPS.
// Debe ser MAYOR que el intervalo GPS (3s) para que el marcador siempre esté
// en movimiento — igual que el tracking de WhatsApp.
const ANIM_DURATION = 3200 // ms

const mapStyles = [
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
]

async function geocodeAddress(address) {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${MAPS_KEY}`
    const res  = await fetch(url)
    const data = await res.json()
    if (data.results?.length > 0) {
      const { lat, lng } = data.results[0].geometry.location
      return { lat, lng }
    }
    return null
  } catch {
    return null
  }
}

// Curva ease-in-out cúbica para un deslizamiento natural
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

// ── Indicador de señal GPS ────────────────────────────────────────────────────
function GpsStatus({ lastLocationTime }) {
  const [secondsAgo, setSecondsAgo] = useState(0)

  useEffect(() => {
    if (!lastLocationTime) return
    const update = () => setSecondsAgo(Math.floor((Date.now() - lastLocationTime) / 1000))
    update()
    const id = setInterval(update, 5000)
    return () => clearInterval(id)
  }, [lastLocationTime])

  if (!lastLocationTime) return null

  const isLive = secondsAgo < 30

  if (isLive) {
    return (
      <div className="flex items-center justify-center gap-1.5 text-xs text-green-600 font-medium">
        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
        En vivo
      </div>
    )
  }

  const mins  = Math.floor(secondsAgo / 60)
  const label = mins < 1 ? 'hace menos de 1 min' : mins === 1 ? 'hace 1 min' : `hace ${mins} min`

  return (
    <div className="flex items-center justify-center gap-1.5 text-xs text-yellow-600 font-medium bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-1.5">
      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
      GPS pausado · última posición {label}
    </div>
  )
}

// ── Hook de animación suave ───────────────────────────────────────────────────
// Interpola entre la posición anterior y la nueva usando requestAnimationFrame.
// Devuelve la posición animada que se debe mostrar en el mapa.
function useSmoothPosition(targetPosition) {
  const [animatedPos, setAnimatedPos] = useState(null)

  // Guardar la posición actual que se está mostrando (no la del target)
  const currentRef  = useRef(null)
  const animRef     = useRef(null)

  useEffect(() => {
    if (!targetPosition) return

    // Primera posición: mostrar inmediatamente, sin animar
    if (!currentRef.current) {
      currentRef.current = targetPosition
      setAnimatedPos(targetPosition)
      return
    }

    // Cancelar animación anterior si existía
    if (animRef.current) {
      cancelAnimationFrame(animRef.current)
      animRef.current = null
    }

    // Tomar snapshot de dónde está el marcador AHORA (puede ser mitad de animación)
    const from = currentRef.current
    const to   = targetPosition
    let   startTime = null

    function frame(timestamp) {
      if (!startTime) startTime = timestamp

      const t      = Math.min((timestamp - startTime) / ANIM_DURATION, 1)
      const eased  = easeInOut(t)
      const pos    = {
        lat: from.lat + (to.lat - from.lat) * eased,
        lng: from.lng + (to.lng - from.lng) * eased,
      }

      currentRef.current = pos
      setAnimatedPos(pos)          // provoca re-render del Marker (~60fps)

      if (t < 1) {
        animRef.current = requestAnimationFrame(frame)
      } else {
        animRef.current = null
      }
    }

    animRef.current = requestAnimationFrame(frame)

    return () => {
      if (animRef.current) {
        cancelAnimationFrame(animRef.current)
        animRef.current = null
      }
    }
  }, [targetPosition])

  return animatedPos
}

// ── Componente principal ──────────────────────────────────────────────────────
function TrackingMap({ courierLocation, deliveryAddress, deliveryLat, deliveryLng, lastLocationTime }) {
  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: MAPS_KEY, libraries: LIBRARIES })

  const mapRef        = useRef(null)
  const boundsSetRef  = useRef(false)
  const userZoomedRef = useRef(false)

  const [destinationCoords, setDestinationCoords] = useState(null)

  // Posición del mensajero con animación suave entre actualizaciones GPS
  const animatedPosition = useSmoothPosition(courierLocation)

  // Usar coordenadas de BD primero; geocodificar solo como fallback
  useEffect(() => {
    if (deliveryLat && deliveryLng) {
      setDestinationCoords({ lat: deliveryLat, lng: deliveryLng })
      return
    }
    if (!deliveryAddress || destinationCoords) return
    geocodeAddress(deliveryAddress).then(coords => {
      if (coords) setDestinationCoords(coords)
    })
  }, [deliveryAddress, deliveryLat, deliveryLng])

  // fitBounds inicial: encuadrar mensajero + destino la primera vez
  useEffect(() => {
    if (!mapRef.current || !courierLocation || !destinationCoords) return
    if (boundsSetRef.current) return
    const bounds = new window.google.maps.LatLngBounds()
    bounds.extend(courierLocation)
    bounds.extend(destinationCoords)
    mapRef.current.fitBounds(bounds, { top: 80, bottom: 80, left: 40, right: 40 })
    boundsSetRef.current = true
  }, [destinationCoords, courierLocation])

  // Mover la cámara cuando llega una nueva posición GPS (panTo ya es suave)
  useEffect(() => {
    if (!courierLocation || !mapRef.current || !boundsSetRef.current) return
    if (userZoomedRef.current) {
      mapRef.current.panTo(courierLocation)
      return
    }
    if (destinationCoords) {
      const bounds = new window.google.maps.LatLngBounds()
      bounds.extend(courierLocation)
      bounds.extend(destinationCoords)
      mapRef.current.fitBounds(bounds, { top: 80, bottom: 80, left: 40, right: 40 })
    } else {
      mapRef.current.panTo(courierLocation)
    }
  }, [courierLocation])

  if (!isLoaded) {
    return (
      <div className="bg-gray-100 rounded-2xl flex items-center justify-center"
           style={{ height: 'clamp(300px, 55vw, 440px)' }}>
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const center = courierLocation || destinationCoords || DEFAULT_CENTER

  const destinationIcon = {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
        <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 26 18 26S36 31.5 36 18C36 8.06 27.94 0 18 0z" fill="#1D4ED8"/>
        <circle cx="18" cy="18" r="7" fill="white"/>
      </svg>
    `)}`,
    scaledSize: new window.google.maps.Size(36, 44),
    anchor:     new window.google.maps.Point(18, 44),
  }

  return (
    <div className="space-y-2">
      <div className="rounded-2xl overflow-hidden shadow-lg" style={{ height: 'clamp(300px, 55vw, 440px)' }}>
        <GoogleMap
          mapContainerStyle={{ width: '100%', height: '100%' }}
          center={center}
          zoom={courierLocation ? 15 : 13}
          onLoad={map => {
            mapRef.current = map
            map.addListener('zoom_changed', () => {
              if (boundsSetRef.current) userZoomedRef.current = true
            })
          }}
          options={{
            styles: mapStyles,
            disableDefaultUI: true,
            zoomControl: true,
            zoomControlOptions: { position: window.google.maps.ControlPosition.RIGHT_CENTER },
            gestureHandling: 'greedy',
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
          }}
        >
          {/* Mensajero — círculo naranja con borde blanco, se mueve suavemente */}
          {animatedPosition && (
            <Marker
              position={animatedPosition}
              icon={{
                path: window.google.maps.SymbolPath.CIRCLE,
                scale: 13,
                fillColor: '#F97316',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 3,
              }}
              title="Tu mensajero"
              zIndex={2}
            />
          )}

          {/* Destino — pin azul fijo */}
          {destinationCoords && (
            <Marker
              position={destinationCoords}
              icon={destinationIcon}
              title="Dirección de entrega"
              zIndex={1}
            />
          )}
        </GoogleMap>
      </div>

      <GpsStatus lastLocationTime={lastLocationTime} />

      <div className="flex items-center justify-center gap-6 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-orange-500 inline-block shrink-0" />
          <span>Tu mensajero</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-blue-700 inline-block shrink-0" />
          <span>Dirección de entrega</span>
        </div>
      </div>
    </div>
  )
}

export default TrackingMap
