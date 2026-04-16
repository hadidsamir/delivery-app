import React, { useState, useEffect, useRef } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, ScrollView, Platform,
} from 'react-native'
import * as Location from 'expo-location'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase'
import { BACKGROUND_LOCATION_TASK } from '../lib/backgroundTask'
import { BACKEND_URL } from '../lib/config'

export default function TrackingScreen({ route, navigation }) {
  const order   = route.params?.order
  const courier = route.params?.courier

  // Hooks siempre al inicio (reglas de React — no retornar antes de hooks)
  const [delivering, setDelivering] = useState(false)
  const isMounted   = useRef(true)
  const stoppingRef = useRef(false)

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
        accuracy: Location.Accuracy.High,
        timeInterval: 3000,
        distanceInterval: 0,
        foregroundService: {
          notificationTitle: '1012Delivery - Rastreo activo',
          notificationBody: 'Compartiendo ubicacion con el cliente',
          notificationColor: '#F97316',
        },
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
      })

      console.log('[TrackingScreen] GPS foreground service iniciado')

    } catch (err) {
      console.error('[startGPS] Error:', err.message)
    }
  }

  async function stopGPS() {
    if (stoppingRef.current) return
    stoppingRef.current = true
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
              <Text style={[styles.rowText, { color: '#F97316', fontWeight: '700' }]}>
                {order.client_phone}
              </Text>
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

  doneBtn:     { backgroundColor: '#22C55E', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
  doneBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
