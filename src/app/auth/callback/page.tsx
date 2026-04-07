'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Status = 'loading' | 'confirmed' | 'error'

export default function AuthCallbackPage() {
  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    let resolved = false

    function resolve(s: Status) {
      if (!resolved) {
        resolved = true
        setStatus(s)
      }
    }

    // Listen for Supabase to process the URL hash (detectSessionInUrl: true)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        resolve('confirmed')
      }
    })

    // Also check immediately — by the time this runs, Supabase may have already
    // processed the hash fragment and stored the session.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) resolve('confirmed')
    })

    // If nothing resolves within 8 s, show an error.
    const timeout = setTimeout(() => resolve('error'), 8000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  const warmStyle: React.CSSProperties = {
    fontFamily: "'Nunito', sans-serif",
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #fdf6ec 0%, #fde8d0 50%, #fce4e4 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    position: 'relative',
    overflow: 'hidden',
  }

  if (status === 'loading') {
    return (
      <main style={warmStyle}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.6 }}>🔄</div>
          <p style={{ fontFamily: "'Fredoka One', cursive", fontSize: '24px', color: '#aaa', margin: 0 }}>
            Confirming your account…
          </p>
        </div>
      </main>
    )
  }

  if (status === 'error') {
    return (
      <main style={warmStyle}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: '380px' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>😕</div>
          <h1 style={{ fontFamily: "'Fredoka One', cursive", fontSize: '32px', color: '#2d2d2d', margin: '0 0 12px' }}>
            Link expired or invalid
          </h1>
          <p style={{ color: '#888', fontWeight: 700, fontSize: '15px', lineHeight: 1.6, margin: '0 0 28px' }}>
            This confirmation link has expired or has already been used. Try signing in, or request a new confirmation email.
          </p>
          <a
            href="/auth"
            style={{ display: 'inline-block', background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontFamily: "'Fredoka One', cursive", fontSize: '18px', padding: '14px 36px', borderRadius: '50px', textDecoration: 'none', boxShadow: '0 8px 24px rgba(255,112,67,0.4)' }}
          >
            Back to Sign In
          </a>
        </div>
      </main>
    )
  }

  // status === 'confirmed'
  return (
    <main style={warmStyle}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>

      {/* Background blobs */}
      <div style={{ position: 'absolute', top: '-80px', left: '-80px', width: '300px', height: '300px', background: 'rgba(255,180,120,0.3)', borderRadius: '60% 40% 70% 30% / 50% 60% 40% 70%' }} />
      <div style={{ position: 'absolute', bottom: '-60px', right: '-60px', width: '250px', height: '250px', background: 'rgba(255,150,150,0.25)', borderRadius: '40% 60% 30% 70% / 60% 40% 70% 30%' }} />

      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: '380px' }}>
        <div style={{ fontSize: '72px', marginBottom: '16px' }}>✅</div>
        <h1 style={{ fontFamily: "'Fredoka One', cursive", fontSize: '36px', color: '#2d2d2d', margin: '0 0 12px' }}>
          Email confirmed!
        </h1>
        <p style={{ color: '#888', fontWeight: 700, fontSize: '15px', lineHeight: 1.6, margin: '0 0 32px' }}>
          Thanks for confirming your email — your ShelfSense account is ready to use.
        </p>
        <a
          href="/"
          style={{ display: 'inline-block', background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontFamily: "'Fredoka One', cursive", fontSize: '20px', padding: '15px 48px', borderRadius: '50px', textDecoration: 'none', boxShadow: '0 10px 28px rgba(255,112,67,0.45)' }}
        >
          Continue to ShelfSense →
        </a>
      </div>
    </main>
  )
}
