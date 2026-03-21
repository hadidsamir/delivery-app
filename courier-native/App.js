// CRITICO: importar la tarea ANTES que cualquier componente React
// Android puede reiniciar el proceso y la tarea debe estar registrada
import './src/lib/backgroundTask'

import React, { useEffect, useState } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { StatusBar } from 'expo-status-bar'
import * as Location from 'expo-location'
import AsyncStorage from '@react-native-async-storage/async-storage'

import LoginScreen from './src/screens/LoginScreen'
import OrdersScreen from './src/screens/OrdersScreen'
import TrackingScreen from './src/screens/TrackingScreen'
import { BACKGROUND_LOCATION_TASK } from './src/lib/backgroundTask'

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
