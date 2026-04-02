'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { signOut } from '@/lib/auth'

export default function SettingsPage() {
  const [email, setEmail] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setEmail(user?.email ?? null)
    })
  }, [])

  async function handleSignOut() {
    setSigningOut(true)
    await signOut()
    router.push('/auth')
    router.refresh()
  }

  const warmStyle = {
    fontFamily: "'Nunito', sans-serif",
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #fdf6ec 0%, #fde8d0 50%, #fce4e4 100%)',
  }

  return (
    <main style={{ ...warmStyle, padding: '72px 24px 32px' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        <h1 style={{ fontFamily: "'Fredoka One', cursive", fontSize: '36px', color: '#2d2d2d', margin: '0 0 4px' }}>
          Settings
        </h1>
        <p style={{ color: '#aaa', fontWeight: 700, fontSize: '15px', margin: '0 0 32px' }}>
          Manage your ShelfSense preferences
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* Account */}
          <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}>
            <h2 style={{ fontFamily: "'Fredoka One', cursive", fontSize: '20px', color: '#2d2d2d', margin: '0 0 16px' }}>
              👤 Account
            </h2>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f5f5f5' }}>
              <span style={{ fontWeight: 700, color: '#555', fontSize: '14px' }}>Email</span>
              <span style={{ fontWeight: 600, color: '#aaa', fontSize: '14px' }}>{email ?? '...'}</span>
            </div>
            <div style={{ paddingTop: '16px' }}>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                style={{ width: '100%', background: signingOut ? '#f5f5f5' : 'linear-gradient(135deg,#ff4444,#ff6b6b)', color: signingOut ? '#bbb' : 'white', fontFamily: "'Fredoka One', cursive", fontSize: '17px', padding: '13px', borderRadius: '50px', border: 'none', cursor: signingOut ? 'default' : 'pointer', boxShadow: signingOut ? 'none' : '0 6px 20px rgba(255,68,68,0.35)', transition: 'all 0.2s' }}
              >
                {signingOut ? 'Signing out...' : '🚪 Sign Out'}
              </button>
            </div>
          </div>

          {/* About */}
          <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}>
            <h2 style={{ fontFamily: "'Fredoka One', cursive", fontSize: '20px', color: '#2d2d2d', margin: '0 0 12px' }}>
              🛒 About ShelfSense
            </h2>
            <p style={{ color: '#888', fontWeight: 600, fontSize: '14px', lineHeight: 1.6, margin: 0 }}>
              ShelfSense helps you track your groceries, reduce food waste, and stay on top of your spending — all from a simple receipt scan.
            </p>
          </div>

          {/* App Info */}
          <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}>
            <h2 style={{ fontFamily: "'Fredoka One', cursive", fontSize: '20px', color: '#2d2d2d', margin: '0 0 16px' }}>
              📱 App Info
            </h2>
            {[
              { label: 'Version',   value: '1.0.0' },
              { label: 'Storage',   value: 'Supabase Cloud' },
              { label: 'AI Engine', value: 'Claude (Anthropic)' },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f5f5f5' }}>
                <span style={{ fontWeight: 700, color: '#555', fontSize: '14px' }}>{label}</span>
                <span style={{ fontWeight: 600, color: '#aaa', fontSize: '14px' }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Quick Links */}
          <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}>
            <h2 style={{ fontFamily: "'Fredoka One', cursive", fontSize: '20px', color: '#2d2d2d', margin: '0 0 16px' }}>
              🔗 Quick Links
            </h2>
            {[
              { href: '/',          label: '🏠 Home — Scan a Receipt' },
              { href: '/inventory', label: '📦 Inventory' },
              { href: '/spend',     label: '💳 Spend History' },
              { href: '/insights',  label: '📊 Insights & Analytics' },
            ].map(({ href, label }) => (
              <a key={href} href={href} style={{ display: 'block', padding: '10px 0', borderBottom: '1px solid #f5f5f5', color: '#ff7043', fontWeight: 700, fontSize: '14px', textDecoration: 'none' }}>
                {label}
              </a>
            ))}
          </div>

        </div>
      </div>
    </main>
  )
}
