import React, { useState, useEffect, useRef } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, ScrollView, Platform, Linking, Dimensions,
} from 'react-native'
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps'
import MapViewDirections from 'react-native-maps-directions'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase'
import { BACKGROUND_LOCATION_TASK, startGpsWatchdog, stopGpsWatchdog } from '../lib/backgroundTask'
import { BACKEND_URL } from '../lib/config'

const GOOGLE_MAPS_KEY = 'AIzaSyAriubtJ4QMKvAMCdS5ajb6JWEYe7jnOsk'

// Distancia en metros entre dos coordenadas (fórmula de Haversine)
function distanceMeters(a, b) {
  const R = 6371000
  const dLat = (b.latitude - a.latitude) * Math.PI / 180
  const dLng = (b.longitude - a.longitude) * Math.PI / 180
  const lat1 = a.latitude * Math.PI / 180
  const lat2 = b.latitude * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Recorta la ruta ya calculada hasta el punto más cercano a la posición actual,
// dando el efecto de "línea que se acorta" sin tener que recalcular la ruta (como Waze/Google Maps)
function trimRouteToCurrentPosition(fullRoute, current) {
  if (!fullRoute?.length || !current) return fullRoute || []
  let closestIndex = 0
  let closestDist = Infinity
  for (let i = 0; i < fullRoute.length; i++) {
    const d = distanceMeters(current, fullRoute[i])
    if (d < closestDist) {
      closestDist = d
      closestIndex = i
    }
  }
  return [current, ...fullRoute.slice(closestIndex + 1)]
}

export default function TrackingScreen({ route, navigation }) {
  const order   = route.params?.order
  const courier = route.params?.courier

  // Hooks siempre al inicio (reglas de React — no retornar antes de hooks)
  const [delivering, setDelivering] = useState(false)
  const [gpsStatus, setGpsStatus] = useState(null) // Estado GPS para mostrar al usuario
  const [currentLocation, setCurrentLocation] = useState(null) // Ubicación actual del mensajero
  const [destinationCoords, setDestinationCoords] = useState(null) // Coordenadas del destino
  const [routeOrigin, setRouteOrigin] = useState(null) // Origen usado para calcular la ruta (se actualiza solo si te moviste lo suficiente)
  const [routeCoords, setRouteCoords] = useState([]) // Puntos completos de la ruta calculada por Google Directions
  const [isFullscreen, setIsFullscreen] = useState(false) // Mapa en pantalla completa
  const lastRouteOriginRef = useRef(null)
  const isMounted   = useRef(true)
  const stoppingRef = useRef(false)
  const mapRef = useRef(null)
  const fullscreenMapRef = useRef(null)
  const hasFitNormalRef = useRef(false)
  const hasFitFullscreenRef = useRef(false)

  // Guard: si no llegaron params, redirigir (después de los hooks)
  useEffect(() => {
    if (!order || !courier) navigation.replace('MainTabs')
  }, [])

  // ─── Al montar: iniciar GPS directamente (permisos ya fueron concedidos en OrdersScreen) ──
  useEffect(() => {
    if (!order || !courier) return
    isMounted.current = true
    stoppingRef.current = false
    startGPS()

    return () => {
      isMounted.current = false
      if (!stoppingRef.current) stopGPS()
    }
  }, [])

  // ─── Monitor GPS: muestra última ubicación enviada cada 2 segundos ──
  useEffect(() => {
    const checkGpsStatus = async () => {
      try {
        const lastUpdate = await AsyncStorage.getItem('lastGpsUpdate')
        if (lastUpdate) {
          setGpsStatus(lastUpdate)
        }
      } catch {}
    }

    checkGpsStatus() // Inicial
    const interval = setInterval(checkGpsStatus, 2000) // Cada 2 segundos
    return () => clearInterval(interval)
  }, [])

  // ─── Obtener ubicación actual del mensajero ──
  useEffect(() => {
    async function getCurrentPosition() {
      try {
        console.log('[TrackingScreen] Solicitando ubicación actual...')
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        })
        console.log('[TrackingScreen] Ubicación obtenida:', location.coords.latitude, location.coords.longitude)
        const coords = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        }
        setCurrentLocation(coords)

        // Solo recalcular la ruta si te moviste más de 30m — evita que la línea
        // azul se redibuje (parpadee) en cada actualización de ubicación
        if (!lastRouteOriginRef.current || distanceMeters(lastRouteOriginRef.current, coords) > 30) {
          lastRouteOriginRef.current = coords
          setRouteOrigin(coords)
        }
      } catch (err) {
        console.error('[TrackingScreen] Error obteniendo ubicación actual:', err.message)
      }
    }
    getCurrentPosition()

    // Actualizar ubicación cada 10 segundos
    const interval = setInterval(getCurrentPosition, 10000)
    return () => clearInterval(interval)
  }, [])

  // ─── Geocodificar dirección de entrega ──
  useEffect(() => {
    async function geocodeAddress() {
      if (!order?.delivery_address) {
        console.warn('[TrackingScreen] No hay dirección de entrega')
        return
      }

      // Si ya tiene coordenadas en la BD, usarlas
      if (order.delivery_lat && order.delivery_lng) {
        console.log('[TrackingScreen] Usando coords de BD:', order.delivery_lat, order.delivery_lng)
        setDestinationCoords({
          latitude: order.delivery_lat,
          longitude: order.delivery_lng,
        })
        return
      }

      // Si no, geocodificar la dirección
      try {
        const address = `${order.delivery_address}, Valledupar, Cesar, Colombia`
        console.log('[TrackingScreen] Geocodificando:', address)
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_KEY}`
        const res = await fetch(url)
        const data = await res.json()
        console.log('[TrackingScreen] Geocoding response:', data.status)
        if (data.results?.[0]) {
          console.log('[TrackingScreen] Destino geocodificado:', data.results[0].geometry.location)
          setDestinationCoords({
            latitude: data.results[0].geometry.location.lat,
            longitude: data.results[0].geometry.location.lng,
          })
        } else {
          console.error('[TrackingScreen] No se encontraron resultados de geocoding')
        }
      } catch (err) {
        console.error('[TrackingScreen] Error geocodificando dirección:', err.message)
      }
    }
    geocodeAddress()
  }, [order])

  // ─── Debug: loguear cuando ambas coordenadas estén listas ──
  useEffect(() => {
    if (currentLocation && destinationCoords) {
      console.log('[TrackingScreen] ✅ AMBAS COORDENADAS LISTAS:')
      console.log('  - Origen (mensajero):', currentLocation)
      console.log('  - Destino (cliente):', destinationCoords)
    } else {
      console.log('[TrackingScreen] ⏳ Esperando coordenadas...', {
        currentLocation: !!currentLocation,
        destinationCoords: !!destinationCoords
      })
    }
  }, [currentLocation, destinationCoords])

  async function startGPS() {
    try {
      // Guardar entrega activa para que la tarea de background pueda leer los IDs
      await AsyncStorage.setItem('activeDelivery', JSON.stringify({
        courier_id: courier.id,
        order_id: order.id,
      }))

      // Si quedó una instancia previa corriendo, detenerla primero
      const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
        .catch(() => false)
      if (alreadyRunning) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {})
        await new Promise(r => setTimeout(r, 800))
      }

      // Pequeño delay para que el hilo principal de Android termine de renderizar
      // antes de iniciar el Foreground Service (previene ANR en algunos dispositivos)
      await new Promise(r => setTimeout(r, 400))

      // Iniciar Foreground Service GPS
      // - Muestra notificación persistente → Android no lo mata con pantalla apagada
      // - Funciona con permiso "mientras se usa" o "siempre"
      // - No hay diálogos aquí → no hay race conditions
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 4000,
        distanceInterval: 0,
        foregroundService: {
          notificationTitle: '1012Delivery · Rastreo activo',
          notificationBody: 'Compartiendo ubicación con el cliente',
          notificationColor: '#F97316',
          killServiceOnDestroy: false,         // Android: mantener vivo aunque el usuario cierre la app
        },
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        activityType: Location.ActivityType.AutomotiveNavigation,
        deferredUpdatesInterval: 0,
        deferredUpdatesDistance: 0,
      })

      console.log('[TrackingScreen] GPS foreground service iniciado')

      // Iniciar watchdog: si Android mata el GPS, lo reinicia automáticamente
      startGpsWatchdog(courier.id, order.id)

    } catch (err) {
      console.error('[startGPS] Error:', err.message)
    }
  }

  async function stopGPS() {
    if (stoppingRef.current) return
    stoppingRef.current = true
    stopGpsWatchdog()
    try {
      const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
        .catch(() => false)
      if (running) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {})
      }
      await AsyncStorage.multiRemove(['activeDelivery', 'lastGpsUpdate']).catch(() => {})
    } catch (err) {
      console.error('[stopGPS]', err.message)
    }
  }

  async function markDelivered() {
    setDelivering(true)
    try {
      await stopGPS()

      // Timeout de 10 segundos para no dejar al mensajero bloqueado sin respuesta
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Tiempo de espera agotado. Revisa tu conexión.')), 10000)
      )

      // Llamar al backend (no Supabase directamente) para que:
      // 1. Guarde delivered_at y actualice el status
      // 2. Emita evento Socket.io al cliente en tiempo real
      // 3. Active la expiración del link de tracking
      const fetchPromise = fetch(`${BACKEND_URL}/api/order/${order.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'entregado', courier_id: courier.id }),
      }).then(async res => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `Error ${res.status}`)
        }
        return res.json()
      })

      await Promise.race([fetchPromise, timeoutPromise])

      if (isMounted.current) navigation.replace('MainTabs')
    } catch (err) {
      console.error('[markDelivered]', err.message)
      Alert.alert('Error', err.message || 'No se pudo marcar como entregado. Intenta de nuevo.')
      if (isMounted.current) setDelivering(false)
    }
  }

  function renderMapContent(ref, mapStyle, hasFitRef) {
    return (
      <MapView
        ref={ref}
        provider={PROVIDER_GOOGLE}
        style={mapStyle}
        initialRegion={{
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        showsUserLocation={true}
        showsMyLocationButton={true}
        zoomEnabled={true}
        scrollEnabled={true}
        rotateEnabled={true}
        pitchEnabled={true}
        onMapReady={() => {
          console.log('[MapView] Mapa listo y renderizado')
        }}
      >
        {/* Marcador de ubicación actual del mensajero */}
        <Marker
          coordinate={currentLocation}
          title="Tu ubicación"
          pinColor="#F97316"
        />

        {/* Marcador de destino */}
        <Marker
          coordinate={destinationCoords}
          title="Destino"
          description={order.delivery_address}
          pinColor="#1D4ED8"
        />

        {/* Ruta con Google Directions — invisible, solo se usa para obtener los puntos del camino */}
        <MapViewDirections
          origin={routeOrigin || currentLocation}
          destination={destinationCoords}
          apikey={GOOGLE_MAPS_KEY}
          strokeWidth={0}
          mode="DRIVING"
          onReady={result => {
            console.log('[MapViewDirections] Ruta calculada:', result.distance, 'km,', result.duration, 'min')
            setRouteCoords(result.coordinates)
            // Solo ajustar la cámara la primera vez — si el usuario ya rotó/movió el mapa,
            // las actualizaciones de ubicación no deben resetear su posición
            if (ref.current && !hasFitRef.current) {
              hasFitRef.current = true
              ref.current.fitToCoordinates(result.coordinates, {
                edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
                animated: true,
              })
            }
          }}
          onError={(errorMessage) => {
            console.error('[MapViewDirections] ERROR:', errorMessage)
          }}
        />

        {/* Línea de ruta recortada en vivo según tu posición — efecto Waze/Google Maps */}
        {routeCoords.length > 0 && (
          <Polyline
            coordinates={trimRouteToCurrentPosition(routeCoords, currentLocation)}
            strokeWidth={4}
            strokeColor="#1D4ED8"
          />
        )}
      </MapView>
    )
  }

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          onPress={async () => { await stopGPS(); navigation.goBack() }}
          style={styles.backBtn}
        >
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Entrega activa</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        {/* Detalle del pedido */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>DETALLE DEL PEDIDO</Text>
          {!!order.pickup_address && (
            <View style={styles.row}>
              <Text style={styles.icon}>📦</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 10, color: '#9CA3AF', fontWeight: '700', letterSpacing: 0.5, marginBottom: 2 }}>RECOGER EN</Text>
                <Text style={styles.rowText}>{order.pickup_address}</Text>
              </View>
            </View>
          )}
          <View style={styles.row}>
            <Text style={styles.icon}>📍</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 10, color: '#9CA3AF', fontWeight: '700', letterSpacing: 0.5, marginBottom: 2 }}>ENTREGAR EN</Text>
              <Text style={styles.rowText}>{order.delivery_address}</Text>
            </View>
          </View>
          <View style={styles.row}>
            <Text style={styles.icon}>👤</Text>
            <Text style={styles.rowText}>{order.client_name}</Text>
          </View>
          {!!order.client_phone && (
            <View style={styles.row}>
              <Text style={styles.icon}>📞</Text>
              <TouchableOpacity
                onPress={() => {
                  const phoneNumber = order.client_phone.replace(/\s/g, '')
                  Linking.openURL(`tel:${phoneNumber}`)
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.rowText, { color: '#F97316', fontWeight: '700', textDecorationLine: 'underline' }]}>
                  {order.client_phone}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Nota del administrador */}
        {!!order.notes && (
          <View style={[styles.card, { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }]}>
            <Text style={[styles.cardTitle, { color: '#92400E' }]}>NOTA DEL ADMINISTRADOR</Text>
            <View style={styles.row}>
              <Text style={styles.icon}>📝</Text>
              <Text style={[styles.rowText, { color: '#78350F' }]}>{order.notes}</Text>
            </View>
          </View>
        )}

        {/* Artículos */}
        {order.items?.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>ARTÍCULOS</Text>
            {order.items.map((item, i) => (
              <View key={i} style={styles.row}>
                <Text style={[styles.icon, { color: '#F97316', fontWeight: '700' }]}>
                  x{item.qty}
                </Text>
                <Text style={styles.rowText}>{item.name}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Mapa con ruta al destino */}
        <View style={styles.mapContainer}>
          <View style={styles.mapTitleRow}>
            <Text style={styles.mapTitle}>RUTA AL DESTINO</Text>
            {currentLocation && destinationCoords && (
              <TouchableOpacity
                style={styles.fullscreenBtn}
                onPress={() => setIsFullscreen(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.fullscreenBtnText}>⛶ Pantalla completa</Text>
              </TouchableOpacity>
            )}
          </View>
          {!currentLocation || !destinationCoords ? (
            <View style={{...styles.map, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F3F4F6'}}>
              <Text style={{fontSize: 14, color: '#6B7280', textAlign: 'center', paddingHorizontal: 20}}>
                {!currentLocation && !destinationCoords ? '🗺️ Obteniendo ubicación y destino...' :
                 !currentLocation ? '📍 Obteniendo tu ubicación GPS...' :
                 '🎯 Calculando ruta al destino...'}
              </Text>
            </View>
          ) : (
            <View style={{flex: 1}}>
              {renderMapContent(mapRef, styles.map, hasFitNormalRef)}
            </View>
          )}
        </View>

        {/* Botón entregado */}
        <TouchableOpacity
          style={[styles.doneBtn, delivering && { opacity: 0.6 }]}
          onPress={markDelivered}
          disabled={delivering}
          activeOpacity={0.8}
        >
          {delivering
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.doneBtnText}>Marcar como entregado</Text>
          }
        </TouchableOpacity>

      </ScrollView>

      {/* Mapa en pantalla completa — capa superpuesta (no usa Modal nativo para respetar la status bar) */}
      {isFullscreen && (
        <SafeAreaView style={styles.fullscreenOverlay} edges={['top', 'bottom']}>
          {currentLocation && destinationCoords && renderMapContent(fullscreenMapRef, { flex: 1 }, hasFitFullscreenRef)}
          <TouchableOpacity
            style={styles.closeFullscreenBtn}
            onPress={() => setIsFullscreen(false)}
            activeOpacity={0.8}
          >
            <Text style={styles.closeFullscreenBtnText}>✕ Cerrar</Text>
          </TouchableOpacity>
        </SafeAreaView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },

  header: {
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 48 : 60,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    elevation: 3,
  },
  backBtn:  { width: 40 },
  backText: { fontSize: 30, color: '#374151', lineHeight: 34 },
  title:    { fontSize: 16, fontWeight: '700', color: '#111827' },

  content: { padding: 16, gap: 12, paddingBottom: 48 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 8,
  },
  cardTitle: { fontSize: 10, fontWeight: '700', color: '#9CA3AF', letterSpacing: 1, marginBottom: 2 },
  row:       { flexDirection: 'row', alignItems: 'flex-start' },
  icon:      { fontSize: 14, marginRight: 8, marginTop: 2, width: 22 },
  rowText:   { fontSize: 14, color: '#374151', flex: 1, fontWeight: '500', lineHeight: 20 },

  gpsCard: {
    backgroundColor: '#ECFDF5',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#10B981',
    gap: 8,
  },
  gpsPulse: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10B981',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 4,
  },
  gpsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#047857',
    letterSpacing: 1,
  },
  gpsText: {
    fontSize: 13,
    color: '#065F46',
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  gpsHint: {
    fontSize: 11,
    color: '#059669',
    lineHeight: 16,
  },

  mapContainer: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  mapTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  mapTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 1,
  },
  map: {
    width: '100%',
    height: 300,
    borderRadius: 8,
  },
  fullscreenBtn: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  fullscreenBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#374151',
  },
  fullscreenOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    zIndex: 999,
    elevation: 999,
  },
  closeFullscreenBtn: {
    position: 'absolute',
    top: 100,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
  },
  closeFullscreenBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },

  doneBtn:     { backgroundColor: '#22C55E', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
  doneBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
