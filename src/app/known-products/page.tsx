'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { KnownProduct } from '@/lib/types'

export default function KnownProductsPage() {
  const router = useRouter()
  const [items, setItems] = useState<KnownProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/auth'); return }
    const { data } = await supabase
      .from('known_products')
      .select('*')
      .eq('user_id', session.user.id)
      .order('times_purchased', { ascending: false })
      .order('name')
    setItems((data || []) as KnownProduct[])
    setLoading(false)
  }

  async function toggleFavourite(item: KnownProduct) {
    const next = !item.is_favourite
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_favourite: next } : i))
    await supabase.from('known_products').update({ is_favourite: next }).eq('id', item.id)
  }

  function startEdit(item: KnownProduct) {
    setEditingId(item.id)
    setEditName(item.name)
    setEditCategory(item.category || '')
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return
    setSaving(true)
    const { error } = await supabase
      .from('known_products')
      .update({ name: editName.trim(), category: editCategory.trim() || null })
      .eq('id', id)
    if (!error) {
      setItems(prev => prev.map(i => i.id === id ? { ...i, name: editName.trim(), category: editCategory.trim() || null } : i))
      setEditingId(null)
    }
    setSaving(false)
  }

  async function deleteItem(id: string) {
    setDeletingId(id)
    await supabase.from('known_products').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
    setDeletingId(null)
  }

  const filtered = items.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    (i.category || '').toLowerCase().includes(search.toLowerCase()) ||
    i.barcode.includes(search)
  )

  const btnBase: React.CSSProperties = {
    fontFamily: "'Nunito', sans-serif", fontWeight: 700, fontSize: '13px',
    border: 'none', borderRadius: '8px', cursor: 'pointer', padding: '6px 12px',
  }

  return (
    <main style={{ fontFamily: "'Nunito', sans-serif", minHeight: '100vh', padding: '72px 16px 32px' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
          <button onClick={() => router.back()} style={{ ...btnBase, background: 'none', padding: '4px 8px', fontSize: '20px', color: '#aaa' }}>←</button>
          <h1 style={{ fontFamily: "'Fredoka One', cursive", fontSize: '32px', color: '#2d2d2d', margin: 0 }}>
            Known Products
          </h1>
        </div>
        <p style={{ color: '#aaa', fontWeight: 700, fontSize: '14px', margin: '0 0 20px 44px' }}>
          Products ShelfSense has learned from your scans
        </p>

        {/* Search */}
        <input
          type="search"
          placeholder="Search by name, category or barcode…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '12px 16px', borderRadius: '12px',
            border: '2px solid #f0f0f0', fontFamily: "'Nunito', sans-serif",
            fontWeight: 700, fontSize: '14px', color: '#2d2d2d',
            outline: 'none', marginBottom: '16px', background: 'white',
          }}
        />

        {loading ? (
          <p style={{ textAlign: 'center', color: '#aaa', fontWeight: 700, marginTop: '48px' }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', marginTop: '64px' }}>
            <p style={{ fontFamily: "'Fredoka One', cursive", fontSize: '22px', color: '#ccc' }}>
              {search ? 'No matches' : 'No known products yet'}
            </p>
            <p style={{ color: '#bbb', fontWeight: 600, fontSize: '14px', marginTop: '8px' }}>
              {search ? 'Try a different search term' : 'Scan barcodes to start building your product memory'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filtered.map(item => {
              const isEditing = editingId === item.id
              const isDeleting = deletingId === item.id
              return (
                <div
                  key={item.id}
                  style={{
                    background: 'white', borderRadius: '14px',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
                    border: item.is_favourite ? '2px solid rgba(255,193,7,0.4)' : '2px solid transparent',
                    padding: '14px 16px',
                    opacity: isDeleting ? 0.4 : 1,
                    transition: 'opacity 0.2s',
                  }}
                >
                  {isEditing ? (
                    /* ── Edit mode ── */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <input
                        autoFocus
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        placeholder="Product name"
                        style={{
                          padding: '9px 12px', borderRadius: '8px',
                          border: '2px solid #ff7043', fontFamily: "'Nunito', sans-serif",
                          fontWeight: 700, fontSize: '14px', color: '#2d2d2d', outline: 'none',
                        }}
                      />
                      <input
                        value={editCategory}
                        onChange={e => setEditCategory(e.target.value)}
                        placeholder="Category (optional)"
                        style={{
                          padding: '9px 12px', borderRadius: '8px',
                          border: '2px solid #f0f0f0', fontFamily: "'Nunito', sans-serif",
                          fontWeight: 600, fontSize: '13px', color: '#555', outline: 'none',
                        }}
                      />
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => saveEdit(item.id)}
                          disabled={saving}
                          style={{ ...btnBase, background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', padding: '8px 18px' }}
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          style={{ ...btnBase, background: '#f5f5f5', color: '#888' }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── View mode ── */
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      {/* Favourite star */}
                      <button
                        onClick={() => toggleFavourite(item)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          fontSize: '20px', padding: '2px 0', flexShrink: 0,
                          opacity: item.is_favourite ? 1 : 0.25, transition: 'opacity 0.15s',
                        }}
                        title={item.is_favourite ? 'Remove favourite' : 'Mark as favourite'}
                      >
                        ⭐
                      </button>

                      {/* Product info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "'Fredoka One', cursive", fontSize: '16px', color: '#2d2d2d', lineHeight: 1.2 }}>
                          {item.name}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '5px', alignItems: 'center' }}>
                          {item.category && (
                            <span style={{ background: '#fff5f0', color: '#ff7043', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '50px' }}>
                              {item.category}
                            </span>
                          )}
                          {item.amount_per_unit && (
                            <span style={{ color: '#aaa', fontSize: '11px', fontWeight: 700 }}>
                              {item.amount_per_unit}{item.unit}
                            </span>
                          )}
                          <span style={{ color: '#ccc', fontSize: '11px', fontWeight: 600 }}>
                            #{item.barcode}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                          <span style={{ color: '#bbb', fontSize: '11px', fontWeight: 600 }}>
                            Scanned {item.times_purchased}×
                          </span>
                          {item.usual_retailer && (
                            <span style={{ color: '#bbb', fontSize: '11px', fontWeight: 600 }}>
                              {item.usual_retailer}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                        <button
                          onClick={() => startEdit(item)}
                          style={{ ...btnBase, background: '#f5f5f5', color: '#888', padding: '6px 10px' }}
                          title="Edit"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => deleteItem(item.id)}
                          disabled={isDeleting}
                          style={{ ...btnBase, background: '#fff0f0', color: '#ff4444', padding: '6px 10px' }}
                          title="Delete"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Footer count */}
        {!loading && items.length > 0 && (
          <p style={{ textAlign: 'center', color: '#ccc', fontWeight: 700, fontSize: '12px', marginTop: '24px' }}>
            {items.length} product{items.length !== 1 ? 's' : ''} learned
            {items.filter(i => i.is_favourite).length > 0 && ` · ${items.filter(i => i.is_favourite).length} favourite${items.filter(i => i.is_favourite).length !== 1 ? 's' : ''}`}
          </p>
        )}
      </div>
    </main>
  )
}
