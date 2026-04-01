'use client'

export default function SettingsPage() {
  const warmStyle = {
    fontFamily: "'Nunito', sans-serif",
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #fdf6ec 0%, #fde8d0 50%, #fce4e4 100%)',
  }

  return (
    <main style={{ ...warmStyle, padding: '24px 24px 100px' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        <h1 style={{ fontFamily: "'Fredoka One', cursive", fontSize: '36px', color: '#2d2d2d', margin: '0 0 4px' }}>
          Settings
        </h1>
        <p style={{ color: '#aaa', fontWeight: 700, fontSize: '15px', margin: '0 0 32px' }}>
          Manage your ShelfSense preferences
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

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
              { label: 'Version', value: '1.0.0' },
              { label: 'Storage', value: 'Supabase Cloud' },
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
