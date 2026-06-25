import React, { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert, Image,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import { supabase } from '../lib/supabase'
import { BACKEND_URL } from '../lib/config'

// Obtiene y guarda el token FCM directo en Supabase.
// Usamos getDevicePushTokenAsync() porque la app se construye localmente
// con Gradle (no EAS), por lo que necesitamos el token FCM nativo.
async function registerPushToken(courierId) {
  try {
    const { status } = await Notifications.requestPermissionsAsync()
    if (status !== 'granted') return

    const tokenData = await Notifications.getDevicePushTokenAsync()
    const token = tokenData?.data
    if (!token) return

    await supabase
      .from('couriers')
      .update({ push_token: token })
      .eq('id', courierId)

    console.log('[Push] Token FCM registrado:', token.slice(0, 20) + '...')
  } catch (err) {
    console.warn('[Push] Error registrando token FCM:', err.message)
  }
}

export default function LoginScreen({ navigation }) {
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    const phoneClean = phone.trim()
    const pinClean = pin.trim()
    if (!phoneClean || !pinClean) {
      Alert.alert('Error', 'Ingresa tu número de teléfono y PIN')
      return
    }
    if (phoneClean.replace(/\D/g, '').length < 7) {
      Alert.alert('Error', 'Ingresa un número de teléfono válido')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/courier/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneClean, pin: pinClean }),
      })
      const result = await res.json().catch(() => null)

      if (!res.ok || !result?.courier) {
        Alert.alert('Error', result?.error || 'Teléfono o PIN incorrecto.')
        return
      }

      // Registrar push token en Supabase (en paralelo, no bloquea el login)
      registerPushToken(result.courier.id)

      await AsyncStorage.setItem('courier', JSON.stringify(result.courier))
      navigation.replace('MainTabs')
    } catch (err) {
      Alert.alert('Error', 'Error de conexion. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Logo */}
      <View style={styles.logoBox}>
        <Image
          source={require('../../assets/icon.png')}
          style={styles.logoImage}
          resizeMode="contain"
        />
      </View>

      {/* Card de login */}
      <View style={styles.card}>
        <Text style={styles.title}>Bienvenido</Text>
        <Text style={styles.subtitle}>Ingresa con tu numero de telefono</Text>

        <TextInput
          style={styles.input}
          placeholder="Ej: 300-123-4567"
          placeholderTextColor="#9CA3AF"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoCorrect={false}
          returnKeyType="next"
        />

        <TextInput
          style={[styles.input, { marginTop: 12 }]}
          placeholder="PIN"
          placeholderTextColor="#9CA3AF"
          value={pin}
          onChangeText={setPin}
          keyboardType="number-pad"
          secureTextEntry
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={handleLogin}
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>Ingresar</Text>
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    padding: 24,
  },
  logoBox: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoImage: {
    width: 200,
    height: 200,
  },
  card: {
    backgroundColor: '#111111',
    borderRadius: 20,
    padding: 28,
    borderWidth: 1,
    borderColor: '#222222',
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 24,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    borderWidth: 1.5,
    borderColor: '#333333',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#FFFFFF',
    backgroundColor: '#1A1A1A',
    marginBottom: 16,
  },
  button: {
    width: '100%',
    backgroundColor: '#F97316',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
})
