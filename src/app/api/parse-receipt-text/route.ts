import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { normalizeReceiptItems } from '@/lib/receiptParser'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const TEXT_PARSE_PROMPT = `You are a specialist receipt/order confirmation parser. Extract every purchased item from the following text.

The text may come from:
- A digital receipt email (Tesco, Sainsbury's, M&S, Waitrose, Ocado, Amazon Fresh, etc.)
- An online order confirmation page copy-pasted by the user
- A pasted supermarket receipt or delivery note

EXTRACTION RULES
1. raw_text: the product line exactly as it appears in the source text
2. normalized_name: clear, human-readable product name only — NO size/weight suffix (those go into amount_per_unit/unit). Expand abbreviations, remove item codes/SKUs/product numbers
3. quantity: number of units purchased (default 1)
   MULTI-PACK PATTERN — "6 x 400g", "4 x 330ml", "12 x 400g": quantity=N, amount_per_unit=Q, unit=base_unit
   If text shows "Qty: 2" or "x2" etc., set quantity=2
4. amount_per_unit: size of each unit as a plain number in base units (ml not l, g not kg). Null if not applicable. Convert: L→ml (×1000), kg→g (×1000), cl→ml (×10)
5. unit: "ml" | "g" | "item" (use "item" when there is no meaningful measured size)
6. category: dairy | meat | fish | vegetables | fruit | bakery | tinned | dry goods | oils | frozen | drinks | snacks | alcohol | household | pet | other
7. confidence: 0.9=clearly identified product, 0.7=some ambiguity, 0.5=best guess
8. price: per-unit price as a positive number < 999. For multi-packs where only a total is shown: total ÷ quantity. Null if not visible
9. retailer_name: extract from the text if visible (e.g. "Your Tesco order", "Ocado", "Amazon Fresh")
10. total: order/receipt total if visible as a number

IMPORTANT:
- Include ALL purchased items (food, household, drinks, non-food)
- SKIP: delivery charges, service fees, VAT/tax summary lines, payment method lines (VISA/CARD/CASH), loyalty points, promotional text, discount lines, headers, footers, order reference lines
- Preserve the original order items appear in the text
- When uncertain, lower confidence and include the item rather than omitting it

Return ONLY raw JSON — no markdown, no code fences, no explanation:
{"retailer_name":"Tesco","total":45.60,"items":[{"raw_text":"...","normalized_name":"...","quantity":1,"amount_per_unit":null,"unit":"item","category":"other","confidence":0.9,"price":1.50}]}`

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const text = body?.text
    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'No text provided' }, { status: 400 })
    }

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `${TEXT_PARSE_PROMPT}\n\n---\n\n${text.trim()}`,
        },
      ],
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
    const cleaned = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

    try {
      const parsed = JSON.parse(cleaned)
      if (!parsed.items || !Array.isArray(parsed.items)) parsed.items = []
      parsed.items = normalizeReceiptItems(parsed.items)
      return NextResponse.json(parsed)
    } catch {
      console.error('parse-receipt-text: failed to parse JSON. Raw (first 800):', cleaned.substring(0, 800))
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
        { error: 'Could not extract items from the text. Try pasting a more complete receipt.' },
        { status: 422 }
      )
    }
  } catch (error: any) {
    console.error('parse-receipt-text API error:', error.message)
    return NextResponse.json(
      { error: error.message || 'Failed to parse receipt text' },
      { status: 500 }
    )
  }
}
