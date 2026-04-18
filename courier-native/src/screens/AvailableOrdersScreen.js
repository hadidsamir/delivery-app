import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, RefreshControl, Alert, StatusBar,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase'
import { BACKEND_URL } from '../lib/config'

export default function AvailableOrdersScreen({ navigation }) {
  const [orders, setOrders]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [claiming, setClaiming]   = useState(null) // id del pedido que se está tomando
  const [courier, setCourier]     = useState(null)

  // Refrescar al enfocar el tab (cubre casos donde Realtime pierde conexión
  // o el screen no estaba montado cuando llegó el pedido)
  useFocusEffect(
    useCallback(() => {
      fetchOrders()
    }, [])
  )

  useEffect(() => {
    let channel = null

    async function init() {
      const stored = await AsyncStorage.getItem('courier')
      if (!stored) return
      const courierData = JSON.parse(stored)
      setCourier(courierData)
      await fetchOrders()
      channel = subscribeRealtime()
    }

    function subscribeRealtime() {
      const ch = supabase
        .channel('available-orders-' + Date.now())
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'orders',
        }, () => fetchOrders())
        .on('postgres_changes', {
          event: 'UPDATE', schema: 'public', table: 'orders',
        }, () => fetchOrders())
        .subscribe()
      return ch
    }

    init()
    return () => { if (channel) supabase.removeChannel(channel) }
  }, [])

  async function fetchOrders() {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('id, pickup_address, delivery_address, base_amount, payment_method, description, created_at, client_name, client_phone')
        .is('courier_id', null)
        .eq('status', 'pendiente')
        .in('source', ['cliente', 'whatsapp'])
        .order('created_at', { ascending: false })
      if (error) throw error
      setOrders(data || [])
    } catch (err) {
      console.error('[Available] Error cargando servicios:', err.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  async function claimOrder(orderId) {
    if (!courier?.id) return

    // Verificar elegibilidad local: < 2 pedidos en_camino
    try {
      const { data: active, error } = await supabase
        .from('orders')
        .select('id')
        .eq('courier_id', courier.id)
        .eq('status', 'en_camino')
      if (error) throw error
      if ((active?.length || 0) >= 2) {
        Alert.alert(
          'No puedes tomar más servicios',
          'Ya tienes 2 entregas en camino. Completa una antes de tomar otro servicio.',
          [{ text: 'OK' }]
        )
        return
      }
    } catch (err) {
      Alert.alert('Error', 'No se pudo verificar disponibilidad: ' + err.message)
      return
    }

    Alert.alert(
      'Tomar servicio',
      '¿Deseas tomar este servicio?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Tomar',
          onPress: async () => {
            setClaiming(orderId)
            try {
              const res = await fetch(`${BACKEND_URL}/api/orders/${orderId}/claim`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courier_id: courier.id }),
              })
              if (res.status === 409) {
                Alert.alert('Ya fue tomado', 'Otro mensajero tomó este servicio primero.')
                fetchOrders()
                return
              }
              if (!res.ok) {
                const body = await res.json().catch(() => ({}))
                throw new Error(body.error || 'Error del servidor')
              }
              // Éxito — quitar de la lista de "ya notificados" para que pueda volver a notificar si se libera
              try {
                const raw = await AsyncStorage.getItem('availableNotified') || '[]'
                const filtered = JSON.parse(raw).filter(id => id !== orderId)
                await AsyncStorage.setItem('availableNotified', JSON.stringify(filtered))
              } catch {}
              // Navegar a Mis Pedidos
              navigation.navigate('MisPedidos')
              fetchOrders()
            } catch (err) {
              Alert.alert('Error', 'No se pudo tomar el servicio: ' + err.message)
            } finally {
              setClaiming(null)
            }
          },
        },
      ]
    )
  }

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    fetchOrders()
  }, [])

  function formatAmount(amount) {
    if (!amount) return null
    return '$' + Number(amount).toLocaleString('es-CO')
  }

  function timeAgo(dateStr) {
    const mins = Math.floor((Date.now() - new Date(dateStr)) / 60000)
    if (mins < 1) return 'Ahora mismo'
    if (mins < 60) return `Hace ${mins} min`
    const hrs = Math.floor(mins / 60)
    return `Hace ${hrs} h`
  }

  function renderOrder({ item }) {
    const isClaiming = claiming === item.id
    const amount = formatAmount(item.base_amount)

    return (
      <View style={styles.card}>
        {/* Header de la card */}
        <View style={styles.cardHeader}>
          <View style={styles.badgeRow}>
            {item.payment_method && (
              <View style={[
                styles.payBadge,
                item.payment_method === 'efectivo' ? styles.payEfectivo : styles.payTransfer
              ]}>
                <Text style={styles.payBadgeText}>
                  {item.payment_method === 'efectivo' ? '💵 Efectivo' : '📲 Transferencia'}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
        </View>

        {/* Monto */}
        {amount && (
          <Text style={styles.amount}>{amount}</Text>
        )}

        {/* Direcciones */}
        <View style={styles.addressBlock}>
          <View style={styles.row}>
            <View style={[styles.dot, styles.dotOrange]} />
            <View style={styles.addressTextWrap}>
              <Text style={styles.addressLabel}>RECOGIDA</Text>
              <Text style={styles.addressText}>{item.pickup_address || 'No especificada'}</Text>
            </View>
          </View>
          <View style={styles.line} />
          <View style={styles.row}>
            <View style={[styles.dot, styles.dotBlue]} />
            <View style={styles.addressTextWrap}>
              <Text style={styles.addressLabel}>ENTREGA</Text>
              <Text style={styles.addressText}>{item.delivery_address}</Text>
            </View>
          </View>
        </View>

        {/* Datos de contacto */}
        {(item.client_name || item.client_phone) && (
          <View style={styles.contactRow}>
            {item.client_name ? <Text style={styles.contactText}>👤 {item.client_name}</Text> : null}
            {item.client_phone ? <Text style={styles.contactText}>📞 {item.client_phone}</Text> : null}
          </View>
        )}

        {/* Descripción */}
        {!!item.description && (
          <View style={styles.descBox}>
            <Text style={styles.descText}>{item.description}</Text>
          </View>
        )}

        {/* Botón tomar */}
        <TouchableOpacity
          style={[styles.claimBtn, isClaiming && styles.claimBtnDisabled]}
          onPress={() => claimOrder(item.id)}
          disabled={isClaiming || claiming !== null}
          activeOpacity={0.8}
        >
          {isClaiming
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.claimText}>Tomar servicio</Text>
          }
        </TouchableOpacity>
      </View>
    )
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#00E8E1" />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
      <SafeAreaView style={styles.safeHeader}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Servicios Disponibles</Text>
          {orders.length > 0 && (
            <View style={styles.countBadge}>
              <Text style={styles.countText}>{orders.length}</Text>
            </View>
          )}
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
            colors={['#00E8E1']}
            tintColor="#00E8E1"
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🔍</Text>
            <Text style={styles.emptyTitle}>Sin servicios disponibles</Text>
            <Text style={styles.emptySubtitle}>
              Los nuevos servicios aparecerán aquí en tiempo real
            </Text>
          </View>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#0F172A' },
  centered:   { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F172A' },

  safeHeader: { backgroundColor: '#0F172A' },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#F8FAFC', flex: 1 },
  countBadge:  { backgroundColor: '#00E8E1', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  countText:   { color: '#0F172A', fontWeight: '800', fontSize: 13 },

  list: { padding: 16, gap: 14, paddingBottom: 32 },

  card: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 10,
  },

  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badgeRow:   { flexDirection: 'row', gap: 6 },
  payBadge:   { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  payEfectivo:   { backgroundColor: '#14532D' },
  payTransfer:   { backgroundColor: '#1e3a5f' },
  payBadgeText:  { fontSize: 12, fontWeight: '700', color: '#fff' },
  time:          { fontSize: 12, color: '#64748B' },

  amount: { fontSize: 22, fontWeight: '800', color: '#00E8E1' },

  addressBlock: { gap: 6 },
  row:          { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dot:          { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  dotOrange:    { backgroundColor: '#F97316' },
  dotBlue:      { backgroundColor: '#3B82F6' },
  line:         { width: 2, height: 12, backgroundColor: '#334155', marginLeft: 4 },
  addressTextWrap: { flex: 1 },
  addressLabel: { fontSize: 10, color: '#64748B', fontWeight: '700', letterSpacing: 0.8 },
  addressText:  { fontSize: 13, color: '#CBD5E1', lineHeight: 18 },

  contactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  contactText:{ fontSize: 13, color: '#94A3B8' },

  descBox:  { backgroundColor: '#0F172A', borderRadius: 8, padding: 10 },
  descText: { fontSize: 13, color: '#94A3B8', lineHeight: 18 },

  claimBtn:         { backgroundColor: '#00E8E1', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 2 },
  claimBtnDisabled: { opacity: 0.6 },
  claimText:        { color: '#0F172A', fontWeight: '800', fontSize: 15 },

  empty:       { alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyIcon:   { fontSize: 52, marginBottom: 14 },
  emptyTitle:  { fontSize: 17, fontWeight: '700', color: '#CBD5E1', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: '#64748B', textAlign: 'center', lineHeight: 20 },
})
