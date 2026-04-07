'use client'

import React, { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { InventoryItem } from '@/lib/types'
import { lookupShelfLife } from '@/lib/shelfLife'
import { differenceInDays } from 'date-fns'

// ── Types ──────────────────────────────────────────────────────────────────────

type UseState = {
  used: number
  maxQty: number
  unit: string
  isFirstOpen: boolean
  suggestedExpiry: string
  rangeText: string
  acceptExpiry: boolean
}

export type ItemActionSheetProps = {
  item: InventoryItem
  onClose: () => void
  /** Called after any successful mutation so the parent can reload data. */
  onAction: (toast?: string) => void
  /** If provided, an "Edit" button is shown that triggers this callback. */
  onEdit?: () => void
}

// ── Helpers (module-level so they're not re-created per render) ───────────────

function daysLeft(date: string | null): number | null {
  if (!date) return null
  return differenceInDays(new Date(date), new Date())
}

function expiryColor(d: number | null): string {
  if (d === null) return '#ccc'
  if (d < 0)  return '#ff4444'
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
  if (d <= 7) return `Expires in ${d} days`
  return `${d}d left`
}

function expiryDate(date: string | null): string {
  if (!date) return ''
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
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
    return `${fmt(item.amount_per_unit)} ${item.unit}`
  }
  return `${fmt(rem)} ${item.unit}`
}

function formatOpenedDate(dateStr: string): string {
  const d = differenceInDays(new Date(), new Date(dateStr))
  if (d === 0) return 'Opened today'
  if (d === 1) return 'Opened yesterday'
  return `Opened ${d}d ago`
}

