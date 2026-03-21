import React, { useState, useEffect, useRef } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, ScrollView, Platform, Linking, PermissionsAndroid,
} from 'react-native'
import * as Location from 'expo-location'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase'
import { BACKGROUND_LOCATION_TASK } from '../lib/backgroundTask'

const BACKEND_URL = 'https://delivery-app-production-9c98.up.railway.app'

export default function TrackingScreen({ route, navigation }) {
  const { order, courier } = route.params
  const [tracking, setTracking] = useState(false)
  const [bgActive, setBgActive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [delivering, setDelivering] = useState(false)
  const foregroundWatchRef = useRef(null)

  useEffect(() => {
    startTracking()
    return () => stopTracking()
  }, [])

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

  async function startTracking() {
    setLoading(true)
    try {
      // 1. Permiso de notificaciones (necesario para el servicio en Android 13+)
      await requestNotificationPermission()

      // 2. Permiso de ubicación en primer plano
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync()
      if (fgStatus !== 'granted') {
        Alert.alert(
          'Permiso requerido',
          'Necesitamos acceso a tu ubicacion para compartirla con los clientes.',
          [{ text: 'OK' }]
        )
        setLoading(false)
        return
      }

      // 3. Permiso de ubicación en segundo plano
      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync()

      if (bgStatus !== 'granted') {
        // Guiar al usuario a ajustes si no concedió "Siempre"
        Alert.alert(
          'Activar GPS en segundo plano',
          'Para que el rastreo funcione con la pantalla apagada:\n\n1. Toca "Abrir ajustes"\n2. Selecciona "Permisos"\n3. Selecciona "Ubicacion"\n4. Elige "Permitir siempre"',
          [
            { text: 'Continuar sin fondo', style: 'cancel' },
            { text: 'Abrir ajustes', onPress: () => Linking.openSettings() },
          ]
        )
        // Continuar solo con foreground y avisar al usuario
      }

      // 4. Guardar en AsyncStorage para la tarea en segundo plano
      await AsyncStorage.setItem('activeDelivery', JSON.stringify({
        courier_id: courier.id,
        order_id: order.id,
      }))

      // 5. Intentar iniciar el servicio de background (solo si tiene permiso)
      if (bgStatus === 'granted') {
        try {
          // Detener tarea previa si existe
          const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
            .catch(() => false)
          if (isRunning) {
            await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {})
            // Esperar que Android libere el servicio antes de reiniciar
            await new Promise(r => setTimeout(r, 800))
          }

          await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
            accuracy: Location.Accuracy.High,
            timeInterval: 8000,
            distanceInterval: 0,
            foregroundService: {
              notificationTitle: '1012Delivery - Rastreo activo',
              notificationBody: 'Compartiendo ubicacion con el cliente',
              notificationColor: '#F97316',
            },
            pausesUpdatesAutomatically: false,
            showsBackgroundLocationIndicator: true,
          })

          setBgActive(true)
          console.log('[Tracking] GPS en segundo plano iniciado correctamente')
        } catch (bgErr) {
          console.error('[Tracking] Error iniciando GPS en segundo plano:', bgErr.message)
          Alert.alert(
            'GPS en segundo plano',
            'No se pudo activar el GPS en segundo plano. El rastreo funcionara solo con la pantalla encendida.\n\nSi esto persiste, reinstala la app.',
            [{ text: 'Entendido' }]
          )
          setBgActive(false)
        }
      }

      // 6. Siempre iniciar watchPosition en primer plano (actualizaciones cuando pantalla ON)
      foregroundWatchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 4000,
          distanceInterval: 5,
        },
        async (loc) => {
          const { latitude, longitude } = loc.coords
          try {
            await fetch(`${BACKEND_URL}/api/location`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                courier_id: courier.id,
                order_id: order.id,
                latitude,
                longitude,
              }),
            })
            setLastUpdate(
              `${new Date().toLocaleTimeString()} · ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
            )
          } catch (err) {
            console.error('[FG GPS] Error enviando:', err.message)
          }
        }
      )

      setTracking(true)
    } catch (err) {
      Alert.alert('Error', 'No se pudo iniciar el GPS: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  async function stopTracking() {
    try {
      if (foregroundWatchRef.current) {
        foregroundWatchRef.current.remove()
        foregroundWatchRef.current = null
      }
      const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
        .catch(() => false)
      if (isRunning) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
      }
      await AsyncStorage.removeItem('activeDelivery')
      setBgActive(false)
      setTracking(false)
    } catch (err) {
      console.error('[stopTracking]', err.message)
    }
  }

  async function markDelivered() {
    Alert.alert(
      'Marcar como entregado',
      'Esto finalizara el rastreo GPS.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
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
            } finally {
              setDelivering(false)
            }
          },
        },
      ]
    )
  }

  async function stopAndGoBack() {
    await stopTracking()
    navigation.goBack()
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={stopAndGoBack} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Entrega activa</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        {/* Indicador GPS */}
        <View style={[styles.gpsCard, tracking ? styles.gpsActive : styles.gpsInactive]}>
          {loading ? (
            <ActivityIndicator color="#F97316" size="small" />
          ) : (
            <View style={styles.gpsDot}>
              <View style={[styles.dotInner, tracking ? styles.dotGreen : styles.dotGray]} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[styles.gpsLabel, tracking ? styles.gpsLabelActive : styles.gpsLabelInactive]}>
              {loading ? 'Iniciando GPS...' : tracking ? 'Compartiendo ubicacion' : 'GPS inactivo'}
            </Text>
            {tracking && (
              <Text style={styles.gpsSubtitle}>
                {bgActive
                  ? 'Funciona con pantalla apagada'
                  : 'Solo funciona con pantalla encendida — activa permiso "Siempre"'}
              </Text>
            )}
          </View>
        </View>

        {/* Aviso si no tiene background */}
        {tracking && !bgActive && (
          <TouchableOpacity style={styles.warningBox} onPress={() => Linking.openSettings()}>
            <Text style={styles.warningTitle}>GPS limitado</Text>
            <Text style={styles.warningText}>
              El rastreo se pausa cuando apagas la pantalla. Toca aqui para ir a Ajustes y seleccionar Ubicacion → "Permitir siempre".
            </Text>
          </TouchableOpacity>
        )}

        {/* Ultima actualización */}
        {lastUpdate && (
          <View style={styles.lastUpdateBox}>
            <Text style={styles.lastUpdateText}>Ultimo GPS: {lastUpdate}</Text>
          </View>
        )}

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

        {/* Botón Detener */}
        <TouchableOpacity
          style={styles.stopBtn}
          onPress={stopAndGoBack}
          activeOpacity={0.8}
        >
          <Text style={styles.stopBtnText}>Detener rastreo</Text>
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
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  backBtn: { width: 40, alignItems: 'flex-start' },
  backText: { fontSize: 28, color: '#374151', lineHeight: 32 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  content: { padding: 16, gap: 12 },
  gpsCard: {
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
  },
  gpsActive: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  gpsInactive: { backgroundColor: '#F9FAFB', borderColor: '#E5E7EB' },
  gpsDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotInner: { width: 10, height: 10, borderRadius: 5 },
  dotGreen: { backgroundColor: '#22C55E' },
  dotGray: { backgroundColor: '#9CA3AF' },
  gpsLabel: { fontSize: 14, fontWeight: '700' },
  gpsLabelActive: { color: '#15803D' },
  gpsLabelInactive: { color: '#6B7280' },
  gpsSubtitle: { fontSize: 11, color: '#4ADE80', marginTop: 2 },
  warningBox: {
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
  },
  warningTitle: { fontSize: 13, fontWeight: '700', color: '#92400E', marginBottom: 4 },
  warningText: { fontSize: 12, color: '#78350F', lineHeight: 17 },
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
  stopBtn: {
    backgroundColor: '#EF4444',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  stopBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },
})
