'use client'

import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { InventoryItem } from '@/lib/types'
import { differenceInDays } from 'date-fns'
import { lookupShelfLife } from '@/lib/shelfLife'
import { compressImage } from '@/lib/compressImage'

// ── Enrichment types ──────────────────────────────────────────────────────────
type EnrichMode = 'barcode' | 'receipt' | null
type EnrichBarcodeData = {
  found: boolean
  name: string; category: string; count: number
  amount_per_unit: number | null; unit: string; barcode: string
}
type EnrichReceiptLine = {
  normalized_name: string; price: number | null; unit: string
  quantity: number; category: string
}
type EnrichReceiptData = {
  retailer_name: string; total: number | null; items: EnrichReceiptLine[]
}

type GroupedItem = {
  name: string
  totalQuantity: number
  unit: string
  location: string
  category: string | null
  nearestExpiry: string | null
  retailer: string | null
  batches: InventoryItem[]
}

type UsingItemState = {
  id: string; used: number; unit: string; maxQty: number
  isFirstOpen: boolean; suggestedExpiry: string; rangeText: string; acceptExpiry: boolean
}
type EditingItemState = {
  id: string
  source: string
  name: string
  category: string
  location: string
  itemCount: string
  amount_per_unit: string
  quantity: string
  unit: string
  expiry_date: string
  opened_at: string
  retailer: string
  price: string
  price_source: string
  barcode: string
  status: string
}
type VoiceAction = {
  matched_item: string | null
  action: 'used_all' | 'used_partial' | 'discard' | 'set_expiry' | 'mark_opened' | null
  quantity: number | null
  unit: string | null
  expiry_date: string | null
  confidence: number
  display_text: string | null
}

