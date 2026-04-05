'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'

const navItems = [
  { href: '/',              label: 'Home',          emoji: '🏠', desc: 'Dashboard & expiry alerts'  },
  { href: '/add',           label: 'Add Item',      emoji: '➕', desc: 'Manual, voice, scan & receipt' },
  { href: '/inventory',     label: 'Inventory',     emoji: '📦', desc: 'Your food & items'        },
  { href: '/recipes',       label: 'Recipes',       emoji: '🍽️', desc: 'Recipes & meal planning'  },
  { href: '/shopping-list', label: 'Shopping List', emoji: '🛒', desc: 'Items to buy'             },
  { href: '/spend',         label: 'Spend History', emoji: '💳', desc: 'Track your spending'      },
  { href: '/insights',      label: 'Insights',      emoji: '📊', desc: 'Waste analytics'          },
  { href: '/settings',      label: 'Settings',      emoji: '⚙️', desc: 'App preferences'          },
]

export default function HamburgerMenu() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');
        .drawer-link {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 13px 16px;
          border-radius: 14px;
          text-decoration: none;
          transition: background 0.15s;
          margin-bottom: 2px;
        }
        .drawer-link:hover { background: rgba(255,112,67,0.07); }
        .drawer-link.active { background: rgba(255,112,67,0.12); }
        .hbg-btn { transition: transform 0.15s; }
        .hbg-btn:active { transform: scale(0.9); }
      `}</style>

      {/* Hamburger trigger button */}
      <button
        className="hbg-btn"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        style={{
          position: 'fixed',
          top: '14px',
          left: '14px',
          zIndex: 1100,
          background: 'white',
          border: 'none',
          borderRadius: '12px',
          width: '42px',
          height: '42px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '5px',
          cursor: 'pointer',
          boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
          padding: 0,
        }}
      >
        <span style={{ display: 'block', width: '18px', height: '2px', background: '#555', borderRadius: '2px' }} />
        <span style={{ display: 'block', width: '18px', height: '2px', background: '#555', borderRadius: '2px' }} />
        <span style={{ display: 'block', width: '18px', height: '2px', background: '#555', borderRadius: '2px' }} />
      </button>

      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.28)',
          zIndex: 1200,
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.25s',
        }}
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          height: '100dvh',
          width: '280px',
          background: 'white',
          zIndex: 1300,
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
          boxShadow: '4px 0 32px rgba(0,0,0,0.12)',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #fdf6ec 0%, #fde8d0 100%)',
          padding: '20px 16px 18px',
          borderBottom: '1px solid rgba(0,0,0,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '26px' }}>🛒</span>
            <span style={{ fontFamily: "'Fredoka One', cursive", fontSize: '22px', color: '#2d2d2d', letterSpacing: '0.5px' }}>
              ShelfSense
            </span>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: '20px', padding: '4px', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {/* Nav links */}
        <nav style={{ padding: '12px', flex: 1 }}>
          {navItems.map(({ href, label, emoji, desc }) => {
            const isActive = pathname === href
            return (
              <Link
                key={href}
                href={href}
                className={`drawer-link${isActive ? ' active' : ''}`}
                onClick={() => setOpen(false)}
                style={{ color: isActive ? '#ff7043' : '#444' }}
              >
                <span style={{ fontSize: '22px', flexShrink: 0 }}>{emoji}</span>
                <div>
                  <div style={{ fontFamily: "'Fredoka One', cursive", fontSize: '17px', lineHeight: 1.2 }}>{label}</div>
                  <div style={{
                    fontFamily: "'Nunito', sans-serif",
                    fontWeight: 600,
                    fontSize: '12px',
                    color: isActive ? '#ff9a3c' : '#bbb',
                    marginTop: '1px',
                  }}>{desc}</div>
                </div>
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div style={{ padding: '16px', borderTop: '1px solid #f5f5f5' }}>
          <p style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 700, fontSize: '12px', color: '#ccc', margin: 0, textAlign: 'center' }}>
            Never waste again 🌱
          </p>
        </div>
      </div>
    </>
  )
}
