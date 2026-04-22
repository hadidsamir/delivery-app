import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { GoogleMap, useJsApiLoader, Marker, InfoWindow } from '@react-google-maps/api'
import { supabase } from '../lib/supabase'
import Logo from '../components/Logo'
import ThemeToggle from '../components/ThemeToggle'
import { useTheme } from '../hooks/useTheme'

const MAPS_KEY   = import.meta.env.VITE_GOOGLE_MAPS_KEY
const LIBRARIES  = ['places']

// Centro por defecto: Valledupar
const DEFAULT_CENTER = { lat: 10.4631, lng: -73.2532 }

const MAP_STYLE_DARK = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a8a9a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2d2d44' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1a1a2e' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d1117' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
]

export default function CourierMap() {
  const navigate   = useNavigate()
  const { dark, toggleTheme } = useTheme()
  const [couriers, setCouriers]   = useState([])  // { id, name, phone, photo_url, lat, lng, updated_at }
  const [selected, setSelected]   = useState(null) // courier seleccionado en mapa
  const [lastUpdate, setLastUpdate] = useState(null)
  const channelRef = useRef(null)

  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: MAPS_KEY, libraries: LIBRARIES })

  // Cargar ubicaciones actuales de todos los mensajeros activos
  const fetchLocations = useCallback(async () => {
    // Traer la ubicación más reciente de cada mensajero activo
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()

    const { data: locs, error } = await supabase
      .from('courier_locations')
      .select('courier_id, latitude, longitude, updated_at, couriers!inner(id, name, phone, photo_url, is_active)')
      .eq('couriers.is_active', true)
      .gte('updated_at', since)
      .order('updated_at', { ascending: false })

    if (error) { console.error('[CourierMap] Error:', error.message); return }

    // Deduplicar: quedarse con la ubicación más reciente por mensajero
    const seen = new Set()
    const mapped = (locs || [])
      .filter(loc => {
        if (seen.has(loc.courier_id)) return false
        seen.add(loc.courier_id)
        return true
      })
      .map(loc => ({
        id:         loc.courier_id,
        name:       loc.couriers.name,
        phone:      loc.couriers.phone,
        photo_url:  loc.couriers.photo_url,
        lat:        loc.latitude,
        lng:        loc.longitude,
        updated_at: loc.updated_at,
      }))

    setCouriers(mapped)
    setLastUpdate(new Date())
  }, [])

  useEffect(() => {
    fetchLocations()

    // Suscribirse a cambios en courier_locations en tiempo real
    channelRef.current = supabase
      .channel('courier-map-locations')
      .on('postgres_changes', {
        event:  '*',
        schema: 'public',
        table:  'courier_locations',
      }, (payload) => {
        const loc = payload.new
        if (!loc) return
        setCouriers(prev => {
          const exists = prev.find(c => c.id === loc.courier_id)
          if (exists) {
            return prev.map(c => c.id === loc.courier_id
              ? { ...c, lat: loc.latitude, lng: loc.longitude, updated_at: loc.updated_at }
              : c
            )
          }
          // Si es un mensajero nuevo, recargar todo
          fetchLocations()
          return prev
        })
        setLastUpdate(new Date())
      })
      .subscribe()

    // Cada minuto reaplica el filtro de actividad para ocultar mensajeros inactivos
    const pruneTimer = setInterval(() => {
      setCouriers(prev => prev.filter(c => {
        if (!c.updated_at) return false
        return (Date.now() - new Date(c.updated_at)) / 60000 <= 10
      }))
    }, 60000)

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current)
      clearInterval(pruneTimer)
    }
  }, [fetchLocations])

  function formatTime(dateStr) {
    if (!dateStr) return 'Sin datos'
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
    if (diff < 60)  return `Hace ${diff}s`
    if (diff < 3600) return `Hace ${Math.floor(diff / 60)}min`
    return `Hace ${Math.floor(diff / 3600)}h`
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors flex flex-col">

      {/* ── Header ── */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 z-10">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Logo size="sm" />
            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">Mapa en vivo</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {couriers.length} mensajero{couriers.length !== 1 ? 's' : ''} activo{couriers.length !== 1 ? 's' : ''}
                {lastUpdate && ` · Actualizado ${formatTime(lastUpdate)}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle dark={dark} onToggle={toggleTheme} />
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-orange-500 dark:hover:text-orange-400 border border-gray-200 dark:border-gray-700 px-3 py-2 rounded-xl hover:border-orange-300 dark:hover:border-orange-700 transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Volver
            </button>
          </div>
        </div>
      </header>

      {/* ── Mapa ── */}
      <div className="flex flex-1">

        {/* Sidebar con lista de mensajeros */}
        <aside className="w-72 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 overflow-y-auto">
          <div className="p-4">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
              Mensajeros en campo
            </h2>

            {couriers.length === 0 ? (
              <div className="text-center py-10 text-gray-400 dark:text-gray-600">
                <svg className="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                </svg>
                <p className="text-sm">Ningún mensajero activo con ubicación</p>
              </div>
            ) : (
              <div className="space-y-2">
                {couriers.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c)}
                    className={`w-full text-left p-3 rounded-xl border transition-all ${
                      selected?.id === c.id
                        ? 'border-orange-400 bg-orange-50 dark:bg-orange-900/20'
                        : 'border-gray-100 dark:border-gray-800 hover:border-orange-200 dark:hover:border-orange-800'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {c.photo_url ? (
                        <img src={c.photo_url} alt={c.name} className="w-9 h-9 rounded-full object-cover" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center text-orange-600 font-bold text-sm">
                          {c.name?.[0]?.toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white text-sm truncate">{c.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{formatTime(c.updated_at)}</p>
                      </div>
                      <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Mapa Google */}
        <div className="flex-1">
          {!isLoaded ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-orange-100 border-t-orange-500 rounded-full animate-spin" />
            </div>
          ) : (
            <GoogleMap
              mapContainerStyle={{ width: '100%', height: '100%' }}
              center={selected ? { lat: selected.lat, lng: selected.lng } : DEFAULT_CENTER}
              zoom={selected ? 15 : 13}
              options={{
                styles: dark ? MAP_STYLE_DARK : [],
                disableDefaultUI: false,
                zoomControl: true,
                streetViewControl: false,
                mapTypeControl: false,
                fullscreenControl: true,
              }}
            >
              {couriers.map(c => (
                <Marker
                  key={c.id}
                  position={{ lat: c.lat, lng: c.lng }}
                  onClick={() => setSelected(c)}
                  icon={{
                    url: c.photo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(c.name)}&background=F97316&color=fff&size=40&rounded=true`,
                    scaledSize: new window.google.maps.Size(40, 40),
                    anchor: new window.google.maps.Point(20, 20),
                  }}
                />
              ))}

              {selected && (
                <InfoWindow
                  position={{ lat: selected.lat, lng: selected.lng }}
                  onCloseClick={() => setSelected(null)}
                >
                  <div className="p-1 min-w-[140px]">
                    <p className="font-bold text-gray-900 text-sm">{selected.name}</p>
                    <p className="text-xs text-gray-500">{selected.phone}</p>
                    <p className="text-xs text-green-600 mt-1">● {formatTime(selected.updated_at)}</p>
                  </div>
                </InfoWindow>
              )}
            </GoogleMap>
          )}
        </div>
      </div>
    </div>
  )
}
