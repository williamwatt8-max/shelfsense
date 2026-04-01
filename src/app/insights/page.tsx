'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type InsightItem = {
  id: string
  name: string
  category: string | null
  status: string
  quantity: number
  unit: string
  purchase_date: string
  receipt_item_id: string | null
  price: number | null
}

type ItemStat = {
  name: string
  category: string | null
  usedCount: number
  wastedCount: number
  usedValue: number
  wastedValue: number
}

export default function InsightsPage() {
  const [items, setItems] = useState<InsightItem[]>([])
  const [loading, setLoading] = useState(true)
  const [monthFilter, setMonthFilter] = useState('all')

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('id, name, category, status, quantity, unit, purchase_date, receipt_item_id, receipt_items(price)')
        .in('status', ['used', 'discarded', 'expired'])
        .order('purchase_date', { ascending: false })
      if (error) { alert('Error: ' + error.message); setLoading(false); return }
      const mapped = (data || []).map((item: any) => ({
        ...item,
        price: item.receipt_items?.price || null,
      }))
      setItems(mapped)
      setLoading(false)
    }
    load()
  }, [])

  const months = ['all', ...Array.from(new Set(items.map(i => i.purchase_date?.slice(0, 7)).filter(Boolean))).sort().reverse()]

  const filtered = items.filter(i => {
    if (monthFilter === 'all') return true
    return i.purchase_date?.slice(0, 7) === monthFilter
  })

  const used = filtered.filter(i => i.status === 'used')
  const wasted = filtered.filter(i => i.status === 'discarded' || i.status === 'expired')

  const usedValue = used.reduce((sum, i) => sum + (i.price || 0), 0)
  const wastedValue = wasted.reduce((sum, i) => sum + (i.price || 0), 0)
  const totalValue = usedValue + wastedValue
  const wasteRate = totalValue > 0 ? Math.round((wastedValue / totalValue) * 100) : 0

  const itemStats = new Map<string, ItemStat>()
  for (const item of filtered) {
    const key = item.name.toLowerCase().trim()
    if (!itemStats.has(key)) {
      itemStats.set(key, { name: item.name, category: item.category, usedCount: 0, wastedCount: 0, usedValue: 0, wastedValue: 0 })
    }
    const stat = itemStats.get(key)!
    if (item.status === 'used') {
      stat.usedCount++
      stat.usedValue += item.price || 0
    } else {
      stat.wastedCount++
      stat.wastedValue += item.price || 0
    }
  }

  const allStats = Array.from(itemStats.values())
  const topWasted = [...allStats].filter(s => s.wastedCount > 0).sort((a, b) => b.wastedCount - a.wastedCount).slice(0, 5)
  const topUsed = [...allStats].filter(s => s.usedCount > 0).sort((a, b) => b.usedCount - a.usedCount).slice(0, 5)
  const topWastedByValue = [...allStats].filter(s => s.wastedValue > 0).sort((a, b) => b.wastedValue - a.wastedValue).slice(0, 5)

  const categoryWaste = new Map<string, number>()
  for (const item of wasted) {
    const cat = item.category || 'other'
    categoryWaste.set(cat, (categoryWaste.get(cat) || 0) + 1)
  }
  const topWasteCategories = Array.from(categoryWaste.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)

  const warmStyle = {
    fontFamily: "'Nunito', sans-serif",
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #fdf6ec 0%, #fde8d0 50%, #fce4e4 100%)',
    padding: '72px 24px 32px',
  }

  const cardStyle = {
    background: 'white',
    borderRadius: '16px',
    padding: '20px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
  }

  const selectStyle = {
    border: '2px solid #eee',
    borderRadius: '50px',
    padding: '6px 14px',
    fontFamily: "'Nunito', sans-serif",
    fontWeight: 700 as const,
    fontSize: '13px',
    color: '#555',
    background: 'white',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  }

  if (loading) {
    return (
      <main style={{...warmStyle, display:'flex', alignItems:'center', justifyContent:'center'}}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>
        <p style={{fontFamily:"'Fredoka One',cursive",fontSize:'24px',color:'#ff7043'}}>Loading insights...</p>
      </main>
    )
  }

  return (
    <main style={warmStyle}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>
      <div style={{maxWidth:'640px',margin:'0 auto'}}>

        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'24px'}}>
          <div>
            <h1 style={{fontFamily:"'Fredoka One',cursive",fontSize:'36px',color:'#2d2d2d',margin:0}}>Insights</h1>
            <p style={{color:'#aaa',fontWeight:700,fontSize:'13px',margin:0}}>{filtered.length} items analysed</p>
          </div>
          <a href="/" style={{color:'#ff7043',fontWeight:700,fontSize:'14px',textDecoration:'none',fontFamily:"'Nunito',sans-serif"}}>← Back</a>
        </div>

        <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'24px'}}>
          <span style={{color:'#aaa',fontWeight:700,fontSize:'13px',fontFamily:"'Nunito',sans-serif"}}>Period:</span>
          <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} style={selectStyle}>
            {months.map(m => <option key={m} value={m}>{m === 'all' ? 'All Time' : m}</option>)}
          </select>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginBottom:'16px'}}>
          <div style={cardStyle}>
            <p style={{color:'#aaa',fontWeight:700,fontSize:'12px',margin:'0 0 4px',fontFamily:"'Nunito',sans-serif"}}>✅ Used Up</p>
            <p style={{fontFamily:"'Fredoka One',cursive",fontSize:'28px',color:'#4caf50',margin:'0 0 2px'}}>{used.length}</p>
            <p style={{fontFamily:"'Fredoka One',cursive",fontSize:'18px',color:'#4caf50',margin:0}}>£{usedValue.toFixed(2)}</p>
          </div>
          <div style={cardStyle}>
            <p style={{color:'#aaa',fontWeight:700,fontSize:'12px',margin:'0 0 4px',fontFamily:"'Nunito',sans-serif"}}>🗑️ Wasted</p>
            <p style={{fontFamily:"'Fredoka One',cursive",fontSize:'28px',color:'#ff4444',margin:'0 0 2px'}}>{wasted.length}</p>
            <p style={{fontFamily:"'Fredoka One',cursive",fontSize:'18px',color:'#ff4444',margin:0}}>£{wastedValue.toFixed(2)}</p>
          </div>
        </div>

        <div style={{...cardStyle, marginBottom:'24px'}}>
          <p style={{color:'#aaa',fontWeight:700,fontSize:'12px',margin:'0 0 8px',fontFamily:"'Nunito',sans-serif"}}>WASTE RATE</p>
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            <div style={{flex:1,background:'#f5f5f5',borderRadius:'50px',height:'12px',overflow:'hidden'}}>
              <div style={{width:`${wasteRate}%`,height:'100%',background: wasteRate > 30 ? 'linear-gradient(135deg,#ff4444,#ff7043)' : wasteRate > 15 ? 'linear-gradient(135deg,#ff9800,#ffb347)' : 'linear-gradient(135deg,#4caf50,#81c784)',borderRadius:'50px',transition:'width 0.5s ease'}} />
            </div>
            <span style={{fontFamily:"'Fredoka One',cursive",fontSize:'22px',color: wasteRate > 30 ? '#ff4444' : wasteRate > 15 ? '#ff9800' : '#4caf50'}}>{wasteRate}%</span>
          </div>
          <p style={{color:'#bbb',fontWeight:700,fontSize:'12px',margin:'8px 0 0',fontFamily:"'Nunito',sans-serif"}}>
            {wasteRate === 0 ? 'No waste recorded yet' : wasteRate > 30 ? 'High waste — lots of room to improve!' : wasteRate > 15 ? 'Moderate waste — doing ok' : 'Low waste — great job!'}
          </p>
        </div>

        {topWasted.length > 0 && (
          <div style={{...cardStyle, marginBottom:'16px'}}>
            <p style={{fontFamily:"'Fredoka One',cursive",fontSize:'18px',color:'#2d2d2d',margin:'0 0 12px'}}>🗑️ Most Wasted Items</p>
            {topWasted.map((s, i) => (
              <div key={s.name} style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px 0',borderBottom: i < topWasted.length - 1 ? '1px solid #f5f5f5' : 'none'}}>
                <span style={{fontFamily:"'Fredoka One',cursive",fontSize:'18px',color:'#ffb347',minWidth:'24px'}}>{i + 1}</span>
                <div style={{flex:1}}>
                  <p style={{fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'14px',color:'#2d2d2d',margin:0}}>{s.name}</p>
                  {s.category && <p style={{fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'11px',color:'#ccc',margin:0}}>{s.category}</p>}
                </div>
                <span style={{fontFamily:"'Nunito',sans-serif",fontWeight:800,fontSize:'13px',color:'#ff4444'}}>{s.wastedCount}x</span>
                {s.wastedValue > 0 && <span style={{fontFamily:"'Nunito',sans-serif",fontWeight:800,fontSize:'13px',color:'#ff7043'}}>£{s.wastedValue.toFixed(2)}</span>}
              </div>
            ))}
          </div>
        )}

        {topWastedByValue.length > 0 && (
          <div style={{...cardStyle, marginBottom:'16px'}}>
            <p style={{fontFamily:"'Fredoka One',cursive",fontSize:'18px',color:'#2d2d2d',margin:'0 0 12px'}}>💸 Most Expensive Waste</p>
            {topWastedByValue.map((s, i) => (
              <div key={s.name} style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px 0',borderBottom: i < topWastedByValue.length - 1 ? '1px solid #f5f5f5' : 'none'}}>
                <span style={{fontFamily:"'Fredoka One',cursive",fontSize:'18px',color:'#ffb347',minWidth:'24px'}}>{i + 1}</span>
                <div style={{flex:1}}>
                  <p style={{fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'14px',color:'#2d2d2d',margin:0}}>{s.name}</p>
                  {s.category && <p style={{fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'11px',color:'#ccc',margin:0}}>{s.category}</p>}
                </div>
                <span style={{fontFamily:"'Nunito',sans-serif",fontWeight:800,fontSize:'13px',color:'#ff4444'}}>£{s.wastedValue.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}

        {topUsed.length > 0 && (
          <div style={{...cardStyle, marginBottom:'16px'}}>
            <p style={{fontFamily:"'Fredoka One',cursive",fontSize:'18px',color:'#2d2d2d',margin:'0 0 12px'}}>✅ Most Used Items</p>
            {topUsed.map((s, i) => (
              <div key={s.name} style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px 0',borderBottom: i < topUsed.length - 1 ? '1px solid #f5f5f5' : 'none'}}>
                <span style={{fontFamily:"'Fredoka One',cursive",fontSize:'18px',color:'#ffb347',minWidth:'24px'}}>{i + 1}</span>
                <div style={{flex:1}}>
                  <p style={{fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'14px',color:'#2d2d2d',margin:0}}>{s.name}</p>
                  {s.category && <p style={{fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'11px',color:'#ccc',margin:0}}>{s.category}</p>}
                </div>
                <span style={{fontFamily:"'Nunito',sans-serif",fontWeight:800,fontSize:'13px',color:'#4caf50'}}>{s.usedCount}x</span>
              </div>
            ))}
          </div>
        )}

        {topWasteCategories.length > 0 && (
          <div style={{...cardStyle, marginBottom:'24px'}}>
            <p style={{fontFamily:"'Fredoka One',cursive",fontSize:'18px',color:'#2d2d2d',margin:'0 0 12px'}}>📦 Most Wasted Categories</p>
            {topWasteCategories.map(([cat, count], i) => (
              <div key={cat} style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px 0',borderBottom: i < topWasteCategories.length - 1 ? '1px solid #f5f5f5' : 'none'}}>
                <span style={{fontFamily:"'Fredoka One',cursive",fontSize:'18px',color:'#ffb347',minWidth:'24px'}}>{i + 1}</span>
                <p style={{fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'14px',color:'#2d2d2d',margin:0,flex:1}}>{cat}</p>
                <span style={{fontFamily:"'Nunito',sans-serif",fontWeight:800,fontSize:'13px',color:'#ff4444'}}>{count}x wasted</span>
              </div>
            ))}
          </div>
        )}

        {filtered.length === 0 && (
          <div style={{...cardStyle, textAlign:'center', padding:'40px'}}>
            <p style={{fontSize:'48px',margin:'0 0 12px'}}>📊</p>
            <p style={{fontFamily:"'Fredoka One',cursive",fontSize:'22px',color:'#2d2d2d',margin:'0 0 8px'}}>No data yet</p>
            <p style={{fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'14px',color:'#aaa',margin:0}}>Start marking items as used or discarded to see insights here</p>
          </div>
        )}

        <div style={{display:'flex',justifyContent:'center',gap:'24px',marginTop:'16px'}}>
          <a href="/spend" style={{color:'#ff7043',fontWeight:700,fontSize:'14px',textDecoration:'none',fontFamily:"'Nunito',sans-serif"}}>💳 Spend History</a>
          <a href="/inventory" style={{color:'#ff7043',fontWeight:700,fontSize:'14px',textDecoration:'none',fontFamily:"'Nunito',sans-serif"}}>📦 Inventory</a>
        </div>
      </div>
    </main>
  )
}
