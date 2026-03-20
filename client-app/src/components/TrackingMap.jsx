import { useRef, useEffect, useState } from 'react'
import { GoogleMap, useJsApiLoader, Marker } from '@react-google-maps/api'

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY

const DEFAULT_CENTER = { lat: 4.711, lng: -74.0721 } // Bogotá por defecto

const mapStyles = [
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
]

function TrackingMap({ courierLocation, deliveryAddress }) {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: MAPS_KEY,
    libraries: ['geocoding'],
  })

  const mapRef = useRef(null)
  const [destCoords, setDestCoords] = useState(null)
  const centeredRef = useRef(false)

  // Geocodificar la dirección de entrega una sola vez
  useEffect(() => {
    if (!isLoaded || !deliveryAddress || destCoords) return

    const geocoder = new window.google.maps.Geocoder()
    geocoder.geocode({ address: deliveryAddress }, (results, status) => {
      if (status === 'OK' && results[0]) {
        const loc = results[0].geometry.location
        setDestCoords({ lat: loc.lat(), lng: loc.lng() })
      }
    })
  }, [isLoaded, deliveryAddress, destCoords])

  // Centrar el mapa en el mensajero al primer update de ubicación
  useEffect(() => {
    if (courierLocation && mapRef.current && !centeredRef.current) {
      mapRef.current.panTo(courierLocation)
      centeredRef.current = true
    } else if (courierLocation && mapRef.current) {
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

  const center = courierLocation || destCoords || DEFAULT_CENTER

  return (
    <div className="rounded-2xl overflow-hidden shadow-md" style={{ height: 350 }}>
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={center}
        zoom={15}
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

        {/* Marcador destino — azul */}
        {destCoords && (
          <Marker
            position={destCoords}
            icon={{
              path: window.google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
              scale: 7,
              fillColor: '#3B82F6',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 2,
            }}
            title="Destino"
          />
        )}
      </GoogleMap>
    </div>
  )
}

export default TrackingMap
