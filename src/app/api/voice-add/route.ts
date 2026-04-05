import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const { transcript } = await req.json()
    if (!transcript) return NextResponse.json({ error: 'Missing transcript' }, { status: 400 })

    const today = new Date().toISOString().split('T')[0]

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Today is ${today}. Parse this speech into a structured inventory item.

The user said: "${transcript}"

Extract as much detail as possible. Return ONLY raw JSON — no markdown, no code fences:
{
  "name": "clear product name",
  "count": 1,
  "amount_per_unit": null,
  "quantity": 1,
  "quantity_original": 1,
  "unit": "item",
  "location": "cupboard",
  "category": "other",
  "expiry_date": null,
  "opened_at": null,
  "retailer": null,
  "confidence": 0.9
}

RULES:
- name: normalise to a clear product name (e.g. "Semi-Skimmed Milk", "Cheddar Cheese")
- count: number of individual packs/units (e.g. "6 cans" → 6; "a bottle" → 1; default 1)
- amount_per_unit: size of each individual unit as a plain number, null if unknown
    "6 cans of 330ml" → count=6, amount_per_unit=330, unit="ml"
    "a 750ml bottle of wine" → count=1, amount_per_unit=750, unit="ml"
    "500g of chicken" → count=1, amount_per_unit=500, unit="g"
    "some pasta" → count=1, amount_per_unit=null, unit="item"
- quantity: the CURRENT remaining amount expressed in the same unit
    "half a bottle of 750ml wine" → quantity=375, quantity_original=750, unit="ml"
    "about 300ml left" → quantity=300, unit="ml"
    if amount is fully intact → quantity = count (if count > 1) or amount_per_unit (if known) or 1
- quantity_original: original full amount; if fully intact, same as quantity
- unit: item | g | kg | ml | l | bottle | tin | loaf | pack | bag | head | fillet
- location: infer from item type — fridge (dairy, meat, fish, fresh produce), freezer (frozen), household (cleaning, toiletries), cupboard (default)
- category: dairy | meat | fish | vegetables | fruit | bakery | tinned | dry goods | oils | frozen | drinks | snacks | alcohol | household | other
- expiry_date: interpret natural language relative to today (${today}):
    "use by Friday" → next Friday as YYYY-MM-DD
    "good until the 15th" → 15th of current/next month
    "expires in 3 days" → today + 3 days
    null if not mentioned
- opened_at: interpret phrases like "opened yesterday" → yesterday's date, "opened two days ago" → today - 2 days, null if not mentioned
- retailer: extract if mentioned (e.g. "from Tesco", "got it at Waitrose"), null otherwise
- confidence: 0.9=clear, 0.7=reasonable inference, 0.5=uncertain

Examples:
"I've got milk, about half a bottle left, use by Friday" →
  name="Semi-Skimmed Milk", count=1, amount_per_unit=1000, quantity=500, quantity_original=1000, unit="ml", location="fridge", category="dairy"

"Six cans of Coke, 330ml each" →
  name="Coca-Cola", count=6, amount_per_unit=330, quantity=6, quantity_original=6, unit="ml", location="cupboard", category="drinks"

"Add cheddar cheese, 300 grams, opened two days ago" →
  name="Cheddar Cheese", count=1, amount_per_unit=300, quantity=300, quantity_original=300, unit="g", location="fridge", category="dairy", opened_at="<today - 2>"

"I've got washing up liquid and kitchen roll in the cupboard" →
  [Note: return the FIRST item — name="Washing Up Liquid", location="household"]`
      }]
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

    try {
      const result = JSON.parse(cleaned)
      return NextResponse.json(result)
    } catch {
      return NextResponse.json({ error: 'Could not understand — please try again' }, { status: 422 })
    }
  } catch (error: any) {
    console.error('voice-add error:', error.message)
    return NextResponse.json({ error: error.message || 'Failed to process voice input' }, { status: 500 })
  }
}
