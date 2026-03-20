// Importar la tarea en segundo plano ANTES que cualquier componente
import './src/lib/backgroundTask'

import React from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { StatusBar } from 'expo-status-bar'

import LoginScreen from './src/screens/LoginScreen'
import OrdersScreen from './src/screens/OrdersScreen'
import TrackingScreen from './src/screens/TrackingScreen'

const Stack = createNativeStackNavigator()

export default function App() {
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
