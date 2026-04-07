'use client'

import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { suggestLocation } from '@/lib/categoriser'
import { StorageLocation, ReceiptSourceType } from '@/lib/types'
import { compressImage } from '@/lib/compressImage'

// ── Step / mode types ─────────────────────────────────────────────────────────

type Step = 'choose' | 'capture' | 'review' | 'done'
type Mode = 'manual' | 'voice' | 'barcode' | 'receipt'
type LookupStatus = 'loading' | 'found' | 'not_found' | 'error' | 'known'

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
  isKnown?: boolean
  // receipt-specific
  confidence?: number
  // matching
  absorbed?: boolean
  matchedToId?: string
}

type MatchSuggestion = {
  id: string
  receiptItemId: string
  barcodeItemId: string
  confidence: number
  status: 'pending' | 'accepted' | 'rejected'
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
const CATEGORIES = ['dairy', 'meat', 'fish', 'vegetables', 'fruit', 'bakery', 'tinned', 'dry goods', 'oils', 'frozen', 'drinks', 'snacks', 'alcohol', 'household', 'pet', 'other']
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
  const [saving,        setSaving]        = useState(false)
  const [savedCount,    setSavedCount]    = useState(0)
  const [addedName,     setAddedName]     = useState<string | null>(null)
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())

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
  const lastBarcodeRef    = useRef('')
  const lastScanTimeRef   = useRef(0)
  const recognitionRef    = useRef<any>(null)

  // ── Receipt state ─────────────────────────────────────────────────────────
  const [receiptLoading,    setReceiptLoading]    = useState(false)
  const [receiptRetailer,   setReceiptRetailer]   = useState('')
  const [receiptTotal,      setReceiptTotal]      = useState<number | null>(null)
  const [receiptPreview,    setReceiptPreview]    = useState<string | null>(null)
  const [receiptSourceType, setReceiptSourceType] = useState<ReceiptSourceType>('photo')
  const [receiptRawText,    setReceiptRawText]    = useState<string | null>(null)
  const [pasteText,         setPasteText]         = useState('')
  const [pasteVisible,      setPasteVisible]      = useState(false)
  const [rVoiceListening,   setRVoiceListening]   = useState(false)
  const [rVoiceProcessing,  setRVoiceProcessing]  = useState(false)
  const [rVoiceFilled,      setRVoiceFilled]      = useState<{ name: string; date: string }[]>([])
  const [rVoiceError,       setRVoiceError]       = useState<string | null>(null)
  const [rVoiceTranscript,  setRVoiceTranscript]  = useState<string>('')
  const [voiceExpiryOpen,   setVoiceExpiryOpen]   = useState(false)
  const receiptFileRef = useRef<HTMLInputElement>(null)
  const [matchSuggestions, setMatchSuggestions] = useState<MatchSuggestion[]>([])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const m = params.get('mode') as Mode | null
    if (m && ['receipt', 'barcode', 'manual', 'voice'].includes(m)) {
      goToCapture(m)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    setReceiptSourceType('photo')
    setReceiptRawText(null)
    setPasteText('')
    setPasteVisible(false)
    setForm(blankForm())
    setVoiceError(null)
    setVoiceFilled(false)
    setVoiceTranscript('')
    setAddedName(null)
    setMatchSuggestions([])
    setExpandedItems(new Set())
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

  function stopVoice() {
    recognitionRef.current?.stop()
  }

  function startVoice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { setVoiceError("Voice input isn't supported in this browser. Try Chrome."); return }
    const recognition = new SR()
    recognitionRef.current = recognition
    recognition.lang = 'en-GB'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    let finalTranscript = ''
    const absoluteTimer = setTimeout(() => recognition.stop(), 30000)
    setVoiceListening(true); setVoiceError(null); setVoiceFilled(false); setVoiceTranscript('')
    recognition.start()
    recognition.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript + ' '
      }
      setVoiceTranscript(finalTranscript.trim())
    }
    recognition.onerror = (e: any) => {
      if (e.error !== 'no-speech') {
        clearTimeout(absoluteTimer)
        setVoiceListening(false); setVoiceError("Couldn't hear you — try again.")
      }
    }
    recognition.onend = async () => {
      clearTimeout(absoluteTimer)
      recognitionRef.current = null
      setVoiceListening(false)
      const transcript = finalTranscript.trim()
      if (!transcript) { setVoiceError('No speech detected — tap the mic and try again.'); return }
      setVoiceProcessing(true)
      try {
        const res = await fetch('/api/voice-add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript }) })
        const r = await res.json()
        if (r.error) throw new Error(r.error)
        const parsed: any[] = Array.isArray(r) ? r : [r]
        const newItems: ReviewBatchItem[] = parsed.map((item: any) => ({
          id: `voice-${Date.now()}-${Math.random()}`,
          source: 'voice' as Mode,
          name: item.name || '',
          count: String(item.count ?? 1),
          amountPerUnit: item.amount_per_unit != null ? String(item.amount_per_unit) : '',
          unit: item.unit || 'item',
          location: (item.location as StorageLocation) || suggestLocation(item.name || '', item.category || ''),
          category: item.category || '',
          expiryDate: item.expiry_date || '',
          retailer: item.retailer || '',
          price: null,
          selected: true,
          openedAt: item.opened_at || '',
        }))
        setReviewBatch(prev => [...prev, ...newItems])
        setStep('review')
        setVoiceProcessing(false)
        return
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

  // ── Receipt + barcode matching ────────────────────────────────────────────

  function tokenSimilarity(a: string, b: string): number {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
    const na = norm(a), nb = norm(b)
    if (na === nb) return 1
    const ta = new Set(na.split(/\s+/).filter(t => t.length > 2))
    const tb = new Set(nb.split(/\s+/).filter(t => t.length > 2))
    if (ta.size === 0 || tb.size === 0) return (na.includes(nb) || nb.includes(na)) ? 0.5 : 0
    const inter = [...ta].filter(t => tb.has(t)).length
    return inter / new Set([...ta, ...tb]).size
  }

  function runAutoMatch(batch: ReviewBatchItem[]): { updatedBatch: ReviewBatchItem[]; suggestions: MatchSuggestion[] } {
    const receiptItems = batch.filter(i => i.source === 'receipt' && !i.absorbed && !i.matchedToId)
    const barcodeItems = batch.filter(i => i.source === 'barcode' && i.lookupStatus !== 'loading' && i.name !== i.barcode && !i.absorbed && !i.matchedToId)
    if (receiptItems.length === 0 || barcodeItems.length === 0) return { updatedBatch: batch, suggestions: [] }
    const suggestions: MatchSuggestion[] = []
    const updatedBatch = [...batch]
    const usedBarcodeIds = new Set<string>()
    for (const rItem of receiptItems) {
      let bestScore = 0, bestBarcodeItem: ReviewBatchItem | null = null
      for (const bItem of barcodeItems) {
        if (usedBarcodeIds.has(bItem.id)) continue
        let score = tokenSimilarity(bItem.name, rItem.name)
        if (bItem.category && rItem.category && bItem.category === rItem.category) score = Math.min(1, score + 0.15)
        if (score > bestScore) { bestScore = score; bestBarcodeItem = bItem }
      }
      if (!bestBarcodeItem || bestScore < 0.3) continue
      if (bestScore >= 0.75) {
        const bIdx = updatedBatch.findIndex(i => i.id === bestBarcodeItem!.id)
        if (bIdx !== -1) updatedBatch[bIdx] = { ...updatedBatch[bIdx], price: rItem.price ?? updatedBatch[bIdx].price, retailer: rItem.retailer || updatedBatch[bIdx].retailer, matchedToId: rItem.id }
        const rIdx = updatedBatch.findIndex(i => i.id === rItem.id)
        if (rIdx !== -1) updatedBatch[rIdx] = { ...updatedBatch[rIdx], absorbed: true, matchedToId: bestBarcodeItem.id }
        usedBarcodeIds.add(bestBarcodeItem.id)
      } else {
        suggestions.push({ id: `match-${rItem.id}-${bestBarcodeItem.id}`, receiptItemId: rItem.id, barcodeItemId: bestBarcodeItem.id, confidence: bestScore, status: 'pending' })
        usedBarcodeIds.add(bestBarcodeItem.id)
      }
    }
    return { updatedBatch, suggestions }
  }

  // Whether a review item should start expanded (full form) vs collapsed (compact view)
  function needsReview(item: ReviewBatchItem): boolean {
    if (item.source !== 'receipt') return true // manual / voice / barcode always show full form
    if (!item.name.trim()) return true
    if (item.confidence != null && item.confidence < 0.75) return true
    if (item.lookupStatus === 'not_found' || item.lookupStatus === 'error') return true
    return false
  }

  function isItemExpanded(item: ReviewBatchItem): boolean {
    if (expandedItems.has(item.id)) return true
    return needsReview(item)
  }

  function toggleItemExpanded(id: string) {
    setExpandedItems(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function acceptSuggestion(suggId: string) {
    const sugg = matchSuggestions.find(s => s.id === suggId)
    if (!sugg) return
    setReviewBatch(prev => {
      const rItem = prev.find(i => i.id === sugg.receiptItemId)
      return prev.map(item => {
        if (item.id === sugg.barcodeItemId) return { ...item, price: rItem?.price ?? item.price, retailer: rItem?.retailer || item.retailer, matchedToId: sugg.receiptItemId }
        if (item.id === sugg.receiptItemId) return { ...item, absorbed: true, matchedToId: sugg.barcodeItemId }
        return item
      })
    })
    setMatchSuggestions(prev => prev.map(s => s.id === suggId ? { ...s, status: 'accepted' } : s))
  }

  function rejectSuggestion(suggId: string) {
    setMatchSuggestions(prev => prev.map(s => s.id === suggId ? { ...s, status: 'rejected' } : s))
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
      barcode, lookupStatus: 'loading', isKnown: false,
    }
    setBarcodeBatch(prev => [...prev, placeholder])

    // 1. Check known_products first (user's learned memory)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const userId = session?.user?.id
      if (userId) {
        const { data: known } = await supabase
          .from('known_products')
          .select('*')
          .eq('user_id', userId)
          .eq('barcode', barcode)
          .maybeSingle()
        if (known) {
          setBarcodeBatch(prev => prev.map(item => item.id !== id ? item : {
            ...item,
            name: known.name,
            amountPerUnit: known.amount_per_unit != null ? String(known.amount_per_unit) : '',
            unit: known.unit,
            category: known.category || '',
            retailer: known.usual_retailer || '',
            location: suggestLocation(known.name, known.category || ''),
            lookupStatus: 'known',
            isKnown: true,
          }))
          return
        }
      }
    } catch { /* fall through to Open Food Facts */ }

    // 2. Fallback: Open Food Facts
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
      const snap = barcodeBatch
      setReviewBatch(prev => {
        const merged = [...prev, ...snap]
        const { updatedBatch, suggestions } = runAutoMatch(merged)
        if (suggestions.length > 0) setMatchSuggestions(s => [...s, ...suggestions])
        return updatedBatch
      })
      setBarcodeBatch([])
      setStep('review')
    }
  }

  // ── Receipt ───────────────────────────────────────────────────────────────

  // Shared: take a parsed receipt API response and push items into the review batch
  function applyReceiptResult(result: any) {
    setReceiptRetailer(result.retailer_name || 'Unknown Store')
    setReceiptTotal(result.total || null)
    const items: ReviewBatchItem[] = result.items.map((item: any, i: number) => ({
      id: `r-${Date.now()}-${i}`,
      source: 'receipt' as Mode,
      name: item.normalized_name,
      count: String(item.quantity || 1),
      amountPerUnit: item.amount_per_unit != null ? String(item.amount_per_unit) : '',
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
    setReviewBatch(prev => {
      const merged = [...prev, ...items]
      const { updatedBatch, suggestions } = runAutoMatch(merged)
      if (suggestions.length > 0) setMatchSuggestions(s => [...s, ...suggestions])
      return updatedBatch
    })
    setStep('review')
  }

  async function handleReceiptFile(e: React.ChangeEvent<HTMLInputElement>, explicitSource?: ReceiptSourceType) {
    const file = e.target.files?.[0]
    if (!file) return
    const isPDF = file.type === 'application/pdf'
    const source: ReceiptSourceType = isPDF ? 'digital_pdf' : (explicitSource ?? 'library_image')
    setReceiptSourceType(source)
    setReceiptRawText(null)
    if (!isPDF) {
      setReceiptPreview(URL.createObjectURL(file))
    } else {
      setReceiptPreview(null)
    }
    setReceiptLoading(true)
    // Compress large images (skip for PDFs)
    const uploadBlob = !isPDF && file.size > 1.4 * 1024 * 1024 ? await compressImage(file) : file
    const formData = new FormData()
    formData.append('receipt', uploadBlob)
    try {
      const res = await fetch('/api/parse-receipt', { method: 'POST', body: formData })
      const result = await res.json()
      if (result.error) { alert('Error: ' + result.error); setReceiptLoading(false); return }
      applyReceiptResult(result)
    } catch { alert('Something went wrong. Try again.') }
    setReceiptLoading(false)
  }

  async function handlePasteText() {
    if (!pasteText.trim()) return
    setReceiptSourceType('pasted_text')
    setReceiptRawText(pasteText.trim())
    setReceiptPreview(null)
    setReceiptLoading(true)
    try {
      const res = await fetch('/api/parse-receipt-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pasteText.trim() }),
      })
      const result = await res.json()
      if (result.error) { alert('Error: ' + result.error); setReceiptLoading(false); return }
      applyReceiptResult(result)
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
    const absoluteTimer = setTimeout(() => recognition.stop(), 15000)
    setRVoiceListening(true); setRVoiceFilled([]); setRVoiceError(null); setRVoiceTranscript('')
    recognition.start()
    recognition.onresult = (e: any) => {
      if (silenceTimer) clearTimeout(silenceTimer)
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript + ' '
        else interim += e.results[i][0].transcript
      }
      setRVoiceTranscript((finalTranscript + interim).trim())
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
      // Build numbered items list from receipt items (1-based index matching reviewBatch positions)
      const receiptIndices: { batchIndex: number; index: number; name: string }[] = []
      let counter = 1
      reviewBatch.forEach((item, batchIndex) => {
        if (item.source === 'receipt') {
          receiptIndices.push({ batchIndex, index: counter, name: item.name })
          counter++
        }
      })
      const numberedItems = receiptIndices.map(r => ({ index: r.index, name: r.name }))
      try {
        const res = await fetch('/api/voice-expiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript, items: numberedItems }) })
        const result = await res.json()
        if (result.error) throw new Error(result.error)
        // Compute updates OUTSIDE the state updater to avoid React batching issues
        const updates: Array<{ batchIndex: number; expiryDate: string; name: string }> = []
        for (const assignment of (result.assignments || [])) {
          const ri = receiptIndices.find(r => r.index === assignment.index)
          if (ri && assignment.expiry_date) {
            updates.push({ batchIndex: ri.batchIndex, expiryDate: assignment.expiry_date, name: ri.name })
          }
        }
        if (updates.length > 0) {
          setReviewBatch(prev => {
            const updated = [...prev]
            for (const u of updates) {
              updated[u.batchIndex] = { ...updated[u.batchIndex], expiryDate: u.expiryDate }
            }
            return updated
          })
          setRVoiceFilled(updates.map(u => ({ name: u.name, date: u.expiryDate })))
        } else {
          setRVoiceError("Couldn't match any items — try again.")
        }
      } catch { setRVoiceError('Something went wrong. Please try again.') }
      setRVoiceProcessing(false)
    }
  }

  // ── Unified save ──────────────────────────────────────────────────────────

  async function saveAll() {
    const toSave = reviewBatch.filter(i => i.selected && !i.absorbed)
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
        .insert({
          retailer_name: receiptRetailer,
          total: receiptTotal,
          user_id: userId,
          source_type: receiptSourceType,
          raw_text: receiptRawText,
        })
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
        price: item.price ?? null,
        price_source: item.price != null ? (item.source === 'receipt' ? 'receipt' : item.source === 'barcode' ? 'barcode' : 'manual') : null,
        barcode: item.barcode ?? null,
        receipt_item_id: receiptItemIdMap[item.id] ?? null,
        source: item.source,
        status: 'active' as const,
        user_id: userId,
      }
    })

    const { error } = await supabase.from('inventory_items').insert(inserts)
    setSaving(false)
    if (error) { alert('Error saving: ' + error.message); return }

    // Learn from barcode-scanned items: upsert to known_products
    if (userId) {
      const barcodeItems = toSave.filter(i => i.barcode)
      if (barcodeItems.length > 0) {
        const upsertData = barcodeItems.map(i => ({
          user_id: userId,
          barcode: i.barcode!,
          name: i.name.trim() || i.barcode!,
          category: i.category || null,
          amount_per_unit: i.amountPerUnit ? parseFloat(i.amountPerUnit) : null,
          unit: i.unit,
          usual_retailer: i.retailer || null,
          last_seen_at: new Date().toISOString(),
          times_purchased: 1,
        }))
        // On conflict, update name/category/amount/unit/retailer and increment times_purchased
        await supabase.from('known_products').upsert(upsertData, { onConflict: 'user_id,barcode' })
      }
    }

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
            {step === 'choose' ? 'Add Items' : step === 'capture' && mode === 'manual' ? 'Add Manually' : step === 'capture' && mode === 'voice' ? 'Voice Add' : step === 'capture' && mode === 'barcode' ? 'Scan Items' : step === 'capture' && mode === 'receipt' ? 'Add a Receipt' : `Review (${reviewBatch.length})`}
          </h1>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            STEP: CHOOSE — 4 option cards
        ═══════════════════════════════════════════════════════════════════ */}
        {step === 'choose' && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
              {/* Hero: Add a Receipt */}
              <button
                onClick={() => goToCapture('receipt')}
                style={{
                  background: 'linear-gradient(135deg, #fff8f5 0%, #fde8d0 100%)',
                  borderRadius: '20px',
                  padding: '22px 22px',
                  boxShadow: '0 4px 20px rgba(255,112,67,0.15)',
                  border: '2px solid rgba(255,112,67,0.25)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  width: '100%',
                }}
              >
                <div style={{ fontSize: '44px', lineHeight: 1, flexShrink: 0 }}>🧾</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'Fredoka One',cursive", fontSize: '22px', color: '#ff7043', marginBottom: '2px' }}>
                    Add a Receipt
                  </div>
                  <div style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '13px', color: '#c0896e', lineHeight: 1.4 }}>
                    Photo, PDF, or paste order text — AI extracts everything
                  </div>
                </div>
                <div style={{ color: 'rgba(255,112,67,0.4)', fontSize: '22px', flexShrink: 0 }}>›</div>
              </button>

              {/* Secondary options in a row */}
              <div style={{ display: 'flex', gap: '10px' }}>
                {([
                  { mode: 'barcode' as Mode, emoji: '📦', title: 'Scan Items', desc: 'Camera barcode scan' },
                  { mode: 'manual' as Mode,  emoji: '✍️', title: 'Add Manually', desc: 'Type or use voice' },
                ]).map(opt => (
                  <button
                    key={opt.mode}
                    onClick={() => goToCapture(opt.mode)}
                    style={{
                      flex: 1,
                      background: 'white',
                      borderRadius: '18px',
                      padding: '18px 14px',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
                      border: '2px solid transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ fontSize: '32px', lineHeight: 1, marginBottom: '8px' }}>{opt.emoji}</div>
                    <div style={{ fontFamily: "'Fredoka One',cursive", fontSize: '17px', color: '#2d2d2d', marginBottom: '2px' }}>
                      {opt.title}
                    </div>
                    <div style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '12px', color: '#ccc', lineHeight: 1.3 }}>
                      {opt.desc}
                    </div>
                  </button>
                ))}
              </div>
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
            {/* ── Voice capture (standalone — reachable via ?mode=voice URL param) ── */}
            {mode === 'voice' && (
              <div style={{ background: 'white', borderRadius: '16px', padding: '24px 20px', boxShadow: '0 4px 16px rgba(0,0,0,0.07)' }}>
                <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '20px', color: '#2d2d2d', margin: '0 0 6px' }}>
                  {voiceListening ? 'Recording…' : voiceProcessing ? 'Understanding…' : 'Speak your items'}
                </p>
                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#bbb', margin: '0 0 20px', lineHeight: 1.5 }}>
                  {voiceListening ? 'Describe your items, then tap Stop when done.' : 'e.g. "6 cans of Coke, milk 2 litres expiring Friday"'}
                </p>
                {!voiceListening && !voiceProcessing && (
                  <button onClick={startVoice} style={{ ...btnBase, background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontSize: '15px', padding: '13px 28px', boxShadow: '0 6px 20px rgba(255,112,67,0.4)', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    🎤 Start recording
                  </button>
                )}
                {voiceListening && (
                  <button onClick={stopVoice} style={{ ...btnBase, background: 'linear-gradient(135deg,#ff4444,#ff6b6b)', color: 'white', fontSize: '15px', padding: '13px 28px', boxShadow: '0 6px 20px rgba(255,68,68,0.4)', display: 'inline-flex', alignItems: 'center', gap: '8px', animation: 'voice-pulse 0.9s ease-in-out infinite' }}>
                    ⏹ Stop recording
                  </button>
                )}
                {voiceProcessing && <div style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '15px', color: '#ff7043', marginTop: '4px' }}>Parsing items…</div>}
                {voiceTranscript && !voiceListening && !voiceProcessing && (
                  <div style={{ marginTop: '16px', background: '#f9f9f9', borderRadius: '10px', padding: '10px 14px' }}>
                    <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#bbb', margin: '0 0 4px' }}>You said:</p>
                    <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#555', margin: 0 }}>"{voiceTranscript}"</p>
                  </div>
                )}
                {voiceError && <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#ff4444', margin: '16px 0 0' }}>😕 {voiceError}</p>}
              </div>
            )}

            {/* ── Manual capture (form + voice shortcut) ── */}
            {mode === 'manual' && (
              <>
                {/* Voice shortcut row — sits above the form, no competing card */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                  {!voiceListening && !voiceProcessing && (
                    <button onClick={startVoice} style={{ ...btnBase, background: 'white', color: '#888', border: '1.5px solid #eee', fontSize: '13px', padding: '8px 14px', boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }}>
                      🎤 Add by voice instead
                    </button>
                  )}
                  {voiceListening && (
                    <button onClick={stopVoice} style={{ ...btnBase, background: 'linear-gradient(135deg,#ff4444,#ff6b6b)', color: 'white', fontSize: '13px', padding: '8px 14px', boxShadow: '0 4px 12px rgba(255,68,68,0.3)', animation: 'voice-pulse 0.9s ease-in-out infinite' }}>
                      ⏹ Stop recording
                    </button>
                  )}
                  {voiceProcessing && (
                    <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#ff7043' }}>Parsing items…</span>
                  )}
                  {voiceListening && voiceTranscript && (
                    <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '12px', color: '#bbb', fontStyle: 'italic' }}>"{voiceTranscript}"</span>
                  )}
                  {voiceError && !voiceListening && !voiceProcessing && (
                    <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#ff4444' }}>😕 {voiceError}</span>
                  )}
                </div>

                {itemFormJSX}
              </>
            )}

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
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px', maxHeight: '220px', overflowY: 'auto' }}>
                        {[...barcodeBatch].reverse().map(item => (
                          <div key={item.id} style={{ background: 'white', borderRadius: '12px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', animation: 'scan-pop 0.25s ease-out' }}>
                            <span style={{ fontSize: '16px', flexShrink: 0 }}>
                              {item.lookupStatus === 'loading' ? '⏳' : item.lookupStatus === 'known' ? '⭐' : item.lookupStatus === 'found' ? '✅' : '⚠️'}
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

            {/* ── Receipt / digital receipt ── */}
            {mode === 'receipt' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

                {/* Preview */}
                {receiptPreview && (
                  <div style={{ textAlign: 'center' }}>
                    <img src={receiptPreview} alt="Receipt" style={{ maxWidth: '180px', maxHeight: '160px', borderRadius: '16px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }} />
                  </div>
                )}

                {receiptLoading && (
                  <div style={{ background: 'white', borderRadius: '16px', padding: '20px', textAlign: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.07)' }}>
                    <p style={{ color: '#ff7043', fontWeight: 700, fontSize: '15px', fontFamily: "'Nunito',sans-serif", margin: 0 }}>
                      AI is reading your receipt…
                    </p>
                  </div>
                )}

                {!receiptLoading && (
                  <>
                    {/* Paper receipt */}
                    <div style={{ background: 'white', borderRadius: '20px', padding: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.07)' }}>
                      <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '16px', color: '#2d2d2d', margin: '0 0 4px' }}>📋 Paper Receipt</p>
                      <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '12px', color: '#bbb', margin: '0 0 14px' }}>
                        Take a photo or pick one from your library
                      </p>
                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <label style={{ flex: 1, minWidth: '120px', background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontFamily: "'Fredoka One',cursive", fontSize: '16px', padding: '12px 16px', borderRadius: '14px', cursor: 'pointer', boxShadow: '0 6px 18px rgba(255,112,67,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', position: 'relative', textAlign: 'center' }}>
                          📷 Take Photo
                          <input type="file" accept="image/*" capture="environment" onChange={e => handleReceiptFile(e, 'photo')} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                        </label>
                        <label style={{ flex: 1, minWidth: '120px', background: 'white', color: '#ff7043', border: '2px solid #ff7043', fontFamily: "'Fredoka One',cursive", fontSize: '16px', padding: '12px 16px', borderRadius: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', position: 'relative', textAlign: 'center' }}>
                          🖼 From Library
                          <input ref={receiptFileRef} type="file" accept="image/*" onChange={e => handleReceiptFile(e, 'library_image')} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                        </label>
                      </div>
                    </div>

                    {/* Digital receipt */}
                    <div style={{ background: 'white', borderRadius: '20px', padding: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.07)' }}>
                      <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '16px', color: '#2d2d2d', margin: '0 0 4px' }}>💻 Digital Receipt</p>
                      <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '12px', color: '#bbb', margin: '0 0 14px' }}>
                        Upload a screenshot or PDF, or paste the text
                      </p>

                      {/* Screenshot / PDF upload */}
                      <label style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#fff8f5', border: '2px dashed rgba(255,112,67,0.3)', borderRadius: '12px', padding: '12px 16px', cursor: 'pointer', marginBottom: '10px', position: 'relative' }}>
                        <span style={{ fontSize: '20px' }}>📤</span>
                        <div>
                          <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#ff7043', display: 'block' }}>
                            Upload screenshot or PDF
                          </span>
                          <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '11px', color: '#bbb' }}>
                            Supports images and .pdf files
                          </span>
                        </div>
                        <input type="file" accept="image/*,application/pdf" onChange={e => handleReceiptFile(e, 'digital_screenshot')} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                      </label>

                      {/* Paste text toggle */}
                      {!pasteVisible ? (
                        <button
                          onClick={() => setPasteVisible(true)}
                          style={{ ...btnBase, width: '100%', background: '#f5f5f5', color: '#888', fontSize: '14px', borderRadius: '12px', padding: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                        >
                          📋 Paste receipt text
                        </button>
                      ) : (
                        <div>
                          <textarea
                            autoFocus
                            value={pasteText}
                            onChange={e => setPasteText(e.target.value)}
                            placeholder={"Paste your receipt or order confirmation here…\n\nWorks with emails, Tesco/Sainsbury's/Ocado orders, etc."}
                            rows={7}
                            style={{ width: '100%', boxSizing: 'border-box', border: '2px solid #ff7043', borderRadius: '12px', padding: '12px 14px', fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '13px', color: '#2d2d2d', resize: 'vertical', outline: 'none', marginBottom: '10px' }}
                          />
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              onClick={handlePasteText}
                              disabled={!pasteText.trim()}
                              style={{ ...btnBase, flex: 1, background: pasteText.trim() ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : '#eee', color: pasteText.trim() ? 'white' : '#bbb', padding: '11px', fontSize: '15px', fontFamily: "'Fredoka One',cursive", boxShadow: pasteText.trim() ? '0 6px 18px rgba(255,112,67,0.35)' : 'none' }}
                            >
                              🔍 Extract Items
                            </button>
                            <button
                              onClick={() => { setPasteVisible(false); setPasteText('') }}
                              style={{ ...btnBase, background: '#f5f5f5', color: '#aaa', padding: '11px 16px' }}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
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
                    {receiptSourceType === 'digital_pdf' && <span style={{ marginLeft: '6px', fontSize: '11px', background: '#e8f4fd', color: '#2196f3', padding: '2px 6px', borderRadius: '50px', fontWeight: 700 }}>📄 PDF</span>}
                    {receiptSourceType === 'digital_screenshot' && <span style={{ marginLeft: '6px', fontSize: '11px', background: '#e8f4fd', color: '#2196f3', padding: '2px 6px', borderRadius: '50px', fontWeight: 700 }}>💻 Screenshot</span>}
                    {receiptSourceType === 'pasted_text' && <span style={{ marginLeft: '6px', fontSize: '11px', background: '#e8f4fd', color: '#2196f3', padding: '2px 6px', borderRadius: '50px', fontWeight: 700 }}>📋 Pasted text</span>}
                  </p>
                )}
                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#aaa', margin: 0 }}>
                  {(() => {
                    const visible = reviewBatch.filter(i => !i.absorbed)
                    const total = visible.length
                    const needCheck = visible.filter(i => needsReview(i)).length
                    if (total === 0) return 'No items yet'
                    if (needCheck === 0) return `${total} item${total !== 1 ? 's' : ''} · all looking good ✓`
                    return `${total} item${total !== 1 ? 's' : ''} · ${total - needCheck} ready · ${needCheck} to check`
                  })()}
                </p>
              </div>
              <button onClick={goToChoose} style={{ ...btnBase, background: '#f5f5f5', color: '#888', padding: '8px 14px', fontSize: '13px' }}>
                + Add more
              </button>
            </div>

            {/* Voice expiry — collapsible */}
            {reviewBatch.some(i => i.source === 'receipt' && !i.absorbed) && (
              <div style={{ marginBottom: '16px' }}>
                {!voiceExpiryOpen ? (
                  <button onClick={() => setVoiceExpiryOpen(true)}
                    style={{ ...btnBase, display: 'flex', alignItems: 'center', gap: '8px', background: 'white', color: '#888', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', padding: '10px 16px', fontSize: '13px', border: '1.5px solid #eee' }}>
                    🎤 Set expiry dates by voice
                  </button>
                ) : (
                  <div style={{ background: 'white', borderRadius: '16px', padding: '14px 16px', boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '15px', color: '#2d2d2d', margin: 0 }}>Add expiry dates by voice</p>
                      <button onClick={() => setVoiceExpiryOpen(false)} style={{ background: 'none', border: 'none', color: '#ccc', fontSize: '16px', cursor: 'pointer', padding: '2px', lineHeight: 1 }}>✕</button>
                    </div>
                    <div style={{ marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {reviewBatch.filter(i => i.source === 'receipt' && !i.absorbed).map((item, idx) => (
                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 0' }}>
                          <span style={{ color: item.expiryDate ? '#4caf50' : '#ddd', fontSize: '14px', width: '16px', flexShrink: 0, textAlign: 'center' }}>
                            {item.expiryDate ? '✓' : '○'}
                          </span>
                          <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#ff7043' }}>{idx + 1}.</span>
                          <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: item.expiryDate ? '#388e3c' : '#555', flex: 1 }}>
                            {item.name}
                          </span>
                          {item.expiryDate
                            ? <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '11px', color: '#4caf50', flexShrink: 0 }}>
                                {new Date(item.expiryDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                              </span>
                            : <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '11px', color: '#ddd', flexShrink: 0 }}>—</span>
                          }
                        </div>
                      ))}
                    </div>
                    <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '11px', color: '#bbb', margin: '0 0 10px' }}>
                      e.g. "1 tomorrow, 3 Sunday, 5 next week"
                    </p>
                    <button onClick={startReceiptVoiceExpiry} disabled={rVoiceListening || rVoiceProcessing}
                      style={{ ...btnBase, display: 'flex', alignItems: 'center', gap: '10px', background: rVoiceListening ? 'linear-gradient(135deg,#ff4444,#ff6b6b)' : 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', boxShadow: '0 4px 16px rgba(255,112,67,0.35)', opacity: rVoiceProcessing ? 0.7 : 1 }}>
                      <span style={{ fontSize: '18px', animation: rVoiceListening ? 'voice-pulse 0.9s ease-in-out infinite' : 'none' }}>🎤</span>
                      {rVoiceListening ? 'Listening...' : rVoiceProcessing ? 'Understanding...' : 'Speak expiry dates'}
                    </button>
                    {rVoiceListening && rVoiceTranscript && (
                      <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#bbb', margin: '6px 0 0', fontStyle: 'italic' }}>"{rVoiceTranscript}"</p>
                    )}
                    {rVoiceError && <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#ff4444', margin: '8px 0 0' }}>😕 {rVoiceError}</p>}
                    {rVoiceFilled.length > 0 && (
                      <div style={{ background: '#f0fff4', border: '1.5px solid rgba(76,175,80,0.25)', borderRadius: '10px', padding: '8px 12px', marginTop: '10px' }}>
                        <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '14px', color: '#388e3c', margin: '0 0 4px' }}>✅ {rVoiceFilled.length} date{rVoiceFilled.length !== 1 ? 's' : ''} set</p>
                        {rVoiceFilled.map((f, i) => <p key={i} style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#555', margin: '2px 0' }}>{f.name} → {new Date(f.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Match suggestions panel */}
            {matchSuggestions.some(s => s.status === 'pending') && (
              <div style={{ marginBottom: '16px', background: 'white', borderRadius: '16px', padding: '14px 16px', boxShadow: '0 2px 10px rgba(0,0,0,0.06)', border: '1.5px solid rgba(255,112,67,0.2)' }}>
                <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '15px', color: '#ff7043', margin: '0 0 4px' }}>🔗 Suggested matches</p>
                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#aaa', margin: '0 0 12px' }}>Link these to add price info and improve tracking — or skip if they're different items</p>
                {matchSuggestions.filter(s => s.status === 'pending').map(sugg => {
                  const rItem = reviewBatch.find(i => i.id === sugg.receiptItemId)
                  const bItem = reviewBatch.find(i => i.id === sugg.barcodeItemId)
                  if (!rItem || !bItem) return null
                  return (
                    <div key={sugg.id} style={{ background: '#fff8f0', borderRadius: '10px', padding: '10px 12px', marginBottom: '8px', border: '1.5px solid rgba(255,112,67,0.15)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <span style={{ fontSize: '13px', flexShrink: 0 }}>🧾</span>
                        <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#555', flex: 1 }}>{rItem.name}</span>
                        {rItem.price != null && <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#d4a96e', flexShrink: 0 }}>£{rItem.price.toFixed(2)}</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                        <span style={{ fontSize: '13px', flexShrink: 0 }}>📷</span>
                        <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#2d2d2d', flex: 1 }}>{bItem.name}</span>
                        <span style={{ background: sugg.confidence >= 0.6 ? 'rgba(76,175,80,0.15)' : 'rgba(255,152,0,0.15)', color: sugg.confidence >= 0.6 ? '#388e3c' : '#e65100', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '11px', padding: '2px 8px', borderRadius: '50px', flexShrink: 0 }}>
                          {Math.round(sugg.confidence * 100)}% match
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => acceptSuggestion(sugg.id)} style={{ ...btnBase, flex: 1, background: 'linear-gradient(135deg,#4caf50,#66bb6a)', color: 'white', padding: '7px 12px', fontSize: '13px', boxShadow: '0 3px 10px rgba(76,175,80,0.3)' }}>✓ Yes, they match</button>
                        <button onClick={() => rejectSuggestion(sugg.id)} style={{ ...btnBase, background: '#f0f0f0', color: '#888', padding: '7px 12px', fontSize: '13px' }}>Skip</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Auto-matched summary */}
            {reviewBatch.some(i => i.matchedToId && !i.absorbed && i.source === 'barcode') && (
              <div style={{ marginBottom: '12px', background: '#f0fff4', border: '1.5px solid rgba(76,175,80,0.2)', borderRadius: '12px', padding: '10px 14px' }}>
                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#388e3c', margin: 0 }}>
                  ✅ {reviewBatch.filter(i => i.matchedToId && !i.absorbed && i.source === 'barcode').length} item{reviewBatch.filter(i => i.matchedToId && !i.absorbed && i.source === 'barcode').length !== 1 ? 's' : ''} auto-matched — receipt price applied
                </p>
              </div>
            )}

            {/* Review item cards — two sections */}
            {(() => {
              const visibleItems = reviewBatch
                .map((item, index) => ({ item, index }))
                .filter(({ item }) => !item.absorbed)
              const needsCheckGroup = visibleItems.filter(({ item }) => needsReview(item))
              const readyGroup      = visibleItems.filter(({ item }) => !needsReview(item))

              const renderCard = (item: ReviewBatchItem, index: number) => (
                <div key={item.id} style={{ background: 'white', borderRadius: '14px', padding: '14px 16px', boxShadow: '0 2px 10px rgba(0,0,0,0.07)', border: needsReview(item) ? '2px solid rgba(255,179,71,0.55)' : '2px solid transparent' }}>
                  {isItemExpanded(item) ? (
                    <>
                      {/* Row 1: source icon / checkbox + name + badges + collapse + remove */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                        {item.source === 'receipt' ? (
                          <input type="checkbox" checked={item.selected} onChange={e => updateReviewItem(index, { selected: e.target.checked })} style={{ width: '18px', height: '18px', accentColor: '#ff7043', flexShrink: 0, cursor: 'pointer' }} />
                        ) : (
                          <span style={{ fontSize: '15px', flexShrink: 0 }}>
                            {item.source === 'barcode'
                              ? (item.lookupStatus === 'loading' ? '⏳' : item.lookupStatus === 'known' ? '⭐' : item.lookupStatus === 'found' ? '✅' : '⚠️')
                              : item.source === 'voice' ? '🎤' : '📝'}
                          </span>
                        )}
                        <input type="text" value={item.name}
                          onChange={e => updateReviewItem(index, { name: e.target.value })}
                          style={{ flex: 1, border: '2px solid #eee', borderRadius: '8px', padding: '7px 10px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#2d2d2d', minWidth: 0 }} />
                        {item.isKnown && (
                          <span style={{ background: 'rgba(76,175,80,0.12)', color: '#4caf50', fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '50px', fontFamily: "'Nunito',sans-serif", flexShrink: 0 }}>✓ known</span>
                        )}
                        {item.confidence != null && item.confidence < 0.8 && (
                          <span style={{ background: 'rgba(255,179,71,0.15)', color: '#e08000', fontSize: '11px', fontWeight: 700, padding: '3px 7px', borderRadius: '50px', fontFamily: "'Nunito',sans-serif", flexShrink: 0 }}>⚠ check</span>
                        )}
                        {item.source === 'receipt' && !needsReview(item) && (
                          <button onClick={() => toggleItemExpanded(item.id)} style={{ background: 'none', border: 'none', color: '#ccc', fontSize: '13px', cursor: 'pointer', flexShrink: 0, padding: '4px', lineHeight: 1 }} title="Collapse">▲</button>
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
                    </>
                  ) : (
                    /* Collapsed row — high-confidence receipt items */
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <input type="checkbox" checked={item.selected} onChange={e => updateReviewItem(index, { selected: e.target.checked })} style={{ width: '18px', height: '18px', accentColor: '#ff7043', flexShrink: 0, cursor: 'pointer' }} />
                      <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#2d2d2d', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                      {item.isKnown && (
                        <span style={{ background: 'rgba(76,175,80,0.12)', color: '#4caf50', fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '50px', fontFamily: "'Nunito',sans-serif", flexShrink: 0 }}>✓</span>
                      )}
                      {item.price != null && (
                        <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#ff7043', flexShrink: 0 }}>£{item.price.toFixed(2)}</span>
                      )}
                      <span style={{ color: '#4caf50', fontSize: '13px', flexShrink: 0 }}>✓</span>
                      <button onClick={() => toggleItemExpanded(item.id)} style={{ background: 'none', border: 'none', color: '#bbb', fontSize: '13px', cursor: 'pointer', flexShrink: 0, padding: '4px', lineHeight: 1 }} title="Edit">✏️</button>
                      <button onClick={() => removeReviewItem(index)} style={{ background: 'none', border: 'none', color: '#ddd', fontSize: '16px', cursor: 'pointer', flexShrink: 0, padding: '4px', lineHeight: 1 }}>✕</button>
                    </div>
                  )}
                </div>
              )

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                  {/* Section A: needs a check */}
                  {needsCheckGroup.length > 0 && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0' }}>
                        <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: '11px', color: '#e08000', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                          ⚠ {needsCheckGroup.length} need{needsCheckGroup.length === 1 ? 's' : ''} a check
                        </span>
                        <div style={{ flex: 1, height: '1px', background: 'rgba(255,179,71,0.3)' }} />
                      </div>
                      {needsCheckGroup.map(({ item, index }) => renderCard(item, index))}
                    </>
                  )}
                  {/* Section B: ready to save */}
                  {readyGroup.length > 0 && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: needsCheckGroup.length > 0 ? '6px 0 2px' : '2px 0' }}>
                        <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: '11px', color: '#4caf50', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                          ✓ {readyGroup.length} ready
                        </span>
                        <div style={{ flex: 1, height: '1px', background: 'rgba(76,175,80,0.2)' }} />
                      </div>
                      {readyGroup.map(({ item, index }) => renderCard(item, index))}
                    </>
                  )}
                </div>
              )
            })()}

            {/* Save button */}
            {reviewBatch.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', background: 'white', borderRadius: '16px', boxShadow: '0 2px 10px rgba(0,0,0,0.07)' }}>
                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, color: '#aaa', margin: '0 0 12px' }}>No items to save</p>
                <button onClick={goToChoose} style={{ ...btnBase, background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', padding: '12px 24px' }}>← Add items</button>
              </div>
            ) : (
              <button onClick={saveAll} disabled={saving || reviewBatch.filter(i => i.selected && !i.absorbed).length === 0}
                style={{ ...btnBase, width: '100%', background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontSize: '18px', padding: '16px', boxShadow: '0 8px 24px rgba(255,112,67,0.4)', fontFamily: "'Fredoka One',cursive", opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Saving...' : `Save ${reviewBatch.filter(i => i.selected && !i.absorbed).length} Item${reviewBatch.filter(i => i.selected && !i.absorbed).length !== 1 ? 's' : ''} to Inventory`}
              </button>
            )}
          </>
        )}

      </div>
    </main>
  )
}
