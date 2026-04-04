'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { suggestLocation } from '@/lib/categoriser'
import { StorageLocation } from '@/lib/types'

type Mode = 'manual' | 'voice' | 'barcode'

type ItemForm = {
  name: string
  itemCount: string      // number of individual units (e.g. "6" for a 6-pack)
  amountPerUnit: string  // size of each unit (e.g. "330" for 330ml cans)
  quantity: string
  quantityOriginal: string
  unit: string
  location: StorageLocation
  category: string
  expiryDate: string
  retailer: string
  purchaseDate: string
  opened: boolean
  openedAt: string
}

const UNITS = ['item', 'g', 'kg', 'ml', 'l', 'bottle', 'tin', 'loaf', 'pack', 'bag', 'head', 'fillet']
const CATEGORIES = ['dairy', 'meat', 'fish', 'vegetables', 'fruit', 'bakery', 'tinned', 'dry goods', 'oils', 'frozen', 'drinks', 'snacks', 'alcohol', 'household', 'other']
const LOCATIONS: { value: StorageLocation; label: string }[] = [
  { value: 'fridge',     label: '❄️ Fridge'     },
  { value: 'freezer',    label: '🧊 Freezer'    },
  { value: 'cupboard',   label: '🗄️ Cupboard'   },
  { value: 'household',  label: '🏠 Household'  },
  { value: 'other',      label: '📦 Other'      },
]

const blankForm = (): ItemForm => ({
  name: '', itemCount: '1', amountPerUnit: '', quantity: '1', quantityOriginal: '1', unit: 'item',
  location: 'cupboard', category: '', expiryDate: '',
  retailer: '', purchaseDate: '', opened: false, openedAt: '',
})

