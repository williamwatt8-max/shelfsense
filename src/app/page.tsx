'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { InventoryItem } from '@/lib/types'
import { differenceInDays } from 'date-fns'

export default function Home() {
  const [items,         setItems]         = useState<InventoryItem[]>([])
  const [loading,       setLoading]       = useState(true)
  const [shoppingCount, setShoppingCount] = useState(0)

  useEffect(() => { loadDashboard() }, [])

  async function loadDashboard() {
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id
    if (!userId) { setLoading(false); return }

    const [inventoryRes, shoppingRes] = await Promise.all([
      supabase.from('inventory_items').select('id,name,remaining_quantity,quantity,quantity_original,count,amount_per_unit,unit,expiry_date,opened_at,location,category,created_at').eq('user_id', userId).eq('status', 'active').order('expiry_date', { ascending: true, nullsFirst: false }),
      supabase.from('shopping_list_items').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('checked', false),
    ])
    setItems((inventoryRes.data || []) as InventoryItem[])
    setShoppingCount(shoppingRes.count ?? 0)
    setLoading(false)
  }

  function daysLeft(date: string | null): number | null {
    if (!date) return null
    return differenceInDays(new Date(date), new Date())
  }

  function expiryColor(d: number | null): string {
    if (d === null) return '#ccc'
    if (d < 0) return '#ff4444'
    if (d <= 1) return '#ff4444'
    if (d <= 3) return '#ff9800'
    if (d <= 7) return '#ffb347'
    return '#4caf50'
  }

  function expiryLabel(d: number | null): string {
    if (d === null) return ''
    if (d < 0) return `Expired ${Math.abs(d)}d ago`
    if (d === 0) return 'Expires today'
    if (d === 1) return 'Tomorrow'
    return `${d}d left`
  }

  function fmtQty(item: InventoryItem): string {
    const fmt = (n: number) => n % 1 === 0 ? String(n) : n.toFixed(1)
    const rem = item.remaining_quantity ?? item.quantity
    const packTotal = (item.count && item.amount_per_unit) ? item.count * item.amount_per_unit : item.amount_per_unit
    if (item.count && item.count > 1 && item.amount_per_unit) {
      if (rem < packTotal! - 0.001) return `${fmt(rem)} of ${fmt(packTotal!)} ${item.unit} remaining`
      return `${item.count}×${item.amount_per_unit} ${item.unit}`
    }
    if (item.amount_per_unit) {
      if (rem < item.amount_per_unit - 0.001) return `${fmt(rem)} of ${fmt(item.amount_per_unit)} ${item.unit} remaining`
      return `${item.amount_per_unit} ${item.unit}`
    }
    return `${fmt(rem)} ${item.unit}`
  }

  const expiringSoon  = items.filter(i => { const d = daysLeft(i.expiry_date); return d !== null && d <= 7 })
  const openedItems   = items.filter(i => i.opened_at && !expiringSoon.some(e => e.id === i.id)).slice(0, 4)
  const totalItems    = items.length
  const expiringCount = expiringSoon.length

  const quickActions = [
    { href: '/add',           emoji: '➕', label: 'Add Item',    desc: 'Manual, voice or barcode' },
    { href: '/add',           emoji: '🧾', label: 'Scan Receipt', desc: 'Photo of grocery receipt', query: '?mode=receipt' },
    { href: '/inventory',     emoji: '📦', label: 'Pantry',       desc: 'Browse inventory' },
    { href: '/recipes',       emoji: '🍽️', label: 'Recipes',      desc: 'Meal ideas' },
    { href: '/shopping-list', emoji: '🛒', label: 'Shopping',     desc: `${shoppingCount} item${shoppingCount !== 1 ? 's' : ''} to buy` },
  ]

  return (
    <main style={{ fontFamily: "'Nunito', sans-serif", minHeight: '100vh', padding: '72px 20px 100px' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>

      <div style={{ maxWidth: '640px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontFamily: "'Fredoka One', cursive", fontSize: '36px', color: '#2d2d2d', margin: '0 0 2px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            🛒 ShelfSense
          </h1>
          <p style={{ color: '#aaa', fontWeight: 700, fontSize: '14px', margin: 0 }}>
            Never waste again
          </p>
        </div>

        {/* Stats row */}
        {!loading && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '20px' }}>
            {[
              { label: 'In pantry', value: totalItems, color: '#ff7043' },
              { label: 'Expiring soon', value: expiringCount, color: expiringCount > 0 ? '#ff9800' : '#4caf50' },
              { label: 'To buy', value: shoppingCount, color: '#1e88e5' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: 'white', borderRadius: '14px', padding: '14px 12px', boxShadow: '0 2px 10px rgba(0,0,0,0.07)', textAlign: 'center' }}>
                <div style={{ fontFamily: "'Fredoka One',cursive", fontSize: '28px', color, lineHeight: 1 }}>{value}</div>
                <div style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '11px', color: '#aaa', marginTop: '3px' }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Quick actions */}
        <div style={{ background: 'white', borderRadius: '16px', padding: '16px', boxShadow: '0 2px 10px rgba(0,0,0,0.07)', marginBottom: '16px' }}>
          <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '16px', color: '#2d2d2d', margin: '0 0 12px' }}>Quick Actions</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {quickActions.map(({ href, emoji, label, desc, query }) => (
              <a key={label} href={`${href}${query ?? ''}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', borderRadius: '12px', background: '#fdf9f6', textDecoration: 'none', border: '1.5px solid rgba(255,112,67,0.1)', transition: 'all 0.15s' }}>
                <span style={{ fontSize: '22px', flexShrink: 0 }}>{emoji}</span>
                <div>
                  <div style={{ fontFamily: "'Fredoka One',cursive", fontSize: '15px', color: '#2d2d2d', lineHeight: 1.2 }}>{label}</div>
                  <div style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '11px', color: '#bbb', lineHeight: 1.3 }}>{desc}</div>
                </div>
              </a>
            ))}
          </div>
        </div>

        {/* Expiring soon */}
        {!loading && expiringSoon.length > 0 && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '16px', boxShadow: '0 2px 10px rgba(0,0,0,0.07)', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '16px', color: '#ff7043', margin: 0 }}>⏰ Expiring Soon</p>
              <a href="/inventory" style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#ff7043', textDecoration: 'none' }}>See all →</a>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {expiringSoon.slice(0, 6).map(item => {
                const d = daysLeft(item.expiry_date)
                return (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}>
                    <div>
                      <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#2d2d2d', textTransform: 'capitalize' }}>{item.name}</span>
                      <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '12px', color: '#bbb', marginLeft: '8px' }}>{fmtQty(item)}</span>
                    </div>
                    <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: expiryColor(d), background: `${expiryColor(d)}18`, padding: '3px 10px', borderRadius: '50px', flexShrink: 0 }}>
                      {expiryLabel(d)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Opened items */}
        {!loading && openedItems.length > 0 && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '16px', boxShadow: '0 2px 10px rgba(0,0,0,0.07)', marginBottom: '16px' }}>
            <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '16px', color: '#20b2aa', margin: '0 0 12px' }}>🔓 Currently Open</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {openedItems.map(item => {
                const daysOpen = differenceInDays(new Date(), new Date(item.opened_at!))
                return (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f5f5f5' }}>
                    <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#2d2d2d', textTransform: 'capitalize' }}>{item.name}</span>
                    <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '12px', color: '#aaa' }}>opened {daysOpen === 0 ? 'today' : `${daysOpen}d ago`}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && totalItems === 0 && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '32px 24px', boxShadow: '0 2px 10px rgba(0,0,0,0.07)', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>📦</div>
            <h2 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '22px', color: '#2d2d2d', margin: '0 0 8px' }}>Your pantry is empty</h2>
            <p style={{ color: '#aaa', fontWeight: 700, fontSize: '14px', margin: '0 0 20px' }}>Add items by scanning a receipt, scanning barcodes, or entering them manually.</p>
            <a href="/add" style={{ background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontFamily: "'Fredoka One',cursive", fontSize: '16px', padding: '12px 28px', borderRadius: '50px', textDecoration: 'none', display: 'inline-block', boxShadow: '0 6px 20px rgba(255,112,67,0.4)' }}>
              + Add Your First Item
            </a>
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', paddingTop: '40px' }}>
            <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, color: '#aaa' }}>Loading…</p>
          </div>
        )}

      </div>
    </main>
  )
}
