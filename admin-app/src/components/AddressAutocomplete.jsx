import { useEffect, useRef, useState } from 'react'

/**
 * Campo de dirección con autocompletado de Google Places.
 * Requiere que el script de Google Maps esté cargado en index.html.
 */
export default function AddressAutocomplete({ value, onChange, onSelect, placeholder, className }) {
  const inputRef = useRef(null)
  const autocompleteRef = useRef(null)
  const [ready, setReady] = useState(false)

  // Esperar a que window.google esté disponible
  useEffect(() => {
    if (window.google?.maps?.places) {
      setReady(true)
      return
    }
    // Si el script aún no cargó, reintentar cada 200ms
    const interval = setInterval(() => {
      if (window.google?.maps?.places) {
        setReady(true)
        clearInterval(interval)
      }
    }, 200)
    return () => clearInterval(interval)
  }, [])

  // Inicializar Autocomplete cuando la librería esté lista
  useEffect(() => {
    if (!ready || !inputRef.current || autocompleteRef.current) return

    autocompleteRef.current = new window.google.maps.places.Autocomplete(
      inputRef.current,
      {
        types: ['geocode', 'establishment'],
        componentRestrictions: { country: 'co' },
        fields: ['formatted_address', 'geometry', 'name', 'place_id'],
      }
    )

    autocompleteRef.current.addListener('place_changed', () => {
      const place = autocompleteRef.current.getPlace()
      if (place?.geometry) {
        const address = place.formatted_address || place.name
        const lat = place.geometry.location.lat()
        const lng = place.geometry.location.lng()
        onChange(address)
        onSelect?.({ address, lat, lng })
      }
    })

    return () => {
      if (window.google && inputRef.current) {
        window.google.maps.event.clearInstanceListeners(inputRef.current)
      }
    }
  }, [ready])

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder || 'Escribe una dirección...'}
      autoComplete="off"
      className={className}
    />
  )
}
