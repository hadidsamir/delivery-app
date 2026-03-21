import React, { useState, useEffect, useRef } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, ScrollView, Platform,
} from 'react-native'
import * as Location from 'expo-location'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase'
import { BACKGROUND_LOCATION_TASK } from '../lib/backgroundTask'

const BACKEND_URL = 'https://delivery-app-production-9c98.up.railway.app'

export default function TrackingScreen({ route, navigation }) {
  const { order, courier } = route.params

  const [gpsStatus, setGpsStatus] = useState('iniciando') // 'iniciando' | 'activo' | 'error'
  const [lastUpdate, setLastUpdate] = useState(null)
  const [delivering, setDelivering] = useState(false)

  const isMounted   = useRef(true)
  const pollRef     = useRef(null)
  const stoppingRef = useRef(false)

  // ─── Al montar: iniciar GPS directamente (permisos ya fueron concedidos en OrdersScreen) ──
  useEffect(() => {
    isMounted.current = true
    stoppingRef.current = false
    startGPS()
    pollRef.current = setInterval(readLastUpdate, 4000)

    return () => {
      isMounted.current = false
      if (pollRef.current) clearInterval(pollRef.current)
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
        await new Promise(r => setTimeout(r, 500))
      }

      // Iniciar Foreground Service GPS
      // - Muestra notificación persistente → Android no lo mata con pantalla apagada
      // - Funciona con permiso "mientras se usa" o "siempre"
      // - No hay diálogos aquí → no hay race conditions
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: 6000,
        distanceInterval: 0,
        foregroundService: {
          notificationTitle: '1012Delivery - Rastreo activo',
          notificationBody: 'Compartiendo ubicacion con el cliente',
          notificationColor: '#F97316',
        },
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
      })

      if (isMounted.current) setGpsStatus('activo')
      console.log('[TrackingScreen] GPS foreground service iniciado')

    } catch (err) {
      console.error('[startGPS] Error:', err.message)
      if (isMounted.current) setGpsStatus('error')
    }
  }

  async function stopGPS() {
    if (stoppingRef.current) return
    stoppingRef.current = true
    try {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
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

  async function readLastUpdate() {
    try {
      const val = await AsyncStorage.getItem('lastGpsUpdate')
      if (val && isMounted.current) setLastUpdate(val)
    } catch {}
  }

  async function markDelivered() {
    Alert.alert('Confirmar entrega', 'Esto finalizará el rastreo GPS.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Confirmar',
        onPress: async () => {
          setDelivering(true)
          try {
            await stopGPS()
            await supabase.from('orders').update({ status: 'entregado' }).eq('id', order.id)
            if (isMounted.current) navigation.replace('Orders')
          } catch (err) {
            Alert.alert('Error', err.message)
            if (isMounted.current) setDelivering(false)
          }
        },
      },
    ])
  }

  // ─── UI ───────────────────────────────────────────────────────────────────────
  const cfg = {
    iniciando: { color: '#D97706', bg: '#FFFBEB', border: '#FDE68A', label: 'Iniciando GPS...',   sub: 'Activando rastreo' },
    activo:    { color: '#16A34A', bg: '#F0FDF4', border: '#86EFAC', label: 'GPS activo',          sub: 'Funciona con pantalla apagada y otras apps' },
    error:     { color: '#DC2626', bg: '#FEF2F2', border: '#FCA5A5', label: 'Error al iniciar GPS', sub: 'Toca aqui para reintentar' },
  }
  const c = cfg[gpsStatus]

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

        {/* Tarjeta GPS */}
        <TouchableOpacity
          activeOpacity={gpsStatus === 'error' ? 0.7 : 1}
          onPress={gpsStatus === 'error' ? startGPS : undefined}
          style={[styles.gpsCard, { backgroundColor: c.bg, borderColor: c.border }]}
        >
          <View style={styles.dotWrap}>
            {gpsStatus === 'iniciando'
              ? <ActivityIndicator color={c.color} size="small" />
              : <View style={[styles.dot, { backgroundColor: c.color }]} />
            }
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.gpsLabel, { color: c.color }]}>{c.label}</Text>
            <Text style={[styles.gpsSub, { color: c.color }]}>{c.sub}</Text>
          </View>
        </TouchableOpacity>

        {/* Última actualización GPS */}
        {lastUpdate ? (
          <View style={styles.updateBox}>
            <Text style={styles.updateText}>GPS: {lastUpdate}</Text>
          </View>
        ) : gpsStatus === 'activo' ? (
          <View style={styles.updateBox}>
            <Text style={styles.updateText}>Esperando primera ubicacion...</Text>
          </View>
        ) : null}

        {/* Detalle del pedido */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>DETALLE DEL PEDIDO</Text>
          <View style={styles.row}>
            <Text style={styles.icon}>📍</Text>
            <Text style={styles.rowText}>{order.delivery_address}</Text>
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

  gpsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 16,
  },
  dotWrap:  { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  dot:      { width: 12, height: 12, borderRadius: 6 },
  gpsLabel: { fontSize: 15, fontWeight: '700' },
  gpsSub:   { fontSize: 12, marginTop: 2, opacity: 0.85 },

  updateBox:  { backgroundColor: '#F0FDF4', borderRadius: 10, padding: 10, borderLeftWidth: 3, borderLeftColor: '#22C55E' },
  updateText: { fontSize: 12, color: '#166534', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },

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
