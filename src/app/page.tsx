'use client'

import { useState } from 'react'
import { ReviewItem, StorageLocation } from '@/lib/types'
import { supabase } from '@/lib/supabase'

export default function Home() {
  const [step, setStep] = useState<'upload' | 'reviewing' | 'done'>('upload')
  const [loading, setLoading] = useState(false)
  const [retailer, setRetailer] = useState('')
  const [total, setTotal] = useState<number | null>(null)
  const [items, setItems] = useState<ReviewItem[]>([])
  const [preview, setPreview] = useState<string | null>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPreview(URL.createObjectURL(file))
    setLoading(true)
    const formData = new FormData()
    formData.append('receipt', file)
    try {
      const res = await fetch('/api/parse-receipt', { method: 'POST', body: formData })
      const result = await res.json()
      if (result.error) { alert('Error: ' + result.error); setLoading(false); return }
      setRetailer(result.retailer_name || 'Unknown Store')
      setTotal(result.total || null)
      setItems(result.items.map((item: any, i: number) => ({
        ...item, id: String(i), selected: true, location: 'fridge' as StorageLocation, expiry_date: null,
      })))
      setStep('reviewing')
    } catch (err) {
      alert('Something went wrong. Try again.')
    }
    setLoading(false)
  }

  async function handleSave() {
    const selected = items.filter((i) => i.selected)
    const { data: receiptData, error: receiptError } = await supabase
      .from('receipts')
      .insert({ retailer_name: retailer, total: total })
      .select()
      .single()
    if (receiptError) { alert('Error saving receipt: ' + receiptError.message); return }
    const receiptId = receiptData.id
    const { data: receiptItems, error: itemsError } = await supabase
      .from('receipt_items')
      .insert(selected.map((item) => ({
        receipt_id: receiptId,
        raw_text: item.name,
        normalized_name: item.normalized_name,
        quantity: item.quantity,
        unit: item.unit,
        category: item.category || null,
        confidence: item.confidence,
        price: item.price || null,
      })))
      .select()
    if (itemsError) { alert('Error saving items: ' + itemsError.message); return }
    const { error: inventoryError } = await supabase.from('inventory_items').insert(
      selected.map((item, i) => ({
        name: item.normalized_name,
        quantity: item.quantity,
        unit: item.unit,
        location: item.location,
        category: item.category || null,
        expiry_date: item.expiry_date || null,
        receipt_item_id: receiptItems?.[i]?.id || null,
        status: 'active',
      }))
    )
    if (inventoryError) { alert('Error saving to inventory: ' + inventoryError.message) } else { setStep('done') }
  }

  if (step === 'upload') {
    return (
      <main style={{minHeight:'100vh',background:'linear-gradient(135deg,#fdf6ec 0%,#fde8d0 50%,#fce4e4 100%)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'24px',fontFamily:"'Nunito',sans-serif",position:'relative',overflow:'hidden'}}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');
          @keyframes float { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-10px)} }
          @keyframes pulse-ring { 0%{transform:scale(1);opacity:0.4} 100%{transform:scale(1.5);opacity:0} }
          @keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
          .blob1{position:absolute;top:-80px;left:-80px;width:300px;height:300px;background:rgba(255,180,120,0.3);border-radius:60% 40% 70% 30% / 50% 60% 40% 70%;animation:float 6s ease-in-out infinite;}
          .blob2{position:absolute;bottom:-60px;right:-60px;width:250px;height:250px;background:rgba(255,150,150,0.25);border-radius:40% 60% 30% 70% / 60% 40% 70% 30%;animation:float 8s ease-in-out infinite reverse;}
          .blob3{position:absolute;top:40%;left:-40px;width:150px;height:150px;background:rgba(255,220,100,0.2);border-radius:50%;animation:float 7s ease-in-out infinite;}
          .upload-btn{background:linear-gradient(135deg,#ff7043,#ff9a3c);color:white;font-family:'Fredoka One',cursive;font-size:20px;padding:18px 48px;border-radius:50px;border:none;cursor:pointer;box-shadow:0 8px 24px rgba(255,112,67,0.4),0 2px 8px rgba(0,0,0,0.1);transition:all 0.2s ease;display:inline-block;letter-spacing:0.5px;}
          .upload-btn:hover{transform:translateY(-3px) scale(1.03);box-shadow:0 12px 32px rgba(255,112,67,0.5),0 4px 12px rgba(0,0,0,0.15);}
          .pulse-ring{position:absolute;inset:-8px;border-radius:50px;border:3px solid rgba(255,112,67,0.5);animation:pulse-ring 2s ease-out infinite;}
          .feature-pill{background:white;border-radius:20px;padding:10px 18px;display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:#555;box-shadow:0 4px 12px rgba(0,0,0,0.08);animation:fadeUp 0.6s ease forwards;}
          .nav-link{color:#999;font-size:14px;font-weight:600;text-decoration:none;transition:color 0.2s;}
          .nav-link:hover{color:#ff7043;}
        `}</style>
        <div className="blob1"/><div className="blob2"/><div className="blob3"/>
        <div style={{position:'relative',zIndex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:'0'}}>
          <div style={{fontSize:'72px',marginBottom:'8px',animation:'float 4s ease-in-out infinite'}}>🛒</div>
          <h1 style={{fontFamily:"'Fredoka One',cursive",fontSize:'52px',color:'#2d2d2d',margin:'0 0 8px',letterSpacing:'1px',lineHeight:1}}>ShelfSense</h1>
          <p style={{color:'#888',fontSize:'17px',fontWeight:600,margin:'0 0 32px',textAlign:'center',maxWidth:'300px',lineHeight:1.5}}>Snap your receipt. Track your food. Never waste again.</p>
          <div style={{display:'flex',gap:'10px',marginBottom:'40px',flexWrap:'wrap',justifyContent:'center'}}>
            <div className="feature-pill" style={{animationDelay:'0.1s'}}>📸 AI Receipt Scanning</div>
            <div className="feature-pill" style={{animationDelay:'0.2s'}}>⏰ Expiry Tracking</div>
            <div className="feature-pill" style={{animationDelay:'0.3s'}}>💰 Spend History</div>
          </div>
          {preview && <img src={preview} alt="Receipt preview" style={{maxWidth:'200px',maxHeight:'180px',borderRadius:'16px',marginBottom:'24px',boxShadow:'0 8px 24px rgba(0,0,0,0.15)'}} />}
          <div style={{position:'relative',marginBottom:'12px'}}>
            <div className="pulse-ring"/>
            <label className="upload-btn">
              {loading ? '✨ Scanning...' : '📷 Scan a Receipt'}
              <input type="file" accept="image/*" capture="environment" onChange={handleFileChange} disabled={loading} style={{display:'none'}} />
            </label>
          </div>
          {loading && <p style={{color:'#ff7043',fontWeight:700,fontSize:'15px',marginTop:'12px',animation:'fadeUp 0.3s ease'}}>AI is reading your receipt...</p>}
          <div style={{display:'flex',gap:'24px',marginTop:'40px'}}>
            <a href="/inventory" className="nav-link">📦 Inventory</a>
            <a href="/spend" className="nav-link">💳 Spend History</a>
          </div>
        </div>
      </main>
    )
  }

  if (step === 'reviewing') {
    return (
      <main className="min-h-screen bg-gray-950 text-white p-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-1">Review Items</h1>
        <p className="text-gray-400 mb-1">From {retailer} - edit anything that looks wrong</p>
        {total && <p className="text-emerald-400 text-sm mb-6">Total: £{total.toFixed(2)}</p>}
        <div className="space-y-3">
          {items.map((item, index) => (
            <div key={item.id} className={'bg-gray-900 border rounded-lg p-4 ' + (item.confidence < 0.8 ? 'border-yellow-600' : 'border-gray-800')}>
              <div className="flex items-center gap-3 mb-3">
                <input type="checkbox" checked={item.selected} onChange={(e) => { const updated = [...items]; updated[index].selected = e.target.checked; setItems(updated) }} className="w-5 h-5 accent-emerald-500" />
                <input type="text" value={item.normalized_name} onChange={(e) => { const updated = [...items]; updated[index].normalized_name = e.target.value; setItems(updated) }} className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 flex-1 text-white" />
                {item.price != null && <span className="text-gray-400 text-sm">£{item.price.toFixed(2)}</span>}
                {item.confidence < 0.8 && <span className="text-yellow-500 text-xs">Low confidence</span>}
              </div>
              <div className="flex gap-2 flex-wrap">
                <input type="number" value={item.quantity} onChange={(e) => { const updated = [...items]; updated[index].quantity = Number(e.target.value); setItems(updated) }} className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 w-20 text-white" />
                <input type="text" value={item.unit} onChange={(e) => { const updated = [...items]; updated[index].unit = e.target.value; setItems(updated) }} className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 w-20 text-white" />
                <select value={item.location} onChange={(e) => { const updated = [...items]; updated[index].location = e.target.value as StorageLocation; setItems(updated) }} className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-white">
                  <option value="fridge">Fridge</option>
                  <option value="freezer">Freezer</option>
                  <option value="cupboard">Cupboard</option>
                  <option value="other">Other</option>
                </select>
                <input type="date" value={item.expiry_date || ''} onChange={(e) => { const updated = [...items]; updated[index].expiry_date = e.target.value || null; setItems(updated) }} className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-white" />
              </div>
            </div>
          ))}
        </div>
        <button onClick={handleSave} className="mt-6 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-lg text-lg transition-colors">
          Save {items.filter((i) => i.selected).length} Items to Inventory
        </button>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6">
      <h1 className="text-3xl font-bold mb-2">Items Saved!</h1>
      <p className="text-gray-400 mb-2">{items.filter((i) => i.selected).length} items added to your inventory</p>
      {total && <p className="text-emerald-400 mb-6">Total spend: £{total.toFixed(2)}</p>}
      <div className="flex gap-4">
        <button onClick={() => { setStep('upload'); setPreview(null) }} className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 px-8 rounded-lg transition-colors">
          Scan Another
        </button>
        <a href="/inventory" className="bg-gray-800 hover:bg-gray-700 text-white font-semibold py-3 px-8 rounded-lg transition-colors">
          View Inventory
        </a>
      </div>
    </main>
  )
}
