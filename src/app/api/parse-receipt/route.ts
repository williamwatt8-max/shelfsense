import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { normalizeReceiptItems } from '@/lib/receiptParser'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Prompt: paper receipt image (photo / library / screenshot) ────────────────

const IMAGE_PARSE_PROMPT = `You are a specialist UK supermarket receipt parser. Extract every purchased item from this receipt image.

STEP 1 — IDENTIFY RETAILER
Read the header, logo, or store name at the top of the receipt. Identify the retailer (e.g. Morrisons, M&S, Tesco, Sainsbury's, Asda, Waitrose, Co-op, Lidl, Aldi).

STEP 2 — APPLY RETAILER-SPECIFIC PARSING RULES

▶ MORRISONS RECEIPTS
Morrisons item rows follow a structured columnar format: QTY | DESCRIPTION | PRICE | TOTAL | DEPT
• Treat each printed row as one item — do NOT merge adjacent rows
• DEPT code at line end hints at category: F=fresh produce, A=ambient/cupboard, D=dairy — use as a hint, not absolute truth
• Strip leading "M " from the description (Morrisons own-brand prefix noise) when building normalized_name:
  - "M SEMI SKIM MILK 2L" → normalized_name: "Semi-Skimmed Milk", amount_per_unit: 2000, unit: "ml"
  - "M FREE RANGE EGGS 6" → normalized_name: "Free Range Eggs", quantity: 6, amount_per_unit: null, unit: "item"
  - "M CHEDDAR CHEESE 400G" → normalized_name: "Cheddar Cheese", amount_per_unit: 400, unit: "g"
  - "M STRAWBERRIES 400G" → normalized_name: "Strawberries", amount_per_unit: 400, unit: "g"
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
1. raw_text: exact abbreviated text as it appears on the receipt line — do not clean or expand this
2. normalized_name: clear, human-readable product name only — NO size/weight suffix (those go into amount_per_unit/unit). Expand abbreviations, fix capitalisation, remove noise prefixes (M prefix for Morrisons, numeric codes for M&S/Lidl/Aldi). E.g.: "M SEMI SKIM MILK 2L" → "Semi-Skimmed Milk"; "CHKN BRST FILLET" → "Chicken Breast Fillet"
3. quantity: NUMBER OF PACK UNITS only (not weight) — e.g. "6 cans of Coke" → 6; "1 bottle of milk" → 1; "EGGS 6" → 6 (six eggs); if a receipt shows "2 x £1.50" the quantity is 2 and price is 1.50; default 1
   MULTI-PACK PATTERN — when a line contains "N x Qunit" (e.g. "6 x 400g", "4 x 330ml", "2 x 1l", "12 x 400g"): quantity=N, amount_per_unit=Q (in base units), unit=base_unit. Example: "Harrington's 6 x 400g" → quantity:6, amount_per_unit:400, unit:"g"
4. amount_per_unit: SIZE OF EACH UNIT as a plain number (null if not a measured-size product) — always convert to base units: L→ml (×1000), kg→g (×1000), cl→ml (×10). Examples: "MILK 2L" → 2000; "COKE 330ML" → 330; "CHEESE 400G" → 400; "OIL 500ML" → 500; "JUICE 1.5L" → 1500; "BUTTER 250G" → 250; "EGGS 6" → null (eggs are countable, no measured size)
5. unit: measurement unit for amount_per_unit — one of: ml | g | item (use "item" when amount_per_unit is null, i.e. no meaningful size, e.g. eggs, bags, single-serve packs)
6. For weight-sold items (deli meat, loose produce): "0.453 kg @ £5/kg" → quantity: 1, amount_per_unit: 453, unit: "g", price: total price for that line
7. category: dairy | meat | fish | vegetables | fruit | bakery | tinned | dry goods | oils | frozen | drinks | snacks | alcohol | household | pet | other — use "pet" for all pet food, pet treats, and pet supplies (dog food, cat food, bird seed, pet litter, etc.)
8. confidence: 0.9=clearly identifiable product with known size; 0.7=likely correct but some ambiguity; 0.5=best guess, name or size uncertain
9. price: ALWAYS the per-unit (single item) price as a positive number (null if genuinely not visible). VALIDATION: must be > 0.00 and < 999.00. For multi-pack items where only a TOTAL price is shown on the receipt: calculate per-unit price = total ÷ quantity. Example: "6 x 400g DOG FOOD £9.00" → price: 1.50 (9.00 ÷ 6), NOT 9.00. Reject: negative values, values > 999
10. Include ALL charged items: food, household products, toiletries, bags, alcohol — not just food
11. SKIP these line types for ALL retailers: subtotals, VAT/tax lines, payment method lines (CASH/CARD/VISA), loyalty points, change/cashback, discount summary lines, non-item retailer sections listed in M&S rules above
12. When uncertain about a field, use a lower confidence score (0.5–0.7) and include the item rather than omitting — the user can remove it during review
13. PRESERVE RECEIPT ORDER: list items in the exact top-to-bottom order they appear on the receipt — do NOT reorder, group, or sort by category/name/price

STEP 4 — OUTPUT FORMAT
Return ONLY raw JSON — no markdown, no code fences, no explanation:
{"retailer_name":"Morrisons","total":24.99,"items":[{"raw_text":"M SEMI SKIM MILK 2L","normalized_name":"Semi-Skimmed Milk","quantity":1,"amount_per_unit":2000,"unit":"ml","category":"dairy","confidence":0.9,"price":1.09}]}`

