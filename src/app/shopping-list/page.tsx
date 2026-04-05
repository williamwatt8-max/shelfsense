'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { ShoppingListItem } from '@/lib/types'

export default function ShoppingListPage() {
  const [items,        setItems]        = useState<ShoppingListItem[]>([])
  const [loading,      setLoading]      = useState(true)
  const [adding,       setAdding]       = useState(false)
  const [newName,      setNewName]      = useState('')
  const [newQty,       setNewQty]       = useState('1')
  const [newUnit,      setNewUnit]      = useState('item')
  const [saving,       setSaving]       = useState(false)
  const [toast,        setToast]        = useState<string | null>(null)
  const [boughtPrompt, setBoughtPrompt] = useState<ShoppingListItem | null>(null)

  const UNITS = ['item', 'g', 'kg', 'ml', 'l', 'pack', 'tsp', 'tbsp', 'cup', 'clove', 'bunch']

  const warm: React.CSSProperties = {
    fontFamily: "'Nunito', sans-serif",
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #fdf6ec 0%, #fde8d0 50%, #fce4e4 100%)',
    padding: '72px 24px 40px',
  }
  const card: React.CSSProperties = {
    background: 'white', borderRadius: '14px', padding: '16px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.07)',
  }
  const btn = (bg: string, color = 'white'): React.CSSProperties => ({
    border: 'none', borderRadius: '50px', padding: '10px 20px',
    fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px',
    cursor: 'pointer', background: bg, color,
  })
  const inp: React.CSSProperties = {
    border: '2px solid #eee', borderRadius: '8px', padding: '8px 10px',
    fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px',
    width: '100%', boxSizing: 'border-box' as const,
  }

  useEffect(() => { loadItems() }, [])

  async function loadItems() {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id
    if (!userId) { setLoading(false); return }
    const { data } = await supabase
      .from('shopping_list_items')
      .select('*')
      .eq('user_id', userId)
      .order('checked', { ascending: true })
      .order('created_at', { ascending: false })
    setItems((data || []) as ShoppingListItem[])
    setLoading(false)
  }

  async function toggleChecked(item: ShoppingListItem) {
    const newChecked = !item.checked
    await supabase.from('shopping_list_items').update({ checked: newChecked }).eq('id', item.id)
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, checked: newChecked } : i)
      .sort((a, b) => Number(a.checked) - Number(b.checked) || 0))
    // When checking an item off, offer to add to inventory
    if (newChecked) setBoughtPrompt(item)
  }

  async function addBoughtToInventory(item: ShoppingListItem) {
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id ?? null
    await supabase.from('inventory_items').insert({
      name: item.name, quantity: item.quantity, quantity_original: item.quantity,
      unit: item.unit, location: 'cupboard', source: 'manual', status: 'active', user_id: userId,
    })
    setBoughtPrompt(null)
    showToast(`📦 ${item.name} added to inventory`)
  }

  async function deleteItem(id: string) {
    await supabase.from('shopping_list_items').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  async function clearChecked() {
    const checkedIds = items.filter(i => i.checked).map(i => i.id)
    if (checkedIds.length === 0) return
    if (!confirm(`Remove ${checkedIds.length} checked item${checkedIds.length > 1 ? 's' : ''}?`)) return
    await supabase.from('shopping_list_items').delete().in('id', checkedIds)
    setItems(prev => prev.filter(i => !i.checked))
    showToast(`🗑 Removed ${checkedIds.length} item${checkedIds.length > 1 ? 's' : ''}`)
  }

  async function clearAll() {
    if (!confirm('Clear the entire shopping list?')) return
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id
    if (!userId) return
    await supabase.from('shopping_list_items').delete().eq('user_id', userId)
    setItems([])
    showToast('🗑 Shopping list cleared')
  }

  async function addItem() {
    if (!newName.trim()) return
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id ?? null
    const { data } = await supabase.from('shopping_list_items').insert({
      user_id:  userId,
      name:     newName.trim(),
      quantity: parseFloat(newQty) || 1,
      unit:     newUnit,
    }).select().single()
    setSaving(false)
    if (data) {
      setItems(prev => [data as ShoppingListItem, ...prev])
      setNewName(''); setNewQty('1'); setAdding(false)
    }
  }

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(null), 2200)
  }

  function formatQty(qty: number, unit: string): string {
    const n = qty % 1 === 0 ? String(qty) : qty.toFixed(1)
    return unit === 'item' ? n : `${n} ${unit}`
  }

  const unchecked = items.filter(i => !i.checked)
  const checked   = items.filter(i => i.checked)

  return (
    <main style={warm}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>

      {toast && (
        <div style={{ position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)', background: '#2d2d2d', color: 'white', padding: '10px 20px', borderRadius: '50px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', zIndex: 2000, whiteSpace: 'nowrap', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}

      {/* Bought → add to inventory prompt */}
      {boughtPrompt && (
        <div style={{ position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)', background: 'white', borderRadius: '16px', padding: '16px 20px', boxShadow: '0 8px 32px rgba(0,0,0,0.15)', zIndex: 2100, minWidth: '280px', maxWidth: '340px', width: 'calc(100vw - 40px)' }}>
          <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '16px', color: '#2d2d2d', margin: '0 0 4px' }}>
            Add to pantry?
          </p>
          <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#888', margin: '0 0 14px' }}>
            You bought <b style={{ color: '#2d2d2d' }}>{boughtPrompt.name}</b> — add it to your inventory?
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => addBoughtToInventory(boughtPrompt)} style={{ ...btn('linear-gradient(135deg,#ff7043,#ff9a3c)'), flex: 1, padding: '10px' }}>
              📦 Add to Pantry
            </button>
            <button onClick={() => setBoughtPrompt(null)} style={{ ...btn('white', '#888'), padding: '10px 16px' }}>
              Skip
            </button>
          </div>
        </div>
      )}

      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <a href="/" style={{ color: '#ff7043', fontWeight: 700, fontSize: '14px', textDecoration: 'none' }}>← Home</a>
          <h1 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '32px', color: '#2d2d2d', margin: 0, flex: 1 }}>Shopping List</h1>
          <button onClick={() => setAdding(v => !v)}
            style={btn(adding ? 'white' : 'linear-gradient(135deg,#ff7043,#ff9a3c)', adding ? '#ff7043' : 'white')}>
            {adding ? '✕ Cancel' : '+ Add'}
          </button>
        </div>

        {/* Add item form */}
        {adding && (
          <div style={{ ...card, marginBottom: '14px' }}>
            <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '16px', color: '#ff7043', margin: '0 0 12px' }}>Add item</p>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '10px' }}>
              <input style={{ ...inp, flex: 3 }} placeholder="Item name" value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addItem()} autoFocus />
              <input style={{ ...inp, width: '60px', flex: 'none', textAlign: 'center' }} type="number" min={0} step={0.1}
                value={newQty} onChange={e => setNewQty(e.target.value)} />
              <select style={{ ...inp, flex: 'none', width: '68px', padding: '8px 4px' }} value={newUnit}
                onChange={e => setNewUnit(e.target.value)}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <button onClick={addItem} disabled={saving || !newName.trim()}
              style={btn(!newName.trim() || saving ? '#eee' : 'linear-gradient(135deg,#ff7043,#ff9a3c)', !newName.trim() || saving ? '#bbb' : 'white')}>
              {saving ? 'Adding...' : 'Add to list'}
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <p style={{ textAlign: 'center', color: '#aaa', fontWeight: 700, marginTop: '40px' }}>Loading...</p>
        )}

        {/* Empty state */}
        {!loading && items.length === 0 && !adding && (
          <div style={{ ...card, textAlign: 'center', padding: '40px 24px' }}>
            <div style={{ fontSize: '56px', marginBottom: '12px' }}>🛒</div>
            <h2 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '24px', color: '#2d2d2d', margin: '0 0 8px' }}>List is empty</h2>
            <p style={{ color: '#aaa', fontWeight: 700, fontSize: '14px', margin: '0 0 20px' }}>
              Add items manually or generate from a recipe
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setAdding(true)} style={btn('linear-gradient(135deg,#ff7043,#ff9a3c)')}>
                + Add Item
              </button>
              <a href="/recipes" style={{ ...btn('white', '#ff7043'), textDecoration: 'none' }}>
                🍽️ View Recipes
              </a>
            </div>
          </div>
        )}

        {/* Unchecked items */}
        {unchecked.length > 0 && (
          <div style={{ ...card, marginBottom: '12px' }}>
            <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#aaa', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {unchecked.length} to buy
            </p>
            {unchecked.map((item, i) => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderTop: i > 0 ? '1px solid #f5f5f5' : 'none' }}>
                <div onClick={() => toggleChecked(item)}
                  style={{ width: '22px', height: '22px', borderRadius: '50%', border: '2px solid #ddd', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'white' }} />
                <div style={{ flex: 1 }}>
                  <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '15px', color: '#2d2d2d', textTransform: 'capitalize' as const }}>
                    {item.name}
                  </span>
                  {(item.quantity !== 1 || item.unit !== 'item') && (
                    <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#bbb', marginLeft: '8px' }}>
                      {formatQty(item.quantity, item.unit)}
                    </span>
                  )}
                </div>
                <button onClick={() => deleteItem(item.id)} style={{ background: 'none', border: 'none', color: '#e0e0e0', cursor: 'pointer', fontSize: '15px', padding: '4px' }}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Checked items */}
        {checked.length > 0 && (
          <div style={{ ...card, marginBottom: '12px', opacity: 0.75 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#aaa', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {checked.length} done
              </p>
              <button onClick={clearChecked} style={{ background: 'none', border: 'none', color: '#bbb', fontWeight: 700, fontSize: '12px', cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>
                Remove done
              </button>
            </div>
            {checked.map((item, i) => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0', borderTop: i > 0 ? '1px solid #f5f5f5' : 'none' }}>
                <div onClick={() => toggleChecked(item)}
                  style={{ width: '22px', height: '22px', borderRadius: '50%', border: '2px solid #4caf50', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#4caf50,#66bb6a)' }}>
                  <span style={{ color: 'white', fontSize: '13px' }}>✓</span>
                </div>
                <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#bbb', textDecoration: 'line-through', flex: 1, textTransform: 'capitalize' as const }}>
                  {item.name}
                </span>
                <button onClick={() => deleteItem(item.id)} style={{ background: 'none', border: 'none', color: '#e0e0e0', cursor: 'pointer', fontSize: '15px', padding: '4px' }}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Clear all */}
        {items.length > 0 && (
          <button onClick={clearAll} style={{ ...btn('rgba(255,68,68,0.08)', '#ff4444'), fontSize: '13px', padding: '8px 18px' }}>
            🗑 Clear entire list
          </button>
        )}
      </div>
    </main>
  )
}
