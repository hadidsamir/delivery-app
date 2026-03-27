import { useState, useRef, useCallback } from 'react'
import { GoogleMap, useJsApiLoader, Marker } from '@react-google-maps/api'
import AddressAutocomplete from '../components/AddressAutocomplete'

const MAPS_KEY   = import.meta.env.VITE_GOOGLE_MAPS_KEY
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL

// Fuera del componente para evitar recargar la librería en cada render
const LIBRARIES = ['places']

const mapContainerStyle = { width: '100%', height: '220px', borderRadius: '12px' }

const mapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  styles: [
    { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  ],
}

// Marcador de recogida (naranja)
const PICKUP_ICON = {
  path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5 14.5 7.62 14.5 9 13.38 11.5 12 11.5z',
  fillColor: '#F97316',
  fillOpacity: 1,
  strokeColor: '#fff',
  strokeWeight: 2,
  scale: 1.6,
  anchor: { x: 12, y: 22 },
}

// Marcador de entrega (azul)
const DELIVERY_ICON = {
  path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5 14.5 7.62 14.5 9 13.38 11.5 12 11.5z',
  fillColor: '#3B82F6',
  fillOpacity: 1,
  strokeColor: '#fff',
  strokeWeight: 2,
  scale: 1.6,
  anchor: { x: 12, y: 22 },
}

// ── Pantalla de confirmación ──────────────────────────────────────────────────
function ConfirmationView({ orderId }) {
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-4 py-10">
      <div className="bg-gray-900 rounded-2xl p-8 max-w-sm w-full text-center shadow-xl border border-gray-800">
        {/* Check animado */}
        <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-5">
          <svg className="w-10 h-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">¡Solicitud enviada!</h2>
        <p className="text-gray-400 mb-5 text-sm">
          Un mensajero tomará tu servicio en breve. Recibirás el link de rastreo cuando sea asignado.
        </p>
        <div className="bg-gray-800 rounded-xl px-4 py-3 mb-6">
          <p className="text-xs text-gray-500 mb-1">Número de solicitud</p>
          <p className="text-orange-400 font-mono font-semibold text-lg tracking-widest">
            #{orderId.slice(0, 8).toUpperCase()}
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="w-full bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-semibold py-3 rounded-xl transition-colors"
        >
          Nueva solicitud
        </button>
      </div>
    </div>
  )
}

