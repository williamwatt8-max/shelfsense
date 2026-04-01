'use client'

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { InventoryItem } from '@/lib/types'
import { differenceInDays } from 'date-fns'

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [filter, setFilter] = useState<string>('all')
  const [loading, setLoading] = useState(true)

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
    if (d === null) return 'No expiry set'
    if (d < 0) return 'Expired'
    if (d === 0) return 'Expires today'
    if (d === 1) return 'Expires tomorrow'
    return d + ' days left'
  }

  function expiryColor(d: number | null): string {
    if (d === null) return '#aaa'
    if (d <= 1) return '#ff4444'
    if (d <= 3) return '#ff9800'
    if (d <= 7) return '#ffb347'
    return '#4caf50'
  }

  async function markUsed(id: string) {
    await supabase.from('inventory_items').update({ status: 'used' }).eq('id', id)
    await supabase.from('inventory_events').insert({ inventory_item_id: id, type: 'used' })
    loadItems()
  }

  async function markDiscarded(id: string) {
    await supabase.from('inventory_items').update({ status: 'discarded' }).eq('id', id)
    await supabase.from('inventory_events').insert({ inventory_item_id: id, type: 'discarded' })
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

  const warmStyle = {
    fontFamily: "'Nunito', sans-serif",
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #fdf6ec 0%, #fde8d0 50%, #fce4e4 100%)',
    padding: '24px',
  }

  const filters = ['all', 'fridge', 'freezer', 'cupboard', 'expiring']

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
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>
      <div style={{maxWidth:'640px',margin:'0 auto'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'24px'}}>
          <div>
            <h1 style={{fontFamily:"'Fredoka One',cursive",fontSize:'36px',color:'#2d2d2d',margin:0}}>Your Inventory</h1>
            <p style={{color:'#aaa',fontWeight:700,fontSize:'14px',margin:0}}>{items.length} items tracked</p>
          </div>
          <a href="/" style={{background:'linear-gradient(135deg,#ff7043,#ff9a3c)',color:'white',fontFamily:"'Fredoka One',cursive",fontSize:'16px',padding:'10px 20px',borderRadius:'50px',textDecoration:'none',boxShadow:'0 4px 16px rgba(255,112,67,0.4)'}}>
            + Scan Receipt
          </a>
        </div>
        <div style={{display:'flex',gap:'8px',marginBottom:'24px',flexWrap:'wrap'}}>
          {filters.map((f) => (
            <button key={f} onClick={() => setFilter(f)} style={{padding:'8px 16px',borderRadius:'50px',border:'none',cursor:'pointer',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',background: filter === f ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : 'white',color: filter === f ? 'white' : '#888',boxShadow: filter === f ? '0 4px 12px rgba(255,112,67,0.4)' : '0 2px 8px rgba(0,0,0,0.08)'}}>
              {f === 'all' ? 'All' : f === 'expiring' ? 'Expiring Soon' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        {filtered.length === 0
          ? <p style={{color:'#aaa',fontWeight:700,textAlign:'center',marginTop:'48px',fontFamily:"'Nunito',sans-serif"}}>No items found</p>
          : <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
              {filtered.map((item) => {
                const d = daysLeft(item.expiry_date)
                return (
                  <div key={item.id} style={{background:'white',borderRadius:'16px',padding:'16px',boxShadow:'0 4px 16px rgba(0,0,0,0.08)'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'10px'}}>
                      <div>
                        <h3 style={{fontFamily:"'Fredoka One',cursive",fontSize:'20px',color:'#2d2d2d',margin:'0 0 2px'}}>{item.name}</h3>
                        <p style={{color:'#aaa',fontSize:'13px',fontWeight:700,margin:0,fontFamily:"'Nunito',sans-serif"}}>{item.quantity} {item.unit} · {item.location}</p>
                      </div>
                      <span style={{color:expiryColor(d),fontWeight:800,fontSize:'13px',fontFamily:"'Nunito',sans-serif",textAlign:'right'}}>{expiryLabel(d)}</span>
                    </div>
                    <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
                      <button onClick={() => markUsed(item.id)} style={{background:'#f5f5f5',border:'none',borderRadius:'50px',padding:'6px 14px',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',cursor:'pointer',color:'#555'}}>Used up</button>
                      <button onClick={() => markDiscarded(item.id)} style={{background:'#fff0f0',border:'none',borderRadius:'50px',padding:'6px 14px',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',cursor:'pointer',color:'#ff4444'}}>Discard</button>
                      <select value={item.location} onChange={(e) => changeLocation(item.id, e.target.value)} style={{border:'2px solid #eee',borderRadius:'50px',padding:'6px 12px',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',color:'#555'}}>
                        <option value="fridge">Fridge</option>
                        <option value="freezer">Freezer</option>
                        <option value="cupboard">Cupboard</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                  </div>
                )
              })}
            </div>
        }
        <div style={{display:'flex',justifyContent:'center',gap:'24px',marginTop:'40px'}}>
          <a href="/spend" style={{color:'#ff7043',fontWeight:700,fontSize:'14px',textDecoration:'none',fontFamily:"'Nunito',sans-serif"}}>💳 Spend History</a>
        </div>
      </div>
    </main>
  )
}
