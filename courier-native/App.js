// IMPORTANTE: importar la tarea ANTES que cualquier componente
import './src/lib/backgroundTask'

import React, { useEffect } from 'react'
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
  useEffect(() => {
    cleanupStaleTask()
  }, [])

  // Limpiar tarea de segundo plano si quedó activa de una sesión anterior
  async function cleanupStaleTask() {
    try {
      const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
        .catch(() => false)
      if (isRunning) {
        const stored = await AsyncStorage.getItem('activeDelivery')
        // Solo limpiar si NO hay una entrega activa válida
        if (!stored) {
          await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
          console.log('[App] Tarea GPS obsoleta detenida')
        }
      }
    } catch (err) {
      console.log('[App] Cleanup error (no crítico):', err.message)
    }
  }

  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator
        initialRouteName="Login"
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Orders" component={OrdersScreen} />
        <Stack.Screen name="Tracking" component={TrackingScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}