export default function AddPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('manual')
  const [form, setForm] = useState<ItemForm>(blankForm())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Voice state
  const [voiceListening, setVoiceListening] = useState(false)
  const [voiceProcessing, setVoiceProcessing] = useState(false)
  const [voiceTranscript, setVoiceTranscript] = useState('')
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [voiceFilled, setVoiceFilled] = useState(false)

  // Barcode state
  const [barcodeInput, setBarcodeInput] = useState('')
  const [barcodeSearching, setBarcodeSearching] = useState(false)
  const [barcodeError, setBarcodeError] = useState<string | null>(null)
  const [barcodeFound, setBarcodeFound] = useState<string | null>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraSupported, setCameraSupported] = useState<boolean | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Check BarcodeDetector support
    setCameraSupported(typeof window !== 'undefined' && 'BarcodeDetector' in window)
    return () => stopCamera()
  }, [])

  function updateForm(patch: Partial<ItemForm>) {
    setForm(prev => ({ ...prev, ...patch }))
  }

  function autoFillLocation(name: string, category: string) {
    const loc = suggestLocation(name, category)
    updateForm({ location: loc })
  }

  // ── Voice add ──────────────────────────────────────────────────────────────

  function startVoice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setVoiceError("Voice input isn't supported in this browser. Try Chrome.")
      return
    }
    const recognition = new SR()
    recognition.lang = 'en-GB'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    let finalTranscript = ''
    let silenceTimer: ReturnType<typeof setTimeout> | null = null
    const absoluteTimer = setTimeout(() => recognition.stop(), 10000)

    setVoiceListening(true)
    setVoiceError(null)
    setVoiceFilled(false)
    setVoiceTranscript('')
    recognition.start()

    recognition.onresult = (e: any) => {
      if (silenceTimer) clearTimeout(silenceTimer)
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript + ' '
      }
      setVoiceTranscript(finalTranscript.trim())
      silenceTimer = setTimeout(() => recognition.stop(), 2500)
    }

    recognition.onerror = (e: any) => {
      if (e.error !== 'no-speech') {
        clearTimeout(absoluteTimer)
        if (silenceTimer) clearTimeout(silenceTimer)
        setVoiceListening(false)
        setVoiceError("Couldn't hear you — try again.")
      }
    }

    recognition.onend = async () => {
      clearTimeout(absoluteTimer)
      if (silenceTimer) clearTimeout(silenceTimer)
      setVoiceListening(false)
      const transcript = finalTranscript.trim()
      if (!transcript) { setVoiceError('No speech detected — tap the mic and try again.'); return }
      setVoiceProcessing(true)
      try {
        const res = await fetch('/api/voice-add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript }),
        })
        const result = await res.json()
        if (result.error) throw new Error(result.error)
        applyVoiceResult(result)
      } catch {
        setVoiceError('Could not understand — try speaking more clearly.')
      }
      setVoiceProcessing(false)
    }
  }

  function applyVoiceResult(r: any) {
    setForm({
      name: r.name || '',
      itemCount: String(r.count ?? 1),
      amountPerUnit: r.amount_per_unit != null ? String(r.amount_per_unit) : '',
      quantity: String(r.quantity ?? 1),
      quantityOriginal: String(r.quantity_original ?? r.quantity ?? 1),
      unit: r.unit || 'item',
      location: (r.location as StorageLocation) || suggestLocation(r.name || '', r.category || ''),
      category: r.category || '',
      expiryDate: r.expiry_date || '',
      retailer: r.retailer || '',
      purchaseDate: '',
      opened: !!r.opened_at,
      openedAt: r.opened_at || '',
    })
    setVoiceFilled(true)
  }

  // ── Barcode ────────────────────────────────────────────────────────────────

  async function startCamera() {
    const BarcodeDetector = (window as any).BarcodeDetector
    if (!BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      setCameraSupported(false)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      setCameraActive(true)
      setBarcodeError(null)
      // Give video element time to mount
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
      }, 100)
      const detector = new BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'],
      })
      scanIntervalRef.current = setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) return
        try {
          const barcodes = await detector.detect(videoRef.current)
          if (barcodes.length > 0) {
            stopCamera()
            lookupBarcode(barcodes[0].rawValue)
          }
        } catch {}
      }, 600)
    } catch {
      setBarcodeError("Couldn't access camera — enter barcode manually below.")
      setCameraActive(false)
    }
  }

  function stopCamera() {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    if (scanIntervalRef.current) { clearInterval(scanIntervalRef.current); scanIntervalRef.current = null }
    setCameraActive(false)
  }

  async function lookupBarcode(code: string) {
    if (!code.trim()) return
    setBarcodeSearching(true)
    setBarcodeError(null)
    setBarcodeFound(null)
    try {
      const res = await fetch('/api/barcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: code.trim() }),
      })
      const result = await res.json()
      if (result.found && result.name) {
        setBarcodeFound(result.name)
        setForm(prev => ({
          ...prev,
          name: result.name,
          itemCount: String(result.count ?? 1),
          amountPerUnit: result.amount_per_unit != null ? String(result.amount_per_unit) : '',
          quantity: String(result.quantity ?? 1),
          quantityOriginal: String(result.quantity ?? 1),
          unit: result.unit || 'item',
          category: result.category || '',
          location: suggestLocation(result.name, result.category || ''),
        }))
      } else {
        setBarcodeError(`Barcode ${code} not found in product database — fill in details manually.`)
      }
    } catch {
      setBarcodeError('Lookup failed — fill in details manually.')
    }
    setBarcodeSearching(false)
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id ?? null
    const qty = parseFloat(form.quantity) || 1
    const qtyOriginal = parseFloat(form.quantityOriginal) || qty
    const itemCount = parseInt(form.itemCount) || 1
    const amountPerUnit = form.amountPerUnit ? parseFloat(form.amountPerUnit) : null
    const { error } = await supabase.from('inventory_items').insert({
      name: form.name.trim(),
      count: itemCount > 1 ? itemCount : null,
      amount_per_unit: amountPerUnit,
      quantity: qty,
      quantity_original: qtyOriginal,
      unit: form.unit,
      location: form.location,
      category: form.category || null,
      expiry_date: form.expiryDate || null,
      retailer: form.retailer.trim() || null,
      purchase_date: form.purchaseDate || null,
      opened_at: (form.opened && form.openedAt) ? form.openedAt : null,
      receipt_item_id: null,
      source: mode,
      status: 'active',
      user_id: userId,
    })
    setSaving(false)
    if (error) { alert('Error saving: ' + error.message); return }
    setSaved(true)
  }

  function addAnother() {
    setForm(blankForm())
    setSaved(false)
    setVoiceTranscript('')
    setVoiceFilled(false)
    setBarcodeInput('')
    setBarcodeFound(null)
    setBarcodeError(null)
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  const warmStyle = {
    fontFamily: "'Nunito', sans-serif",
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #fdf6ec 0%, #fde8d0 50%, #fce4e4 100%)',
    padding: '72px 24px 40px',
  }
  const inputStyle: React.CSSProperties = {
    border: '2px solid #eee', borderRadius: '12px', padding: '10px 14px',
    fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '15px',
    color: '#2d2d2d', width: '100%', boxSizing: 'border-box', background: 'white',
  }
  const selectStyle: React.CSSProperties = { ...inputStyle }
  const labelStyle: React.CSSProperties = {
    fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px',
    color: '#aaa', marginBottom: '4px', display: 'block', textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  }
  const btnBase: React.CSSProperties = {
    border: 'none', borderRadius: '50px', padding: '9px 18px',
    fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', cursor: 'pointer',
  }

  // ── Done screen ────────────────────────────────────────────────────────────

  if (saved) {
    return (
      <main style={{ ...warmStyle, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>
        <div style={{ fontSize: '64px', marginBottom: '16px' }}>✅</div>
        <h1 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '36px', color: '#2d2d2d', margin: '0 0 8px' }}>{form.name} saved!</h1>
        <p style={{ color: '#aaa', fontWeight: 700, fontSize: '15px', margin: '0 0 32px', textAlign: 'center' }}>Added to your inventory</p>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={addAnother} style={{ ...btnBase, background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontSize: '16px', padding: '12px 28px', boxShadow: '0 6px 20px rgba(255,112,67,0.4)' }}>
            + Add Another
          </button>
          <a href="/inventory" style={{ ...btnBase, background: 'white', color: '#ff7043', fontSize: '16px', padding: '12px 28px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', textDecoration: 'none' }}>
            View Inventory
          </a>
        </div>
      </main>
    )
  }

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <main style={warmStyle}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');
        @keyframes voice-pulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.12);opacity:0.85} }
      `}</style>

      <div style={{ maxWidth: '640px', margin: '0 auto' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <a href="/inventory" style={{ color: '#ff7043', fontWeight: 700, fontSize: '14px', textDecoration: 'none' }}>← Back</a>
          <h1 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '32px', color: '#2d2d2d', margin: 0, flex: 1 }}>Add Item</h1>
          <a href="/" style={{ color: '#aaa', fontWeight: 700, fontSize: '13px', textDecoration: 'none' }}>📷 Scan receipt</a>
        </div>

        {/* ── Mode tabs ── */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {([
            { id: 'manual',  label: '📝 Manual'  },
            { id: 'voice',   label: '🎤 Voice'   },
            { id: 'barcode', label: '📷 Barcode'  },
          ] as { id: Mode; label: string }[]).map(tab => (
            <button
              key={tab.id}
              onClick={() => { setMode(tab.id); setVoiceError(null); setBarcodeError(null) }}
              style={{
                ...btnBase, flex: 1,
                background: mode === tab.id ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : 'white',
                color: mode === tab.id ? 'white' : '#888',
                boxShadow: mode === tab.id ? '0 4px 12px rgba(255,112,67,0.35)' : '0 2px 8px rgba(0,0,0,0.07)',
                fontSize: '13px', padding: '9px 10px',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Voice tab controls ── */}
        {mode === 'voice' && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '20px', marginBottom: '16px', boxShadow: '0 4px 16px rgba(0,0,0,0.07)' }}>
            <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#aaa', margin: '0 0 12px' }}>
              Describe what you want to add. For example: "I've got milk, about half a bottle left, use by Friday"
            </p>
            <button
              onClick={startVoice}
              disabled={voiceListening || voiceProcessing}
              style={{
                ...btnBase, width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '10px',
                background: voiceListening ? 'linear-gradient(135deg,#ff4444,#ff6b6b)' : 'linear-gradient(135deg,#ff7043,#ff9a3c)',
                color: 'white', fontSize: '16px', padding: '14px',
                boxShadow: voiceListening ? '0 6px 20px rgba(255,68,68,0.4)' : '0 6px 20px rgba(255,112,67,0.35)',
                opacity: voiceProcessing ? 0.7 : 1,
              }}
            >
              <span style={{ fontSize: '22px', animation: voiceListening ? 'voice-pulse 0.9s ease-in-out infinite' : 'none' }}>🎤</span>
              {voiceListening ? 'Listening...' : voiceProcessing ? 'Understanding...' : 'Tap to speak'}
            </button>
            {voiceTranscript && !voiceListening && (
              <div style={{ marginTop: '12px', background: '#f9f9f9', borderRadius: '10px', padding: '10px 14px' }}>
                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#bbb', margin: '0 0 4px' }}>You said:</p>
                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#555', margin: 0 }}>"{voiceTranscript}"</p>
              </div>
            )}
            {voiceFilled && (
              <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#4caf50', margin: '10px 0 0' }}>
                ✅ Fields filled in below — review and save
              </p>
            )}
            {voiceError && (
              <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#ff4444', margin: '10px 0 0' }}>
                😕 {voiceError}
              </p>
            )}
          </div>
        )}

        {/* ── Barcode tab controls ── */}
        {mode === 'barcode' && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '20px', marginBottom: '16px', boxShadow: '0 4px 16px rgba(0,0,0,0.07)' }}>
            {cameraActive ? (
              <div>
                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#ff7043', margin: '0 0 10px' }}>
                  🔍 Scanning — hold barcode steady...
                </p>
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  style={{ width: '100%', borderRadius: '12px', background: '#000', maxHeight: '220px', objectFit: 'cover' }}
                />
                <button onClick={stopCamera} style={{ ...btnBase, background: '#f5f5f5', color: '#888', marginTop: '10px', width: '100%' }}>
                  ✕ Cancel
                </button>
              </div>
            ) : (
              <>
                {cameraSupported && (
                  <button
                    onClick={startCamera}
                    style={{ ...btnBase, width: '100%', background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontSize: '16px', padding: '14px', boxShadow: '0 6px 20px rgba(255,112,67,0.35)', marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}
                  >
                    <span style={{ fontSize: '22px' }}>📷</span>
                    Scan barcode with camera
                  </button>
                )}
                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#ccc', margin: '0 0 8px', textAlign: 'center' }}>
                  {cameraSupported ? 'or enter barcode number manually' : 'Enter barcode number'}
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="e.g. 5000128066717"
                    value={barcodeInput}
                    onChange={e => setBarcodeInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && lookupBarcode(barcodeInput)}
                    style={{ ...inputStyle, flex: 1 }}
                    inputMode="numeric"
                  />
                  <button
                    onClick={() => lookupBarcode(barcodeInput)}
                    disabled={barcodeSearching || !barcodeInput.trim()}
                    style={{ ...btnBase, background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', flexShrink: 0, padding: '10px 16px', opacity: (!barcodeInput.trim() || barcodeSearching) ? 0.5 : 1 }}
                  >
                    {barcodeSearching ? '...' : 'Look up'}
                  </button>
                </div>
              </>
            )}
            {barcodeFound && (
              <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#4caf50', margin: '12px 0 0' }}>
                ✅ Found: <strong>{barcodeFound}</strong> — review details below
              </p>
            )}
            {barcodeError && (
              <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#ff9800', margin: '12px 0 0' }}>
                {barcodeError}
              </p>
            )}
          </div>
        )}

        {/* ── Shared item form ── */}
        <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 16px rgba(0,0,0,0.07)' }}>
          <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '18px', color: '#2d2d2d', margin: '0 0 16px' }}>Item Details</p>

          {/* Name */}
          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>Name *</label>
            <input
              type="text"
              placeholder="e.g. Semi-Skimmed Milk"
              value={form.name}
              autoFocus={mode === 'manual'}
              onChange={e => {
                updateForm({ name: e.target.value })
                if (!form.category) autoFillLocation(e.target.value, '')
              }}
              style={inputStyle}
            />
          </div>

          {/* Quantity structure: count × size each + unit */}
          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>Quantity</label>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label style={{ ...labelStyle, fontSize: '10px', marginBottom: '3px' }}>Count</label>
                <input
                  type="number" min={1} step={1} placeholder="1"
                  value={form.itemCount}
                  onChange={e => updateForm({ itemCount: e.target.value, quantity: e.target.value, quantityOriginal: e.target.value })}
                  style={{ ...inputStyle, textAlign: 'center' }}
                />
              </div>
              <span style={{ color: '#ccc', fontWeight: 700, fontSize: '18px', paddingBottom: '11px', flexShrink: 0 }}>×</span>
              <div style={{ flex: 1 }}>
                <label style={{ ...labelStyle, fontSize: '10px', marginBottom: '3px' }}>Size each</label>
                <input
                  type="number" min={0} step={0.1} placeholder="—"
                  value={form.amountPerUnit}
                  onChange={e => updateForm({ amountPerUnit: e.target.value })}
                  style={{ ...inputStyle, textAlign: 'center' }}
                />
              </div>
              <div style={{ flex: 2 }}>
                <label style={{ ...labelStyle, fontSize: '10px', marginBottom: '3px' }}>Unit</label>
                <select value={form.unit} onChange={e => updateForm({ unit: e.target.value })} style={selectStyle}>
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '11px', color: '#ccc', margin: '4px 0 0' }}>
              e.g. 6 × 330 ml cans, or just 1 × 750 ml bottle
            </p>
          </div>

          {/* Location */}
          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>Location</label>
            <select
              value={form.location}
              onChange={e => updateForm({ location: e.target.value as StorageLocation })}
              style={selectStyle}
            >
              {LOCATIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>

          {/* Category */}
          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>Category</label>
            <select
              value={form.category}
              onChange={e => {
                updateForm({ category: e.target.value })
                autoFillLocation(form.name, e.target.value)
              }}
              style={selectStyle}
            >
              <option value="">— Select category —</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Expiry date — hide for household items */}
          {form.location !== 'household' && (
            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>Expiry date (optional)</label>
              <input type="date" value={form.expiryDate} onChange={e => updateForm({ expiryDate: e.target.value })} style={inputStyle} />
            </div>
          )}

          {/* Already opened toggle */}
          <div style={{ marginBottom: form.opened ? '10px' : '14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              onClick={() => updateForm({ opened: !form.opened, openedAt: !form.opened ? new Date().toISOString().split('T')[0] : '' })}
              style={{
                width: '44px', height: '24px', borderRadius: '12px', cursor: 'pointer', flexShrink: 0,
                background: form.opened ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : '#eee',
                position: 'relative', transition: 'background 0.2s',
              }}
            >
              <div style={{
                position: 'absolute', top: '3px', width: '18px', height: '18px', borderRadius: '50%',
                background: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                left: form.opened ? '23px' : '3px', transition: 'left 0.2s',
              }} />
            </div>
            <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#555' }}>
              Already opened
            </span>
          </div>
          {form.opened && (
            <div style={{ marginBottom: '14px', paddingLeft: '8px', borderLeft: '3px solid rgba(255,112,67,0.3)' }}>
              <label style={labelStyle}>Opened on</label>
              <input type="date" value={form.openedAt} onChange={e => updateForm({ openedAt: e.target.value })} style={inputStyle} />
            </div>
          )}

          {/* Retailer */}
          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>Retailer (optional)</label>
            <input
              type="text"
              placeholder="e.g. Tesco, Waitrose, or leave blank"
              value={form.retailer}
              onChange={e => updateForm({ retailer: e.target.value })}
              style={inputStyle}
            />
          </div>

          {/* Purchase date */}
          <div style={{ marginBottom: '20px' }}>
            <label style={labelStyle}>Purchase date (optional)</label>
            <input type="date" value={form.purchaseDate} onChange={e => updateForm({ purchaseDate: e.target.value })} style={inputStyle} />
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={saving || !form.name.trim()}
            style={{
              ...btnBase, width: '100%', background: !form.name.trim() ? '#eee' : 'linear-gradient(135deg,#ff7043,#ff9a3c)',
              color: !form.name.trim() ? '#bbb' : 'white', fontSize: '18px', padding: '16px',
              boxShadow: form.name.trim() ? '0 8px 24px rgba(255,112,67,0.4)' : 'none',
              fontFamily: "'Fredoka One',cursive", cursor: !form.name.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving...' : `Save${form.name.trim() ? ` "${form.name.trim()}"` : ''} to Inventory`}
          </button>
        </div>

      </div>
    </main>
  )
}
