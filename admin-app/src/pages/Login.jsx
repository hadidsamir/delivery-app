import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail]     = useState('')
  const [pass, setPass]       = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: pass,
    })

    setLoading(false)

    if (authError) {
      setError('Correo o contraseña incorrectos')
      return
    }

    navigate('/dashboard')
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#000000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    }}>

      <div style={{ width: '100%', maxWidth: '460px' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <img
            src="/logo.png"
            alt="1012 Delivery"
            style={{
              height: '210px',
              width: 'auto',
              objectFit: 'contain',
              margin: '0 auto',
              display: 'block',
              mixBlendMode: 'screen',
            }}
          />
          <p style={{
            color: '#6b7280',
            fontSize: '13px',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            marginTop: '16px',
            fontWeight: '500',
          }}>
            Panel de Administración
          </p>
        </div>

        {/* Card */}
        <div style={{
          backgroundColor: '#111111',
          border: '1px solid #222222',
          borderRadius: '20px',
          padding: '40px',
          boxShadow: '0 25px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(249,115,22,0.05)',
        }}>

          <form onSubmit={handleSubmit}>

            {/* Email */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: '600',
                color: '#9ca3af',
                marginBottom: '8px',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}>
                Correo electrónico
              </label>
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError('') }}
                placeholder="admin@tuempresa.com"
                required
                style={{
                  width: '100%',
                  backgroundColor: '#1a1a1a',
                  border: '1px solid #2a2a2a',
                  borderRadius: '12px',
                  padding: '16px 18px',
                  color: '#ffffff',
                  fontSize: '15px',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
                onFocus={e => {
                  e.target.style.borderColor = '#f97316'
                  e.target.style.boxShadow = '0 0 0 3px rgba(249,115,22,0.15)'
                }}
                onBlur={e => {
                  e.target.style.borderColor = '#2a2a2a'
                  e.target.style.boxShadow = 'none'
                }}
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: '28px' }}>
              <label style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: '600',
                color: '#9ca3af',
                marginBottom: '8px',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}>
                Contraseña
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={pass}
                  onChange={e => { setPass(e.target.value); setError('') }}
                  placeholder="••••••••••"
                  required
                  style={{
                    width: '100%',
                    backgroundColor: '#1a1a1a',
                    border: '1px solid #2a2a2a',
                    borderRadius: '12px',
                    padding: '16px 52px 16px 18px',
                    color: '#ffffff',
                    fontSize: '15px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                  }}
                  onFocus={e => {
                    e.target.style.borderColor = '#f97316'
                    e.target.style.boxShadow = '0 0 0 3px rgba(249,115,22,0.15)'
                  }}
                  onBlur={e => {
                    e.target.style.borderColor = '#2a2a2a'
                    e.target.style.boxShadow = 'none'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  style={{
                    position: 'absolute',
                    right: '16px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#4b5563',
                    padding: '0',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {showPass ? (
                    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                backgroundColor: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: '12px',
                padding: '14px 16px',
                marginBottom: '20px',
                color: '#f87171',
                fontSize: '14px',
              }}>
                <svg width="18" height="18" fill="currentColor" viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}

            {/* Botón */}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                background: loading
                  ? '#c2410c'
                  : 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                border: 'none',
                borderRadius: '14px',
                padding: '18px',
                color: '#ffffff',
                fontSize: '16px',
                fontWeight: '700',
                letterSpacing: '0.03em',
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                boxShadow: loading ? 'none' : '0 8px 30px rgba(249,115,22,0.4)',
                transition: 'all 0.2s',
                opacity: loading ? 0.8 : 1,
              }}
              onMouseEnter={e => {
                if (!loading) {
                  e.target.style.transform = 'translateY(-1px)'
                  e.target.style.boxShadow = '0 12px 40px rgba(249,115,22,0.5)'
                }
              }}
              onMouseLeave={e => {
                e.target.style.transform = 'translateY(0)'
                e.target.style.boxShadow = '0 8px 30px rgba(249,115,22,0.4)'
              }}
            >
              {loading ? (
                <>
                  <svg style={{ animation: 'spin 1s linear infinite', width: '20px', height: '20px' }} fill="none" viewBox="0 0 24 24">
                    <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Verificando...
                </>
              ) : (
                <>
                  <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                  </svg>
                  Ingresar al Panel
                </>
              )}
            </button>

          </form>
        </div>

        {/* Footer */}
        <p style={{
          textAlign: 'center',
          color: '#374151',
          fontSize: '12px',
          marginTop: '24px',
          letterSpacing: '0.05em',
        }}>
          © 2026 1012 Delivery · Todos los derechos reservados
        </p>

      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        input::placeholder { color: #4b5563; }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  )
}