const locationLabel: Record<string, string> = {
  fridge: '❄️ Fridge', freezer: '🧊 Freezer', cupboard: '🗄️ Cupboard',
  household: '🏠 Household', other: '📦 Other',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ItemActionSheet({ item, onClose, onAction, onEdit }: ItemActionSheetProps) {
  type Mode = 'default' | 'use' | 'expiry' | 'remove_confirm'
  const [mode,       setMode]       = useState<Mode>('default')
  const [usingState, setUsingState] = useState<UseState | null>(null)
  const [expiryVal,  setExpiryVal]  = useState(item.expiry_date || '')
  const [loading,    setLoading]    = useState(false)

  const btnBase: React.CSSProperties = {
    border: 'none', borderRadius: '50px', padding: '10px 18px',
    fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px',
    cursor: 'pointer',
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function markUsed() {
    setLoading(true)
    await supabase.from('inventory_items').update({ status: 'used' }).eq('id', item.id)
    await supabase.from('inventory_events').insert({ inventory_item_id: item.id, type: 'used' })
    onClose()
    onAction('✅ Marked as used')
  }

  async function markWasted() {
    setLoading(true)
    await supabase.from('inventory_items').update({ status: 'discarded' }).eq('id', item.id)
    await supabase.from('inventory_events').insert({ inventory_item_id: item.id, type: 'discarded' })
    onClose()
    onAction('🗑️ Marked as wasted')
  }

  async function markRemoved() {
    setLoading(true)
    await supabase.from('inventory_items').update({ status: 'removed' }).eq('id', item.id)
    await supabase.from('inventory_events').insert({ inventory_item_id: item.id, type: 'removed' })
    onClose()
    onAction('✕ Item removed')
  }

  async function confirmUse() {
    if (!usingState) return
    setLoading(true)
    const used = Math.max(0, usingState.used)
    const remaining = parseFloat((usingState.maxQty - used).toFixed(3))
    const today = new Date().toISOString().split('T')[0]
    if (remaining <= 0) {
      await supabase.from('inventory_items').update({ status: 'used' }).eq('id', item.id)
      await supabase.from('inventory_events').insert({ inventory_item_id: item.id, type: 'used', quantity_delta: -usingState.maxQty })
      onClose()
      onAction('✅ All used up')
    } else {
      const upd: Record<string, any> = { remaining_quantity: remaining, quantity: remaining }
      if (usingState.isFirstOpen) {
        upd.opened_at = today
        if (usingState.acceptExpiry && usingState.suggestedExpiry) upd.expiry_date = usingState.suggestedExpiry
      }
      await supabase.from('inventory_items').update(upd).eq('id', item.id)
      const eventType = used === 0 ? 'opened' : 'used_some'
      await supabase.from('inventory_events').insert({
        inventory_item_id: item.id, type: eventType,
        quantity_delta: used === 0 ? null : -used,
        notes: usingState.isFirstOpen && usingState.rangeText ? `Shelf life after opening: ${usingState.rangeText}` : null,
      })
      const msg = usingState.isFirstOpen && used === 0
        ? (usingState.acceptExpiry && usingState.suggestedExpiry ? '✅ Opened — expiry updated' : '✅ Marked as opened')
        : '✅ Usage recorded'
      onClose()
      onAction(msg)
    }
  }

  async function saveExpiry() {
    if (!expiryVal) return
    setLoading(true)
    await supabase.from('inventory_items').update({ expiry_date: expiryVal }).eq('id', item.id)
    onClose()
    onAction('📅 Expiry updated')
  }

  function startUse() {
    const maxQty = item.remaining_quantity ?? item.quantity
    const isFirstOpen = !item.opened_at
    let suggestedExpiry = '', rangeText = '', acceptExpiry = false
    if (isFirstOpen) {
      const sl = lookupShelfLife(item.name, item.category)
      if (sl) {
        const avg = Math.round((sl.min + sl.max) / 2)
        const d = new Date(); d.setDate(d.getDate() + avg)
        suggestedExpiry = d.toISOString().split('T')[0]
        rangeText = sl.min === sl.max ? `${sl.min} days` : `${sl.min}–${sl.max} days`
        acceptExpiry = true
      }
    }
    setUsingState({ used: 0, maxQty, unit: item.unit, isFirstOpen, suggestedExpiry, rangeText, acceptExpiry })
    setMode('use')
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const d = daysLeft(item.expiry_date)

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.38)', zIndex: 2000 }} />

      {/* Sheet */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'white', borderRadius: '24px 24px 0 0',
        padding: '20px 20px 48px', zIndex: 2001,
        boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
        fontFamily: "'Nunito',sans-serif",
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>

        {/* Drag handle */}
        <div style={{ width: '40px', height: '4px', background: '#eee', borderRadius: '2px', margin: '0 auto 16px' }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '20px', color: '#2d2d2d', margin: '0 0 5px', textTransform: 'capitalize' }}>
              {item.name}
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '13px', color: '#888' }}>{fmtQty(item)}</span>
              <span style={{ color: '#ddd' }}>·</span>
              <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '12px', color: '#bbb' }}>{locationLabel[item.location] ?? item.location}</span>
              {item.opened_at && (
                <span style={{ background: 'rgba(32,178,170,0.1)', color: '#20b2aa', fontSize: '11px', fontWeight: 700, padding: '2px 7px', borderRadius: '50px' }}>
                  🔓 {formatOpenedDate(item.opened_at)}
                </span>
              )}
            </div>
            {/* Expiry badge */}
            {item.location !== 'household' && (
              <div style={{ marginTop: '6px' }}>
                {item.expiry_date ? (
                  <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: expiryColor(d), background: `${expiryColor(d)}18`, padding: '3px 10px', borderRadius: '50px' }}>
                    {expiryLabel(d)}
                    {d !== null && d >= -30 && d <= 30 && (
                      <span style={{ fontWeight: 600, opacity: 0.7, marginLeft: '4px' }}>({expiryDate(item.expiry_date)})</span>
                    )}
                  </span>
                ) : (
                  <span style={{ background: 'rgba(230,165,0,0.12)', color: '#c9880a', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '50px' }}>no expiry set</span>
                )}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#ccc', fontSize: '22px', cursor: 'pointer', padding: '2px 4px', lineHeight: 1, flexShrink: 0 }}>✕</button>
        </div>

        {/* ─── Mode: use ─────────────────────────────────────────────────── */}
        {mode === 'use' && usingState && (
          <div style={{ background: '#f4fff6', border: '1.5px solid rgba(76,175,80,0.25)', borderRadius: '12px', padding: '14px 16px', marginBottom: '12px' }}>
            <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '15px', color: '#2d2d2d', margin: '0 0 10px' }}>
              {usingState.isFirstOpen ? '📦 Opening for the first time' : '🍽️ Recording use'}
            </p>

            {usingState.isFirstOpen && (
              <div style={{ background: 'rgba(255,112,67,0.05)', border: '1px solid rgba(255,112,67,0.15)', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px' }}>
                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#ff7043', margin: '0 0 6px' }}>
                  We'll note today as the opening date.
                </p>
                {usingState.suggestedExpiry && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#888' }}>
                      Shelf life {usingState.rangeText} →
                    </span>
                    <input type="date" value={usingState.suggestedExpiry}
                      onChange={e => setUsingState({ ...usingState, suggestedExpiry: e.target.value })}
                      style={{ border: '2px solid #ffe0cc', borderRadius: '8px', padding: '4px 8px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px' }} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={usingState.acceptExpiry}
                        onChange={e => setUsingState({ ...usingState, acceptExpiry: e.target.checked })}
                        style={{ accentColor: '#ff7043', width: '14px', height: '14px' }} />
                      <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#555' }}>Update expiry</span>
                    </label>
                  </div>
                )}
              </div>
            )}

            <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#555', margin: '0 0 8px' }}>
              How much did you use?
              {usingState.isFirstOpen && <span style={{ color: '#aaa', fontWeight: 600 }}> Leave at 0 to just open it.</span>}
            </p>

            <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
              {usingState.isFirstOpen && (
                <button onClick={() => setUsingState({ ...usingState, used: 0 })}
                  style={{ ...btnBase, flex: 1, background: usingState.used === 0 ? '#e8f5e9' : '#f5f5f5', color: usingState.used === 0 ? '#388e3c' : '#bbb', border: `1.5px solid ${usingState.used === 0 ? 'rgba(76,175,80,0.3)' : 'transparent'}`, padding: '7px 4px', fontSize: '12px' }}>
                  Just opening
                </button>
              )}
              {[25, 50, 75].map(pct => (
                <button key={pct}
                  onClick={() => setUsingState({ ...usingState, used: parseFloat(((usingState.maxQty * pct) / 100).toFixed(3)) })}
                  style={{ ...btnBase, flex: 1, background: '#e8f5e9', color: '#388e3c', border: '1.5px solid rgba(76,175,80,0.2)', padding: '7px 4px', fontSize: '12px' }}>
                  {pct}%
                </button>
              ))}
              <button onClick={() => setUsingState({ ...usingState, used: usingState.maxQty })}
                style={{ ...btnBase, flex: 1, background: '#c8e6c9', color: '#2e7d32', border: 'none', padding: '7px 4px', fontSize: '12px' }}>
                All
              </button>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
              <input type="number" min={0} max={usingState.maxQty} step={0.1}
                value={usingState.used || ''}
                placeholder="0"
                onChange={e => setUsingState({ ...usingState, used: parseFloat(e.target.value) || 0 })}
                style={{ width: '80px', border: '2px solid #c8e6c9', borderRadius: '8px', padding: '7px 10px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '15px', textAlign: 'center' }}
              />
              <span style={{ fontWeight: 700, color: '#555', fontSize: '14px' }}>{usingState.unit} used</span>
              {usingState.used > 0 && (
                <span style={{ color: '#4caf50', fontSize: '12px', fontWeight: 700 }}>
                  → {parseFloat((usingState.maxQty - usingState.used).toFixed(2))} {usingState.unit} remaining
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={confirmUse} disabled={loading}
                style={{ ...btnBase, background: 'linear-gradient(135deg,#4caf50,#66bb6a)', color: 'white', boxShadow: '0 4px 12px rgba(76,175,80,0.3)', opacity: loading ? 0.6 : 1 }}>
                {usingState.isFirstOpen && usingState.used === 0 ? '✅ Mark as opened' : '✅ Record use'}
              </button>
              <button onClick={() => { setMode('default'); setUsingState(null) }}
                style={{ ...btnBase, background: '#f5f5f5', color: '#888' }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ─── Mode: expiry ───────────────────────────────────────────────── */}
        {mode === 'expiry' && (
          <div style={{ background: '#fdf9f6', borderRadius: '12px', padding: '14px 16px', marginBottom: '12px', border: '1.5px solid rgba(255,112,67,0.15)' }}>
            <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 8px' }}>📅 Update expiry date</p>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
              <input type="date" value={expiryVal} onChange={e => setExpiryVal(e.target.value)}
                style={{ flex: 1, border: '2px solid #eee', borderRadius: '8px', padding: '8px 12px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: expiryVal ? '#2d2d2d' : '#bbb' }} />
              <button onClick={saveExpiry} disabled={loading || !expiryVal}
                style={{ ...btnBase, background: expiryVal ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : '#eee', color: expiryVal ? 'white' : '#bbb', padding: '10px 18px', boxShadow: expiryVal ? '0 4px 12px rgba(255,112,67,0.3)' : 'none', opacity: loading ? 0.6 : 1 }}>
                Save
              </button>
            </div>
            <button onClick={() => setMode('default')} style={{ ...btnBase, background: 'none', color: '#bbb', padding: '4px 0', fontSize: '12px' }}>Cancel</button>
          </div>
        )}

        {/* ─── Mode: remove confirm ───────────────────────────────────────── */}
        {mode === 'remove_confirm' && (
          <div style={{ background: '#fff0f0', border: '1.5px solid rgba(255,68,68,0.25)', borderRadius: '12px', padding: '14px 16px', marginBottom: '12px' }}>
            <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#cc3333', margin: '0 0 10px' }}>
              Remove this item permanently? It won't count as waste.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={markRemoved} disabled={loading}
                style={{ ...btnBase, background: 'linear-gradient(135deg,#ff4444,#ff6b6b)', color: 'white', flex: 1, opacity: loading ? 0.6 : 1 }}>
                Yes, remove it
              </button>
              <button onClick={() => setMode('default')}
                style={{ ...btnBase, background: '#f5f5f5', color: '#888' }}>Cancel</button>
            </div>
          </div>
        )}

        {/* ─── Mode: default ─────────────────────────────────────────────── */}
        {mode === 'default' && (
          <>
            {/* Primary action row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
              <button onClick={startUse} disabled={loading}
                style={{ ...btnBase, background: 'linear-gradient(135deg,#4caf50,#66bb6a)', color: 'white', boxShadow: '0 4px 14px rgba(76,175,80,0.3)' }}>
                🍽️ {item.opened_at ? 'Use some' : 'Use / Open'}
              </button>
              <button onClick={markUsed} disabled={loading}
                style={{ ...btnBase, background: '#e8f5e9', color: '#388e3c', opacity: loading ? 0.6 : 1 }}>
                ✅ Used all
              </button>
            </div>

            {/* Secondary row */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
              <button onClick={() => setMode('expiry')}
                style={{ ...btnBase, background: '#fdf9f6', color: '#ff7043', border: '1.5px solid rgba(255,112,67,0.2)', flex: 1 }}>
                📅 {item.expiry_date ? 'Update expiry' : 'Set expiry'}
              </button>
              {onEdit && (
                <button onClick={onEdit}
                  style={{ ...btnBase, background: '#fff8f0', color: '#ff7043', border: '1.5px solid rgba(255,112,67,0.15)' }}>
                  ✏️ Edit
                </button>
              )}
            </div>

            {/* Tertiary row */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', paddingTop: '4px', borderTop: '1px solid #f5f5f5' }}>
              <button onClick={markWasted} disabled={loading}
                style={{ ...btnBase, background: '#fff0f0', color: '#e05050', opacity: loading ? 0.6 : 1 }}>
                🗑️ Wasted
              </button>
              <button onClick={() => setMode('remove_confirm')}
                style={{ ...btnBase, background: '#f5f5f5', color: '#aaa' }}>
                ✕ Remove item
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
