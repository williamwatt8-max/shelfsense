import { NextRequest, NextResponse } from 'next/server'

// Maps Open Food Facts category tags to ShelfSense categories
function mapCategory(tags: string[] = []): string {
  const t = tags.join(' ').toLowerCase()
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

// Parses Open Food Facts quantity string like "750 ml", "6 x 330 ml", "500 g"
function parseQuantityString(raw: string): { quantity: number; unit: string } {
  if (!raw) return { quantity: 1, unit: 'item' }
  const s = raw.toLowerCase().trim()

  // Handle "N x Q unit" → use individual quantity
  const multi = s.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(ml|l|g|kg|cl)/i)
  if (multi) return { quantity: parseFloat(multi[2]), unit: multi[3].toLowerCase() }

  // Handle "Q unit"
  const simple = s.match(/(\d+(?:[.,]\d+)?)\s*(ml|l|g|kg|cl|oz|fl oz)/i)
  if (simple) {
    const unit = simple[2].toLowerCase().replace('cl', 'ml')
    const q = unit === 'cl' ? parseFloat(simple[1]) * 10 : parseFloat(simple[1].replace(',', '.'))
    return { quantity: q, unit: unit === 'fl oz' ? 'ml' : unit }
  }

  // Handle "N items" (pack size)
  const count = s.match(/^(\d+)\s*(pack|pieces|pcs|tabs|tablets|sachets|bags)?$/)
  if (count) return { quantity: parseInt(count[1]), unit: count[2] ? 'pack' : 'item' }

  return { quantity: 1, unit: 'item' }
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
    const { quantity, unit } = parseQuantityString(p.quantity || '')
    const category = mapCategory(p.categories_tags || [])

    return NextResponse.json({
      found: true,
      name: p.product_name || '',
      brand: p.brands || null,
      category,
      quantity,
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
