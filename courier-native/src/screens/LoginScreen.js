import React, { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert, Image,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase'

export default function LoginScreen({ navigation }) {
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    const phoneClean = phone.trim()
    if (!phoneClean) {
      Alert.alert('Error', 'Ingresa tu numero de telefono')
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
        Alert.alert('Error', 'Mensajero no encontrado. Verifica tu numero.')
        return
      }

      await AsyncStorage.setItem('courier', JSON.stringify(data))
      navigation.replace('Orders')
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
