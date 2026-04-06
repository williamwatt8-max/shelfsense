import { NextRequest, NextResponse } from 'next/server'

// Maps Open Food Facts category tags to ShelfSense categories
function mapCategory(tags: string[] = []): string {
  const t = tags.join(' ').toLowerCase()
  // Pet food — check before 'fish' to avoid "fish food" → fish category
  if (t.includes('pet') || t.includes('dog') || t.includes('cat-food') || t.includes('cat food') || t.includes('bird-food') || t.includes('bird food') || t.includes('animal-food') || t.includes('pet-food') || t.includes('kitten') || t.includes('canine') || t.includes('feline')) return 'pet'
  if (t.includes('dair') || t.includes('milk') || t.includes('cheese') || t.includes('yogurt') || t.includes('butter') || t.includes('cream')) return 'dairy'
  if (t.includes('meat') || t.includes('beef') || t.includes('pork') || t.includes('chicken') || t.includes('poultry') || t.includes('lamb')) return 'meat'
  if (t.includes('fish') || t.includes('seafood') || t.includes('salmon') || t.includes('tuna')) return 'fish'
  if (t.includes('vegetable') || t.includes('veggie') || t.includes('salad')) return 'vegetables'
  if (t.includes('fruit') || t.includes('berr')) return 'fruit'
  if (t.includes('bread') || t.includes('bakery') || t.includes('biscuit') || t.includes('cake') || t.includes('pastry')) return 'bakery'
  if (t.includes('tinned') || t.includes('canned') || t.includes('conserve')) return 'tinned'
  if (t.includes('frozen')) return 'frozen'
  if (t.includes('drink') || t.includes('beverage') || t.includes('juice') || t.includes('water') || t.includes('soda')) return 'drinks'
  if (t.includes('alcohol') || t.includes('wine') || t.includes('beer') || t.includes('spirit') || t.includes('cider')) return 'alcohol'
  if (t.includes('snack') || t.includes('crisp') || t.includes('chip') || t.includes('chocolate') || t.includes('sweet') || t.includes('candy')) return 'snacks'
  if (t.includes('oil') || t.includes('sauce') || t.includes('condiment') || t.includes('vinegar')) return 'oils'
  if (t.includes('cleaning') || t.includes('household') || t.includes('detergent') || t.includes('hygiene') || t.includes('beauty')) return 'household'
  if (t.includes('cereal') || t.includes('pasta') || t.includes('rice') || t.includes('flour') || t.includes('grain') || t.includes('legume') || t.includes('bean')) return 'dry goods'
  return 'other'
}

// Parses Open Food Facts quantity string into count + amount_per_unit + unit.
// Examples:
//   "6 x 330 ml"  → { count: 6, amount_per_unit: 330, unit: 'ml' }
//   "750 ml"      → { count: 1, amount_per_unit: 750, unit: 'ml' }
//   "500 g"       → { count: 1, amount_per_unit: 500, unit: 'g' }
//   "12"          → { count: 12, amount_per_unit: null, unit: 'item' }
function parseProductQuantity(raw: string): { count: number; amount_per_unit: number | null; unit: string } {
  if (!raw) return { count: 1, amount_per_unit: null, unit: 'item' }
  const s = raw.toLowerCase().trim()

  // "N x Q unit" — pack of N, each Q units
  const multi = s.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(ml|l|g|kg|cl)/i)
  if (multi) {
    const unit = multi[3].toLowerCase() === 'cl' ? 'ml' : multi[3].toLowerCase()
    const amt  = multi[3].toLowerCase() === 'cl' ? parseFloat(multi[2]) * 10 : parseFloat(multi[2])
    return { count: parseInt(multi[1]), amount_per_unit: amt, unit }
  }

  // "Q unit" — single item with a measured size
  const simple = s.match(/(\d+(?:[.,]\d+)?)\s*(ml|l|g|kg|cl|oz)/i)
  if (simple) {
    const rawUnit = simple[2].toLowerCase()
    const unit = rawUnit === 'cl' ? 'ml' : rawUnit === 'oz' ? 'g' : rawUnit
    const amt  = rawUnit === 'cl' ? parseFloat(simple[1]) * 10 : parseFloat(simple[1].replace(',', '.'))
    return { count: 1, amount_per_unit: amt, unit }
  }

  // "N" alone — treat as a pack count (e.g. "12" for 12-pack)
  const countOnly = s.match(/^(\d+)\s*(pack|pieces|pcs|tabs|tablets|sachets|bags)?$/)
  if (countOnly) return { count: parseInt(countOnly[1]), amount_per_unit: null, unit: countOnly[2] ? 'pack' : 'item' }

  return { count: 1, amount_per_unit: null, unit: 'item' }
}

export async function POST(req: NextRequest) {
  try {
    const { barcode } = await req.json()
    if (!barcode) return NextResponse.json({ error: 'Missing barcode' }, { status: 400 })

    // Open Food Facts public API — free, no key required
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}?fields=product_name,brands,categories_tags,quantity,image_front_url,nutriments`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ShelfSense/1.0 (household inventory app)' },
      signal: AbortSignal.timeout(6000),
    })

    if (!res.ok) return NextResponse.json({ found: false })

    const data = await res.json()

    if (data.status !== 1 || !data.product) {
      return NextResponse.json({ found: false })
    }

    const p = data.product
    const { count, amount_per_unit, unit } = parseProductQuantity(p.quantity || '')
    const category = mapCategory(p.categories_tags || [])

    return NextResponse.json({
      found: true,
      name: p.product_name || '',
      brand: p.brands || null,
      category,
      count,
      amount_per_unit,
      unit,
      image_url: p.image_front_url || null,
    })
  } catch (error: any) {
    // Timeout or network error — return not found so UI shows manual entry
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return NextResponse.json({ found: false, reason: 'timeout' })
    }
    console.error('barcode lookup error:', error.message)
    return NextResponse.json({ found: false })
  }
}
