'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn, signUp } from '@/lib/auth'

export default function AuthPage() {
  const [mode, setMode]         = useState<'signin' | 'signup'>('signin')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    if (mode === 'signup') {
      const { data, error: err } = await signUp(email, password)
      if (err) {
        setError(err.message)
      } else if (data.session) {
        // Email confirmation disabled — session returned immediately
        window.location.href = '/'
      } else {
        // Email confirmation enabled — show check-email screen
        setEmailSent(true)
      }
    } else {
      const { error: err } = await signIn(email, password)
      if (err) {
        const msg = err.message.toLowerCase()
        if (msg.includes('invalid login') || msg.includes('invalid credentials')) {
          setError('Wrong email or password — please try again.')
        } else if (msg.includes('not confirmed') || msg.includes('email not confirmed')) {
          setError('Please confirm your email address before signing in.')
        } else {
          setError(err.message)
        }
      } else {
        window.location.href = '/'
      }
    }

    setLoading(false)
  }

  function switchMode() {
    setMode(m => m === 'signin' ? 'signup' : 'signin')
    setError(null)
    setEmailSent(false)
  }

  const warmStyle = {
    fontFamily: "'Nunito', sans-serif",
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #fdf6ec 0%, #fde8d0 50%, #fce4e4 100%)',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    position: 'relative' as const,
    overflow: 'hidden',
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    border: '2px solid #eee',
    borderRadius: '14px',
    padding: '14px 16px',
    fontFamily: "'Nunito', sans-serif",
    fontWeight: 700,
    fontSize: '15px',
    color: '#2d2d2d',
    background: 'white',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  }

  // "Check your email" screen
  if (emailSent) {
    return (
      <main style={warmStyle}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>
        <div style={{ position: 'absolute', top: '-80px', left: '-80px', width: '300px', height: '300px', background: 'rgba(255,180,120,0.3)', borderRadius: '60% 40% 70% 30% / 50% 60% 40% 70%' }} />
        <div style={{ position: 'absolute', bottom: '-60px', right: '-60px', width: '250px', height: '250px', background: 'rgba(255,150,150,0.25)', borderRadius: '40% 60% 30% 70% / 60% 40% 70% 30%' }} />
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: '360px' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>📬</div>
          <h1 style={{ fontFamily: "'Fredoka One', cursive", fontSize: '36px', color: '#2d2d2d', margin: '0 0 12px' }}>Check your email</h1>
          <p style={{ color: '#888', fontWeight: 700, fontSize: '15px', lineHeight: 1.6, margin: '0 0 24px' }}>
            We've sent a confirmation link to <strong style={{ color: '#ff7043' }}>{email}</strong>. Click it to activate your account, then come back to sign in.
          </p>
          <button
            onClick={() => { setEmailSent(false); setMode('signin') }}
            style={{ background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontFamily: "'Fredoka One', cursive", fontSize: '18px', padding: '14px 36px', borderRadius: '50px', border: 'none', cursor: 'pointer', boxShadow: '0 8px 24px rgba(255,112,67,0.4)' }}
          >
            Back to Sign In
          </button>
        </div>
      </main>
    )
  }

  return (
    <main style={warmStyle}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>

      {/* Background blobs */}
      <div style={{ position: 'absolute', top: '-80px', left: '-80px', width: '300px', height: '300px', background: 'rgba(255,180,120,0.3)', borderRadius: '60% 40% 70% 30% / 50% 60% 40% 70%' }} />
      <div style={{ position: 'absolute', bottom: '-60px', right: '-60px', width: '250px', height: '250px', background: 'rgba(255,150,150,0.25)', borderRadius: '40% 60% 30% 70% / 60% 40% 70% 30%' }} />

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '400px' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ fontSize: '56px', marginBottom: '8px' }}>🛒</div>
          <h1 style={{ fontFamily: "'Fredoka One', cursive", fontSize: '44px', color: '#2d2d2d', margin: '0 0 6px', letterSpacing: '1px' }}>ShelfSense</h1>
          <p style={{ color: '#aaa', fontWeight: 700, fontSize: '14px', margin: 0 }}>
            {mode === 'signin' ? 'Welcome back! Sign in to continue.' : 'Create your account to get started.'}
          </p>
        </div>

        {/* Card */}
        <div style={{ background: 'white', borderRadius: '24px', padding: '28px', boxShadow: '0 12px 40px rgba(0,0,0,0.1)' }}>

          {/* Mode toggle */}
          <div style={{ display: 'flex', background: '#f5f5f5', borderRadius: '12px', padding: '4px', marginBottom: '24px' }}>
            {(['signin', 'signup'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(null) }}
                style={{ flex: 1, padding: '9px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontFamily: "'Nunito', sans-serif", fontWeight: 700, fontSize: '14px', background: mode === m ? 'white' : 'transparent', color: mode === m ? '#ff7043' : '#aaa', boxShadow: mode === m ? '0 2px 8px rgba(0,0,0,0.08)' : 'none', transition: 'all 0.2s' }}
              >
                {m === 'signin' ? 'Sign In' : 'Sign Up'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontFamily: "'Nunito', sans-serif", fontWeight: 700, fontSize: '13px', color: '#888', marginBottom: '6px' }}>
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontFamily: "'Nunito', sans-serif", fontWeight: 700, fontSize: '13px', color: '#888', marginBottom: '6px' }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'}
                required
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                style={inputStyle}
              />
            </div>

            {error && (
              <div style={{ background: '#fff0f0', border: '1.5px solid rgba(255,68,68,0.2)', borderRadius: '12px', padding: '12px 14px' }}>
                <p style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 700, fontSize: '13px', color: '#ff4444', margin: 0 }}>
                  😕 {error}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{ background: loading ? '#ffb998' : 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontFamily: "'Fredoka One', cursive", fontSize: '19px', padding: '15px', borderRadius: '50px', border: 'none', cursor: loading ? 'default' : 'pointer', boxShadow: loading ? 'none' : '0 8px 24px rgba(255,112,67,0.4)', marginTop: '4px', transition: 'all 0.2s' }}
            >
              {loading ? '...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <p style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 700, fontSize: '13px', color: '#bbb', textAlign: 'center', margin: '20px 0 0' }}>
            {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <button onClick={switchMode} style={{ background: 'none', border: 'none', color: '#ff7043', fontWeight: 800, fontSize: '13px', cursor: 'pointer', fontFamily: "'Nunito', sans-serif", padding: 0 }}>
              {mode === 'signin' ? 'Sign up free' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </main>
  )
}