// ── Prompt: PDF receipt / order confirmation document ─────────────────────────

const PDF_PARSE_PROMPT = `You are a specialist receipt/order confirmation parser. Extract every purchased item from this PDF document.

The document may be a supermarket PDF receipt, an online order confirmation, a delivery note, or similar.

EXTRACTION RULES
1. raw_text: the product line as it appears in the document
2. normalized_name: clear, human-readable product name only — no size/weight suffix (those go in amount_per_unit/unit). Expand abbreviations, remove item codes/SKUs
3. quantity: number of units purchased (default 1)
   MULTI-PACK PATTERN: "6 x 400g" → quantity:6, amount_per_unit:400, unit:"g"
4. amount_per_unit: size of each unit as a plain number in base units (ml not l, g not kg). Null if not applicable (e.g. single items without a measured size). Convert: L→ml (×1000), kg→g (×1000)
5. unit: "ml" | "g" | "item"
6. category: dairy | meat | fish | vegetables | fruit | bakery | tinned | dry goods | oils | frozen | drinks | snacks | alcohol | household | pet | other
7. confidence: 0.9=clearly identified product, 0.7=some ambiguity, 0.5=best guess
8. price: per-unit price as a positive number < 999. For multi-packs: total ÷ quantity. Null if not shown
9. retailer_name: extract from the document if visible (e.g. "Tesco", "Ocado", "Amazon Fresh")
10. total: order/receipt total if visible

SKIP: delivery charges, service fees, VAT summary lines, payment method lines, loyalty points, promotional text, headers, footers, order reference numbers.

Include ALL purchased items including non-food.

Return ONLY raw JSON — no markdown, no code fences:
{"retailer_name":"Ocado","total":65.40,"items":[{"raw_text":"...","normalized_name":"...","quantity":1,"amount_per_unit":null,"unit":"item","category":"other","confidence":0.9,"price":2.50}]}`

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('receipt') as File
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')
    const isPDF = file.type === 'application/pdf'

    let contentBlocks: any[]
    if (isPDF) {
      contentBlocks = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: PDF_PARSE_PROMPT },
      ]
    } else {
      let mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' = 'image/jpeg'
      if (file.type === 'image/png') mediaType = 'image/png'
      if (file.type === 'image/webp') mediaType = 'image/webp'
      contentBlocks = [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: IMAGE_PARSE_PROMPT },
      ]
    }

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [{ role: 'user', content: contentBlocks }],
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
    return parseAndNormalize(responseText)
  } catch (error: any) {
    console.error('Parse receipt API error:', error.message)
    return NextResponse.json(
      { error: error.message || 'Failed to parse receipt' },
      { status: 500 }
    )
  }
}

function parseAndNormalize(responseText: string): Response {
  const cleaned = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (!parsed.items || !Array.isArray(parsed.items)) parsed.items = []
    parsed.items = normalizeReceiptItems(parsed.items)
    return NextResponse.json(parsed)
  } catch {
    console.error('Failed to parse JSON response. Raw (first 800 chars):', cleaned.substring(0, 800))
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const salvaged = JSON.parse(jsonMatch[0])
        if (!Array.isArray(salvaged.items)) salvaged.items = []
        salvaged.items = normalizeReceiptItems(salvaged.items)
        return NextResponse.json(salvaged)
      } catch { /* fall through */ }
    }
    return NextResponse.json(
      { error: 'Receipt could not be read. Try a clearer photo or better lighting.' },
      { status: 422 }
    )
  }
}