// ── Formulario principal ──────────────────────────────────────────────────────
export default function RequestPage() {
  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: MAPS_KEY, libraries: LIBRARIES })

  // Campos del formulario
  const [pickupAddress,   setPickupAddress]   = useState('')
  const [pickupCoords,    setPickupCoords]    = useState(null)   // { lat, lng }
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [deliveryCoords,  setDeliveryCoords]  = useState(null)
  const [baseAmount,      setBaseAmount]      = useState('')   // valor numérico real
  const [baseDisplay,     setBaseDisplay]     = useState('')   // valor formateado con puntos
  const [paymentMethod,   setPaymentMethod]   = useState('efectivo')
  const [description,     setDescription]     = useState('')

  // Estado UI
  const [submitting, setSubmitting]   = useState(false)
  const [error,      setError]        = useState('')
  const [confirmedId, setConfirmedId] = useState(null)
  const submittingRef = useRef(false)

  // Mapa ref para ajustar bounds cuando hay dos marcadores
  const mapRef = useRef(null)
  const onMapLoad = useCallback((map) => { mapRef.current = map }, [])

  // Ajustar el mapa cuando se tienen ambas coordenadas
  const fitBothMarkers = useCallback((pickup, delivery) => {
    if (!mapRef.current || !pickup || !delivery) return
    const bounds = new window.google.maps.LatLngBounds()
    bounds.extend(pickup)
    bounds.extend(delivery)
    mapRef.current.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 })
  }, [])

  const handlePickupSelect = ({ address, lat, lng }) => {
    setPickupAddress(address)
    setPickupCoords({ lat, lng })
    if (deliveryCoords) fitBothMarkers({ lat, lng }, deliveryCoords)
  }

  const handleDeliverySelect = ({ address, lat, lng }) => {
    setDeliveryAddress(address)
    setDeliveryCoords({ lat, lng })
    if (pickupCoords) fitBothMarkers(pickupCoords, { lat, lng })
  }

  const mapCenter = pickupCoords || deliveryCoords || { lat: 10.4634, lng: -73.2532 }

  // Formatea el campo base con puntos de miles mientras el usuario escribe
  const handleBaseChange = (e) => {
    const raw = e.target.value.replace(/\D/g, '')
    if (raw === '') { setBaseAmount(''); setBaseDisplay(''); return }
    const num = parseInt(raw, 10)
    if (num > 10000000) return
    setBaseAmount(String(num))
    setBaseDisplay(num.toLocaleString('es-CO'))
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submittingRef.current) return
    setError('')

    if (!pickupAddress.trim()) return setError('Ingresa la dirección de recogida')
    if (!deliveryAddress.trim()) return setError('Ingresa la dirección de entrega')
    if (baseAmount !== '' && (isNaN(Number(baseAmount)) || Number(baseAmount) < 0)) {
      return setError('La base debe ser un número positivo')
    }

    submittingRef.current = true
    setSubmitting(true)

    try {
      const res = await fetch(`${BACKEND_URL}/api/orders/public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pickup_address:   pickupAddress.trim(),
          pickup_lat:       pickupCoords?.lat  ?? null,
          pickup_lng:       pickupCoords?.lng  ?? null,
          delivery_address: deliveryAddress.trim(),
          delivery_lat:     deliveryCoords?.lat ?? null,
          delivery_lng:     deliveryCoords?.lng ?? null,
          base_amount:      baseAmount !== '' ? Number(baseAmount) : null,
          payment_method:   paymentMethod,
          description:      description.trim() || null,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Error enviando la solicitud. Intenta de nuevo.')
        return
      }

      setConfirmedId(data.order_id)
    } catch {
      setError('Sin conexión. Verifica tu internet e intenta de nuevo.')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  // ── Vista de confirmación ───────────────────────────────────────────────────
  if (confirmedId) return <ConfirmationView orderId={confirmedId} />

  // ── Formulario ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 px-4 py-8">
      <div className="max-w-lg mx-auto">

        {/* Header */}
        <div className="text-center mb-8">
          <img src="/logo.png" alt="1012Delivery" className="h-16 mx-auto mb-4 object-contain" />
          <h1 className="text-3xl font-bold text-white">Solicitar servicio</h1>
          <p className="text-gray-400 mt-1 text-sm">Completa los datos para solicitar un mensajero</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* ── Mapa con ambos marcadores ── */}
          {isLoaded && (pickupCoords || deliveryCoords) && (
            <div className="rounded-2xl overflow-hidden border border-gray-800 shadow-lg">
              <GoogleMap
                mapContainerStyle={mapContainerStyle}
                center={mapCenter}
                zoom={14}
                options={mapOptions}
                onLoad={onMapLoad}
              >
                {pickupCoords && (
                  <Marker
                    position={pickupCoords}
                    icon={PICKUP_ICON}
                    title="Punto de recogida"
                  />
                )}
                {deliveryCoords && (
                  <Marker
                    position={deliveryCoords}
                    icon={DELIVERY_ICON}
                    title="Punto de entrega"
                  />
                )}
              </GoogleMap>
              {/* Leyenda */}
              <div className="bg-gray-900 px-4 py-2 flex gap-5 text-xs text-gray-400">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-orange-500 inline-block" />
                  Recogida
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" />
                  Entrega
                </span>
              </div>
            </div>
          )}

          {/* ── Recogida ── */}
          <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold text-sm">1</span>
              <h2 className="text-white font-semibold">¿Dónde recogemos?</h2>
            </div>
            {isLoaded ? (
              <AddressAutocomplete
                value={pickupAddress}
                onChange={setPickupAddress}
                onSelect={handlePickupSelect}
                placeholder="Dirección de recogida..."
                className="w-full bg-gray-800 text-white placeholder-gray-500 rounded-xl px-4 py-3 text-sm border border-gray-700 focus:outline-none focus:border-orange-500 transition-colors"
              />
            ) : (
              <input
                type="text"
                value={pickupAddress}
                onChange={e => setPickupAddress(e.target.value)}
                placeholder="Cargando mapa..."
                className="w-full bg-gray-800 text-white placeholder-gray-500 rounded-xl px-4 py-3 text-sm border border-gray-700 focus:outline-none focus:border-orange-500"
              />
            )}
          </div>

          {/* ── Entrega ── */}
          <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-sm">2</span>
              <h2 className="text-white font-semibold">¿A dónde lo llevamos?</h2>
            </div>
            {isLoaded ? (
              <AddressAutocomplete
                value={deliveryAddress}
                onChange={setDeliveryAddress}
                onSelect={handleDeliverySelect}
                placeholder="Dirección de entrega..."
                className="w-full bg-gray-800 text-white placeholder-gray-500 rounded-xl px-4 py-3 text-sm border border-gray-700 focus:outline-none focus:border-blue-500 transition-colors"
              />
            ) : (
              <input
                type="text"
                value={deliveryAddress}
                onChange={e => setDeliveryAddress(e.target.value)}
                placeholder="Cargando mapa..."
                className="w-full bg-gray-800 text-white placeholder-gray-500 rounded-xl px-4 py-3 text-sm border border-gray-700 focus:outline-none focus:border-blue-500"
              />
            )}
          </div>

          {/* ── Detalles del servicio ── */}
          <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 space-y-4">
            <h2 className="text-white font-semibold">Detalles del servicio</h2>

            {/* Base */}
            <div>
              <label className="block text-gray-400 text-xs mb-1.5">
                Base del mensajero <span className="text-gray-600">(opcional)</span>
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={baseDisplay}
                  onChange={handleBaseChange}
                  placeholder="0"
                  className="w-full bg-gray-800 text-white placeholder-gray-500 rounded-xl pl-8 pr-4 py-3 text-sm border border-gray-700 focus:outline-none focus:border-orange-500 transition-colors"
                />
              </div>
            </div>

            {/* Método de pago */}
            <div>
              <label className="block text-gray-400 text-xs mb-2">Método de pago</label>
              <div className="flex gap-3">
                {[
                  { value: 'efectivo',      label: '💵 Efectivo'      },
                  { value: 'transferencia', label: '📲 Transferencia' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPaymentMethod(opt.value)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                      paymentMethod === opt.value
                        ? 'bg-orange-500/20 border-orange-500 text-orange-300'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Descripción */}
            <div>
              <label className="block text-gray-400 text-xs mb-1.5">
                ¿Qué vas a enviar? <span className="text-gray-600">(opcional)</span>
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Describe brevemente lo que envías..."
                maxLength={500}
                rows={3}
                className="w-full bg-gray-800 text-white placeholder-gray-500 rounded-xl px-4 py-3 text-sm border border-gray-700 focus:outline-none focus:border-orange-500 transition-colors resize-none"
              />
              <p className="text-right text-gray-600 text-xs mt-1">{description.length}/500</p>
            </div>
          </div>

          {/* ── Error ── */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* ── Botón enviar ── */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-orange-500 hover:bg-orange-600 active:bg-orange-700 disabled:bg-orange-500/40 disabled:cursor-not-allowed text-white font-bold py-4 rounded-2xl text-base transition-colors shadow-lg shadow-orange-500/20"
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Enviando solicitud...
              </span>
            ) : '🛵 Solicitar mensajero'}
          </button>

          <p className="text-center text-gray-600 text-xs pb-4">
            Al enviar aceptas los términos del servicio de 1012Delivery
          </p>

        </form>
      </div>
    </div>
  )
}
