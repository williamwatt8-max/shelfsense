'use client'

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { InventoryItem } from '@/lib/types'
import { differenceInDays } from 'date-fns'
import { lookupShelfLife } from '@/lib/shelfLife'

// ── Extended type: InventoryItem + price from receipt_items join ──────────────
type InventoryItemWithPrice = InventoryItem & { price: number | null }

type GroupedItem = {
  name: string
  totalQuantity: number
  unit: string
  location: string
  category: string | null
  nearestExpiry: string | null
  batches: InventoryItemWithPrice[]
}

type UsingItemState  = { id: string; used: number; unit: string; maxQty: number }
type OpeningItemState = { id: string; name: string; category: string | null; suggestedExpiry: string; rangeText: string; hasShelfLife: boolean }
type EditingItemState = { id: string; quantity: number; unit: string; expiry_date: string; location: string }

// ── Component ────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const [items, setItems]           = useState<InventoryItemWithPrice[]>([])
  const [filter, setFilter]         = useState<string>('all')
  const [sortBy, setSortBy]         = useState<string>('date_added')
  const [grouped, setGrouped]       = useState<boolean>(true)
  const [loading, setLoading]       = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingItem, setEditingItem]   = useState<EditingItemState | null>(null)
  const [usingItem, setUsingItem]       = useState<UsingItemState | null>(null)
  const [openingItem, setOpeningItem]   = useState<OpeningItemState | null>(null)

  // ── Data ──────────────────────────────────────────────────────────────────

  async function loadItems() {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('*, receipt_items!receipt_item_id(price)')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
    if (error) {
      alert('Error loading inventory: ' + error.message)
      setLoading(false)
      return
    }
    const mapped: InventoryItemWithPrice[] = (data || []).map((d: any) => ({
      ...d,
      price: d.receipt_items?.price ?? null,
      receipt_items: undefined,
    }))
    setItems(mapped)
    setLoading(false)
  }

  useEffect(() => { loadItems() }, [])

  // ── Helpers ───────────────────────────────────────────────────────────────

  function daysLeft(date: string | null): number | null {
    if (!date) return null
    return differenceInDays(new Date(date), new Date())
  }

  function expiryLabel(d: number | null): string {
    if (d === null) return 'No expiry'
    if (d < 0) return `Expired ${Math.abs(d)}d ago`
    if (d === 0) return 'Expires today'
    if (d === 1) return 'Tomorrow'
    return `${d}d left`
  }

  function expiryColor(d: number | null): string {
    if (d === null) return '#ccc'
    if (d < 0) return '#ff4444'
    if (d <= 1) return '#ff4444'
    if (d <= 3) return '#ff9800'
    if (d <= 7) return '#ffb347'
    return '#4caf50'
  }

  function formatDateAdded(dateStr: string): string {
    const d = differenceInDays(new Date(), new Date(dateStr))
    if (d === 0) return 'today'
    if (d === 1) return 'yesterday'
    if (d < 7)  return `${d}d ago`
    if (d < 30) return `${Math.floor(d / 7)}w ago`
    return `${Math.floor(d / 30)}mo ago`
  }

  function formatOpenedDate(dateStr: string): string {
    const d = differenceInDays(new Date(), new Date(dateStr))
    if (d === 0) return 'Opened today'
    if (d === 1) return 'Opened yesterday'
    return `Opened ${d}d ago`
  }

  function formatDisplayDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function markUsed(id: string) {
    await supabase.from('inventory_items').update({ status: 'used' }).eq('id', id)
    await supabase.from('inventory_events').insert({ inventory_item_id: id, type: 'used' })
    setExpandedId(null)
    loadItems()
  }

  async function markUsedSome() {
    if (!usingItem) return
    const used = Math.max(0, usingItem.used)
    const remaining = parseFloat((usingItem.maxQty - used).toFixed(3))
    if (remaining <= 0) {
      await supabase.from('inventory_items').update({ status: 'used' }).eq('id', usingItem.id)
      await supabase.from('inventory_events').insert({ inventory_item_id: usingItem.id, type: 'used', quantity_delta: -usingItem.maxQty })
    } else {
      await supabase.from('inventory_items').update({ quantity: remaining }).eq('id', usingItem.id)
      await supabase.from('inventory_events').insert({ inventory_item_id: usingItem.id, type: 'used_some', quantity_delta: -used })
    }
    setUsingItem(null)
    loadItems()
  }

  async function markDiscarded(id: string) {
    await supabase.from('inventory_items').update({ status: 'discarded' }).eq('id', id)
    await supabase.from('inventory_events').insert({ inventory_item_id: id, type: 'discarded' })
    setExpandedId(null)
    loadItems()
  }

  async function saveEdit() {
    if (!editingItem) return
    await supabase.from('inventory_items').update({
      quantity: editingItem.quantity,
      unit: editingItem.unit,
      expiry_date: editingItem.expiry_date || null,
    }).eq('id', editingItem.id)
    setEditingItem(null)
    loadItems()
  }

  async function changeLocation(id: string, loc: string) {
    await supabase.from('inventory_items').update({ location: loc }).eq('id', id)
    await supabase.from('inventory_events').insert({ inventory_item_id: id, type: 'moved' })
    loadItems()
  }

  function startOpening(item: InventoryItemWithPrice) {
    setEditingItem(null)
    setUsingItem(null)
    const sl = lookupShelfLife(item.name, item.category)
    if (sl) {
      const avgDays = Math.round((sl.min + sl.max) / 2)
      const d = new Date()
      d.setDate(d.getDate() + avgDays)
      setOpeningItem({
        id: item.id, name: item.name, category: item.category,
        suggestedExpiry: d.toISOString().split('T')[0],
        rangeText: sl.min === sl.max ? `${sl.min} days` : `${sl.min}–${sl.max} days`,
        hasShelfLife: true,
      })
    } else {
      setOpeningItem({ id: item.id, name: item.name, category: item.category, suggestedExpiry: '', rangeText: '', hasShelfLife: false })
    }
  }

  async function confirmOpened(updateExpiry: boolean) {
    if (!openingItem) return
    const today = new Date().toISOString().split('T')[0]
    const updates: Record<string, string | null> = { opened_at: today }
    if (updateExpiry && openingItem.suggestedExpiry) updates.expiry_date = openingItem.suggestedExpiry
    await supabase.from('inventory_items').update(updates).eq('id', openingItem.id)
    await supabase.from('inventory_events').insert({
      inventory_item_id: openingItem.id,
      type: 'opened',
      notes: openingItem.hasShelfLife ? `Shelf life after opening: ${openingItem.rangeText}` : null,
    })
    setOpeningItem(null)
    loadItems()
  }

  // ── Filtering & sorting ────────────────────────────────────────��──────────

  const filtered = items.filter((item) => {
    const d = daysLeft(item.expiry_date)
    const isExpired = d !== null && d < 0
    if (filter === 'expired')  return isExpired
    if (isExpired)             return false   // expired items only appear in the Expired tab
    if (filter === 'expiring') return d !== null && d >= 0 && d <= 7
    if (filter === 'all')      return true
    return item.location === filter
  })

  function sortItems(arr: InventoryItemWithPrice[]): InventoryItemWithPrice[] {
    return [...arr].sort((a, b) => {
      if (sortBy === 'expiry') {
        const da = daysLeft(a.expiry_date), db = daysLeft(b.expiry_date)
        if (da === null && db === null) return 0
        if (da === null) return 1; if (db === null) return -1
        return da - db
      }
      if (sortBy === 'name')     return a.name.localeCompare(b.name)
      if (sortBy === 'location') return a.location.localeCompare(b.location)
      if (sortBy === 'category') return (a.category || '').localeCompare(b.category || '')
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }

  function groupItems(arr: InventoryItemWithPrice[]): GroupedItem[] {
    const map = new Map<string, GroupedItem>()
    for (const item of arr) {
      const key = item.name.toLowerCase().trim()
      if (map.has(key)) {
        const g = map.get(key)!
        g.totalQuantity += item.quantity
        g.batches.push(item)
        if (item.expiry_date && (!g.nearestExpiry || item.expiry_date < g.nearestExpiry))
          g.nearestExpiry = item.expiry_date
      } else {
        map.set(key, { name: item.name, totalQuantity: item.quantity, unit: item.unit, location: item.location, category: item.category, nearestExpiry: item.expiry_date, batches: [item] })
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (sortBy === 'expiry') {
        const da = daysLeft(a.nearestExpiry), db = daysLeft(b.nearestExpiry)
        if (da === null && db === null) return 0
        if (da === null) return 1; if (db === null) return -1
        return da - db
      }
      if (sortBy === 'name')     return a.name.localeCompare(b.name)
      if (sortBy === 'location') return a.location.localeCompare(b.location)
      if (sortBy === 'category') return (a.category || '').localeCompare(b.category || '')
      return 0
    })
  }

  const sorted       = sortItems(filtered)
  const groupedItems = groupItems(filtered)

  // ── Derived counts & stock value ──────────────────────────────────────────

  const expiringCount = items.filter(i => { const d = daysLeft(i.expiry_date); return d !== null && d >= 0 && d <= 7 }).length
  const expiredCount  = items.filter(i => { const d = daysLeft(i.expiry_date); return d !== null && d < 0 }).length
  const activeItems   = items.filter(i => { const d = daysLeft(i.expiry_date); return d === null || d >= 0 })
  const stockValue    = activeItems.reduce((sum, i) => sum + (i.price ?? 0), 0)
  const pricedCount   = activeItems.filter(i => i.price !== null).length

  // ── Static config ─────────────────────────────────────────────────────────

  const warmStyle = {
    fontFamily: "'Nunito', sans-serif",
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #fdf6ec 0%, #fde8d0 50%, #fce4e4 100%)',
    padding: '72px 24px 32px',
  }
  const filters = ['all', 'fridge', 'freezer', 'cupboard', 'household', 'expiring', 'expired']
  const units   = ['item', 'g', 'kg', 'ml', 'l', 'bottle', 'tin', 'loaf', 'pack', 'bag', 'head', 'fillet']
  const btnBase: React.CSSProperties = { border: 'none', borderRadius: '50px', padding: '7px 14px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', cursor: 'pointer' }

  // ── Sub-panels ────────────────────────────────────────────────────────────

  const partialUsePanel = (item: InventoryItemWithPrice) => (
    <div style={{ background: '#f4fff6', border: '1.5px solid rgba(76,175,80,0.25)', borderRadius: '12px', padding: '14px 16px', marginBottom: '8px' }}>
      <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '15px', color: '#2d2d2d', margin: '0 0 12px' }}>
        How much of <span style={{ color: '#4caf50' }}>{item.name}</span> did you use?
      </p>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
        <input
          type="number" min={0.1} max={usingItem!.maxQty} step={0.1}
          value={usingItem!.used}
          onChange={e => setUsingItem({ ...usingItem!, used: parseFloat(e.target.value) || 0 })}
          style={{ width: '80px', border: '2px solid #c8e6c9', borderRadius: '8px', padding: '7px 10px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '15px', textAlign: 'center' }}
        />
        <span style={{ fontWeight: 700, color: '#555', fontSize: '14px' }}>{usingItem!.unit}</span>
        <span style={{ color: '#aaa', fontSize: '12px', fontWeight: 700 }}>of {usingItem!.maxQty} {usingItem!.unit} remaining</span>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={markUsedSome} style={{ ...btnBase, background: 'linear-gradient(135deg,#4caf50,#66bb6a)', color: 'white', boxShadow: '0 4px 12px rgba(76,175,80,0.3)' }}>✅ Confirm</button>
        <button onClick={() => setUsingItem(null)} style={{ ...btnBase, background: '#f5f5f5', color: '#888' }}>Cancel</button>
      </div>
    </div>
  )

  const openingPanel = (item: InventoryItemWithPrice) => (
    <div style={{ background: '#fff8f0', border: '1.5px solid rgba(255,112,67,0.25)', borderRadius: '12px', padding: '14px 16px', marginBottom: '8px' }}>
      <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '15px', color: '#2d2d2d', margin: '0 0 8px' }}>
        📦 Marking <span style={{ color: '#ff7043' }}>{item.name}</span> as opened today
      </p>
      {openingItem!.hasShelfLife ? (
        <>
          <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#888', margin: '0 0 4px' }}>
            Typical shelf life after opening: <strong style={{ color: '#ff7043' }}>{openingItem!.rangeText}</strong>
          </p>
          <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#888', margin: '0 0 14px' }}>
            Suggested new expiry: <strong style={{ color: '#2d2d2d' }}>{formatDisplayDate(openingItem!.suggestedExpiry)}</strong>
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={() => confirmOpened(true)} style={{ ...btnBase, background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', boxShadow: '0 4px 12px rgba(255,112,67,0.3)' }}>✅ Update expiry</button>
            <button onClick={() => confirmOpened(false)} style={{ ...btnBase, background: 'white', color: '#ff7043', border: '1.5px solid rgba(255,112,67,0.3)' }}>📅 Just record opened</button>
            <button onClick={() => setOpeningItem(null)} style={{ ...btnBase, background: '#f5f5f5', color: '#888' }}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#aaa', margin: '0 0 14px' }}>
            No shelf life data for this item — we'll just record the opened date.
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => confirmOpened(false)} style={{ ...btnBase, background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', boxShadow: '0 4px 12px rgba(255,112,67,0.3)' }}>✅ Record opened</button>
            <button onClick={() => setOpeningItem(null)} style={{ ...btnBase, background: '#f5f5f5', color: '#888' }}>Cancel</button>
          </div>
        </>
      )}
    </div>
  )

  const actionArea = (item: InventoryItemWithPrice) => {
    if (usingItem?.id === item.id)  return partialUsePanel(item)
    if (openingItem?.id === item.id) return openingPanel(item)
    return (
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <button onClick={() => { setUsingItem({ id: item.id, used: 1, unit: item.unit, maxQty: item.quantity }); setOpeningItem(null); setEditingItem(null) }} style={{ ...btnBase, background: '#f0fff4', color: '#4caf50' }}>🍽️ Use some</button>
        <button onClick={() => markUsed(item.id)} style={{ ...btnBase, background: '#e8f5e9', color: '#388e3c' }}>✅ Used all</button>
        {!item.opened_at && (
          <button onClick={() => { startOpening(item); setEditingItem(null) }} style={{ ...btnBase, background: '#fff3e0', color: '#e65100' }}>📦 Mark opened</button>
        )}
        <button onClick={() => markDiscarded(item.id)} style={{ ...btnBase, background: '#fff0f0', color: '#ff4444' }}>🗑️ Discard</button>
        <button onClick={() => { setEditingItem({ id: item.id, quantity: item.quantity, unit: item.unit, expiry_date: item.expiry_date || '', location: item.location }); setUsingItem(null); setOpeningItem(null) }} style={{ ...btnBase, background: '#fff8f0', color: '#ff7043' }}>✏️ Edit</button>
        <select value={item.location} onChange={(e) => changeLocation(item.id, e.target.value)} style={{ border: '2px solid #eee', borderRadius: '50px', padding: '6px 12px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#555' }}>
          <option value="fridge">Fridge</option>
          <option value="freezer">Freezer</option>
          <option value="cupboard">Cupboard</option>
          <option value="household">Household</option>
          <option value="other">Other</option>
        </select>
      </div>
    )
  }

  const editForm = () => editingItem && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '12px', padding: '12px', background: 'white', borderRadius: '10px' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <label style={{ color: '#aaa', fontSize: '12px', fontWeight: 700, fontFamily: "'Nunito',sans-serif", width: '60px' }}>Qty</label>
        <input type="number" value={editingItem.quantity} onChange={e => setEditingItem({ ...editingItem, quantity: Number(e.target.value) })} style={{ width: '70px', border: '2px solid #eee', borderRadius: '8px', padding: '6px 8px', fontFamily: "'Nunito',sans-serif", fontWeight: 700 }} />
        <select value={editingItem.unit} onChange={e => setEditingItem({ ...editingItem, unit: e.target.value })} style={{ border: '2px solid #eee', borderRadius: '8px', padding: '6px 8px', fontFamily: "'Nunito',sans-serif", fontWeight: 700 }}>
          {units.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      {editingItem.location !== 'household' && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label style={{ color: '#aaa', fontSize: '12px', fontWeight: 700, fontFamily: "'Nunito',sans-serif", width: '60px' }}>Expiry</label>
          <input type="date" value={editingItem.expiry_date || ''} onChange={e => setEditingItem({ ...editingItem, expiry_date: e.target.value })} style={{ border: '2px solid #eee', borderRadius: '8px', padding: '6px 8px', fontFamily: "'Nunito',sans-serif", fontWeight: 700 }} />
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={saveEdit} style={{ ...btnBase, background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', boxShadow: '0 4px 12px rgba(255,112,67,0.3)' }}>Save</button>
        <button onClick={() => setEditingItem(null)} style={{ ...btnBase, background: '#f5f5f5', color: '#888' }}>Cancel</button>
      </div>
    </div>
  )

  // ── Item header helpers ───────────────────────────────────────��───────────

  type HeaderProps = {
    name: string; location: string; quantity: number; unit: string
    createdAt: string; openedAt: string | null; price: number | null
    hasBatches?: boolean
  }

  const ItemHeaderLeft = ({ name, location, quantity, unit, createdAt, openedAt, price, hasBatches }: HeaderProps) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <h3 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '17px', color: '#2d2d2d', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name}
        </h3>
        {location === 'household' && (
          <span style={{ background: 'rgba(100,120,240,0.1)', color: '#6478f0', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '50px', fontFamily: "'Nunito',sans-serif", flexShrink: 0 }}>🏠 household</span>
        )}
        {openedAt && (
          <span style={{ background: 'rgba(32,178,170,0.12)', color: '#20b2aa', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '50px', fontFamily: "'Nunito',sans-serif", flexShrink: 0 }}>🔓 {formatOpenedDate(openedAt)}</span>
        )}
        {hasBatches && (
          <span style={{ background: '#fff5f0', color: '#ff7043', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '50px', fontFamily: "'Nunito',sans-serif", flexShrink: 0 }}>batches</span>
        )}
      </div>
      <p style={{ color: '#ccc', fontSize: '11px', fontWeight: 600, margin: '3px 0 0', fontFamily: "'Nunito',sans-serif", display: 'flex', gap: '6px', flexWrap: 'wrap' as const }}>
        <span style={{ color: '#bbb', fontWeight: 700 }}>{quantity} {unit} · {location}</span>
        <span>· added {formatDateAdded(createdAt)}</span>
        {price != null && <span style={{ color: '#d4a96e' }}>· £{price.toFixed(2)}</span>}
      </p>
    </div>
  )

  const cardBg     = (loc: string) => loc === 'household' ? '#f0f4ff' : 'white'
  const cardBorder = (loc: string) => loc === 'household' ? '1.5px solid rgba(100,120,240,0.15)' : 'none'
  const expandedBg = (loc: string) => loc === 'household' ? '#eef1ff' : '#fffaf7'

  // ── Expiry right-side display ─────────────────────────────────────────────

  const ExpiryBadge = ({ d, location }: { d: number | null; location: string }) => {
    if (location === 'household') return null
    const isExpired = d !== null && d < 0
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {isExpired && <span style={{ fontSize: '15px' }} title="Expired">⚠️</span>}
        <span style={{ color: expiryColor(d), fontWeight: 800, fontSize: '12px', fontFamily: "'Nunito',sans-serif" }}>
          {expiryLabel(d)}
        </span>
      </div>
    )
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <main style={{ ...warmStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>
        <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '24px', color: '#ff7043' }}>Loading inventory...</p>
      </main>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main style={warmStyle}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');
        .item-row { transition: all 0.15s ease; }
        .item-row:active { transform: scale(0.99); }
      `}</style>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <h1 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '36px', color: '#2d2d2d', margin: 0 }}>Your Inventory</h1>
            <p style={{ color: '#aaa', fontWeight: 700, fontSize: '13px', margin: 0 }}>{items.length} items tracked</p>
          </div>
          <a href="/" style={{ background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontFamily: "'Fredoka One',cursive", fontSize: '15px', padding: '10px 18px', borderRadius: '50px', textDecoration: 'none', boxShadow: '0 4px 16px rgba(255,112,67,0.4)', whiteSpace: 'nowrap' }}>
            + Scan Receipt
          </a>
        </div>

        {/* ── Stock value card ── */}
        {pricedCount > 0 && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '16px 20px', marginBottom: '16px', boxShadow: '0 4px 16px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#aaa', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                💰 Current Stock Value
              </p>
              <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '28px', color: '#2d2d2d', margin: 0, lineHeight: 1 }}>
                £{stockValue.toFixed(2)}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#ccc', margin: 0 }}>
                {pricedCount} priced item{pricedCount !== 1 ? 's' : ''}
              </p>
              {items.length - pricedCount > 0 && (
                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '11px', color: '#ddd', margin: '2px 0 0' }}>
                  + {items.length - pricedCount} unpriced
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Expiring banner ── */}
        {expiringCount > 0 && (
          <button onClick={() => setFilter('expiring')} style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', background: 'linear-gradient(135deg,#fff8f0,#fff3e6)', border: '2px solid rgba(255,112,67,0.25)', borderRadius: '14px', padding: '12px 16px', marginBottom: '12px', cursor: 'pointer', textAlign: 'left', boxShadow: '0 2px 10px rgba(255,112,67,0.12)' }}>
            <span style={{ fontSize: '24px' }}>⏰</span>
            <div style={{ flex: 1 }}>
              <span style={{ fontFamily: "'Fredoka One',cursive", fontSize: '16px', color: '#ff7043' }}>{expiringCount} item{expiringCount > 1 ? 's' : ''} expiring within 7 days</span>
              <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#ffb347', margin: 0 }}>Tap to view expiring items</p>
            </div>
            <span style={{ background: '#ff7043', color: 'white', fontFamily: "'Fredoka One',cursive", fontSize: '16px', borderRadius: '50px', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{expiringCount}</span>
          </button>
        )}

        {/* ── Filter pills ── */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
          {filters.map((f) => {
            const active = filter === f
            const isExpiredTab = f === 'expired'
            const label =
              f === 'all'       ? 'All' :
              f === 'expiring'  ? `⏰ Expiring${expiringCount > 0 ? ` (${expiringCount})` : ''}` :
              f === 'expired'   ? `⚠️ Expired${expiredCount > 0 ? ` (${expiredCount})` : ''}` :
              f === 'household' ? '🏠 Household' :
              f.charAt(0).toUpperCase() + f.slice(1)
            const activeBg = isExpiredTab
              ? 'linear-gradient(135deg,#ff4444,#ff6b6b)'
              : 'linear-gradient(135deg,#ff7043,#ff9a3c)'
            return (
              <button key={f} onClick={() => setFilter(f)} style={{ padding: '7px 14px', borderRadius: '50px', border: 'none', cursor: 'pointer', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', background: active ? activeBg : 'white', color: active ? 'white' : '#888', boxShadow: active ? (isExpiredTab ? '0 4px 12px rgba(255,68,68,0.4)' : '0 4px 12px rgba(255,112,67,0.4)') : '0 2px 8px rgba(0,0,0,0.08)' }}>
                {label}
              </button>
            )
          })}
        </div>

        {/* ── Sort & group ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ border: '2px solid #eee', borderRadius: '50px', padding: '6px 14px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#555', background: 'white', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <option value="date_added">Date Added</option>
            <option value="expiry">Expiry (soonest first)</option>
            <option value="name">Name A–Z</option>
            <option value="location">Location</option>
            <option value="category">Category</option>
          </select>
          <button onClick={() => { setGrouped(!grouped); setExpandedId(null) }} style={{ padding: '6px 16px', borderRadius: '50px', border: 'none', cursor: 'pointer', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', background: grouped ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : 'white', color: grouped ? 'white' : '#888', boxShadow: grouped ? '0 4px 12px rgba(255,112,67,0.4)' : '0 2px 8px rgba(0,0,0,0.08)', transition: 'all 0.2s' }}>
            {grouped ? '⊞ Grouped' : '☰ Ungrouped'}
          </button>
        </div>

        {/* ── Item list ── */}
        {grouped ? (
          groupedItems.length === 0
            ? <p style={{ color: '#aaa', fontWeight: 700, textAlign: 'center', marginTop: '48px', fontFamily: "'Nunito',sans-serif" }}>No items found</p>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {groupedItems.map((group) => {
                  const d = daysLeft(group.nearestExpiry)
                  const isExpanded = expandedId === group.name
                  const hasBatches = group.batches.length > 1
                  const repBatch = group.batches[0]
                  const openedAt = !hasBatches ? repBatch.opened_at : null
                  return (
                    <div key={group.name} className="item-row" style={{ background: cardBg(group.location), borderRadius: '14px', boxShadow: '0 2px 10px rgba(0,0,0,0.07)', overflow: 'hidden', border: cardBorder(group.location) }}>
                      <div onClick={() => setExpandedId(isExpanded ? null : group.name)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', cursor: 'pointer', gap: '8px' }}>
                        <ItemHeaderLeft name={group.name} location={group.location} quantity={group.totalQuantity} unit={group.unit} createdAt={repBatch.created_at} openedAt={openedAt} price={!hasBatches ? repBatch.price : null} hasBatches={hasBatches} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                          <ExpiryBadge d={d} location={group.location} />
                          <span style={{ color: '#ccc', fontSize: '16px' }}>{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      </div>
                      {isExpanded && (
                        <div style={{ borderTop: '1px solid #f0f0f0', padding: '12px 16px', background: expandedBg(group.location) }}>
                          {hasBatches ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                              {group.batches.map((batch, bi) => {
                                const bd = daysLeft(batch.expiry_date)
                                const isEditingBatch = editingItem?.id === batch.id
                                return (
                                  <div key={batch.id} style={{ background: 'white', borderRadius: '10px', padding: '10px 12px', border: '1px solid #f0f0f0' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                      <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#555' }}>
                                        Batch {bi + 1} — {batch.quantity} {batch.unit}
                                        {batch.price != null && <span style={{ color: '#d4a96e', marginLeft: '6px' }}>£{batch.price.toFixed(2)}</span>}
                                      </span>
                                      <ExpiryBadge d={bd} location={batch.location} />
                                    </div>
                                    <p style={{ color: '#ddd', fontSize: '11px', fontWeight: 600, margin: '0 0 8px', fontFamily: "'Nunito',sans-serif" }}>
                                      Added {formatDateAdded(batch.created_at)}
                                      {batch.opened_at && <span style={{ color: '#20b2aa', marginLeft: '8px' }}>🔓 {formatOpenedDate(batch.opened_at)}</span>}
                                    </p>
                                    {isEditingBatch ? editForm() : actionArea(batch)}
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <>
                              {editingItem?.id === repBatch.id ? editForm() : actionArea(repBatch)}
                              {group.category && <span style={{ background: '#fff5f0', color: '#ff7043', fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '50px', fontFamily: "'Nunito',sans-serif" }}>{group.category}</span>}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
        ) : (
          sorted.length === 0
            ? <p style={{ color: '#aaa', fontWeight: 700, textAlign: 'center', marginTop: '48px', fontFamily: "'Nunito',sans-serif" }}>No items found</p>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {sorted.map((item) => {
                  const d = daysLeft(item.expiry_date)
                  const isExpanded = expandedId === item.id
                  const isEditing = editingItem?.id === item.id
                  return (
                    <div key={item.id} className="item-row" style={{ background: cardBg(item.location), borderRadius: '14px', boxShadow: '0 2px 10px rgba(0,0,0,0.07)', overflow: 'hidden', border: cardBorder(item.location) }}>
                      <div onClick={() => setExpandedId(isExpanded ? null : item.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', cursor: 'pointer', gap: '8px' }}>
                        <ItemHeaderLeft name={item.name} location={item.location} quantity={item.quantity} unit={item.unit} createdAt={item.created_at} openedAt={item.opened_at} price={item.price} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                          <ExpiryBadge d={d} location={item.location} />
                          <span style={{ color: '#ccc', fontSize: '16px' }}>{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      </div>
                      {isExpanded && (
                        <div style={{ borderTop: '1px solid #f0f0f0', padding: '12px 16px', background: expandedBg(item.location) }}>
                          {isEditing ? editForm() : actionArea(item)}
                          {item.category && <span style={{ background: '#fff5f0', color: '#ff7043', fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '50px', fontFamily: "'Nunito',sans-serif" }}>{item.category}</span>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
        )}

      </div>
    </main>
  )
}
