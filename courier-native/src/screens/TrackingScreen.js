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

  const [gpStatus, setGpStatus] = useState('iniciando') // 'iniciando' | 'activo' | 'error'
  const [lastUpdate, setLastUpdate] = useState(null)
  const [delivering, setDelivering] = useState(false)

  // ─── Control de estado con refs (sin re-renders) ─────────────────────────────
  const isMounted      = useRef(true)
  const isLaunching    = useRef(false)   // evita doble llamada a startLocationUpdatesAsync
  const isSetupDone    = useRef(false)   // true cuando el setup inicial terminó
  const appStateRef    = useRef(AppState.currentState)
  const pollInterval   = useRef(null)

  // ─── Ciclo de vida ────────────────────────────────────────────────────────────
  useEffect(() => {
    isMounted.current = true

    // Pedir permisos e iniciar GPS
    setup()

    // Suscribir AppState SÓLO para detectar si el servicio cayó mientras estaba en background
    // El handler ignora cualquier evento que ocurra ANTES de que setup() termine
    const sub = AppState.addEventListener('change', onAppStateChange)

    // Iniciar poller que lee el timestamp del último GPS desde AsyncStorage
    pollInterval.current = setInterval(readLastUpdate, 4000)

    return () => {
      isMounted.current = false
      sub.remove()
      if (pollInterval.current) clearInterval(pollInterval.current)
      stopService()  // limpia al desmontar
    }
  }, [])

  // ─── AppState: reiniciar servicio si se cayó ──────────────────────────────────
  async function onAppStateChange(next) {
    const prev = appStateRef.current
    appStateRef.current = next

    // Solo actuar si el setup ya terminó y la app vuelve al frente
    if (!isSetupDone.current) return
    if (!(prev.match(/inactive|background/) && next === 'active')) return

    // Verificar si el foreground service sigue corriendo
    const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
      .catch(() => false)

    if (!running && isMounted.current) {
      console.log('[Tracking] Servicio caído detectado — reiniciando')
      await launchService()
    }
  }

  // ─── Solicitar permisos e iniciar el servicio ─────────────────────────────────
  async function setup() {
    try {
      // 1. Notificaciones (Android 13+)
      if (Platform.OS === 'android' && Platform.Version >= 33) {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        ).catch(() => {})
      }

      // 2. Permiso de ubicación — esperamos la respuesta ANTES de cualquier otra cosa
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') {
        if (isMounted.current) {
          Alert.alert(
            'Permiso requerido',
            'La app necesita acceso a tu ubicacion para compartirla con los clientes.',
            [{ text: 'OK', onPress: () => navigation.goBack() }]
          )
        }
        return
      }

      // 3. Guardar entrega activa para la tarea de background
      await AsyncStorage.setItem('activeDelivery', JSON.stringify({
        courier_id: courier.id,
        order_id: order.id,
      }))

      // 4. Pequeña pausa para que Android procese la concesión del permiso
      //    antes de llamar startLocationUpdatesAsync
      await new Promise(r => setTimeout(r, 400))

      // 5. Iniciar el Foreground Service GPS
      await launchService()

      // 6. Marcar setup como completo (AHORA el AppState handler puede actuar)
      isSetupDone.current = true

    } catch (err) {
      console.error('[setup] Error:', err.message)
      if (isMounted.current) {
        setGpStatus('error')
      }
    }
  }

  // ─── Lanzar el Foreground Service ─────────────────────────────────────────────
  // Llamar desde setup() o desde AppState al detectar caída del servicio
  async function launchService() {
    // Evitar llamadas concurrentes
    if (isLaunching.current) return
    isLaunching.current = true

    try {
      // Si ya hay una instancia activa, detenerla primero
      const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
        .catch(() => false)
      if (running) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {})
        await new Promise(r => setTimeout(r, 500))
      }

      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: 6000,      // enviar cada 6 segundos
        distanceInterval: 0,     // aunque no se mueva
        foregroundService: {
          notificationTitle: '1012Delivery - Rastreo activo',
          notificationBody: 'Compartiendo ubicacion con el cliente',
          notificationColor: '#F97316',
        },
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
      })

      if (isMounted.current) {
        setGpStatus('activo')
        console.log('[launchService] Foreground service GPS activo')
      }
    } catch (err) {
      console.error('[launchService] Error:', err.message)
      if (isMounted.current) setGpStatus('error')
    } finally {
      isLaunching.current = false
    }
  }

  // ─── Leer último update del AsyncStorage ──────────────────────────────────────
  async function readLastUpdate() {
    try {
      const val = await AsyncStorage.getItem('lastGpsUpdate')
      if (val && isMounted.current) setLastUpdate(val)
    } catch {}
  }

  // ─── Detener el servicio ───────────────────────────────────────────────────────
  async function stopService() {
    try {
      if (pollInterval.current) {
        clearInterval(pollInterval.current)
        pollInterval.current = null
      }
      const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
        .catch(() => false)
      if (running) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {})
      }
      await AsyncStorage.multiRemove(['activeDelivery', 'lastGpsUpdate']).catch(() => {})
    } catch (err) {
      console.error('[stopService]', err.message)
    }
  }

  // ─── Marcar como entregado ────────────────────────────────────────────────────
  async function markDelivered() {
    Alert.alert(
      'Confirmar entrega',
      'Esto finalizara el rastreo GPS y cerrara la entrega.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          onPress: async () => {
            setDelivering(true)
            try {
              await stopService()
              await supabase.from('orders').update({ status: 'entregado' }).eq('id', order.id)
              if (isMounted.current) navigation.replace('Orders')
            } catch (err) {
              Alert.alert('Error', err.message)
              if (isMounted.current) setDelivering(false)
            }
          },
        },
      ]
    )
  }

  // ─── UI ───────────────────────────────────────────────────────────────────────
  const cfg = {
    iniciando: { color: '#D97706', bg: '#FFFBEB', border: '#FDE68A', label: 'Iniciando GPS...', sub: 'Solicitando permisos' },
    activo:    { color: '#16A34A', bg: '#F0FDF4', border: '#86EFAC', label: 'GPS activo',       sub: 'Funciona con pantalla apagada' },
    error:     { color: '#DC2626', bg: '#FEF2F2', border: '#FCA5A5', label: 'Error de GPS',     sub: 'Toca aqui para reintentar' },
  }
  const c = cfg[gpStatus] ?? cfg.iniciando

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          onPress={async () => {
            await stopService()
            navigation.goBack()
          }}
          style={styles.backBtn}
        >
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Entrega activa</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        {/* Tarjeta GPS */}
        <TouchableOpacity
          activeOpacity={gpStatus === 'error' ? 0.7 : 1}
          onPress={gpStatus === 'error' ? launchService : undefined}
          style={[styles.gpsCard, { backgroundColor: c.bg, borderColor: c.border }]}
        >
          <View style={styles.dotWrap}>
            {gpStatus === 'iniciando'
              ? <ActivityIndicator color={c.color} size="small" />
              : <View style={[styles.dot, { backgroundColor: c.color }]} />
            }
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.gpsLabel, { color: c.color }]}>{c.label}</Text>
            <Text style={[styles.gpsSub, { color: c.color }]}>{c.sub}</Text>
          </View>
        </TouchableOpacity>

        {/* Último GPS */}
        {lastUpdate && (
          <View style={styles.updateBox}>
            <Text style={styles.updateText}>Ultimo GPS: {lastUpdate}</Text>
          </View>
        )}
        {gpStatus === 'activo' && !lastUpdate && (
          <View style={styles.updateBox}>
            <Text style={styles.updateText}>Esperando primera ubicacion...</Text>
          </View>
        )}

        {/* Detalle pedido */}
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
            <Text style={styles.cardTitle}>ARTICULOS</Text>
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

// ─── Estilos ──────────────────────────────────────────────────────────────────
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
  backBtn: { width: 40 },
  backText: { fontSize: 30, color: '#374151', lineHeight: 34 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },

  content: { padding: 16, gap: 12, paddingBottom: 48 },

  gpsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 16,
  },
  dotWrap: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  gpsLabel: { fontSize: 15, fontWeight: '700' },
  gpsSub: { fontSize: 12, marginTop: 2, opacity: 0.8 },

  updateBox: {
    backgroundColor: '#F0FDF4',
    borderRadius: 10,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#22C55E',
  },
  updateText: {
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
    gap: 6,
  },
  cardTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 1,
    marginBottom: 4,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  icon: { fontSize: 14, marginRight: 8, marginTop: 2, width: 20 },
  rowText: { fontSize: 14, color: '#374151', flex: 1, fontWeight: '500', lineHeight: 20 },

  doneBtn: {
    backgroundColor: '#22C55E',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  doneBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
