// CRITICO: importar la tarea ANTES que cualquier componente React
// Android puede reiniciar el proceso y la tarea debe estar registrada
import './src/lib/backgroundTask'

import React, { useEffect, useState } from 'react'
import { View, ActivityIndicator, Text } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import * as Notifications from 'expo-notifications'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './src/lib/supabase'
import { BACKGROUND_LOCATION_TASK, startAppKeepalive } from './src/lib/backgroundTask'

// ─── Listener de acciones de notificación a nivel de módulo ──────────────────
// Se registra ANTES de que React monte cualquier pantalla.
// - ACEPTAR: abre la app (opensAppToForeground: true lo hace automáticamente)
//            + descarta la notificación del panel
// - RECHAZAR: solo descarta la notificación, el pedido sigue pendiente en la app
Notifications.addNotificationResponseReceivedListener(async (response) => {
  const action  = response.actionIdentifier
  const notifId = response.notification.request.identifier

  if (action === 'aceptar' || action === 'rechazar') {
    await Notifications.dismissNotificationAsync(notifId).catch(() => {})
  }
})

import LoginScreen from './src/screens/LoginScreen'
import OrdersScreen from './src/screens/OrdersScreen'
import TrackingScreen from './src/screens/TrackingScreen'
import AvailableOrdersScreen from './src/screens/AvailableOrdersScreen'

const Stack = createNativeStackNavigator()
const Tab   = createBottomTabNavigator()

// ─── Tab Navigator principal ─────────────────────────────────────────────────
function MainTabs({ availableCount }) {
  const insets = useSafeAreaInsets()
  return (
    <Tab.Navigator
      lazy={false}
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#111827',
          borderTopColor: '#1F2937',
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom + 4,
        },
        tabBarActiveTintColor:   '#F97316',
        tabBarInactiveTintColor: '#6B7280',
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="MisPedidos"
        component={OrdersScreen}
        options={{
          tabBarLabel: 'Mis Pedidos',
          tabBarIcon: ({ color, size }) => (
            <Text style={{ fontSize: size - 2, color }}>🛵</Text>
          ),
        }}
      />
      <Tab.Screen
        name="Disponibles"
        component={AvailableOrdersScreen}
        options={{
          tabBarLabel: 'Disponibles',
          tabBarIcon: ({ color, size }) => (
            <Text style={{ fontSize: size - 2, color }}>🔔</Text>
          ),
          tabBarBadge: availableCount > 0 ? availableCount : undefined,
          tabBarBadgeStyle: { backgroundColor: '#00E8E1', color: '#000', fontSize: 11, fontWeight: '800' },
        }}
      />
    </Tab.Navigator>
  )
}

export default function App() {
  const [initialRoute, setInitialRoute]   = useState(null) // null = cargando
  const [availableCount, setAvailableCount] = useState(0)

  useEffect(() => {
    bootstrap()
    // Suscripción para el badge de pedidos disponibles
    const channel = supabase
      .channel('available-badge')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'orders',
        filter: 'source=eq.cliente',
      }, () => loadAvailableCount())
      .subscribe()
    loadAvailableCount()
    return () => supabase.removeChannel(channel)
  }, [])

  async function loadAvailableCount() {
    try {
      const { count } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .is('courier_id', null)
        .eq('status', 'pendiente')
        .eq('source', 'cliente')
      setAvailableCount(count || 0)
    } catch {}
  }

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
        setInitialRoute('MainTabs')
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
    <SafeAreaProvider>
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
      >
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="MainTabs">
          {() => <MainTabs availableCount={availableCount} />}
        </Stack.Screen>
        <Stack.Screen name="Tracking" component={TrackingScreen} />
      </Stack.Navigator>
    </NavigationContainer>
    </SafeAreaProvider>
  )
}
