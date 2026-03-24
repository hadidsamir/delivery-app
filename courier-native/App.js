// CRITICO: importar la tarea ANTES que cualquier componente React
// Android puede reiniciar el proceso y la tarea debe estar registrada
import './src/lib/backgroundTask'

import React, { useEffect, useState } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { StatusBar } from 'expo-status-bar'
import * as Location from 'expo-location'
import * as Notifications from 'expo-notifications'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './src/lib/supabase'
import { BACKGROUND_LOCATION_TASK, startAppKeepalive } from './src/lib/backgroundTask'

// ─── Listener de acciones de notificación a nivel de módulo ──────────────────
// Se registra ANTES de que React monte cualquier pantalla.
// Funciona incluso si la app estaba completamente cerrada cuando el usuario
// toca "Aceptar" o "Rechazar" en la notificación de nuevo pedido.
Notifications.addNotificationResponseReceivedListener(async (response) => {
  const action  = response.actionIdentifier
  const notifId = response.notification.request.identifier
  const orderId = response.notification.request.content.data?.orderId
  if (!orderId) return

  try {
    if (action === 'aceptar') {
      // Descartar la notificación del sistema
      await Notifications.dismissAllNotificationsAsync().catch(() => {})

      // Recuperar courierId para restaurar el mensajero si fue rechazado antes
      let courierId = null
      try {
        const raw = await AsyncStorage.getItem('courier')
        if (raw) courierId = JSON.parse(raw)?.id
      } catch {}

      const update = { status: 'en_camino' }
      if (courierId) update.courier_id = courierId

      const { error: acceptErr } = await supabase.from('orders')
        .update(update)
        .eq('id', orderId)
      if (acceptErr) throw acceptErr
      console.log('[App] Pedido aceptado:', orderId)

    } else if (action === 'rechazar') {
      // CRÍTICO: en Android las acciones sin opensAppToForeground nunca
      // descartan la notificación automáticamente — hay que hacerlo primero
      // e incondicionalmente antes de cualquier operación async.
      await Notifications.dismissAllNotificationsAsync().catch(() => {})
      await Notifications.dismissNotificationAsync(notifId).catch(() => {})

      const { error: rejectErr } = await supabase.from('orders')
        .update({ status: 'pendiente', courier_id: null })
        .eq('id', orderId)
      if (rejectErr) throw rejectErr

      // Limpiar keepaliveNotified para que si se reasigna llegue nueva notificación
      try {
        const raw = await AsyncStorage.getItem('keepaliveNotified') || '[]'
        const filtered = JSON.parse(raw).filter(id => id !== orderId)
        await AsyncStorage.setItem('keepaliveNotified', JSON.stringify(filtered))
      } catch {}

      console.log('[App] Pedido rechazado y notificación descartada:', orderId)
    }
  } catch (err) {
    console.error('[App] Error procesando acción de notificación:', err.message)
  }
})

import LoginScreen from './src/screens/LoginScreen'
import OrdersScreen from './src/screens/OrdersScreen'
import TrackingScreen from './src/screens/TrackingScreen'

const Stack = createNativeStackNavigator()

export default function App() {
  const [initialRoute, setInitialRoute] = useState(null) // null = cargando

  useEffect(() => {
    bootstrap()
  }, [])

  async function bootstrap() {
    try {
      // 1. Limpiar tarea de background si quedó huérfana (sin entrega activa)
      const isTaskRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
        .catch(() => false)

      if (isTaskRunning) {
        const activeDelivery = await AsyncStorage.getItem('activeDelivery')
        if (!activeDelivery) {
          // Tarea huérfana — detener
          await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {})
          console.log('[App] Tarea GPS huérfana detenida')
        }
      }

      // 2. Determinar pantalla inicial
      const courier = await AsyncStorage.getItem('courier')
      if (courier) {
        setInitialRoute('Orders')
        startAppKeepalive() // inicia el servicio de fondo para recibir notificaciones
      } else {
        setInitialRoute('Login')
      }
    } catch (err) {
      console.error('[App] Error en bootstrap:', err.message)
      setInitialRoute('Login')
    }
  }

  // Pantalla de carga mientras se inicializa
  if (!initialRoute) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#F97316" />
      </View>
    )
  }

  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
      >
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Orders" component={OrdersScreen} />
        <Stack.Screen name="Tracking" component={TrackingScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}
