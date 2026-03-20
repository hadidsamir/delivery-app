import { useRef, useEffect } from 'react'
import { GoogleMap, useJsApiLoader, Marker } from '@react-google-maps/api'

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY

// ⚠️ Definir fuera del componente para evitar recrear el array en cada render
const LIBRARIES = []

const DEFAULT_CENTER = { lat: 4.711, lng: -74.0721 } // Bogotá por defecto

const mapStyles = [
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
]

function TrackingMap({ courierLocation }) {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: MAPS_KEY,
    libraries: LIBRARIES,
  })

  const mapRef = useRef(null)

  // Seguir al mensajero en cada actualización
  useEffect(() => {
    if (courierLocation && mapRef.current) {
      mapRef.current.panTo(courierLocation)
    }
  }, [courierLocation])

  if (!isLoaded) {
    return (
      <div className="bg-gray-100 rounded-2xl flex items-center justify-center" style={{ height: 350 }}>
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  const center = courierLocation || DEFAULT_CENTER

  return (
    <div className="rounded-2xl overflow-hidden shadow-md" style={{ height: 350 }}>
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={center}
        zoom={courierLocation ? 16 : 12}
        onLoad={map => { mapRef.current = map }}
        options={{
          styles: mapStyles,
          disableDefaultUI: true,
          zoomControl: true,
        }}
      >
        {/* Marcador mensajero — naranja */}
        {courierLocation && (
          <Marker
            position={courierLocation}
            icon={{
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: 12,
              fillColor: '#F97316',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 3,
            }}
            title="Mensajero"
          />
        )}
      </GoogleMap>
    </div>
  )
}

export default TrackingMap
