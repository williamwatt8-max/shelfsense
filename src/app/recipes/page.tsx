'use client'

import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Recipe, RecipeIngredient, InventoryItem } from '@/lib/types'

// ── Local types ───────────────────────────────────────────────────────────────

type RecipeWithIngredients = Recipe & { ingredients: RecipeIngredient[] }

type Phase = 'list' | 'add_form' | 'add_scan' | 'scan_review' | 'detail' | 'shopping_preview'

type DraftIngredient = { id: string; name: string; quantity: string; unit: string }

type MatchStatus = 'sufficient' | 'partial' | 'missing' | 'unknown'

type IngredientMatch = {
  ingredient: RecipeIngredient
  scaledQty:  number
  status:     MatchStatus
  available:  number   // in base unit, -1 = units incompatible but name found
  baseUnit:   string
}

type ShoppingPreviewItem = {
  name:   string
  qty:    number
  unit:   string
  fromRecipeId: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const UNITS = ['g', 'kg', 'ml', 'l', 'item', 'tsp', 'tbsp', 'cup', 'clove', 'bunch', 'sprig', 'pinch', 'pack', 'slice', 'sheet', 'to taste']

function toBase(qty: number, unit: string): { qty: number; unit: string } {
  switch (unit.toLowerCase()) {
    case 'kg':   return { qty: qty * 1000, unit: 'g' }
    case 'l':    return { qty: qty * 1000, unit: 'ml' }
    default:     return { qty,             unit: unit.toLowerCase() }
  }
}

// Total available from an inventory item in its base unit.
// With the new quantity model, quantity already = count × amount_per_unit (total amount).
function availableBase(item: InventoryItem): { qty: number; unit: string } {
  return toBase(item.remaining_quantity ?? item.quantity, item.unit)
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

// Returns true if ingredient name likely matches inventory item name
function namesMatch(ingredientName: string, itemName: string): boolean {
  const a = normalizeForMatch(ingredientName)
  const b = normalizeForMatch(itemName)
  if (a === b) return true
  // Check word overlap: if any significant word (>2 chars) from ingredient appears in item name
  const aWords = a.split(' ').filter(w => w.length > 2)
  const bWords = b.split(' ').filter(w => w.length > 2)
  return aWords.some(w => b.includes(w)) || bWords.some(w => a.includes(w))
}

function matchIngredient(
  ingredient: RecipeIngredient,
  scaledQty: number,
  inventory: InventoryItem[]
): IngredientMatch {
  if (ingredient.unit === 'to taste') {
    return { ingredient, scaledQty, status: 'unknown', available: -1, baseUnit: 'to taste' }
  }

  const matching = inventory.filter(item =>
    item.status === 'active' && namesMatch(ingredient.name, item.name)
  )

  if (matching.length === 0) {
    return { ingredient, scaledQty, status: 'missing', available: 0, baseUnit: ingredient.unit }
  }

  // Try to compare quantities in base units
  const requiredBase = toBase(scaledQty, ingredient.unit)
  let totalAvail = 0
  let compatible  = false

  for (const item of matching) {
    const avail = availableBase(item)
    if (avail.unit === requiredBase.unit) {
      totalAvail += avail.qty
      compatible  = true
    }
  }

  if (!compatible) {
    // Name matched but units can't be compared (e.g. recipe needs "2 cloves", inventory has "garlic 50g")
    return { ingredient, scaledQty, status: 'unknown', available: -1, baseUnit: ingredient.unit }
  }

  if (totalAvail >= requiredBase.qty) {
    return { ingredient, scaledQty, status: 'sufficient', available: totalAvail, baseUnit: requiredBase.unit }
  }
  if (totalAvail > 0) {
    return { ingredient, scaledQty, status: 'partial', available: totalAvail, baseUnit: requiredBase.unit }
  }
  return { ingredient, scaledQty, status: 'missing', available: 0, baseUnit: requiredBase.unit }
}

function formatQty(qty: number, unit: string): string {
  if (unit === 'to taste') return 'to taste'
  const n = qty % 1 === 0 ? String(qty) : qty.toFixed(1).replace(/\.0$/, '')
  return `${n} ${unit}`
}

// Round needed quantity to sensible precision for shopping
function roundNeeded(qty: number, unit: string): number {
  if (['g', 'ml'].includes(unit)) return Math.ceil(qty / 10) * 10  // round up to nearest 10
  if (['kg', 'l'].includes(unit)) return Math.ceil(qty * 10) / 10  // 1 decimal place
  return Math.ceil(qty)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RecipesPage() {
  const [phase,          setPhase]          = useState<Phase>('list')
  const [recipes,        setRecipes]        = useState<RecipeWithIngredients[]>([])
  const [loading,        setLoading]        = useState(true)
  const [saving,         setSaving]         = useState(false)
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeWithIngredients | null>(null)
  const [desiredServings,setDesiredServings]= useState(2)
  const [inventory,      setInventory]      = useState<InventoryItem[]>([])
  const [matches,        setMatches]        = useState<IngredientMatch[]>([])
  const [shoppingPreview,setShoppingPreview]= useState<ShoppingPreviewItem[]>([])
  const [savingList,     setSavingList]     = useState(false)
  const [listSaved,      setListSaved]      = useState(false)
  const [toast,          setToast]          = useState<string | null>(null)
  const [searchQuery,    setSearchQuery]    = useState('')
  const [editMode,       setEditMode]       = useState(false)

  // Add / edit form state (shared between add_form phase and edit mode)
  const [draftName,         setDraftName]         = useState('')
  const [draftServings,     setDraftServings]      = useState('2')
  const [draftInstructions, setDraftInstructions]  = useState('')
  const [draftIngredients,  setDraftIngredients]   = useState<DraftIngredient[]>([
    { id: '1', name: '', quantity: '', unit: 'g' }
  ])

  // Scan state
  const [scanPreview,   setScanPreview]    = useState<string | null>(null)
  const [scanLoading,   setScanLoading]    = useState(false)
  const [scanError,     setScanError]      = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Scan review state (parsed result before saving)
  const [scanResult, setScanResult] = useState<{
    name: string; base_servings: number; instructions: string | null; raw_text: string | null
    ingredients: { name: string; quantity: number; unit: string }[]
  } | null>(null)

  useEffect(() => { loadRecipes() }, [])

  // ── Data ──────────────────────────────────────────────────────────────────

  async function loadRecipes() {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id
    if (!userId) { setLoading(false); return }

    const { data: recipeRows } = await supabase
      .from('recipes')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (!recipeRows) { setLoading(false); return }

    const recipeIds = recipeRows.map((r: any) => r.id)
    const { data: ingRows } = recipeIds.length > 0
      ? await supabase.from('recipe_ingredients').select('*').in('recipe_id', recipeIds)
      : { data: [] }

    const ingMap: Record<string, RecipeIngredient[]> = {}
    for (const ing of (ingRows || [])) {
      if (!ingMap[ing.recipe_id]) ingMap[ing.recipe_id] = []
      ingMap[ing.recipe_id].push(ing)
    }

    setRecipes(recipeRows.map((r: any) => ({ ...r, ingredients: ingMap[r.id] || [] })))
    setLoading(false)
  }

  async function loadInventory(): Promise<InventoryItem[]> {
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id
    if (!userId) return []
    const { data } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
    return (data || []) as InventoryItem[]
  }

  async function saveRecipeFromForm() {
    const name = draftName.trim()
    if (!name) return
    const validIngs = draftIngredients.filter(i => i.name.trim())
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id ?? null
    const { data: recipeRow, error } = await supabase
      .from('recipes')
      .insert({ name, base_servings: parseInt(draftServings) || 2, instructions: draftInstructions.trim() || null, source: 'manual', user_id: userId })
      .select().single()
    if (error || !recipeRow) { setSaving(false); alert('Error saving: ' + error?.message); return }
    if (validIngs.length > 0) {
      await supabase.from('recipe_ingredients').insert(
        validIngs.map(i => ({
          recipe_id: recipeRow.id,
          name:      i.name.trim().toLowerCase(),
          quantity:  parseFloat(i.quantity) || 1,
          unit:      i.unit,
        }))
      )
    }
    setSaving(false)
    resetAddForm()
    showToast(`✅ ${name} saved!`)
    loadRecipes()
    setPhase('list')
  }

  async function saveRecipeFromScan() {
    if (!scanResult) return
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id ?? null
    const { data: recipeRow, error } = await supabase
      .from('recipes')
      .insert({
        name:          scanResult.name,
        base_servings: scanResult.base_servings,
        instructions:  scanResult.instructions,
        raw_text:      scanResult.raw_text,
        source:        'scanned',
        user_id:       userId,
      })
      .select().single()
    if (error || !recipeRow) { setSaving(false); alert('Error: ' + error?.message); return }
    if (scanResult.ingredients.length > 0) {
      await supabase.from('recipe_ingredients').insert(
        scanResult.ingredients.map(i => ({ recipe_id: recipeRow.id, name: i.name, quantity: i.quantity, unit: i.unit }))
      )
    }
    setSaving(false)
    setScanResult(null); setScanPreview(null)
    showToast(`✅ ${scanResult.name} saved!`)
    loadRecipes()
    setPhase('list')
  }

  async function deleteRecipe(id: string) {
    if (!confirm('Delete this recipe?')) return
    await supabase.from('recipes').delete().eq('id', id)
    if (selectedRecipe?.id === id) { setSelectedRecipe(null); setPhase('list') }
    loadRecipes()
  }

  function startEditRecipe(recipe: RecipeWithIngredients) {
    setDraftName(recipe.name)
    setDraftServings(String(recipe.base_servings))
    setDraftInstructions(recipe.instructions || '')
    setDraftIngredients(recipe.ingredients.map(i => ({ id: i.id, name: i.name, quantity: String(i.quantity), unit: i.unit })))
    setEditMode(true)
  }

  async function saveRecipeEdits() {
    if (!selectedRecipe || !draftName.trim()) return
    setSaving(true)
    const validIngs = draftIngredients.filter(i => i.name.trim())
    await supabase.from('recipes').update({
      name: draftName.trim(),
      base_servings: parseInt(draftServings) || 2,
      instructions: draftInstructions.trim() || null,
    }).eq('id', selectedRecipe.id)
    // Replace ingredients: delete old, insert new
    await supabase.from('recipe_ingredients').delete().eq('recipe_id', selectedRecipe.id)
    if (validIngs.length > 0) {
      await supabase.from('recipe_ingredients').insert(
        validIngs.map(i => ({ recipe_id: selectedRecipe.id, name: i.name.trim().toLowerCase(), quantity: parseFloat(i.quantity) || 1, unit: i.unit }))
      )
    }
    setSaving(false)
    setEditMode(false)
    showToast(`✅ ${draftName.trim()} updated!`)
    await loadRecipes()
    // Refresh selectedRecipe from updated data
    const updated = recipes.find(r => r.id === selectedRecipe.id)
    if (updated) { setSelectedRecipe(updated); computeMatches(updated, desiredServings, inventory) }
  }

  async function openDetail(recipe: RecipeWithIngredients) {
    setSelectedRecipe(recipe)
    setDesiredServings(recipe.base_servings)
    setMatches([])
    setShoppingPreview([])
    setListSaved(false)
    setPhase('detail')
    const inv = await loadInventory()
    setInventory(inv)
    computeMatches(recipe, recipe.base_servings, inv)
  }

  function computeMatches(recipe: RecipeWithIngredients, servings: number, inv: InventoryItem[]) {
    const scale = servings / recipe.base_servings
    const result = recipe.ingredients.map(ing =>
      matchIngredient(ing, ing.quantity * scale, inv)
    )
    setMatches(result)
  }

  function onServingsChange(n: number) {
    if (!selectedRecipe || n < 1) return
    setDesiredServings(n)
    computeMatches(selectedRecipe, n, inventory)
    setShoppingPreview([])
    setListSaved(false)
  }

  function generateShoppingList() {
    if (!selectedRecipe) return
    const scale = desiredServings / selectedRecipe.base_servings
    const items: ShoppingPreviewItem[] = []

    for (const m of matches) {
      if (m.status === 'sufficient' || m.status === 'unknown') continue
      if (m.ingredient.unit === 'to taste') continue

      const scaledQty = m.ingredient.quantity * scale

      if (m.status === 'missing') {
        items.push({
          name: m.ingredient.name,
          qty:  roundNeeded(scaledQty, m.ingredient.unit),
          unit: m.ingredient.unit,
          fromRecipeId: selectedRecipe.id,
        })
      } else if (m.status === 'partial') {
        // Convert available back from base unit
        const required = toBase(scaledQty, m.ingredient.unit).qty
        const gap = Math.max(0, required - m.available)
        if (gap > 0) {
          const gapInOrigUnit = gap / (toBase(1, m.ingredient.unit).qty)
          items.push({
            name: m.ingredient.name,
            qty:  roundNeeded(gapInOrigUnit, m.ingredient.unit),
            unit: m.ingredient.unit,
            fromRecipeId: selectedRecipe.id,
          })
        }
      }
    }

    setShoppingPreview(items)
    setPhase('shopping_preview')
  }

  async function saveShoppingList() {
    if (shoppingPreview.length === 0) return
    setSavingList(true)
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id ?? null

    // Fetch existing unchecked shopping list items to merge duplicates
    const { data: existing } = await supabase
      .from('shopping_list_items').select('*').eq('user_id', userId!).eq('checked', false)
    const existingItems = existing || []

    const toInsert: typeof shoppingPreview = []
    const toUpdate: { id: string; quantity: number }[] = []

    for (const item of shoppingPreview) {
      const normName = item.name.toLowerCase().trim()
      const match = existingItems.find(e =>
        e.name.toLowerCase().trim() === normName && e.unit === item.unit
      )
      if (match) {
        toUpdate.push({ id: match.id, quantity: match.quantity + item.qty })
      } else {
        toInsert.push(item)
      }
    }

    // Apply updates
    await Promise.all(toUpdate.map(u =>
      supabase.from('shopping_list_items').update({ quantity: u.quantity }).eq('id', u.id)
    ))

    // Insert new
    if (toInsert.length > 0) {
      const { error } = await supabase.from('shopping_list_items').insert(
        toInsert.map(item => ({ user_id: userId, name: item.name, quantity: item.qty, unit: item.unit, recipe_id: item.fromRecipeId }))
      )
      if (error) { setSavingList(false); alert('Error: ' + error.message); return }
    }

    setSavingList(false)
    setListSaved(true)
    showToast(`✅ ${shoppingPreview.length} item${shoppingPreview.length !== 1 ? 's' : ''} added to shopping list${toUpdate.length > 0 ? ` (${toUpdate.length} merged)` : ''}`)
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function resetAddForm() {
    setDraftName(''); setDraftServings('2'); setDraftInstructions('')
    setDraftIngredients([{ id: '1', name: '', quantity: '', unit: 'g' }])
  }

  function addIngredientRow() {
    setDraftIngredients(prev => [...prev, { id: String(Date.now()), name: '', quantity: '', unit: 'g' }])
  }

  function updateIngredient(id: string, patch: Partial<DraftIngredient>) {
    setDraftIngredients(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i))
  }

  function removeIngredient(id: string) {
    setDraftIngredients(prev => prev.length > 1 ? prev.filter(i => i.id !== id) : prev)
  }

  function updateShoppingItem(idx: number, patch: Partial<ShoppingPreviewItem>) {
    setShoppingPreview(prev => prev.map((item, i) => i === idx ? { ...item, ...patch } : item))
  }

  function removeShoppingItem(idx: number) {
    setShoppingPreview(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setScanPreview(URL.createObjectURL(file))
    setScanLoading(true); setScanError(null)
    try {
      const fd = new FormData(); fd.append('image', file)
      const res = await fetch('/api/parse-recipe', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setScanResult(data)
      setPhase('scan_review')
    } catch (err: any) {
      setScanError(err.message || 'Could not read recipe — try a clearer photo.')
    }
    setScanLoading(false)
    e.target.value = ''
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  // ── Status helpers ─────────────────────────────────────────────────────────

  function statusIcon(s: MatchStatus) {
    if (s === 'sufficient') return '✅'
    if (s === 'partial')    return '⚠️'
    if (s === 'missing')    return '❌'
    return '✓'
  }
  function statusColor(s: MatchStatus) {
    if (s === 'sufficient') return '#4caf50'
    if (s === 'partial')    return '#ff9800'
    if (s === 'missing')    return '#ff4444'
    return '#aaa'
  }
  function statusLabel(m: IngredientMatch) {
    const s = m.status
    if (s === 'sufficient') return `✓ Have ${m.available >= 0 ? formatQty(m.available, m.baseUnit) : 'it'}`
    if (s === 'partial')    return `⚠ Have ${formatQty(m.available, m.baseUnit)}, need ${formatQty(m.scaledQty, m.ingredient.unit)}`
    if (s === 'missing')    return '✗ Not in inventory'
    if (m.available === -1) return '✓ Found in inventory'
    return '?'
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  const warm: React.CSSProperties = {
    fontFamily: "'Nunito', sans-serif",
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #fdf6ec 0%, #fde8d0 50%, #fce4e4 100%)',
    padding: '72px 24px 40px',
  }
  const card: React.CSSProperties = {
    background: 'white', borderRadius: '14px', padding: '16px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.07)',
  }
  const btn = (bg: string, color = 'white'): React.CSSProperties => ({
    border: 'none', borderRadius: '50px', padding: '10px 20px',
    fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px',
    cursor: 'pointer', background: bg, color,
  })
  const inp: React.CSSProperties = {
    border: '2px solid #eee', borderRadius: '8px', padding: '8px 10px',
    fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px',
    width: '100%', boxSizing: 'border-box' as const,
  }
  const lbl: React.CSSProperties = {
    fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '11px',
    color: '#aaa', textTransform: 'uppercase' as const, letterSpacing: '0.5px',
    marginBottom: '4px', display: 'block',
  }

  const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap');`

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main style={warm}>
      <style>{FONTS}</style>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)', background: '#2d2d2d', color: 'white', padding: '10px 20px', borderRadius: '50px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', zIndex: 2000, whiteSpace: 'nowrap', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}

      <div style={{ maxWidth: '640px', margin: '0 auto' }}>

        {/* ══════════════════════════════════════════════════════ LIST ══ */}
        {phase === 'list' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <a href="/" style={{ color: '#ff7043', fontWeight: 700, fontSize: '14px', textDecoration: 'none' }}>← Home</a>
              <h1 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '32px', color: '#2d2d2d', margin: 0, flex: 1 }}>Recipes</h1>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => { resetAddForm(); setPhase('add_form') }} style={btn('linear-gradient(135deg,#ff7043,#ff9a3c)')}>
                  + Manual
                </button>
                <button onClick={() => { setScanPreview(null); setScanError(null); setPhase('add_scan') }} style={btn('white', '#ff7043')}>
                  📷 Scan
                </button>
              </div>
            </div>

            {/* Search */}
            {recipes.length > 2 && (
              <div style={{ marginBottom: '16px' }}>
                <input
                  type="text"
                  placeholder="🔍 Search recipes..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={{ ...inp, background: 'white' }}
                />
              </div>
            )}

            {loading && (
              <p style={{ textAlign: 'center', color: '#aaa', fontWeight: 700, marginTop: '40px' }}>Loading recipes...</p>
            )}

            {!loading && recipes.length === 0 && (
              <div style={{ ...card, textAlign: 'center', padding: '40px 24px' }}>
                <div style={{ fontSize: '56px', marginBottom: '12px' }}>🍽️</div>
                <h2 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '24px', color: '#2d2d2d', margin: '0 0 8px' }}>No recipes yet</h2>
                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#aaa', margin: '0 0 20px' }}>
                  Add recipes manually or scan a cookbook page
                </p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button onClick={() => { resetAddForm(); setPhase('add_form') }} style={btn('linear-gradient(135deg,#ff7043,#ff9a3c)')}>
                    + Add Manually
                  </button>
                  <button onClick={() => { setScanPreview(null); setScanError(null); setPhase('add_scan') }} style={btn('white', '#ff7043')}>
                    📷 Scan a Recipe
                  </button>
                </div>
              </div>
            )}

            {recipes
              .filter(r => !searchQuery || r.name.toLowerCase().includes(searchQuery.toLowerCase()))
              .map(recipe => (
                <div key={recipe.id} onClick={() => openDetail(recipe)}
                  style={{ ...card, marginBottom: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{ fontSize: '32px' }}>🍽️</div>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '18px', color: '#2d2d2d', margin: '0 0 2px' }}>
                      {recipe.name}
                    </h3>
                    <p style={{ color: '#bbb', fontWeight: 700, fontSize: '12px', margin: 0 }}>
                      {recipe.base_servings} serving{recipe.base_servings !== 1 ? 's' : ''} · {recipe.ingredients.length} ingredient{recipe.ingredients.length !== 1 ? 's' : ''}
                      {recipe.source === 'scanned' && ' · 📷 scanned'}
                    </p>
                  </div>
                  <span style={{ color: '#ddd', fontSize: '20px' }}>›</span>
                </div>
              ))}
          </>
        )}

        {/* ══════════════════════════════════════════════════ ADD FORM ══ */}
        {phase === 'add_form' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <button onClick={() => setPhase('list')} style={{ background: 'none', border: 'none', color: '#ff7043', fontWeight: 700, fontSize: '14px', cursor: 'pointer', padding: 0 }}>← Back</button>
              <h1 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '28px', color: '#2d2d2d', margin: 0 }}>New Recipe</h1>
            </div>

            <div style={{ ...card, marginBottom: '12px' }}>
              <div style={{ marginBottom: '12px' }}>
                <label style={lbl}>Recipe name</label>
                <input style={inp} placeholder="e.g. Spaghetti Carbonara" value={draftName} onChange={e => setDraftName(e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Serves</label>
                <input style={{ ...inp, width: '80px' }} type="number" min={1} value={draftServings} onChange={e => setDraftServings(e.target.value)} />
              </div>
            </div>

            {/* Ingredients */}
            <div style={{ ...card, marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontFamily: "'Fredoka One',cursive", fontSize: '18px', color: '#2d2d2d' }}>Ingredients</span>
                <button onClick={addIngredientRow} style={{ ...btn('rgba(255,112,67,0.1)', '#ff7043'), padding: '6px 14px', fontSize: '13px' }}>+ Add</button>
              </div>
              {draftIngredients.map((ing) => (
                <div key={ing.id} style={{ display: 'flex', gap: '6px', marginBottom: '8px', alignItems: 'center' }}>
                  <input style={{ ...inp, flex: 3 }} placeholder="ingredient name" value={ing.name}
                    onChange={e => updateIngredient(ing.id, { name: e.target.value })} />
                  <input style={{ ...inp, width: '58px', flex: 'none', textAlign: 'center' }} type="number" min={0} step={0.1}
                    placeholder="qty" value={ing.quantity} onChange={e => updateIngredient(ing.id, { quantity: e.target.value })} />
                  <select style={{ ...inp, flex: 'none', width: '70px', padding: '8px 4px' }} value={ing.unit}
                    onChange={e => updateIngredient(ing.id, { unit: e.target.value })}>
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                  <button onClick={() => removeIngredient(ing.id)} style={{ background: 'none', border: 'none', color: '#ddd', cursor: 'pointer', fontSize: '16px', flexShrink: 0, padding: '4px' }}>✕</button>
                </div>
              ))}
            </div>

            {/* Instructions (optional) */}
            <div style={{ ...card, marginBottom: '20px' }}>
              <label style={lbl}>Instructions (optional)</label>
              <textarea
                rows={4}
                style={{ ...inp, resize: 'vertical' as const, lineHeight: 1.5 }}
                placeholder="Method / cooking steps..."
                value={draftInstructions}
                onChange={e => setDraftInstructions(e.target.value)}
              />
            </div>

            <button
              onClick={saveRecipeFromForm}
              disabled={saving || !draftName.trim()}
              style={{ ...btn(saving || !draftName.trim() ? '#eee' : 'linear-gradient(135deg,#ff7043,#ff9a3c)', saving || !draftName.trim() ? '#bbb' : 'white'), width: '100%', fontSize: '16px', padding: '14px', boxShadow: saving ? 'none' : '0 6px 20px rgba(255,112,67,0.35)' }}
            >
              {saving ? 'Saving...' : '💾 Save Recipe'}
            </button>
          </>
        )}

        {/* ═══════════════════════════════════════════════════ ADD SCAN ══ */}
        {phase === 'add_scan' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <button onClick={() => setPhase('list')} style={{ background: 'none', border: 'none', color: '#ff7043', fontWeight: 700, fontSize: '14px', cursor: 'pointer', padding: 0 }}>← Back</button>
              <h1 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '28px', color: '#2d2d2d', margin: 0 }}>Scan Recipe</h1>
            </div>

            <div style={{ ...card, textAlign: 'center', padding: '32px 24px' }}>
              {scanPreview && (
                <img src={scanPreview} alt="Recipe" style={{ maxWidth: '100%', maxHeight: '240px', borderRadius: '12px', marginBottom: '16px', objectFit: 'contain' }} />
              )}
              {scanLoading && (
                <div style={{ marginBottom: '16px' }}>
                  <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '18px', color: '#ff7043', margin: '0 0 6px' }}>✨ Reading recipe...</p>
                  <p style={{ color: '#bbb', fontSize: '13px', fontWeight: 700 }}>AI is extracting ingredients</p>
                </div>
              )}
              {scanError && !scanLoading && (
                <div style={{ background: '#fff0f0', borderRadius: '12px', padding: '12px 16px', marginBottom: '16px' }}>
                  <p style={{ color: '#ff4444', fontWeight: 700, fontSize: '13px', margin: 0 }}>⚠ {scanError}</p>
                </div>
              )}
              {!scanLoading && (
                <label style={{ ...btn('linear-gradient(135deg,#ff7043,#ff9a3c)'), display: 'inline-flex', alignItems: 'center', gap: '10px', fontSize: '16px', padding: '14px 32px', cursor: 'pointer', boxShadow: '0 6px 20px rgba(255,112,67,0.35)' }}>
                  <span style={{ fontSize: '22px' }}>📷</span>
                  {scanPreview ? 'Try a Different Photo' : 'Upload Recipe Photo'}
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} style={{ display: 'none' }} />
                </label>
              )}
              {!scanPreview && !scanLoading && (
                <p style={{ color: '#bbb', fontWeight: 700, fontSize: '12px', marginTop: '12px' }}>
                  Photo of a cookbook page, recipe card, or screenshot
                </p>
              )}
            </div>
          </>
        )}

        {/* ════════════════════════════════════════════════ SCAN REVIEW ══ */}
        {phase === 'scan_review' && scanResult && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <button onClick={() => setPhase('add_scan')} style={{ background: 'none', border: 'none', color: '#ff7043', fontWeight: 700, fontSize: '14px', cursor: 'pointer', padding: 0 }}>← Rescan</button>
              <h1 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '28px', color: '#2d2d2d', margin: 0, flex: 1 }}>Review Recipe</h1>
            </div>

            <div style={{ ...card, marginBottom: '12px' }}>
              <div style={{ marginBottom: '12px' }}>
                <label style={lbl}>Recipe name</label>
                <input style={inp} value={scanResult.name}
                  onChange={e => setScanResult(r => r ? { ...r, name: e.target.value } : r)} />
              </div>
              <div>
                <label style={lbl}>Serves</label>
                <input style={{ ...inp, width: '80px' }} type="number" min={1} value={scanResult.base_servings}
                  onChange={e => setScanResult(r => r ? { ...r, base_servings: parseInt(e.target.value) || 2 } : r)} />
              </div>
            </div>

            <div style={{ ...card, marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontFamily: "'Fredoka One',cursive", fontSize: '18px', color: '#2d2d2d' }}>Ingredients ({scanResult.ingredients.length})</span>
                <button onClick={() => setScanResult(r => r ? { ...r, ingredients: [...r.ingredients, { name: '', quantity: 1, unit: 'g' }] } : r)}
                  style={{ ...btn('rgba(255,112,67,0.1)', '#ff7043'), padding: '6px 14px', fontSize: '13px' }}>+ Add</button>
              </div>
              {scanResult.ingredients.map((ing, i) => (
                <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '8px', alignItems: 'center' }}>
                  <input style={{ ...inp, flex: 3 }} value={ing.name}
                    onChange={e => setScanResult(r => { if (!r) return r; const ings = [...r.ingredients]; ings[i] = { ...ings[i], name: e.target.value }; return { ...r, ingredients: ings } })} />
                  <input style={{ ...inp, width: '58px', flex: 'none', textAlign: 'center' }} type="number" min={0} step={0.1}
                    value={ing.quantity}
                    onChange={e => setScanResult(r => { if (!r) return r; const ings = [...r.ingredients]; ings[i] = { ...ings[i], quantity: parseFloat(e.target.value) || 1 }; return { ...r, ingredients: ings } })} />
                  <select style={{ ...inp, flex: 'none', width: '70px', padding: '8px 4px' }} value={ing.unit}
                    onChange={e => setScanResult(r => { if (!r) return r; const ings = [...r.ingredients]; ings[i] = { ...ings[i], unit: e.target.value }; return { ...r, ingredients: ings } })}>
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                  <button onClick={() => setScanResult(r => r ? { ...r, ingredients: r.ingredients.filter((_, j) => j !== i) } : r)}
                    style={{ background: 'none', border: 'none', color: '#ddd', cursor: 'pointer', fontSize: '16px', flexShrink: 0, padding: '4px' }}>✕</button>
                </div>
              ))}
            </div>

            <button onClick={saveRecipeFromScan} disabled={saving}
              style={{ ...btn(saving ? '#eee' : 'linear-gradient(135deg,#ff7043,#ff9a3c)', saving ? '#bbb' : 'white'), width: '100%', fontSize: '16px', padding: '14px', boxShadow: saving ? 'none' : '0 6px 20px rgba(255,112,67,0.35)' }}>
              {saving ? 'Saving...' : '💾 Save Recipe'}
            </button>
          </>
        )}

        {/* ══════════════════════════════════════════════════ DETAIL ══ */}
        {phase === 'detail' && selectedRecipe && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
              <button onClick={() => { setPhase('list'); setEditMode(false) }} style={{ background: 'none', border: 'none', color: '#ff7043', fontWeight: 700, fontSize: '14px', cursor: 'pointer', padding: 0 }}>← Recipes</button>
              <h1 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '26px', color: '#2d2d2d', margin: 0, flex: 1, lineHeight: 1.2 }}>{selectedRecipe.name}</h1>
              <button onClick={() => { if (editMode) setEditMode(false); else startEditRecipe(selectedRecipe) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px', color: editMode ? '#ff7043' : '#aaa', padding: '4px', fontFamily: "'Nunito',sans-serif", fontWeight: 700 }}>
                {editMode ? '✕ Cancel' : '✏️ Edit'}
              </button>
              <button onClick={() => deleteRecipe(selectedRecipe.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#ddd', padding: '4px' }}>🗑</button>
            </div>

            {/* ── Edit mode form ── */}
            {editMode && (
              <div style={{ ...card, marginBottom: '16px', border: '2px solid rgba(255,112,67,0.2)' }}>
                <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '16px', color: '#ff7043', margin: '0 0 14px' }}>✏️ Edit Recipe</p>
                <div style={{ marginBottom: '10px' }}>
                  <label style={lbl}>Name</label>
                  <input style={inp} value={draftName} onChange={e => setDraftName(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                  <div>
                    <label style={lbl}>Serves</label>
                    <input style={{ ...inp, width: '72px' }} type="number" min={1} value={draftServings} onChange={e => setDraftServings(e.target.value)} />
                  </div>
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <label style={lbl}>Ingredients</label>
                    <button onClick={addIngredientRow} style={{ ...btn('rgba(255,112,67,0.1)', '#ff7043'), padding: '4px 12px', fontSize: '12px' }}>+ Add</button>
                  </div>
                  {draftIngredients.map(ing => (
                    <div key={ing.id} style={{ display: 'flex', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
                      <input style={{ ...inp, flex: 3 }} placeholder="ingredient" value={ing.name} onChange={e => updateIngredient(ing.id, { name: e.target.value })} />
                      <input style={{ ...inp, width: '56px', flex: 'none', textAlign: 'center' }} type="number" min={0} step={0.1} placeholder="qty" value={ing.quantity} onChange={e => updateIngredient(ing.id, { quantity: e.target.value })} />
                      <select style={{ ...inp, flex: 'none', width: '68px', padding: '8px 4px' }} value={ing.unit} onChange={e => updateIngredient(ing.id, { unit: e.target.value })}>
                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                      <button onClick={() => removeIngredient(ing.id)} style={{ background: 'none', border: 'none', color: '#ddd', cursor: 'pointer', fontSize: '15px', padding: '4px' }}>✕</button>
                    </div>
                  ))}
                </div>
                <div style={{ marginBottom: '14px' }}>
                  <label style={lbl}>Instructions (optional)</label>
                  <textarea rows={3} style={{ ...inp, resize: 'vertical' as const, lineHeight: 1.5 }} value={draftInstructions} onChange={e => setDraftInstructions(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={saveRecipeEdits} disabled={saving || !draftName.trim()}
                    style={{ ...btn(saving ? '#eee' : 'linear-gradient(135deg,#ff7043,#ff9a3c)', saving ? '#bbb' : 'white'), flex: 1, padding: '11px' }}>
                    {saving ? 'Saving...' : '💾 Save Changes'}
                  </button>
                  <button onClick={() => setEditMode(false)} style={{ ...btn('white', '#888') }}>Cancel</button>
                </div>
              </div>
            )}


            {/* Servings control */}
            <div style={{ ...card, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontFamily: "'Fredoka One',cursive", fontSize: '16px', color: '#888', flex: 1 }}>Servings</span>
              <button onClick={() => onServingsChange(desiredServings - 1)} disabled={desiredServings <= 1}
                style={{ width: '34px', height: '34px', borderRadius: '50%', border: '2px solid #eee', background: 'white', cursor: 'pointer', fontSize: '18px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', color: desiredServings <= 1 ? '#ddd' : '#2d2d2d' }}>−</button>
              <span style={{ fontFamily: "'Fredoka One',cursive", fontSize: '24px', color: '#ff7043', minWidth: '28px', textAlign: 'center' }}>{desiredServings}</span>
              <button onClick={() => onServingsChange(desiredServings + 1)}
                style={{ width: '34px', height: '34px', borderRadius: '50%', border: '2px solid #eee', background: 'white', cursor: 'pointer', fontSize: '18px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2d2d2d' }}>+</button>
              {desiredServings !== selectedRecipe.base_servings && (
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#aaa', fontFamily: "'Nunito',sans-serif" }}>
                  base: {selectedRecipe.base_servings}
                </span>
              )}
            </div>

            {/* Ingredients with match */}
            <div style={{ ...card, marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontFamily: "'Fredoka One',cursive", fontSize: '18px', color: '#2d2d2d' }}>Ingredients</span>
                {inventory.length === 0 && (
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#ccc', fontFamily: "'Nunito',sans-serif" }}>loading inventory...</span>
                )}
              </div>

              {selectedRecipe.ingredients.length === 0 && (
                <p style={{ color: '#ccc', fontWeight: 700, fontSize: '14px', margin: 0 }}>No ingredients added.</p>
              )}

              {selectedRecipe.ingredients.map((ing, i) => {
                const scale = desiredServings / selectedRecipe.base_servings
                const scaledQty = ing.quantity * scale
                const match = matches[i]
                const status = match?.status ?? 'unknown'
                return (
                  <div key={ing.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '8px 0', borderTop: i > 0 ? '1px solid #f5f5f5' : 'none' }}>
                    <span style={{ fontSize: '16px', flexShrink: 0, marginTop: '1px' }}>{statusIcon(status)}</span>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: '14px', color: '#2d2d2d', fontFamily: "'Nunito',sans-serif", textTransform: 'capitalize' as const }}>
                        {ing.name}
                      </p>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: '12px', color: '#aaa', fontFamily: "'Nunito',sans-serif" }}>
                        {formatQty(scaledQty, ing.unit)}
                        {match && inventory.length > 0 && (
                          <span style={{ color: statusColor(status), marginLeft: '8px' }}>{statusLabel(match)}</span>
                        )}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Instructions */}
            {selectedRecipe.instructions && (
              <div style={{ ...card, marginBottom: '12px' }}>
                <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '16px', color: '#2d2d2d', margin: '0 0 8px' }}>Method</p>
                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: '13px', color: '#666', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' as const }}>{selectedRecipe.instructions}</p>
              </div>
            )}

            {/* Match summary + generate button */}
            {inventory.length > 0 && matches.length > 0 && (
              <div style={{ ...card, marginBottom: '20px' }}>
                <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
                  {[
                    { s: 'sufficient' as MatchStatus, label: 'Have', color: '#4caf50' },
                    { s: 'partial' as MatchStatus,    label: 'Low',  color: '#ff9800' },
                    { s: 'missing' as MatchStatus,    label: 'Need', color: '#ff4444' },
                  ].map(({ s, label, color }) => {
                    const count = matches.filter(m => m.status === s).length
                    return (
                      <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: color, flexShrink: 0 }} />
                        <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px', color: '#555' }}>{count} {label}</span>
                      </div>
                    )
                  })}
                </div>
                {matches.some(m => m.status === 'missing' || m.status === 'partial') ? (
                  <button onClick={generateShoppingList}
                    style={{ ...btn('linear-gradient(135deg,#ff7043,#ff9a3c)'), width: '100%', fontSize: '15px', padding: '12px', boxShadow: '0 6px 20px rgba(255,112,67,0.35)' }}>
                    🛒 Generate Shopping List
                  </button>
                ) : (
                  <div style={{ textAlign: 'center', padding: '8px 0' }}>
                    <span style={{ fontFamily: "'Fredoka One',cursive", fontSize: '18px', color: '#4caf50' }}>✅ You have everything!</span>
                  </div>
                )}
              </div>
            )}

            {inventory.length > 0 && matches.length === 0 && selectedRecipe.ingredients.length > 0 && (
              <button onClick={generateShoppingList}
                style={{ ...btn('linear-gradient(135deg,#ff7043,#ff9a3c)'), width: '100%', fontSize: '15px', padding: '12px', marginBottom: '20px', boxShadow: '0 6px 20px rgba(255,112,67,0.35)' }}>
                🛒 Generate Shopping List
              </button>
            )}
          </>
        )}

        {/* ═══════════════════════════════════════ SHOPPING PREVIEW ══ */}
        {phase === 'shopping_preview' && selectedRecipe && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <button onClick={() => { setPhase('detail'); setShoppingPreview([]) }} style={{ background: 'none', border: 'none', color: '#ff7043', fontWeight: 700, fontSize: '14px', cursor: 'pointer', padding: 0 }}>← Recipe</button>
              <div style={{ flex: 1 }}>
                <h1 style={{ fontFamily: "'Fredoka One',cursive", fontSize: '26px', color: '#2d2d2d', margin: 0 }}>Shopping List</h1>
                <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#aaa', margin: 0 }}>
                  From: {selectedRecipe.name} · {desiredServings} serving{desiredServings !== 1 ? 's' : ''}
                </p>
              </div>
              <a href="/shopping-list" style={{ color: '#aaa', fontWeight: 700, fontSize: '12px', textDecoration: 'none' }}>View list</a>
            </div>

            {shoppingPreview.length === 0 ? (
              <div style={{ ...card, textAlign: 'center', padding: '32px' }}>
                <div style={{ fontSize: '40px', marginBottom: '8px' }}>✅</div>
                <p style={{ fontFamily: "'Fredoka One',cursive", fontSize: '20px', color: '#4caf50', margin: 0 }}>You have everything!</p>
                <p style={{ color: '#bbb', fontWeight: 700, fontSize: '13px', marginTop: '6px' }}>No items to buy for this recipe.</p>
              </div>
            ) : (
              <>
                <div style={{ ...card, marginBottom: '12px' }}>
                  <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '12px', color: '#aaa', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {shoppingPreview.length} item{shoppingPreview.length !== 1 ? 's' : ''} to buy — edit before saving
                  </p>
                  {shoppingPreview.map((item, i) => (
                    <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '8px 0', borderTop: i > 0 ? '1px solid #f5f5f5' : 'none' }}>
                      <span style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '14px', color: '#2d2d2d', flex: 1, textTransform: 'capitalize' as const }}>{item.name}</span>
                      <input type="number" min={0} step={0.1} value={item.qty}
                        onChange={e => updateShoppingItem(i, { qty: parseFloat(e.target.value) || 0 })}
                        style={{ border: '2px solid #eee', borderRadius: '8px', padding: '6px 8px', width: '68px', textAlign: 'center', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px' }} />
                      <select value={item.unit} onChange={e => updateShoppingItem(i, { unit: e.target.value })}
                        style={{ border: '2px solid #eee', borderRadius: '8px', padding: '6px 4px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: '13px' }}>
                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                      <button onClick={() => removeShoppingItem(i)} style={{ background: 'none', border: 'none', color: '#ddd', cursor: 'pointer', fontSize: '16px', padding: '4px' }}>✕</button>
                    </div>
                  ))}
                </div>

                {listSaved ? (
                  <div style={{ textAlign: 'center', padding: '16px' }}>
                    <span style={{ fontFamily: "'Fredoka One',cursive", fontSize: '20px', color: '#4caf50' }}>✅ Saved to shopping list!</span>
                    <div style={{ marginTop: '12px', display: 'flex', gap: '10px', justifyContent: 'center' }}>
                      <a href="/shopping-list" style={{ ...btn('linear-gradient(135deg,#ff7043,#ff9a3c)'), textDecoration: 'none' }}>View Shopping List</a>
                      <button onClick={() => setPhase('detail')} style={btn('white', '#ff7043')}>Back to Recipe</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={saveShoppingList} disabled={savingList}
                    style={{ ...btn(savingList ? '#eee' : 'linear-gradient(135deg,#ff7043,#ff9a3c)', savingList ? '#bbb' : 'white'), width: '100%', fontSize: '16px', padding: '14px', boxShadow: savingList ? 'none' : '0 6px 20px rgba(255,112,67,0.35)' }}>
                    {savingList ? 'Saving...' : `🛒 Save ${shoppingPreview.length} Items to Shopping List`}
                  </button>
                )}
              </>
            )}
          </>
        )}

      </div>
    </main>
  )
}
