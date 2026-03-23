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
import { startAppKeepalive, stopAppKeepalive } from '../lib/backgroundTask'

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

    async function init() {
      const stored = await AsyncStorage.getItem('courier')
      if (!stored) { navigation.replace('Login'); return }
      courierData = JSON.parse(stored)
      setCourier(courierData)
      fetchOrders(courierData.id)
      setupNotifications()
      checkBatteryOptimization()
      startAppKeepalive()
      subscribeRealtime(courierData.id)
    }

    function subscribeRealtime(courierId) {
      // Eliminar canal previo si existe
      if (channel) supabase.removeChannel(channel)

      channel = supabase
        .channel('native-orders-' + courierId + '-' + Date.now())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' },
          async (payload) => {
            if (payload.new.courier_id === courierId) {
              fetchOrders(courierId)
              notifyNewOrder(payload.new)
            }
          })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' },
          async (payload) => {
            const wasReassigned =
              payload.new.courier_id === courierId &&
              payload.old?.courier_id !== courierId &&
              payload.new.status === 'pendiente'

            if (payload.new.courier_id === courierId || payload.old?.courier_id === courierId)
              fetchOrders(courierId)

            if (wasReassigned) notifyNewOrder(payload.new)
          })
        .subscribe((status) => {
          console.log('[Realtime] Estado del canal:', status)
        })
    }

    // Refrescar pedidos y reconectar Realtime al volver al primer plano
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && courierData?.id) {
        fetchOrders(courierData.id)
        subscribeRealtime(courierData.id) // reconectar canal por si se cayó
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
    // Evitar notificación duplicada para el mismo pedido
    if (notifiedOrders.current.has(order.id)) return
    addNotified(order.id)
    try {
      await Notifications.scheduleNotificationAsync({
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
    if (!courier?.id) return
    try {
      await supabase.from('orders').update({ status: 'en_camino' }).eq('id', orderId)
      fetchOrders(courier.id)
    } catch (err) {
      Alert.alert('Error', 'No se pudo aceptar el pedido: ' + err.message)
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
            await supabase.from('orders').update({ status: 'pendiente', courier_id: null }).eq('id', orderId)
            // Limpiar del Set para permitir nueva notificación si se reasigna
            notifiedOrders.current.delete(orderId)
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
      navigation.navigate('Tracking', { order, courier })

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
          navigation.replace('Login')
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
            <TouchableOpacity style={styles.rejectBtn} onPress={() => rejectOrder(item.id)} activeOpacity={0.8}>
              <Text style={styles.rejectText}>Rechazar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.acceptBtn} onPress={() => acceptOrder(item.id)} activeOpacity={0.8}>
              <Text style={styles.acceptText}>Aceptar</Text>
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
