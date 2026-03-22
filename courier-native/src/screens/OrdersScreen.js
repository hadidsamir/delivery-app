import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, RefreshControl, Alert, StatusBar, Image, Platform,
  PermissionsAndroid, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import * as Notifications from 'expo-notifications'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase'

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

  useEffect(() => {
    loadCourier()
  }, [])

  // Registrar push token y guardarlo en Supabase
  async function registerPushToken(courierId) {
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('pedidos', {
          name: 'Pedidos nuevos',
          importance: Notifications.AndroidImportance.MAX,
          sound: true,
          vibrationPattern: [0, 250, 250, 250],
        })
      }
      const { status } = await Notifications.requestPermissionsAsync()
      if (status !== 'granted') return
      const token = (await Notifications.getExpoPushTokenAsync()).data
      await supabase.from('couriers').update({ push_token: token }).eq('id', courierId)
      console.log('[Push] Token registrado:', token)
    } catch (err) {
      console.warn('[Push] Error registrando token:', err.message)
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

  async function loadCourier() {
    const stored = await AsyncStorage.getItem('courier')
    if (!stored) { navigation.replace('Login'); return }
    const data = JSON.parse(stored)
    setCourier(data)
    fetchOrders(data.id)
    registerPushToken(data.id)
    checkBatteryOptimization()

    const channel = supabase
      .channel('native-orders-' + data.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload) => { if (payload.new.courier_id === data.id) fetchOrders(data.id) })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          if (payload.new.courier_id === data.id || payload.old?.courier_id === data.id)
            fetchOrders(data.id)
        })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }

  async function fetchOrders(courierId) {
    const { data } = await supabase
      .from('orders')
      .select('*')
      .eq('courier_id', courierId)
      .in('status', ['pendiente', 'en_camino'])
      .order('created_at', { ascending: true })
    setOrders(data || [])
    setLoading(false)
    setRefreshing(false)
  }

  async function acceptOrder(orderId) {
    await supabase.from('orders').update({ status: 'en_camino' }).eq('id', orderId)
    fetchOrders(courier.id)
  }

  async function rejectOrder(orderId) {
    Alert.alert('Rechazar pedido', 'El pedido volverá al administrador.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Rechazar', style: 'destructive',
        onPress: async () => {
          await supabase.from('orders').update({ status: 'pendiente', courier_id: null }).eq('id', orderId)
          fetchOrders(courier.id)
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

      // 3. Permiso concedido → navegar a Tracking (sin más diálogos)
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
