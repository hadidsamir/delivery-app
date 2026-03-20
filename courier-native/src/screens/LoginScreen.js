import React, { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase'

export default function LoginScreen({ navigation }) {
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    const phoneClean = phone.trim()
    if (!phoneClean) {
      Alert.alert('Error', 'Ingresa tu número de teléfono')
      return
    }

    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('couriers')
        .select('*')
        .eq('phone', phoneClean)
        .eq('is_active', true)
        .single()

      if (error || !data) {
        Alert.alert('Error', 'Mensajero no encontrado. Verifica tu número.')
        return
      }

      await AsyncStorage.setItem('courier', JSON.stringify(data))
      navigation.replace('Orders')
    } catch (err) {
      Alert.alert('Error', 'Error de conexión. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.card}>
        {/* Logo / ícono */}
        <View style={styles.iconCircle}>
          <Text style={styles.iconText}>🛵</Text>
        </View>

        <Text style={styles.title}>Mensajero</Text>
        <Text style={styles.subtitle}>Ingresa con tu número de teléfono</Text>

        <TextInput
          style={styles.input}
          placeholder="Ej: 300-123-4567"
          placeholderTextColor="#9CA3AF"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
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
    backgroundColor: '#F9FAFB',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
    alignItems: 'center',
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconText: {
    fontSize: 40,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#111827',
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
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111827',
    backgroundColor: '#F9FAFB',
    marginBottom: 16,
  },
  button: {
    width: '100%',
    backgroundColor: '#F97316',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
})
