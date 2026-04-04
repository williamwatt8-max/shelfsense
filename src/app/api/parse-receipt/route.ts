import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PARSE_PROMPT = `You are a grocery and retail receipt parser. Extract every purchased item from this receipt image.

Return ONLY raw JSON — no markdown, no code fences, no explanation:
{"retailer_name":"Store Name","total":24.99,"items":[{"raw_text":"EXACT TEXT FROM RECEIPT","normalized_name":"Clear Product Name","quantity":1,"unit":"item","category":"dairy","confidence":0.9,"price":1.99}]}

ITEM FIELDS:
- raw_text: the exact abbreviated text as it appears on the receipt
- normalized_name: a clear, human-readable product name (expand abbreviations, e.g. "SMSK MLK 2L" → "Semi-Skimmed Milk 2L")
- quantity: numeric quantity (default 1 if not shown)
- unit: item | g | kg | ml | l | bottle | tin | loaf | pack | bag | head | fillet
- category: dairy | meat | fish | vegetables | fruit | bakery | tinned | dry goods | oils | frozen | drinks | snacks | alcohol | household | other
- confidence: 0.9=clearly identifiable, 0.7=likely correct, 0.5=best guess from context
- price: single-item price as a number (null if not found)

EXTRACTION RULES:
1. Use the price to identify items — e.g. "CLASSICS PG" at £8+ is Pinot Grigio wine, not PG Tips tea; a £0.10–0.30 item is likely a carrier bag
2. Include ALL purchased items: food, household products, toiletries, baby items, bags, alcohol — not just food
3. SKIP: subtotals, VAT/tax lines, payment method lines (CASH/CARD/CONTACTLESS), loyalty points, change/cashback, discount lines that aren't individual items
4. Quantity multipliers: if receipt shows "2 x £1.50", set quantity=2 and price=1.50 (the per-item price)
5. Weight-priced items: "0.453 kg @ £5.00/kg" → quantity=0.453, unit=kg, price=2.27 (the total for that line)
6. Multi-buy promotions: if "3 FOR £5" applies to 3 separate line items, price each at 1.67
7. Long receipts: extract every product line even if the receipt is complex or has many items
8. When in doubt, include the item with lower confidence rather than omitting it — the user can remove it in the review step

Return the retailer_name as the store name (e.g. "Tesco", "Asda", "Waitrose"). If unclear, use "Unknown Store".
Return total as the final amount paid (after discounts). If unclear, use null.`

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('receipt') as File
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')

    let mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' = 'image/jpeg'
    if (file.type === 'image/png') mediaType = 'image/png'
    if (file.type === 'image/webp') mediaType = 'image/webp'

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            { type: 'text', text: PARSE_PROMPT },
          ],
        },
      ],
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
    // Strip any accidental markdown fences
    const cleaned = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

    try {
      const parsed = JSON.parse(cleaned)

      // Validate minimal shape — if items is missing or empty, still return what we have
      if (!parsed.items || !Array.isArray(parsed.items)) {
        parsed.items = []
      }

      // Coerce each item to safe types
      parsed.items = parsed.items.map((item: any) => ({
        raw_text: String(item.raw_text || ''),
        normalized_name: String(item.normalized_name || item.raw_text || 'Unknown item'),
        quantity: Number(item.quantity) || 1,
        unit: item.unit || 'item',
        category: item.category || 'other',
        confidence: Number(item.confidence) || 0.7,
        price: item.price != null ? Number(item.price) : null,
      }))

      return NextResponse.json(parsed)
    } catch {
      // JSON parse failed — attempt to salvage partial JSON
      console.error('Failed to parse JSON response. Raw (first 800 chars):', cleaned.substring(0, 800))

      // Try to extract the JSON object from within any surrounding text
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try {
          const salvaged = JSON.parse(jsonMatch[0])
          if (!Array.isArray(salvaged.items)) salvaged.items = []
          return NextResponse.json(salvaged)
        } catch {
          // salvage attempt also failed
        }
      }

      return NextResponse.json(
        { error: 'Receipt could not be read. Try a clearer photo or better lighting.' },
        { status: 422 }
      )
    }
  } catch (error: any) {
    console.error('Parse receipt API error:', error.message)
    return NextResponse.json(
      { error: error.message || 'Failed to parse receipt' },
      { status: 500 }
    )
  }
}
