'use client'

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { InventoryItem } from '@/lib/types'
import { differenceInDays } from 'date-fns'

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [filter, setFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<string>('date_added')
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<{id:string,quantity:number,unit:string,expiry_date:string} | null>(null)

  async function loadItems() {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
    if (error) { alert('Error: ' + error.message) } else { setItems(data || []) }
    setLoading(false)
  }

  useEffect(() => { loadItems() }, [])

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

  async function markUsed(id: string) {
    await supabase.from('inventory_items').update({ status: 'used' }).eq('id', id)
    await supabase.from('inventory_events').insert({ inventory_item_id: id, type: 'used' })
    setExpandedId(null)
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

  const filtered = items.filter((item) => {
    if (filter === 'all') return true
    if (filter === 'expiring') return daysLeft(item.expiry_date) !== null && (daysLeft(item.expiry_date) as number) <= 7
    return item.location === filter
  })

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'expiry') {
      const da = daysLeft(a.expiry_date)
      const db = daysLeft(b.expiry_date)
      if (da === null && db === null) return 0
      if (da === null) return 1
      if (db === null) return -1
      return da - db
    }
    if (sortBy === 'name') return a.name.localeCompare(b.name)
    if (sortBy === 'location') return a.location.localeCompare(b.location)
    if (sortBy === 'category') return (a.category || '').localeCompare(b.category || '')
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  const warmStyle = {
    fontFamily: "'Nunito', sans-serif",
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #fdf6ec 0%, #fde8d0 50%, #fce4e4 100%)',
    padding: '24px',
  }

  const filters = ['all', 'fridge', 'freezer', 'cupboard', 'expiring']
  const units = ['item','g','kg','ml','l','bottle','tin','loaf','pack','bag','head','fillet']

  if (loading) {
    return (
      <main style={{...warmStyle, display:'flex', alignItems:'center', justifyContent:'center'}}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>
        <p style={{fontFamily:"'Fredoka One',cursive",fontSize:'24px',color:'#ff7043'}}>Loading inventory...</p>
      </main>
    )
  }

  return (
    <main style={warmStyle}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');
        .item-row{transition:all 0.2s ease;}
        .item-row:hover{transform:translateY(-1px);}
      `}</style>
      <div style={{maxWidth:'640px',margin:'0 auto'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'20px'}}>
          <div>
            <h1 style={{fontFamily:"'Fredoka One',cursive",fontSize:'36px',color:'#2d2d2d',margin:0}}>Your Inventory</h1>
            <p style={{color:'#aaa',fontWeight:700,fontSize:'13px',margin:0}}>{items.length} items tracked</p>
          </div>
          <a href="/" style={{background:'linear-gradient(135deg,#ff7043,#ff9a3c)',color:'white',fontFamily:"'Fredoka One',cursive",fontSize:'15px',padding:'10px 18px',borderRadius:'50px',textDecoration:'none',boxShadow:'0 4px 16px rgba(255,112,67,0.4)',whiteSpace:'nowrap'}}>
            + Scan Receipt
          </a>
        </div>

        <div style={{display:'flex',gap:'8px',marginBottom:'12px',flexWrap:'wrap'}}>
          {filters.map((f) => (
            <button key={f} onClick={() => setFilter(f)} style={{padding:'7px 14px',borderRadius:'50px',border:'none',cursor:'pointer',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',background: filter === f ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : 'white',color: filter === f ? 'white' : '#888',boxShadow: filter === f ? '0 4px 12px rgba(255,112,67,0.4)' : '0 2px 8px rgba(0,0,0,0.08)'}}>
              {f === 'all' ? 'All' : f === 'expiring' ? '⏰ Expiring' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'20px'}}>
          <span style={{color:'#aaa',fontWeight:700,fontSize:'13px',fontFamily:"'Nunito',sans-serif",whiteSpace:'nowrap'}}>Sort by:</span>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{border:'2px solid #eee',borderRadius:'50px',padding:'6px 14px',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',color:'#555',background:'white',boxShadow:'0 2px 8px rgba(0,0,0,0.06)'}}>
            <option value="date_added">Date Added</option>
            <option value="expiry">Expiry (soonest first)</option>
            <option value="name">Name A–Z</option>
            <option value="location">Location</option>
            <option value="category">Category</option>
          </select>
        </div>

        {sorted.length === 0
          ? <p style={{color:'#aaa',fontWeight:700,textAlign:'center',marginTop:'48px',fontFamily:"'Nunito',sans-serif"}}>No items found</p>
          : <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
              {sorted.map((item) => {
                const d = daysLeft(item.expiry_date)
                const isExpanded = expandedId === item.id
                const isEditing = editingItem?.id === item.id
                return (
                  <div key={item.id} className="item-row" style={{background:'white',borderRadius:'14px',boxShadow:'0 2px 10px rgba(0,0,0,0.07)',overflow:'hidden'}}>
                    <div
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',cursor:'pointer'}}
                    >
                      <div style={{flex:1,minWidth:0}}>
                        <h3 style={{fontFamily:"'Fredoka One',cursive",fontSize:'17px',color:'#2d2d2d',margin:0,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{item.name}</h3>
                        <p style={{color:'#bbb',fontSize:'12px',fontWeight:700,margin:0,fontFamily:"'Nunito',sans-serif"}}>{item.quantity} {item.unit} · {item.location}</p>
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:'8px',flexShrink:0}}>
                        <span style={{color:expiryColor(d),fontWeight:800,fontSize:'12px',fontFamily:"'Nunito',sans-serif"}}>{expiryLabel(d)}</span>
                        <span style={{color:'#ccc',fontSize:'18px'}}>{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{borderTop:'1px solid #f5f5f5',padding:'12px 16px',background:'#fffaf7'}}>
                        {isEditing ? (
                          <div style={{display:'flex',flexDirection:'column',gap:'10px',marginBottom:'12px'}}>
                            <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
                              <label style={{color:'#aaa',fontSize:'12px',fontWeight:700,fontFamily:"'Nunito',sans-serif",width:'60px'}}>Qty</label>
                              <input type="number" value={editingItem.quantity} onChange={e => setEditingItem({...editingItem,quantity:Number(e.target.value)})} style={{width:'70px',border:'2px solid #eee',borderRadius:'8px',padding:'6px 8px',fontFamily:"'Nunito',sans-serif",fontWeight:700}} />
                              <select value={editingItem.unit} onChange={e => setEditingItem({...editingItem,unit:e.target.value})} style={{border:'2px solid #eee',borderRadius:'8px',padding:'6px 8px',fontFamily:"'Nunito',sans-serif",fontWeight:700}}>
                                {units.map(u => <option key={u} value={u}>{u}</option>)}
                              </select>
                            </div>
                            <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
                              <label style={{color:'#aaa',fontSize:'12px',fontWeight:700,fontFamily:"'Nunito',sans-serif",width:'60px'}}>Expiry</label>
                              <input type="date" value={editingItem.expiry_date || ''} onChange={e => setEditingItem({...editingItem,expiry_date:e.target.value})} style={{border:'2px solid #eee',borderRadius:'8px',padding:'6px 8px',fontFamily:"'Nunito',sans-serif",fontWeight:700}} />
                            </div>
                            <div style={{display:'flex',gap:'8px'}}>
                              <button onClick={saveEdit} style={{background:'linear-gradient(135deg,#ff7043,#ff9a3c)',color:'white',border:'none',borderRadius:'50px',padding:'8px 20px',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',cursor:'pointer'}}>Save</button>
                              <button onClick={() => setEditingItem(null)} style={{background:'#f5f5f5',color:'#888',border:'none',borderRadius:'50px',padding:'8px 20px',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',cursor:'pointer'}}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{display:'flex',gap:'8px',flexWrap:'wrap',marginBottom:'10px'}}>
                            <button onClick={() => markUsed(item.id)} style={{background:'#f0fff4',color:'#4caf50',border:'none',borderRadius:'50px',padding:'7px 16px',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',cursor:'pointer'}}>✅ Used up</button>
                            <button onClick={() => markDiscarded(item.id)} style={{background:'#fff0f0',color:'#ff4444',border:'none',borderRadius:'50px',padding:'7px 16px',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',cursor:'pointer'}}>🗑️ Discard</button>
                            <button onClick={() => setEditingItem({id:item.id,quantity:item.quantity,unit:item.unit,expiry_date:item.expiry_date||''})} style={{background:'#fff8f0',color:'#ff7043',border:'none',borderRadius:'50px',padding:'7px 16px',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',cursor:'pointer'}}>✏️ Edit</button>
                            <select value={item.location} onChange={(e) => changeLocation(item.id, e.target.value)} style={{border:'2px solid #eee',borderRadius:'50px',padding:'6px 12px',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',color:'#555'}}>
                              <option value="fridge">Fridge</option>
                              <option value="freezer">Freezer</option>
                              <option value="cupboard">Cupboard</option>
                              <option value="other">Other</option>
                            </select>
                          </div>
                        )}
                        {item.category && <span style={{background:'#fff5f0',color:'#ff7043',fontSize:'11px',fontWeight:700,padding:'3px 10px',borderRadius:'50px',fontFamily:"'Nunito',sans-serif"}}>{item.category}</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
        }
        <div style={{display:'flex',justifyContent:'center',gap:'24px',marginTop:'32px'}}>
          <a href="/spend" style={{color:'#ff7043',fontWeight:700,fontSize:'14px',textDecoration:'none',fontFamily:"'Nunito',sans-serif"}}>💳 Spend History</a>
        </div>
      </div>
    </main>
  )
}
