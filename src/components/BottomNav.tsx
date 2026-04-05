'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'

const navItems = [
  { href: '/',              label: 'Home',     emoji: '🏠' },
  { href: '/add',           label: 'Add',      emoji: '➕' },
  { href: '/inventory',     label: 'Pantry',   emoji: '📦' },
  { href: '/recipes',       label: 'Recipes',  emoji: '🍽️' },
  { href: '/shopping-list', label: 'Shopping', emoji: '🛒' },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');
        .bnav-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          text-decoration: none;
          padding: 8px 10px 6px;
          border-radius: 14px;
          transition: background 0.15s;
          flex: 1;
        }
        .bnav-item:hover { background: rgba(255,112,67,0.08); }
        .bnav-item.active { background: rgba(255,112,67,0.1); }
      `}</style>
      <nav style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'white',
        borderTop: '1px solid rgba(0,0,0,0.07)',
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center',
        padding: '6px 8px',
        paddingBottom: 'calc(6px + env(safe-area-inset-bottom, 0px))',
        boxShadow: '0 -4px 20px rgba(0,0,0,0.07)',
        zIndex: 1000,
      }}>
        {navItems.map(({ href, label, emoji }) => {
          const isActive = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={`bnav-item${isActive ? ' active' : ''}`}
              style={{ color: isActive ? '#ff7043' : '#aaa' }}
            >
              <span style={{ fontSize: '22px', lineHeight: 1 }}>{emoji}</span>
              <span style={{
                fontSize: '11px',
                fontWeight: isActive ? 800 : 600,
                fontFamily: "'Nunito', sans-serif",
                letterSpacing: '0.2px',
              }}>
                {label}
              </span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
