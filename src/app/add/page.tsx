'use client'

import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { suggestLocation } from '@/lib/categoriser'
import { StorageLocation } from '@/lib/types'

// ── Step / mode types ─────────────────────────────────────────────────────────

type Step = 'choose' | 'capture' | 'review' | 'done'
type Mode = 'manual' | 'voice' | 'barcode' | 'receipt'
type LookupStatus = 'loading' | 'found' | 'not_found' | 'error'

// ── Unified review item (all sources merge into this) ─────────────────────────

type ReviewBatchItem = {
  id: string
  source: Mode
  name: string
  count: string
  amountPerUnit: string
  unit: string
  location: StorageLocation
  category: string
  expiryDate: string
  price: number | null
  selected: boolean
  retailer: string
  openedAt: string
  // barcode-specific
  barcode?: string
  lookupStatus?: LookupStatus
  // receipt-specific
  confidence?: number
}

// ── Manual / voice single-item form ──────────────────────────────────────────

type ItemForm = {
  name: string
  itemCount: string
  amountPerUnit: string
  unit: string
  location: StorageLocation
  category: string
  expiryDate: string
  retailer: string
  purchaseDate: string
  opened: boolean
  openedAt: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const UNITS      = ['item', 'g', 'kg', 'ml', 'l', 'bottle', 'tin', 'loaf', 'pack', 'bag', 'head', 'fillet']
const CATEGORIES = ['dairy', 'meat', 'fish', 'vegetables', 'fruit', 'bakery', 'tinned', 'dry goods', 'oils', 'frozen', 'drinks', 'snacks', 'alcohol', 'household', 'other']
const LOCATIONS: { value: StorageLocation; label: string }[] = [
  { value: 'fridge',    label: '❄️ Fridge'    },
  { value: 'freezer',   label: '🧊 Freezer'   },
  { value: 'cupboard',  label: '🗄️ Cupboard'  },
  { value: 'household', label: '🏠 Household' },
  { value: 'other',     label: '📦 Other'     },
]

const blankForm = (): ItemForm => ({
  name: '', itemCount: '1', amountPerUnit: '', unit: 'item',
  location: 'cupboard', category: '', expiryDate: '',
  retailer: '', purchaseDate: '', opened: false, openedAt: '',
})

// ── Page component ────────────────────────────────────────────────────────────

export default function AddPage() {
  // ── Navigation state ─────────────────────────────────────────────────────
  const [step,        setStep]        = useState<Step>('choose')
  const [mode,        setMode]        = useState<Mode>('manual')
  const [reviewBatch, setReviewBatch] = useState<ReviewBatchItem[]>([])
  const [saving,      setSaving]      = useState(false)
  const [savedCount,  setSavedCount]  = useState(0)
  const [addedName,   setAddedName]   = useState<string | null>(null)

  // ── Manual / voice form state ─────────────────────────────────────────────
  const [form,            setForm]            = useState<ItemForm>(blankForm())
  const [voiceListening,  setVoiceListening]  = useState(false)
  const [voiceProcessing, setVoiceProcessing] = useState(false)
  const [voiceTranscript, setVoiceTranscript] = useState('')
  const [voiceError,      setVoiceError]      = useState<string | null>(null)
  const [voiceFilled,     setVoiceFilled]     = useState(false)

  // ── Barcode scanning state ────────────────────────────────────────────────
  const [barcodeScanning, setBarcodeScanning] = useState(false)
  const [barcodeBatch,    setBarcodeBatch]    = useState<ReviewBatchItem[]>([])
  const [cameraActive,    setCameraActive]    = useState(false)
  const [cameraError,     setCameraError]     = useState<string | null>(null)
  const [scanFlash,       setScanFlash]       = useState(false)
  const videoRef         = useRef<HTMLVideoElement>(null)
  const streamRef        = useRef<MediaStream | null>(null)
  const scanIntervalRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const zxingControlsRef = useRef<{ stop: () => void } | null>(null)
  const lastBarcodeRef   = useRef('')
  const lastScanTimeRef  = useRef(0)

  // ── Receipt state ─────────────────────────────────────────────────────────
  const [receiptLoading,   setReceiptLoading]   = useState(false)
  const [receiptRetailer,  setReceiptRetailer]  = useState('')
  const [receiptTotal,     setReceiptTotal]     = useState<number | null>(null)
  const [receiptPreview,   setReceiptPreview]   = useState<string | null>(null)
  const [rVoiceListening,  setRVoiceListening]  = useState(false)
  const [rVoiceProcessing, setRVoiceProcessing] = useState(false)
  const [rVoiceFilled,     setRVoiceFilled]     = useState<{ name: string; date: string }[]>([])
  const [rVoiceError,      setRVoiceError]      = useState<string | null>(null)
  const receiptFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { return () => stopCamera() }, [])

  // ── Navigation helpers ────────────────────────────────────────────────────

  function goToCapture(m: Mode) {
    if (m !== 'barcode') stopCamera()
    setMode(m)
    setStep('capture')
    setForm(blankForm())
    setVoiceError(null)
    setVoiceFilled(false)
    setVoiceTranscript('')
    setCameraError(null)
    setAddedName(null)
    if (m === 'barcode') {
      setBarcodeBatch([])
      setBarcodeScanning(false)
    }
  }

  function goToChoose() {
    stopCamera()
    setBarcodeScanning(false)
    setStep('choose')
    setAddedName(null)
  }

  function resetAll() {
    setStep('choose')
    setReviewBatch([])
    setBarcodeBatch([])
    setSavedCount(0)
    setReceiptRetailer('')
    setReceiptTotal(null)
    setReceiptPreview(null)
    setForm(blankForm())
    setVoiceError(null)
    setVoiceFilled(false)
    setVoiceTranscript('')
    setAddedName(null)
  }

  // ── Form helpers ──────────────────────────────────────────────────────────

  function updateForm(patch: Partial<ItemForm>) {
    setForm(prev => ({ ...prev, ...patch }))
  }

  // Push the current form to the review batch
  function addFormToBatch() {
    if (!form.name.trim()) return
    const name = form.name.trim()
    const item: ReviewBatchItem = {
      id: `manual-${Date.now()}-${Math.random()}`,
      source: mode,
      name,
      count: form.itemCount,
      amountPerUnit: form.amountPerUnit,
      unit: form.unit,
      location: form.location,
      category: form.category,
      expiryDate: form.expiryDate,
      price: null,
      selected: true,
      retailer: form.retailer,
      openedAt: (form.opened && form.openedAt) ? form.openedAt : '',
    }
    setReviewBatch(prev => [...prev, item])
    setForm(blankForm())
    setVoiceFilled(false)
    setVoiceTranscript('')
    setAddedName(name)
    setTimeout(() => setAddedName(null), 2000)
  }

  // ── Review batch helpers ──────────────────────────────────────────────────

  function updateReviewItem(idx: number, patch: Partial<ReviewBatchItem>) {
    setReviewBatch(prev => prev.map((item, i) => i === idx ? { ...item, ...patch } : item))
  }

  function removeReviewItem(idx: number) {
    setReviewBatch(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Voice add ─────────────────────────────────────────────────────────────

  function startVoice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { setVoiceError("Voice input isn't supported in this browser. Try Chrome."); return }
    const recognition = new SR()
    recognition.lang = 'en-GB'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    let finalTranscript = ''
    let silenceTimer: ReturnType<typeof setTimeout> | null = null
    const absoluteTimer = setTimeout(() => recognition.stop(), 10000)
    setVoiceListening(true); setVoiceError(null); setVoiceFilled(false); setVoiceTranscript('')
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
        clearTimeout(absoluteTimer); if (silenceTimer) clearTimeout(silenceTimer)
        setVoiceListening(false); setVoiceError("Couldn't hear you — try again.")
      }
    }
    recognition.onend = async () => {
      clearTimeout(absoluteTimer); if (silenceTimer) clearTimeout(silenceTimer)
      setVoiceListening(false)
      const transcript = finalTranscript.trim()
      if (!transcript) { setVoiceError('No speech detected — tap the mic and try again.'); return }
      setVoiceProcessing(true)
      try {
        const res = await fetch('/api/voice-add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript }) })
        const r = await res.json()
        if (r.error) throw new Error(r.error)
        setForm({
          name: r.name || '',
          itemCount: String(r.count ?? 1),
          amountPerUnit: r.amount_per_unit != null ? String(r.amount_per_unit) : '',
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
      } catch { setVoiceError('Could not understand — try speaking more clearly.') }
      setVoiceProcessing(false)
    }
  }

  // ── Barcode scanning ──────────────────────────────────────────────────────

  function beep() {
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sine'; osc.frequency.value = 1047
      gain.gain.setValueAtTime(0.25, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.12)
    } catch {}
  }

  async function startCamera() {
    setCameraError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera not available on this device or browser.")
      return
    }
    const NativeBarcodeDetector = (window as any).BarcodeDetector
    if (NativeBarcodeDetector) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        streamRef.current = stream
        setCameraActive(true); setBarcodeScanning(true)
        await new Promise<void>(r => setTimeout(r, 80))
        if (!videoRef.current) return
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
        const detector = new NativeBarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'] })
        scanIntervalRef.current = setInterval(async () => {
          const vid = videoRef.current
          if (!vid || vid.readyState < 2) return
          try {
            const codes = await detector.detect(vid)
            if (codes.length > 0) addToBarcodeBatch(codes[0].rawValue)
          } catch {}
        }, 400)
      } catch {
        setCameraError("Couldn't access camera. Check camera permissions for this site.")
        setCameraActive(false)
      }
    } else {
      setCameraActive(true); setBarcodeScanning(true)
      await new Promise<void>(r => setTimeout(r, 80))
      if (!videoRef.current) { setCameraActive(false); setBarcodeScanning(false); return }
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const reader = new BrowserMultiFormatReader()
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } } },
          videoRef.current,
          (result) => { if (result) addToBarcodeBatch(result.getText()) }
        )
        zxingControlsRef.current = controls
      } catch {
        setCameraError("Couldn't access camera. Check camera permissions for this site.")
        setCameraActive(false); setBarcodeScanning(false)
      }
    }
  }

  function stopCamera() {
    try { zxingControlsRef.current?.stop() } catch {}
    zxingControlsRef.current = null
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    if (scanIntervalRef.current) { clearInterval(scanIntervalRef.current); scanIntervalRef.current = null }
    setCameraActive(false)
  }

  async function addToBarcodeBatch(barcode: string) {
    const now = Date.now()
    if (barcode === lastBarcodeRef.current && now - lastScanTimeRef.current < 2000) return
    lastBarcodeRef.current = barcode
    lastScanTimeRef.current = now
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(60)
    beep()
    setScanFlash(true); setTimeout(() => setScanFlash(false), 280)

    let isDuplicate = false
    setBarcodeBatch(prev => {
      const existIdx = prev.findIndex(i => i.barcode === barcode)
      if (existIdx !== -1) {
        isDuplicate = true
        return prev.map((item, i) => i === existIdx ? { ...item, count: String(parseInt(item.count) + 1) } : item)
      }
      return prev
    })
    if (isDuplicate) return

    const id = `${barcode}-${now}`
    const placeholder: ReviewBatchItem = {
      id, source: 'barcode', name: barcode, count: '1', amountPerUnit: '',
      unit: 'item', location: 'cupboard', category: '', expiryDate: '',
      price: null, selected: true, retailer: '', openedAt: '',
      barcode, lookupStatus: 'loading',
    }
    setBarcodeBatch(prev => [...prev, placeholder])
    try {
      const res = await fetch('/api/barcode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ barcode }) })
      const result = await res.json()
      setBarcodeBatch(prev => prev.map(item => {
        if (item.id !== id) return item
        if (result.found && result.name) {
          return {
            ...item, name: result.name,
            count: result.count != null && result.count > 1 ? String(result.count) : item.count,
            amountPerUnit: result.amount_per_unit != null ? String(result.amount_per_unit) : '',
            unit: result.unit || 'item',
            category: result.category || '',
            location: suggestLocation(result.name, result.category || ''),
            lookupStatus: 'found',
          }
        }
        return { ...item, lookupStatus: 'not_found' }
      }))
    } catch {
      setBarcodeBatch(prev => prev.map(item => item.id === id ? { ...item, lookupStatus: 'error' } : item))
    }
  }

  function finishBarcodeScanning() {
    stopCamera()
    setBarcodeScanning(false)
    if (barcodeBatch.length > 0) {
      setReviewBatch(prev => [...prev, ...barcodeBatch])
      setBarcodeBatch([])
      setStep('review')
    }
  }

  // ── Receipt ───────────────────────────────────────────────────────────────

  async function handleReceiptFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setReceiptPreview(URL.createObjectURL(file))
    setReceiptLoading(true)
    const formData = new FormData()
    formData.append('receipt', file)
    try {
      const res = await fetch('/api/parse-receipt', { method: 'POST', body: formData })
      const result = await res.json()
      if (result.error) { alert('Error: ' + result.error); setReceiptLoading(false); return }
      setReceiptRetailer(result.retailer_name || 'Unknown Store')
      setReceiptTotal(result.total || null)
      const items: ReviewBatchItem[] = result.items.map((item: any, i: number) => ({
        id: String(i),
        source: 'receipt' as Mode,
        name: item.normalized_name,
        count: String(item.quantity || 1),
        amountPerUnit: '',
        unit: item.unit || 'item',
        location: suggestLocation(item.normalized_name, item.category) as StorageLocation,
        category: item.category || '',
        expiryDate: '',
        price: item.price || null,
        selected: true,
        retailer: result.retailer_name || '',
        openedAt: '',
        confidence: item.confidence,
      }))
      setReviewBatch(prev => [...prev, ...items])
      setStep('review')
    } catch { alert('Something went wrong. Try again.') }
    setReceiptLoading(false)
  }

  // Receipt voice expiry (applies to receipt items in the review batch)
  function startReceiptVoiceExpiry() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { setRVoiceError("Voice input isn't supported in this browser."); return }
    const recognition = new SR()
    recognition.lang = 'en-GB'; recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 1
    let finalTranscript = ''; let silenceTimer: ReturnType<typeof setTimeout> | null = null
    const absoluteTimer = setTimeout(() => recognition.stop(), 8000)
    setRVoiceListening(true); setRVoiceFilled([]); setRVoiceError(null)
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
        clearTimeout(absoluteTimer); if (silenceTimer) clearTimeout(silenceTimer)
        setRVoiceListening(false); setRVoiceError("Couldn't hear you — try again.")
      }
    }
    recognition.onend = async () => {
      clearTimeout(absoluteTimer); if (silenceTimer) clearTimeout(silenceTimer)
      setRVoiceListening(false)
      const transcript = finalTranscript.trim()
      if (!transcript) { setRVoiceError('No speech detected — try again.'); return }
      setRVoiceProcessing(true)
      const receiptNames = reviewBatch.filter(i => i.source === 'receipt').map(i => i.name)
      try {
        const res = await fetch('/api/voice-expiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript, items: receiptNames }) })
        const result = await res.json()
        if (result.error) throw new Error(result.error)
        const filled: { name: string; date: string }[] = []
        setReviewBatch(prev => {
          const updated = [...prev]
          for (const match of (result.matches || [])) {
            const matchName = match.item_name.toLowerCase()
            const idx = updated.findIndex(i =>
              i.source === 'receipt' && (
                i.name.toLowerCase() === matchName ||
                i.name.toLowerCase().includes(matchName) ||
                matchName.includes(i.name.toLowerCase())
              )
            )
            if (idx !== -1 && match.expiry_date) {
              updated[idx] = { ...updated[idx], expiryDate: match.expiry_date }
              filled.push({ name: updated[idx].name, date: match.expiry_date })
            }
          }
          return updated
        })
        if (filled.length > 0) setRVoiceFilled(filled)
        else setRVoiceError("Couldn't match any items — try again.")
      } catch { setRVoiceError('Something went wrong. Please try again.') }
      setRVoiceProcessing(false)
    }
  }

  // ── Unified save ──────────────────────────────────────────────────────────

  async function saveAll() {
    const toSave = reviewBatch.filter(i => i.selected)
    if (toSave.length === 0) return
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id ?? null

    // Receipt items: create receipt record + receipt_items first
    const receiptItems = toSave.filter(i => i.source === 'receipt')
    const receiptItemIdMap: Record<string, string | null> = {}

    if (receiptItems.length > 0) {
      const { data: receiptData, error: receiptError } = await supabase
        .from('receipts')
        .insert({ retailer_name: receiptRetailer, total: receiptTotal, user_id: userId })
        .select().single()
      if (receiptError) { alert('Error saving receipt: ' + receiptError.message); setSaving(false); return }
      const { data: riData, error: riError } = await supabase.from('receipt_items').insert(
        receiptItems.map(item => ({
          receipt_id: receiptData.id,
          raw_text: item.name,
          normalized_name: item.name,
          quantity: parseInt(item.count) || 1,
          unit: item.unit,
          category: item.category || null,
          confidence: item.confidence ?? 1,
          price: item.price ?? null,
        }))
      ).select()
      if (riError) { alert('Error saving receipt items: ' + riError.message); setSaving(false); return }
      receiptItems.forEach((item, i) => {
        receiptItemIdMap[item.id] = riData?.[i]?.id ?? null
      })
    }

    // Build inventory inserts for all items
    const inserts = toSave.map(item => {
      const cnt = parseInt(item.count) || 1
      const apu = item.amountPerUnit ? parseFloat(item.amountPerUnit) : null
      const qty = apu ? cnt * apu : cnt
      return {
        name: item.name.trim() || item.barcode || 'Unknown',
        remaining_quantity: qty,
        quantity: qty,
        quantity_original: qty,
        count: apu ? cnt : (cnt > 1 ? cnt : null),
        amount_per_unit: apu,
        unit: item.unit,
        location: item.location,
        category: item.category || null,
        expiry_date: item.expiryDate || null,
        opened_at: item.openedAt || null,
        retailer: item.retailer || null,
        receipt_item_id: receiptItemIdMap[item.id] ?? null,
        source: item.source,
        status: 'active' as const,
        user_id: userId,
      }
    })

    const { error } = await supabase.from('inventory_items').insert(inserts)
    setSaving(false)
    if (error) { alert('Error saving: ' + error.message); return }
    setSavedCount(toSave.length)
    setReviewBatch([])
    setStep('done')
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  const pageStyle = {
    fontFamily: "'Nunito', sans-serif",
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #fdf6ec 0%, #fde8d0 50%, #fce4e4 100%)',
    padding: '72px 20px 60px',
  }
  const inputStyle: React.CSSProperties = {
    border: '2px solid #eee', borderRadius: '12px', padding: '10px 14px',
    fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '15px',
    color: '#2d2d2d', width: '100%', boxSizing: 'border-box', background: 'white',
  }
  const selectStyle: React.CSSProperties = { ...inputStyle }
  const labelStyle: React.CSSProperties = {
    fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px',
    color: '#aaa', marginBottom: '4px', display: 'block', textTransform: 'uppercase' as const, letterSpacing: '0.5px',
  }
  const btnBase: React.CSSProperties = {
    border: 'none', borderRadius: '50px', padding: '9px 18px',
    fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', cursor: 'pointer',
  }
  const smallField: React.CSSProperties = {
    border: '2px solid #eee', borderRadius: '8px', padding: '7px 8px',
    fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', background: 'white',
  }

  // ── Item form (manual + voice) ────────────────────────────────────────────

  const itemFormJSX = (
    <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 16px rgba(0,0,0,0.07)' }}>
      <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '18px', color: '#2d2d2d', margin: '0 0 16px' }}>Item Details</p>

      <div style={{ marginBottom: '14px' }}>
        <label style={labelStyle}>Name *</label>
        <input type="text" placeholder="e.g. Semi-Skimmed Milk" value={form.name} autoFocus={mode === 'manual'}
          onChange={e => updateForm({ name: e.target.value, location: suggestLocation(e.target.value, form.category) })}
          style={inputStyle} />
      </div>

      {/* Count × size + unit */}
      <div style={{ marginBottom: '14px' }}>
        <label style={labelStyle}>Quantity</label>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ ...labelStyle, fontSize: '10px', marginBottom: '3px' }}>Count</label>
            <input type="number" min={1} step={1} placeholder="1" value={form.itemCount}
              onChange={e => {
                const cnt = e.target.value
                const apu = parseFloat(form.amountPerUnit)
                updateForm({ itemCount: cnt })
              }}
              style={{ ...inputStyle, textAlign: 'center' }} />
          </div>
          <span style={{ color: '#ccc', fontWeight: 700, fontSize: '18px', paddingBottom: '11px', flexShrink: 0 }}>×</span>
          <div style={{ flex: 1 }}>
            <label style={{ ...labelStyle, fontSize: '10px', marginBottom: '3px' }}>Size each</label>
            <input type="number" min={0} step={0.1} placeholder="—" value={form.amountPerUnit}
              onChange={e => updateForm({ amountPerUnit: e.target.value })}
              style={{ ...inputStyle, textAlign: 'center' }} />
          </div>
          <div style={{ flex: 2 }}>
            <label style={{ ...labelStyle, fontSize: '10px', marginBottom: '3px' }}>Unit</label>
            <select value={form.unit} onChange={e => updateForm({ unit: e.target.value })} style={selectStyle}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '11px', color: '#ccc', margin: '4px 0 0' }}>
          e.g. 6 × 330 ml cans, or 1 × 750 ml bottle
        </p>
      </div>

      <div style={{ marginBottom: '14px' }}>
        <label style={labelStyle}>Location</label>
        <select value={form.location} onChange={e => updateForm({ location: e.target.value as StorageLocation })} style={selectStyle}>
          {LOCATIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </div>

      <div style={{ marginBottom: '14px' }}>
        <label style={labelStyle}>Category</label>
        <select value={form.category} onChange={e => updateForm({ category: e.target.value, location: suggestLocation(form.name, e.target.value) })} style={selectStyle}>
          <option value="">— Select category —</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {form.location !== 'household' && (
        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Expiry date (optional)</label>
          <input type="date" value={form.expiryDate} onChange={e => updateForm({ expiryDate: e.target.value })} style={inputStyle} />
        </div>
      )}

      {/* Already opened toggle */}
      <div style={{ marginBottom: form.opened ? '10px' : '14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div onClick={() => updateForm({ opened: !form.opened, openedAt: !form.opened ? new Date().toISOString().split('T')[0] : '' })}
          style={{ width: '44px', height: '24px', borderRadius: '12px', cursor: 'pointer', flexShrink: 0, background: form.opened ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : '#eee', position: 'relative', transition: 'background 0.2s' }}>
          <div style={{ position: 'absolute', top: '3px', width: '18px', height: '18px', borderRadius: '50%', background: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.2)', left: form.opened ? '23px' : '3px', transition: 'left 0.2s' }} />
        </div>
        <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#555' }}>Already opened</span>
      </div>
      {form.opened && (
        <div style={{ marginBottom: '14px', paddingLeft: '8px', borderLeft: '3px solid rgba(255,112,67,0.3)' }}>
          <label style={labelStyle}>Opened on</label>
          <input type="date" value={form.openedAt} onChange={e => updateForm({ openedAt: e.target.value })} style={inputStyle} />
        </div>
      )}

      <div style={{ marginBottom: '20px' }}>
        <label style={labelStyle}>Retailer (optional)</label>
        <input type="text" placeholder="e.g. Tesco" value={form.retailer} onChange={e => updateForm({ retailer: e.target.value })} style={inputStyle} />
      </div>

      {/* Add to batch button */}
      <button onClick={addFormToBatch} disabled={!form.name.trim()}
        style={{ ...btnBase, width: '100%', background: !form.name.trim() ? '#eee' : 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: !form.name.trim() ? '#bbb' : 'white', fontSize: '18px', padding: '16px', boxShadow: form.name.trim() ? '0 8px 24px rgba(255,112,67,0.4)' : 'none', fontFamily: "'Fredoka One',cursive", cursor: !form.name.trim() ? 'not-allowed' : 'pointer' }}>
        {form.name.trim() ? `Add "${form.name.trim()}" to List` : 'Add to List'}
      </button>
    </div>
  )

  // ── STEP: done ────────────────────────────────────────────────────────────

  if (step === 'done') {
    return (
      <main style={{ ...pageStyle, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>
        <div style={{ fontSize: '64px', marginBottom: '16px' }}>🎉</div>
        <h1 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '36px', color: '#2d2d2d', margin: '0 0 8px', textAlign: 'center' }}>
          {savedCount} item{savedCount !== 1 ? 's' : ''} saved!
        </h1>
        <p style={{ color: '#aaa', fontWeight: 700, fontSize: '15px', margin: '0 0 32px', textAlign: 'center' }}>Added to your inventory</p>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={resetAll} style={{ ...btnBase, background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontSize: '16px', padding: '12px 28px', boxShadow: '0 6px 20px rgba(255,112,67,0.4)' }}>
            + Add More
          </button>
          <a href="/inventory" style={{ ...btnBase, background: 'white', color: '#ff7043', fontSize: '16px', padding: '12px 28px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', textDecoration: 'none' }}>
            View Inventory
          </a>
        </div>
      </main>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <main style={pageStyle}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');
        @keyframes voice-pulse  { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.12);opacity:0.85} }
        @keyframes scan-line    { 0%,100%{top:8%} 50%{top:82%} }
        @keyframes scan-flash   { 0%{opacity:0.55} 100%{opacity:0} }
        @keyframes scan-pop     { 0%{transform:scale(0.9);opacity:0} 60%{transform:scale(1.04)} 100%{transform:scale(1);opacity:1} }
        @keyframes added-in     { 0%{opacity:0;transform:translateY(6px)} 100%{opacity:1;transform:translateY(0)} }
      `}</style>

      <div style={{ maxWidth: '640px', margin: '0 auto' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          {step !== 'choose'
            ? <button onClick={step === 'review' ? () => setStep('choose') : goToChoose} style={{ background: 'none', border: 'none', color: '#ff7043', fontWeight: 700, fontSize: '14px', cursor: 'pointer', padding: 0 }}>← Back</button>
            : <a href="/" style={{ color: '#ff7043', fontWeight: 700, fontSize: '14px', textDecoration: 'none' }}>← Home</a>
          }
          <h1 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '32px', color: '#2d2d2d', margin: 0, flex: 1 }}>
            {step === 'choose' ? 'Add Items' : step === 'capture' && mode === 'manual' ? 'Add Manually' : step === 'capture' && mode === 'voice' ? 'Voice Add' : step === 'capture' && mode === 'barcode' ? 'Scan Barcodes' : step === 'capture' && mode === 'receipt' ? 'Scan Receipt' : `Review (${reviewBatch.length})`}
          </h1>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            STEP: CHOOSE — 4 option cards
        ═══════════════════════════════════════════════════════════════════ */}
        {step === 'choose' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
              {([
                { mode: 'receipt',  emoji: '🧾', title: 'Scan Receipt',   desc: 'Photo of grocery receipt'    },
                { mode: 'barcode',  emoji: '📷', title: 'Scan Barcodes',  desc: 'Point camera at each item'   },
                { mode: 'manual',   emoji: '📝', title: 'Add Manually',   desc: 'Type item details'           },
                { mode: 'voice',    emoji: '🎤', title: 'Voice Add',      desc: 'Describe what you have'      },
              ] as { mode: Mode; emoji: string; title: string; desc: string }[]).map(opt => (
                <button key={opt.mode} onClick={() => goToCapture(opt.mode)} style={{ background: 'white', borderRadius: '20px', padding: '22px 16px', boxShadow: '0 2px 12px rgba(0,0,0,0.07)', border: '2px solid transparent', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}>
                  <div style={{ fontSize: '36px', marginBottom: '10px', lineHeight: 1 }}>{opt.emoji}</div>
                  <div style={{ fontFamily: "'Fredoka One',cursive", fontSize: '17px', color: '#2d2d2d', marginBottom: '4px' }}>{opt.title}</div>
                  <div style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '12px', color: '#bbb', lineHeight: 1.4 }}>{opt.desc}</div>
                </button>
              ))}
            </div>

            {/* Pending review batch banner */}
            {reviewBatch.length > 0 && (
              <button onClick={() => setStep('review')} style={{ ...btnBase, width: '100%', background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontSize: '16px', padding: '14px', boxShadow: '0 6px 20px rgba(255,112,67,0.4)', fontFamily: "'Fredoka One',cursive", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                <span>📋</span> Review Batch ({reviewBatch.length} item{reviewBatch.length !== 1 ? 's' : ''})
              </button>
            )}
          </>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            STEP: CAPTURE
        ═══════════════════════════════════════════════════════════════════ */}
        {step === 'capture' && (
          <>
            {/* ── Voice capture ── */}
            {mode === 'voice' && (
              <>
                <div style={{ background: 'white', borderRadius: '16px', padding: '20px', marginBottom: '16px', boxShadow: '0 4px 16px rgba(0,0,0,0.07)' }}>
                  <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#aaa', margin: '0 0 12px' }}>
                    Say something like: "6 cans of Heinz baked beans, use by March"
                  </p>
                  <button onClick={startVoice} disabled={voiceListening || voiceProcessing}
                    style={{ ...btnBase, width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '10px', background: voiceListening ? 'linear-gradient(135deg,#ff4444,#ff6b6b)' : 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontSize: '16px', padding: '14px', boxShadow: voiceListening ? '0 6px 20px rgba(255,68,68,0.4)' : '0 6px 20px rgba(255,112,67,0.35)', opacity: voiceProcessing ? 0.7 : 1 }}>
                    <span style={{ fontSize: '22px', animation: voiceListening ? 'voice-pulse 0.9s ease-in-out infinite' : 'none' }}>🎤</span>
                    {voiceListening ? 'Listening...' : voiceProcessing ? 'Understanding...' : 'Tap to speak'}
                  </button>
                  {voiceTranscript && !voiceListening && (
                    <div style={{ marginTop: '12px', background: '#f9f9f9', borderRadius: '10px', padding: '10px 14px' }}>
                      <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#bbb', margin: '0 0 4px' }}>You said:</p>
                      <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#555', margin: 0 }}>"{voiceTranscript}"</p>
                    </div>
                  )}
                  {voiceFilled && <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#4caf50', margin: '10px 0 0' }}>✅ Fields filled in below — check and add</p>}
                  {voiceError && <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#ff4444', margin: '10px 0 0' }}>😕 {voiceError}</p>}
                </div>
                {itemFormJSX}
              </>
            )}

            {/* ── Manual capture ── */}
            {mode === 'manual' && itemFormJSX}

            {/* ── Success flash after adding ── */}
            {addedName && (
              <div style={{ marginTop: '12px', background: '#f0fff4', border: '1.5px solid rgba(76,175,80,0.3)', borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', animation: 'added-in 0.2s ease-out' }}>
                <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#388e3c' }}>✅ "{addedName}" added</span>
                {reviewBatch.length > 0 && (
                  <button onClick={() => setStep('review')} style={{ ...btnBase, background: 'linear-gradient(135deg,#4caf50,#66bb6a)', color: 'white', padding: '6px 14px', fontSize: '13px', boxShadow: '0 3px 10px rgba(76,175,80,0.35)' }}>
                    Review ({reviewBatch.length}) →
                  </button>
                )}
              </div>
            )}

            {/* Batch count (if items in batch) */}
            {!addedName && reviewBatch.length > 0 && (
              <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'white', borderRadius: '12px', padding: '12px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#aaa' }}>
                  {reviewBatch.length} item{reviewBatch.length !== 1 ? 's' : ''} in batch
                </span>
                <button onClick={() => setStep('review')} style={{ ...btnBase, background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', padding: '8px 16px', fontSize: '14px', boxShadow: '0 4px 12px rgba(255,112,67,0.35)' }}>
                  Review All →
                </button>
              </div>
            )}

            {/* ── Barcode scanning ── */}
            {mode === 'barcode' && (
              <>
                {!barcodeScanning ? (
                  <div style={{ background: 'white', borderRadius: '20px', padding: '28px 24px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', textAlign: 'center' }}>
                    <div style={{ fontSize: '56px', marginBottom: '12px' }}>📦</div>
                    <h2 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '24px', color: '#2d2d2d', margin: '0 0 8px' }}>Scan Your Shopping</h2>
                    <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#aaa', margin: '0 0 24px', lineHeight: 1.5 }}>
                      Point the camera at each barcode. Items are added to a list — review and save together.
                    </p>
                    {cameraError && <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#ff4444', margin: '0 0 16px' }}>⚠ {cameraError}</p>}
                    <button onClick={startCamera} style={{ ...btnBase, background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontSize: '18px', padding: '16px 40px', boxShadow: '0 8px 24px rgba(255,112,67,0.4)', fontFamily: "'Fredoka One',cursive", display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '24px' }}>📷</span> Start Scanning
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Camera viewfinder */}
                    <div style={{ background: '#000', borderRadius: '16px', overflow: 'hidden', marginBottom: '14px', position: 'relative' }}>
                      <video ref={videoRef} muted playsInline style={{ width: '100%', maxHeight: '280px', objectFit: 'cover', display: 'block' }} />
                      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', left: '8%', right: '8%', height: '2px', background: 'rgba(255,112,67,0.9)', animation: 'scan-line 2s ease-in-out infinite', boxShadow: '0 0 8px rgba(255,112,67,0.8)', borderRadius: '2px' }} />
                      </div>
                      <div style={{ position: 'absolute', inset: '12px', pointerEvents: 'none', border: '2px solid rgba(255,112,67,0.4)', borderRadius: '10px' }} />
                      {scanFlash && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', animation: 'scan-flash 0.28s ease-out forwards', borderRadius: '16px' }} />}
                      {!cameraActive && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }}>
                          <p style={{ color: 'white', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px' }}>Starting camera…</p>
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <span style={{ fontFamily: "'Fredoka One',cursive", fontSize: '18px', color: '#2d2d2d' }}>
                        {barcodeBatch.length === 0 ? 'Point camera at a barcode' : `${barcodeBatch.length} item${barcodeBatch.length !== 1 ? 's' : ''} scanned`}
                      </span>
                      <button onClick={finishBarcodeScanning} style={{ ...btnBase, background: barcodeBatch.length > 0 ? 'linear-gradient(135deg,#4caf50,#66bb6a)' : '#f0f0f0', color: barcodeBatch.length > 0 ? 'white' : '#aaa', padding: '8px 18px', boxShadow: barcodeBatch.length > 0 ? '0 4px 12px rgba(76,175,80,0.35)' : 'none' }}>
                        {barcodeBatch.length > 0 ? '✓ Done scanning' : '← Back'}
                      </button>
                    </div>

                    {barcodeBatch.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
                        {barcodeBatch.map(item => (
                          <div key={item.id} style={{ background: 'white', borderRadius: '12px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', animation: 'scan-pop 0.25s ease-out' }}>
                            <span style={{ fontSize: '16px', flexShrink: 0 }}>
                              {item.lookupStatus === 'loading' ? '⏳' : item.lookupStatus === 'found' ? '✅' : '⚠️'}
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#2d2d2d', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {item.lookupStatus === 'loading' ? 'Looking up...' : item.name}
                              </p>
                              <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '11px', color: '#bbb', margin: 0 }}>{item.barcode}</p>
                            </div>
                            <span style={{ background: item.count !== '1' ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : '#f5f5f5', color: item.count !== '1' ? 'white' : '#888', fontFamily: "'Fredoka One',cursive", fontSize: '15px', borderRadius: '50px', minWidth: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px', flexShrink: 0 }}>
                              ×{item.count}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {/* ── Receipt upload ── */}
            {mode === 'receipt' && (
              <div style={{ background: 'white', borderRadius: '20px', padding: '28px 24px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', textAlign: 'center' }}>
                <div style={{ fontSize: '56px', marginBottom: '12px' }}>🧾</div>
                <h2 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '24px', color: '#2d2d2d', margin: '0 0 8px' }}>Scan a Receipt</h2>
                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#aaa', margin: '0 0 24px', lineHeight: 1.5 }}>
                  Take a photo of your grocery receipt. AI extracts all items automatically.
                </p>
                {receiptPreview && <img src={receiptPreview} alt="Receipt" style={{ maxWidth: '180px', maxHeight: '160px', borderRadius: '16px', marginBottom: '16px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }} />}
                <label style={{ background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontFamily: "'Fredoka One',cursive", fontSize: '18px', padding: '16px 36px', borderRadius: '50px', cursor: 'pointer', boxShadow: '0 8px 24px rgba(255,112,67,0.4)', display: 'inline-block', position: 'relative' }}>
                  {receiptLoading ? '✨ Scanning...' : '📷 Choose Receipt Photo'}
                  <input ref={receiptFileRef} type="file" accept="image/*" capture="environment" onChange={handleReceiptFile} disabled={receiptLoading} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                </label>
                {receiptLoading && <p style={{ color: '#ff7043', fontWeight: 700, fontSize: '15px', fontFamily: "'Nunito',sans-serif", marginTop: '12px' }}>AI is reading your receipt…</p>}
              </div>
            )}
          </>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            STEP: REVIEW — unified review screen
        ═══════════════════════════════════════════════════════════════════ */}
        {step === 'review' && (
          <>
            {/* Sub-header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div>
                {receiptRetailer && reviewBatch.some(i => i.source === 'receipt') && (
                  <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#888', margin: '0 0 2px' }}>
                    From {receiptRetailer}{receiptTotal ? ` — £${receiptTotal.toFixed(2)}` : ''}
                  </p>
                )}
                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#aaa', margin: 0 }}>
                  Edit details, then save
                </p>
              </div>
              <button onClick={goToChoose} style={{ ...btnBase, background: '#f5f5f5', color: '#888', padding: '8px 14px', fontSize: '13px' }}>
                + Add more
              </button>
            </div>

            {/* Voice expiry button (for receipt items) */}
            {reviewBatch.some(i => i.source === 'receipt') && (
              <div style={{ marginBottom: '16px' }}>
                <button onClick={startReceiptVoiceExpiry} disabled={rVoiceListening || rVoiceProcessing}
                  style={{ ...btnBase, display: 'flex', alignItems: 'center', gap: '10px', background: rVoiceListening ? 'linear-gradient(135deg,#ff4444,#ff6b6b)' : 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', boxShadow: '0 4px 16px rgba(255,112,67,0.35)', opacity: rVoiceProcessing ? 0.7 : 1 }}>
                  <span style={{ fontSize: '18px', animation: rVoiceListening ? 'voice-pulse 0.9s ease-in-out infinite' : 'none' }}>🎤</span>
                  {rVoiceListening ? 'Listening...' : rVoiceProcessing ? 'Understanding...' : 'Set expiry dates by voice'}
                </button>
                {rVoiceError && <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#ff4444', margin: '6px 0 0' }}>😕 {rVoiceError}</p>}
                {rVoiceFilled.length > 0 && (
                  <div style={{ background: '#f0fff4', border: '1.5px solid rgba(76,175,80,0.25)', borderRadius: '12px', padding: '10px 14px', marginTop: '10px' }}>
                    <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '14px', color: '#388e3c', margin: '0 0 6px' }}>✅ {rVoiceFilled.length} date{rVoiceFilled.length !== 1 ? 's' : ''} filled in</p>
                    {rVoiceFilled.map((f, i) => <p key={i} style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#555', margin: '2px 0' }}>{f.name} → {new Date(f.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>)}
                  </div>
                )}
              </div>
            )}

            {/* Review item cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
              {reviewBatch.map((item, index) => (
                <div key={item.id} style={{ background: 'white', borderRadius: '14px', padding: '14px 16px', boxShadow: '0 2px 10px rgba(0,0,0,0.07)', border: (item.confidence != null && item.confidence < 0.8) || item.lookupStatus === 'not_found' || item.lookupStatus === 'error' ? '2px solid rgba(255,179,71,0.6)' : '2px solid transparent' }}>

                  {/* Row 1: source icon / checkbox + name + remove */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                    {item.source === 'receipt' ? (
                      <input type="checkbox" checked={item.selected} onChange={e => updateReviewItem(index, { selected: e.target.checked })} style={{ width: '18px', height: '18px', accentColor: '#ff7043', flexShrink: 0, cursor: 'pointer' }} />
                    ) : (
                      <span style={{ fontSize: '15px', flexShrink: 0 }}>
                        {item.source === 'barcode'
                          ? (item.lookupStatus === 'loading' ? '⏳' : item.lookupStatus === 'found' ? '✅' : '⚠️')
                          : item.source === 'voice' ? '🎤' : '📝'}
                      </span>
                    )}
                    <input type="text" value={item.name}
                      onChange={e => updateReviewItem(index, { name: e.target.value })}
                      style={{ flex: 1, border: '2px solid #eee', borderRadius: '8px', padding: '7px 10px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#2d2d2d', minWidth: 0 }} />
                    {item.confidence != null && item.confidence < 0.8 && (
                      <span style={{ background: 'rgba(255,179,71,0.15)', color: '#e08000', fontSize: '11px', fontWeight: 700, padding: '3px 7px', borderRadius: '50px', fontFamily: "'Nunito',sans-serif", flexShrink: 0 }}>⚠ low</span>
                    )}
                    <button onClick={() => removeReviewItem(index)} style={{ background: 'none', border: 'none', color: '#ddd', fontSize: '16px', cursor: 'pointer', flexShrink: 0, padding: '4px', lineHeight: 1 }}>✕</button>
                  </div>

                  {/* Row 2: count × amount + unit + price */}
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input type="number" min={1} step={1} value={item.count}
                        onChange={e => updateReviewItem(index, { count: e.target.value })}
                        style={{ ...smallField, width: '52px', textAlign: 'center' }} title="Count" />
                      <span style={{ color: '#ccc', fontWeight: 700, fontSize: '14px' }}>×</span>
                      <input type="number" min={0} step={0.1} value={item.amountPerUnit} placeholder="amt"
                        onChange={e => updateReviewItem(index, { amountPerUnit: e.target.value })}
                        style={{ ...smallField, width: '60px', textAlign: 'center', color: item.amountPerUnit ? '#2d2d2d' : '#bbb' }} title="Amount per unit" />
                    </div>
                    <select value={item.unit} onChange={e => updateReviewItem(index, { unit: e.target.value })} style={smallField}>
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginLeft: 'auto' }}>
                      <span style={{ color: '#bbb', fontWeight: 700, fontSize: '13px', fontFamily: "'Nunito',sans-serif" }}>£</span>
                      <input type="number" min={0} step={0.01} value={item.price ?? ''} placeholder="—"
                        onChange={e => updateReviewItem(index, { price: e.target.value !== '' ? Number(e.target.value) : null })}
                        style={{ ...smallField, width: '68px', textAlign: 'right', color: '#ff7043' }} />
                    </div>
                  </div>

                  {/* Row 3: location + category */}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: item.location !== 'household' ? '8px' : '0' }}>
                    <select value={item.location} onChange={e => updateReviewItem(index, { location: e.target.value as StorageLocation })} style={{ ...smallField, flex: 1 }}>
                      {LOCATIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                    <select value={item.category} onChange={e => updateReviewItem(index, { category: e.target.value })} style={{ ...smallField, flex: 1 }}>
                      <option value="">— category —</option>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>

                  {/* Row 4: expiry */}
                  {item.location !== 'household' && (
                    <input type="date" value={item.expiryDate}
                      onChange={e => updateReviewItem(index, { expiryDate: e.target.value })}
                      style={{ ...smallField, color: item.expiryDate ? '#2d2d2d' : '#bbb' }} />
                  )}
                </div>
              ))}
            </div>

            {/* Save button */}
            {reviewBatch.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', background: 'white', borderRadius: '16px', boxShadow: '0 2px 10px rgba(0,0,0,0.07)' }}>
                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, color: '#aaa', margin: '0 0 12px' }}>No items to save</p>
                <button onClick={goToChoose} style={{ ...btnBase, background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', padding: '12px 24px' }}>← Add items</button>
              </div>
            ) : (
              <button onClick={saveAll} disabled={saving || reviewBatch.filter(i => i.selected).length === 0}
                style={{ ...btnBase, width: '100%', background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontSize: '18px', padding: '16px', boxShadow: '0 8px 24px rgba(255,112,67,0.4)', fontFamily: "'Fredoka One',cursive", opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Saving...' : `Save ${reviewBatch.filter(i => i.selected).length} Item${reviewBatch.filter(i => i.selected).length !== 1 ? 's' : ''} to Inventory`}
              </button>
            )}
          </>
        )}

      </div>
    </main>
  )
}
