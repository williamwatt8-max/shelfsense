'use client'

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { InventoryItem } from '@/lib/types'
import { differenceInDays } from 'date-fns'

type GroupedItem = {
  name: string
  totalQuantity: number
  unit: string
  location: string
  category: string | null
  nearestExpiry: string | null
  batches: InventoryItem[]
}

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [filter, setFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<string>('date_added')
  const [grouped, setGrouped] = useState<boolean>(true)
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

  function sortItems(arr: InventoryItem[]): InventoryItem[] {
    return [...arr].sort((a, b) => {
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
  }

  function groupItems(arr: InventoryItem[]): GroupedItem[] {
    const map = new Map<string, GroupedItem>()
    for (const item of arr) {
      const key = item.name.toLowerCase().trim()
      if (map.has(key)) {
        const g = map.get(key)!
        g.totalQuantity += item.quantity
        g.batches.push(item)
        if (item.expiry_date) {
          if (!g.nearestExpiry || item.expiry_date < g.nearestExpiry) {
            g.nearestExpiry = item.expiry_date
          }
        }
      } else {
        map.set(key, {
          name: item.name,
          totalQuantity: item.quantity,
          unit: item.unit,
          location: item.location,
          category: item.category,
          nearestExpiry: item.expiry_date,
          batches: [item],
        })
      }
    }
    const groups = Array.from(map.values())
    return groups.sort((a, b) => {
      if (sortBy === 'expiry') {
        const da = daysLeft(a.nearestExpiry)
        const db = daysLeft(b.nearestExpiry)
        if (da === null && db === null) return 0
        if (da === null) return 1
        if (db === null) return -1
        return da - db
      }
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'location') return a.location.localeCompare(b.location)
      if (sortBy === 'category') return (a.category || '').localeCompare(b.category || '')
      return 0
    })
  }

  const sorted = sortItems(filtered)
  const groupedItems = groupItems(filtered)

  const warmStyle = {
    fontFamily: "'Nunito', sans-serif",
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #fdf6ec 0%, #fde8d0 50%, #fce4e4 100%)',
    padding: '72px 24px 32px',
  }

  const expiringCount = items.filter((item) => {
    const d = daysLeft(item.expiry_date)
    return d !== null && d >= 0 && d <= 7
  }).length

  const filters = ['all', 'fridge', 'freezer', 'cupboard', 'household', 'expiring']
  const units = ['item','g','kg','ml','l','bottle','tin','loaf','pack','bag','head','fillet']

  const actionButtons = (item: InventoryItem) => (
    <div style={{display:'flex',gap:'8px',flexWrap:'wrap',marginBottom:'8px'}}>
      <button onClick={() => markUsed(item.id)} style={{background:'#f0fff4',color:'#4caf50',border:'none',borderRadius:'50px',padding:'7px 16px',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',cursor:'pointer'}}>✅ Used up</button>
      <button onClick={() => markDiscarded(item.id)} style={{background:'#fff0f0',color:'#ff4444',border:'none',borderRadius:'50px',padding:'7px 16px',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',cursor:'pointer'}}>🗑️ Discard</button>
      <button onClick={() => setEditingItem({id:item.id,quantity:item.quantity,unit:item.unit,expiry_date:item.expiry_date||''})} style={{background:'#fff8f0',color:'#ff7043',border:'none',borderRadius:'50px',padding:'7px 16px',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',cursor:'pointer'}}>✏️ Edit</button>
      <select value={item.location} onChange={(e) => changeLocation(item.id, e.target.value)} style={{border:'2px solid #eee',borderRadius:'50px',padding:'6px 12px',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',color:'#555'}}>
        <option value="fridge">Fridge</option>
        <option value="freezer">Freezer</option>
        <option value="cupboard">Cupboard</option>
        <option value="household">Household</option>
        <option value="other">Other</option>
      </select>
    </div>
  )

  const editForm = () => editingItem && (
    <div style={{display:'flex',flexDirection:'column',gap:'10px',marginBottom:'12px',padding:'12px',background:'white',borderRadius:'10px'}}>
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
  )

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
        .item-row{transition:all 0.15s ease;}
        .item-row:active{transform:scale(0.99);}
      `}</style>
      <div style={{maxWidth:'640px',margin:'0 auto'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'12px'}}>
          <div>
            <h1 style={{fontFamily:"'Fredoka One',cursive",fontSize:'36px',color:'#2d2d2d',margin:0}}>Your Inventory</h1>
            <p style={{color:'#aaa',fontWeight:700,fontSize:'13px',margin:0}}>{items.length} items tracked</p>
          </div>
          <a href="/" style={{background:'linear-gradient(135deg,#ff7043,#ff9a3c)',color:'white',fontFamily:"'Fredoka One',cursive",fontSize:'15px',padding:'10px 18px',borderRadius:'50px',textDecoration:'none',boxShadow:'0 4px 16px rgba(255,112,67,0.4)',whiteSpace:'nowrap'}}>
            + Scan Receipt
          </a>
        </div>

        {expiringCount > 0 && (
          <button
            onClick={() => setFilter('expiring')}
            style={{display:'flex',alignItems:'center',gap:'10px',width:'100%',background:'linear-gradient(135deg,#fff8f0,#fff3e6)',border:'2px solid rgba(255,112,67,0.25)',borderRadius:'14px',padding:'12px 16px',marginBottom:'16px',cursor:'pointer',textAlign:'left',boxShadow:'0 2px 10px rgba(255,112,67,0.12)'}}
          >
            <span style={{fontSize:'24px'}}>⏰</span>
            <div style={{flex:1}}>
              <span style={{fontFamily:"'Fredoka One',cursive",fontSize:'16px',color:'#ff7043'}}>
                {expiringCount} item{expiringCount > 1 ? 's' : ''} expiring within 7 days
              </span>
              <p style={{fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'12px',color:'#ffb347',margin:0}}>
                Tap to view expiring items
              </p>
            </div>
            <span style={{background:'#ff7043',color:'white',fontFamily:"'Fredoka One',cursive",fontSize:'16px',borderRadius:'50px',width:'28px',height:'28px',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              {expiringCount}
            </span>
          </button>
        )}

        <div style={{display:'flex',gap:'8px',marginBottom:'12px',flexWrap:'wrap'}}>
          {filters.map((f) => {
            const label =
              f === 'all'       ? 'All' :
              f === 'expiring'  ? `⏰ Expiring${expiringCount > 0 ? ` (${expiringCount})` : ''}` :
              f === 'household' ? '🏠 Household' :
              f.charAt(0).toUpperCase() + f.slice(1)
            return (
              <button key={f} onClick={() => setFilter(f)} style={{padding:'7px 14px',borderRadius:'50px',border:'none',cursor:'pointer',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',background: filter === f ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : 'white',color: filter === f ? 'white' : '#888',boxShadow: filter === f ? '0 4px 12px rgba(255,112,67,0.4)' : '0 2px 8px rgba(0,0,0,0.08)'}}>
                {label}
              </button>
            )
          })}
        </div>

        <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'20px',flexWrap:'wrap'}}>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{border:'2px solid #eee',borderRadius:'50px',padding:'6px 14px',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',color:'#555',background:'white',boxShadow:'0 2px 8px rgba(0,0,0,0.06)'}}>
            <option value="date_added">Date Added</option>
            <option value="expiry">Expiry (soonest first)</option>
            <option value="name">Name A–Z</option>
            <option value="location">Location</option>
            <option value="category">Category</option>
          </select>

          <button
            onClick={() => { setGrouped(!grouped); setExpandedId(null) }}
            style={{padding:'6px 16px',borderRadius:'50px',border:'none',cursor:'pointer',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',background: grouped ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : 'white',color: grouped ? 'white' : '#888',boxShadow: grouped ? '0 4px 12px rgba(255,112,67,0.4)' : '0 2px 8px rgba(0,0,0,0.08)',transition:'all 0.2s'}}
          >
            {grouped ? '⊞ Grouped' : '☰ Ungrouped'}
          </button>
        </div>

        {grouped ? (
          groupedItems.length === 0
            ? <p style={{color:'#aaa',fontWeight:700,textAlign:'center',marginTop:'48px',fontFamily:"'Nunito',sans-serif"}}>No items found</p>
            : <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                {groupedItems.map((group) => {
                  const d = daysLeft(group.nearestExpiry)
                  const isExpanded = expandedId === group.name
                  const hasBatches = group.batches.length > 1
                  return (
                    <div key={group.name} className="item-row" style={{background: group.location === 'household' ? '#f0f4ff' : 'white',borderRadius:'14px',boxShadow:'0 2px 10px rgba(0,0,0,0.07)',overflow:'hidden',border: group.location === 'household' ? '1.5px solid rgba(100,120,240,0.15)' : 'none'}}>
                      <div onClick={() => setExpandedId(isExpanded ? null : group.name)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',cursor:'pointer'}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                            <h3 style={{fontFamily:"'Fredoka One',cursive",fontSize:'17px',color:'#2d2d2d',margin:0,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{group.name}</h3>
                            {group.location === 'household' && <span style={{background:'rgba(100,120,240,0.1)',color:'#6478f0',fontSize:'11px',fontWeight:700,padding:'2px 8px',borderRadius:'50px',fontFamily:"'Nunito',sans-serif",flexShrink:0}}>🏠 household</span>}
                            {hasBatches && <span style={{background:'#fff5f0',color:'#ff7043',fontSize:'11px',fontWeight:700,padding:'2px 8px',borderRadius:'50px',fontFamily:"'Nunito',sans-serif",flexShrink:0}}>{group.batches.length} batches</span>}
                          </div>
                          <p style={{color:'#bbb',fontSize:'12px',fontWeight:700,margin:0,fontFamily:"'Nunito',sans-serif"}}>{group.totalQuantity} {group.unit} · {group.location}</p>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:'8px',flexShrink:0}}>
                          <span style={{color:expiryColor(d),fontWeight:800,fontSize:'12px',fontFamily:"'Nunito',sans-serif"}}>{expiryLabel(d)}</span>
                          <span style={{color:'#ccc',fontSize:'16px'}}>{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      </div>

                      {isExpanded && (
                        <div style={{borderTop:'1px solid #f5f5f5',padding:'12px 16px',background:'#fffaf7'}}>
                          {hasBatches ? (
                            <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
                              {group.batches.map((batch, bi) => {
                                const bd = daysLeft(batch.expiry_date)
                                const isEditingBatch = editingItem?.id === batch.id
                                return (
                                  <div key={batch.id} style={{background:'white',borderRadius:'10px',padding:'10px 12px',border:'1px solid #f0f0f0'}}>
                                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
                                      <span style={{fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',color:'#555'}}>Batch {bi + 1} — {batch.quantity} {batch.unit}</span>
                                      <span style={{color:expiryColor(bd),fontWeight:800,fontSize:'12px',fontFamily:"'Nunito',sans-serif"}}>{expiryLabel(bd)}</span>
                                    </div>
                                    {isEditingBatch ? editForm() : actionButtons(batch)}
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <>
                              {editingItem?.id === group.batches[0].id ? editForm() : actionButtons(group.batches[0])}
                              {group.category && <span style={{background:'#fff5f0',color:'#ff7043',fontSize:'11px',fontWeight:700,padding:'3px 10px',borderRadius:'50px',fontFamily:"'Nunito',sans-serif"}}>{group.category}</span>}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
        ) : (
          sorted.length === 0
            ? <p style={{color:'#aaa',fontWeight:700,textAlign:'center',marginTop:'48px',fontFamily:"'Nunito',sans-serif"}}>No items found</p>
            : <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                {sorted.map((item) => {
                  const d = daysLeft(item.expiry_date)
                  const isExpanded = expandedId === item.id
                  const isEditing = editingItem?.id === item.id
                  return (
                    <div key={item.id} className="item-row" style={{background: item.location === 'household' ? '#f0f4ff' : 'white',borderRadius:'14px',boxShadow:'0 2px 10px rgba(0,0,0,0.07)',overflow:'hidden',border: item.location === 'household' ? '1.5px solid rgba(100,120,240,0.15)' : 'none'}}>
                      <div onClick={() => setExpandedId(isExpanded ? null : item.id)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',cursor:'pointer'}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                            <h3 style={{fontFamily:"'Fredoka One',cursive",fontSize:'17px',color:'#2d2d2d',margin:0,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{item.name}</h3>
                            {item.location === 'household' && <span style={{background:'rgba(100,120,240,0.1)',color:'#6478f0',fontSize:'11px',fontWeight:700,padding:'2px 8px',borderRadius:'50px',fontFamily:"'Nunito',sans-serif",flexShrink:0}}>🏠 household</span>}
                          </div>
                          <p style={{color:'#bbb',fontSize:'12px',fontWeight:700,margin:0,fontFamily:"'Nunito',sans-serif"}}>{item.quantity} {item.unit} · {item.location}</p>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:'8px',flexShrink:0}}>
                          <span style={{color:expiryColor(d),fontWeight:800,fontSize:'12px',fontFamily:"'Nunito',sans-serif"}}>{expiryLabel(d)}</span>
                          <span style={{color:'#ccc',fontSize:'16px'}}>{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      </div>
                      {isExpanded && (
                        <div style={{borderTop:'1px solid #f5f5f5',padding:'12px 16px',background:'#fffaf7'}}>
                          {isEditing ? editForm() : actionButtons(item)}
                          {item.category && <span style={{background:'#fff5f0',color:'#ff7043',fontSize:'11px',fontWeight:700,padding:'3px 10px',borderRadius:'50px',fontFamily:"'Nunito',sans-serif"}}>{item.category}</span>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
        )}

        <div style={{display:'flex',justifyContent:'center',gap:'24px',marginTop:'32px'}}>
          <a href="/spend" style={{color:'#ff7043',fontWeight:700,fontSize:'14px',textDecoration:'none',fontFamily:"'Nunito',sans-serif"}}>💳 Spend History</a>
        </div>
      </div>
    </main>
  )
}
