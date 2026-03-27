import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, RefreshControl, Alert, StatusBar, Image, Platform,
  PermissionsAndroid, Linking, AppState,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import * as Notifications from 'expo-notifications'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase'
import { startAppKeepalive, stopAppKeepalive, checkAndNotifyOrders } from '../lib/backgroundTask'

// Configurar cómo se muestran las notificaciones cuando la app está abierta
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

export default function OrdersScreen({ navigation }) {
  const [courier, setCourier]     = useState(null)
  const [orders, setOrders]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [accepting, setAccepting] = useState(null) // id del pedido que se está aceptando
  // Set de IDs de pedidos ya notificados — evita notificaciones duplicadas
  // Se limpia automáticamente al superar 100 entradas para evitar memory leak
  const notifiedOrders = React.useRef(new Set())
  function addNotified(id) {
    if (notifiedOrders.current.size >= 100) notifiedOrders.current.clear()
    notifiedOrders.current.add(id)
  }

  useEffect(() => {
    let channel   = null
    let courierData = null

    async function refreshPushToken(courierId) {
      try {
        const { status } = await Notifications.getPermissionsAsync()
        if (status !== 'granted') return
        const tokenData = await Notifications.getDevicePushTokenAsync()
        const token = tokenData?.data
        if (!token) return
        await supabase.from('couriers').update({ push_token: token }).eq('id', courierId)
      } catch {}
    }

    async function init() {
      const stored = await AsyncStorage.getItem('courier')
      if (!stored) { navigation.getParent()?.replace('Login'); return }
      courierData = JSON.parse(stored)
      setCourier(courierData)
      await setupNotifications()
      fetchOrders(courierData.id)
      // Verificar pedidos pendientes sin notificar AL ABRIR la app
      // Esto garantiza que aunque el keepalive haya sido matado por Android,
      // el mensajero recibe la notificación en cuanto abre la app
      checkAndNotifyOrders(courierData.id)
      checkBatteryOptimization()
      startAppKeepalive()
      subscribeRealtime(courierData.id)
      refreshPushToken(courierData.id)
    }

    async function subscribeRealtime(courierId) {
      // Eliminar canal previo si existe y esperar a que se limpie
      if (channel) await supabase.removeChannel(channel).catch(() => {})

      channel = supabase
        .channel('native-orders-' + courierId + '-' + Date.now())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' },
          async (payload) => {
            // Solo refrescar la UI — la notificación la maneja EXCLUSIVAMENTE
            // el keepalive (checkAndNotifyOrders) para evitar doble notificación
            // entre el canal Realtime y el FCM silencioso del backend.
            if (payload.new.courier_id === courierId) {
              fetchOrders(courierId)
            }
          })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' },
          async (payload) => {
            // Solo refrescar lista — NO llamar notifyNewOrder en UPDATE.
            // Razón: payload.old.courier_id es siempre undefined con REPLICA IDENTITY DEFAULT,
            // lo que hace que wasReassigned sea siempre true y genere notificaciones duplicadas.
            // Los pedidos reasignados llegan por KEEPALIVE_TASK (máx 30s de retraso).
            if (payload.new.courier_id === courierId || payload.old?.courier_id === courierId)
              fetchOrders(courierId)
          })
        .subscribe((status) => {
          console.log('[Realtime] Estado del canal:', status)
        })
    }

    // Refrescar pedidos y reconectar Realtime al volver al primer plano
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && courierData?.id) {
        fetchOrders(courierData.id)
        subscribeRealtime(courierData.id)
        // También verificar pedidos sin notificar al volver al primer plano
        checkAndNotifyOrders(courierData.id)
      }
    })

    init()

    return () => {
      appStateSub.remove()
      if (channel) supabase.removeChannel(channel)
    }
  }, [])

  // Configurar canal de notificaciones y botones de acción
  async function setupNotifications() {
    try {
      const { status } = await Notifications.requestPermissionsAsync()
      if (status !== 'granted') return

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('pedidos', {
          name: 'Pedidos nuevos',
          importance: Notifications.AndroidImportance.MAX,
          sound: true,
          vibrationPattern: [0, 300, 200, 300],
          enableLights: true,
          lightColor: '#F97316',
        })

        // Canal para nuevos servicios de clientes (con sonido personalizado)
        await Notifications.setNotificationChannelAsync('nuevo_servicio', {
          name: 'Nuevos servicios disponibles',
          importance: Notifications.AndroidImportance.MAX,
          sound: 'nuevo_servicio',
          vibrationPattern: [0, 500, 200, 500],
          enableLights: true,
          lightColor: '#00E8E1',
        })
      }

      // Registrar categoría con botones Aceptar / Rechazar
      await Notifications.setNotificationCategoryAsync('nuevo_pedido', [
        {
          identifier: 'aceptar',
          buttonTitle: '✅ Aceptar',
          options: { opensAppToForeground: true },   // abre la app al aceptar
        },
        {
          identifier: 'rechazar',
          buttonTitle: '❌ Rechazar',
          options: { opensAppToForeground: false, isDestructive: true },
        },
      ])

      console.log('[Notif] Canal y categoría configurados')
    } catch (err) {
      console.warn('[Notif] Error configurando notificaciones:', err.message)
    }
  }

  // Disparar notificación con botones Aceptar / Rechazar
  async function notifyNewOrder(order) {
    // Guard SINCRÓNICO primero — evita que llamadas concurrentes pasen todas el check
    if (notifiedOrders.current.has(order.id)) return
    addNotified(order.id)  // marcar ANTES de cualquier await

    // Verificar también en AsyncStorage (compartido con KEEPALIVE_TASK)
    // para evitar duplicados entre el canal Realtime y el background task
    try {
      const raw = await AsyncStorage.getItem('keepaliveNotified') || '[]'
      const arr = JSON.parse(raw)
      if (arr.includes(order.id)) return  // KEEPALIVE ya lo notificó
      arr.push(order.id)
      await AsyncStorage.setItem('keepaliveNotified', JSON.stringify(arr.slice(-50)))
    } catch {}
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: 'order-' + order.id,
        content: {
          title: '🛵 Nuevo pedido asignado',
          body: `${order.client_name}\n📍 ${order.delivery_address}`,
          sound: true,
          priority: Notifications.AndroidNotificationPriority.MAX,
          channelId: 'pedidos',
          categoryIdentifier: 'nuevo_pedido',
          data: { orderId: order.id },
        },
        trigger: null,
      })
    } catch (err) {
      console.warn('[Notif] Error enviando notificacion:', err.message)
    }
  }

  // Mostrar aviso de batería una sola vez por instalación
  async function checkBatteryOptimization() {
    try {
      const shown = await AsyncStorage.getItem('batteryWarningShown')
      if (shown) return
      await AsyncStorage.setItem('batteryWarningShown', 'true')
      Alert.alert(
        'Importante para el rastreo GPS',
        'Para que el GPS funcione con la pantalla apagada necesitas:\n\n' +
        '1. Ve a Ajustes del teléfono\n' +
        '2. Busca "Aplicaciones"\n' +
        '3. Encuentra "1012Delivery"\n' +
        '4. Toca "Batería"\n' +
        '5. Selecciona "Sin restricciones"\n\n' +
        'Esto garantiza que el cliente siempre vea tu posición.',
        [
          { text: 'Abrir Ajustes', onPress: () => Linking.openSettings() },
          { text: 'Más tarde', style: 'cancel' },
        ]
      )
    } catch {}
  }

  async function fetchOrders(courierId) {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('courier_id', courierId)
        .in('status', ['pendiente', 'en_camino'])
        .order('created_at', { ascending: true })
      if (error) throw error
      setOrders(data || [])
    } catch (err) {
      console.error('[Orders] Error cargando pedidos:', err.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  async function acceptOrder(orderId) {
    if (!courier?.id || accepting) return
    setAccepting(orderId)
    try {
      const { error } = await supabase.from('orders')
        .update({ status: 'en_camino', courier_id: courier.id })
        .eq('id', orderId)
      if (error) throw error
      // Descartar notificaciones del sistema al aceptar
      await Notifications.dismissAllNotificationsAsync().catch(() => {})
      fetchOrders(courier.id)
    } catch (err) {
      Alert.alert('Error', 'No se pudo aceptar el pedido: ' + err.message)
    } finally {
      setAccepting(null)
    }
  }

  async function rejectOrder(orderId) {
    if (!courier?.id) return
    Alert.alert('Rechazar pedido', 'El pedido volverá al administrador.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Rechazar', style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase.from('orders').update({ status: 'pendiente', courier_id: null }).eq('id', orderId)
            if (error) throw error
            // Descartar notificaciones del sistema de forma inmediata
            await Notifications.dismissAllNotificationsAsync().catch(() => {})
            // Limpiar del Set en memoria y en AsyncStorage para que si se reasigna llegue nueva notificación
            notifiedOrders.current.delete(orderId)
            try {
              const raw = await AsyncStorage.getItem('keepaliveNotified') || '[]'
              const filtered = JSON.parse(raw).filter(id => id !== orderId)
              await AsyncStorage.setItem('keepaliveNotified', JSON.stringify(filtered))
            } catch {}
            fetchOrders(courier.id)
          } catch (err) {
            Alert.alert('Error', 'No se pudo rechazar el pedido: ' + err.message)
          }
        },
      },
    ])
  }

  // ─── Pedir permisos AQUÍ antes de navegar a Tracking ──────────────────────────
  // Así cuando TrackingScreen inicia, el permiso ya está concedido
  // y no hay ningún diálogo que interfiera con el inicio del GPS
  async function handleStartDelivery(order) {
    try {
      // 1. Notificaciones (Android 13+)
      if (Platform.OS === 'android' && Platform.Version >= 33) {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        ).catch(() => {})
      }

      // 2. Permiso de ubicación — el diálogo se muestra AQUÍ, no en TrackingScreen
      const { status } = await Location.requestForegroundPermissionsAsync()

      if (status !== 'granted') {
        Alert.alert(
          'Permiso de ubicación requerido',
          'La app necesita acceso a tu ubicación para compartirla con los clientes durante la entrega.',
          [{ text: 'Entendido' }]
        )
        return
      }

      // 3. Navegar a Tracking — el keepalive sigue corriendo en paralelo
      navigation.getParent()?.navigate('Tracking', { order, courier })

    } catch (err) {
      Alert.alert('Error', 'No se pudo verificar el permiso de ubicación: ' + err.message)
    }
  }

  function handleLogout() {
    Alert.alert('Cerrar sesión', '¿Deseas salir?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Salir', style: 'destructive',
        onPress: async () => {
          await stopAppKeepalive()
          await AsyncStorage.removeItem('courier')
          navigation.getParent()?.replace('Login')
        },
      },
    ])
  }

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    if (courier) fetchOrders(courier.id)
  }, [courier])

  function renderOrder({ item }) {
    const isPendiente = item.status === 'pendiente'

    return (
      <View style={[styles.card, isPendiente && styles.cardPendiente]}>
        {isPendiente && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Nuevo pedido asignado</Text>
          </View>
        )}

        <View style={styles.row}>
          <Text style={styles.rowIcon}>📍</Text>
          <Text style={styles.address}>{item.delivery_address}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowIcon}>👤</Text>
          <Text style={styles.detail}>{item.client_name}</Text>
        </View>
        {!!item.client_phone && (
          <View style={styles.row}>
            <Text style={styles.rowIcon}>📞</Text>
            <Text style={[styles.detail, { color: '#F97316', fontWeight: '700' }]}>{item.client_phone}</Text>
          </View>
        )}

        {item.items?.length > 0 && (
          <View style={styles.itemsBox}>
            <Text style={styles.itemsTitle}>ARTÍCULOS</Text>
            {item.items.map((it, idx) => (
              <Text key={idx} style={styles.itemRow}>
                <Text style={{ color: '#F97316', fontWeight: '700' }}>x{it.qty}  </Text>{it.name}
              </Text>
            ))}
          </View>
        )}

        {isPendiente ? (
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={styles.rejectBtn}
              onPress={() => rejectOrder(item.id)}
              disabled={accepting === item.id}
              activeOpacity={0.8}
            >
              <Text style={styles.rejectText}>Rechazar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.acceptBtn, accepting === item.id && { opacity: 0.6 }]}
              onPress={() => acceptOrder(item.id)}
              disabled={accepting === item.id}
              activeOpacity={0.8}
            >
              {accepting === item.id
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.acceptText}>Aceptar</Text>
              }
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.startBtn}
            onPress={() => handleStartDelivery(item)}
            activeOpacity={0.8}
          >
            <Text style={styles.startText}>Iniciar entrega</Text>
          </TouchableOpacity>
        )}
      </View>
    )
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#F97316" />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <SafeAreaView style={styles.safeHeader}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image source={require('../../assets/icon.png')} style={styles.logo} />
            <View>
              <Text style={styles.welcome}>Bienvenido</Text>
              <Text style={styles.courierName}>{courier?.name}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
            <Text style={styles.logoutText}>Salir</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        renderItem={renderOrder}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#F97316']} tintColor="#F97316" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📦</Text>
            <Text style={styles.emptyText}>No tienes pedidos asignados</Text>
          </View>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center' },

  safeHeader: { backgroundColor: '#fff', elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4 },
  header:     { backgroundColor: '#fff', paddingHorizontal: 20, paddingVertical: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo:       { width: 40, height: 40, borderRadius: 8 },
  welcome:    { fontSize: 11, color: '#9CA3AF' },
  courierName:{ fontSize: 17, fontWeight: '700', color: '#111827' },
  logoutBtn:  { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  logoutText: { fontSize: 13, color: '#6B7280' },

  list: { padding: 16, gap: 12, paddingBottom: 32 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    gap: 6,
  },
  cardPendiente: { borderWidth: 2, borderColor: '#FCD34D' },

  badge:     { backgroundColor: '#FEF3C7', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', marginBottom: 6 },
  badgeText: { color: '#92400E', fontSize: 12, fontWeight: '700' },

  row:     { flexDirection: 'row', alignItems: 'flex-start' },
  rowIcon: { fontSize: 14, marginRight: 8, marginTop: 2, width: 20 },
  address: { fontSize: 14, fontWeight: '600', color: '#111827', flex: 1, lineHeight: 20 },
  detail:  { fontSize: 14, color: '#4B5563', flex: 1 },

  itemsBox:   { backgroundColor: '#F9FAFB', borderRadius: 10, padding: 10, marginVertical: 4 },
  itemsTitle: { fontSize: 10, fontWeight: '700', color: '#9CA3AF', letterSpacing: 0.8, marginBottom: 4 },
  itemRow:    { fontSize: 13, color: '#374151', lineHeight: 20 },

  btnRow:    { flexDirection: 'row', gap: 8, marginTop: 6 },
  rejectBtn: { flex: 1, borderWidth: 2, borderColor: '#FCA5A5', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  rejectText:{ color: '#EF4444', fontWeight: '700', fontSize: 14 },
  acceptBtn: { flex: 1, backgroundColor: '#22C55E', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  acceptText:{ color: '#fff', fontWeight: '700', fontSize: 14 },

  startBtn:  { backgroundColor: '#F97316', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  startText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  empty:     { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 52, marginBottom: 14 },
  emptyText: { fontSize: 15, color: '#9CA3AF' },
})
