'use client'

import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { suggestLocation } from '@/lib/categoriser'
import { StorageLocation, ReviewItem } from '@/lib/types'

type Mode        = 'manual' | 'voice' | 'barcode' | 'receipt'
type BarcodePhase = 'idle' | 'scanning' | 'reviewing' | 'saved'
type ReceiptStep  = 'upload' | 'reviewing' | 'done'

// ── Single-item form (manual / voice modes) ──────────────────────────────────

type ItemForm = {
  name: string
  itemCount: string
  amountPerUnit: string
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

// ── Batch item (barcode mode) ────────────────────────────────────────────────

type BatchItem = {
  id: string
  barcode: string
  name: string
  count: string
  amountPerUnit: string
  unit: string
  location: StorageLocation
  category: string
  expiryDate: string
  price: number | null
  lookupStatus: 'loading' | 'found' | 'not_found' | 'error'
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
  name: '', itemCount: '1', amountPerUnit: '', quantity: '1', quantityOriginal: '1', unit: 'item',
  location: 'cupboard', category: '', expiryDate: '',
  retailer: '', purchaseDate: '', opened: false, openedAt: '',
})

// ── Page component ────────────────────────────────────────────────────────────

export default function AddPage() {
  // ── Mode / global ────────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('manual')

  // ── Single-item state (manual + voice) ───────────────────────────────────
  const [form, setForm]     = useState<ItemForm>(blankForm())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)

  // Voice state
  const [voiceListening,   setVoiceListening]   = useState(false)
  const [voiceProcessing,  setVoiceProcessing]  = useState(false)
  const [voiceTranscript,  setVoiceTranscript]  = useState('')
  const [voiceError,       setVoiceError]       = useState<string | null>(null)
  const [voiceFilled,      setVoiceFilled]      = useState(false)

  // ── Barcode batch state ───────────────────────────────────────────────────
  const [barcodePhase,  setBarcodePhase]  = useState<BarcodePhase>('idle')
  const [batchItems,    setBatchItems]    = useState<BatchItem[]>([])
  const [cameraActive,  setCameraActive]  = useState(false)
  const [cameraError,   setCameraError]   = useState<string | null>(null)
  const [scanFlash,     setScanFlash]     = useState(false)
  const [batchSaving,   setBatchSaving]   = useState(false)

  // Camera refs
  const videoRef         = useRef<HTMLVideoElement>(null)
  const streamRef        = useRef<MediaStream | null>(null)
  const scanIntervalRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const zxingControlsRef = useRef<{ stop: () => void } | null>(null)

  // Scan debounce refs (avoid re-scanning same barcode instantly)
  const lastBarcodeRef  = useRef('')
  const lastScanTimeRef = useRef(0)

  // ── Receipt state ─────────────────────────────────────────────────────────
  const [receiptStep,           setReceiptStep]           = useState<ReceiptStep>('upload')
  const [receiptLoading,        setReceiptLoading]        = useState(false)
  const [receiptRetailer,       setReceiptRetailer]       = useState('')
  const [receiptTotal,          setReceiptTotal]          = useState<number | null>(null)
  const [receiptItems,          setReceiptItems]          = useState<ReviewItem[]>([])
  const [receiptPreview,        setReceiptPreview]        = useState<string | null>(null)
  const [rVoiceListening,       setRVoiceListening]       = useState(false)
  const [rVoiceProcessing,      setRVoiceProcessing]      = useState(false)
  const [rVoiceFilled,          setRVoiceFilled]          = useState<{ name: string; date: string }[]>([])
  const [rVoiceError,           setRVoiceError]           = useState<string | null>(null)
  const receiptFileRef          = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => stopCamera()
  }, [])

  // ── Mode switch ───────────────────────────────────────────────────────────

  function switchMode(m: Mode) {
    if (m !== 'barcode') {
      stopCamera()
      setBarcodePhase('idle')
      setBatchItems([])
    }
    if (m !== 'receipt') {
      setReceiptStep('upload')
      setReceiptPreview(null)
      setReceiptItems([])
    }
    setMode(m)
    setVoiceError(null)
  }

  // ── Form helpers (manual / voice) ─────────────────────────────────────────

  function updateForm(patch: Partial<ItemForm>) {
    setForm(prev => ({ ...prev, ...patch }))
  }

  function autoFillLocation(name: string, category: string) {
    updateForm({ location: suggestLocation(name, category) })
  }

  // ── Voice add ──────────────────────────────────────────────────────────────

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
          quantity: String(r.quantity ?? r.amount_per_unit ?? 1),
          quantityOriginal: String(r.quantity_original ?? r.quantity ?? r.amount_per_unit ?? 1),
          unit: r.unit || 'item', location: (r.location as StorageLocation) || suggestLocation(r.name || '', r.category || ''),
          category: r.category || '', expiryDate: r.expiry_date || '', retailer: r.retailer || '',
          purchaseDate: '', opened: !!r.opened_at, openedAt: r.opened_at || '',
        })
        setVoiceFilled(true)
      } catch { setVoiceError('Could not understand — try speaking more clearly.') }
      setVoiceProcessing(false)
    }
  }

  // ── Single-item save (manual / voice) ─────────────────────────────────────

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id ?? null
    const qty = parseFloat(form.quantity) || 1
    const { error } = await supabase.from('inventory_items').insert({
      name: form.name.trim(),
      count: form.amountPerUnit ? (parseInt(form.itemCount) || 1) : ((parseInt(form.itemCount) || 1) > 1 ? parseInt(form.itemCount) : null),
      amount_per_unit: form.amountPerUnit ? parseFloat(form.amountPerUnit) : null,
      quantity: qty,
      quantity_original: parseFloat(form.quantityOriginal) || qty,
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
    setForm(blankForm()); setSaved(false); setVoiceTranscript(''); setVoiceFilled(false)
  }

  // ── Receipt — file upload ──────────────────────────────────────────────────

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
      setReceiptItems(result.items.map((item: any, i: number) => ({
        ...item,
        id: String(i),
        receipt_order: i,
        selected: true,
        amount_per_unit: null,
        location: suggestLocation(item.normalized_name, item.category) as StorageLocation,
        expiry_date: null,
      })))
      setReceiptStep('reviewing')
    } catch { alert('Something went wrong. Try again.') }
    setReceiptLoading(false)
  }

  function startReceiptVoiceExpiry() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { setRVoiceError("Voice input isn't supported in this browser. Try Chrome or Safari."); return }
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
      if (e.error !== 'no-speech') { clearTimeout(absoluteTimer); if (silenceTimer) clearTimeout(silenceTimer); setRVoiceListening(false); setRVoiceError("Couldn't hear you — please try again.") }
    }
    recognition.onend = async () => {
      clearTimeout(absoluteTimer); if (silenceTimer) clearTimeout(silenceTimer)
      setRVoiceListening(false)
      const transcript = finalTranscript.trim()
      if (!transcript) { setRVoiceError('No speech detected — try again.'); return }
      setRVoiceProcessing(true)
      try {
        const res = await fetch('/api/voice-expiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript, items: receiptItems.map(i => i.normalized_name) }) })
        const result = await res.json()
        if (result.error) throw new Error(result.error)
        const filled: { name: string; date: string }[] = []
        const updated = [...receiptItems]
        for (const match of (result.matches || [])) {
          const matchName = match.item_name.toLowerCase()
          const idx = updated.findIndex(i => i.normalized_name.toLowerCase() === matchName || i.normalized_name.toLowerCase().includes(matchName) || matchName.includes(i.normalized_name.toLowerCase()))
          if (idx !== -1 && match.expiry_date) { updated[idx] = { ...updated[idx], expiry_date: match.expiry_date }; filled.push({ name: updated[idx].normalized_name, date: match.expiry_date }) }
        }
        setReceiptItems(updated)
        if (filled.length > 0) setRVoiceFilled(filled); else setRVoiceError("Couldn't match any items — try again.")
      } catch { setRVoiceError('Something went wrong. Please try again.') }
      setRVoiceProcessing(false)
    }
  }

  async function handleReceiptSave() {
    const selected = receiptItems.filter(i => i.selected)
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id ?? null
    const { data: receiptData, error: receiptError } = await supabase
      .from('receipts').insert({ retailer_name: receiptRetailer, total: receiptTotal, user_id: userId }).select().single()
    if (receiptError) { alert('Error saving receipt: ' + receiptError.message); return }
    const receiptId = receiptData.id
    const { data: receiptItemsData, error: itemsError } = await supabase.from('receipt_items').insert(selected.map(item => ({
      receipt_id: receiptId, raw_text: item.name, normalized_name: item.normalized_name,
      quantity: item.quantity, unit: item.unit, category: item.category || null,
      confidence: item.confidence, price: item.price || null,
    }))).select()
    if (itemsError) { alert('Error saving items: ' + itemsError.message); return }
    const apu = (item: ReviewItem) => item.amount_per_unit
    const { error: inventoryError } = await supabase.from('inventory_items').insert(
      selected.map((item, i) => {
        const cnt = item.quantity > 1 && Number.isInteger(item.quantity) ? item.quantity : null
        const apuVal = apu(item)
        const qty = apuVal && cnt ? cnt * apuVal : apuVal ? apuVal : item.quantity
        return {
          name: item.normalized_name, quantity: qty, quantity_original: qty,
          count: apuVal ? (cnt ?? 1) : cnt,
          amount_per_unit: apuVal, unit: item.unit,
          location: item.location, category: item.category || null,
          expiry_date: item.expiry_date || null, receipt_item_id: receiptItemsData?.[i]?.id || null,
          retailer: receiptRetailer || null, source: 'receipt', status: 'active', user_id: userId,
        }
      })
    )
    if (inventoryError) { alert('Error saving to inventory: ' + inventoryError.message) } else { setReceiptStep('done') }
  }

  // ── Barcode — camera ───────────────────────────────────────────────────────

  // ── Barcode — audio feedback ───────────────────────────────────────────────

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

  // ── Barcode — camera ───────────────────────────────────────────────────────

  async function startCamera() {
    setCameraError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera not available on this device or browser.")
      return
    }

    const NativeBarcodeDetector = (window as any).BarcodeDetector

    if (NativeBarcodeDetector) {
      // ── Chrome / Android: native BarcodeDetector ────────────────────────
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        streamRef.current = stream
        setCameraActive(true); setBarcodePhase('scanning')
        await new Promise<void>(r => setTimeout(r, 80))
        if (!videoRef.current) return
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})

        const detector = new NativeBarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'],
        })
        scanIntervalRef.current = setInterval(async () => {
          const vid = videoRef.current
          if (!vid || vid.readyState < 2) return
          try {
            const codes = await detector.detect(vid)
            if (codes.length > 0) addToBatch(codes[0].rawValue)
          } catch {}
        }, 400)
      } catch {
        setCameraError("Couldn't access camera. Check camera permissions for this site.")
        setCameraActive(false)
      }
    } else {
      // ── iOS Safari / other: @zxing/browser decodeFromConstraints ──────────
      // ZXing manages getUserMedia + scanning loop internally.
      setCameraActive(true); setBarcodePhase('scanning')
      await new Promise<void>(r => setTimeout(r, 80))
      if (!videoRef.current) { setCameraActive(false); setBarcodePhase('idle'); return }
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const reader = new BrowserMultiFormatReader()
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } } },
          videoRef.current,
          (result) => { if (result) addToBatch(result.getText()) }
        )
        zxingControlsRef.current = controls
      } catch {
        setCameraError("Couldn't access camera. Check camera permissions for this site.")
        setCameraActive(false); setBarcodePhase('idle')
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

  function finishScanning() {
    stopCamera()
    setBarcodePhase(batchItems.length > 0 ? 'reviewing' : 'idle')
  }

  // ── Barcode — batch add / lookup ───────────────────────────────────────────

  async function addToBatch(barcode: string) {
    const now = Date.now()
    // Debounce: ignore same barcode within 2s (camera will re-detect on every frame)
    if (barcode === lastBarcodeRef.current && now - lastScanTimeRef.current < 2000) return
    lastBarcodeRef.current = barcode
    lastScanTimeRef.current = now

    // Haptic + audio + visual feedback
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(60)
    beep()
    setScanFlash(true); setTimeout(() => setScanFlash(false), 280)

    // Duplicate barcode — increment count using functional update (always reads latest state)
    let isDuplicate = false
    setBatchItems(prev => {
      const existIdx = prev.findIndex(i => i.barcode === barcode)
      if (existIdx !== -1) {
        isDuplicate = true
        return prev.map((item, i) =>
          i === existIdx ? { ...item, count: String(parseInt(item.count) + 1) } : item
        )
      }
      return prev
    })
    if (isDuplicate) return

    // New barcode — add placeholder row, then look up in background
    const id = `${barcode}-${now}`
    const placeholder: BatchItem = {
      id, barcode, name: barcode, count: '1', amountPerUnit: '', unit: 'item',
      location: 'cupboard', category: '', expiryDate: '', price: null, lookupStatus: 'loading',
    }
    setBatchItems(prev => [...prev, placeholder])

    try {
      const res = await fetch('/api/barcode', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode }),
      })
      const result = await res.json()
      setBatchItems(prev => prev.map(item => {
        if (item.id !== id) return item
        if (result.found && result.name) {
          const loc = suggestLocation(result.name, result.category || '')
          return {
            ...item,
            name: result.name,
            // API now returns count + amount_per_unit (not quantity)
            count: result.count != null && result.count > 1 ? String(result.count) : item.count,
            amountPerUnit: result.amount_per_unit != null ? String(result.amount_per_unit) : '',
            unit: result.unit || 'item',
            category: result.category || '',
            location: loc,
            lookupStatus: 'found',
          }
        }
        return { ...item, lookupStatus: 'not_found' }
      }))
    } catch {
      setBatchItems(prev => prev.map(item => item.id === id ? { ...item, lookupStatus: 'error' } : item))
    }
  }

  function updateBatchItem(idx: number, patch: Partial<BatchItem>) {
    setBatchItems(prev => prev.map((item, i) => i === idx ? { ...item, ...patch } : item))
  }

  function removeBatchItem(idx: number) {
    setBatchItems(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Batch save ─────────────────────────────────────────────────────────────

  async function saveBatch() {
    if (batchItems.length === 0) return
    setBatchSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id ?? null
    const inserts = batchItems.map(item => {
      const cnt = parseInt(item.count) || 1
      const apu = item.amountPerUnit ? parseFloat(item.amountPerUnit) : null
      const qty = apu ? cnt * apu : cnt
      return {
        name: item.name.trim() || item.barcode,
        quantity: qty,
        quantity_original: qty,
        count: apu ? cnt : (cnt > 1 ? cnt : null),
        amount_per_unit: apu,
        unit: item.unit,
        location: item.location,
        category: item.category || null,
        expiry_date: item.expiryDate || null,
        receipt_item_id: null,
        source: 'barcode' as const,
        status: 'active' as const,
        user_id: userId,
      }
    })
    const { error } = await supabase.from('inventory_items').insert(inserts)
    setBatchSaving(false)
    if (error) { alert('Error saving: ' + error.message); return }
    setBarcodePhase('saved')
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
    color: '#aaa', marginBottom: '4px', display: 'block', textTransform: 'uppercase' as const, letterSpacing: '0.5px',
  }
  const btnBase: React.CSSProperties = {
    border: 'none', borderRadius: '50px', padding: '9px 18px',
    fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', cursor: 'pointer',
  }
  const bfs: React.CSSProperties = {
    border: '2px solid #eee', borderRadius: '8px', padding: '7px 8px',
    fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', background: 'white',
  }

  // ── Done screen (single-item) ──────────────────────────────────────────────

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

  // ── Batch saved screen ─────────────────────────────────────────────────────

  if (mode === 'barcode' && barcodePhase === 'saved') {
    return (
      <main style={{ ...warmStyle, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>
        <div style={{ fontSize: '64px', marginBottom: '16px' }}>🎉</div>
        <h1 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '36px', color: '#2d2d2d', margin: '0 0 8px' }}>{batchItems.length} item{batchItems.length !== 1 ? 's' : ''} saved!</h1>
        <p style={{ color: '#aaa', fontWeight: 700, fontSize: '15px', margin: '0 0 32px', textAlign: 'center' }}>Added to your inventory</p>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={() => { setBarcodePhase('idle'); setBatchItems([]) }} style={{ ...btnBase, background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontSize: '16px', padding: '12px 28px', boxShadow: '0 6px 20px rgba(255,112,67,0.4)' }}>
            Scan More
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
        @keyframes voice-pulse  { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.12);opacity:0.85} }
        @keyframes scan-line    { 0%,100%{top:8%} 50%{top:82%} }
        @keyframes scan-flash   { 0%{opacity:0.55} 100%{opacity:0} }
        @keyframes scan-pop     { 0%{transform:scale(0.9);opacity:0} 60%{transform:scale(1.04)} 100%{transform:scale(1);opacity:1} }
      `}</style>

      <div style={{ maxWidth: '640px', margin: '0 auto' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <a href="/" style={{ color: '#ff7043', fontWeight: 700, fontSize: '14px', textDecoration: 'none' }}>← Home</a>
          <h1 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '32px', color: '#2d2d2d', margin: 0, flex: 1 }}>Add Item</h1>
        </div>

        {/* ── Mode tabs ── */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap' }}>
          {([
            { id: 'manual',  label: '📝 Manual'  },
            { id: 'voice',   label: '🎤 Voice'   },
            { id: 'barcode', label: '📷 Barcode'  },
            { id: 'receipt', label: '🧾 Receipt'  },
          ] as { id: Mode; label: string }[]).map(tab => (
            <button key={tab.id} onClick={() => switchMode(tab.id)} style={{ ...btnBase, flex: '1 1 auto', background: mode === tab.id ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : 'white', color: mode === tab.id ? 'white' : '#888', boxShadow: mode === tab.id ? '0 4px 12px rgba(255,112,67,0.35)' : '0 2px 8px rgba(0,0,0,0.07)', fontSize: '13px', padding: '9px 10px' }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            BARCODE BATCH SCANNING FLOW
        ══════════════════════════════════════════════════════════════════ */}
        {mode === 'barcode' && (
          <>
            {/* ── Phase: idle ── */}
            {barcodePhase === 'idle' && (
              <div style={{ background: 'white', borderRadius: '20px', padding: '28px 24px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', textAlign: 'center' }}>
                <div style={{ fontSize: '56px', marginBottom: '12px' }}>📦</div>
                <h2 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '26px', color: '#2d2d2d', margin: '0 0 8px' }}>
                  Scan Your Shopping
                </h2>
                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#aaa', margin: '0 0 24px', lineHeight: 1.5 }}>
                  Point the camera at each barcode. Items are added to a list — review and save together.
                </p>
                {cameraError && (
                  <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#ff4444', margin: '0 0 16px' }}>
                    ⚠ {cameraError}
                  </p>
                )}
                <button
                  onClick={startCamera}
                  style={{ ...btnBase, background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontSize: '18px', padding: '16px 40px', boxShadow: '0 8px 24px rgba(255,112,67,0.4)', fontFamily: "'Fredoka One',cursive", display: 'inline-flex', alignItems: 'center', gap: '10px' }}
                >
                  <span style={{ fontSize: '24px' }}>📷</span> Start Scanning
                </button>
              </div>
            )}

            {/* ── Phase: scanning ── */}
            {barcodePhase === 'scanning' && (
              <>
                {/* Camera viewfinder — embedded live scanner, always visible */}
                <div style={{ background: '#000', borderRadius: '16px', overflow: 'hidden', marginBottom: '14px', position: 'relative' }}>
                  <video ref={videoRef} muted playsInline style={{ width: '100%', maxHeight: '280px', objectFit: 'cover', display: 'block' }} />
                  {/* Animated scan line */}
                  <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', left: '8%', right: '8%', height: '2px', background: 'rgba(255,112,67,0.9)', animation: 'scan-line 2s ease-in-out infinite', boxShadow: '0 0 8px rgba(255,112,67,0.8)', borderRadius: '2px' }} />
                  </div>
                  {/* Corner brackets */}
                  <div style={{ position: 'absolute', inset: '12px', pointerEvents: 'none', border: '2px solid rgba(255,112,67,0.4)', borderRadius: '10px' }} />
                  {/* Flash overlay on successful scan */}
                  {scanFlash && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', animation: 'scan-flash 0.28s ease-out forwards', borderRadius: '16px' }} />}
                  {/* Starting indicator */}
                  {!cameraActive && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }}>
                      <p style={{ color: 'white', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px' }}>Starting camera…</p>
                    </div>
                  )}
                </div>

                {/* Scanned count header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ fontFamily: "'Fredoka One',cursive", fontSize: '18px', color: '#2d2d2d' }}>
                    {batchItems.length === 0 ? 'Point camera at a barcode' : `${batchItems.length} item${batchItems.length !== 1 ? 's' : ''} scanned`}
                  </span>
                  <button onClick={finishScanning} style={{ ...btnBase, background: batchItems.length > 0 ? 'linear-gradient(135deg,#4caf50,#66bb6a)' : '#f0f0f0', color: batchItems.length > 0 ? 'white' : '#aaa', padding: '8px 18px', boxShadow: batchItems.length > 0 ? '0 4px 12px rgba(76,175,80,0.35)' : 'none' }}>
                    {batchItems.length > 0 ? '✓ Done scanning' : '← Back'}
                  </button>
                </div>

                {/* Running batch list (compact) */}
                {batchItems.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
                    {batchItems.map((item) => (
                      <div key={item.id} style={{ background: 'white', borderRadius: '12px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', animation: 'scan-pop 0.25s ease-out' }}>
                        <span style={{ fontSize: '16px', flexShrink: 0 }}>
                          {item.lookupStatus === 'loading' ? '⏳' : item.lookupStatus === 'found' ? '✅' : '⚠️'}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#2d2d2d', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.lookupStatus === 'loading' ? 'Looking up...' : item.name}
                          </p>
                          <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '11px', color: '#bbb', margin: 0 }}>
                            {item.barcode}
                          </p>
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

            {/* ── Phase: reviewing ── */}
            {barcodePhase === 'reviewing' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <div>
                    <h2 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '26px', color: '#2d2d2d', margin: 0 }}>Review Batch</h2>
                    <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#aaa', margin: 0 }}>
                      {batchItems.length} item{batchItems.length !== 1 ? 's' : ''} — edit then save
                    </p>
                  </div>
                  <button onClick={() => { setBarcodePhase('idle'); startCamera() }} style={{ ...btnBase, background: '#f5f5f5', color: '#888', padding: '8px 16px', fontSize: '13px' }}>
                    + Scan more
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                  {batchItems.map((item, i) => (
                    <div key={item.id} style={{ background: 'white', borderRadius: '14px', padding: '14px 16px', boxShadow: '0 2px 10px rgba(0,0,0,0.07)', border: item.lookupStatus === 'not_found' || item.lookupStatus === 'error' ? '2px solid rgba(255,179,71,0.6)' : '2px solid transparent' }}>

                      {/* Row 1: status icon + name + remove */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                        <span style={{ fontSize: '15px', flexShrink: 0 }}>
                          {item.lookupStatus === 'loading' ? '⏳' : item.lookupStatus === 'found' ? '✅' : '⚠️'}
                        </span>
                        <input
                          type="text"
                          value={item.name}
                          placeholder={item.barcode}
                          onChange={e => updateBatchItem(i, { name: e.target.value })}
                          style={{ flex: 1, border: '2px solid #eee', borderRadius: '8px', padding: '7px 10px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#2d2d2d', minWidth: 0 }}
                        />
                        <button onClick={() => removeBatchItem(i)} style={{ background: 'none', border: 'none', color: '#ddd', fontSize: '16px', cursor: 'pointer', flexShrink: 0, padding: '4px', lineHeight: 1 }}>✕</button>
                      </div>

                      {/* Row 2: count × amount + unit + price */}
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <input type="number" min={1} step={1} value={item.count} onChange={e => updateBatchItem(i, { count: e.target.value })} style={{ ...bfs, width: '52px', textAlign: 'center' }} title="Count" />
                          <span style={{ color: '#ccc', fontWeight: 700, fontSize: '14px' }}>×</span>
                          <input type="number" min={0} step={0.1} value={item.amountPerUnit} placeholder="amt" onChange={e => updateBatchItem(i, { amountPerUnit: e.target.value })} style={{ ...bfs, width: '60px', textAlign: 'center' }} title="Amount per unit" />
                        </div>
                        <select value={item.unit} onChange={e => updateBatchItem(i, { unit: e.target.value })} style={bfs}>
                          {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginLeft: 'auto' }}>
                          <span style={{ color: '#bbb', fontWeight: 700, fontSize: '13px', fontFamily: "'Nunito',sans-serif" }}>£</span>
                          <input type="number" min={0} step={0.01} value={item.price ?? ''} placeholder="—" onChange={e => updateBatchItem(i, { price: e.target.value !== '' ? Number(e.target.value) : null })} style={{ ...bfs, width: '68px', textAlign: 'right', color: '#ff7043' }} />
                        </div>
                      </div>

                      {/* Row 3: location + category */}
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: item.location !== 'household' ? '8px' : '0' }}>
                        <select value={item.location} onChange={e => updateBatchItem(i, { location: e.target.value as StorageLocation })} style={{ ...bfs, flex: 1 }}>
                          {LOCATIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                        </select>
                        <select value={item.category} onChange={e => updateBatchItem(i, { category: e.target.value })} style={{ ...bfs, flex: 1 }}>
                          <option value="">— category —</option>
                          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>

                      {/* Row 4: expiry */}
                      {item.location !== 'household' && (
                        <input type="date" value={item.expiryDate} onChange={e => updateBatchItem(i, { expiryDate: e.target.value })} style={{ ...bfs, color: item.expiryDate ? '#2d2d2d' : '#bbb' }} />
                      )}
                    </div>
                  ))}
                </div>

                <button
                  onClick={saveBatch}
                  disabled={batchSaving || batchItems.length === 0}
                  style={{ ...btnBase, width: '100%', background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontSize: '18px', padding: '16px', boxShadow: '0 8px 24px rgba(255,112,67,0.4)', fontFamily: "'Fredoka One',cursive", opacity: batchSaving ? 0.7 : 1 }}
                >
                  {batchSaving ? 'Saving...' : `Save ${batchItems.length} item${batchItems.length !== 1 ? 's' : ''} to Inventory`}
                </button>
              </>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            VOICE TAB CONTROLS
        ══════════════════════════════════════════════════════════════════ */}
        {mode === 'voice' && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '20px', marginBottom: '16px', boxShadow: '0 4px 16px rgba(0,0,0,0.07)' }}>
            <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#aaa', margin: '0 0 12px' }}>
              Describe what you want to add. For example: "I've got milk, about half a bottle left, use by Friday"
            </p>
            <button
              onClick={startVoice}
              disabled={voiceListening || voiceProcessing}
              style={{ ...btnBase, width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '10px', background: voiceListening ? 'linear-gradient(135deg,#ff4444,#ff6b6b)' : 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontSize: '16px', padding: '14px', boxShadow: voiceListening ? '0 6px 20px rgba(255,68,68,0.4)' : '0 6px 20px rgba(255,112,67,0.35)', opacity: voiceProcessing ? 0.7 : 1 }}
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
            {voiceFilled && <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#4caf50', margin: '10px 0 0' }}>✅ Fields filled in below — review and save</p>}
            {voiceError && <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#ff4444', margin: '10px 0 0' }}>😕 {voiceError}</p>}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            SHARED ITEM FORM (manual + voice only)
        ══════════════════════════════════════════════════════════════════ */}
        {mode !== 'barcode' && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 16px rgba(0,0,0,0.07)' }}>
            <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '18px', color: '#2d2d2d', margin: '0 0 16px' }}>Item Details</p>

            {/* Name */}
            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>Name *</label>
              <input type="text" placeholder="e.g. Semi-Skimmed Milk" value={form.name} autoFocus={mode === 'manual'}
                onChange={e => { updateForm({ name: e.target.value }); if (!form.category) autoFillLocation(e.target.value, '') }}
                style={inputStyle} />
            </div>

            {/* Count × size each + unit */}
            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>Quantity</label>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ ...labelStyle, fontSize: '10px', marginBottom: '3px' }}>Count</label>
                  <input type="number" min={1} step={1} placeholder="1" value={form.itemCount}
                    onChange={e => {
                      const cnt = e.target.value
                      const apu = parseFloat(form.amountPerUnit)
                      const qty = apu > 0 ? String((parseInt(cnt) || 1) * apu) : cnt
                      updateForm({ itemCount: cnt, quantity: qty, quantityOriginal: qty })
                    }}
                    style={{ ...inputStyle, textAlign: 'center' }} />
                </div>
                <span style={{ color: '#ccc', fontWeight: 700, fontSize: '18px', paddingBottom: '11px', flexShrink: 0 }}>×</span>
                <div style={{ flex: 1 }}>
                  <label style={{ ...labelStyle, fontSize: '10px', marginBottom: '3px' }}>Size each</label>
                  <input type="number" min={0} step={0.1} placeholder="—" value={form.amountPerUnit}
                    onChange={e => {
                      const apu = e.target.value
                      const apuNum = parseFloat(apu)
                      const cnt = parseInt(form.itemCount) || 1
                      const qty = apuNum > 0 ? String(cnt * apuNum) : String(cnt)
                      updateForm({ amountPerUnit: apu, quantity: qty, quantityOriginal: qty })
                    }}
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
                e.g. 6 × 330 ml cans, or just 1 × 750 ml bottle
              </p>
            </div>

            {/* Location */}
            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>Location</label>
              <select value={form.location} onChange={e => updateForm({ location: e.target.value as StorageLocation })} style={selectStyle}>
                {LOCATIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>

            {/* Category */}
            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>Category</label>
              <select value={form.category} onChange={e => { updateForm({ category: e.target.value }); autoFillLocation(form.name, e.target.value) }} style={selectStyle}>
                <option value="">— Select category —</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* Expiry */}
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

            {/* Retailer */}
            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>Retailer (optional)</label>
              <input type="text" placeholder="e.g. Tesco, Waitrose, or leave blank" value={form.retailer} onChange={e => updateForm({ retailer: e.target.value })} style={inputStyle} />
            </div>

            {/* Purchase date */}
            <div style={{ marginBottom: '20px' }}>
              <label style={labelStyle}>Purchase date (optional)</label>
              <input type="date" value={form.purchaseDate} onChange={e => updateForm({ purchaseDate: e.target.value })} style={inputStyle} />
            </div>

            {/* Save */}
            <button onClick={handleSave} disabled={saving || !form.name.trim()}
              style={{ ...btnBase, width: '100%', background: !form.name.trim() ? '#eee' : 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: !form.name.trim() ? '#bbb' : 'white', fontSize: '18px', padding: '16px', boxShadow: form.name.trim() ? '0 8px 24px rgba(255,112,67,0.4)' : 'none', fontFamily: "'Fredoka One',cursive", cursor: !form.name.trim() ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving...' : `Save${form.name.trim() ? ` "${form.name.trim()}"` : ''} to Inventory`}
            </button>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            RECEIPT SCANNING MODE
        ══════════════════════════════════════════════════════════════════ */}
        {mode === 'receipt' && (
          <>
            {receiptStep === 'upload' && (
              <div style={{ background: 'white', borderRadius: '20px', padding: '28px 24px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', textAlign: 'center' }}>
                <div style={{ fontSize: '56px', marginBottom: '12px' }}>🧾</div>
                <h2 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '26px', color: '#2d2d2d', margin: '0 0 8px' }}>Scan a Receipt</h2>
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

            {receiptStep === 'reviewing' && (() => {
              const REVIEW_UNITS = ['g', 'kg', 'ml', 'l', 'item', 'pack', 'bag', 'box', 'bottle', 'tin', 'loaf', 'fillet']
              const REVIEW_CATS  = ['dairy', 'meat', 'fish', 'vegetables', 'fruit', 'bakery', 'tinned', 'dry goods', 'oils', 'frozen', 'drinks', 'snacks', 'alcohol', 'household', 'other']
              const fs: React.CSSProperties = { border: '2px solid #eee', borderRadius: '8px', padding: '7px 8px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', background: 'white' }
              return (
                <>
                  <div style={{ marginBottom: '16px' }}>
                    <h2 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '26px', color: '#2d2d2d', margin: '0 0 4px' }}>Review Items</h2>
                    <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#888', margin: '0 0 4px' }}>From {receiptRetailer} — edit anything wrong</p>
                    {receiptTotal && <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: '14px', color: '#ff7043', margin: 0 }}>Total: £{receiptTotal.toFixed(2)}</p>}
                  </div>

                  {/* Voice expiry */}
                  <div style={{ marginBottom: '16px' }}>
                    <button onClick={startReceiptVoiceExpiry} disabled={rVoiceListening || rVoiceProcessing}
                      style={{ ...btnBase, display: 'flex', alignItems: 'center', gap: '10px', background: rVoiceListening ? 'linear-gradient(135deg,#ff4444,#ff6b6b)' : 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', boxShadow: '0 4px 16px rgba(255,112,67,0.35)', opacity: rVoiceProcessing ? 0.7 : 1 }}>
                      <span style={{ fontSize: '18px', animation: rVoiceListening ? 'voice-pulse 0.9s ease-in-out infinite' : 'none' }}>🎤</span>
                      {rVoiceListening ? 'Listening...' : rVoiceProcessing ? 'Understanding...' : 'Set expiry dates by voice'}
                    </button>
                    {rVoiceError && <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#ff4444', margin: '6px 0 0' }}>😕 {rVoiceError}</p>}
                    {rVoiceFilled.length > 0 && (
                      <div style={{ background: '#f0fff4', border: '1.5px solid rgba(76,175,80,0.25)', borderRadius: '12px', padding: '10px 14px', marginTop: '10px' }}>
                        <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '14px', color: '#388e3c', margin: '0 0 6px' }}>✅ {rVoiceFilled.length} expiry date{rVoiceFilled.length !== 1 ? 's' : ''} filled in</p>
                        {rVoiceFilled.map((f, i) => <p key={i} style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#555', margin: '2px 0' }}>{f.name} → {new Date(f.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>)}
                      </div>
                    )}
                  </div>

                  {/* Item cards */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                    {receiptItems.map((item, index) => {
                      function upd(patch: Partial<ReviewItem>) {
                        const next = [...receiptItems]; next[index] = { ...next[index], ...patch }; setReceiptItems(next)
                      }
                      const safeUnit = REVIEW_UNITS.includes(item.unit) ? item.unit : 'g'
                      return (
                        <div key={item.id} style={{ background: 'white', borderRadius: '14px', padding: '14px 16px', boxShadow: '0 2px 10px rgba(0,0,0,0.07)', border: item.confidence < 0.8 ? '2px solid rgba(255,179,71,0.6)' : '2px solid transparent' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                            <input type="checkbox" checked={item.selected} onChange={e => upd({ selected: e.target.checked })} style={{ width: '18px', height: '18px', accentColor: '#ff7043', flexShrink: 0 }} />
                            <input type="text" value={item.normalized_name} onChange={e => upd({ normalized_name: e.target.value })} style={{ flex: 1, border: '2px solid #eee', borderRadius: '8px', padding: '8px 10px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#2d2d2d', minWidth: 0 }} />
                            {item.confidence < 0.8 && <span style={{ background: 'rgba(255,179,71,0.15)', color: '#e08000', fontSize: '11px', fontWeight: 700, padding: '3px 7px', borderRadius: '50px', fontFamily: "'Nunito',sans-serif", flexShrink: 0 }}>⚠ low</span>}
                          </div>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <input type="number" min={1} step={1} value={item.quantity} onChange={e => upd({ quantity: Number(e.target.value) })} style={{ ...fs, width: '52px', textAlign: 'center' }} title="Count" />
                              <span style={{ color: '#ccc', fontWeight: 700, fontSize: '14px' }}>×</span>
                              <input type="number" min={0} step={0.1} value={item.amount_per_unit ?? ''} placeholder="amt" onChange={e => upd({ amount_per_unit: e.target.value !== '' ? Number(e.target.value) : null })} style={{ ...fs, width: '60px', textAlign: 'center', color: item.amount_per_unit ? '#2d2d2d' : '#bbb' }} title="Amount per unit" />
                            </div>
                            <select value={safeUnit} onChange={e => upd({ unit: e.target.value })} style={fs}>
                              {REVIEW_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                            </select>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginLeft: 'auto' }}>
                              <span style={{ color: '#bbb', fontWeight: 700, fontSize: '13px', fontFamily: "'Nunito',sans-serif" }}>£</span>
                              <input type="number" min={0} step={0.01} value={item.price ?? ''} placeholder="—" onChange={e => upd({ price: e.target.value !== '' ? Number(e.target.value) : null })} style={{ ...fs, width: '70px', color: '#ff7043', textAlign: 'right' }} />
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: item.location !== 'household' ? '8px' : '0' }}>
                            <select value={item.location} onChange={e => upd({ location: e.target.value as StorageLocation })} style={{ ...fs, flex: 1 }}>
                              <option value="fridge">❄️ Fridge</option><option value="freezer">🧊 Freezer</option><option value="cupboard">🗄️ Cupboard</option><option value="household">🏠 Household</option><option value="other">📦 Other</option>
                            </select>
                            <select value={item.category || ''} onChange={e => upd({ category: e.target.value || null })} style={{ ...fs, flex: 1 }}>
                              <option value="">— category —</option>{REVIEW_CATS.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                          {item.location !== 'household' && <input type="date" value={item.expiry_date || ''} onChange={e => upd({ expiry_date: e.target.value || null })} style={{ ...fs, color: item.expiry_date ? '#2d2d2d' : '#bbb' }} />}
                        </div>
                      )
                    })}
                  </div>
                  <button onClick={handleReceiptSave} style={{ width: '100%', background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontFamily: "'Fredoka One',cursive", fontSize: '20px', padding: '16px', borderRadius: '50px', border: 'none', cursor: 'pointer', boxShadow: '0 8px 24px rgba(255,112,67,0.4)' }}>
                    Save {receiptItems.filter(i => i.selected).length} Items to Inventory
                  </button>
                </>
              )
            })()}

            {receiptStep === 'done' && (
              <div style={{ textAlign: 'center', padding: '40px 24px' }}>
                <div style={{ fontSize: '64px', marginBottom: '16px' }}>🎉</div>
                <h2 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '36px', color: '#2d2d2d', margin: '0 0 8px' }}>Items Saved!</h2>
                <p style={{ color: '#888', fontWeight: 700, fontSize: '16px', margin: '0 0 8px', fontFamily: "'Nunito',sans-serif" }}>{receiptItems.filter(i => i.selected).length} items added to inventory</p>
                {receiptTotal && <p style={{ color: '#ff7043', fontWeight: 800, fontSize: '18px', margin: '0 0 32px', fontFamily: "'Nunito',sans-serif" }}>Total spend: £{receiptTotal.toFixed(2)}</p>}
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  <button onClick={() => { setReceiptStep('upload'); setReceiptPreview(null); setReceiptItems([]) }} style={{ ...btnBase, background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontSize: '16px', padding: '12px 28px', boxShadow: '0 6px 20px rgba(255,112,67,0.4)' }}>Scan Another</button>
                  <a href="/inventory" style={{ ...btnBase, background: 'white', color: '#ff7043', fontSize: '16px', padding: '12px 28px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', textDecoration: 'none' }}>View Inventory</a>
                </div>
              </div>
            )}
          </>
        )}

      </div>
    </main>
  )
}
