'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type ReceiptRow = {
  id: string
  retailer_name: string | null
  total: number | null
  created_at: string
  receipt_items: {
    normalized_name: string
    category: string | null
    price: number | null
  }[]
}

export default function SpendPage() {
  const [receipts, setReceipts] = useState<ReceiptRow[]>([])
  const [loading, setLoading] = useState(true)
  const [retailerFilter, setRetailerFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [monthFilter, setMonthFilter] = useState('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('receipts')
        .select('id, retailer_name, total, created_at, receipt_items(normalized_name, category, price)')
        .order('created_at', { ascending: false })
      if (error) { alert('Error: ' + error.message) } else { setReceipts(data || []) }
      setLoading(false)
    }
    load()
  }, [])

  const retailers = ['all', ...Array.from(new Set(receipts.map(r => r.retailer_name || 'Unknown')))]
  const categories = ['all', ...Array.from(new Set(receipts.flatMap(r => r.receipt_items.map(i => i.category || 'other'))))]
  const months = ['all', ...Array.from(new Set(receipts.map(r => r.created_at.slice(0, 7)))).sort().reverse()]

  const filtered = receipts.filter((r) => {
    if (retailerFilter !== 'all' && (r.retailer_name || 'Unknown') !== retailerFilter) return false
    if (monthFilter !== 'all' && r.created_at.slice(0, 7) !== monthFilter) return false
    if (startDate && r.created_at < startDate) return false
    if (endDate && r.created_at > endDate + 'T23:59:59') return false
    if (categoryFilter !== 'all') {
      const hasCategory = r.receipt_items.some(i => (i.category || 'other') === categoryFilter)
      if (!hasCategory) return false
    }
    return true
  })

  const totalAllTime = receipts.reduce((sum, r) => sum + (r.total || 0), 0)
  const thisMonth = new Date().toISOString().slice(0, 7)
  const totalThisMonth = receipts.filter(r => r.created_at.slice(0, 7) === thisMonth).reduce((sum, r) => sum + (r.total || 0), 0)
  const filteredTotal = filtered.reduce((sum, r) => sum + (r.total || 0), 0)

  const warmStyle = {
    fontFamily: "'Nunito', sans-serif",
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #fdf6ec 0%, #fde8d0 50%, #fce4e4 100%)',
    padding: '72px 24px 32px',
  }

  const selectStyle = {
    border: '2px solid #eee',
    borderRadius: '10px',
    padding: '8px 12px',
    fontFamily: "'Nunito', sans-serif",
    fontWeight: 700 as const,
    fontSize: '13px',
    color: '#555',
    background: 'white',
    flex: 1,
    minWidth: '120px',
  }

  if (loading) {
    return (
      <main style={{...warmStyle, display:'flex', alignItems:'center', justifyContent:'center'}}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>
        <p style={{fontFamily:"'Fredoka One',cursive",fontSize:'24px',color:'#ff7043'}}>Loading spend data...</p>
      </main>
    )
  }

  return (
    <main style={warmStyle}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>
      <div style={{maxWidth:'640px',margin:'0 auto'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'24px'}}>
          <h1 style={{fontFamily:"'Fredoka One',cursive",fontSize:'36px',color:'#2d2d2d',margin:0}}>Spend History</h1>
          <a href="/" style={{color:'#ff7043',fontWeight:700,fontSize:'14px',textDecoration:'none',fontFamily:"'Nunito',sans-serif"}}>← Back</a>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginBottom:'24px'}}>
          <div style={{background:'white',borderRadius:'16px',padding:'20px',boxShadow:'0 4px 16px rgba(0,0,0,0.08)'}}>
            <p style={{color:'#aaa',fontWeight:700,fontSize:'13px',margin:'0 0 4px',fontFamily:"'Nunito',sans-serif"}}>This Month</p>
            <p style={{fontFamily:"'Fredoka One',cursive",fontSize:'32px',color:'#ff7043',margin:0}}>£{totalThisMonth.toFixed(2)}</p>
          </div>
          <div style={{background:'white',borderRadius:'16px',padding:'20px',boxShadow:'0 4px 16px rgba(0,0,0,0.08)'}}>
            <p style={{color:'#aaa',fontWeight:700,fontSize:'13px',margin:'0 0 4px',fontFamily:"'Nunito',sans-serif"}}>All Time</p>
            <p style={{fontFamily:"'Fredoka One',cursive",fontSize:'32px',color:'#ff7043',margin:0}}>£{totalAllTime.toFixed(2)}</p>
          </div>
        </div>
        <div style={{background:'white',borderRadius:'16px',padding:'16px',boxShadow:'0 4px 16px rgba(0,0,0,0.08)',marginBottom:'16px'}}>
          <div style={{display:'flex',gap:'8px',flexWrap:'wrap',marginBottom:'8px'}}>
            <select value={retailerFilter} onChange={e => setRetailerFilter(e.target.value)} style={selectStyle}>
              {retailers.map(r => <option key={r} value={r}>{r === 'all' ? 'All Retailers' : r}</option>)}
            </select>
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={selectStyle}>
              {categories.map(c => <option key={c} value={c}>{c === 'all' ? 'All Categories' : c}</option>)}
            </select>
            <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} style={selectStyle}>
              {months.map(m => <option key={m} value={m}>{m === 'all' ? 'All Months' : m}</option>)}
            </select>
          </div>
          <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={selectStyle} />
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={selectStyle} />
          </div>
        </div>
        {(retailerFilter !== 'all' || categoryFilter !== 'all' || monthFilter !== 'all' || startDate || endDate) && (
          <p style={{color:'#888',fontWeight:700,fontSize:'14px',margin:'0 0 16px',fontFamily:"'Nunito',sans-serif"}}>Filtered total: <span style={{color:'#ff7043',fontSize:'18px'}}>£{filteredTotal.toFixed(2)}</span></p>
        )}
        <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
          {filtered.length === 0
            ? <p style={{color:'#aaa',fontWeight:700,textAlign:'center',marginTop:'48px',fontFamily:"'Nunito',sans-serif"}}>No receipts found</p>
            : filtered.map(r => (
              <div key={r.id} style={{background:'white',borderRadius:'16px',padding:'16px',boxShadow:'0 4px 16px rgba(0,0,0,0.08)'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'8px'}}>
                  <div>
                    <h3 style={{fontFamily:"'Fredoka One',cursive",fontSize:'20px',color:'#2d2d2d',margin:'0 0 2px'}}>{r.retailer_name || 'Unknown Store'}</h3>
                    <p style={{color:'#aaa',fontWeight:700,fontSize:'13px',margin:0,fontFamily:"'Nunito',sans-serif"}}>{new Date(r.created_at).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'})}</p>
                  </div>
                  <span style={{fontFamily:"'Fredoka One',cursive",fontSize:'24px',color:'#ff7043'}}>{r.total != null ? '£' + r.total.toFixed(2) : '—'}</span>
                </div>
                <div style={{display:'flex',flexWrap:'wrap',gap:'6px',marginTop:'8px'}}>
                  {Array.from(new Set(r.receipt_items.map(i => i.category || 'other'))).map(cat => (
                    <span key={cat} style={{background:'#fff5f0',color:'#ff7043',fontSize:'12px',fontWeight:700,padding:'4px 10px',borderRadius:'50px',fontFamily:"'Nunito',sans-serif"}}>{cat}</span>
                  ))}
                </div>
                <p style={{color:'#ccc',fontSize:'12px',fontWeight:700,margin:'8px 0 0',fontFamily:"'Nunito',sans-serif"}}>{r.receipt_items.length} items</p>
              </div>
            ))
          }
        </div>
      </div>
    </main>
  )
}
