'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { signOut } from '@/lib/auth'

const THEMES = [
  { id: 'warm',  name: 'Warm',  emoji: '🌅', swatch: 'linear-gradient(135deg, #fde8d0, #fce4e4)' },
  { id: 'light', name: 'Light', emoji: '☀️', swatch: 'linear-gradient(160deg, #fafafa, #e8e8e8)' },
  { id: 'sage',  name: 'Sage',  emoji: '🌿', swatch: 'linear-gradient(135deg, #d8edda, #c8e6cc)' },
  { id: 'dark',  name: 'Dark',  emoji: '🌙', swatch: 'linear-gradient(135deg, #252540, #1c1c2e)' },
]

export default function SettingsPage() {
  const [email, setEmail] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [currentTheme, setCurrentTheme] = useState('warm')
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setEmail(user?.email ?? null)
    })
    try {
      const saved = localStorage.getItem('shelfsense-theme') || 'warm'
      setCurrentTheme(saved)
    } catch {}
  }, [])

  async function handleSignOut() {
    setSigningOut(true)
    await signOut()
    router.push('/auth')
    router.refresh()
  }

  function applyTheme(id: string) {
    setCurrentTheme(id)
    try {
      localStorage.setItem('shelfsense-theme', id)
      document.documentElement.setAttribute('data-theme', id)
    } catch {}
  }

  const card: React.CSSProperties = {
    background: 'white', borderRadius: '16px', padding: '20px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
  }
  const h2: React.CSSProperties = {
    fontFamily: "'Fredoka One', cursive", fontSize: '20px', color: '#2d2d2d', margin: '0 0 16px',
  }

  return (
    <main style={{ fontFamily: "'Nunito', sans-serif", minHeight: '100vh', padding: '72px 24px 32px' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        <h1 style={{ fontFamily: "'Fredoka One', cursive", fontSize: '36px', color: '#2d2d2d', margin: '0 0 4px' }}>
          Settings
        </h1>
        <p style={{ color: '#aaa', fontWeight: 700, fontSize: '15px', margin: '0 0 32px' }}>
          Manage your ShelfSense preferences
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* Appearance */}
          <div style={card}>
            <h2 style={h2}>🎨 Appearance</h2>
            <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#aaa', margin: '0 0 14px' }}>
              Choose a colour theme for the app
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {THEMES.map(({ id, name, emoji, swatch }) => {
                const active = currentTheme === id
                return (
                  <button
                    key={id}
                    onClick={() => applyTheme(id)}
                    style={{
                      border: active ? '2px solid #ff7043' : '2px solid #f0f0f0',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      cursor: 'pointer',
                      background: active ? 'rgba(255,112,67,0.04)' : 'white',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      transition: 'all 0.15s',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{
                      width: '36px', height: '36px', borderRadius: '8px',
                      background: swatch, flexShrink: 0,
                      border: '1px solid rgba(0,0,0,0.06)',
                    }} />
                    <div>
                      <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: '14px', color: active ? '#ff7043' : '#444', display: 'block' }}>
                        {emoji} {name}
                      </span>
                      {active && <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '11px', color: '#ff9a3c' }}>Active</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Data */}
          <div style={card}>
            <h2 style={h2}>📦 Your Data</h2>
            <Link
              href="/known-products"
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 0', textDecoration: 'none',
              }}
            >
              <div>
                <span style={{ fontWeight: 700, color: '#2d2d2d', fontSize: '14px', display: 'block' }}>⭐ Known Products</span>
                <span style={{ fontWeight: 600, color: '#aaa', fontSize: '12px' }}>Manage your scanned product memory</span>
              </div>
              <span style={{ color: '#ccc', fontSize: '18px' }}>›</span>
            </Link>
          </div>

          {/* Account */}
          <div style={card}>
            <h2 style={h2}>👤 Account</h2>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f5f5f5' }}>
              <span style={{ fontWeight: 700, color: '#555', fontSize: '14px' }}>Email</span>
              <span style={{ fontWeight: 600, color: '#aaa', fontSize: '14px' }}>{email ?? '...'}</span>
            </div>
            <div style={{ paddingTop: '16px' }}>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                style={{
                  width: '100%',
                  background: signingOut ? '#f5f5f5' : 'linear-gradient(135deg,#ff4444,#ff6b6b)',
                  color: signingOut ? '#bbb' : 'white',
                  fontFamily: "'Fredoka One', cursive", fontSize: '17px',
                  padding: '13px', borderRadius: '50px', border: 'none',
                  cursor: signingOut ? 'default' : 'pointer',
                  boxShadow: signingOut ? 'none' : '0 6px 20px rgba(255,68,68,0.35)',
                  transition: 'all 0.2s',
                }}
              >
                {signingOut ? 'Signing out...' : '🚪 Sign Out'}
              </button>
            </div>
          </div>

          {/* App Info */}
          <div style={card}>
            <h2 style={h2}>📱 App Info</h2>
            {[
              { label: 'Version',   value: '1.1.0' },
              { label: 'Storage',   value: 'Supabase Cloud' },
              { label: 'AI Engine', value: 'Claude (Anthropic)' },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f5f5f5' }}>
                <span style={{ fontWeight: 700, color: '#555', fontSize: '14px' }}>{label}</span>
                <span style={{ fontWeight: 600, color: '#aaa', fontSize: '14px' }}>{value}</span>
              </div>
            ))}
          </div>

          {/* About */}
          <div style={card}>
            <h2 style={h2}>🛒 About ShelfSense</h2>
            <p style={{ color: '#888', fontWeight: 600, fontSize: '14px', lineHeight: 1.6, margin: 0 }}>
              ShelfSense helps you track your groceries, reduce food waste, and stay on top of your spending — all from a simple receipt scan.
            </p>
          </div>

        </div>
      </div>
    </main>
  )
}
