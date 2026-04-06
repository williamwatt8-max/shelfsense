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
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Today is ${today}. Parse this speech into one or more structured inventory items.

The user said: "${transcript}"

The user may mention a single item or multiple items in one sentence.
Extract EVERY item mentioned. Return an array even if only one item.

Return ONLY raw JSON — no markdown, no code fences:
[
  {
    "name": "clear product name",
    "count": 1,
    "amount_per_unit": null,
    "unit": "item",
    "location": "cupboard",
    "category": "other",
    "expiry_date": null,
    "opened_at": null,
    "retailer": null,
    "confidence": 0.9
  }
]

RULES per item:
- name: normalise to a clear product name (e.g. "Semi-Skimmed Milk", "Cheddar Cheese")
- count: number of individual packs/units (e.g. "6 cans" → 6; "a bottle" → 1; default 1)
- amount_per_unit: size of each individual unit as a plain number, null if unknown
    "6 cans of 330ml" → count=6, amount_per_unit=330, unit="ml"
    "a 750ml bottle of wine" → count=1, amount_per_unit=750, unit="ml"
    "500g of chicken" → count=1, amount_per_unit=500, unit="g"
    "some pasta" → count=1, amount_per_unit=null, unit="item"
- unit: item | g | kg | ml | l | bottle | tin | loaf | pack | bag | head | fillet
- location: infer from item type — fridge (dairy, meat, fish, fresh produce), freezer (frozen), household (cleaning, toiletries), cupboard (default)
- category: dairy | meat | fish | vegetables | fruit | bakery | tinned | dry goods | oils | frozen | drinks | snacks | alcohol | household | other
- expiry_date: interpret natural language relative to today (${today}), null if not mentioned
- opened_at: interpret phrases like "opened yesterday", null if not mentioned
- retailer: extract if mentioned, null otherwise
- confidence: 0.9=clear, 0.7=reasonable inference, 0.5=uncertain

Examples:
"milk 2 litres, rice 500 grams, cheddar 300 grams" →
[
  {"name":"Milk","count":1,"amount_per_unit":2000,"unit":"ml","location":"fridge","category":"dairy","expiry_date":null,"opened_at":null,"retailer":null,"confidence":0.95},
  {"name":"Rice","count":1,"amount_per_unit":500,"unit":"g","location":"cupboard","category":"dry goods","expiry_date":null,"opened_at":null,"retailer":null,"confidence":0.95},
  {"name":"Cheddar Cheese","count":1,"amount_per_unit":300,"unit":"g","location":"fridge","category":"dairy","expiry_date":null,"opened_at":null,"retailer":null,"confidence":0.9}
]

"I've got milk, about half a bottle left, use by Friday" →
[{"name":"Semi-Skimmed Milk","count":1,"amount_per_unit":1000,"unit":"ml","location":"fridge","category":"dairy","expiry_date":"<next Friday>","opened_at":null,"retailer":null,"confidence":0.9}]

"Six cans of Coke 330ml each and washing up liquid" →
[
  {"name":"Coca-Cola","count":6,"amount_per_unit":330,"unit":"ml","location":"cupboard","category":"drinks","expiry_date":null,"opened_at":null,"retailer":null,"confidence":0.9},
  {"name":"Washing Up Liquid","count":1,"amount_per_unit":null,"unit":"item","location":"household","category":"household","expiry_date":null,"opened_at":null,"retailer":null,"confidence":0.85}
]`
      }]
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

    try {
      const result = JSON.parse(cleaned)
      // Always return an array
      const items = Array.isArray(result) ? result : [result]
      return NextResponse.json(items)
    } catch {
      return NextResponse.json({ error: 'Could not understand — please try again' }, { status: 422 })
    }
  } catch (error: any) {
    console.error('voice-add error:', error.message)
    return NextResponse.json({ error: error.message || 'Failed to process voice input' }, { status: 500 })
  }
}
