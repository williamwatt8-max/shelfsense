import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PARSE_PROMPT = `You are a specialist UK supermarket receipt parser. Extract every purchased item from this receipt image.

STEP 1 — IDENTIFY RETAILER
Read the header, logo, or store name at the top of the receipt. Identify the retailer (e.g. Morrisons, M&S, Tesco, Sainsbury's, Asda, Waitrose, Co-op, Lidl, Aldi).

STEP 2 — APPLY RETAILER-SPECIFIC PARSING RULES

▶ MORRISONS RECEIPTS
Morrisons item rows follow a structured columnar format: QTY | DESCRIPTION | PRICE | TOTAL | DEPT
• Treat each printed row as one item — do NOT merge adjacent rows
• DEPT code at line end hints at category: F=fresh produce, A=ambient/cupboard, D=dairy — use as a hint, not absolute truth
• Strip leading "M " from the description (Morrisons own-brand prefix noise) when building normalized_name:
  - "M SEMI SKIM MILK 2L" → "Semi-Skimmed Milk 2L"
  - "M FREE RANGE EGGS 6" → "Free Range Eggs 6"
  - "M CHEDDAR CHEESE 400G" → "Cheddar Cheese 400g"
  - "M STRAWBERRIES 400G" → "Strawberries 400g"
• The PRICE column is the individual item price; TOTAL = qty × price — always extract per-item price
• A "5" or "10" at the end of a line is likely a quantity column value, not part of the name

▶ M&S RECEIPTS
M&S item lines are compact and often abbreviated.
• Item codes (numeric or short alphanumeric prefixes) may appear before the description — omit them from normalized_name
• Use price context to interpret ambiguous names: an item at £7–12 is very likely wine or spirits; £0.05–0.30 is likely a carrier bag
• COMPLETELY IGNORE any line or block containing these strings:
  Items | Balance to Pay | VISA | MASTERCARD | AMEX | CONTACTLESS | Contactless | APPROVED
  AUTH CODE | AID: | TVR: | TSI: | Cardholder | CARDHOLDER | Sparks | SPARKS | charity | Charity
  Thank you | VAT No | QR | Receipt No | Please retain | Transaction | Store No | Tel:
  dashes/separator lines (---) | timestamps (HH:MM) | store address lines | "App"
• Paper bags, food bags, and other charged bags ARE real items — include them

▶ TESCO / SAINSBURY'S / ASDA / WAITROSE / CO-OP
Apply general parsing rules. No retailer-specific cleanup needed beyond standard abbreviation expansion.

▶ LIDL / ALDI
Items often show a short product code + description. Omit the numeric product code from normalized_name.

STEP 3 — EXTRACTION RULES (ALL RETAILERS)
1. raw_text: exact abbreviated text as it appears on the receipt line
2. normalized_name: clear, human-readable product name — expand abbreviations, fix capitalisation, remove noise prefixes (M prefix for Morrisons, numeric codes for M&S/Lidl/Aldi)
3. quantity: numeric quantity, default 1; if receipt shows "2 x £1.50" set quantity=2 and price=1.50; weight items "0.453 kg @ £5/kg" → quantity=0.453, unit=kg, price=total for that line
4. unit: item | g | kg | ml | l | bottle | tin | loaf | pack | bag | box | head | fillet
5. category: dairy | meat | fish | vegetables | fruit | bakery | tinned | dry goods | oils | frozen | drinks | snacks | alcohol | household | other
6. confidence: 0.9=clearly identifiable, 0.7=likely correct, 0.5=best guess from context
7. price: single-item price as a number (null if genuinely not found)
8. Include ALL charged items: food, household products, toiletries, bags, alcohol — not just food
9. SKIP these line types for ALL retailers: subtotals, VAT/tax lines, payment method lines (CASH/CARD/VISA), loyalty points, change/cashback, discount summary lines, non-item retailer sections listed in M&S rules above
10. When uncertain, include the item with lower confidence (0.5–0.7) rather than omitting — the user can remove it during review
11. PRESERVE RECEIPT ORDER: list items in the exact top-to-bottom order they appear on the receipt — do not reorder, group, or sort

STEP 4 — OUTPUT FORMAT
Return ONLY raw JSON — no markdown, no code fences, no explanation:
{"retailer_name":"Morrisons","total":24.99,"items":[{"raw_text":"M SEMI SKIM MILK 2L","normalized_name":"Semi-Skimmed Milk 2L","quantity":1,"unit":"l","category":"dairy","confidence":0.9,"price":1.09}]}`

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

      if (!parsed.items || !Array.isArray(parsed.items)) {
        parsed.items = []
      }

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
      console.error('Failed to parse JSON response. Raw (first 800 chars):', cleaned.substring(0, 800))

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
