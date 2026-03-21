import React, { useState, useEffect, useRef } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, ScrollView, Platform, AppState, PermissionsAndroid,
} from 'react-native'
import * as Location from 'expo-location'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase'
import { BACKGROUND_LOCATION_TASK } from '../lib/backgroundTask'

const BACKEND_URL = 'https://delivery-app-production-9c98.up.railway.app'

export default function TrackingScreen({ route, navigation }) {
  const { order, courier } = route.params
  const [status, setStatus] = useState('iniciando') // 'iniciando' | 'activo' | 'error'
  const [lastUpdate, setLastUpdate] = useState(null)
  const [delivering, setDelivering] = useState(false)

  // Refs de control
  const isMounted = useRef(true)
  const appStateRef = useRef(AppState.currentState)
  const appStateSub = useRef(null)
  const lastUpdateInterval = useRef(null)

  useEffect(() => {
    isMounted.current = true
    startTracking()

    // Escuchar cuando la app vuelve al foco (ej: usuario regresó de Ajustes)
    appStateSub.current = AppState.addEventListener('change', handleAppState)

    return () => {
      isMounted.current = false
      appStateSub.current?.remove()
      if (lastUpdateInterval.current) clearInterval(lastUpdateInterval.current)
    }
  }, [])

  async function handleAppState(nextState) {
    const prev = appStateRef.current
    appStateRef.current = nextState

    // Cuando la app vuelve al frente, verificar que el rastreo sigue activo
    if (prev.match(/inactive|background/) && nextState === 'active') {
      const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
        .catch(() => false)
      if (!isRunning && isMounted.current) {
        // El servicio se cayó — reiniciar
        await launchForegroundService()
      }
    }
  }

  async function requestNotificationPermission() {
    if (Platform.OS !== 'android') return
    try {
      if (Platform.Version >= 33) {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        )
      }
    } catch {}
  }

  // Inicia el Foreground Service de localización
  // Funciona con pantalla apagada y otras apps INDEPENDIENTEMENTE del tipo de permiso
  // "mientras se usa" = OK porque la notificación es visible para el usuario
  // "siempre" = OK también
  async function launchForegroundService() {
    try {
      // Si ya hay una instancia corriendo, detenerla primero
      const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
        .catch(() => false)
      if (isRunning) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {})
        await new Promise(r => setTimeout(r, 600))
      }

      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: 6000,       // cada 6 segundos
        distanceInterval: 0,      // siempre actualizar aunque no se mueva
        foregroundService: {
          notificationTitle: '1012Delivery - Rastreo activo',
          notificationBody: 'Compartiendo ubicacion con el cliente',
          notificationColor: '#F97316',
        },
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        // Android: mantener corriendo siempre
        activityType: Location.ActivityType.AutomotiveNavigation,
      })

      if (isMounted.current) setStatus('activo')
      console.log('[Tracking] Foreground service GPS iniciado correctamente')
    } catch (err) {
      console.error('[Tracking] Error iniciando foreground service:', err.message)
      if (isMounted.current) setStatus('error')
      throw err
    }
  }

  async function startTracking() {
    try {
      // 1. Permiso de notificaciones (Android 13+)
      await requestNotificationPermission()

      // 2. Permiso de ubicación en primer plano (obligatorio)
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync()
      if (fgStatus !== 'granted') {
        Alert.alert(
          'Permiso requerido',
          'Necesitamos acceso a tu ubicacion para compartirla con los clientes.',
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        )
        return
      }

      // 3. Guardar entrega activa en AsyncStorage (la tarea de background lo lee)
      await AsyncStorage.setItem('activeDelivery', JSON.stringify({
        courier_id: courier.id,
        order_id: order.id,
      }))

      // 4. Arrancar el Foreground Service
      // - Muestra notificación persistente → Android NO lo mata con pantalla apagada
      // - Funciona igual con permiso "mientras se usa" o "siempre"
      await launchForegroundService()

      // 5. Iniciar polling de last update desde AsyncStorage
      startUpdatePoller()

    } catch (err) {
      console.error('[startTracking] Error:', err.message)
      if (isMounted.current) {
        setStatus('error')
        Alert.alert('Error GPS', 'No se pudo iniciar el rastreo: ' + err.message)
      }
    }
  }

  // Muestra la hora de la ultima ubicacion enviada por la tarea de background
  function startUpdatePoller() {
    lastUpdateInterval.current = setInterval(async () => {
      try {
        const raw = await AsyncStorage.getItem('lastGpsUpdate')
        if (raw && isMounted.current) setLastUpdate(raw)
      } catch {}
    }, 3000)
  }

  async function stopTracking() {
    try {
      if (lastUpdateInterval.current) {
        clearInterval(lastUpdateInterval.current)
        lastUpdateInterval.current = null
      }
      const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
        .catch(() => false)
      if (isRunning) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {})
      }
      await AsyncStorage.multiRemove(['activeDelivery', 'lastGpsUpdate'])
    } catch (err) {
      console.error('[stopTracking]', err.message)
    }
  }

  async function markDelivered() {
    Alert.alert(
      'Marcar como entregado',
      'Esto finalizara el rastreo GPS y cerrara esta entrega.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar entrega',
          onPress: async () => {
            setDelivering(true)
            try {
              await stopTracking()
              await supabase
                .from('orders')
                .update({ status: 'entregado' })
                .eq('id', order.id)
              navigation.replace('Orders')
            } catch (err) {
              Alert.alert('Error', err.message)
              setDelivering(false)
            }
          },
        },
      ]
    )
  }

  // Color e icono según estado
  const statusConfig = {
    iniciando: { color: '#F59E0B', bg: '#FFFBEB', border: '#FDE68A', label: 'Iniciando GPS...', sub: 'Solicitando permisos' },
    activo:    { color: '#22C55E', bg: '#F0FDF4', border: '#BBF7D0', label: 'Rastreo activo',  sub: 'Funciona con pantalla apagada y otras apps' },
    error:     { color: '#EF4444', bg: '#FEF2F2', border: '#FECACA', label: 'Error de GPS',    sub: 'Toca para reintentar' },
  }
  const s = statusConfig[status] || statusConfig.iniciando

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={async () => { await stopTracking(); navigation.goBack() }}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Entrega activa</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        {/* Indicador GPS */}
        <TouchableOpacity
          style={[styles.gpsCard, { backgroundColor: s.bg, borderColor: s.border }]}
          onPress={status === 'error' ? startTracking : undefined}
          activeOpacity={status === 'error' ? 0.7 : 1}
        >
          <View style={styles.gpsDotWrap}>
            {status === 'iniciando'
              ? <ActivityIndicator size="small" color={s.color} />
              : <View style={[styles.gpsDot, { backgroundColor: s.color }]} />
            }
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.gpsLabel, { color: s.color }]}>{s.label}</Text>
            <Text style={[styles.gpsSub, { color: s.color, opacity: 0.75 }]}>{s.sub}</Text>
          </View>
        </TouchableOpacity>

        {/* Ultima actualización */}
        {lastUpdate ? (
          <View style={styles.lastUpdateBox}>
            <Text style={styles.lastUpdateText}>GPS: {lastUpdate}</Text>
          </View>
        ) : status === 'activo' ? (
          <View style={styles.lastUpdateBox}>
            <Text style={styles.lastUpdateText}>Esperando primera ubicacion...</Text>
          </View>
        ) : null}

        {/* Detalle del pedido */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>DETALLE DEL PEDIDO</Text>
          <View style={styles.row}>
            <Text style={styles.rowIcon}>📍</Text>
            <Text style={styles.rowText}>{order.delivery_address}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowIcon}>👤</Text>
            <Text style={styles.rowText}>{order.client_name}</Text>
          </View>
          {order.client_phone && (
            <View style={styles.row}>
              <Text style={styles.rowIcon}>📞</Text>
              <Text style={[styles.rowText, styles.phoneText]}>{order.client_phone}</Text>
            </View>
          )}
        </View>

        {/* Items */}
        {order.items?.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>ARTICULOS DEL PEDIDO</Text>
            {order.items.map((item, idx) => (
              <View key={idx} style={styles.itemRow}>
                <Text style={styles.itemQty}>x{item.qty}</Text>
                <Text style={styles.itemName}>{item.name}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Botón Entregado */}
        <TouchableOpacity
          style={[styles.deliveredBtn, delivering && styles.btnDisabled]}
          onPress={markDelivered}
          disabled={delivering}
          activeOpacity={0.8}
        >
          {delivering
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.deliveredBtnText}>Marcar como entregado</Text>
          }
        </TouchableOpacity>

      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 44 : 56,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    elevation: 2,
  },
  backBtn: { width: 40, alignItems: 'flex-start' },
  backText: { fontSize: 28, color: '#374151', lineHeight: 32 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  gpsCard: {
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
  },
  gpsDotWrap: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  gpsDot: { width: 12, height: 12, borderRadius: 6 },
  gpsLabel: { fontSize: 15, fontWeight: '700' },
  gpsSub: { fontSize: 12, marginTop: 2 },
  lastUpdateBox: {
    backgroundColor: '#F0FDF4',
    borderRadius: 10,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#22C55E',
  },
  lastUpdateText: {
    fontSize: 12,
    color: '#166534',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  rowIcon: { fontSize: 14, marginRight: 8, marginTop: 1 },
  rowText: { fontSize: 14, color: '#374151', flex: 1, fontWeight: '500' },
  phoneText: { color: '#F97316', fontWeight: '700' },
  itemRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  itemQty: { color: '#F97316', fontWeight: '700', fontSize: 14, marginRight: 8, minWidth: 28 },
  itemName: { fontSize: 14, color: '#374151', flex: 1 },
  deliveredBtn: {
    backgroundColor: '#22C55E',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  deliveredBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },
})