// ── Component ────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const [items, setItems]           = useState<InventoryItem[]>([])
  const [filter, setFilter]         = useState<string>('all')
  const [sortBy, setSortBy]         = useState<string>('date_added')
  const [grouped, setGrouped]       = useState<boolean>(true)
  const [loading, setLoading]       = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingItem, setEditingItem]   = useState<EditingItemState | null>(null)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [usingItem, setUsingItem]       = useState<UsingItemState | null>(null)
  const [selectMode, setSelectMode]     = useState<boolean>(false)
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [retailerFilter, setRetailerFilter] = useState<string | null>(null)
  const [searchQuery,   setSearchQuery]    = useState<string>('')
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const [toast, setToast]               = useState<string | null>(null)
  const [fabOpen, setFabOpen]                   = useState(false)
  const [quickExpiryId,   setQuickExpiryId]   = useState<string | null>(null)
  const [quickExpiryDate, setQuickExpiryDate] = useState('')

  // ── Enrichment state (in edit modal) ──────────────────────────────────────
  const [enrichMode,           setEnrichMode]           = useState<EnrichMode>(null)
  const [enrichBarcodeInput,   setEnrichBarcodeInput]   = useState('')
  const [enrichBarcodeLoading, setEnrichBarcodeLoading] = useState(false)
  const [enrichBarcodeResult,  setEnrichBarcodeResult]  = useState<EnrichBarcodeData | null>(null)
  const [enrichCameraActive,   setEnrichCameraActive]   = useState(false)
  const [enrichCameraError,    setEnrichCameraError]    = useState<string | null>(null)
  const [enrichScanFlash,      setEnrichScanFlash]      = useState(false)
  const [enrichReceiptLoading, setEnrichReceiptLoading] = useState(false)
  const [enrichReceiptResult,  setEnrichReceiptResult]  = useState<EnrichReceiptData | null>(null)
  const [enrichApplied,        setEnrichApplied]        = useState<string | null>(null)
  const enrichVideoRef    = useRef<HTMLVideoElement>(null)
  const enrichStreamRef   = useRef<MediaStream | null>(null)
  const enrichScanRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const enrichZxingRef    = useRef<{ stop: () => void } | null>(null)
  const enrichLastBarcode   = useRef('')
  const enrichLastScanTime  = useRef<number>(0)
  const enrichReceiptRef    = useRef<HTMLInputElement>(null)

  const [voiceListening, setVoiceListening]     = useState(false)
  const [voiceProcessing, setVoiceProcessing]   = useState(false)
  const [voiceTranscript, setVoiceTranscript]   = useState<string | null>(null)
  const [voiceAction, setVoiceAction]           = useState<VoiceAction | null>(null)
  const [voiceError, setVoiceError]             = useState<string | null>(null)

  // ── Data ──────────────────────────────────────────────────────────────────

  async function loadItems() {
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id
    if (!userId) return
    const { data, error } = await supabase
      .from('inventory_items')
      .select('*, receipt_items!receipt_item_id(price)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
    if (error) {
      alert('Error loading inventory: ' + error.message)
      setLoading(false)
      return
    }
    const mapped: InventoryItem[] = (data || []).map((d: any) => ({
      ...d,
      // inventory_items.price takes precedence; fall back to receipt_items join for legacy rows
      price: d.price ?? d.receipt_items?.price ?? null,
      receipt_items: undefined,
    }))
    setItems(mapped)
    setLoading(false)
  }

  useEffect(() => { loadItems() }, [])
  useEffect(() => {
    document.body.style.overflow = editModalOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [editModalOpen])

  // ── Helpers ───────────────────────────────────────────────────────────────

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

  function formatDateAdded(dateStr: string): string {
    const d = differenceInDays(new Date(), new Date(dateStr))
    if (d === 0) return 'today'
    if (d === 1) return 'yesterday'
    if (d < 7)  return `${d}d ago`
    if (d < 30) return `${Math.floor(d / 7)}w ago`
    return `${Math.floor(d / 30)}mo ago`
  }

  function formatOpenedDate(dateStr: string): string {
    const d = differenceInDays(new Date(), new Date(dateStr))
    if (d === 0) return 'Opened today'
    if (d === 1) return 'Opened yesterday'
    return `Opened ${d}d ago`
  }

  function formatDisplayDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function markUsed(id: string) {
    await supabase.from('inventory_items').update({ status: 'used' }).eq('id', id)
    await supabase.from('inventory_events').insert({ inventory_item_id: id, type: 'used' })
    setExpandedId(null)
    loadItems()
  }

  async function markUsedSome() {
    if (!usingItem) return
    const used = Math.max(0, usingItem.used)
    const remaining = parseFloat((usingItem.maxQty - used).toFixed(3))
    const today = new Date().toISOString().split('T')[0]
    if (remaining <= 0) {
      await supabase.from('inventory_items').update({ status: 'used' }).eq('id', usingItem.id)
      await supabase.from('inventory_events').insert({ inventory_item_id: usingItem.id, type: 'used', quantity_delta: -usingItem.maxQty })
    } else {
      const upd: Record<string, any> = { remaining_quantity: remaining, quantity: remaining }
      if (usingItem.isFirstOpen) {
        upd.opened_at = today
        if (usingItem.acceptExpiry && usingItem.suggestedExpiry) upd.expiry_date = usingItem.suggestedExpiry
      }
      await supabase.from('inventory_items').update(upd).eq('id', usingItem.id)
      const eventType = used === 0 ? 'opened' : 'used_some'
      await supabase.from('inventory_events').insert({
        inventory_item_id: usingItem.id, type: eventType,
        quantity_delta: used === 0 ? null : -used,
        notes: usingItem.isFirstOpen && usingItem.rangeText ? `Shelf life after opening: ${usingItem.rangeText}` : null,
      })
    }
    const msg = usingItem.isFirstOpen && used === 0
      ? (usingItem.acceptExpiry && usingItem.suggestedExpiry ? '✅ Marked as opened — expiry updated!' : '✅ Marked as opened')
      : used > 0 ? '✅ Recorded usage' : '✅ Done'
    setToast(msg); setTimeout(() => setToast(null), 2500)
    setUsingItem(null)
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
    const editQty = parseFloat(editingItem.quantity) || 0
    // Determine price_source: if price changed manually (no enrichment source), mark as 'manual'
    const newPrice = editingItem.price !== '' ? parseFloat(editingItem.price) : null
    const priceSource = editingItem.price_source || (newPrice != null ? 'manual' : null)
    await supabase.from('inventory_items').update({
      name: editingItem.name.trim(),
      category: editingItem.category || null,
      location: editingItem.location,
      count: editingItem.itemCount ? parseInt(editingItem.itemCount) : null,
      amount_per_unit: editingItem.amount_per_unit ? parseFloat(editingItem.amount_per_unit) : null,
      remaining_quantity: editQty,
      quantity: editQty,
      unit: editingItem.unit,
      expiry_date: editingItem.expiry_date || null,
      opened_at: editingItem.opened_at || null,
      retailer: editingItem.retailer.trim() || null,
      price: newPrice,
      price_source: priceSource,
      barcode: editingItem.barcode || null,
      status: editingItem.status,
    }).eq('id', editingItem.id)
    resetEnrichState()
    setEditingItem(null)
    setEditModalOpen(false)
    loadItems()
  }

  function cancelEdit() {
    resetEnrichState()
    setEditingItem(null)
    setEditModalOpen(false)
  }

  async function changeLocation(id: string, loc: string) {
    await supabase.from('inventory_items').update({ location: loc }).eq('id', id)
    await supabase.from('inventory_events').insert({ inventory_item_id: id, type: 'moved' })
    loadItems()
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelectedIds(new Set(filtered.map(i => i.id)))
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  function toggleGroupSelect(group: GroupedItem) {
    const ids = group.batches.map(b => b.id)
    const allSelected = ids.every(id => selectedIds.has(id))
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allSelected) ids.forEach(id => next.delete(id))
      else ids.forEach(id => next.add(id))
      return next
    })
  }

  function isGroupSelected(group: GroupedItem): boolean {
    return group.batches.every(b => selectedIds.has(b.id))
  }

  function isGroupPartial(group: GroupedItem): boolean {
    const count = group.batches.filter(b => selectedIds.has(b.id)).length
    return count > 0 && count < group.batches.length
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return
    await supabase.from('inventory_items').update({ status: 'removed' }).in('id', Array.from(selectedIds))
    setSelectedIds(new Set())
    setSelectMode(false)
    loadItems()
  }

  async function markBulkUsed() {
    if (selectedIds.size === 0) return
    const ids = Array.from(selectedIds)
    await supabase.from('inventory_items').update({ status: 'used' }).in('id', ids)
    await supabase.from('inventory_events').insert(ids.map(id => ({ inventory_item_id: id, type: 'used' })))
    setSelectedIds(new Set())
    setSelectMode(false)
    setToast(`✅ ${ids.length} item${ids.length > 1 ? 's' : ''} marked as used`)
    setTimeout(() => setToast(null), 2500)
    loadItems()
  }

  async function markBulkDiscarded() {
    if (selectedIds.size === 0) return
    const ids = Array.from(selectedIds)
    await supabase.from('inventory_items').update({ status: 'discarded' }).in('id', ids)
    await supabase.from('inventory_events').insert(ids.map(id => ({ inventory_item_id: id, type: 'discarded' })))
    setSelectedIds(new Set())
    setSelectMode(false)
    setToast(`🗑️ ${ids.length} item${ids.length > 1 ? 's' : ''} discarded`)
    setTimeout(() => setToast(null), 2500)
    loadItems()
  }

  function startVoiceListening() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setVoiceError("Voice input isn't supported in this browser. Try Chrome or Safari.")
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

    setVoiceListening(true)
    setVoiceAction(null)
    setVoiceError(null)
    setVoiceTranscript(null)
    recognition.start()

    recognition.onresult = (e: any) => {
      if (silenceTimer) clearTimeout(silenceTimer)
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript + ' '
      }
      setVoiceTranscript(finalTranscript.trim() || null)
      // Stop 3 s after last word
      silenceTimer = setTimeout(() => recognition.stop(), 3000)
    }

    recognition.onerror = (e: any) => {
      if (e.error !== 'no-speech') {
        clearTimeout(absoluteTimer)
        if (silenceTimer) clearTimeout(silenceTimer)
        setVoiceListening(false)
        setVoiceError("Couldn't hear you — please try again.")
      }
    }

    recognition.onend = async () => {
      clearTimeout(absoluteTimer)
      if (silenceTimer) clearTimeout(silenceTimer)
      setVoiceListening(false)
      const transcript = finalTranscript.trim()
      if (!transcript) {
        setVoiceError('No speech detected — tap the mic and try again.')
        return
      }
      setVoiceTranscript(transcript)
      setVoiceProcessing(true)
      try {
        const res = await fetch('/api/voice-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript, items: items.map(i => i.name) }),
        })
        const result = await res.json()
        if (result.error) throw new Error(result.error)
        if (!result.matched_item || result.confidence < 0.5) {
          setVoiceError("I didn't catch that — try saying something like \"I used the milk\" or \"discard the bread\".")
        } else {
          setVoiceAction(result)
        }
      } catch {
        setVoiceError('Something went wrong. Please try again.')
      }
      setVoiceProcessing(false)
    }
  }

  async function applyVoiceAction() {
    if (!voiceAction?.matched_item || !voiceAction.action) return
    const name = voiceAction.matched_item.toLowerCase()
    const item =
      items.find(i => i.name.toLowerCase() === name) ||
      items.find(i => i.name.toLowerCase().includes(name)) ||
      items.find(i => name.includes(i.name.toLowerCase()))
    if (!item) {
      setVoiceError(`Couldn't find "${voiceAction.matched_item}" in your inventory.`)
      setVoiceAction(null)
      return
    }
    if (voiceAction.action === 'used_all') {
      await markUsed(item.id)
    } else if (voiceAction.action === 'discard') {
      await markDiscarded(item.id)
    } else if (voiceAction.action === 'used_partial' && voiceAction.quantity != null) {
      const currentQty = item.remaining_quantity ?? item.quantity
      const remaining = parseFloat((currentQty - voiceAction.quantity).toFixed(3))
      if (remaining <= 0) {
        await supabase.from('inventory_items').update({ status: 'used' }).eq('id', item.id)
        await supabase.from('inventory_events').insert({ inventory_item_id: item.id, type: 'used', quantity_delta: -currentQty })
      } else {
        await supabase.from('inventory_items').update({ remaining_quantity: remaining, quantity: remaining }).eq('id', item.id)
        await supabase.from('inventory_events').insert({ inventory_item_id: item.id, type: 'used_some', quantity_delta: -voiceAction.quantity })
      }
      loadItems()
    } else if (voiceAction.action === 'set_expiry' && voiceAction.expiry_date) {
      await supabase.from('inventory_items').update({ expiry_date: voiceAction.expiry_date }).eq('id', item.id)
      loadItems()
    } else if (voiceAction.action === 'mark_opened') {
      startUseOpen(item)
    }
    setVoiceAction(null)
    setVoiceTranscript(null)
  }

  function startUseOpen(item: InventoryItem) {
    setEditingItem(null)
    const maxQty = item.remaining_quantity ?? item.quantity
    const isFirstOpen = !item.opened_at
    let suggestedExpiry = '', rangeText = '', acceptExpiry = false
    if (isFirstOpen) {
      const sl = lookupShelfLife(item.name, item.category)
      if (sl) {
        const avgDays = Math.round((sl.min + sl.max) / 2)
        const d = new Date(); d.setDate(d.getDate() + avgDays)
        suggestedExpiry = d.toISOString().split('T')[0]
        rangeText = sl.min === sl.max ? `${sl.min} days` : `${sl.min}–${sl.max} days`
        acceptExpiry = true
      }
    }
    setUsingItem({ id: item.id, used: 0, unit: item.unit, maxQty, isFirstOpen, suggestedExpiry, rangeText, acceptExpiry })
  }

  async function saveQuickExpiry(dateOverride?: string) {
    if (!quickExpiryId) return
    const expiry = dateOverride !== undefined ? dateOverride : quickExpiryDate
    await supabase.from('inventory_items').update({ expiry_date: expiry || null }).eq('id', quickExpiryId)
    setQuickExpiryId(null); setQuickExpiryDate('')
    loadItems()
    setToast('📅 Expiry updated'); setTimeout(() => setToast(null), 2000)
  }

  // ── Enrichment helpers ────────────────────────────────────────────────────

  function enrichBeep() {
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

  function resetEnrichState() {
    stopEnrichCamera()
    setEnrichMode(null)
    setEnrichBarcodeInput('')
    setEnrichBarcodeLoading(false)
    setEnrichBarcodeResult(null)
    setEnrichCameraActive(false)
    setEnrichCameraError(null)
    setEnrichReceiptLoading(false)
    setEnrichReceiptResult(null)
    setEnrichApplied(null)
  }

  function stopEnrichCamera() {
    try { enrichZxingRef.current?.stop() } catch {}
    enrichZxingRef.current = null
    if (enrichStreamRef.current) {
      enrichStreamRef.current.getTracks().forEach(t => t.stop())
      enrichStreamRef.current = null
    }
    if (enrichScanRef.current) { clearInterval(enrichScanRef.current); enrichScanRef.current = null }
    enrichLastBarcode.current = ''
    setEnrichCameraActive(false)
  }

  async function startEnrichCamera() {
    setEnrichCameraError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setEnrichCameraError('Camera not available on this device.')
      return
    }
    const NativeBD = (window as any).BarcodeDetector
    if (NativeBD) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        enrichStreamRef.current = stream
        setEnrichCameraActive(true)
        await new Promise<void>(r => setTimeout(r, 80))
        if (!enrichVideoRef.current) return
        enrichVideoRef.current.srcObject = stream
        await enrichVideoRef.current.play().catch(() => {})
        const detector = new NativeBD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'] })
        enrichScanRef.current = setInterval(async () => {
          const vid = enrichVideoRef.current
          if (!vid || vid.readyState < 2) return
          try {
            const codes = await detector.detect(vid)
            if (codes.length > 0) {
              const bc = codes[0].rawValue
              const now = Date.now()
              if (bc === enrichLastBarcode.current && now - enrichLastScanTime.current < 2000) return
              enrichLastBarcode.current = bc
              enrichLastScanTime.current = now
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(60)
              enrichBeep()
              stopEnrichCamera()
              setEnrichScanFlash(true); setTimeout(() => setEnrichScanFlash(false), 280)
              setEnrichBarcodeInput(bc)
              lookupEnrichBarcode(bc)
            }
          } catch {}
        }, 600)
      } catch {
        setEnrichCameraError("Couldn't access camera. Check permissions.")
        setEnrichCameraActive(false)
      }
    } else {
      setEnrichCameraActive(true)
      await new Promise<void>(r => setTimeout(r, 80))
      if (!enrichVideoRef.current) { setEnrichCameraActive(false); return }
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const reader = new BrowserMultiFormatReader()
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } } },
          enrichVideoRef.current,
          (result) => {
            if (!result) return
            const bc = result.getText()
            const now = Date.now()
            if (bc === enrichLastBarcode.current && now - enrichLastScanTime.current < 2000) return
            enrichLastBarcode.current = bc
            enrichLastScanTime.current = now
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(60)
            enrichBeep()
            stopEnrichCamera()
            setEnrichScanFlash(true); setTimeout(() => setEnrichScanFlash(false), 280)
            setEnrichBarcodeInput(bc)
            lookupEnrichBarcode(bc)
          }
        )
        enrichZxingRef.current = controls
      } catch {
        setEnrichCameraError("Couldn't access camera. Check permissions.")
        setEnrichCameraActive(false)
      }
    }
  }

  async function lookupEnrichBarcode(barcode: string) {
    if (!barcode.trim()) return
    setEnrichBarcodeLoading(true)
    setEnrichBarcodeResult(null)
    try {
      const res = await fetch('/api/barcode', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode }),
      })
      const data = await res.json()
      setEnrichBarcodeResult({ ...data, barcode })
    } catch {
      setEnrichBarcodeResult({ found: false, name: '', category: '', count: 1, amount_per_unit: null, unit: 'item', barcode })
    }
    setEnrichBarcodeLoading(false)
  }

  function applyBarcodeEnrichment(data: EnrichBarcodeData) {
    if (!editingItem) return
    setEditingItem({
      ...editingItem,
      name: data.name || editingItem.name,
      category: data.category || editingItem.category,
      // Only apply count/amount if user hasn't already set them (don't clobber manual entries)
      itemCount: !editingItem.itemCount || editingItem.itemCount === '1'
        ? String(data.count ?? editingItem.itemCount)
        : editingItem.itemCount,
      amount_per_unit: !editingItem.amount_per_unit && data.amount_per_unit != null
        ? String(data.amount_per_unit)
        : editingItem.amount_per_unit,
      unit: !editingItem.unit || editingItem.unit === 'item'
        ? (data.unit || editingItem.unit)
        : editingItem.unit,
      barcode: data.barcode,
    })
    setEnrichApplied('✅ Barcode info applied — review and save')
    setEnrichBarcodeResult(null)
    setEnrichMode(null)
  }

  async function handleEnrichReceiptFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setEnrichReceiptLoading(true)
    setEnrichReceiptResult(null)
    const uploadBlob = file.size > 1.4 * 1024 * 1024 ? await compressImage(file) : file
    const formData = new FormData()
    formData.append('receipt', uploadBlob)
    try {
      const res = await fetch('/api/parse-receipt', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.error) { setEnrichReceiptLoading(false); return }
      setEnrichReceiptResult(data)
    } catch {}
    setEnrichReceiptLoading(false)
    e.target.value = ''
  }

  function applyReceiptLine(line: EnrichReceiptLine, retailer: string) {
    if (!editingItem) return
    setEditingItem({
      ...editingItem,
      price: line.price != null ? String(line.price) : editingItem.price,
      price_source: line.price != null ? 'receipt' : editingItem.price_source,
      retailer: retailer || editingItem.retailer,
      unit: line.unit !== 'item' ? line.unit : editingItem.unit,
    })
    setEnrichApplied('✅ Receipt match applied — review and save')
    setEnrichReceiptResult(null)
    setEnrichMode(null)
  }

  // ── Filtering & sorting ────────────────────────────────────────────────────

  const retailers = Array.from(new Set(items.map(i => i.retailer).filter(Boolean))) as string[]

  const filtered = items.filter((item) => {
    if (searchQuery && !item.name.toLowerCase().includes(searchQuery.toLowerCase())) return false
    if (retailerFilter && item.retailer !== retailerFilter) return false
    const d = daysLeft(item.expiry_date)
    const isExpired = d !== null && d < 0
    if (filter === 'expired')  return isExpired
    if (isExpired)             return false   // expired items only appear in the Expired tab
    if (filter === 'expiring') return d !== null && d >= 0 && d <= 7
    if (filter === 'all')      return true
    return item.location === filter
  })

  function sortItems(arr: InventoryItem[]): InventoryItem[] {
    return [...arr].sort((a, b) => {
      if (sortBy === 'expiry') {
        const da = daysLeft(a.expiry_date), db = daysLeft(b.expiry_date)
        if (da === null && db === null) return 0
        if (da === null) return 1; if (db === null) return -1
        return da - db
      }
      if (sortBy === 'name')     return a.name.localeCompare(b.name)
      if (sortBy === 'location') return a.location.localeCompare(b.location)
      if (sortBy === 'category') return (a.category || '').localeCompare(b.category || '')
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }

  function groupItems(arr: InventoryItem[]): GroupedItem[] {
    const map = new Map<string, GroupedItem>()
    for (const item of arr) {
      const key = item.name.toLowerCase().trim()
      const rq = item.remaining_quantity ?? item.quantity
      if (map.has(key)) {
        const g = map.get(key)!
        g.totalQuantity += rq
        g.batches.push(item)
        if (item.expiry_date && (!g.nearestExpiry || item.expiry_date < g.nearestExpiry))
          g.nearestExpiry = item.expiry_date
      } else {
        map.set(key, { name: item.name, totalQuantity: rq, unit: item.unit, location: item.location, category: item.category, nearestExpiry: item.expiry_date, retailer: item.retailer, batches: [item] })
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (sortBy === 'expiry') {
        const da = daysLeft(a.nearestExpiry), db = daysLeft(b.nearestExpiry)
        if (da === null && db === null) return 0
        if (da === null) return 1; if (db === null) return -1
        return da - db
      }
      if (sortBy === 'name')     return a.name.localeCompare(b.name)
      if (sortBy === 'location') return a.location.localeCompare(b.location)
      if (sortBy === 'category') return (a.category || '').localeCompare(b.category || '')
      return 0
    })
  }

  const sorted       = sortItems(filtered)
  const groupedItems = groupItems(filtered)

  // ── Derived counts & stock value ──────────────────────────────────────────

  const expiringCount = items.filter(i => { const d = daysLeft(i.expiry_date); return d !== null && d >= 0 && d <= 7 }).length
  const expiredCount  = items.filter(i => { const d = daysLeft(i.expiry_date); return d !== null && d < 0 }).length
  // Stock value uses the currently filtered set (respects location/tab), excluding expired items
  const stockItems  = filter === 'expired' ? [] : filtered
  const stockValue  = stockItems.reduce((sum, i) => sum + (i.price ?? 0), 0)
  const pricedCount = stockItems.filter(i => i.price !== null).length

  // ── Static config ─────────────────────────────────────────────────────────

  const warmStyle = {
    fontFamily: "'Nunito', sans-serif",
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #fdf6ec 0%, #fde8d0 50%, #fce4e4 100%)',
    padding: '72px 24px 32px',
  }
  const units   = ['item', 'g', 'kg', 'ml', 'l', 'bottle', 'tin', 'loaf', 'pack', 'bag', 'head', 'fillet']
  const btnBase: React.CSSProperties = { border: 'none', borderRadius: '50px', padding: '7px 14px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', cursor: 'pointer' }
  const categories = ['dairy', 'meat', 'fish', 'vegetables', 'fruit', 'bakery', 'tinned', 'dry goods', 'oils', 'frozen', 'drinks', 'snacks', 'alcohol', 'household', 'pet', 'other']
  const locationOptions = [
    { value: 'fridge',    label: '❄️ Fridge'    },
    { value: 'freezer',   label: '🧊 Freezer'   },
    { value: 'cupboard',  label: '🗄️ Cupboard'  },
    { value: 'household', label: '🏠 Household' },
    { value: 'other',     label: '📦 Other'     },
  ]
  const editLabelStyle: React.CSSProperties = {
    fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '11px',
    color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '3px', display: 'block',
  }
  const editInputStyle: React.CSSProperties = {
    width: '100%', border: '2px solid #eee', borderRadius: '8px', padding: '7px 10px',
    fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', boxSizing: 'border-box',
  }
  const editSelectStyle: React.CSSProperties = {
    width: '100%', border: '2px solid #eee', borderRadius: '8px', padding: '7px 10px',
    fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px',
  }

  // ── Sub-panels ────────────────────────────────────────────────────────────

  const partialUsePanel = (item: InventoryItem) => (
    <div style={{ background: '#f4fff6', border: '1.5px solid rgba(76,175,80,0.25)', borderRadius: '12px', padding: '14px 16px', marginBottom: '8px' }}>
      <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '15px', color: '#2d2d2d', margin: '0 0 10px' }}>
        {usingItem!.isFirstOpen ? '📦 Use / Open' : '🍽️ Use some'} — <span style={{ color: '#4caf50' }}>{item.name}</span>
      </p>

      {/* Opening context */}
      {usingItem!.isFirstOpen && (
        <div style={{ background: 'rgba(255,112,67,0.05)', border: '1px solid rgba(255,112,67,0.15)', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px' }}>
          <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#ff7043', margin: '0 0 6px' }}>
            Opening for the first time — opened_at set to today
          </p>
          {usingItem!.suggestedExpiry && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#888' }}>Shelf life {usingItem!.rangeText} →</span>
              <input type="date" value={usingItem!.suggestedExpiry}
                onChange={e => setUsingItem({ ...usingItem!, suggestedExpiry: e.target.value })}
                style={{ border: '2px solid #ffe0cc', borderRadius: '8px', padding: '4px 8px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px' }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                <input type="checkbox" checked={usingItem!.acceptExpiry}
                  onChange={e => setUsingItem({ ...usingItem!, acceptExpiry: e.target.checked })}
                  style={{ accentColor: '#ff7043', width: '14px', height: '14px' }} />
                <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#555' }}>Update expiry</span>
              </label>
            </div>
          )}
        </div>
      )}

      <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#555', margin: '0 0 8px' }}>
        How much did you <strong>use</strong>?{usingItem!.isFirstOpen && <span style={{ color: '#aaa', fontWeight: 600 }}> (0 = just opening)</span>}
      </p>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
        {usingItem!.isFirstOpen && (
          <button onClick={() => setUsingItem({ ...usingItem!, used: 0 })}
            style={{ ...btnBase, flex: 1, background: usingItem!.used === 0 ? '#e8f5e9' : '#f5f5f5', color: usingItem!.used === 0 ? '#388e3c' : '#bbb', border: `1.5px solid ${usingItem!.used === 0 ? 'rgba(76,175,80,0.3)' : 'transparent'}`, padding: '6px 2px', fontSize: '11px' }}>
            0 (open only)
          </button>
        )}
        {[25, 50, 75].map(pct => (
          <button key={pct}
            onClick={() => setUsingItem({ ...usingItem!, used: parseFloat(((usingItem!.maxQty * pct) / 100).toFixed(3)) })}
            style={{ ...btnBase, flex: 1, background: '#e8f5e9', color: '#388e3c', border: '1.5px solid rgba(76,175,80,0.2)', padding: '7px 4px', fontSize: '12px' }}>
            Used {pct}%
          </button>
        ))}
        <button onClick={() => setUsingItem({ ...usingItem!, used: usingItem!.maxQty })}
          style={{ ...btnBase, flex: 1, background: '#c8e6c9', color: '#2e7d32', border: 'none', padding: '7px 4px', fontSize: '12px' }}>
          All
        </button>
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
        <input type="number" min={0} max={usingItem!.maxQty} step={0.1}
          value={usingItem!.used || ''}
          placeholder="0"
          onChange={e => setUsingItem({ ...usingItem!, used: parseFloat(e.target.value) || 0 })}
          style={{ width: '80px', border: '2px solid #c8e6c9', borderRadius: '8px', padding: '7px 10px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '15px', textAlign: 'center' }}
        />
        <span style={{ fontWeight: 700, color: '#555', fontSize: '14px' }}>{usingItem!.unit} used</span>
        {usingItem!.used > 0 && (
          <span style={{ color: '#4caf50', fontSize: '12px', fontWeight: 700 }}>
            → {parseFloat((usingItem!.maxQty - usingItem!.used).toFixed(2))} {usingItem!.unit} will remain
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={markUsedSome} style={{ ...btnBase, background: 'linear-gradient(135deg,#4caf50,#66bb6a)', color: 'white', boxShadow: '0 4px 12px rgba(76,175,80,0.3)' }}>✅ Confirm</button>
        <button onClick={() => setUsingItem(null)} style={{ ...btnBase, background: '#f5f5f5', color: '#888' }}>Cancel</button>
      </div>
    </div>
  )

  const actionArea = (item: InventoryItem) => {
    if (usingItem?.id === item.id) return partialUsePanel(item)
    return (
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <button onClick={() => startUseOpen(item)} style={{ ...btnBase, background: '#f0fff4', color: '#4caf50' }}>🍽️ {item.opened_at ? 'Use some' : 'Use / Open'}</button>
        <button onClick={() => markUsed(item.id)} style={{ ...btnBase, background: '#e8f5e9', color: '#388e3c' }}>✅ Used all</button>
        <button onClick={() => markDiscarded(item.id)} style={{ ...btnBase, background: '#fff0f0', color: '#ff4444' }}>🗑️ Discard</button>
        <button onClick={() => {
          setEditingItem({
            id: item.id,
            source: item.source,
            name: item.name,
            category: item.category || '',
            location: item.location,
            itemCount: String(item.count ?? 1),
            amount_per_unit: item.amount_per_unit != null ? String(item.amount_per_unit) : '',
            quantity: String(item.remaining_quantity ?? item.quantity),
            unit: item.unit,
            expiry_date: item.expiry_date || '',
            opened_at: item.opened_at || '',
            retailer: item.retailer || '',
            price: item.price != null ? String(item.price) : '',
            price_source: item.price_source || '',
            barcode: item.barcode || '',
            status: item.status,
          })
          setUsingItem(null)
          setEditModalOpen(true)
        }} style={{ ...btnBase, background: '#fff8f0', color: '#ff7043' }}>✏️ Edit</button>
        <select value={item.location} onChange={(e) => changeLocation(item.id, e.target.value)} style={{ border: '2px solid #eee', borderRadius: '50px', padding: '6px 12px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#555' }}>
          <option value="fridge">Fridge</option>
          <option value="freezer">Freezer</option>
          <option value="cupboard">Cupboard</option>
          <option value="household">Household</option>
          <option value="other">Other</option>
        </select>
      </div>
    )
  }

  // editForm removed — edit is now a fullscreen modal (rendered at bottom of JSX)

  // ── Item header helpers ───────────────────────────────────────��───────────

  type HeaderProps = {
    name: string; location: string; quantity: number; quantityOriginal?: number | null
    itemCount?: number | null; amountPerUnit?: number | null
    unit: string; createdAt: string; openedAt: string | null; price: number | null
    retailer?: string | null; hasBatches?: boolean
    source?: string; barcode?: string | null
  }

  const ItemHeaderLeft = ({ name, location, quantity, quantityOriginal, itemCount, amountPerUnit, unit, createdAt, openedAt, price, retailer, hasBatches, source, barcode }: HeaderProps) => {
    const qtyDisplay = (() => {
      const fmt = (n: number) => n % 1 === 0 ? String(n) : n.toFixed(1)
      // `quantity` prop is now remaining_quantity (passed in from item.remaining_quantity ?? item.quantity)
      const remaining = quantity
      // Derive the "original total" from purchase structure
      const packTotal = (itemCount && itemCount > 0 && amountPerUnit)
        ? itemCount * amountPerUnit
        : amountPerUnit ?? null
      const looseTotal = (!amountPerUnit && itemCount) ? itemCount : null
      const originalTotal = packTotal ?? looseTotal

      // Detect partial use (allow 0.1% float tolerance)
      const isPartial = originalTotal != null && remaining < originalTotal - 0.001

      if (itemCount && itemCount > 1 && amountPerUnit) {
        if (isPartial) return `${fmt(remaining)} of ${fmt(packTotal!)} ${unit} remaining`
        return `${itemCount} × ${amountPerUnit} ${unit}`
      }
      if (amountPerUnit) {
        if (isPartial) return `${fmt(remaining)} of ${fmt(amountPerUnit)} ${unit} remaining`
        return `${fmt(amountPerUnit)} ${unit}`
      }
      // Plain count-based item
      if (isPartial) return `${fmt(remaining)} of ${fmt(originalTotal!)} ${unit} remaining`
      return `${fmt(remaining)} ${unit}`
    })()
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <h3 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '17px', color: '#2d2d2d', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {name}
          </h3>
          {location === 'household' && (
            <span style={{ background: 'rgba(100,120,240,0.1)', color: '#6478f0', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '50px', fontFamily: "'Nunito',sans-serif", flexShrink: 0 }}>🏠 household</span>
          )}
          {openedAt && (
            <span style={{ background: 'rgba(32,178,170,0.12)', color: '#20b2aa', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '50px', fontFamily: "'Nunito',sans-serif", flexShrink: 0 }}>🔓 {formatOpenedDate(openedAt)}</span>
          )}
          {retailer && (
            <span style={{ background: 'rgba(255,112,67,0.1)', color: '#ff7043', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '50px', fontFamily: "'Nunito',sans-serif", flexShrink: 0 }}>{retailer}</span>
          )}
          {hasBatches && (
            <span style={{ background: '#fff5f0', color: '#ff7043', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '50px', fontFamily: "'Nunito',sans-serif", flexShrink: 0 }}>batches</span>
          )}
          {source === 'barcode' && barcode && (
            <span style={{ background: 'rgba(74,144,217,0.1)', color: '#4a90d9', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '50px', fontFamily: "'Nunito',sans-serif", flexShrink: 0 }}>📷 barcode</span>
          )}
          {source === 'voice' && (
            <span style={{ background: 'rgba(156,39,176,0.1)', color: '#9c27b0', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '50px', fontFamily: "'Nunito',sans-serif", flexShrink: 0 }}>🎤 voice</span>
          )}
        </div>
        <p style={{ color: '#ccc', fontSize: '11px', fontWeight: 600, margin: '3px 0 0', fontFamily: "'Nunito',sans-serif", display: 'flex', gap: '6px', flexWrap: 'wrap' as const }}>
          <span style={{ color: '#bbb', fontWeight: 700 }}>{qtyDisplay} · {location}</span>
          <span>· added {formatDateAdded(createdAt)}</span>
          {price != null ? <span style={{ color: '#d4a96e' }}>· £{price.toFixed(2)}</span> : <span style={{ color: '#ddd' }}>· no price</span>}
        </p>
      </div>
    )
  }

  const cardBg     = (loc: string) => loc === 'household' ? '#f0f4ff' : 'white'
  const cardBorder = (loc: string) => loc === 'household' ? '1.5px solid rgba(100,120,240,0.15)' : 'none'
  const expandedBg = (loc: string) => loc === 'household' ? '#eef1ff' : '#fffaf7'

  // ── Expiry right-side display ─────────────────────────────────────────────

  const ExpiryBadge = ({ d, location }: { d: number | null; location: string }) => {
    if (location === 'household') return null
    const isExpired = d !== null && d < 0
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {isExpired && <span style={{ fontSize: '15px' }} title="Expired">⚠️</span>}
        <span style={{ color: expiryColor(d), fontWeight: 800, fontSize: '12px', fontFamily: "'Nunito',sans-serif" }}>
          {expiryLabel(d)}
        </span>
      </div>
    )
  }

  const SelectBox = ({ checked, partial, onToggle }: { checked: boolean; partial?: boolean; onToggle: (e: React.MouseEvent) => void }) => (
    <div onClick={onToggle} style={{ width: '22px', height: '22px', borderRadius: '6px', border: `2px solid ${checked || partial ? '#ff7043' : '#ddd'}`, background: checked ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : partial ? 'rgba(255,112,67,0.15)' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}>
      {checked && <span style={{ color: 'white', fontSize: '13px', lineHeight: 1 }}>✓</span>}
      {!checked && partial && <span style={{ color: '#ff7043', fontSize: '14px', lineHeight: 1 }}>–</span>}
    </div>
  )

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <main style={{ ...warmStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`}</style>
        <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '24px', color: '#ff7043' }}>Loading inventory...</p>
      </main>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main style={{ ...warmStyle, padding: `72px 24px ${selectMode ? '100px' : '32px'}` }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');
        .item-row { transition: all 0.15s ease; }
        .item-row:active { transform: scale(0.99); }
        @keyframes voice-pulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.12);opacity:0.85} }
      `}</style>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <h1 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '36px', color: '#2d2d2d', margin: 0 }}>Your Inventory</h1>
            <p style={{ color: '#aaa', fontWeight: 700, fontSize: '13px', margin: 0 }}>{items.length} items tracked</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={startVoiceListening}
              disabled={voiceListening || voiceProcessing || selectMode}
              title="Voice command"
              style={{ width: '44px', height: '44px', borderRadius: '50%', border: 'none', background: voiceListening ? 'linear-gradient(135deg,#ff4444,#ff6b6b)' : 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontSize: '20px', cursor: voiceListening || voiceProcessing || selectMode ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: voiceListening ? '0 4px 16px rgba(255,68,68,0.55)' : '0 4px 16px rgba(255,112,67,0.4)', animation: voiceListening ? 'voice-pulse 0.9s ease-in-out infinite' : 'none', flexShrink: 0, opacity: voiceProcessing || selectMode ? 0.5 : 1 }}
            >
              🎤
            </button>
            <button onClick={() => { setSelectMode(!selectMode); setSelectedIds(new Set()); setExpandedId(null) }} style={{ ...btnBase, background: selectMode ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : 'white', color: selectMode ? 'white' : '#888', boxShadow: selectMode ? '0 4px 12px rgba(255,112,67,0.4)' : '0 2px 8px rgba(0,0,0,0.08)', padding: '10px 16px', fontSize: '14px' }}>
              ☑ Select
            </button>
          </div>
        </div>

        {/* ── Stock value card ── */}
        {pricedCount > 0 && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '16px 20px', marginBottom: '16px', boxShadow: '0 4px 16px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#aaa', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                💰 {filter === 'all' ? 'Stock Value' : filter === 'expiring' ? 'Expiring Value' : `${filter.charAt(0).toUpperCase() + filter.slice(1)} Value`}
              </p>
              <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '28px', color: '#2d2d2d', margin: 0, lineHeight: 1 }}>
                £{stockValue.toFixed(2)}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#ccc', margin: 0 }}>
                {pricedCount} priced item{pricedCount !== 1 ? 's' : ''}
              </p>
              {stockItems.length - pricedCount > 0 && (
                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '11px', color: '#ddd', margin: '2px 0 0' }}>
                  + {stockItems.length - pricedCount} unpriced
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Expiring banner ── */}
        {expiringCount > 0 && (
          <button onClick={() => setFilter('expiring')} style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', background: 'linear-gradient(135deg,#fff8f0,#fff3e6)', border: '2px solid rgba(255,112,67,0.25)', borderRadius: '14px', padding: '12px 16px', marginBottom: '12px', cursor: 'pointer', textAlign: 'left', boxShadow: '0 2px 10px rgba(255,112,67,0.12)' }}>
            <span style={{ fontSize: '24px' }}>⏰</span>
            <div style={{ flex: 1 }}>
              <span style={{ fontFamily: "'Fredoka One',cursive", fontSize: '16px', color: '#ff7043' }}>{expiringCount} item{expiringCount > 1 ? 's' : ''} expiring within 7 days</span>
              <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#ffb347', margin: 0 }}>Tap to view expiring items</p>
            </div>
            <span style={{ background: '#ff7043', color: 'white', fontFamily: "'Fredoka One',cursive", fontSize: '16px', borderRadius: '50px', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{expiringCount}</span>
          </button>
        )}

        {/* ── Search ── */}
        <div style={{ marginBottom: '10px' }}>
          <input
            type="text"
            placeholder="🔍 Search items..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ width: '100%', border: '2px solid #eee', borderRadius: '50px', padding: '9px 18px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', boxSizing: 'border-box', background: 'white', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', color: '#2d2d2d' }}
          />
        </div>

        {/* ── Location chips + Filters button ── */}
        {!selectMode && (
          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: '2px' }}>
            {(['all', 'fridge', 'freezer', 'cupboard', 'household'] as const).map(f => {
              const active = filter === f
              const label = f === 'all' ? 'All' : f === 'household' ? '🏠' : f.charAt(0).toUpperCase() + f.slice(1)
              return (
                <button key={f} onClick={() => setFilter(f)} style={{ padding: '7px 14px', borderRadius: '50px', border: 'none', cursor: 'pointer', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', background: active ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : 'white', color: active ? 'white' : '#888', boxShadow: active ? '0 4px 12px rgba(255,112,67,0.4)' : '0 2px 8px rgba(0,0,0,0.08)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {label}
                </button>
              )
            })}
            {/* Filters button */}
            {(() => {
              const activeCount = [
                sortBy !== 'date_added',
                !grouped,
                retailerFilter !== null,
                filter === 'expiring' || filter === 'expired',
              ].filter(Boolean).length
              return (
                <button onClick={() => setFilterPanelOpen(!filterPanelOpen)}
                  style={{ padding: '7px 14px', borderRadius: '50px', border: 'none', cursor: 'pointer', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', background: filterPanelOpen || activeCount > 0 ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : 'white', color: filterPanelOpen || activeCount > 0 ? 'white' : '#888', boxShadow: filterPanelOpen || activeCount > 0 ? '0 4px 12px rgba(255,112,67,0.4)' : '0 2px 8px rgba(0,0,0,0.08)', whiteSpace: 'nowrap', flexShrink: 0, marginLeft: 'auto' }}>
                  ⚙ Filters{activeCount > 0 ? ` (${activeCount})` : ''}
                </button>
              )
            })()}
          </div>
        )}

        {/* ── Expanded filter panel ── */}
        {filterPanelOpen && !selectMode && (
          <div style={{ background: 'white', borderRadius: '14px', padding: '14px 16px', marginBottom: '12px', boxShadow: '0 4px 16px rgba(0,0,0,0.08)', border: '1.5px solid #f0f0f0' }}>
            {/* Sort */}
            <div style={{ marginBottom: '12px' }}>
              <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '11px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 6px' }}>Sort by</p>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ border: '2px solid #eee', borderRadius: '8px', padding: '7px 12px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#555', background: 'white', width: '100%' }}>
                <option value="date_added">Date Added</option>
                <option value="expiry">Expiry (soonest first)</option>
                <option value="name">Name A–Z</option>
                <option value="location">Location</option>
                <option value="category">Category</option>
              </select>
            </div>
            {/* Grouped toggle */}
            <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#555' }}>Group by name</span>
              <div onClick={() => { setGrouped(!grouped); setExpandedId(null) }}
                style={{ width: '44px', height: '24px', borderRadius: '12px', cursor: 'pointer', background: grouped ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : '#eee', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: '3px', width: '18px', height: '18px', borderRadius: '50%', background: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.2)', left: grouped ? '23px' : '3px', transition: 'left 0.2s' }} />
              </div>
            </div>
            {/* Retailer */}
            {retailers.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '11px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 6px' }}>Store</p>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <button onClick={() => setRetailerFilter(null)} style={{ padding: '5px 12px', borderRadius: '50px', border: 'none', cursor: 'pointer', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', background: !retailerFilter ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : '#f0f0f0', color: !retailerFilter ? 'white' : '#888' }}>All</button>
                  {retailers.map(r => (
                    <button key={r} onClick={() => setRetailerFilter(r === retailerFilter ? null : r)} style={{ padding: '5px 12px', borderRadius: '50px', border: 'none', cursor: 'pointer', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', background: retailerFilter === r ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : '#f0f0f0', color: retailerFilter === r ? 'white' : '#888' }}>{r}</button>
                  ))}
                </div>
              </div>
            )}
            {/* Expiring / Expired quick filters */}
            <div>
              <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '11px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 6px' }}>Quick filters</p>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => setFilter(filter === 'expiring' ? 'all' : 'expiring')} style={{ padding: '5px 12px', borderRadius: '50px', border: 'none', cursor: 'pointer', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', background: filter === 'expiring' ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : '#f0f0f0', color: filter === 'expiring' ? 'white' : '#888' }}>
                  ⏰ Expiring{expiringCount > 0 ? ` (${expiringCount})` : ''}
                </button>
                <button onClick={() => setFilter(filter === 'expired' ? 'all' : 'expired')} style={{ padding: '5px 12px', borderRadius: '50px', border: 'none', cursor: 'pointer', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', background: filter === 'expired' ? 'linear-gradient(135deg,#ff4444,#ff6b6b)' : '#f0f0f0', color: filter === 'expired' ? 'white' : '#888' }}>
                  ⚠️ Expired{expiredCount > 0 ? ` (${expiredCount})` : ''}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Select mode controls ── */}
        {selectMode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <button onClick={selectAll} style={{ ...btnBase, background: 'white', color: '#ff7043', border: '1.5px solid rgba(255,112,67,0.3)', padding: '7px 16px' }}>
              Select All ({filtered.length})
            </button>
            <button onClick={clearSelection} style={{ ...btnBase, background: 'white', color: '#888', border: '1.5px solid #eee', padding: '7px 16px' }}>
              Clear
            </button>
          </div>
        )}

        {/* ── Voice feedback card ── */}
        {(voiceListening || voiceProcessing || voiceAction || voiceError) && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '16px 18px', marginBottom: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.09)', border: '1.5px solid rgba(255,112,67,0.2)' }}>
            {voiceListening && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '22px', display: 'inline-block', animation: 'voice-pulse 0.9s ease-in-out infinite' }}>🎤</span>
                <div>
                  <span style={{ fontFamily: "'Fredoka One',cursive", fontSize: '17px', color: '#ff4444' }}>
                    {voiceTranscript ? 'Got it...' : 'Listening — say something'}
                  </span>
                  {voiceTranscript && (
                    <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#bbb', margin: '2px 0 0' }}>"{voiceTranscript}"</p>
                  )}
                </div>
              </div>
            )}
            {voiceProcessing && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '22px' }}>✨</span>
                <div>
                  <span style={{ fontFamily: "'Fredoka One',cursive", fontSize: '17px', color: '#ff9a3c' }}>Understanding...</span>
                  {voiceTranscript && <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#bbb', margin: '2px 0 0' }}>"{voiceTranscript}"</p>}
                </div>
              </div>
            )}
            {voiceAction && !voiceListening && !voiceProcessing && (
              <>
                {voiceTranscript && <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#ccc', margin: '0 0 6px' }}>"{voiceTranscript}"</p>}
                <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '17px', color: '#2d2d2d', margin: '0 0 12px' }}>{voiceAction.display_text}</p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={applyVoiceAction} style={{ ...btnBase, background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', boxShadow: '0 4px 12px rgba(255,112,67,0.3)', padding: '9px 20px' }}>✅ Yes, do it</button>
                  <button onClick={() => { setVoiceAction(null); setVoiceTranscript(null) }} style={{ ...btnBase, background: '#f5f5f5', color: '#888', padding: '9px 16px' }}>✕ Cancel</button>
                </div>
              </>
            )}
            {voiceError && !voiceListening && !voiceProcessing && (
              <>
                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#ff4444', margin: '0 0 10px' }}>😕 {voiceError}</p>
                <button onClick={() => { setVoiceError(null); setVoiceTranscript(null) }} style={{ ...btnBase, background: '#f5f5f5', color: '#888' }}>Dismiss</button>
              </>
            )}
          </div>
        )}

        {/* ── Item list ── */}
        {grouped ? (
          groupedItems.length === 0
            ? <p style={{ color: '#aaa', fontWeight: 700, textAlign: 'center', marginTop: '48px', fontFamily: "'Nunito',sans-serif" }}>No items found</p>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {groupedItems.map((group) => {
                  const d = daysLeft(group.nearestExpiry)
                  const isExpanded = expandedId === group.name
                  const hasBatches = group.batches.length > 1
                  const repBatch = group.batches[0]
                  const openedAt = !hasBatches ? repBatch.opened_at : null
                  return (
                    <div key={group.name} className="item-row" style={{ background: selectMode && isGroupSelected(group) ? '#fff5f0' : cardBg(group.location), borderRadius: '14px', boxShadow: '0 2px 10px rgba(0,0,0,0.07)', overflow: 'hidden', border: selectMode && isGroupSelected(group) ? '2px solid rgba(255,112,67,0.3)' : cardBorder(group.location) }}>
                      <div onClick={() => selectMode ? toggleGroupSelect(group) : setExpandedId(isExpanded ? null : group.name)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', cursor: 'pointer', gap: '8px' }}>
                        {selectMode && <SelectBox checked={isGroupSelected(group)} partial={isGroupPartial(group)} onToggle={(e) => { e.stopPropagation(); toggleGroupSelect(group) }} />}
                        <ItemHeaderLeft name={group.name} location={group.location} quantity={group.totalQuantity} quantityOriginal={!hasBatches ? repBatch.quantity_original : null} itemCount={!hasBatches ? repBatch.count : null} amountPerUnit={!hasBatches ? repBatch.amount_per_unit : null} unit={group.unit} createdAt={repBatch.created_at} openedAt={openedAt} price={!hasBatches ? repBatch.price : null} retailer={group.retailer} hasBatches={hasBatches} source={!hasBatches ? repBatch.source : undefined} barcode={!hasBatches ? repBatch.barcode : undefined} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                          <ExpiryBadge d={d} location={group.location} />
                          {group.location !== 'household' && !selectMode && !hasBatches && (
                            <button onClick={e => { e.stopPropagation(); setQuickExpiryId(group.batches[0].id); setQuickExpiryDate(group.batches[0].expiry_date || '') }} style={{ background: 'none', border: 'none', fontSize: '14px', cursor: 'pointer', padding: '4px', opacity: 0.45, lineHeight: 1 }} title="Quick expiry">📅</button>
                          )}
                          {!selectMode && <span style={{ color: '#ccc', fontSize: '16px' }}>{isExpanded ? '▲' : '▼'}</span>}
                        </div>
                      </div>
                      {isExpanded && (
                        <div style={{ borderTop: '1px solid #f0f0f0', padding: '12px 16px', background: expandedBg(group.location) }}>
                          {hasBatches ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                              {group.batches.map((batch, bi) => {
                                const bd = daysLeft(batch.expiry_date)
                                return (
                                  <div key={batch.id} style={{ background: 'white', borderRadius: '10px', padding: '10px 12px', border: '1px solid #f0f0f0' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                      <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#555' }}>
                                        Batch {bi + 1} — {batch.remaining_quantity ?? batch.quantity} {batch.unit}
                                        {batch.price != null && <span style={{ color: '#d4a96e', marginLeft: '6px' }}>£{batch.price.toFixed(2)}</span>}
                                      </span>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <ExpiryBadge d={bd} location={batch.location} />
                                        {batch.location !== 'household' && (
                                          <button onClick={e => { e.stopPropagation(); setQuickExpiryId(batch.id); setQuickExpiryDate(batch.expiry_date || '') }} style={{ background: 'none', border: 'none', fontSize: '12px', cursor: 'pointer', padding: '2px', opacity: 0.45, lineHeight: 1 }} title="Quick expiry">📅</button>
                                        )}
                                      </div>
                                    </div>
                                    <p style={{ color: '#ddd', fontSize: '11px', fontWeight: 600, margin: '0 0 8px', fontFamily: "'Nunito',sans-serif" }}>
                                      Added {formatDateAdded(batch.created_at)}
                                      {batch.opened_at && <span style={{ color: '#20b2aa', marginLeft: '8px' }}>🔓 {formatOpenedDate(batch.opened_at)}</span>}
                                    </p>
                                    {actionArea(batch)}
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <>
                              {actionArea(repBatch)}
                              {group.category && <span style={{ background: '#fff5f0', color: '#ff7043', fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '50px', fontFamily: "'Nunito',sans-serif" }}>{group.category}</span>}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
        ) : (
          sorted.length === 0
            ? <p style={{ color: '#aaa', fontWeight: 700, textAlign: 'center', marginTop: '48px', fontFamily: "'Nunito',sans-serif" }}>No items found</p>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {sorted.map((item) => {
                  const d = daysLeft(item.expiry_date)
                  const isExpanded = expandedId === item.id
                  return (
                    <div key={item.id} className="item-row" style={{ background: selectMode && selectedIds.has(item.id) ? '#fff5f0' : cardBg(item.location), borderRadius: '14px', boxShadow: '0 2px 10px rgba(0,0,0,0.07)', overflow: 'hidden', border: selectMode && selectedIds.has(item.id) ? '2px solid rgba(255,112,67,0.3)' : cardBorder(item.location) }}>
                      <div onClick={() => selectMode ? toggleSelect(item.id) : setExpandedId(isExpanded ? null : item.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', cursor: 'pointer', gap: '8px' }}>
                        {selectMode && <SelectBox checked={selectedIds.has(item.id)} onToggle={(e) => { e.stopPropagation(); toggleSelect(item.id) }} />}
                        <ItemHeaderLeft name={item.name} location={item.location} quantity={item.remaining_quantity ?? item.quantity} quantityOriginal={item.quantity_original} itemCount={item.count} amountPerUnit={item.amount_per_unit} unit={item.unit} createdAt={item.created_at} openedAt={item.opened_at} price={item.price} retailer={item.retailer} source={item.source} barcode={item.barcode} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                          <ExpiryBadge d={d} location={item.location} />
                          {item.location !== 'household' && !selectMode && (
                            <button onClick={e => { e.stopPropagation(); setQuickExpiryId(item.id); setQuickExpiryDate(item.expiry_date || '') }} style={{ background: 'none', border: 'none', fontSize: '14px', cursor: 'pointer', padding: '4px', opacity: 0.45, lineHeight: 1 }} title="Quick expiry">📅</button>
                          )}
                          {!selectMode && <span style={{ color: '#ccc', fontSize: '16px' }}>{isExpanded ? '▲' : '▼'}</span>}
                        </div>
                      </div>
                      {isExpanded && (
                        <div style={{ borderTop: '1px solid #f0f0f0', padding: '12px 16px', background: expandedBg(item.location) }}>
                          {actionArea(item)}
                          {item.category && <span style={{ background: '#fff5f0', color: '#ff7043', fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '50px', fontFamily: "'Nunito',sans-serif" }}>{item.category}</span>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
        )}

      </div>

      {/* ── Toast ── */}
      {toast && (
        <div style={{ position: 'fixed', bottom: selectMode ? '96px' : '24px', left: '50%', transform: 'translateX(-50%)', background: '#2d2d2d', color: 'white', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', padding: '12px 22px', borderRadius: '50px', boxShadow: '0 6px 24px rgba(0,0,0,0.2)', zIndex: 2000, whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}

      {/* ── Bulk action bar ── */}
      {selectMode && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'white', borderTop: '1px solid #f0f0f0', boxShadow: '0 -4px 20px rgba(0,0,0,0.1)', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '10px', zIndex: 1000 }}>
          <span style={{ fontFamily: "'Fredoka One',cursive", fontSize: '16px', color: selectedIds.size > 0 ? '#ff7043' : '#ccc', flex: 1 }}>
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select items'}
          </span>
          <button
            onClick={markBulkUsed}
            disabled={selectedIds.size === 0}
            style={{ ...btnBase, background: selectedIds.size > 0 ? 'linear-gradient(135deg,#4caf50,#66bb6a)' : '#f5f5f5', color: selectedIds.size > 0 ? 'white' : '#ccc', boxShadow: selectedIds.size > 0 ? '0 4px 12px rgba(76,175,80,0.3)' : 'none', padding: '10px 16px' }}
          >
            ✅ Mark Used
          </button>
          <button
            onClick={markBulkDiscarded}
            disabled={selectedIds.size === 0}
            style={{ ...btnBase, background: selectedIds.size > 0 ? 'linear-gradient(135deg,#ff4444,#ff6b6b)' : '#f5f5f5', color: selectedIds.size > 0 ? 'white' : '#ccc', boxShadow: selectedIds.size > 0 ? '0 4px 12px rgba(255,68,68,0.3)' : 'none', padding: '10px 16px' }}
          >
            🗑️ Discard
          </button>
          <button
            onClick={() => { setSelectMode(false); setSelectedIds(new Set()) }}
            style={{ ...btnBase, background: '#f5f5f5', color: '#888', padding: '10px 16px' }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── Full-screen edit modal ── */}
      {editModalOpen && editingItem && (
        <div
          onClick={cancelEdit}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 3000, display: 'flex', alignItems: 'flex-end', fontFamily: "'Nunito',sans-serif" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: '24px 24px 0 0', padding: '20px 20px 40px', width: '100%', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 -8px 40px rgba(0,0,0,0.2)', boxSizing: 'border-box' }}
          >
            {/* Drag handle */}
            <div style={{ width: '40px', height: '4px', background: '#eee', borderRadius: '2px', margin: '0 auto 18px' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '22px', color: '#ff7043', margin: 0 }}>Edit Item</p>
              <button onClick={cancelEdit} style={{ background: 'none', border: 'none', fontSize: '22px', color: '#ccc', cursor: 'pointer', padding: '4px', lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Name */}
              <div>
                <label style={editLabelStyle}>Name</label>
                <input type="text" value={editingItem.name} onChange={e => setEditingItem({ ...editingItem, name: e.target.value })} style={editInputStyle} />
              </div>

              {/* Category + Location */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1 }}>
                  <label style={editLabelStyle}>Category</label>
                  <select value={editingItem.category} onChange={e => setEditingItem({ ...editingItem, category: e.target.value })} style={editSelectStyle}>
                    <option value="">— none —</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={editLabelStyle}>Location</label>
                  <select value={editingItem.location} onChange={e => setEditingItem({ ...editingItem, location: e.target.value })} style={editSelectStyle}>
                    {locationOptions.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Purchase structure */}
              <div>
                <label style={editLabelStyle}>Purchase structure</label>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ ...editLabelStyle, fontSize: '10px' }}>Count</label>
                    <input type="number" min={1} step={1} placeholder="1" value={editingItem.itemCount} onChange={e => setEditingItem({ ...editingItem, itemCount: e.target.value })} style={{ ...editInputStyle, textAlign: 'center' }} />
                  </div>
                  <span style={{ color: '#ccc', fontWeight: 700, fontSize: '16px', paddingBottom: '9px', flexShrink: 0 }}>×</span>
                  <div style={{ flex: 1 }}>
                    <label style={{ ...editLabelStyle, fontSize: '10px' }}>Size each</label>
                    <input type="number" min={0} step={0.1} placeholder="—" value={editingItem.amount_per_unit} onChange={e => setEditingItem({ ...editingItem, amount_per_unit: e.target.value })} style={{ ...editInputStyle, textAlign: 'center' }} />
                  </div>
                  <div style={{ flex: 2 }}>
                    <label style={{ ...editLabelStyle, fontSize: '10px' }}>Unit</label>
                    <select value={editingItem.unit} onChange={e => setEditingItem({ ...editingItem, unit: e.target.value })} style={editSelectStyle}>
                      {units.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Currently remaining */}
              <div>
                <label style={editLabelStyle}>Currently remaining</label>
                <input type="number" min={0} step={0.1} value={editingItem.quantity} onChange={e => setEditingItem({ ...editingItem, quantity: e.target.value })} style={{ ...editInputStyle, maxWidth: '140px' }} />
              </div>

              {/* Expiry */}
              {editingItem.location !== 'household' && (
                <div>
                  <label style={editLabelStyle}>Expiry date</label>
                  <input type="date" value={editingItem.expiry_date} onChange={e => setEditingItem({ ...editingItem, expiry_date: e.target.value })} style={{ ...editInputStyle, maxWidth: '200px' }} />
                </div>
              )}

              {/* Opened date */}
              <div>
                <label style={editLabelStyle}>Opened date</label>
                <input type="date" value={editingItem.opened_at} onChange={e => setEditingItem({ ...editingItem, opened_at: e.target.value })} style={{ ...editInputStyle, maxWidth: '200px' }} />
              </div>

              {/* Retailer */}
              <div>
                <label style={editLabelStyle}>Retailer</label>
                <input type="text" placeholder="e.g. Tesco" value={editingItem.retailer} onChange={e => setEditingItem({ ...editingItem, retailer: e.target.value })} style={editInputStyle} />
              </div>

              {/* Price */}
              <div>
                <label style={editLabelStyle}>Price (£)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '15px', color: '#bbb' }}>£</span>
                  <input type="number" min={0} step={0.01} placeholder="0.00" value={editingItem.price} onChange={e => setEditingItem({ ...editingItem, price: e.target.value })} style={{ ...editInputStyle, maxWidth: '140px' }} />
                </div>
              </div>

              {/* ── Provenance row ── */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', padding: '10px 14px', background: '#fafafa', borderRadius: '10px' }}>
                {(() => {
                  const srcMap: Record<string, string> = { receipt: '🧾 receipt', barcode: '📷 barcode', manual: '✏️ manual', voice: '🎤 voice' }
                  const srcLabel = srcMap[editingItem.source] || editingItem.source
                  const srcColor: Record<string, string> = { receipt: '#ff7043', barcode: '#4a90d9', manual: '#888', voice: '#9c27b0' }
                  const srcBg: Record<string, string> = { receipt: 'rgba(255,112,67,0.1)', barcode: 'rgba(74,144,217,0.1)', manual: '#f0f0f0', voice: 'rgba(156,39,176,0.1)' }
                  return (
                    <span style={{ background: srcBg[editingItem.source] || '#f0f0f0', color: srcColor[editingItem.source] || '#888', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '11px', padding: '3px 10px', borderRadius: '50px' }}>
                      {srcLabel}
                    </span>
                  )
                })()}
                {editingItem.price_source && (
                  <span style={{ background: 'rgba(212,169,110,0.15)', color: '#b8860b', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '11px', padding: '3px 10px', borderRadius: '50px' }}>
                    £ {editingItem.price_source}
                  </span>
                )}
                {!editingItem.price && (
                  <span style={{ background: '#f5f5f5', color: '#ccc', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '11px', padding: '3px 10px', borderRadius: '50px' }}>no price</span>
                )}
                {editingItem.barcode ? (
                  <span style={{ background: 'rgba(74,144,217,0.1)', color: '#4a90d9', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '11px', padding: '3px 10px', borderRadius: '50px' }}>
                    📷 {editingItem.barcode}
                  </span>
                ) : (
                  <span style={{ background: '#f5f5f5', color: '#ccc', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '11px', padding: '3px 10px', borderRadius: '50px' }}>no barcode</span>
                )}
              </div>

              {/* ── Improve item details ── */}
              <div style={{ borderTop: '1.5px solid #f0f0f0', paddingTop: '16px' }}>
                <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '16px', color: '#888', margin: '0 0 10px' }}>
                  Improve item details
                </p>
                {/* Enrichment type buttons */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: enrichMode ? '14px' : '0' }}>
                  <button
                    onClick={() => { setEnrichMode(enrichMode === 'barcode' ? null : 'barcode'); setEnrichBarcodeResult(null); setEnrichApplied(null) }}
                    style={{ ...btnBase, flex: 1, padding: '10px 8px', background: enrichMode === 'barcode' ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : '#f5f5f5', color: enrichMode === 'barcode' ? 'white' : '#666', fontSize: '13px', boxShadow: enrichMode === 'barcode' ? '0 4px 12px rgba(255,112,67,0.3)' : 'none' }}
                  >
                    📷 Scan barcode
                  </button>
                  <button
                    onClick={() => { setEnrichMode(enrichMode === 'receipt' ? null : 'receipt'); setEnrichReceiptResult(null); setEnrichApplied(null) }}
                    style={{ ...btnBase, flex: 1, padding: '10px 8px', background: enrichMode === 'receipt' ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : '#f5f5f5', color: enrichMode === 'receipt' ? 'white' : '#666', fontSize: '13px', boxShadow: enrichMode === 'receipt' ? '0 4px 12px rgba(255,112,67,0.3)' : 'none' }}
                  >
                    🧾 Match receipt
                  </button>
                </div>

                {/* Applied confirmation banner */}
                {enrichApplied && (
                  <div style={{ background: '#f0fff4', border: '1.5px solid rgba(76,175,80,0.25)', borderRadius: '10px', padding: '10px 14px', marginBottom: '10px' }}>
                    <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#388e3c', margin: 0 }}>{enrichApplied}</p>
                  </div>
                )}

                {/* ── Barcode enrichment panel ── */}
                {enrichMode === 'barcode' && (
                  <div style={{ background: '#f9f9f9', borderRadius: '12px', padding: '14px' }}>
                    {/* Camera viewfinder */}
                    {enrichCameraActive && (
                      <div style={{ marginBottom: '10px' }}>
                        <div style={{ position: 'relative', borderRadius: '10px', overflow: 'hidden', background: '#000', marginBottom: '8px' }}>
                          <video ref={enrichVideoRef} muted playsInline style={{ width: '100%', height: '160px', objectFit: 'cover', display: 'block' }} />
                          <div style={{ position: 'absolute', inset: '10px', border: '2px solid rgba(255,112,67,0.5)', borderRadius: '8px', pointerEvents: 'none' }} />
                          {enrichScanFlash && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', borderRadius: '10px' }} />}
                        </div>
                        <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#aaa', margin: '0 0 8px', textAlign: 'center' }}>
                          Point camera at barcode
                        </p>
                        <button onClick={stopEnrichCamera} style={{ ...btnBase, width: '100%', background: '#f0f0f0', color: '#888', padding: '8px' }}>
                          Cancel camera
                        </button>
                      </div>
                    )}

                    {!enrichCameraActive && !enrichBarcodeLoading && !enrichBarcodeResult && (
                      <>
                        <button onClick={startEnrichCamera} style={{ ...btnBase, width: '100%', background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', padding: '10px', marginBottom: '10px', fontSize: '14px', boxShadow: '0 4px 12px rgba(255,112,67,0.3)' }}>
                          📷 Open camera
                        </button>
                        {enrichCameraError && (
                          <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#ff4444', margin: '0 0 8px' }}>⚠ {enrichCameraError}</p>
                        )}
                        <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '11px', color: '#bbb', margin: '0 0 6px', textAlign: 'center' }}>or enter barcode manually</p>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <input
                            type="text" inputMode="numeric" placeholder="Barcode number"
                            value={enrichBarcodeInput}
                            onChange={e => setEnrichBarcodeInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && lookupEnrichBarcode(enrichBarcodeInput)}
                            style={{ ...editInputStyle, flex: 1 }}
                          />
                          <button
                            onClick={() => lookupEnrichBarcode(enrichBarcodeInput)}
                            disabled={!enrichBarcodeInput.trim()}
                            style={{ ...btnBase, background: enrichBarcodeInput.trim() ? 'linear-gradient(135deg,#ff7043,#ff9a3c)' : '#eee', color: enrichBarcodeInput.trim() ? 'white' : '#bbb', padding: '8px 14px', fontSize: '13px' }}
                          >
                            Lookup
                          </button>
                        </div>
                      </>
                    )}

                    {enrichBarcodeLoading && (
                      <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#ff9a3c', margin: 0, textAlign: 'center' }}>
                        Looking up product...
                      </p>
                    )}

                    {enrichBarcodeResult && (
                      <div style={{ background: 'white', borderRadius: '10px', padding: '12px', border: enrichBarcodeResult.found ? '1.5px solid rgba(76,175,80,0.25)' : '1.5px solid #eee' }}>
                        {enrichBarcodeResult.found ? (
                          <>
                            <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '15px', color: '#2d2d2d', margin: '0 0 4px' }}>Found: {enrichBarcodeResult.name}</p>
                            <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#aaa', margin: '0 0 10px' }}>
                              {enrichBarcodeResult.count > 1 ? `${enrichBarcodeResult.count} × ` : ''}
                              {enrichBarcodeResult.amount_per_unit != null ? `${enrichBarcodeResult.amount_per_unit} ${enrichBarcodeResult.unit}` : enrichBarcodeResult.unit}
                              {' · '}{enrichBarcodeResult.category}
                            </p>
                            {/* Diff preview — show exactly what will change */}
                            {(() => {
                              if (!editingItem) return null
                              const diffs: string[] = []
                              if (enrichBarcodeResult!.name && enrichBarcodeResult!.name !== editingItem.name)
                                diffs.push(`Name: "${editingItem.name}" → "${enrichBarcodeResult!.name}"`)
                              if (enrichBarcodeResult!.category && enrichBarcodeResult!.category !== editingItem.category)
                                diffs.push(`Category: ${editingItem.category || '—'} → ${enrichBarcodeResult!.category}`)
                              const willSetApu = !editingItem.amount_per_unit && enrichBarcodeResult!.amount_per_unit != null
                              if (willSetApu)
                                diffs.push(`Size: — → ${enrichBarcodeResult!.amount_per_unit} ${enrichBarcodeResult!.unit}`)
                              const willSetCount = (!editingItem.itemCount || editingItem.itemCount === '1') && (enrichBarcodeResult!.count ?? 1) > 1
                              if (willSetCount)
                                diffs.push(`Count: 1 → ${enrichBarcodeResult!.count}`)
                              return diffs.length > 0 ? (
                                <div style={{ background: '#f0fff4', border: '1px solid rgba(76,175,80,0.2)', borderRadius: '8px', padding: '8px 10px', marginBottom: '10px' }}>
                                  {diffs.map((d, i) => (
                                    <p key={i} style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '11px', color: '#388e3c', margin: i === 0 ? '0' : '2px 0 0' }}>↳ {d}</p>
                                  ))}
                                  <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '11px', color: '#bbb', margin: '4px 0 0' }}>Price, retailer and quantity unchanged.</p>
                                </div>
                              ) : (
                                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '11px', color: '#bbb', margin: '0 0 10px' }}>No changes to apply — already up to date.</p>
                              )
                            })()}
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button onClick={() => applyBarcodeEnrichment(enrichBarcodeResult!)} style={{ ...btnBase, flex: 1, background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', padding: '9px', boxShadow: '0 4px 12px rgba(255,112,67,0.3)' }}>
                                Apply to item
                              </button>
                              <button onClick={() => { setEnrichBarcodeResult(null); setEnrichBarcodeInput('') }} style={{ ...btnBase, background: '#f0f0f0', color: '#888', padding: '9px 14px' }}>
                                Try again
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#aaa', margin: '0 0 8px' }}>
                              Product not found in database for barcode {enrichBarcodeResult.barcode}
                            </p>
                            <button onClick={() => { setEnrichBarcodeResult(null); setEnrichBarcodeInput('') }} style={{ ...btnBase, background: '#f0f0f0', color: '#888', padding: '8px 16px', fontSize: '13px' }}>
                              Try a different barcode
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Receipt enrichment panel ── */}
                {enrichMode === 'receipt' && (
                  <div style={{ background: '#f9f9f9', borderRadius: '12px', padding: '14px' }}>
                    {!enrichReceiptResult && !enrichReceiptLoading && (
                      <>
                        <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#888', margin: '0 0 10px', lineHeight: 1.4 }}>
                          Scan a receipt to match this item and fill in price, retailer, and more.
                          The image is processed and immediately discarded — not stored.
                        </p>
                        <label style={{ ...btnBase, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', padding: '11px', fontSize: '14px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255,112,67,0.3)', borderRadius: '50px' }}>
                          <span>📷</span> Choose receipt photo
                          <input
                            ref={enrichReceiptRef}
                            type="file" accept="image/*" capture="environment"
                            onChange={handleEnrichReceiptFile}
                            style={{ display: 'none' }}
                          />
                        </label>
                      </>
                    )}

                    {enrichReceiptLoading && (
                      <div style={{ textAlign: 'center', padding: '8px 0' }}>
                        <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '16px', color: '#ff9a3c', margin: '0 0 4px' }}>✨ Reading receipt...</p>
                        <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#bbb', margin: 0 }}>AI is parsing the items</p>
                      </div>
                    )}

                    {enrichReceiptResult && (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '14px', color: '#2d2d2d', margin: 0 }}>
                            {enrichReceiptResult.retailer_name} — tap the matching line
                          </p>
                          <button onClick={() => { setEnrichReceiptResult(null) }} style={{ background: 'none', border: 'none', color: '#bbb', fontSize: '12px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, cursor: 'pointer', padding: '2px 6px' }}>
                            Rescan
                          </button>
                        </div>
                        <div style={{ maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {enrichReceiptResult.items.map((line, i) => (
                            <button
                              key={i}
                              onClick={() => applyReceiptLine(line, enrichReceiptResult!.retailer_name)}
                              style={{ background: 'white', border: '1.5px solid #eee', borderRadius: '10px', padding: '10px 12px', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}
                            >
                              <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#2d2d2d', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {line.normalized_name}
                              </span>
                              {line.price != null && (
                                <span style={{ fontFamily: "'Fredoka One',cursive", fontSize: '14px', color: '#ff7043', flexShrink: 0 }}>£{line.price.toFixed(2)}</span>
                              )}
                            </button>
                          ))}
                        </div>
                        <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '11px', color: '#bbb', margin: '8px 0 0' }}>
                          Applying will update price, retailer, and unit. Receipt image is discarded.
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Status */}
              <div>
                <label style={editLabelStyle}>Status</label>
                <select value={editingItem.status} onChange={e => setEditingItem({ ...editingItem, status: e.target.value })} style={{ ...editSelectStyle, maxWidth: '200px' }}>
                  <option value="active">Active</option>
                  <option value="used">Used</option>
                  <option value="discarded">Discarded</option>
                  <option value="expired">Expired</option>
                  <option value="removed">Removed</option>
                </select>
              </div>

              {/* Buttons */}
              <div style={{ display: 'flex', gap: '8px', paddingTop: '4px' }}>
                <button onClick={saveEdit} style={{ flex: 1, ...btnBase, background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', padding: '14px', fontSize: '16px', boxShadow: '0 6px 20px rgba(255,112,67,0.4)', fontFamily: "'Fredoka One',cursive" }}>
                  Save Changes
                </button>
                <button onClick={cancelEdit} style={{ ...btnBase, background: '#f5f5f5', color: '#888', padding: '14px 20px' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── Quick expiry modal ── */}
      {quickExpiryId && (
        <div onClick={() => setQuickExpiryId(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 3500, display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '20px 20px 0 0', padding: '20px 20px 36px', width: '100%', boxSizing: 'border-box' as const, boxShadow: '0 -4px 24px rgba(0,0,0,0.15)', fontFamily: "'Nunito',sans-serif" }}>
            <div style={{ width: '40px', height: '4px', background: '#eee', borderRadius: '2px', margin: '0 auto 16px' }} />
            <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '20px', color: '#ff7043', margin: '0 0 2px' }}>📅 Update Expiry</p>
            <p style={{ fontWeight: 700, fontSize: '13px', color: '#aaa', margin: '0 0 16px' }}>
              {items.find(i => i.id === quickExpiryId)?.name}
            </p>
            <input type="date" value={quickExpiryDate}
              onChange={e => setQuickExpiryDate(e.target.value)}
              style={{ width: '100%', border: '2px solid #eee', borderRadius: '10px', padding: '10px 14px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '15px', boxSizing: 'border-box' as const, marginBottom: '14px' }}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => saveQuickExpiry()} style={{ flex: 1, background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', border: 'none', borderRadius: '50px', padding: '13px', fontFamily: "'Fredoka One',cursive", fontSize: '16px', cursor: 'pointer', boxShadow: '0 4px 14px rgba(255,112,67,0.35)' }}>Save</button>
              {quickExpiryDate && (
                <button onClick={() => saveQuickExpiry('')} style={{ background: '#fff0f0', color: '#ff4444', border: 'none', borderRadius: '50px', padding: '13px 18px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', cursor: 'pointer' }}>Clear</button>
              )}
              <button onClick={() => setQuickExpiryId(null)} style={{ background: '#f5f5f5', color: '#888', border: 'none', borderRadius: '50px', padding: '13px 18px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── FAB ── */}
      {!selectMode && (
        <div style={{ position: 'fixed', bottom: '28px', right: '20px', zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
          {fabOpen && (
            <>
              <a
                href="/add?mode=receipt"
                onClick={() => setFabOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'white', borderRadius: '50px', padding: '10px 18px', textDecoration: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.14)', fontFamily: "'Fredoka One',cursive", fontSize: '16px', color: '#2d2d2d', whiteSpace: 'nowrap' }}
              >
                <span style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>🧾</span>
                Scan receipt
              </a>
              <a
                href="/add?mode=barcode"
                onClick={() => setFabOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'white', borderRadius: '50px', padding: '10px 18px', textDecoration: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.14)', fontFamily: "'Fredoka One',cursive", fontSize: '16px', color: '#2d2d2d', whiteSpace: 'nowrap' }}
              >
                <span style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>📷</span>
                Scan barcode
              </a>
              <a
                href="/add"
                onClick={() => setFabOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'white', borderRadius: '50px', padding: '10px 18px', textDecoration: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.14)', fontFamily: "'Fredoka One',cursive", fontSize: '16px', color: '#2d2d2d', whiteSpace: 'nowrap' }}
              >
                <span style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>📝</span>
                Add item
              </a>
            </>
          )}
          {/* Main FAB button */}
          <button
            onClick={() => setFabOpen(!fabOpen)}
            style={{ width: '56px', height: '56px', borderRadius: '50%', border: 'none', background: 'linear-gradient(135deg,#ff7043,#ff9a3c)', color: 'white', fontSize: '28px', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 6px 24px rgba(255,112,67,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform 0.2s', transform: fabOpen ? 'rotate(45deg)' : 'rotate(0deg)' }}
          >
            +
          </button>
        </div>
      )}

      {/* FAB backdrop */}
      {fabOpen && (
        <div
          onClick={() => setFabOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 199, background: 'rgba(0,0,0,0.25)' }}
        />
      )}
    </main>
  )
}
