'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { InventoryItem } from '@/lib/types'
import { differenceInDays } from 'date-fns'
import ItemActionSheet from '@/components/ItemActionSheet'

export default function Home() {
  const [items,         setItems]         = useState<InventoryItem[]>([])
  const [loading,       setLoading]       = useState(true)
  const [shoppingCount, setShoppingCount] = useState(0)
  const [toast,         setToast]         = useState<string | null>(null)

  // Sheet state
  const [activeItem, setActiveItem] = useState<InventoryItem | null>(null)

  useEffect(() => { loadDashboard() }, [])

  async function loadDashboard() {
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id
    if (!userId) { setLoading(false); return }

    const [inventoryRes, shoppingRes] = await Promise.all([
      supabase.from('inventory_items')
        .select('id,name,remaining_quantity,quantity,quantity_original,count,amount_per_unit,unit,expiry_date,opened_at,location,category,price,status,created_at,updated_at,user_id,receipt_item_id,source,retailer,purchase_date,opened_expiry_days,price_source,barcode,quantity_original')
        .eq('user_id', userId).eq('status', 'active')
        .order('expiry_date', { ascending: true, nullsFirst: false }),
      supabase.from('shopping_list_items').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('checked', false),
    ])
    setItems((inventoryRes.data || []) as InventoryItem[])
    setShoppingCount(shoppingRes.count ?? 0)
    setLoading(false)
  }

  function handleAction(toastMsg?: string) {
    if (toastMsg) { setToast(toastMsg); setTimeout(() => setToast(null), 2500) }
    loadDashboard()
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

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
    if (d === null) return 'No expiry set'
    if (d < 0) return `Expired ${Math.abs(d)} day${Math.abs(d) !== 1 ? 's' : ''} ago`
    if (d === 0) return 'Expires today'
    if (d === 1) return 'Expires tomorrow'
    return `Expires in ${d} days`
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

  const expiredItems       = items.filter(i => { const d = daysLeft(i.expiry_date); return d !== null && d < 0 })
  const expiringSoon       = items.filter(i => { const d = daysLeft(i.expiry_date); return d !== null && d >= 0 && d <= 7 })
  const expirySectionItems = [...expiredItems, ...expiringSoon]
  const openedItems        = items.filter(i => i.opened_at && !expirySectionItems.some(e => e.id === i.id)).slice(0, 4)
  const totalItems         = items.length

  const quickActions = [
    { href: '/add',           emoji: '➕', label: 'Add Item',    desc: 'Manual, voice or barcode' },
    { href: '/add',           emoji: '🧾', label: 'Scan Receipt', desc: 'Photo of grocery receipt', query: '?mode=receipt' },
    { href: '/inventory',     emoji: '📦', label: 'Pantry',       desc: 'Browse inventory' },
    { href: '/recipes',       emoji: '🍽️', label: 'Recipes',      desc: 'Meal ideas' },
    { href: '/shopping-list', emoji: '🛒', label: 'Shopping',     desc: `${shoppingCount} item${shoppingCount !== 1 ? 's' : ''} to buy` },
  ]

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main style={{ fontFamily: "'Nunito', sans-serif", minHeight: '100vh', padding: '72px 20px 100px' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>

      <div style={{ maxWidth: '640px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontFamily: "'Fredoka One', cursive", fontSize: '36px', color: '#2d2d2d', margin: '0 0 2px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            🛒 ShelfSense
          </h1>
          <p style={{ color: '#aaa', fontWeight: 700, fontSize: '14px', margin: 0 }}>Never waste again</p>
        </div>

        {/* Stats row */}
        {!loading && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '20px' }}>
            {[
              { label: 'In pantry',     value: totalItems,                                            color: '#ff7043' },
              { label: 'Need attention', value: expiredItems.length + expiringSoon.length,             color: expiredItems.length > 0 ? '#ff4444' : expiringSoon.length > 0 ? '#ff9800' : '#4caf50' },
              { label: 'To buy',        value: shoppingCount,                                          color: '#1e88e5' },
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
              <a key={label} href={`${href}${query ?? ''}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', borderRadius: '12px', background: '#fdf9f6', textDecoration: 'none', border: '1.5px solid rgba(255,112,67,0.1)' }}>
                <span style={{ fontSize: '22px', flexShrink: 0 }}>{emoji}</span>
                <div>
                  <div style={{ fontFamily: "'Fredoka One',cursive", fontSize: '15px', color: '#2d2d2d', lineHeight: 1.2 }}>{label}</div>
                  <div style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '11px', color: '#bbb', lineHeight: 1.3 }}>{desc}</div>
                </div>
              </a>
            ))}
          </div>
        </div>

        {/* Expiring / Expired section */}
        {!loading && (expiredItems.length > 0 || expiringSoon.length > 0) && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '16px', boxShadow: '0 2px 10px rgba(0,0,0,0.07)', marginBottom: '16px' }}>

            {/* Expired sub-section */}
            {expiredItems.length > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontFamily: "'Fredoka One',cursive", fontSize: '15px', color: '#ff4444' }}>
                    ⚠️ Expired — {expiredItems.length} item{expiredItems.length !== 1 ? 's' : ''}
                  </span>
                </div>
                {expiredItems.slice(0, 4).map(item => {
                  const d = daysLeft(item.expiry_date)
                  return (
                    <button key={item.id} onClick={() => setActiveItem(item)}
                      style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid #f5f5f5', background: 'rgba(255,68,68,0.03)', borderRadius: '8px', border: 'none', cursor: 'pointer', textAlign: 'left', marginBottom: '2px' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#2d2d2d', textTransform: 'capitalize' }}>{item.name}</span>
                        <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '12px', color: '#bbb', marginLeft: '8px' }}>{fmtQty(item)}</span>
                      </div>
                      <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: expiryColor(d), background: `${expiryColor(d)}18`, padding: '3px 10px', borderRadius: '50px', flexShrink: 0, marginLeft: '8px' }}>
                        {expiryLabel(d)}
                      </span>
                    </button>
                  )
                })}
                {expiringSoon.length > 0 && (
                  <div style={{ height: '1px', background: '#f0f0f0', margin: '12px 0 10px' }} />
                )}
              </>
            )}

            {/* Expiring soon sub-section */}
            {expiringSoon.length > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontFamily: "'Fredoka One',cursive", fontSize: '15px', color: '#ff7043' }}>
                    ⏰ Expiring soon — {expiringSoon.length} item{expiringSoon.length !== 1 ? 's' : ''}
                  </span>
                </div>
                {expiringSoon.slice(0, expiredItems.length > 0 ? 3 : 6).map(item => {
                  const d = daysLeft(item.expiry_date)
                  return (
                    <button key={item.id} onClick={() => setActiveItem(item)}
                      style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid #f5f5f5', background: 'none', borderRadius: '8px', border: 'none', cursor: 'pointer', textAlign: 'left', marginBottom: '2px' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#2d2d2d', textTransform: 'capitalize' }}>{item.name}</span>
                        <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '12px', color: '#bbb', marginLeft: '8px' }}>{fmtQty(item)}</span>
                      </div>
                      <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: expiryColor(d), background: `${expiryColor(d)}18`, padding: '3px 10px', borderRadius: '50px', flexShrink: 0, marginLeft: '8px' }}>
                        {expiryLabel(d)}
                      </span>
                    </button>
                  )
                })}
              </>
            )}

            <div style={{ textAlign: 'right', marginTop: '10px' }}>
              <a href="/inventory" style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#aaa', textDecoration: 'none' }}>See all in inventory →</a>
            </div>
          </div>
        )}

        {/* Opened items */}
        {!loading && openedItems.length > 0 && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '16px', boxShadow: '0 2px 10px rgba(0,0,0,0.07)', marginBottom: '16px' }}>
            <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '16px', color: '#20b2aa', margin: '0 0 12px' }}>🔓 Currently Open</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {openedItems.map(item => {
                const daysOpen = differenceInDays(new Date(), new Date(item.opened_at!))
                return (
                  <button key={item.id} onClick={() => setActiveItem(item)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: 'none', border: 'none', borderRadius: '8px', cursor: 'pointer', borderBottom: '1px solid #f5f5f5', textAlign: 'left', width: '100%' }}>
                    <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#2d2d2d', textTransform: 'capitalize' }}>{item.name}</span>
                    <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '12px', color: '#aaa', flexShrink: 0 }}>opened {daysOpen === 0 ? 'today' : `${daysOpen}d ago`}</span>
                  </button>
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

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(45,45,45,0.92)', color: 'white', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', padding: '10px 20px', borderRadius: '50px', zIndex: 3000, whiteSpace: 'nowrap', boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}

      {/* Shared action sheet */}
      {activeItem && (
        <ItemActionSheet
          item={activeItem}
          onClose={() => setActiveItem(null)}
          onAction={handleAction}
        />
      )}
    </main>
  )
}
