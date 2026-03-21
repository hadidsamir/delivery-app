import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, RefreshControl, Alert, StatusBar, SafeAreaView, Image,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase'

export default function OrdersScreen({ navigation }) {
  const [courier, setCourier] = useState(null)
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    loadCourier()
  }, [])

  async function loadCourier() {
    const stored = await AsyncStorage.getItem('courier')
    if (!stored) { navigation.replace('Login'); return }
    const data = JSON.parse(stored)
    setCourier(data)
    fetchOrders(data.id)

    // Suscripción Realtime: nuevos pedidos asignados
    const channel = supabase
      .channel('native-orders-' + data.id)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload) => {
          if (payload.new.courier_id === data.id) fetchOrders(data.id)
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          if (payload.new.courier_id === data.id ||
              payload.old?.courier_id === data.id) {
            fetchOrders(data.id)
          }
        }
      )
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
    Alert.alert(
      'Rechazar pedido',
      '¿Seguro? El pedido será devuelto al administrador.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Rechazar',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('orders').update({ status: 'pendiente', courier_id: null }).eq('id', orderId)
            fetchOrders(courier.id)
          },
        },
      ]
    )
  }

  function handleLogout() {
    Alert.alert('Cerrar sesión', '¿Deseas salir?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Salir',
        style: 'destructive',
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
      <View style={[styles.orderCard, isPendiente && styles.orderCardPendiente]}>
        {isPendiente && (
          <View style={styles.badgePendiente}>
            <Text style={styles.badgePendienteText}>⏳ Nuevo pedido asignado</Text>
          </View>
        )}

        {/* Dirección */}
        <View style={styles.row}>
          <Text style={styles.pinIcon}>📍</Text>
          <Text style={styles.address}>{item.delivery_address}</Text>
        </View>

        {/* Cliente */}
        <View style={styles.row}>
          <Text style={styles.pinIcon}>👤</Text>
          <Text style={styles.clientName}>{item.client_name}</Text>
        </View>

        {/* Teléfono */}
        {item.client_phone && (
          <View style={styles.row}>
            <Text style={styles.pinIcon}>📞</Text>
            <Text style={styles.phone}>{item.client_phone}</Text>
          </View>
        )}

        {/* Items */}
        {item.items?.length > 0 && (
          <View style={styles.itemsBox}>
            <Text style={styles.itemsTitle}>ARTÍCULOS</Text>
            {item.items.map((it, idx) => (
              <Text key={idx} style={styles.itemRow}>
                <Text style={styles.itemQty}>x{it.qty}  </Text>{it.name}
              </Text>
            ))}
          </View>
        )}

        {/* Botones */}
        {isPendiente ? (
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.rejectBtn}
              onPress={() => rejectOrder(item.id)}
              activeOpacity={0.8}
            >
              <Text style={styles.rejectBtnText}>✕ Rechazar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.acceptBtn}
              onPress={() => acceptOrder(item.id)}
              activeOpacity={0.8}
            >
              <Text style={styles.acceptBtnText}>✓ Aceptar</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.startBtn}
            onPress={() => navigation.navigate('Tracking', { order: item, courier })}
            activeOpacity={0.8}
          >
            <Text style={styles.startBtnText}>🛵  Iniciar entrega</Text>
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
      {/* Header */}
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
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#F97316']}
            tintColor="#F97316"
          />
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
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeHeader: {
    backgroundColor: '#fff',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  welcome: { fontSize: 12, color: '#6B7280' },
  courierName: { fontSize: 18, fontWeight: '700', color: '#111827' },
  logoutBtn: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  logoutText: { fontSize: 13, color: '#6B7280' },
  list: { padding: 16, gap: 12 },
  orderCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  orderCardPendiente: {
    borderWidth: 2,
    borderColor: '#FCD34D',
  },
  badgePendiente: {
    backgroundColor: '#FEF3C7',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  badgePendienteText: { color: '#92400E', fontSize: 12, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  pinIcon: { fontSize: 14, marginRight: 8, marginTop: 1 },
  address: { fontSize: 14, fontWeight: '600', color: '#111827', flex: 1 },
  clientName: { fontSize: 14, color: '#4B5563', flex: 1 },
  phone: { fontSize: 14, color: '#F97316', fontWeight: '600', flex: 1 },
  itemsBox: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 10,
    marginVertical: 8,
  },
  itemsTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  itemRow: { fontSize: 13, color: '#374151', lineHeight: 20 },
  itemQty: { color: '#F97316', fontWeight: '700' },
  buttonRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  rejectBtn: {
    flex: 1,
    borderWidth: 2,
    borderColor: '#FCA5A5',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  rejectBtnText: { color: '#EF4444', fontWeight: '700', fontSize: 14 },
  acceptBtn: {
    flex: 1,
    backgroundColor: '#22C55E',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  acceptBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  startBtn: {
    backgroundColor: '#F97316',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  startBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 15, color: '#9CA3AF' },
})
