'use client'

import { useState, useRef } from 'react'
import { ReviewItem, StorageLocation } from '@/lib/types'
import { supabase } from '@/lib/supabase'
import { suggestLocation } from '@/lib/categoriser'

export default function Home() {
  const [step, setStep] = useState<'upload' | 'reviewing' | 'done'>('upload')
  const [loading, setLoading] = useState(false)
  const [retailer, setRetailer] = useState('')
  const [total, setTotal] = useState<number | null>(null)
  const [items, setItems] = useState<ReviewItem[]>([])
  const [preview, setPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [voiceExpiryListening, setVoiceExpiryListening]   = useState(false)
  const [voiceExpiryProcessing, setVoiceExpiryProcessing] = useState(false)
  const [voiceExpiryFilled, setVoiceExpiryFilled]         = useState<{ name: string; date: string }[]>([])
  const [voiceExpiryError, setVoiceExpiryError]           = useState<string | null>(null)

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
        ...item, id: String(i), selected: true,
        location: suggestLocation(item.normalized_name, item.category) as StorageLocation,
        expiry_date: null,
      })))
      setStep('reviewing')
    } catch (err) {
      alert('Something went wrong. Try again.')
    }
    setLoading(false)
  }

  function startVoiceExpiry() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setVoiceExpiryError("Voice input isn't supported in this browser. Try Chrome or Safari.")
      return
    }
    const recognition = new SR()
    recognition.lang = 'en-GB'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    let finalTranscript = ''
    let silenceTimer: ReturnType<typeof setTimeout> | null = null
    const absoluteTimer = setTimeout(() => recognition.stop(), 8000)

    setVoiceExpiryListening(true)
    setVoiceExpiryFilled([])
    setVoiceExpiryError(null)
    recognition.start()

    recognition.onresult = (e: any) => {
      if (silenceTimer) clearTimeout(silenceTimer)
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript + ' '
      }
      silenceTimer = setTimeout(() => recognition.stop(), 3000)
    }

    recognition.onerror = (e: any) => {
      if (e.error !== 'no-speech') {
        clearTimeout(absoluteTimer)
        if (silenceTimer) clearTimeout(silenceTimer)
        setVoiceExpiryListening(false)
        setVoiceExpiryError("Couldn't hear you — please try again.")
      }
    }

    recognition.onend = async () => {
      clearTimeout(absoluteTimer)
      if (silenceTimer) clearTimeout(silenceTimer)
      setVoiceExpiryListening(false)
      const transcript = finalTranscript.trim()
      if (!transcript) { setVoiceExpiryError('No speech detected — try again.'); return }
      setVoiceExpiryProcessing(true)
      try {
        const res = await fetch('/api/voice-expiry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript, items: items.map(i => i.normalized_name) }),
        })
        const result = await res.json()
        if (result.error) throw new Error(result.error)
        const filled: { name: string; date: string }[] = []
        const updated = [...items]
        for (const match of (result.matches || [])) {
          const matchName = match.item_name.toLowerCase()
          const idx = updated.findIndex(i =>
            i.normalized_name.toLowerCase() === matchName ||
            i.normalized_name.toLowerCase().includes(matchName) ||
            matchName.includes(i.normalized_name.toLowerCase())
          )
          if (idx !== -1 && match.expiry_date) {
            updated[idx] = { ...updated[idx], expiry_date: match.expiry_date }
            filled.push({ name: updated[idx].normalized_name, date: match.expiry_date })
          }
        }
        setItems(updated)
        if (filled.length > 0) setVoiceExpiryFilled(filled)
        else setVoiceExpiryError("Couldn't match any items — try again.")
      } catch {
        setVoiceExpiryError('Something went wrong. Please try again.')
      }
      setVoiceExpiryProcessing(false)
    }
  }

  async function handleSave() {
    const selected = items.filter((i) => i.selected)
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id ?? null
    const { data: receiptData, error: receiptError } = await supabase
      .from('receipts')
      .insert({ retailer_name: retailer, total: total, user_id: userId })
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
        quantity_original: item.quantity,
        unit: item.unit,
        location: item.location,
        category: item.category || null,
        expiry_date: item.expiry_date || null,
        receipt_item_id: receiptItems?.[i]?.id || null,
        retailer: retailer || null,
        source: 'receipt',
        status: 'active',
        user_id: userId,
      }))
    )
    if (inventoryError) { alert('Error saving to inventory: ' + inventoryError.message) } else { setStep('done') }
  }

  const warmStyle = {
    fontFamily: "'Nunito', sans-serif",
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #fdf6ec 0%, #fde8d0 50%, #fce4e4 100%)',
  }

  if (step === 'upload') {
    return (
      <main style={{...warmStyle, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'24px', position:'relative', overflow:'hidden'}}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');
          @keyframes float { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-10px)} }
          @keyframes pulse-ring { 0%{transform:scale(1);opacity:0.4} 100%{transform:scale(1.5);opacity:0} }
          .blob1{position:absolute;top:-80px;left:-80px;width:300px;height:300px;background:rgba(255,180,120,0.3);border-radius:60% 40% 70% 30% / 50% 60% 40% 70%;animation:float 6s ease-in-out infinite;}
          .blob2{position:absolute;bottom:-60px;right:-60px;width:250px;height:250px;background:rgba(255,150,150,0.25);border-radius:40% 60% 30% 70% / 60% 40% 70% 30%;animation:float 8s ease-in-out infinite reverse;}
          .pulse-ring{position:absolute;inset:-8px;border-radius:50px;border:3px solid rgba(255,112,67,0.5);animation:pulse-ring 2s ease-out infinite;}
          .nav-link{color:#aaa;font-size:14px;font-weight:700;text-decoration:none;transition:color 0.2s;font-family:'Nunito',sans-serif;}
          .nav-link:hover{color:#ff7043;}
          .feature-pill{background:white;border-radius:20px;padding:10px 18px;display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:#555;box-shadow:0 4px 12px rgba(0,0,0,0.08);}
        `}</style>
        <div className="blob1"/><div className="blob2"/>
        <div style={{position:'relative',zIndex:1,display:'flex',flexDirection:'column',alignItems:'center'}}>
          <div style={{fontSize:'72px',marginBottom:'8px',animation:'float 4s ease-in-out infinite'}}>🛒</div>
          <h1 style={{fontFamily:"'Fredoka One',cursive",fontSize:'52px',color:'#2d2d2d',margin:'0 0 8px',letterSpacing:'1px',lineHeight:1}}>ShelfSense</h1>
          <p style={{color:'#888',fontSize:'17px',fontWeight:700,margin:'0 0 32px',textAlign:'center',maxWidth:'300px',lineHeight:1.5,fontFamily:"'Nunito',sans-serif"}}>Snap your receipt. Track your food. Never waste again.</p>
          <div style={{display:'flex',gap:'10px',marginBottom:'40px',flexWrap:'wrap',justifyContent:'center'}}>
            <div className="feature-pill">📸 AI Scanning</div>
            <div className="feature-pill">⏰ Expiry Alerts</div>
            <div className="feature-pill">💰 Spend Tracking</div>
          </div>
          {preview && <img src={preview} alt="Receipt" style={{maxWidth:'180px',maxHeight:'160px',borderRadius:'16px',marginBottom:'24px',boxShadow:'0 8px 24px rgba(0,0,0,0.15)'}} />}
          <div style={{position:'relative',marginBottom:'16px'}}>
            <div className="pulse-ring"/>
            <label style={{background:'linear-gradient(135deg,#ff7043,#ff9a3c)',color:'white',fontFamily:"'Fredoka One',cursive",fontSize:'20px',padding:'18px 48px',borderRadius:'50px',cursor:'pointer',boxShadow:'0 8px 24px rgba(255,112,67,0.4)',letterSpacing:'0.5px',display:'inline-block',position:'relative'}}>
              {loading ? '✨ Scanning...' : '📷 Scan a Receipt'}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileChange}
                disabled={loading}
                style={{position:'absolute',inset:0,opacity:0,cursor:'pointer',width:'100%',height:'100%'}}
              />
            </label>
          </div>
          {loading && <p style={{color:'#ff7043',fontWeight:700,fontSize:'15px',fontFamily:"'Nunito',sans-serif"}}>AI is reading your receipt...</p>}
        </div>
      </main>
    )
  }

  if (step === 'reviewing') {
    return (
      <main style={{...warmStyle, padding:'72px 24px 32px'}}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');
          @keyframes voice-pulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.12);opacity:0.85} }
        `}</style>
        <div style={{maxWidth:'640px',margin:'0 auto'}}>
          <a href="/" style={{color:'#ff7043',fontWeight:700,fontSize:'14px',textDecoration:'none',fontFamily:"'Nunito',sans-serif"}}>← Back</a>
          <h1 style={{fontFamily:"'Fredoka One',cursive",fontSize:'36px',color:'#2d2d2d',margin:'8px 0 4px'}}>Review Items</h1>
          <p style={{color:'#888',fontWeight:700,fontSize:'15px',margin:'0 0 4px',fontFamily:"'Nunito',sans-serif"}}>From {retailer} — edit anything that looks wrong</p>
          {total && <p style={{color:'#ff7043',fontWeight:800,fontSize:'15px',margin:'0 0 12px',fontFamily:"'Nunito',sans-serif"}}>Total: £{total.toFixed(2)}</p>}

          {/* ── Voice expiry button ── */}
          <div style={{marginBottom:'20px'}}>
            <button
              onClick={startVoiceExpiry}
              disabled={voiceExpiryListening || voiceExpiryProcessing}
              style={{display:'flex',alignItems:'center',gap:'10px',background: voiceExpiryListening ? 'linear-gradient(135deg,#ff4444,#ff6b6b)' : 'linear-gradient(135deg,#ff7043,#ff9a3c)',color:'white',border:'none',borderRadius:'50px',padding:'11px 22px',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'14px',cursor: voiceExpiryListening || voiceExpiryProcessing ? 'default' : 'pointer',boxShadow: voiceExpiryListening ? '0 4px 16px rgba(255,68,68,0.45)' : '0 4px 16px rgba(255,112,67,0.4)',opacity: voiceExpiryProcessing ? 0.7 : 1}}
            >
              <span style={{fontSize:'18px',display:'inline-block',animation: voiceExpiryListening ? 'voice-pulse 0.9s ease-in-out infinite' : 'none'}}>🎤</span>
              {voiceExpiryListening ? 'Listening...' : voiceExpiryProcessing ? 'Understanding...' : 'Set expiry dates by voice'}
            </button>
            {!voiceExpiryListening && !voiceExpiryProcessing && voiceExpiryFilled.length === 0 && !voiceExpiryError && (
              <p style={{fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'12px',color:'#bbb',margin:'6px 0 0 4px'}}>e.g. "milk expires in 3 days, chicken is good until Sunday"</p>
            )}
            {/* Filled summary */}
            {voiceExpiryFilled.length > 0 && (
              <div style={{background:'#f0fff4',border:'1.5px solid rgba(76,175,80,0.25)',borderRadius:'12px',padding:'12px 14px',marginTop:'10px'}}>
                <p style={{fontFamily:"'Fredoka One',cursive",fontSize:'15px',color:'#388e3c',margin:'0 0 8px'}}>✅ Filled in {voiceExpiryFilled.length} expiry date{voiceExpiryFilled.length > 1 ? 's' : ''}:</p>
                {voiceExpiryFilled.map((f, i) => (
                  <p key={i} style={{fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',color:'#555',margin:'2px 0'}}>
                    {f.name} → {new Date(f.date).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'})}
                  </p>
                ))}
                <button onClick={() => setVoiceExpiryFilled([])} style={{marginTop:'8px',background:'transparent',border:'none',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'12px',color:'#aaa',cursor:'pointer',padding:0}}>Dismiss</button>
              </div>
            )}
            {/* Error */}
            {voiceExpiryError && !voiceExpiryListening && !voiceExpiryProcessing && (
              <div style={{background:'#fff0f0',border:'1.5px solid rgba(255,68,68,0.2)',borderRadius:'12px',padding:'10px 14px',marginTop:'10px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:'8px'}}>
                <p style={{fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'13px',color:'#ff4444',margin:0}}>😕 {voiceExpiryError}</p>
                <button onClick={() => setVoiceExpiryError(null)} style={{background:'transparent',border:'none',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'12px',color:'#aaa',cursor:'pointer',flexShrink:0}}>✕</button>
              </div>
            )}
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
            {items.map((item, index) => (
              <div key={item.id} style={{background:'white',borderRadius:'16px',padding:'16px',boxShadow:'0 4px 16px rgba(0,0,0,0.08)',border: item.confidence < 0.8 ? '2px solid #ffb347' : '2px solid transparent'}}>
                <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'10px'}}>
                  <input type="checkbox" checked={item.selected} onChange={(e) => { const updated = [...items]; updated[index].selected = e.target.checked; setItems(updated) }} style={{width:'20px',height:'20px',accentColor:'#ff7043'}} />
                  <input type="text" value={item.normalized_name} onChange={(e) => { const updated = [...items]; updated[index].normalized_name = e.target.value; setItems(updated) }} style={{flex:1,border:'2px solid #eee',borderRadius:'10px',padding:'8px 12px',fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:'15px',color:'#2d2d2d'}} />
                  {item.price != null && <span style={{color:'#ff7043',fontWeight:800,fontSize:'15px',fontFamily:"'Nunito',sans-serif"}}>£{item.price.toFixed(2)}</span>}
                  {item.confidence < 0.8 && <span style={{color:'#ff9800',fontSize:'12px',fontWeight:700,fontFamily:"'Nunito',sans-serif"}}>Low confidence</span>}
                </div>
                <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
                  <input type="number" value={item.quantity} onChange={(e) => { const updated = [...items]; updated[index].quantity = Number(e.target.value); setItems(updated) }} style={{width:'70px',border:'2px solid #eee',borderRadius:'10px',padding:'8px',fontFamily:"'Nunito',sans-serif",fontWeight:700}} />
                  <input type="text" value={item.unit} onChange={(e) => { const updated = [...items]; updated[index].unit = e.target.value; setItems(updated) }} style={{width:'70px',border:'2px solid #eee',borderRadius:'10px',padding:'8px',fontFamily:"'Nunito',sans-serif",fontWeight:700}} />
                  <select value={item.location} onChange={(e) => { const updated = [...items]; updated[index].location = e.target.value as StorageLocation; setItems(updated) }} style={{border:'2px solid #eee',borderRadius:'10px',padding:'8px',fontFamily:"'Nunito',sans-serif",fontWeight:700}}>
                    <option value="fridge">Fridge</option>
                    <option value="freezer">Freezer</option>
                    <option value="cupboard">Cupboard</option>
                    <option value="household">Household</option>
                    <option value="other">Other</option>
                  </select>
                  {item.location !== 'household' && (
                    <input type="date" value={item.expiry_date || ''} onChange={(e) => { const updated = [...items]; updated[index].expiry_date = e.target.value || null; setItems(updated) }} style={{border:'2px solid #eee',borderRadius:'10px',padding:'8px',fontFamily:"'Nunito',sans-serif",fontWeight:700}} />
                  )}
                </div>
              </div>
            ))}
          </div>
          <button onClick={handleSave} style={{marginTop:'24px',width:'100%',background:'linear-gradient(135deg,#ff7043,#ff9a3c)',color:'white',fontFamily:"'Fredoka One',cursive",fontSize:'20px',padding:'16px',borderRadius:'50px',border:'none',cursor:'pointer',boxShadow:'0 8px 24px rgba(255,112,67,0.4)'}}>
            Save {items.filter((i) => i.selected).length} Items to Inventory
          </button>
        </div>
      </main>
    )
  }

  return (
    <main style={{...warmStyle, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'24px'}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>
      <div style={{fontSize:'64px',marginBottom:'16px'}}>🎉</div>
      <h1 style={{fontFamily:"'Fredoka One',cursive",fontSize:'42px',color:'#2d2d2d',margin:'0 0 8px'}}>Items Saved!</h1>
      <p style={{color:'#888',fontWeight:700,fontSize:'16px',margin:'0 0 8px',fontFamily:"'Nunito',sans-serif"}}>{items.filter((i) => i.selected).length} items added to your inventory</p>
      {total && <p style={{color:'#ff7043',fontWeight:800,fontSize:'18px',margin:'0 0 32px',fontFamily:"'Nunito',sans-serif"}}>Total spend: £{total.toFixed(2)}</p>}
      <div style={{display:'flex',gap:'16px',flexWrap:'wrap',justifyContent:'center'}}>
        <button onClick={() => { setStep('upload'); setPreview(null) }} style={{background:'linear-gradient(135deg,#ff7043,#ff9a3c)',color:'white',fontFamily:"'Fredoka One',cursive",fontSize:'18px',padding:'14px 32px',borderRadius:'50px',border:'none',cursor:'pointer',boxShadow:'0 8px 24px rgba(255,112,67,0.4)'}}>
          Scan Another
        </button>
        <a href="/inventory" style={{background:'white',color:'#ff7043',fontFamily:"'Fredoka One',cursive",fontSize:'18px',padding:'14px 32px',borderRadius:'50px',textDecoration:'none',boxShadow:'0 4px 16px rgba(0,0,0,0.1)'}}>
          View Inventory
        </a>
      </div>
    </main>
  )
}
